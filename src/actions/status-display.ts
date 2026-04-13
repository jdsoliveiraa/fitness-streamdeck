import { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import { renderStatusKey } from "../util/svg-renderer";
import type { StatusDisplaySettings, TreadmillStatus, ConnectionState } from "../types";

@action({ UUID: "com.jdsoliveiraa.fitdeck.status-display" })
export class StatusDisplayAction extends SingletonAction<StatusDisplaySettings> {
	private listening = false;

	private statusHandler = (_status: TreadmillStatus) => {
		this.updateAllKeys();
	};

	private connectionHandler = (_state: ConnectionState) => {
		this.updateAllKeys();
	};

	private updateAllKeys(): void {
		const svg = renderStatusKey(treadmillService.lastStatus, treadmillService.connectionState);
		for (const action of this.actions) {
			if (action.isKey()) {
				action.setImage(svg);
			}
		}
	}

	override async onWillAppear(_ev: WillAppearEvent<StatusDisplaySettings>): Promise<void> {
		if (!this.listening) {
			treadmillService.on("status", this.statusHandler);
			treadmillService.on("connection-change", this.connectionHandler);
			this.listening = true;
		}
		treadmillService.ensureConnected();
		this.updateAllKeys();
	}

	override async onWillDisappear(_ev: WillDisappearEvent<StatusDisplaySettings>): Promise<void> {
		if ([...this.actions].length === 0) {
			treadmillService.off("status", this.statusHandler);
			treadmillService.off("connection-change", this.connectionHandler);
			this.listening = false;
		}
	}

	override async onKeyDown(_ev: KeyDownEvent<StatusDisplaySettings>): Promise<void> {
		// Could cycle display modes in the future
	}
}
