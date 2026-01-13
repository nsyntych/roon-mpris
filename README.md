# Roon MPRIS Multi-Zone Bridge

Control [Roon](https://roonlabs.com/) from your Linux desktop using standard media keys. This extension exposes **all Roon zones** as individual MPRIS players on D-Bus, allowing you to control each zone independently.

Based on [brucejcooper/roon-mpris](https://github.com/brucejcooper/roon-mpris), extended with multi-zone support.

## Features

- **Multi-zone support**: Each Roon zone gets its own MPRIS player
- **Dynamic zones**: Players are created/destroyed as zones appear/disappear
- **Seeking**: Jump to any position in a track via playerctl or media controls
- **Pause all**: `--pause-all` flag to pause all zones at once
- **Standard media keys**: Play, Pause, Stop, Next, Previous
- **playerctl compatible**: Control zones via `playerctl -p roon_<ZoneName>`

## Installation

```bash
npm install -g github:godlyfast/roon-mpris
```

## Usage

```bash
# Start the bridge (autodiscovery)
roon-mpris

# Connect directly to Roon Core (if autodiscovery fails)
roon-mpris --host 192.168.1.100

# Pause all zones and exit
roon-mpris --pause-all

# Debug mode
roon-mpris --log all
```

### First Run

1. Start `roon-mpris`
2. In Roon app: **Settings → Extensions**
3. Find **"Roon MPRIS Multi-Zone Bridge"** by Tymur Smyr
4. Click **Enable**

### Controlling Zones

Each zone appears as a separate MPRIS player:

```bash
# List all Roon players
playerctl -l | grep roon

# Control specific zone
playerctl -p roon_Living_Room play
playerctl -p roon_Office next
playerctl -p roon_Bedroom pause

# Or use media keys - they control the most recently active player
```

### Seeking

Jump to any position in the currently playing track:

```bash
# Seek forward 30 seconds
playerctl -p roon_Living_Room position 30+

# Seek backward 10 seconds
playerctl -p roon_Living_Room position 10-

# Jump to specific position (2 minutes)
playerctl -p roon_Living_Room position 120

# Get current position
playerctl -p roon_Living_Room position
```

## Options

```
-h, --host       Connect directly to Roon Core IP
-p, --port       Port for direct connection (default: 9100)
-P, --pause-all  Pause all zones and exit
-d, --debug      Debug mode - dump full zone objects to discover API fields
-l, --log        Logging level (none, all)
-c, --config     Config directory (default: ~/.config/roon-mpris)
```

## Troubleshooting

**Autodiscovery not working?**
- Roon uses UDP multicast which may be blocked on some networks
- Use `--host <IP>` to connect directly to your Roon Core
- Find Core IP in Roon app: Settings → About

**Extension not appearing in Roon?**
- Ensure the bridge is running and connected
- Check terminal output for "Creating MPRIS player for zone:"
- Try restarting both the bridge and Roon

## Credits

- Original [roon-mpris](https://github.com/brucejcooper/roon-mpris) by Bruce Cooper
- [Roon API](https://github.com/RoonLabs/node-roon-api)
- [mpris-service](https://github.com/dbusjs/mpris-service)

## License

Apache-2.0
