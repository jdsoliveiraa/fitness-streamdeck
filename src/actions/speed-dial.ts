import { action, SingletonAction, type DialRotateEvent, type DialDownEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import { renderStatsView, renderSpeedFocus, renderOfflineView } from "../util/dial-renderer";
import type { SpeedDialSettings, TreadmillStatus, ConnectionState } from "../types";

const CANVAS_LAYOUT = "layouts/canvas-layout.json";
const SPEED_FOCUS_MS = 5000;

@action({ UUID: "com.jdsoliveiraa.fitdeck.speed-dial" })
export class SpeedDialAction extends SingletonAction<SpeedDialSettings> {
	private listening = false;
	private showingSpeedFocus = false;
	private speedFocusTimer: ReturnType<typeof setTimeout> | null = null;
	private lastKnownSpeed = 0;

	private statusHandler = (status: TreadmillStatus) => {
		const speedChanged = status.speed !== this.lastKnownSpeed;
		this.lastKnownSpeed = status.speed;

		if (speedChanged && status.speed > 0) {
			this.showSpeedFocus(status);
		} else if (this.showingSpeedFocus) {
			this.setCanvas(renderSpeedFocus({
				speed: status.speed,
				minSpeed: treadmillService.minSpeed,
				maxSpeed: treadmillService.maxSpeed,
			}));
		} else {
			this.setCanvas(renderStatsView({
				speed: status.speed,
				distance: status.distance,
				elapsedSeconds: status.elapsedSeconds,
				calories: status.calories,
				maxSpeed: treadmillService.maxSpeed,
				statusCode: status.statusCode,
			}));
		}
	};

	private connectionHandler = (state: ConnectionState) => {
		if (state !== "connected") {
			this.clearSpeedFocusTimer();
			this.showingSpeedFocus = false;
			const label = state === "scanning" ? "Scanning..." : "Offline";
			this.setCanvas(renderOfflineView(label));
		}
	};

	override async onWillAppear(ev: WillAppearEvent<SpeedDialSettings>): Promise<void> {
		if (!this.listening) {
			treadmillService.on("status", this.statusHandler);
			treadmillService.on("connection-change", this.connectionHandler);
			this.listening = true;
		}
		treadmillService.ensureConnected();

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout(CANVAS_LAYOUT);

			if (treadmillService.lastStatus) {
				this.lastKnownSpeed = treadmillService.lastStatus.speed;
				this.setCanvas(renderStatsView({
					speed: treadmillService.lastStatus.speed,
					distance: treadmillService.lastStatus.distance,
					elapsedSeconds: treadmillService.lastStatus.elapsedSeconds,
					calories: treadmillService.lastStatus.calories,
					maxSpeed: treadmillService.maxSpeed,
					statusCode: treadmillService.lastStatus.statusCode,
				}));
			} else {
				this.setCanvas(renderOfflineView("Waiting..."));
			}
		}
	}

	override async onWillDisappear(_ev: WillDisappearEvent<SpeedDialSettings>): Promise<void> {
		if ([...this.actions].length === 0) {
			treadmillService.off("status", this.statusHandler);
			treadmillService.off("connection-change", this.connectionHandler);
			this.clearSpeedFocusTimer();
			this.listening = false;
		}
	}

	override async onDialRotate(ev: DialRotateEvent<SpeedDialSettings>): Promise<void> {
		if (!treadmillService.isConnected || !treadmillService.isRunning) return;

		const step = ev.payload.settings.stepSize ?? 0.5;
		const delta = ev.payload.ticks * step;
		const newSpeed = Math.max(
			treadmillService.minSpeed,
			Math.min(treadmillService.currentSpeed + delta, treadmillService.maxSpeed),
		);
		await treadmillService.setSpeed(newSpeed);
	}

	override async onDialDown(_ev: DialDownEvent<SpeedDialSettings>): Promise<void> {
		if (!treadmillService.isConnected) return;
		if (treadmillService.isRunning) {
			await treadmillService.stop();
		} else {
			await treadmillService.start();
		}
	}

	override async onTouchTap(_ev: TouchTapEvent<SpeedDialSettings>): Promise<void> {
		if (!treadmillService.isConnected) return;
		if (treadmillService.isRunning) {
			await treadmillService.stop();
		} else {
			await treadmillService.start();
		}
	}

	private showSpeedFocus(status: TreadmillStatus): void {
		this.clearSpeedFocusTimer();
		this.showingSpeedFocus = true;

		this.setCanvas(renderSpeedFocus({
			speed: status.speed,
			minSpeed: treadmillService.minSpeed,
			maxSpeed: treadmillService.maxSpeed,
		}));

		this.speedFocusTimer = setTimeout(() => {
			this.speedFocusTimer = null;
			this.showingSpeedFocus = false;
			if (treadmillService.lastStatus) {
				this.setCanvas(renderStatsView({
					speed: treadmillService.lastStatus.speed,
					distance: treadmillService.lastStatus.distance,
					elapsedSeconds: treadmillService.lastStatus.elapsedSeconds,
					calories: treadmillService.lastStatus.calories,
					maxSpeed: treadmillService.maxSpeed,
					statusCode: treadmillService.lastStatus.statusCode,
				}));
			}
		}, SPEED_FOCUS_MS);
	}

	private setCanvas(dataUri: string): void {
		for (const action of this.actions) {
			if (action.isDial()) {
				action.setFeedback({ canvas: dataUri });
			}
		}
	}

	private clearSpeedFocusTimer(): void {
		if (this.speedFocusTimer) {
			clearTimeout(this.speedFocusTimer);
			this.speedFocusTimer = null;
		}
	}
}
