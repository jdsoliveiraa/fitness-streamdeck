/**
 * FitShow Protocol - FITFIU/FITHOME treadmill BLE communication
 *
 * Packet format: [0x02] [payload...] [xor checksum] [0x03]
 * Reference: https://github.com/cagnulein/qdomyos-zwift (fitshowtreadmill)
 */
import noble from "@abandonware/noble";
import { EventEmitter } from "events";

// Service/characteristic UUIDs (most common variant)
const SERVICE_UUID = "fff0";
const WRITE_CHAR_UUID = "fff2";
const NOTIFY_CHAR_UUID = "fff1";

// Alt variant
const ALT_SERVICE_UUID = "ffe0";
const ALT_WRITE_CHAR_UUID = "ffe1";
const ALT_NOTIFY_CHAR_UUID = "ffe4";

// Command system bytes
const SYS_INFO = 0x50;
const SYS_STATUS = 0x51;
const SYS_DATA = 0x52;
const SYS_CONTROL = 0x53;

// Control sub-commands
const CTRL_USER = 0x00;
const CTRL_START = 0x01;
const CTRL_SET_TARGET = 0x02;
const CTRL_STOP = 0x03;
const CTRL_PAUSE = 0x06;

// Status codes
const STATUS = {
  0: "IDLE",
  1: "END",
  2: "STARTING",
  3: "RUNNING",
  4: "STOPPED",
  5: "ERROR",
  6: "SAFETY_STOP",
  7: "STUDY",
  10: "PAUSED",
};

function buildPacket(payload) {
  let xor = 0;
  for (const b of payload) xor ^= b;
  return Buffer.from([0x02, ...payload, xor, 0x03]);
}

function parseStatusPacket(data) {
  // Strip framing: [0x02, ...payload, checksum, 0x03]
  if (data[0] !== 0x02 || data[data.length - 1] !== 0x03) return null;
  const payload = data.slice(1, data.length - 2);

  if (payload[0] !== SYS_STATUS || payload.length < 2) return null;

  const statusCode = payload[1];
  const result = {
    status: STATUS[statusCode] || `UNKNOWN(${statusCode})`,
    statusCode,
  };

  if (payload.length >= 13) {
    result.speed = payload[2] / 10; // km/h
    result.incline = payload[3]; // %
    result.elapsedSeconds = payload[4] | (payload[5] << 8);
    result.distance = (payload[6] | (payload[7] << 8)) / 1000; // km (raw is meters)
    result.calories = (payload[8] | (payload[9] << 8)) / 10;
    result.steps = payload[10] | (payload[11] << 8);
    result.heartRate = payload[12]; // bpm
  }

  return result;
}

function parseInfoPacket(data) {
  if (data[0] !== 0x02 || data[data.length - 1] !== 0x03) return null;
  const payload = data.slice(1, data.length - 2);
  if (payload[0] !== SYS_INFO) return null;

  const subCmd = payload[1];
  switch (subCmd) {
    case 0x00: // Model info
      return {
        type: "model",
        raw: [...payload.slice(2)],
      };
    case 0x02: // Speed range
      return {
        type: "speed_range",
        maxSpeed: payload[2] / 10,
        minSpeed: payload[3] / 10,
        unit: payload[4], // 0=km/h, 1=mph
      };
    case 0x03: // Incline range
      return {
        type: "incline_range",
        maxIncline: payload[2],
        minIncline: payload[3],
      };
    case 0x04: // Total usage
      return {
        type: "total_usage",
        totalDistance: (payload[2] | (payload[3] << 8) | (payload[4] << 16) | (payload[5] << 24)),
        totalTime: (payload[6] | (payload[7] << 8) | (payload[8] << 16) | (payload[9] << 24)),
      };
    default:
      return { type: `info_${subCmd}`, raw: [...payload.slice(2)] };
  }
}

export class FitShowTreadmill extends EventEmitter {
  constructor() {
    super();
    this.peripheral = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.allCharacteristics = null;
    this.pollInterval = null;
    this.lastStatus = null;
    this.deviceInfo = {};
    this.maxSpeed = 12;
    this.minSpeed = 1;
  }

  async connect(peripheralOrId) {
    if (typeof peripheralOrId === "string") {
      // Find by ID
      this.peripheral = await this._scanForId(peripheralOrId);
    } else {
      this.peripheral = peripheralOrId;
    }

    console.log(`Connecting to ${this.peripheral.advertisement.localName || this.peripheral.id}...`);
    await this.peripheral.connectAsync();
    console.log("Connected. Discovering services...");

    const { characteristics } = await this._discoverChars();
    console.log(`Found write char: ${this.writeChar.uuid}, notify char: ${this.notifyChar.uuid}`);

    // Subscribe to notifications
    this.notifyChar.on("data", (data) => this._onData(data));
    await this.notifyChar.subscribeAsync();
    console.log("Subscribed to notifications.");

    // Initialize
    await this._sendUserData();
    await this._queryInfo();

    // Start status polling
    this.pollInterval = setInterval(() => this._pollStatus(), 500);

    this.peripheral.on("disconnect", () => {
      console.log("Disconnected from treadmill.");
      this.stopPolling();
      this.emit("disconnect");
    });

    return this;
  }

  async _scanForId(id) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        noble.stopScanning();
        reject(new Error("Treadmill not found within timeout"));
      }, 10000);

      noble.on("discover", (p) => {
        if (p.id === id) {
          clearTimeout(timeout);
          noble.stopScanning();
          resolve(p);
        }
      });

      noble.startScanning([], false);
    });
  }

  async _discoverChars() {
    const { services, characteristics } = await this.peripheral.discoverAllServicesAndCharacteristicsAsync();

    // Try primary variant first, then alt
    this.writeChar = characteristics.find((c) => c.uuid === WRITE_CHAR_UUID) ||
                     characteristics.find((c) => c.uuid === ALT_WRITE_CHAR_UUID);
    this.notifyChar = characteristics.find((c) => c.uuid === NOTIFY_CHAR_UUID) ||
                      characteristics.find((c) => c.uuid === ALT_NOTIFY_CHAR_UUID);

    if (!this.writeChar || !this.notifyChar) {
      throw new Error("Could not find FitShow characteristics. Services found: " +
        services.map((s) => s.uuid).join(", "));
    }

    this.allCharacteristics = characteristics;
    return { services, characteristics };
  }

  async _write(payload) {
    const packet = buildPacket(payload);
    await this.writeChar.writeAsync(packet, false); // false = withResponse
  }

  _onData(data) {
    const status = parseStatusPacket(data);
    if (status) {
      this.lastStatus = status;
      this.emit("status", status);
      return;
    }
    const info = parseInfoPacket(data);
    if (info) {
      if (info.type === "speed_range") {
        this.maxSpeed = info.maxSpeed;
        this.minSpeed = info.minSpeed;
      }
      this.deviceInfo[info.type] = info;
      this.emit("info", info);
      return;
    }
    this.emit("raw", data);
  }

  async _sendUserData() {
    // Default user: id=0x13AA, maxHR=110, age=30, weight=75kg, height=170cm
    await this._write(Buffer.from([SYS_CONTROL, CTRL_USER, 0xaa, 0x13, 110, 30, 75, 170]));
  }

  async _queryInfo() {
    const now = new Date();
    // Model info with datetime
    await this._write(Buffer.from([
      SYS_INFO, 0x00,
      now.getFullYear() - 2000, now.getMonth() + 1, now.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds(),
    ]));
    // Speed range
    await this._write(Buffer.from([SYS_INFO, 0x02]));
    // Incline range
    await this._write(Buffer.from([SYS_INFO, 0x03]));
  }

  async _pollStatus() {
    try {
      await this._write(Buffer.from([SYS_STATUS]));
    } catch {
      // ignore write errors during polling
    }
  }

  // ---- Public control API ----

  async start(mode = 0) {
    // mode: 0=Normal, 1=Timer, 2=Distance, 3=Calorie
    await this._write(Buffer.from([
      SYS_CONTROL, CTRL_START,
      0x00, 0x00, 0x00, 0x00, // sport_id
      mode,
      0x00, // blocks
      0x00, 0x00, // value
    ]));
    console.log("Start command sent.");
  }

  async setSpeed(speedKmh) {
    const speedByte = Math.round(speedKmh * 10);
    await this._write(Buffer.from([SYS_CONTROL, CTRL_SET_TARGET, speedByte, 0x00]));
  }

  async setSpeedAndIncline(speedKmh, incline) {
    const speedByte = Math.round(speedKmh * 10);
    await this._write(Buffer.from([SYS_CONTROL, CTRL_SET_TARGET, speedByte, incline]));
  }

  async stop() {
    await this._write(Buffer.from([SYS_CONTROL, CTRL_STOP]));
    console.log("Stop command sent.");
  }

  async pause() {
    await this._write(Buffer.from([SYS_CONTROL, CTRL_PAUSE]));
    console.log("Pause command sent.");
  }

  async querySpeedRange() {
    await this._write(Buffer.from([SYS_INFO, 0x02]));
  }

  async queryInclineRange() {
    await this._write(Buffer.from([SYS_INFO, 0x03]));
  }

  async queryTotalUsage() {
    await this._write(Buffer.from([SYS_INFO, 0x04]));
  }

  async queryModel() {
    const now = new Date();
    await this._write(Buffer.from([
      SYS_INFO, 0x00,
      now.getFullYear() - 2000, now.getMonth() + 1, now.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds(),
    ]));
  }

  async readBleDeviceInfo() {
    // Read standard BLE Device Information Service (0x180a) characteristics
    const charMap = {
      "2a29": "manufacturer",
      "2a24": "model",
      "2a27": "hardwareRevision",
      "2a26": "firmwareRevision",
    };
    const result = {};
    for (const ch of this.allCharacteristics) {
      if (charMap[ch.uuid]) {
        try {
          const data = await ch.readAsync();
          result[charMap[ch.uuid]] = data.toString("utf8").trim();
        } catch {
          result[charMap[ch.uuid]] = null;
        }
      }
    }
    return result;
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async disconnect() {
    this.stopPolling();
    if (this.peripheral) {
      await this.peripheral.disconnectAsync();
    }
  }
}
