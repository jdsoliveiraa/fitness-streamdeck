/**
 * Shared tap / hold behaviour for the Start/Stop key and the dials:
 * tap = start / pause / resume, hold = stop (fires while still held).
 */
import { treadmillService } from "../services/treadmill-service";
import { workoutManager } from "../services/workout-manager";
import { renderHoldToStop, renderStopping } from "./dial-renderer";
import { renderHoldKey } from "./svg-renderer";

export const HOLD_TO_STOP_MS = 2000;
/** Don't flash the hold animation on quick taps. */
const HOLD_VISUAL_DELAY_MS = 250;
const HOLD_FRAME_MS = 80;
const STOPPING_CONFIRM_MS = 1200;

/** Tap: start from idle, pause while running, resume while paused. Ignored while STARTING. */
export async function tapControl(): Promise<void> {
	switch (treadmillService.lastStatus?.statusCode) {
		case 3:
			await treadmillService.pause();
			break;
		case 10:
			await treadmillService.resume();
			break;
		case 2:
			break;
		default:
			await treadmillService.start();
	}
}

/** Hold: stop the treadmill, ending any active workout. */
export async function holdStop(): Promise<void> {
	if (workoutManager.isActive) {
		await workoutManager.abortWorkout();
	} else {
		await treadmillService.stop();
	}
}

/** Tracks press/release per action instance to tell a tap from a hold. */
export class PressHold {
	private timers = new Map<string, { hold: ReturnType<typeof setTimeout>; frames?: ReturnType<typeof setInterval> }>();

	/**
	 * Arm the hold timer; `onHold` fires if the press lasts HOLD_TO_STOP_MS.
	 * `onProgress` gets 0–100 animation frames once the press outlasts a tap.
	 */
	down(id: string, onHold: () => void, onProgress?: (pct: number) => void): void {
		this.cancel(id);
		const startedAt = Date.now();
		const entry: { hold: ReturnType<typeof setTimeout>; frames?: ReturnType<typeof setInterval> } = {
			hold: setTimeout(() => {
				this.cancel(id);
				onProgress?.(100);
				onHold();
			}, HOLD_TO_STOP_MS),
		};
		if (onProgress) {
			entry.frames = setInterval(() => {
				const elapsed = Date.now() - startedAt;
				if (elapsed >= HOLD_VISUAL_DELAY_MS) onProgress(Math.min(100, (elapsed / HOLD_TO_STOP_MS) * 100));
			}, HOLD_FRAME_MS);
		}
		this.timers.set(id, entry);
	}

	/** Returns true when the release is a tap (the hold has not fired). */
	up(id: string): boolean {
		if (!this.timers.has(id)) return false;
		this.cancel(id);
		return true;
	}

	cancel(id: string): void {
		const entry = this.timers.get(id);
		if (!entry) return;
		clearTimeout(entry.hold);
		if (entry.frames) clearInterval(entry.frames);
		this.timers.delete(id);
	}
}

interface FeedbackTarget {
	id: string;
	setFeedback(feedback: { canvas: string }): Promise<void>;
}

/**
 * Hold-to-stop for dials: animates a fill bar on the touch screen while held, then
 * shows a short "stopping" confirmation. Normal screen updates are suppressed while
 * the overlay is up; `redraw` restores the dial's own view afterwards.
 */
export class DialHold {
	private press = new PressHold();
	private overlaid = new Set<string>();

	constructor(private redraw: () => void) {}

	isOverlaid(id: string): boolean {
		return this.overlaid.has(id);
	}

	down(action: FeedbackTarget): void {
		const id = action.id;
		this.press.down(
			id,
			() => {
				action.setFeedback({ canvas: renderStopping() });
				holdStop();
				setTimeout(() => this.release(id), STOPPING_CONFIRM_MS);
			},
			(pct) => {
				this.overlaid.add(id);
				action.setFeedback({ canvas: renderHoldToStop(pct) });
			},
		);
	}

	/** Returns true when the release is a tap. */
	up(id: string): boolean {
		const tap = this.press.up(id);
		if (tap) this.release(id);
		return tap;
	}

	cancel(id: string): void {
		this.press.cancel(id);
		this.overlaid.delete(id);
	}

	private release(id: string): void {
		if (this.overlaid.delete(id)) this.redraw();
	}
}

interface KeyTarget {
	id: string;
	setImage(image?: string): Promise<void>;
	setTitle(title: string): Promise<void>;
	showOk(): Promise<void>;
}

/**
 * Hold-to-stop for keys: a ring fills around a stop square while held, then the key
 * flashes OK. Normal state/title updates are suppressed while the ring is up;
 * `restore` re-applies the key's own state and title afterwards.
 */
export class KeyHold {
	private press = new PressHold();
	private overlaid = new Map<string, KeyTarget>();

	constructor(private restore: (action: KeyTarget) => void) {}

	isOverlaid(id: string): boolean {
		return this.overlaid.has(id);
	}

	down(action: KeyTarget): void {
		const id = action.id;
		this.press.down(
			id,
			() => {
				holdStop();
				this.release(id);
				action.showOk();
			},
			(pct) => {
				if (!this.overlaid.has(id)) {
					this.overlaid.set(id, action);
					action.setTitle("");
				}
				action.setImage(renderHoldKey(pct));
			},
		);
	}

	/** Returns true when the release is a tap. */
	up(id: string): boolean {
		const tap = this.press.up(id);
		if (tap) this.release(id);
		return tap;
	}

	cancel(id: string): void {
		this.press.cancel(id);
		this.overlaid.delete(id);
	}

	private release(id: string): void {
		const action = this.overlaid.get(id);
		if (!action) return;
		this.overlaid.delete(id);
		action.setImage(); // back to the manifest state image
		this.restore(action);
	}
}
