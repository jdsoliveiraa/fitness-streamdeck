/**
 * Debug script - connect and dump all services & characteristics
 */
import noble from "@abandonware/noble";

const KNOWN_PREFIXES = ["FS-", "FIT-", "BF70", "WINFITA", "LJJ"];
const FITSHOW_SERVICE = "fff0";

function findTreadmill() {
  return new Promise((resolve, reject) => {
    console.log("Scanning...");
    const timeout = setTimeout(() => {
      noble.stopScanning();
      reject(new Error("No treadmill found"));
    }, 15000);

    noble.on("discover", (peripheral) => {
      const name = peripheral.advertisement.localName || "";
      const serviceUuids = peripheral.advertisement.serviceUuids || [];
      const isFitShow = serviceUuids.some((u) => u.toLowerCase().includes(FITSHOW_SERVICE));
      const nameMatch = KNOWN_PREFIXES.some((p) => name.startsWith(p));
      if (nameMatch || isFitShow) {
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

async function main() {
  const peripheral = await findTreadmill();
  console.log(`Found: ${peripheral.advertisement.localName} (${peripheral.id})`);
  console.log(`Advertised services: ${peripheral.advertisement.serviceUuids}\n`);

  await peripheral.connectAsync();
  console.log("Connected. Discovering ALL services and characteristics...\n");

  const { services, characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();

  for (const svc of services) {
    console.log(`SERVICE: ${svc.uuid}`);
    const svcChars = characteristics.filter((c) => c._serviceUuid === svc.uuid);
    for (const ch of svcChars) {
      console.log(`  CHAR: ${ch.uuid}  props: ${ch.properties.join(", ")}`);
    }
    console.log();
  }

  await peripheral.disconnectAsync();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
