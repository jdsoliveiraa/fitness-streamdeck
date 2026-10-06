import type { PauseState } from "../types";

const LABELS: Record<PauseState, string> = {
	pausing: "PAUSING…",
	paused: "PAUSED",
	resuming: "RESUMING…",
};

export const PAUSE_COLOR = "#ffaa00";
export const STOP_COLOR = "#ff4444";

export function pauseLabel(state: PauseState | null | undefined): string {
	return state ? LABELS[state] : "";
}
