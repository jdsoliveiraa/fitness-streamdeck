import type { JsonObject } from "@elgato/utils";

// --- Treadmill State ---

export interface TreadmillStatus {
	status: string;
	statusCode: number;
	speed: number;
	incline: number;
	elapsedSeconds: number;
	distance: number;
	calories: number;
	steps: number;
	heartRate: number;
}

export type ConnectionState = "disconnected" | "scanning" | "connecting" | "connected";

export interface TreadmillDeviceInfo {
	maxSpeed: number;
	minSpeed: number;
	maxIncline: number;
	minIncline: number;
}

// --- Workout Plans ---

export type GoalType = "time" | "distance" | "calories";

export interface WorkoutPlan {
	id: string;
	name: string;
	goalType: GoalType;
	goalValue: number;
	speed: number;
	incline: number;
	description: string;
}

export interface WorkoutProgress {
	plan: WorkoutPlan;
	startedAt: number;
	initialCalories: number;
	initialDistance: number;
	initialSeconds: number;
	currentValue: number;
	targetValue: number;
	percentComplete: number;
	lastSessionCal: number;
	lastSessionDist: number;
	lastSessionSec: number;
	isComplete: boolean;
	isAborted: boolean;
}

// --- Action Settings ---

export interface StartStopSettings extends JsonObject {
	// no per-instance settings
}

export interface SpeedSettings extends JsonObject {
	stepSize?: number;
}

export interface StatusDisplaySettings extends JsonObject {
	viewMode?: number;
}

export interface WorkoutKeySettings extends JsonObject {
	selectedPlanId?: string;
}

export interface SpeedDialSettings extends JsonObject {
	stepSize?: number;
}

export interface WorkoutDialSettings extends JsonObject {
	selectedPlanIndex?: number;
}

export interface StatusDialSettings extends JsonObject {
	currentView?: number;
}

// --- Global Settings ---

export type FitDeckGlobalSettings = JsonObject & {
	plans?: WorkoutPlan[];
};
