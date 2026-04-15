import { action, SingletonAction, type DialRotateEvent, type DialDownEvent, type TouchTapEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import { workoutManager } from "../services/workout-manager";
import { renderWorkoutBrowser, renderWorkoutProgress, renderGoalSelector, renderGoalPicker, renderWorkoutSummary, type WorkoutSummaryData } from "../util/dial-renderer";
import type { WorkoutDialSettings, WorkoutProgress, GoalType } from "../types";

const CANVAS_LAYOUT = "layouts/canvas-layout.json";
const GOAL_PICKER_TIMEOUT_MS = 15000;

// Goal picker configuration
const GOAL_CONFIG: Record<GoalType, { min: number; max: number; step: number }> = {
	distance: { min: 0.5, max: 50, step: 0.5 },
	time:     { min: 5,   max: 180, step: 5 },
	calories: { min: 25,  max: 1000, step: 25 },
};

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

// Browse list: workout plans followed by 3 goal type selectors
type BrowseItem =
	| { kind: "plan"; index: number }
	| { kind: "goal"; goalType: GoalType };

const GOAL_TYPES: GoalType[] = ["distance", "time", "calories"];

type DialMode = "browse" | "goal-picker" | "active" | "complete";

@action({ UUID: "com.jdsoliveiraa.fitdeck.workout-dial" })
export class WorkoutDialAction extends SingletonAction<WorkoutDialSettings> {
	private listening = false;
	private browseIndex = 0;
	private mode: DialMode = "browse";

	// Goal picker state
	private pickerGoalType: GoalType = "distance";
	private pickerValue = 5;
	private pickerTimer: ReturnType<typeof setTimeout> | null = null;

	// Completion summary data
	private summaryData: WorkoutSummaryData | null = null;

	private progressHandler = (w: WorkoutProgress) => {
		this.mode = "active";
		const isGoal = !!w.plan.goalOnly;
		this.setCanvas(renderWorkoutProgress(w.plan.name, w.percentComplete, progressSubtitle(w), false, isGoal));
	};

	private completeHandler = (w: WorkoutProgress) => {
		this.mode = "complete";
		this.summaryData = {
			name: w.plan.name,
			distance: w.lastSessionDist,
			elapsedSeconds: w.lastSessionSec,
			calories: w.lastSessionCal,
		};
		this.setCanvas(renderWorkoutSummary(this.summaryData));
	};

	private abortedHandler = () => {
		this.mode = "browse";
		this.showBrowse();
	};

	private plansChangedHandler = () => {
		const total = this.browseListLength();
		if (this.browseIndex >= total) {
			this.browseIndex = Math.max(0, total - 1);
		}
		if (this.mode === "browse") this.showBrowse();
	};

	override async onWillAppear(ev: WillAppearEvent<WorkoutDialSettings>): Promise<void> {
		this.browseIndex = ev.payload.settings.selectedPlanIndex ?? 0;
		if (!this.listening) {
			workoutManager.on("progress", this.progressHandler);
			workoutManager.on("complete", this.completeHandler);
			workoutManager.on("aborted", this.abortedHandler);
			workoutManager.on("plans-changed", this.plansChangedHandler);
			this.listening = true;
		}
		treadmillService.ensureConnected();

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout(CANVAS_LAYOUT);
		}

		if (workoutManager.isActive && workoutManager.progress) {
			this.mode = "active";
			const w = workoutManager.progress;
			const isGoal = !!w.plan.goalOnly;
			this.setCanvas(renderWorkoutProgress(w.plan.name, w.percentComplete, progressSubtitle(w), w.isComplete, isGoal));
		} else if (workoutManager.progress?.isComplete) {
			// Show summary if we reappear while complete
			this.mode = "complete";
			const w = workoutManager.progress;
			this.summaryData = {
				name: w.plan.name,
				distance: w.lastSessionDist,
				elapsedSeconds: w.lastSessionSec,
				calories: w.lastSessionCal,
			};
			this.setCanvas(renderWorkoutSummary(this.summaryData));
		} else {
			this.mode = "browse";
			this.showBrowse();
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
		this.clearPickerTimer();
	}

	override async onDialRotate(ev: DialRotateEvent<WorkoutDialSettings>): Promise<void> {
		switch (this.mode) {
			case "browse": {
				const total = this.browseListLength();
				this.browseIndex = (this.browseIndex + ev.payload.ticks + total) % total;
				ev.action.setSettings({ selectedPlanIndex: this.browseIndex });
				this.showBrowse();
				break;
			}
			case "goal-picker": {
				this.adjustPickerValue(ev.payload.ticks);
				this.resetPickerTimer();
				this.showGoalPicker();
				break;
			}
			// active/complete: rotation does nothing
		}
	}

	override async onDialDown(_ev: DialDownEvent<WorkoutDialSettings>): Promise<void> {
		await this.handlePress();
	}

	override async onTouchTap(_ev: TouchTapEvent<WorkoutDialSettings>): Promise<void> {
		await this.handlePress();
	}

	private async handlePress(): Promise<void> {
		switch (this.mode) {
			case "browse": {
				const item = this.currentBrowseItem();
				if (item.kind === "plan") {
					// Start a regular workout
					if (!treadmillService.isConnected) return;
					const plans = workoutManager.plans;
					const plan = plans[item.index] ?? plans[0];
					if (plan) await workoutManager.startWorkout(plan);
				} else {
					// Enter goal picker
					this.pickerGoalType = item.goalType;
					const cfg = GOAL_CONFIG[item.goalType];
					this.pickerValue = cfg.min + cfg.step * 2; // sensible default
					this.mode = "goal-picker";
					this.resetPickerTimer();
					this.showGoalPicker();
				}
				break;
			}
			case "goal-picker": {
				// Confirm goal and start
				this.clearPickerTimer();
				if (!treadmillService.isConnected) {
					this.mode = "browse";
					this.showBrowse();
					return;
				}
				const goalPlan = {
					id: `goal-${Date.now()}`,
					name: this.goalPlanName(),
					goalType: this.pickerGoalType,
					goalValue: this.pickerValue,
					speed: 0,
					incline: 0,
					description: "",
					goalOnly: true,
				};
				this.mode = "active";
				await workoutManager.startWorkout(goalPlan);
				break;
			}
			case "active": {
				await workoutManager.abortWorkout();
				break;
			}
			case "complete": {
				// Dismiss summary, return to browse
				this.mode = "browse";
				this.summaryData = null;
				this.showBrowse();
				break;
			}
		}
	}

	// --- Browse helpers ---

	private browseListLength(): number {
		return workoutManager.plans.length + GOAL_TYPES.length;
	}

	private currentBrowseItem(): BrowseItem {
		const plans = workoutManager.plans;
		if (this.browseIndex < plans.length) {
			return { kind: "plan", index: this.browseIndex };
		}
		const goalIdx = this.browseIndex - plans.length;
		return { kind: "goal", goalType: GOAL_TYPES[goalIdx] };
	}

	private showBrowse(): void {
		const item = this.currentBrowseItem();
		if (item.kind === "plan") {
			const plans = workoutManager.plans;
			const plan = plans[item.index] ?? plans[0];
			if (!plan) return;
			this.setCanvas(renderWorkoutBrowser(plan.name, plan.description));
		} else {
			this.setCanvas(renderGoalSelector(item.goalType));
		}
	}

	// --- Goal picker helpers ---

	private adjustPickerValue(ticks: number): void {
		const cfg = GOAL_CONFIG[this.pickerGoalType];
		this.pickerValue = Math.min(cfg.max, Math.max(cfg.min, this.pickerValue + ticks * cfg.step));
		// Round to step precision to avoid floating point drift
		this.pickerValue = Math.round(this.pickerValue / cfg.step) * cfg.step;
	}

	private goalPlanName(): string {
		const units: Record<GoalType, string> = { distance: "km", time: "min", calories: "cal" };
		const display = this.pickerGoalType === "distance" ? this.pickerValue.toFixed(1) : String(this.pickerValue);
		return `${display} ${units[this.pickerGoalType]} Goal`;
	}

	private showGoalPicker(): void {
		this.setCanvas(renderGoalPicker(this.pickerGoalType, this.pickerValue));
	}

	private resetPickerTimer(): void {
		this.clearPickerTimer();
		this.pickerTimer = setTimeout(() => {
			this.pickerTimer = null;
			this.mode = "browse";
			this.showBrowse();
		}, GOAL_PICKER_TIMEOUT_MS);
	}

	private clearPickerTimer(): void {
		if (this.pickerTimer) {
			clearTimeout(this.pickerTimer);
			this.pickerTimer = null;
		}
	}

	// --- Canvas output ---

	private setCanvas(dataUri: string): void {
		for (const action of this.actions) {
			if (action.isDial()) {
				action.setFeedback({ canvas: dataUri });
			}
		}
	}
}
