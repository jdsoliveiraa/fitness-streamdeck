import { action, SingletonAction, type DialRotateEvent, type DialDownEvent, type DialUpEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService, pauseStateOf } from "../services/treadmill-service";
import { tapControl, DialHold } from "../util/controls";
import { renderStatusGrid, renderOfflineView } from "../util/dial-renderer";
import type { StatusDialSettings, TreadmillStatus, ConnectionState } from "../types";

const CANVAS_LAYOUT = "layouts/canvas-layout.json";

@action({ UUID: "com.jdsoliveiraa.fitdeck.status-dial" })
export class StatusDialAction extends SingletonAction<StatusDialSettings> {
	private listening = false;
	private hold = new DialHold(() => this.redraw());

	private statusHandler = (_status: TreadmillStatus) => {
		this.redraw();
	};

	private connectionHandler = (_state: ConnectionState) => {
		this.redraw();
	};

	override async onWillAppear(ev: WillAppearEvent<StatusDialSettings>): Promise<void> {
		if (!this.listening) {
			treadmillService.on("status", this.statusHandler);
			treadmillService.on("connection-change", this.connectionHandler);
			this.listening = true;
		}
		treadmillService.ensureConnected();

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout(CANVAS_LAYOUT);
		}
		this.redraw();
	}

	override async onWillDisappear(ev: WillDisappearEvent<StatusDialSettings>): Promise<void> {
		this.hold.cancel(ev.action.id);
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
		this.hold.down(ev.action);
	}

	override async onDialUp(ev: DialUpEvent<StatusDialSettings>): Promise<void> {
		if (this.hold.up(ev.action.id)) await tapControl();
	}

	override async onTouchTap(_ev: TouchTapEvent<StatusDialSettings>): Promise<void> {
		if (!treadmillService.isConnected) return;
		await tapControl();
	}

	private redraw(): void {
		const status = treadmillService.lastStatus;
		let canvas: string;
		if (treadmillService.connectionState !== "connected") {
			canvas = renderOfflineView(treadmillService.connectionState === "scanning" ? "Scanning..." : "Offline");
		} else if (!status) {
			canvas = renderOfflineView("Waiting...");
		} else {
			canvas = renderStatusGrid({
				speed: status.speed,
				distance: status.distance,
				elapsedSeconds: status.elapsedSeconds,
				calories: status.calories,
				status: status.status,
				statusCode: status.statusCode,
				pauseState: pauseStateOf(status),
			});
		}
		for (const action of this.actions) {
			if (action.isDial() && !this.hold.isOverlaid(action.id)) {
				action.setFeedback({ canvas });
			}
		}
	}
}
