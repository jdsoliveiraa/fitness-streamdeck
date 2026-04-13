import { action, SingletonAction, type DialRotateEvent, type DialDownEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import { workoutManager } from "../services/workout-manager";
import type { WorkoutDialSettings, WorkoutProgress } from "../types";

function formatTime(s: number): string {
	const m = Math.floor(s / 60).toString().padStart(2, "0");
	const sec = (s % 60).toString().padStart(2, "0");
	return `${m}:${sec}`;
}

function progressSubtitle(w: WorkoutProgress): string {
	switch (w.plan.goalType) {
		case "calories":
			return `${w.currentValue.toFixed(1)} / ${w.targetValue} cal`;
		case "distance":
			return `${w.currentValue.toFixed(3)} / ${w.targetValue} km`;
		case "time":
			return `${formatTime(w.currentValue)} / ${formatTime(w.targetValue)}`;
		default:
			return "";
	}
}

@action({ UUID: "com.jdsoliveiraa.fitdeck.workout-dial" })
export class WorkoutDialAction extends SingletonAction<WorkoutDialSettings> {
	private listening = false;
	private selectedIndex = 0;

	private progressHandler = (w: WorkoutProgress) => {
		for (const action of this.actions) {
			if (action.isDial()) {
				action.setFeedback({
					title: w.plan.name,
					value: `${Math.round(w.percentComplete)}%`,
					subtitle: progressSubtitle(w),
					indicator: { value: Math.round(w.percentComplete) },
				});
			}
		}
	};

	private completeHandler = (w: WorkoutProgress) => {
		for (const action of this.actions) {
			if (action.isDial()) {
				action.setFeedback({
					title: w.plan.name,
					value: "DONE!",
					subtitle: progressSubtitle(w),
					indicator: { value: 100 },
				});
			}
		}
	};

	private abortedHandler = () => {
		this.showPlanBrowser();
	};

	private plansChangedHandler = () => {
		const plans = workoutManager.plans;
		if (this.selectedIndex >= plans.length) {
			this.selectedIndex = Math.max(0, plans.length - 1);
		}
		if (!workoutManager.isActive) this.showPlanBrowser();
	};

	override async onWillAppear(ev: WillAppearEvent<WorkoutDialSettings>): Promise<void> {
		this.selectedIndex = ev.payload.settings.selectedPlanIndex ?? 0;
		if (!this.listening) {
			workoutManager.on("progress", this.progressHandler);
			workoutManager.on("complete", this.completeHandler);
			workoutManager.on("aborted", this.abortedHandler);
			workoutManager.on("plans-changed", this.plansChangedHandler);
			this.listening = true;
		}
		treadmillService.ensureConnected();

		if (workoutManager.isActive && workoutManager.progress) {
			const w = workoutManager.progress;
			if (ev.action.isDial()) {
				ev.action.setFeedback({
					title: w.plan.name,
					value: `${Math.round(w.percentComplete)}%`,
					subtitle: progressSubtitle(w),
					indicator: { value: Math.round(w.percentComplete) },
				});
			}
		} else {
			this.showPlanBrowser();
		}
	}

	override async onWillDisappear(_ev: WillDisappearEvent<WorkoutDialSettings>): Promise<void> {
		if ([...this.actions].length === 0) {
			workoutManager.off("progress", this.progressHandler);
			workoutManager.off("complete", this.completeHandler);
			workoutManager.off("aborted", this.abortedHandler);
			workoutManager.off("plans-changed", this.plansChangedHandler);
			this.listening = false;
		}
	}

	override async onDialRotate(ev: DialRotateEvent<WorkoutDialSettings>): Promise<void> {
		if (workoutManager.isActive) return;
		const plans = workoutManager.plans;
		this.selectedIndex = (this.selectedIndex + ev.payload.ticks + plans.length) % plans.length;
		ev.action.setSettings({ selectedPlanIndex: this.selectedIndex });
		this.showPlanBrowser();
	}

	override async onDialDown(_ev: DialDownEvent<WorkoutDialSettings>): Promise<void> {
		await this.toggleWorkout();
	}

	override async onTouchTap(_ev: TouchTapEvent<WorkoutDialSettings>): Promise<void> {
		await this.toggleWorkout();
	}

	private async toggleWorkout(): Promise<void> {
		if (workoutManager.isActive) {
			await workoutManager.abortWorkout();
		} else if (treadmillService.isConnected) {
			const plans = workoutManager.plans;
			const plan = plans[this.selectedIndex] ?? plans[0];
			if (plan) await workoutManager.startWorkout(plan);
		}
	}

	private showPlanBrowser(): void {
		const plans = workoutManager.plans;
		const plan = plans[this.selectedIndex] ?? plans[0];
		if (!plan) return;
		for (const action of this.actions) {
			if (action.isDial()) {
				action.setFeedback({
					title: "WORKOUT",
					value: plan.name,
					subtitle: plan.description,
					indicator: { value: 0 },
				});
			}
		}
	}
}
