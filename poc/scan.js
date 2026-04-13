/**
 * BLE Scanner - Discovers FITFIU/FITHOME treadmills
 * Identifies whether the treadmill supports FitShow protocol, FTMS, or both.
 */
import noble from "@abandonware/noble";

const KNOWN_PREFIXES = ["FS-", "FIT-", "BF70", "WINFITA", "LJJ"];
const FITSHOW_SERVICE = "fff0";
const FTMS_SERVICE = "1826";

console.log("Scanning for BLE treadmills... (press Ctrl+C to stop)\n");

noble.on("stateChange", (state) => {
  if (state === "poweredOn") {
    noble.startScanning([], true); // scan all services, allow duplicates
  } else {
    noble.stopScanning();
    console.log(`Bluetooth state: ${state}`);
  }
});

const seen = new Set();

noble.on("discover", (peripheral) => {
  const name = peripheral.advertisement.localName || "";
  const id = peripheral.id;

  if (seen.has(id)) return;

  const serviceUuids = peripheral.advertisement.serviceUuids || [];
  const isFitShow = serviceUuids.some((u) => u.toLowerCase().includes(FITSHOW_SERVICE));
  const isFTMS = serviceUuids.some((u) => u.toLowerCase().includes(FTMS_SERVICE));
  const nameMatch = KNOWN_PREFIXES.some((p) => name.startsWith(p));

  if (!nameMatch && !isFitShow && !isFTMS) return;

  seen.add(id);

  const protocols = [];
  if (isFitShow) protocols.push("FitShow (0xFFF0)");
  if (isFTMS) protocols.push("FTMS (0x1826)");

  console.log("=== TREADMILL FOUND ===");
  console.log(`  Name:      ${name || "(unnamed)"}`);
  console.log(`  ID:        ${id}`);
  console.log(`  RSSI:      ${peripheral.rssi} dBm`);
  console.log(`  Services:  ${serviceUuids.join(", ") || "(none advertised)"}`);
  console.log(`  Protocols: ${protocols.length ? protocols.join(", ") : "Unknown (matched by name)"}`);
  console.log();
});

// Auto-stop after 15 seconds
setTimeout(() => {
  noble.stopScanning();
  console.log("Scan complete.");
  if (seen.size === 0) {
    console.log("No treadmills found. Make sure your treadmill is powered on and in pairing mode.");
  }
  process.exit(0);
}, 15000);
