import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import type { StartStopSettings, TreadmillStatus, ConnectionState } from "../types";

@action({ UUID: "com.jdsoliveiraa.fitdeck.start-stop" })
export class StartStopAction extends SingletonAction<StartStopSettings> {
	private listening = false;

	private statusHandler = (status: TreadmillStatus) => {
		for (const action of this.actions) {
			if (action.isKey()) {
				action.setState(status.statusCode === 3 ? 1 : 0);
				if (status.statusCode === 2) {
					action.setTitle("Starting...");
				} else {
					action.setTitle(status.statusCode === 3 ? "Stop" : "Start");
				}
			}
		}
	};

	private connectionHandler = (state: ConnectionState) => {
		for (const action of this.actions) {
			if (action.isKey()) {
				if (state !== "connected") {
					action.setTitle(state === "scanning" ? "Scanning..." : "Offline");
				}
			}
		}
	};

	override async onWillAppear(ev: WillAppearEvent<StartStopSettings>): Promise<void> {
		if (!this.listening) {
			treadmillService.on("status", this.statusHandler);
			treadmillService.on("connection-change", this.connectionHandler);
			this.listening = true;
		}
		treadmillService.ensureConnected();

		if (ev.action.isKey()) {
			if (!treadmillService.isConnected) {
				ev.action.setTitle("Offline");
			} else {
				ev.action.setState(treadmillService.isRunning ? 1 : 0);
				ev.action.setTitle(treadmillService.isRunning ? "Stop" : "Start");
			}
		}
	}

	override async onWillDisappear(_ev: WillDisappearEvent<StartStopSettings>): Promise<void> {
		if ([...this.actions].length === 0) {
			treadmillService.off("status", this.statusHandler);
			treadmillService.off("connection-change", this.connectionHandler);
			this.listening = false;
		}
	}

	override async onKeyDown(ev: KeyDownEvent<StartStopSettings>): Promise<void> {
		if (!treadmillService.isConnected) {
			if (ev.action.isKey()) ev.action.showAlert();
			return;
		}
		if (treadmillService.isRunning) {
			await treadmillService.stop();
		} else {
			await treadmillService.start();
		}
	}
}
