/**
 * SVG renderers for Stream Deck Plus encoder touch displays (200×100).
 */

function esc(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60).toString().padStart(2, "0");
	const s = (seconds % 60).toString().padStart(2, "0");
	return `${m}:${s}`;
}

function formatDist(km: number): string {
	return km < 1 ? `${(km * 1000).toFixed(0)}m` : `${km.toFixed(2)}km`;
}

function svg(inner: string): string {
	return `data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">` +
		`<defs>` +
		`<linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">` +
		`<stop offset="0%" stop-color="#00cc66"/>` +
		`<stop offset="100%" stop-color="#00ff88"/>` +
		`</linearGradient>` +
		`<linearGradient id="g2" x1="0" y1="0" x2="1" y2="0">` +
		`<stop offset="0%" stop-color="#ff8800"/>` +
		`<stop offset="100%" stop-color="#ffcc00"/>` +
		`</linearGradient>` +
		`<linearGradient id="g3" x1="0" y1="0" x2="1" y2="0">` +
		`<stop offset="0%" stop-color="#3366ff"/>` +
		`<stop offset="100%" stop-color="#66aaff"/>` +
		`</linearGradient>` +
		`</defs>` +
		inner +
		`</svg>`
	)}`;
}

/** Rounded bar with gradient fill, glow effect */
function progressBar(x: number, y: number, w: number, h: number, pct: number, gradient: string): string {
	const fill = Math.max(h, (pct / 100) * w); // min width = height for rounded caps
	const clampedFill = pct <= 0 ? 0 : Math.min(fill, w);
	const r = h / 2;
	return (
		`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#1a1a2e" stroke="#333" stroke-width="1"/>` +
		(clampedFill > 0
			? `<rect x="${x}" y="${y}" width="${clampedFill}" height="${h}" rx="${r}" fill="url(#${gradient})" opacity="0.9"/>` +
			  `<rect x="${x}" y="${y}" width="${clampedFill}" height="${h}" rx="${r}" fill="url(#${gradient})" opacity="0.3" filter="blur(2px)"/>`
			: "")
	);
}

// ── Speed Dial: Stats View ──────────────────────────────────────────────

export interface StatsViewData {
	speed: number;
	distance: number;
	elapsedSeconds: number;
	calories: number;
	maxSpeed: number;
	statusCode: number;
}

export function renderStatsView(d: StatsViewData): string {
	const pct = d.maxSpeed > 0 ? (d.speed / d.maxSpeed) * 100 : 0;
	const stateColor = d.statusCode === 3 ? "#00cc66" : d.statusCode === 2 ? "#ffaa00" : "#555";

	return svg(
		// Background
		`<rect width="200" height="100" fill="#0d0d1a" rx="0"/>` +

		// Speed — left column, prominent
		`<text x="12" y="16" fill="#777" font-family="Arial,sans-serif" font-size="9" font-weight="600">SPEED</text>` +
		`<text x="12" y="42" fill="#fff" font-family="Arial,sans-serif" font-size="26" font-weight="700">${d.speed.toFixed(1)}</text>` +
		`<text x="${12 + (d.speed >= 10 ? 60 : 46)}" y="42" fill="#666" font-family="Arial,sans-serif" font-size="10">km/h</text>` +

		// Status dot
		`<circle cx="190" cy="12" r="4" fill="${stateColor}"/>` +

		// Speed mini-bar under speed value
		progressBar(12, 50, 80, 6, pct, "g1") +

		// Right column — stacked metrics
		`<text x="112" y="16" fill="#777" font-family="Arial,sans-serif" font-size="9" font-weight="600">DIST</text>` +
		`<text x="112" y="30" fill="#ccc" font-family="Arial,sans-serif" font-size="13" font-weight="600">${esc(formatDist(d.distance))}</text>` +

		`<text x="112" y="48" fill="#777" font-family="Arial,sans-serif" font-size="9" font-weight="600">TIME</text>` +
		`<text x="112" y="62" fill="#ccc" font-family="Arial,sans-serif" font-size="13" font-weight="600">${formatTime(d.elapsedSeconds)}</text>` +

		`<text x="112" y="80" fill="#777" font-family="Arial,sans-serif" font-size="9" font-weight="600">CAL</text>` +
		`<text x="112" y="94" fill="#ff9900" font-family="Arial,sans-serif" font-size="13" font-weight="600">${d.calories.toFixed(1)}</text>` +

		// Divider
		`<line x1="104" y1="8" x2="104" y2="96" stroke="#222" stroke-width="1"/>`
	);
}

// ── Speed Dial: Speed Focus View ────────────────────────────────────────

export interface SpeedFocusData {
	speed: number;
	minSpeed: number;
	maxSpeed: number;
}

export function renderSpeedFocus(d: SpeedFocusData): string {
	const range = d.maxSpeed - d.minSpeed;
	const pct = range > 0 ? ((d.speed - d.minSpeed) / range) * 100 : 0;

	return svg(
		`<rect width="200" height="100" fill="#0d0d1a" rx="0"/>` +

		// Title
		`<text x="100" y="16" text-anchor="middle" fill="#777" font-family="Arial,sans-serif" font-size="10" font-weight="600">SPEED</text>` +

		// Big speed value
		`<text x="100" y="52" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="34" font-weight="700">${d.speed.toFixed(1)}</text>` +
		`<text x="100" y="66" text-anchor="middle" fill="#555" font-family="Arial,sans-serif" font-size="10">km/h</text>` +

		// Stylized progress bar
		progressBar(16, 76, 168, 10, pct, "g1") +

		// Min/max labels
		`<text x="16" y="98" fill="#444" font-family="Arial,sans-serif" font-size="8">${d.minSpeed.toFixed(0)}</text>` +
		`<text x="184" y="98" text-anchor="end" fill="#444" font-family="Arial,sans-serif" font-size="8">${d.maxSpeed.toFixed(0)}</text>`
	);
}

// ── Speed Dial: Offline/Scanning View ───────────────────────────────────

export function renderOfflineView(label: string): string {
	return svg(
		`<rect width="200" height="100" fill="#0d0d1a" rx="0"/>` +
		`<text x="100" y="54" text-anchor="middle" fill="#555" font-family="Arial,sans-serif" font-size="14" font-weight="600">${esc(label)}</text>`
	);
}

// ── Workout Dial: Goal Selector (in browse list) ───────────────────────

export function renderGoalSelector(goalType: string): string {
	const labels: Record<string, { name: string; desc: string; icon: string }> = {
		distance: { name: "Distance", desc: "Set a distance target", icon: "&#x1F3C3;" },
		time:     { name: "Time",     desc: "Set a time target",     icon: "&#x23F1;" },
		calories: { name: "Calories", desc: "Set a calorie target",  icon: "&#x1F525;" },
	};
	const l = labels[goalType] ?? labels.distance;

	return svg(
		`<rect width="200" height="100" fill="#0d0d1a" rx="0"/>` +

		`<text x="100" y="16" text-anchor="middle" fill="#5588cc" font-family="Arial,sans-serif" font-size="9" font-weight="600">GOAL</text>` +

		`<text x="100" y="44" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="18" font-weight="700">${esc(l.name)}</text>` +

		`<text x="100" y="64" text-anchor="middle" fill="#666" font-family="Arial,sans-serif" font-size="10">${esc(l.desc)}</text>` +

		// Blue bar placeholder
		progressBar(16, 76, 168, 10, 0, "g3") +

		`<text x="100" y="98" text-anchor="middle" fill="#444" font-family="Arial,sans-serif" font-size="8">PUSH TO SET</text>`
	);
}

// ── Workout Dial: Goal Value Picker ────────────────────────────────────

export function renderGoalPicker(goalType: string, value: number): string {
	const units: Record<string, string> = { distance: "km", time: "min", calories: "cal" };
	const unit = units[goalType] ?? "";
	const display = goalType === "distance" ? value.toFixed(1) : String(value);
	const title = goalType === "distance" ? "SET DISTANCE" : goalType === "time" ? "SET TIME" : "SET CALORIES";

	return svg(
		`<rect width="200" height="100" fill="#0d0d1a" rx="0"/>` +

		`<text x="100" y="16" text-anchor="middle" fill="#5588cc" font-family="Arial,sans-serif" font-size="9" font-weight="600">${esc(title)}</text>` +

		// Arrows
		`<text x="30" y="52" text-anchor="middle" fill="#444" font-family="Arial,sans-serif" font-size="18">\u25C0</text>` +
		`<text x="170" y="52" text-anchor="middle" fill="#444" font-family="Arial,sans-serif" font-size="18">\u25B6</text>` +

		// Big value
		`<text x="100" y="54" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="30" font-weight="700">${esc(display)}</text>` +
		`<text x="100" y="70" text-anchor="middle" fill="#555" font-family="Arial,sans-serif" font-size="11">${esc(unit)}</text>` +

		progressBar(16, 80, 168, 8, 0, "g3") +

		`<text x="100" y="98" text-anchor="middle" fill="#5588cc" font-family="Arial,sans-serif" font-size="8">PUSH TO START</text>`
	);
}

// ── Workout Dial: Completion Summary ───────────────────────────────────

export interface WorkoutSummaryData {
	name: string;
	distance: number;
	elapsedSeconds: number;
	calories: number;
}

export function renderWorkoutSummary(d: WorkoutSummaryData): string {
	return svg(
		`<rect width="200" height="100" fill="#0d0d1a" rx="0"/>` +

		// Header
		`<text x="100" y="14" text-anchor="middle" fill="#00cc66" font-family="Arial,sans-serif" font-size="9" font-weight="600">COMPLETE</text>` +
		`<text x="100" y="30" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="13" font-weight="700">${esc(d.name)}</text>` +

		// Full green bar
		progressBar(16, 36, 168, 6, 100, "g1") +

		// Metrics row
		`<text x="36" y="58" text-anchor="middle" fill="#777" font-family="Arial,sans-serif" font-size="8" font-weight="600">DIST</text>` +
		`<text x="36" y="72" text-anchor="middle" fill="#ccc" font-family="Arial,sans-serif" font-size="13" font-weight="600">${esc(formatDist(d.distance))}</text>` +

		`<text x="100" y="58" text-anchor="middle" fill="#777" font-family="Arial,sans-serif" font-size="8" font-weight="600">TIME</text>` +
		`<text x="100" y="72" text-anchor="middle" fill="#ccc" font-family="Arial,sans-serif" font-size="13" font-weight="600">${formatTime(d.elapsedSeconds)}</text>` +

		`<text x="164" y="58" text-anchor="middle" fill="#777" font-family="Arial,sans-serif" font-size="8" font-weight="600">CAL</text>` +
		`<text x="164" y="72" text-anchor="middle" fill="#ff9900" font-family="Arial,sans-serif" font-size="13" font-weight="600">${d.calories.toFixed(1)}</text>` +

		// Dividers
		`<line x1="68" y1="52" x2="68" y2="78" stroke="#222" stroke-width="1"/>` +
		`<line x1="132" y1="52" x2="132" y2="78" stroke="#222" stroke-width="1"/>` +

		`<text x="100" y="94" text-anchor="middle" fill="#444" font-family="Arial,sans-serif" font-size="8">PUSH TO DISMISS</text>`
	);
}

// ── Workout Dial: Plan Browser ──────────────────────────────────────────

export function renderWorkoutBrowser(name: string, description: string): string {
	return svg(
		`<rect width="200" height="100" fill="#0d0d1a" rx="0"/>` +

		`<text x="100" y="16" text-anchor="middle" fill="#777" font-family="Arial,sans-serif" font-size="9" font-weight="600">WORKOUT</text>` +

		`<text x="100" y="44" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="18" font-weight="700">${esc(name)}</text>` +

		`<text x="100" y="64" text-anchor="middle" fill="#666" font-family="Arial,sans-serif" font-size="10">${esc(description)}</text>` +

		// Empty bar placeholder
		progressBar(16, 76, 168, 10, 0, "g2") +

		`<text x="100" y="98" text-anchor="middle" fill="#444" font-family="Arial,sans-serif" font-size="8">PUSH TO START</text>`
	);
}

// ── Workout Dial: Active Progress ───────────────────────────────────────

export function renderWorkoutProgress(name: string, pct: number, subtitle: string, isComplete: boolean, isGoal = false): string {
	const gradient = isComplete ? "g1" : isGoal ? "g3" : "g2";
	const valueText = isComplete ? "DONE!" : `${Math.round(pct)}%`;
	const valueColor = isComplete ? "#00cc66" : "#fff";

	return svg(
		`<rect width="200" height="100" fill="#0d0d1a" rx="0"/>` +

		`<text x="100" y="16" text-anchor="middle" fill="#777" font-family="Arial,sans-serif" font-size="9" font-weight="600">${esc(name)}</text>` +

		// Percentage
		`<text x="100" y="48" text-anchor="middle" fill="${valueColor}" font-family="Arial,sans-serif" font-size="28" font-weight="700">${esc(valueText)}</text>` +

		// Progress bar
		progressBar(16, 58, 168, 10, pct, gradient) +

		// Subtitle
		`<text x="100" y="84" text-anchor="middle" fill="#888" font-family="Arial,sans-serif" font-size="10">${esc(subtitle)}</text>` +

		`<text x="100" y="98" text-anchor="middle" fill="#444" font-family="Arial,sans-serif" font-size="8">${isComplete ? "PUSH TO RESET" : "PUSH TO STOP"}</text>`
	);
}
