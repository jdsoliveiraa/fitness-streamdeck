import { action, SingletonAction, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import { tapControl, holdStop, PressHold } from "../util/controls";
import type { StartStopSettings, TreadmillStatus, ConnectionState } from "../types";

// Manifest states: 0 = idle (play), 1 = running (pause), 2 = paused (amber play)
function keyState(statusCode: number | undefined): { state: 0 | 1 | 2; title: string } {
	switch (statusCode) {
		case 2: return { state: 0, title: "Starting..." };
		case 3: return { state: 1, title: "Pause" };
		case 10: return { state: 2, title: "Resume" };
		default: return { state: 0, title: "Start" };
	}
}

@action({ UUID: "com.jdsoliveiraa.fitdeck.start-stop" })
export class StartStopAction extends SingletonAction<StartStopSettings> {
	private listening = false;
	private press = new PressHold();

	private statusHandler = (status: TreadmillStatus) => {
		const { state, title } = keyState(status.statusCode);
		for (const action of this.actions) {
			if (action.isKey()) {
				action.setState(state);
				action.setTitle(title);
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
				const { state, title } = keyState(treadmillService.lastStatus?.statusCode);
				ev.action.setState(state);
				ev.action.setTitle(title);
			}
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<StartStopSettings>): Promise<void> {
		this.press.cancel(ev.action.id);
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
		this.press.down(ev.action.id, () => {
			holdStop();
			if (ev.action.isKey()) ev.action.showOk();
		});
	}

	override async onKeyUp(ev: KeyUpEvent<StartStopSettings>): Promise<void> {
		if (this.press.up(ev.action.id)) await tapControl();
	}
}
