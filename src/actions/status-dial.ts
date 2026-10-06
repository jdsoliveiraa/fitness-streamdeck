import { action, SingletonAction, type DialRotateEvent, type DialDownEvent, type DialUpEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import { tapControl, holdStop, PressHold } from "../util/controls";
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
	private press = new PressHold();

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

	override async onWillDisappear(ev: WillDisappearEvent<StatusDialSettings>): Promise<void> {
		this.press.cancel(ev.action.id);
		if ([...this.actions].length === 0) {
			treadmillService.off("status", this.statusHandler);
			treadmillService.off("connection-change", this.connectionHandler);
			this.listening = false;
		}
	}

	override async onDialRotate(_ev: DialRotateEvent<StatusDialSettings>): Promise<void> {
		// Could cycle views in a future version
	}

	override async onDialDown(ev: DialDownEvent<StatusDialSettings>): Promise<void> {
		if (!treadmillService.isConnected) return;
		this.press.down(ev.action.id, () => holdStop());
	}

	override async onDialUp(ev: DialUpEvent<StatusDialSettings>): Promise<void> {
		if (this.press.up(ev.action.id)) await tapControl();
	}

	override async onTouchTap(_ev: TouchTapEvent<StatusDialSettings>): Promise<void> {
		if (!treadmillService.isConnected) return;
		await tapControl();
	}

	private updateFeedback(status: TreadmillStatus): void {
		for (const action of this.actions) {
			if (action.isDial()) {
				action.setFeedback({
					label1: status.statusCode === 10 ? "PAUSED" : "SPEED",
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
