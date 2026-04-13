import { action, SingletonAction, type DialRotateEvent, type DialDownEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import type { SpeedDialSettings, TreadmillStatus, ConnectionState } from "../types";

@action({ UUID: "com.jdsoliveiraa.fitdeck.speed-dial" })
export class SpeedDialAction extends SingletonAction<SpeedDialSettings> {
	private listening = false;

	private statusHandler = (status: TreadmillStatus) => {
		const pct = Math.round((status.speed / treadmillService.maxSpeed) * 100);
		for (const action of this.actions) {
			if (action.isDial()) {
				action.setFeedback({
					title: "SPEED",
					value: `${status.speed.toFixed(1)} km/h`,
					indicator: { value: pct },
				});
			}
		}
	};

	private connectionHandler = (state: ConnectionState) => {
		for (const action of this.actions) {
			if (action.isDial()) {
				if (state !== "connected") {
					action.setFeedback({
						title: "SPEED",
						value: state === "scanning" ? "Scanning..." : "Offline",
						indicator: { value: 0 },
					});
				}
			}
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
			ev.action.setFeedback({
				title: "SPEED",
				value: treadmillService.isConnected ? `${treadmillService.currentSpeed.toFixed(1)} km/h` : "Offline",
				indicator: { value: 0 },
			});
		}
	}

	override async onWillDisappear(_ev: WillDisappearEvent<SpeedDialSettings>): Promise<void> {
		if ([...this.actions].length === 0) {
			treadmillService.off("status", this.statusHandler);
			treadmillService.off("connection-change", this.connectionHandler);
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
}
