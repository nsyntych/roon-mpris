# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Roon MPRIS Multi-Zone Bridge** is a Node.js extension that connects [Roon](https://roonlabs.com/) to Linux's MPRIS D-Bus interface. Each Roon zone is exposed as its own MPRIS player, enabling control via standard Linux media keys or tools like `playerctl`.

- **Extension ID**: `com.tymur.roon-mpris-multizone`
- **Publisher**: Tymur Smyr
- **Based on**: [brucejcooper/roon-mpris](https://github.com/brucejcooper/roon-mpris)

## Commands

```bash
# Install dependencies
npm install

# Run the application (normal mode - all zones)
npm start
# or directly:
node index.js

# Pause all zones and exit
node index.js --pause-all
node index.js -P

# Direct host connection (bypasses UDP multicast discovery)
node index.js --host <roon-core-ip> --port 9100

# Set logging level for debugging Roon API
node index.js --log all

# Custom config directory
node index.js --config /path/to/config

# Verify MPRIS players are registered
busctl --user list | grep MediaPlayer2

# Control a specific zone via playerctl
playerctl -p roon_Living_Room play
playerctl -p roon_Office next
```

## Architecture

The application is contained in `index.js` (~290 lines) using an **adapter-per-entity pattern**:

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────────────┐
│   Roon Core     │◄───────►│      index.js        │◄───────►│   D-Bus / MPRIS     │
│ (WebSocket API) │         │                      │         │                     │
│                 │         │  zonePlayerMap:      │         │  roon_Living_Room   │
│  Zone: Living   │────────►│    zone_id -> {      │────────►│  roon_Office        │
│  Zone: Office   │         │      player,         │         │  roon_Kitchen       │
│  Zone: Kitchen  │         │      zone,           │         │                     │
│                 │         │      wsUrl           │         │                     │
└─────────────────┘         │    }                 │         └─────────────────────┘
                            └──────────────────────┘
```

### Key Components

| Lines | Component | Purpose |
|-------|-----------|---------|
| 13-44 | `yargs` CLI | Argument parsing including `--pause-all` |
| 47 | `zonePlayerMap` | `Map<zone_id, PlayerContext>` tracking all zone players |
| 50-57 | `sanitizeForDBus()` | Converts zone names to valid D-Bus names |
| 59-80 | `updatePlayerFromZone()` | Syncs Roon zone state → MPRIS metadata |
| 83-115 | `setupPlayerEvents()` | Binds MPRIS events to zone-specific Roon controls |
| 118-137 | `createPlayerContext()` | Factory for MPRIS player + zone binding |
| 140-144 | `destroyPlayerContext()` | Cleanup via `player._bus.disconnect()` |
| 161-227 | `core_paired` | Zone subscription and `--pause-all` handling |
| 229-240 | `core_unpaired` | Cleanup all players on disconnect |

### Event Flow

**Roon → MPRIS (zone state sync):**
```
subscribe_zones callback:
  data.zones / data.zones_added    → createPlayerContext() for new zones
  data.zones_changed               → updatePlayerFromZone() for existing
  data.zones_removed               → destroyPlayerContext() and Map.delete()
  data.zones_seek_changed          → Update player.position
```

**MPRIS → Roon (media commands):**
```
player.on('playpause'|'stop'|'next'|'previous'):
  → Look up zone from zonePlayerMap by zone_id
  → Call core.services.RoonApiTransport.control(zone, command)
```

### D-Bus Naming

Zone names are sanitized for D-Bus compatibility:
- `Living Room` → `org.mpris.MediaPlayer2.roon_Living_Room`
- `2nd Floor` → `org.mpris.MediaPlayer2.roon_zone_2nd_Floor` (prefixed because starts with digit)

### Configuration

- Default config location: `~/.config/roon-mpris/`
- Stores Roon pairing token (zone selection no longer needed)
- Settings UI in Roon shows informational label only

## Dependencies

- **node-roon-api** / **node-roon-api-transport** / **node-roon-api-settings**: Roon's official Node.js SDK
- **mpris-service**: D-Bus MPRIS interface implementation (uses dbus-next internally)
- **yargs**: CLI argument parsing

## Known Issues / Notes

- **Roon discovery**: Uses UDP multicast; blocked on some networks. Use `--host` for direct connection.
- **Player destruction**: Uses internal `player._bus.disconnect()` since mpris-service lacks public destroy method.
- **canPlay commented out** (line 77): Setting to false hides Ubuntu's dock widget during playback.
