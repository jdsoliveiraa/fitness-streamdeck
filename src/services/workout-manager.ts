/**
 * WorkoutManager — tracks goal-based workouts and auto-stops when complete.
 *
 * Ports the goal workout logic from poc/control.js to a reusable service
 * that Stream Deck actions can subscribe to.
 */
import { EventEmitter } from "events";
import { treadmillService } from "./treadmill-service";
import type { WorkoutPlan, WorkoutProgress, TreadmillStatus, FitDeckGlobalSettings } from "../types";

export const DEFAULT_PLANS: WorkoutPlan[] = [
	{ id: "quick-walk", name: "Quick Walk", goalType: "time", goalValue: 10, speed: 3.5, incline: 0, description: "10 min at 3.5 km/h" },
	{ id: "brisk-walk", name: "Brisk Walk", goalType: "time", goalValue: 20, speed: 5.0, incline: 0, description: "20 min at 5.0 km/h" },
	{ id: "fat-burn", name: "Fat Burn", goalType: "time", goalValue: 30, speed: 4.5, incline: 2, description: "30 min at 4.5 km/h, 2%" },
	{ id: "5k-run", name: "5K Run", goalType: "distance", goalValue: 5.0, speed: 8.0, incline: 0, description: "5 km at 8.0 km/h" },
	{ id: "100-cal-burn", name: "100 Cal Burn", goalType: "calories", goalValue: 100, speed: 5.5, incline: 0, description: "100 cal at 5.5 km/h" },
];

export function generateDescription(plan: WorkoutPlan): string {
	const unit = plan.goalType === "time" ? "min" : plan.goalType === "distance" ? "km" : "cal";
	let desc = `${plan.goalValue} ${unit} at ${plan.speed} km/h`;
	if (plan.incline > 0) desc += `, ${plan.incline}%`;
	return desc;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WorkoutManager extends EventEmitter {
	activeWorkout: WorkoutProgress | null = null;
	private statusHandler: ((status: TreadmillStatus) => void) | null = null;
	private _plans: WorkoutPlan[] | null = null;

	get plans(): WorkoutPlan[] {
		return this._plans ?? DEFAULT_PLANS;
	}

	loadPlans(globalSettings: FitDeckGlobalSettings): void {
		this._plans = globalSettings.plans?.length ? globalSettings.plans : null;
		this.emit("plans-changed", this.plans);
	}

	savePlan(plan: WorkoutPlan): WorkoutPlan[] {
		const list = [...this.plans];
		const idx = list.findIndex((p) => p.id === plan.id);
		plan.description = generateDescription(plan);
		if (idx >= 0) list[idx] = plan;
		else list.push(plan);
		this._plans = list;
		this.emit("plans-changed", this.plans);
		return this.plans;
	}

	deletePlan(planId: string): WorkoutPlan[] {
		const list = this.plans.filter((p) => p.id !== planId);
		this._plans = list.length ? list : null;
		this.emit("plans-changed", this.plans);
		return this.plans;
	}

	resetPlans(): WorkoutPlan[] {
		this._plans = null;
		this.emit("plans-changed", this.plans);
		return this.plans;
	}

	get isActive(): boolean {
		return this.activeWorkout !== null && !this.activeWorkout.isComplete && !this.activeWorkout.isAborted;
	}

	get progress(): WorkoutProgress | null {
		return this.activeWorkout;
	}

	async startWorkout(plan: WorkoutPlan): Promise<void> {
		if (this.isActive) return;

		let initial: TreadmillStatus;
		try {
			// Wait for a status to capture baseline
			initial = await treadmillService.waitForStatus();
		} catch {
			// Timeout — BLE helper is not sending status updates
			return;
		}

		const targetValue = plan.goalType === "time" ? Math.round(plan.goalValue * 60) : plan.goalValue;

		this.activeWorkout = {
			plan,
			startedAt: Date.now(),
			initialCalories: initial.calories ?? 0,
			initialDistance: initial.distance ?? 0,
			initialSeconds: initial.elapsedSeconds ?? 0,
			currentValue: 0,
			targetValue,
			percentComplete: 0,
			lastSessionCal: 0,
			lastSessionDist: 0,
			lastSessionSec: 0,
			isComplete: false,
			isAborted: false,
		};

		this.emit("progress", this.activeWorkout);

		// Start treadmill if not already running
		if (initial.statusCode !== 3) {
			await treadmillService.start();
			try {
				await treadmillService.waitForStatus((s) => s.statusCode === 3);
			} catch {
				// Timeout waiting for RUNNING state — abort
				this.activeWorkout.isAborted = true;
				this.emit("aborted", this.activeWorkout);
				return;
			}
			await sleep(500);
		}

		// Set speed (twice for reliability, matching PoC pattern)
		if (plan.incline > 0) {
			await treadmillService.setSpeedAndIncline(plan.speed, plan.incline);
		} else {
			await treadmillService.setSpeed(plan.speed);
		}
		await sleep(1000);
		if (plan.incline > 0) {
			await treadmillService.setSpeedAndIncline(plan.speed, plan.incline);
		} else {
			await treadmillService.setSpeed(plan.speed);
		}

		// Start monitoring
		this.statusHandler = (status: TreadmillStatus) => this.onStatus(status);
		treadmillService.on("status", this.statusHandler);
	}

	async abortWorkout(): Promise<void> {
		if (!this.activeWorkout || this.activeWorkout.isComplete) return;

		this.activeWorkout.isAborted = true;
		this.cleanup();
		await treadmillService.stop();
		this.emit("aborted", this.activeWorkout);
	}

	private onStatus(status: TreadmillStatus): void {
		if (!this.activeWorkout || this.activeWorkout.isComplete || this.activeWorkout.isAborted) return;

		// Only track progress while RUNNING
		if (status.statusCode !== 3) return;

		const w = this.activeWorkout;
		const sessionCal = (status.calories ?? 0) - w.initialCalories;
		const sessionDist = (status.distance ?? 0) - w.initialDistance;
		const sessionSec = (status.elapsedSeconds ?? 0) - w.initialSeconds;

		// Track last good values (treadmill resets on stop)
		w.lastSessionCal = sessionCal;
		w.lastSessionDist = sessionDist;
		w.lastSessionSec = sessionSec;

		switch (w.plan.goalType) {
			case "calories":
				w.currentValue = sessionCal;
				break;
			case "distance":
				w.currentValue = sessionDist;
				break;
			case "time":
				w.currentValue = sessionSec;
				break;
		}

		w.percentComplete = Math.min((w.currentValue / w.targetValue) * 100, 100);
		this.emit("progress", w);

		// Goal reached
		if (w.currentValue >= w.targetValue) {
			w.isComplete = true;
			w.percentComplete = 100;
			this.cleanup();
			treadmillService.stop();
			this.emit("complete", w);
		}
	}

	private cleanup(): void {
		if (this.statusHandler) {
			treadmillService.off("status", this.statusHandler);
			this.statusHandler = null;
		}
	}
}

export const workoutManager = new WorkoutManager();
