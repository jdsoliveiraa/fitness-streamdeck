import { action, SingletonAction, type DialRotateEvent, type DialDownEvent, type DialUpEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService, pauseStateOf } from "../services/treadmill-service";
import { tapControl, DialHold } from "../util/controls";
import { renderStatsView, renderSpeedFocus, renderOfflineView } from "../util/dial-renderer";
import type { SpeedDialSettings, TreadmillStatus, ConnectionState } from "../types";

function statsView(status: TreadmillStatus): string {
	return renderStatsView({
		speed: status.speed,
		distance: status.distance,
		elapsedSeconds: status.elapsedSeconds,
		calories: status.calories,
		maxSpeed: treadmillService.maxSpeed,
		statusCode: status.statusCode,
		pauseState: pauseStateOf(status),
	});
}

const CANVAS_LAYOUT = "layouts/canvas-layout.json";
const SPEED_FOCUS_MS = 5000;

@action({ UUID: "com.jdsoliveiraa.fitdeck.speed-dial" })
export class SpeedDialAction extends SingletonAction<SpeedDialSettings> {
	private listening = false;
	private showingSpeedFocus = false;
	private speedFocusTimer: ReturnType<typeof setTimeout> | null = null;
	private lastKnownSpeed = 0;
	private hold = new DialHold(() => this.redraw());

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
			this.setCanvas(statsView(status));
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
				this.setCanvas(statsView(treadmillService.lastStatus));
			} else {
				this.setCanvas(renderOfflineView("Waiting..."));
			}
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<SpeedDialSettings>): Promise<void> {
		this.hold.cancel(ev.action.id);
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

	override async onDialDown(ev: DialDownEvent<SpeedDialSettings>): Promise<void> {
		if (!treadmillService.isConnected) return;
		this.hold.down(ev.action);
	}

	override async onDialUp(ev: DialUpEvent<SpeedDialSettings>): Promise<void> {
		if (this.hold.up(ev.action.id)) await tapControl();
	}

	override async onTouchTap(_ev: TouchTapEvent<SpeedDialSettings>): Promise<void> {
		if (!treadmillService.isConnected) return;
		await tapControl();
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
				this.setCanvas(statsView(treadmillService.lastStatus));
			}
		}, SPEED_FOCUS_MS);
	}

	private redraw(): void {
		if (!treadmillService.isConnected) {
			this.setCanvas(renderOfflineView(treadmillService.connectionState === "scanning" ? "Scanning..." : "Offline"));
		} else if (treadmillService.lastStatus) {
			this.setCanvas(statsView(treadmillService.lastStatus));
		}
	}

	private setCanvas(dataUri: string): void {
		for (const action of this.actions) {
			if (action.isDial() && !this.hold.isOverlaid(action.id)) {
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
