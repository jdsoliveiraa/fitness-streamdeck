import { action, SingletonAction, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import { tapControl, KeyHold } from "../util/controls";
import type { StartStopSettings, TreadmillStatus, ConnectionState } from "../types";

// Manifest states: 0 = idle (play), 1 = running (pause), 2 = paused (amber play)
function keyState(status: TreadmillStatus | null): { state: 0 | 1 | 2; title: string } {
	switch (status?.statusCode) {
		case 2: return status.status === "RESUMING" ? { state: 2, title: "Resuming..." } : { state: 0, title: "Starting..." };
		case 3: return { state: 1, title: "Pause" };
		case 10: return status.status === "PAUSING" ? { state: 2, title: "Pausing..." } : { state: 2, title: "Resume" };
		default: return { state: 0, title: "Start" };
	}
}

@action({ UUID: "com.jdsoliveiraa.fitdeck.start-stop" })
export class StartStopAction extends SingletonAction<StartStopSettings> {
	private listening = false;
	private hold = new KeyHold((a) => this.refresh(a.id));

	private statusHandler = (_status: TreadmillStatus) => {
		for (const action of this.actions) this.refresh(action.id);
	};

	private refresh(id: string): void {
		if (this.hold.isOverlaid(id) || !treadmillService.isConnected) return;
		const action = [...this.actions].find((a) => a.id === id);
		if (!action?.isKey()) return;
		const { state, title } = keyState(treadmillService.lastStatus);
		action.setState(state);
		action.setTitle(title);
	}

	private connectionHandler = (state: ConnectionState) => {
		for (const action of this.actions) {
			if (action.isKey() && !this.hold.isOverlaid(action.id)) {
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
				this.refresh(ev.action.id);
			}
		}
	}

	override async onWillDisappear(ev: WillDisappearEvent<StartStopSettings>): Promise<void> {
		this.hold.cancel(ev.action.id);
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
		if (ev.action.isKey()) this.hold.down(ev.action);
	}

	override async onKeyUp(ev: KeyUpEvent<StartStopSettings>): Promise<void> {
		if (this.hold.up(ev.action.id)) await tapControl();
	}
}
