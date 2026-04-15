/**
 * TreadmillService — IPC client that talks to the BLE helper app.
 *
 * The BLE helper runs as a separate macOS .app bundle with Bluetooth
 * permissions (NSBluetoothAlwaysUsageDescription). Communication is
 * via JSON lines over a Unix socket.
 */
import { EventEmitter } from "events";
import { connect, type Socket } from "node:net";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import streamDeck from "@elgato/streamdeck";
import type { TreadmillStatus, TreadmillDeviceInfo, ConnectionState } from "../types";

const SOCKET_PATH = "/tmp/fitdeck-ble.sock";
const CONNECT_RETRY_MS = 2000;
const MAX_CONNECT_RETRIES = 10;

export interface TreadmillServiceEvents {
	status: (status: TreadmillStatus) => void;
	"connection-change": (state: ConnectionState) => void;
	info: (info: any) => void;
}

export class TreadmillService extends EventEmitter {
	private socket: Socket | null = null;
	private buffer = "";
	private connecting = false;
	private helperLaunched = false;
	private requestId = 0;
	private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

	connectionState: ConnectionState = "disconnected";
	lastStatus: TreadmillStatus | null = null;
	deviceInfo: TreadmillDeviceInfo = { maxSpeed: 14, minSpeed: 1, maxIncline: 0, minIncline: 0 };

	// --- Connection to BLE Helper ---

	async ensureConnected(): Promise<void> {
		if (this.socket || this.connecting) return;
		this.connecting = true;

		// On first connect, kill any stale helper from a previous plugin run and relaunch
		if (!this.helperLaunched) {
			await this.restartHelper();
		}

		// Try connecting to the socket with retries
		for (let i = 0; i < MAX_CONNECT_RETRIES; i++) {
			try {
				await this.connectSocket();
				this.connecting = false;
				// Ask helper to start scanning
				this.send({ method: "scan" });
				return;
			} catch {
				await new Promise((r) => setTimeout(r, CONNECT_RETRY_MS));
			}
		}
		this.connecting = false;
	}

	private async restartHelper(): Promise<void> {
		// If an old helper is still running from a previous plugin session, tell it to quit
		try {
			const tempSocket = connect({ path: SOCKET_PATH });
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => { tempSocket.destroy(); resolve(); }, 2000);
				tempSocket.on("connect", () => {
					tempSocket.write(JSON.stringify({ method: "quit" }) + "\n");
					clearTimeout(timeout);
					tempSocket.destroy();
					resolve();
				});
				tempSocket.on("error", () => { clearTimeout(timeout); resolve(); });
			});
			// Give it a moment to shut down
			await new Promise((r) => setTimeout(r, 500));
		} catch {
			// No stale helper running, that's fine
		}
		this.launchHelper();
	}

	private launchHelper(): void {
		// Find the helper .app relative to the plugin directory
		// The plugin runs from .sdPlugin/bin/plugin.js, so go up to .sdPlugin/
		const helperApp = join(this.getPluginDir(), "ble-helper", "FitDeckBLE.app");

		if (!existsSync(helperApp)) {
			streamDeck.logger.error("[FitDeck] BLE helper app not found at:", helperApp);
			return;
		}

		// Use 'open' to launch the .app bundle (ensures TCC checks its Info.plist)
		this.helperLaunched = true;
		execFile("open", [helperApp], (err) => {
			if (err) {
				streamDeck.logger.error("[FitDeck] Failed to launch BLE helper:", err.message);
				this.helperLaunched = false;
			}
		});
	}

	private getPluginDir(): string {
		// When running in SD, CWD is the .sdPlugin/ directory
		return process.cwd();
	}

	private connectSocket(): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = connect({ path: SOCKET_PATH });

			const timeout = setTimeout(() => {
				socket.destroy();
				reject(new Error("Socket connect timeout"));
			}, 3000);

			socket.on("connect", () => {
				clearTimeout(timeout);
				this.socket = socket;
				this.buffer = "";
				this.setupSocket(socket);
				resolve();
			});

			socket.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});
	}

	private setupSocket(socket: Socket): void {
		socket.on("data", (chunk) => {
			this.buffer += chunk.toString();
			let idx;
			while ((idx = this.buffer.indexOf("\n")) !== -1) {
				const line = this.buffer.substring(0, idx).trim();
				this.buffer = this.buffer.substring(idx + 1);
				if (!line) continue;
				try {
					this.handleMessage(JSON.parse(line));
				} catch {
					// ignore parse errors
				}
			}
		});

		socket.on("close", () => {
			this.socket = null;
			this.setConnectionState("disconnected");
			// Try to reconnect after a delay
			setTimeout(() => {
				if (!this.socket) this.ensureConnected();
			}, CONNECT_RETRY_MS);
		});

		socket.on("error", () => {
			this.socket = null;
			this.setConnectionState("disconnected");
		});
	}

	private handleMessage(msg: any): void {
		// Response to a request
		if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
			const req = this.pendingRequests.get(msg.id)!;
			this.pendingRequests.delete(msg.id);
			if (msg.error) req.reject(new Error(msg.error));
			else req.resolve(msg.result);
			return;
		}

		// Event from helper
		if (msg.event) {
			switch (msg.event) {
				case "status":
					this.lastStatus = msg.data;
					this.emit("status", msg.data);
					break;
				case "connection-change":
					this.setConnectionState(msg.data.state);
					break;
				case "device-info":
					if (msg.data) {
						this.deviceInfo = { ...this.deviceInfo, ...msg.data };
					}
					break;
				case "info":
					this.emit("info", msg.data);
					break;
			}
		}
	}

	private setConnectionState(state: ConnectionState): void {
		this.connectionState = state;
		this.emit("connection-change", state);
	}

	private send(msg: any): void {
		if (!this.socket) return;
		this.socket.write(JSON.stringify(msg) + "\n");
	}

	private request(method: string, params?: any): Promise<any> {
		return new Promise((resolve, reject) => {
			if (!this.socket) {
				reject(new Error("Not connected to BLE helper"));
				return;
			}
			const id = ++this.requestId;
			this.pendingRequests.set(id, { resolve, reject });
			this.socket.write(JSON.stringify({ id, method, ...params }) + "\n");

			// Timeout after 10s
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error("Request timeout"));
				}
			}, 10000);
		});
	}

	// --- Public Control API ---

	get isConnected(): boolean {
		return this.connectionState === "connected";
	}

	get isRunning(): boolean {
		return this.lastStatus?.statusCode === 3;
	}

	get currentSpeed(): number {
		return this.lastStatus?.speed ?? 0;
	}

	get maxSpeed(): number {
		return this.deviceInfo.maxSpeed;
	}

	get minSpeed(): number {
		return this.deviceInfo.minSpeed;
	}

	async start(mode = 0): Promise<void> {
		this.send({ method: "start", mode });
	}

	async setSpeed(speedKmh: number): Promise<void> {
		this.send({ method: "setSpeed", speed: speedKmh });
	}

	async setSpeedAndIncline(speedKmh: number, incline: number): Promise<void> {
		this.send({ method: "setSpeedAndIncline", speed: speedKmh, incline });
	}

	async stop(): Promise<void> {
		this.send({ method: "stop" });
	}

	async pause(): Promise<void> {
		this.send({ method: "pause" });
	}

	async disconnect(): Promise<void> {
		this.send({ method: "disconnect" });
		if (this.socket) {
			this.socket.destroy();
			this.socket = null;
		}
	}

	/** Wait for the next status event matching a condition. */
	waitForStatus(predicate?: (s: TreadmillStatus) => boolean, timeoutMs = 30000): Promise<TreadmillStatus> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.off("status", handler);
				reject(new Error("waitForStatus timeout"));
			}, timeoutMs);
			const handler = (status: TreadmillStatus) => {
				if (!predicate || predicate(status)) {
					clearTimeout(timer);
					this.off("status", handler);
					resolve(status);
				}
			};
			this.on("status", handler);
		});
	}
}

export const treadmillService = new TreadmillService();
