/**
 * Shared tap / hold behaviour for the Start/Stop key and the dials:
 * tap = start / pause / resume, hold = stop (fires while still held).
 */
import { treadmillService } from "../services/treadmill-service";
import { workoutManager } from "../services/workout-manager";

export const HOLD_TO_STOP_MS = 2000;

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
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Arm the hold timer; `onHold` fires if the press lasts HOLD_TO_STOP_MS. */
	down(id: string, onHold: () => void): void {
		this.cancel(id);
		this.timers.set(id, setTimeout(() => {
			this.timers.delete(id);
			onHold();
		}, HOLD_TO_STOP_MS));
	}

	/** Returns true when the release is a tap (the hold has not fired). */
	up(id: string): boolean {
		const timer = this.timers.get(id);
		if (!timer) return false;
		this.cancel(id);
		return true;
	}

	cancel(id: string): void {
		const timer = this.timers.get(id);
		if (timer) clearTimeout(timer);
		this.timers.delete(id);
	}
}
