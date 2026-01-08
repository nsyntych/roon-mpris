#!/usr/bin/env node
"use strict";

const RoonApi = require("node-roon-api");
const RoonApiTransport = require("node-roon-api-transport");
const RoonApiSettings  = require("node-roon-api-settings");
const Player = require('mpris-service');
const yargs = require('yargs');
const os = require('os');
const fs = require('fs');


const argv = yargs
    .option('host', {
        alias: 'h',
        description: 'Hostname to connect to, rather than using Roon discovery',
        type: 'string'
    })
    .option('port', {
        alias: 'p',
        description: 'The port to connect to when connecting directly to a host',
        type: 'number',
        default: 9100
    })
    .option('config', {
        alias: 'c',
        description: "Where the app's configuration will be stored.  This directory will be created if it does not exist",
        type: 'string',
        default: `${os.homedir()}/.config/roon-mpris`
    })
    .option('log', {
        alias: 'l',
        description: 'The amount of Roon logging to output',
        type: 'string',
        default: 'none'
    })
    .option('pause-all', {
        alias: 'P',
        description: 'Pause all zones and exit',
        type: 'boolean',
        default: false
    })
    .help()
    .argv;

var core;
const zonePlayerMap = new Map(); // zone_id -> { player, zone, sanitizedName, wsUrl }

// Sanitize zone names for D-Bus (only alphanumeric, underscore, hyphen allowed)
function sanitizeForDBus(displayName) {
    let sanitized = displayName.replace(/[^A-Za-z0-9_-]/g, '_');
    // D-Bus names cannot start with a digit
    if (/^[0-9]/.test(sanitized)) {
        sanitized = 'zone_' + sanitized;
    }
    return sanitized || 'unnamed_zone';
}

// Update MPRIS player state from Roon zone data
function updatePlayerFromZone(context) {
    const { player, zone, wsUrl } = context;
    const now_playing = zone.now_playing;

    if (now_playing) {
        player.metadata = {
            'mpris:length': now_playing.length ? now_playing.length * 1000 * 1000 : 0, // In microseconds
            'mpris:artUrl': `http://${wsUrl}/image/${now_playing.image_key}`,
            'xesam:title': now_playing.three_line.line1,
            'xesam:album': now_playing.three_line.line3,
            'xesam:artist': now_playing.three_line.line2.split(/\s+\/\s+/),
        };
    }

    player.playbackStatus = zone.state.charAt(0).toUpperCase() + zone.state.slice(1);
    player.canGoNext = zone.is_next_allowed;
    player.canGoPrevious = zone.is_previous_allowed;
    // player.canPlay = zone.is_play_allowed; // Ubuntu dock widget disappears if false while playing
    player.canPause = zone.is_pause_allowed;
    player.canSeek = zone.is_seek_allowed;
}

// Set up MPRIS event handlers for a specific zone
function setupPlayerEvents(player, zoneId) {
    // Position getter
    player.getPosition = function() {
        const context = zonePlayerMap.get(zoneId);
        if (context && context.zone && context.zone.now_playing) {
            return context.zone.now_playing.seek_position * 1000 * 1000;
        }
        return 0;
    };

    // Transport controls - route to this specific zone
    ['playpause', 'stop', 'next', 'previous'].forEach(function(eventName) {
        player.on(eventName, () => {
            const context = zonePlayerMap.get(zoneId);
            if (context && core) {
                console.log(`Zone "${context.zone.display_name}": ${eventName}`);
                core.services.RoonApiTransport.control(context.zone, eventName);
            }
        });
    });

    // Log other events
    ['raise', 'pause', 'play', 'seek', 'position', 'open', 'volume', 'loopStatus', 'shuffle'].forEach(function(eventName) {
        player.on(eventName, function() {
            const context = zonePlayerMap.get(zoneId);
            console.log(`Zone "${context?.zone?.display_name}": Event ${eventName}`, arguments);
        });
    });

    player.on('quit', function() {
        console.log('Quit requested for zone player');
    });
}

// Create MPRIS player for a zone
function createPlayerContext(zone, wsUrl) {
    const sanitizedName = `roon_${sanitizeForDBus(zone.display_name)}`;

    const player = Player({
        name: sanitizedName,
        identity: `Roon - ${zone.display_name}`,
        supportedUriSchemes: ['file'],
        supportedMimeTypes: ['audio/mpeg', 'application/ogg'],
        supportedInterfaces: ['player']
    });

    setupPlayerEvents(player, zone.zone_id);

    return {
        player: player,
        zone: zone,
        sanitizedName: sanitizedName,
        wsUrl: wsUrl
    };
}

// Destroy MPRIS player (disconnect from D-Bus)
function destroyPlayerContext(context) {
    if (context.player && context.player._bus) {
        context.player._bus.disconnect();
    }
}


const working_directory = `${os.homedir()}/.config/roon-mpris`
fs.mkdirSync(working_directory, { recursive: true });
process.chdir( working_directory )


const roon = new RoonApi({
    extension_id:        'com.tymur.roon-mpris-multizone',
    display_name:        "Roon MPRIS Multi-Zone Bridge",
    display_version:     "2.0.0",
    log_level:           argv.log,
    publisher:           'Tymur Smyr',
    email:               'tymur@smyr.dev',
    website:             'https://github.com/godlyfast/roon-mpris',

    core_paired: function(core_) {
        core = core_;
        const transport = core.services.RoonApiTransport;

        // Handle --pause-all mode: pause everything and exit
        if (argv['pause-all']) {
            console.log('Pausing all zones...');
            transport.pause_all((err) => {
                if (err) {
                    console.error('Error pausing zones:', err);
                    process.exit(1);
                }
                console.log('All zones paused');
                process.exit(0);
            });
            return;
        }

        // Normal mode: subscribe to all zones and create MPRIS players
        transport.subscribe_zones(function(cmd, data) {
            const wsUrl = core.moo.transport.ws._url.substring(5);

            // Handle initial zone list and newly added zones
            const zonesToAdd = data.zones || data.zones_added || [];
            for (const zone of zonesToAdd) {
                if (!zonePlayerMap.has(zone.zone_id)) {
                    console.log(`Creating MPRIS player for zone: ${zone.display_name}`);
                    const context = createPlayerContext(zone, wsUrl);
                    zonePlayerMap.set(zone.zone_id, context);
                    updatePlayerFromZone(context);
                }
            }

            // Handle zone state changes
            if (data.zones_changed) {
                for (const zone of data.zones_changed) {
                    const context = zonePlayerMap.get(zone.zone_id);
                    if (context) {
                        context.zone = zone;
                        updatePlayerFromZone(context);
                    }
                }
            }

            // Handle zone removals
            if (data.zones_removed) {
                for (const zoneId of data.zones_removed) {
                    const context = zonePlayerMap.get(zoneId);
                    if (context) {
                        console.log(`Removing MPRIS player for zone: ${context.zone.display_name}`);
                        destroyPlayerContext(context);
                        zonePlayerMap.delete(zoneId);
                    }
                }
            }

            // Handle seek position updates
            if (data.zones_seek_changed) {
                for (const change of data.zones_seek_changed) {
                    const context = zonePlayerMap.get(change.zone_id);
                    if (context) {
                        context.player.position = change.seek_position * 1000 * 1000;
                    }
                }
            }
        });
    },

    core_unpaired: function(core_) {
        console.log(core_.core_id, core_.display_name, core_.display_version, "-", "LOST");

        // Clean up all MPRIS players
        for (const [zoneId, context] of zonePlayerMap) {
            console.log(`Destroying player for zone: ${context.zone.display_name}`);
            destroyPlayerContext(context);
        }
        zonePlayerMap.clear();

        core = undefined;
    },
});


var mysettings = roon.load_config("settings") || {};


function makelayout(settings) {
    return {
        values: settings,
        layout: [
            {
                type: "label",
                title: "All Roon zones are automatically exposed as MPRIS players."
            }
        ],
        has_error: false
    };
}


const svc_settings = new RoonApiSettings(roon, {
    get_settings: function(cb) {
        cb(makelayout(mysettings));
    },
    save_settings: function(req, isdryrun, settings) {
        let l = makelayout(settings.values);
        req.send_complete(l.has_error ? "NotValid" : "Success", { settings: l });

        if (!isdryrun && !l.has_error) {
            mysettings = l.values;
            svc_settings.update_settings(l);
            roon.save_config("settings", mysettings);
        }
    }
});

roon.init_services({
    required_services: [ RoonApiTransport ],
    provided_services: [ svc_settings ],
});


// Connect to Roon
if (argv.host) {
    console.log(`Connecting to Core at ws://${argv.host}:${argv.port}`)
    roon.ws_connect({ host: argv.host, port: argv.port});
} else {
    console.log("Autodiscovery of Core")
    roon.start_discovery();
}
