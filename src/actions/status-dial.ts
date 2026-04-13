import { action, SingletonAction, type DialRotateEvent, type DialDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import type { StatusDialSettings, TreadmillStatus, ConnectionState } from "../types";

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60).toString().padStart(2, "0");
	const s = (seconds % 60).toString().padStart(2, "0");
	return `${m}:${s}`;
}

function formatDist(km: number): string {
	return km < 1 ? `${(km * 1000).toFixed(0)}m` : `${km.toFixed(2)}km`;
}

@action({ UUID: "com.jdsoliveiraa.fitdeck.status-dial" })
export class StatusDialAction extends SingletonAction<StatusDialSettings> {
	private listening = false;

	private statusHandler = (status: TreadmillStatus) => {
		this.updateFeedback(status);
	};

	private connectionHandler = (state: ConnectionState) => {
		if (state !== "connected") {
			const label = state === "scanning" ? "Scanning..." : "Offline";
			for (const action of this.actions) {
				if (action.isDial()) {
					action.setFeedback({
						label1: "STATUS", value1: label,
						label2: "", value2: "",
						label3: "", value3: "",
						label4: "", value4: "",
					});
				}
			}
		}
	};

	override async onWillAppear(ev: WillAppearEvent<StatusDialSettings>): Promise<void> {
		if (!this.listening) {
			treadmillService.on("status", this.statusHandler);
			treadmillService.on("connection-change", this.connectionHandler);
			this.listening = true;
		}
		treadmillService.ensureConnected();

		if (treadmillService.lastStatus) {
			this.updateFeedback(treadmillService.lastStatus);
		} else {
			if (ev.action.isDial()) {
				ev.action.setFeedback({
					label1: "STATUS", value1: "Waiting...",
					label2: "", value2: "",
					label3: "", value3: "",
					label4: "", value4: "",
				});
			}
		}
	}

	override async onWillDisappear(_ev: WillDisappearEvent<StatusDialSettings>): Promise<void> {
		if ([...this.actions].length === 0) {
			treadmillService.off("status", this.statusHandler);
			treadmillService.off("connection-change", this.connectionHandler);
			this.listening = false;
		}
	}

	override async onDialRotate(_ev: DialRotateEvent<StatusDialSettings>): Promise<void> {
		// Could cycle views in a future version
	}

	override async onDialDown(_ev: DialDownEvent<StatusDialSettings>): Promise<void> {
		if (!treadmillService.isConnected) return;
		if (treadmillService.lastStatus?.statusCode === 3) {
			await treadmillService.pause();
		} else if (treadmillService.lastStatus?.statusCode === 10) {
			await treadmillService.start();
		}
	}

	private updateFeedback(status: TreadmillStatus): void {
		for (const action of this.actions) {
			if (action.isDial()) {
				action.setFeedback({
					label1: "SPEED",
					value1: `${status.speed.toFixed(1)}`,
					label2: "DIST",
					value2: formatDist(status.distance),
					label3: "TIME",
					value3: formatTime(status.elapsedSeconds),
					label4: "CAL",
					value4: `${status.calories.toFixed(1)}`,
				});
			}
		}
	}
}
