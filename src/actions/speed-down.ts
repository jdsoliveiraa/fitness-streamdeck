import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import type { SpeedSettings, TreadmillStatus } from "../types";

@action({ UUID: "com.jdsoliveiraa.fitdeck.speed-down" })
export class SpeedDownAction extends SingletonAction<SpeedSettings> {
	private listening = false;

	private statusHandler = (status: TreadmillStatus) => {
		for (const action of this.actions) {
			if (action.isKey()) {
				action.setTitle(`${status.speed.toFixed(1)}\nkm/h`);
			}
		}
	};

	override async onWillAppear(_ev: WillAppearEvent<SpeedSettings>): Promise<void> {
		if (!this.listening) {
			treadmillService.on("status", this.statusHandler);
			this.listening = true;
		}
		treadmillService.ensureConnected();
	}

	override async onWillDisappear(_ev: WillDisappearEvent<SpeedSettings>): Promise<void> {
		if ([...this.actions].length === 0) {
			treadmillService.off("status", this.statusHandler);
			this.listening = false;
		}
	}

	override async onKeyDown(ev: KeyDownEvent<SpeedSettings>): Promise<void> {
		if (!treadmillService.isConnected || !treadmillService.isRunning) {
			if (ev.action.isKey()) ev.action.showAlert();
			return;
		}
		const step = ev.payload.settings.stepSize ?? 0.5;
		const newSpeed = Math.max(treadmillService.currentSpeed - step, treadmillService.minSpeed);
		await treadmillService.setSpeed(newSpeed);
	}
}
