# FitDeck

Stream Deck plugin to control a FITFIU treadmill via Bluetooth Low Energy.

Built for [Stream Deck Plus](https://www.elgato.com/stream-deck-plus) (keys + dials), but the key-based actions work on any Stream Deck model. macOS only.

## Features

**Keys**
- Start / Stop treadmill
- Speed Up / Speed Down (configurable step size)
- Status Display with live metrics (speed, distance, time, calories)
- Workout key with progress tracking

**Dials (Stream Deck Plus)**
- Speed Dial — rotate to adjust speed, push to start/stop, touch display shows live stats with auto-focus on speed changes
- Workout Dial — browse and start workout plans, track progress with live bar
- Goal Mode — set a distance, time, or calorie target directly from the dial and track progress without a preset speed

**Workouts**
- Predefined plans (Quick Walk, Brisk Walk, Fat Burn, 5K Run, 100 Cal Burn)
- Custom plans via the property inspector (goal type, target, speed, incline)
- Goal-only mode: set a target, auto-start the treadmill, control speed manually
- Auto-stop when the goal is reached, with a completion summary screen

## Requirements

- macOS 10.15+
- Stream Deck 6.9+ with [Stream Deck SDK](https://developer.elgato.com/documentation/stream-deck/)
- Node.js 20
- A BLE treadmill using the FitShow protocol (service UUID `fff0`)
  - Tested with FITFIU MC-200

## Installation

```bash
git clone https://github.com/jdsoliveiraa/fitness-streamdeck.git
cd fitness-streamdeck
npm install
npm run build
streamdeck link com.jdsoliveiraa.fitdeck.sdPlugin
```

Then restart Stream Deck. The plugin appears under the **FitDeck** category.

## Architecture

```
Stream Deck app
    |
    v
SD Plugin (Node.js)  <-- keys/dials/actions
    |
    | Unix socket (/tmp/fitdeck-ble.sock)
    | JSON lines protocol
    v
BLE Helper (.app bundle)  <-- has Bluetooth TCC permission
    |
    | @abandonware/noble
    v
Treadmill (BLE, FitShow protocol)
```

The BLE helper runs as a separate macOS `.app` bundle because Stream Deck plugins don't get Bluetooth permission through TCC. The helper is generated at build time by a Rollup plugin and communicates with the main plugin over a Unix socket using newline-delimited JSON.

## Development

```bash
npm run dev      # link + watch mode with auto-restart
npm run build    # one-shot build
npm run watch    # watch without linking
```

### Project structure

```
src/
  actions/         # Stream Deck action handlers (keys + dials)
  services/        # TreadmillService (IPC client), WorkoutManager
  util/            # SVG renderers for dial touch displays and key images
  types.ts         # Shared type definitions
  plugin.ts        # Entry point

com.jdsoliveiraa.fitdeck.sdPlugin/
  ble-helper/      # BLE helper source (ble-server.mjs) + generated .app
  layouts/         # Touch display layout definitions
  ui/              # Property inspector HTML
  imgs/            # Action and plugin icons
  manifest.json    # Stream Deck plugin manifest
```

## License

[MIT](LICENSE)
