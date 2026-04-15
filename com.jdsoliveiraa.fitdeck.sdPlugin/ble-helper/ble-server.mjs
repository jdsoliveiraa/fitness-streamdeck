/**
 * FitDeck BLE Helper — runs as a separate .app with Bluetooth permission.
 * Communicates with the SD plugin via a Unix socket using JSON lines.
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const PLUGIN_DIR = process.argv[2] || process.cwd();
const SOCKET_PATH = "/tmp/fitdeck-ble.sock";
const LOG_DIR = path.join(PLUGIN_DIR, "logs");
const LOG_PATH = path.join(LOG_DIR, "ble-helper.log");
const LOG_PREV_PATH = path.join(LOG_DIR, "ble-helper.prev.log");
const LOG_MAX_BYTES = 1024 * 1024; // 1 MB

// Rotate log on startup if too large
try {
	const stat = fs.statSync(LOG_PATH);
	if (stat.size > LOG_MAX_BYTES) {
		fs.renameSync(LOG_PATH, LOG_PREV_PATH);
	}
} catch { /* file doesn't exist yet, that's fine */ }

// File-based logging (stdout is lost when launched via `open`)
function log(...args) {
	const ts = new Date().toISOString();
	const msg = `[${ts}] ${args.join(" ")}\n`;
	fs.appendFileSync(LOG_PATH, msg);
}
function logError(...args) {
	log("[ERROR]", ...args);
}

// Load noble from the plugin's node_modules
const require = createRequire(PLUGIN_DIR + "/package.json");
const noble = require("@abandonware/noble");

// --- FitShow Protocol Constants ---
const SERVICE_UUID = "fff0";
const WRITE_CHAR_UUID = "fff2";
const NOTIFY_CHAR_UUID = "fff1";
const ALT_SERVICE_UUID = "ffe0";
const ALT_WRITE_CHAR_UUID = "ffe1";
const ALT_NOTIFY_CHAR_UUID = "ffe4";

const SYS_INFO = 0x50;
const SYS_STATUS = 0x51;
const SYS_CONTROL = 0x53;
const CTRL_USER = 0x00;
const CTRL_START = 0x01;
const CTRL_SET_TARGET = 0x02;
const CTRL_STOP = 0x03;
const CTRL_PAUSE = 0x06;

const STATUS_NAMES = {
	0: "IDLE", 1: "END", 2: "STARTING", 3: "RUNNING",
	4: "STOPPED", 5: "ERROR", 6: "SAFETY_STOP", 7: "STUDY", 10: "PAUSED",
};

const KNOWN_PREFIXES = ["FS-", "FIT-", "BF70", "WINFITA", "LJJ"];
const FITSHOW_SERVICE = "fff0";
const SCAN_TIMEOUT_MS = 15000;
const CONNECT_TIMEOUT_MS = 15000;
const RECONNECT_DELAY_MS = 3000;
const POLL_INTERVAL_MS = 500;

// --- State ---
let peripheral = null;
let writeChar = null;
let notifyChar = null;
let pollInterval = null;
let reconnectTimer = null;
let scanning = false;
let connectionState = "disconnected";
let lastStatus = null;
let deviceInfo = { maxSpeed: 14, minSpeed: 1, maxIncline: 0, minIncline: 0 };

const clients = new Set();

// --- Packet Helpers ---
function buildPacket(payload) {
	let xor = 0;
	for (const b of payload) xor ^= b;
	return Buffer.from([0x02, ...payload, xor, 0x03]);
}

function parseStatusPacket(data) {
	if (data[0] !== 0x02 || data[data.length - 1] !== 0x03) return null;
	const payload = data.slice(1, data.length - 2);
	if (payload[0] !== SYS_STATUS || payload.length < 2) return null;
	const statusCode = payload[1];
	const result = {
		status: STATUS_NAMES[statusCode] || `UNKNOWN(${statusCode})`,
		statusCode, speed: 0, incline: 0, elapsedSeconds: 0,
		distance: 0, calories: 0, steps: 0, heartRate: 0,
	};
	if (payload.length >= 13) {
		result.speed = payload[2] / 10;
		result.incline = payload[3];
		result.elapsedSeconds = payload[4] | (payload[5] << 8);
		result.distance = (payload[6] | (payload[7] << 8)) / 1000;
		result.calories = (payload[8] | (payload[9] << 8)) / 10;
		result.steps = payload[10] | (payload[11] << 8);
		result.heartRate = payload[12];
	}
	return result;
}

function parseInfoPacket(data) {
	if (data[0] !== 0x02 || data[data.length - 1] !== 0x03) return null;
	const payload = data.slice(1, data.length - 2);
	if (payload[0] !== SYS_INFO) return null;
	const subCmd = payload[1];
	switch (subCmd) {
		case 0x02: return { type: "speed_range", maxSpeed: payload[2] / 10, minSpeed: payload[3] / 10 };
		case 0x03: return { type: "incline_range", maxIncline: payload[2], minIncline: payload[3] };
		default: return null;
	}
}

// --- Broadcast to all connected plugin clients ---
function broadcast(event, data) {
	const msg = JSON.stringify({ event, data }) + "\n";
	for (const client of clients) {
		try { client.write(msg); } catch { /* ignore dead clients */ }
	}
}

function setConnectionState(state) {
	log("State:", connectionState, "->", state);
	connectionState = state;
	broadcast("connection-change", { state });
}

// --- BLE Operations ---
let writeWithoutResponse = false; // Default to Write With Response (matching POC)

async function bleWrite(payload) {
	if (!writeChar) return;
	const packet = buildPacket(payload);
	await writeChar.writeAsync(packet, writeWithoutResponse);
}

function onData(data) {
	const status = parseStatusPacket(data);
	if (status) {
		lastStatus = status;
		broadcast("status", status);
		return;
	}
	const info = parseInfoPacket(data);
	if (info) {
		if (info.type === "speed_range") {
			deviceInfo.maxSpeed = info.maxSpeed;
			deviceInfo.minSpeed = info.minSpeed;
		}
		if (info.type === "incline_range") {
			deviceInfo.maxIncline = info.maxIncline;
			deviceInfo.minIncline = info.minIncline;
		}
		broadcast("info", info);
	}
}

async function scan() {
	if (scanning) { log("scan() skipped — already scanning"); return; }
	if (connectionState === "connected") { log("scan() skipped — already connected"); return; }
	log("Starting BLE scan...");
	scanning = true;
	setConnectionState("scanning");

	try {
		const found = await findTreadmill();
		log("Found treadmill:", found.advertisement.localName || found.uuid);
		await connectToPeripheral(found);
	} catch (err) {
		logError("Scan error:", err.message);
		scanning = false;
		setConnectionState("disconnected");
		scheduleReconnect();
	}
}

function findTreadmill() {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			noble.stopScanning();
			noble.removeListener("discover", onDiscover);
			reject(new Error("No treadmill found"));
		}, SCAN_TIMEOUT_MS);

		const onDiscover = (p) => {
			const name = p.advertisement.localName || "";
			const serviceUuids = p.advertisement.serviceUuids || [];
			const isFitShow = serviceUuids.some((u) => u.toLowerCase().includes(FITSHOW_SERVICE));
			const nameMatch = KNOWN_PREFIXES.some((pfx) => name.startsWith(pfx));
			if (nameMatch || isFitShow) {
				clearTimeout(timeout);
				noble.stopScanning();
				noble.removeListener("discover", onDiscover);
				resolve(p);
			}
		};

		noble.on("discover", onDiscover);
		const startScan = () => noble.startScanning([], false);
		if (noble.state === "poweredOn") {
			startScan();
		} else {
			const btTimeout = setTimeout(() => {
				noble.removeListener("stateChange", onState);
				reject(new Error("Bluetooth not available (timeout)"));
			}, 10000);
			const onState = (state) => {
				if (state === "poweredOn") {
					clearTimeout(btTimeout);
					noble.removeListener("stateChange", onState);
					startScan();
				}
			};
			noble.on("stateChange", onState);
		}
	});
}

async function connectToPeripheral(p) {
	setConnectionState("connecting");
	let connectTimer;
	await Promise.race([
		p.connectAsync().then((v) => { clearTimeout(connectTimer); return v; }),
		new Promise((_, reject) => {
			connectTimer = setTimeout(() => {
				p.disconnectAsync().catch(() => {});
				reject(new Error("Connect timeout"));
			}, CONNECT_TIMEOUT_MS);
		}),
	]);
	peripheral = p;

	const { characteristics } = await p.discoverAllServicesAndCharacteristicsAsync();
	writeChar =
		characteristics.find((c) => c.uuid === WRITE_CHAR_UUID) ||
		characteristics.find((c) => c.uuid === ALT_WRITE_CHAR_UUID) || null;
	notifyChar =
		characteristics.find((c) => c.uuid === NOTIFY_CHAR_UUID) ||
		characteristics.find((c) => c.uuid === ALT_NOTIFY_CHAR_UUID) || null;

	if (!writeChar || !notifyChar) {
		await p.disconnectAsync();
		throw new Error("FitShow characteristics not found");
	}

	log("Write char:", writeChar.uuid, "properties:", JSON.stringify(writeChar.properties));
	log("Notify char:", notifyChar.uuid, "properties:", JSON.stringify(notifyChar.properties));

	// Auto-detect write mode from characteristic properties
	if (writeChar.properties.includes("writeWithoutResponse")) {
		writeWithoutResponse = true;
	} else if (writeChar.properties.includes("write")) {
		writeWithoutResponse = false;
	}
	log("Using writeWithoutResponse:", writeWithoutResponse);

	notifyChar.on("data", (data) => onData(data));
	await notifyChar.subscribeAsync();

	// Send user data
	await bleWrite([SYS_CONTROL, CTRL_USER, 0xaa, 0x13, 110, 30, 75, 170]);
	// Query info
	const now = new Date();
	await bleWrite([SYS_INFO, 0x00, now.getFullYear() - 2000, now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]);
	await bleWrite([SYS_INFO, 0x02]);
	await bleWrite([SYS_INFO, 0x03]);

	let pollErrorCount = 0;
	pollInterval = setInterval(async () => {
		try {
			await bleWrite([SYS_STATUS]);
			pollErrorCount = 0;
		} catch (err) {
			pollErrorCount++;
			if (pollErrorCount <= 3) logError("Poll write failed:", err.message);
		}
	}, POLL_INTERVAL_MS);

	p.once("disconnect", () => {
		log("Peripheral disconnected");
		stopPolling();
		peripheral = null;
		writeChar = null;
		notifyChar = null;
		scanning = false;
		setConnectionState("disconnected");
		scheduleReconnect();
	});

	scanning = false;
	// Cancel any pending reconnect timer — we're already connected
	if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
	setConnectionState("connected");
	log("Connected — polling started");
	broadcast("device-info", deviceInfo);
}

function scheduleReconnect() {
	if (reconnectTimer) { log("Reconnect already scheduled"); return; }
	log(`Scheduling reconnect in ${RECONNECT_DELAY_MS}ms`);
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		scan();
	}, RECONNECT_DELAY_MS);
}

function stopPolling() {
	if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// --- Command Handlers ---
async function handleCommand(cmd) {
	switch (cmd.method) {
		case "scan":
			scan();
			return { ok: true };
		case "getState":
			return { connectionState, lastStatus, deviceInfo };
		case "start":
			await bleWrite([SYS_CONTROL, CTRL_START, 0x00, 0x00, 0x00, 0x00, cmd.mode || 0, 0x00, 0x00, 0x00]);
			return { ok: true };
		case "stop":
			await bleWrite([SYS_CONTROL, CTRL_STOP]);
			return { ok: true };
		case "pause":
			await bleWrite([SYS_CONTROL, CTRL_PAUSE]);
			return { ok: true };
		case "setSpeed": {
			const speedByte = Math.round((cmd.speed || 0) * 10);
			await bleWrite([SYS_CONTROL, CTRL_SET_TARGET, speedByte, 0x00]);
			return { ok: true };
		}
		case "setSpeedAndIncline": {
			const speedByte = Math.round((cmd.speed || 0) * 10);
			await bleWrite([SYS_CONTROL, CTRL_SET_TARGET, speedByte, cmd.incline || 0]);
			return { ok: true };
		}
		case "disconnect":
			if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
			stopPolling();
			if (peripheral) { try { await peripheral.disconnectAsync(); } catch {} }
			return { ok: true };
		case "quit":
			process.exit(0);
		default:
			return { error: `Unknown command: ${cmd.method}` };
	}
}

// --- Socket Server ---
try { fs.unlinkSync(SOCKET_PATH); } catch {}

const server = net.createServer((socket) => {
	clients.add(socket);
	log("Client connected");

	// Send current state on connect
	socket.write(JSON.stringify({ event: "connection-change", data: { state: connectionState } }) + "\n");
	if (lastStatus) {
		socket.write(JSON.stringify({ event: "status", data: lastStatus }) + "\n");
	}
	socket.write(JSON.stringify({ event: "device-info", data: deviceInfo }) + "\n");

	let buffer = "";
	socket.on("data", (chunk) => {
		buffer += chunk.toString();
		let idx;
		while ((idx = buffer.indexOf("\n")) !== -1) {
			const line = buffer.substring(0, idx).trim();
			buffer = buffer.substring(idx + 1);
			if (!line) continue;
			try {
				const cmd = JSON.parse(line);
				handleCommand(cmd).then((result) => {
					if (cmd.id !== undefined) {
						socket.write(JSON.stringify({ id: cmd.id, result }) + "\n");
					}
				}).catch((err) => {
					if (cmd.id !== undefined) {
						socket.write(JSON.stringify({ id: cmd.id, error: err.message }) + "\n");
					}
				});
			} catch (err) {
				logError("Bad message:", line);
			}
		}
	});

	socket.on("close", () => {
		clients.delete(socket);
		log("Client disconnected");
	});
	socket.on("error", () => {
		clients.delete(socket);
	});
});

server.listen(SOCKET_PATH, () => {
	log(`Listening on ${SOCKET_PATH}`);
});

// Handle Bluetooth adapter state changes (sleep/wake cycles cause poweredOff -> poweredOn)
noble.on("stateChange", (state) => {
	log("Bluetooth adapter state:", state);
	if (state === "poweredOff") {
		// Adapter went down — tear down stale connection
		stopPolling();
		if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
		if (peripheral) {
			try { peripheral.disconnectAsync(); } catch {}
			peripheral = null;
		}
		writeChar = null;
		notifyChar = null;
		scanning = false;
		setConnectionState("disconnected");
		log("Cleaned up stale connection after adapter power-off");
	} else if (state === "poweredOn") {
		// Adapter back — auto-scan if not already connected
		if (connectionState !== "connected") {
			log("Adapter powered on — starting scan");
			scan();
		}
	}
});

// Keep alive
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("exit", () => {
	log("Process exiting");
	try { fs.unlinkSync(SOCKET_PATH); } catch {}
});
