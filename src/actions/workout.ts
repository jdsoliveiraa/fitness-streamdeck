import streamDeck, { action, SingletonAction, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent, type DidReceiveSettingsEvent, type SendToPluginEvent, type PropertyInspectorDidAppearEvent } from "@elgato/streamdeck";
import { treadmillService } from "../services/treadmill-service";
import { workoutManager } from "../services/workout-manager";
import { renderWorkoutKey } from "../util/svg-renderer";
import type { WorkoutKeySettings, WorkoutProgress, FitDeckGlobalSettings } from "../types";
import type { JsonValue } from "@elgato/utils";

function formatProgressLabel(w: WorkoutProgress): string {
	const fmt = (s: number) => {
		const m = Math.floor(s / 60).toString().padStart(2, "0");
		const sec = (s % 60).toString().padStart(2, "0");
		return `${m}:${sec}`;
	};
	switch (w.plan.goalType) {
		case "calories":
			return `${w.currentValue.toFixed(1)} / ${w.targetValue} cal`;
		case "distance":
			return `${w.currentValue.toFixed(3)} / ${w.targetValue} km`;
		case "time":
			return `${fmt(w.currentValue)} / ${fmt(w.targetValue)}`;
		default:
			return "";
	}
}

@action({ UUID: "com.jdsoliveiraa.fitdeck.workout" })
export class WorkoutAction extends SingletonAction<WorkoutKeySettings> {
	private listening = false;

	private progressHandler = (w: WorkoutProgress) => {
		const label = formatProgressLabel(w);
		const svg = renderWorkoutKey(w.plan.name, w.percentComplete, label, true, false);
		for (const action of this.actions) {
			if (action.isKey()) {
				action.setImage(svg);
			}
		}
	};

	private completeHandler = (w: WorkoutProgress) => {
		const label = formatProgressLabel(w);
		const svg = renderWorkoutKey(w.plan.name, 100, label, false, true);
		for (const action of this.actions) {
			if (action.isKey()) {
				action.setImage(svg);
				action.showOk();
			}
		}
	};

	private abortedHandler = () => {
		this.showIdleState();
	};

	private plansChangedHandler = () => {
		if (!workoutManager.isActive) this.showIdleState();
	};

	override async onWillAppear(ev: WillAppearEvent<WorkoutKeySettings>): Promise<void> {
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
			const label = formatProgressLabel(w);
			const svg = renderWorkoutKey(w.plan.name, w.percentComplete, label, true, false);
			if (ev.action.isKey()) ev.action.setImage(svg);
		} else {
			this.showIdleForAction(ev);
		}
	}

	override async onWillDisappear(_ev: WillDisappearEvent<WorkoutKeySettings>): Promise<void> {
		if ([...this.actions].length === 0) {
			workoutManager.off("progress", this.progressHandler);
			workoutManager.off("complete", this.completeHandler);
			workoutManager.off("aborted", this.abortedHandler);
			workoutManager.off("plans-changed", this.plansChangedHandler);
			this.listening = false;
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<WorkoutKeySettings>): Promise<void> {
		if (!workoutManager.isActive) {
			this.showIdleForAction(ev);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<WorkoutKeySettings>): Promise<void> {
		if (workoutManager.isActive) {
			await workoutManager.abortWorkout();
			return;
		}

		if (!treadmillService.isConnected) {
			if (ev.action.isKey()) ev.action.showAlert();
			return;
		}

		const plans = workoutManager.plans;
		const planId = ev.payload.settings.selectedPlanId ?? plans[0]?.id;
		const plan = plans.find((p) => p.id === planId) ?? plans[0];
		if (plan) await workoutManager.startWorkout(plan);
	}

	override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<WorkoutKeySettings>): Promise<void> {
		(ev.action as any).sendToPropertyInspector({ event: "plans", plans: workoutManager.plans });
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, WorkoutKeySettings>): Promise<void> {
		const msg = ev.payload as Record<string, any>;
		const reply = (data: Record<string, unknown>) => {
			(ev.action as any).sendToPropertyInspector(data);
		};
		let plans: typeof workoutManager.plans;

		switch (msg.action) {
			case "getPlans":
				reply({ event: "plans", plans: workoutManager.plans });
				break;
			case "savePlan":
				plans = workoutManager.savePlan(msg.plan);
				await streamDeck.settings.setGlobalSettings({ plans } as FitDeckGlobalSettings);
				reply({ event: "plans", plans });
				break;
			case "deletePlan":
				plans = workoutManager.deletePlan(msg.planId);
				await streamDeck.settings.setGlobalSettings({ plans } as FitDeckGlobalSettings);
				reply({ event: "plans", plans });
				break;
			case "resetPlans":
				plans = workoutManager.resetPlans();
				await streamDeck.settings.setGlobalSettings({ plans } as FitDeckGlobalSettings);
				reply({ event: "plans", plans });
				break;
		}
	}

	private showIdleState(): void {
		for (const action of this.actions) {
			if (action.isKey()) {
				action.getSettings().then((settings) => {
					const plans = workoutManager.plans;
					const planId = settings.selectedPlanId ?? plans[0]?.id;
					const plan = plans.find((p) => p.id === planId) ?? plans[0];
					if (plan) {
						const svg = renderWorkoutKey(plan.name, 0, plan.description, false, false);
						action.setImage(svg);
					}
				});
			}
		}
	}

	private showIdleForAction(ev: { action: { isKey(): boolean; setImage(svg: string): Promise<void> }; payload: { settings: WorkoutKeySettings } }): void {
		if (!ev.action.isKey()) return;
		const plans = workoutManager.plans;
		const planId = ev.payload.settings.selectedPlanId ?? plans[0]?.id;
		const plan = plans.find((p) => p.id === planId) ?? plans[0];
		if (plan) {
			const svg = renderWorkoutKey(plan.name, 0, plan.description, false, false);
			ev.action.setImage(svg);
		}
	}
}
