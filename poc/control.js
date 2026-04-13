/**
 * CLI controller for FITFIU treadmill
 *
 * Usage:
 *   node control.js interactive              # interactive keyboard control
 *   node control.js start                    # start treadmill
 *   node control.js stop                     # stop treadmill
 *   node control.js pause                    # pause treadmill
 *   node control.js set-speed <km/h>         # set speed (e.g. 4.5)
 *   node control.js set-incline <% >         # set incline (e.g. 3)
 *   node control.js status                   # print current status and exit
 *   node control.js device-info               # print device info (model, speed range, etc.)
 *   node control.js goal <type> <value>      # goal workout: type=calories|distance|time
 *                                            #   e.g. goal calories 50
 *                                            #        goal distance 2    (km)
 *                                            #        goal time 30       (minutes)
 *
 *   --speed <km/h>                           # speed for goal workout (default: 4.0)
 *   --device <id>                            # connect to specific device ID
 */
import noble from "@abandonware/noble";
import readline from "readline";
import { FitShowTreadmill } from "./fitshow.js";

const KNOWN_PREFIXES = ["FS-", "FIT-", "BF70", "WINFITA", "LJJ"];
const FITSHOW_SERVICE = "fff0";

// Parse args
const args = process.argv.slice(2);
const deviceIdx = args.indexOf("--device");
const deviceId = deviceIdx !== -1 ? args.splice(deviceIdx, 2)[1] : null;
const speedIdx = args.indexOf("--speed");
const goalSpeed = speedIdx !== -1 ? parseFloat(args.splice(speedIdx, 2)[1]) : 4.0;
const command = args[0] || "status";
const commandArg = args[1];
const commandArg2 = args[2];

let treadmill = null;

function findTreadmill() {
  return new Promise((resolve, reject) => {
    console.log("Scanning for treadmills...");
    const timeout = setTimeout(() => {
      noble.stopScanning();
      reject(new Error("No treadmill found. Run 'npm run scan' first to check."));
    }, 15000);

    noble.on("discover", (peripheral) => {
      const name = peripheral.advertisement.localName || "";
      const serviceUuids = peripheral.advertisement.serviceUuids || [];
      const isFitShow = serviceUuids.some((u) => u.toLowerCase().includes(FITSHOW_SERVICE));
      const nameMatch = KNOWN_PREFIXES.some((p) => name.startsWith(p));

      if (deviceId && peripheral.id === deviceId) {
        clearTimeout(timeout);
        noble.stopScanning();
        resolve(peripheral);
      } else if (!deviceId && (nameMatch || isFitShow)) {
        clearTimeout(timeout);
        noble.stopScanning();
        resolve(peripheral);
      }
    });

    noble.on("stateChange", (state) => {
      if (state === "poweredOn") noble.startScanning([], false);
    });
    if (noble.state === "poweredOn") noble.startScanning([], false);
  });
}

async function connectTreadmill() {
  const peripheral = await findTreadmill();
  console.log(`Found: ${peripheral.advertisement.localName || peripheral.id}`);
  treadmill = new FitShowTreadmill();
  await treadmill.connect(peripheral);
  return treadmill;
}

function waitForStatus(tm) {
  return new Promise((resolve) => {
    tm.once("status", resolve);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- One-shot commands ---

async function runCommand() {
  const tm = await connectTreadmill();

  switch (command) {
    case "start": {
      await tm.start();
      console.log("Started.");
      break;
    }
    case "stop": {
      await tm.stop();
      console.log("Stopped.");
      break;
    }
    case "pause": {
      await tm.pause();
      console.log("Paused.");
      break;
    }
    case "set-speed": {
      const speed = parseFloat(commandArg);
      if (isNaN(speed) || speed < 0 || speed > 20) {
        console.error("Usage: node control.js set-speed <km/h>  (e.g. 4.5)");
        break;
      }
      // Wait for first status to confirm connection is established
      await waitForStatus(tm);
      await tm.setSpeed(speed);
      console.log(`Speed set to ${speed} km/h.`);
      // Wait a bit for treadmill to acknowledge
      await sleep(2000);
      const status = await waitForStatus(tm);
      console.log(`Confirmed speed: ${status.speed} km/h`);
      break;
    }
    case "set-incline": {
      const incline = parseInt(commandArg);
      if (isNaN(incline) || incline < 0 || incline > 15) {
        console.error("Usage: node control.js set-incline <%>  (e.g. 3)");
        break;
      }
      const status = await waitForStatus(tm);
      const currentSpeed = status.speed || 4;
      await tm.setSpeedAndIncline(currentSpeed, incline);
      console.log(`Incline set to ${incline}%.`);
      break;
    }
    case "status": {
      const status = await waitForStatus(tm);
      console.log(JSON.stringify(status, null, 2));
      break;
    }
    case "device-info": {
      // Read BLE device info (180a)
      const bleInfo = await tm.readBleDeviceInfo();

      // Query FitShow info and collect responses
      const infoResults = {};
      const infoHandler = (info) => { infoResults[info.type] = info; };
      tm.on("info", infoHandler);

      await tm.querySpeedRange();
      await tm.queryInclineRange();
      await tm.queryTotalUsage();
      await tm.queryModel();
      await sleep(2000);
      tm.off("info", infoHandler);

      console.log(JSON.stringify({ ble: bleInfo, fitshow: infoResults }, null, 2));
      break;
    }
    case "goal": {
      const goalType = commandArg;
      const goalValue = parseFloat(commandArg2);
      if (!["calories", "distance", "time"].includes(goalType) || isNaN(goalValue) || goalValue <= 0) {
        console.error("Usage: node control.js goal <calories|distance|time> <value> [--speed <km/h>]");
        console.error("  e.g. goal calories 50");
        console.error("       goal distance 2       (km)");
        console.error("       goal time 30          (minutes)");
        break;
      }
      await runGoalWorkout(tm, goalType, goalValue, goalSpeed);
      return;
    }
    case "interactive": {
      await runInteractive(tm);
      return; // don't disconnect, interactive handles its own lifecycle
    }
    default: {
      console.error(`Unknown command: ${command}`);
      console.error("Commands: interactive, start, stop, pause, set-speed, set-incline, status, device-info, goal");
    }
  }

  // One-shot: disconnect and exit
  await tm.disconnect();
  process.exit(0);
}

// --- Goal workout ---

async function runGoalWorkout(tm, goalType, goalValue, speed) {
  const units = { calories: "cal", distance: "km", time: "min" };
  const label = `${goalValue} ${units[goalType]}`;

  // Capture starting values from first status
  const initial = await waitForStatus(tm);
  const startCalories = initial.calories ?? 0;
  const startDistance = initial.distance ?? 0;
  const startSeconds = initial.elapsedSeconds ?? 0;

  console.log(`\n  Goal: ${label} at ${speed} km/h`);
  console.log(`  Press Ctrl+C to abort\n`);

  // Start treadmill if not running, wait until it's in RUNNING state
  if (initial.statusCode !== 3) {
    await tm.start();
    // Wait for RUNNING status (treadmill has a startup countdown)
    await new Promise((resolve) => {
      const handler = (status) => {
        if (status.statusCode === 3) {
          tm.off("status", handler);
          resolve();
        }
      };
      tm.on("status", handler);
    });
    await sleep(500);
  }
  await tm.setSpeed(speed);
  await sleep(1000);
  await tm.setSpeed(speed); // send again to be sure

  // Listen for Ctrl+C
  let aborted = false;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", async (data) => {
    if (data[0] === 3) { // Ctrl+C
      aborted = true;
    }
  });

  // Track last good values before treadmill resets counters on stop
  let lastSessionCal = 0;
  let lastSessionDist = 0;
  let lastSessionSec = 0;

  const targetSeconds = Math.round(goalValue * 60);

  await new Promise((resolve) => {
    let resolved = false;
    tm.on("status", async (status) => {
      if (resolved) return;
      if (aborted) { resolved = true; resolve(); return; }

      // Skip status updates after treadmill resets (statusCode !== RUNNING)
      if (status.statusCode !== 3) return;

      const sessionCal = (status.calories ?? 0) - startCalories;
      const sessionDist = (status.distance ?? 0) - startDistance;
      const sessionSec = (status.elapsedSeconds ?? 0) - startSeconds;

      // Track last good values
      lastSessionCal = sessionCal;
      lastSessionDist = sessionDist;
      lastSessionSec = sessionSec;

      let current, target, progressLabel;
      switch (goalType) {
        case "calories":
          current = sessionCal;
          target = goalValue;
          progressLabel = `${current.toFixed(1)} / ${target} cal`;
          break;
        case "distance":
          current = sessionDist;
          target = goalValue;
          progressLabel = `${current.toFixed(3)} / ${target} km`;
          break;
        case "time":
          current = sessionSec;
          target = targetSeconds;
          progressLabel = `${formatTime(sessionSec)} / ${formatTime(targetSeconds)}`;
          break;
      }
      const pct = Math.min((current / target) * 100, 100);

      // Progress bar
      const barLen = 20;
      const filled = Math.round((pct / 100) * barLen);
      const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

      process.stdout.write(
        `\r  ${bar} ${pct.toFixed(1).padStart(5)}%  ${progressLabel}` +
        `  |  ${status.speed?.toFixed(1)} km/h` +
        `  ${sessionDist.toFixed(3)} km  ${sessionCal.toFixed(1)} cal   `
      );

      if (current >= target) {
        resolved = true;
        resolve();
      }
    });
  });

  // Goal reached or aborted — stop treadmill
  await tm.stop();

  console.log(`\n\n  ${aborted ? "ABORTED" : "GOAL REACHED!"}`);
  console.log(`  ─────────────────────────`);
  console.log(`  Time:     ${formatTime(lastSessionSec)}`);
  console.log(`  Distance: ${lastSessionDist.toFixed(3)} km`);
  console.log(`  Calories: ${lastSessionCal.toFixed(1)}`);
  console.log(`  Avg Speed: ${speed} km/h`);
  console.log();

  await tm.disconnect();
  process.exit(0);
}

// --- Interactive mode ---

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function printStatus(status) {
  process.stdout.write(
    `\r  [${status.status.padEnd(10)}] ` +
    `Speed: ${status.speed?.toFixed(1) ?? "?"} km/h | ` +
    `Incline: ${status.incline ?? 0}% | ` +
    `Time: ${formatTime(status.elapsedSeconds ?? 0)} | ` +
    `Dist: ${status.distance?.toFixed(3) ?? "0"} km | ` +
    `Cal: ${status.calories?.toFixed(1) ?? "0"} | ` +
    `HR: ${status.heartRate ?? 0}   `
  );
}

async function runInteractive(tm) {
  let currentSpeed = 0;

  tm.on("status", (status) => {
    if (status.speed !== undefined) currentSpeed = status.speed;
    printStatus(status);
  });

  tm.on("disconnect", () => {
    console.log("\nTreadmill disconnected.");
    process.exit(0);
  });

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  console.log("\nControls: [s]tart [x]stop [p]ause [+/-]speed [1-9]speed [q]uit\n");

  process.stdin.on("keypress", async (str, key) => {
    if (key.ctrl && key.name === "c") {
      await shutdown();
      return;
    }

    switch (key.name || str) {
      case "s":
        await tm.start();
        break;
      case "x":
        await tm.stop();
        currentSpeed = 0;
        break;
      case "p":
        await tm.pause();
        break;
      case "q":
        await shutdown();
        break;
      default:
        if (str === "+") {
          currentSpeed = Math.min(currentSpeed + 0.5, 15);
          await tm.setSpeed(currentSpeed);
        } else if (str === "-") {
          currentSpeed = Math.max(currentSpeed - 0.5, 0.5);
          await tm.setSpeed(currentSpeed);
        } else if (str >= "1" && str <= "9") {
          currentSpeed = parseInt(str);
          await tm.setSpeed(currentSpeed);
        }
        break;
    }
  });
}

async function shutdown() {
  console.log("\nShutting down...");
  if (treadmill) {
    try { await treadmill.stop(); } catch { /* ignore */ }
    await treadmill.disconnect();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);

runCommand().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
