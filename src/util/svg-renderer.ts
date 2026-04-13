import type { TreadmillStatus, ConnectionState } from "../types";

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60).toString().padStart(2, "0");
	const s = (seconds % 60).toString().padStart(2, "0");
	return `${m}:${s}`;
}

function escapeXml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderStatusKey(status: TreadmillStatus | null, connectionState: ConnectionState): string {
	if (connectionState !== "connected" || !status) {
		const label = connectionState === "scanning" ? "Scanning..." : connectionState === "connecting" ? "Connecting..." : "Offline";
		return `data:image/svg+xml,${encodeURIComponent(`
			<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
				<rect width="144" height="144" fill="#1a1a2e" rx="12"/>
				<text x="72" y="76" text-anchor="middle" fill="#666" font-family="Arial" font-size="14" font-weight="bold">${escapeXml(label)}</text>
			</svg>
		`)}`;
	}

	const speed = status.speed.toFixed(1);
	const dist = status.distance < 1 ? `${(status.distance * 1000).toFixed(0)}m` : `${status.distance.toFixed(2)}km`;
	const time = formatTime(status.elapsedSeconds);
	const cal = status.calories.toFixed(1);
	const stateColor = status.statusCode === 3 ? "#00cc66" : status.statusCode === 2 ? "#ffaa00" : "#666666";

	return `data:image/svg+xml,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
			<rect width="144" height="144" fill="#1a1a2e" rx="12"/>
			<circle cx="72" cy="8" r="4" fill="${stateColor}"/>
			<text x="72" y="48" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="28" font-weight="bold">${speed}</text>
			<text x="72" y="62" text-anchor="middle" fill="#888" font-family="Arial" font-size="10">km/h</text>
			<line x1="20" y1="72" x2="124" y2="72" stroke="#333" stroke-width="1"/>
			<text x="36" y="92" text-anchor="middle" fill="#aaa" font-family="Arial" font-size="12">${escapeXml(time)}</text>
			<text x="108" y="92" text-anchor="middle" fill="#aaa" font-family="Arial" font-size="12">${escapeXml(dist)}</text>
			<text x="72" y="116" text-anchor="middle" fill="#ff9900" font-family="Arial" font-size="14" font-weight="bold">${cal} cal</text>
			<text x="72" y="136" text-anchor="middle" fill="#555" font-family="Arial" font-size="9">${escapeXml(status.status)}</text>
		</svg>
	`)}`;
}

export function renderWorkoutKey(
	planName: string,
	percentComplete: number,
	progressLabel: string,
	isActive: boolean,
	isComplete: boolean,
): string {
	const barWidth = Math.round((percentComplete / 100) * 104);
	const barColor = isComplete ? "#00cc66" : "#ff9900";
	const label = isComplete ? "DONE!" : isActive ? `${Math.round(percentComplete)}%` : planName;

	return `data:image/svg+xml,${encodeURIComponent(`
		<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
			<rect width="144" height="144" fill="#1a1a2e" rx="12"/>
			<text x="72" y="40" text-anchor="middle" fill="#ffffff" font-family="Arial" font-size="13" font-weight="bold">${escapeXml(label)}</text>
			<rect x="20" y="54" width="104" height="10" rx="5" fill="#333"/>
			<rect x="20" y="54" width="${barWidth}" height="10" rx="5" fill="${barColor}"/>
			<text x="72" y="84" text-anchor="middle" fill="#aaa" font-family="Arial" font-size="11">${escapeXml(progressLabel)}</text>
			<text x="72" y="110" text-anchor="middle" fill="${isActive ? '#00cc66' : '#666'}" font-family="Arial" font-size="10">${isActive ? 'TAP TO STOP' : 'TAP TO START'}</text>
		</svg>
	`)}`;
}
