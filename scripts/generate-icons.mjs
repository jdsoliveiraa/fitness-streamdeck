/**
 * Generate all plugin icons from Lucide-style SVG paths → PNG via sharp.
 * Run: node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import path from "path";

const IMGS = "com.jdsoliveiraa.fitdeck.sdPlugin/imgs";

// --- Lucide SVG paths (24x24 viewBox, stroke-based) ---

const PATHS = {
	play: `<polygon points="6 3 20 12 6 21 6 3"/>`,
	stop: `<rect width="14" height="14" x="5" y="5" rx="1"/>`,
	playCircle: `<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>`,
	chevronUp: `<path d="m18 15-6-6-6 6"/>`,
	chevronDown: `<path d="m6 9 6 6 6-6"/>`,
	activity: `<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>`,
	target: `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`,
	gauge: `<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>`,
	timer: `<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>`,
	barChart: `<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>`,
};

// --- SVG builders ---

function iconSvg(size, content, { fill = "none", stroke = "#FFFFFF", strokeWidth = 2 } = {}) {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
			`fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" ` +
			`stroke-linecap="round" stroke-linejoin="round">${content}</svg>`,
	);
}

function brandSvg(size, content, bgColor = "#00CC66") {
	// Icon on a rounded-rect background
	const pad = 3; // viewBox padding so the icon doesn't touch the edge
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-${pad} -${pad} ${24 + pad * 2} ${24 + pad * 2}">` +
			`<rect x="-${pad}" y="-${pad}" width="${24 + pad * 2}" height="${24 + pad * 2}" rx="5" fill="${bgColor}"/>` +
			`<g fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${content}</g>` +
			`</svg>`,
	);
}

function filledIconSvg(size, content, { fill = "#FFFFFF", stroke = "none" } = {}) {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
			`fill="${fill}" stroke="${stroke}" stroke-width="0" ` +
			`stroke-linecap="round" stroke-linejoin="round">${content}</svg>`,
	);
}

// --- Generation ---

async function writePng(filepath, svgBuffer) {
	await sharp(svgBuffer).png().toFile(filepath);
	console.log(`  ${filepath}`);
}

async function actionIcon(dir, iconPath, opts) {
	// Action list icon: 20x20 @1x, 40x40 @2x
	await writePng(path.join(dir, "action.png"), iconSvg(20, iconPath, opts));
	await writePng(path.join(dir, "action@2x.png"), iconSvg(40, iconPath, opts));
}

async function keyState(dir, name, iconPath, opts) {
	// Key state image: 72x72 @1x, 144x144 @2x
	await writePng(path.join(dir, `${name}.png`), iconSvg(72, iconPath, opts));
	await writePng(path.join(dir, `${name}@2x.png`), iconSvg(144, iconPath, opts));
}

async function main() {
	console.log("Generating icons...\n");

	// --- Plugin branding ---
	const pluginDir = path.join(IMGS, "plugin");
	// Marketplace: 288x288 (branded with bg)
	await writePng(path.join(pluginDir, "marketplace.png"), brandSvg(288, PATHS.activity));
	await writePng(path.join(pluginDir, "marketplace@2x.png"), brandSvg(512, PATHS.activity));
	// Category: 28x28 / 56x56 (branded with bg)
	await writePng(path.join(pluginDir, "category-icon.png"), brandSvg(28, PATHS.activity));
	await writePng(path.join(pluginDir, "category-icon@2x.png"), brandSvg(56, PATHS.activity));

	// --- Start / Stop ---
	const startStopDir = path.join(IMGS, "actions/start-stop");
	await actionIcon(startStopDir, PATHS.playCircle);
	// Key states: filled play triangle (green tint) and filled stop square (red tint)
	await writePng(path.join(startStopDir, "start.png"), filledIconSvg(72, PATHS.play));
	await writePng(path.join(startStopDir, "start@2x.png"), filledIconSvg(144, PATHS.play));
	await writePng(path.join(startStopDir, "stop.png"), filledIconSvg(72, PATHS.stop));
	await writePng(path.join(startStopDir, "stop@2x.png"), filledIconSvg(144, PATHS.stop));

	// --- Speed Up ---
	await actionIcon(path.join(IMGS, "actions/speed-up"), PATHS.chevronUp);

	// --- Speed Down ---
	await actionIcon(path.join(IMGS, "actions/speed-down"), PATHS.chevronDown);

	// --- Status Display ---
	await actionIcon(path.join(IMGS, "actions/status-display"), PATHS.activity);

	// --- Workout ---
	await actionIcon(path.join(IMGS, "actions/workout"), PATHS.target);

	// --- Speed Dial ---
	await actionIcon(path.join(IMGS, "actions/speed-dial"), PATHS.gauge);

	// --- Workout Dial ---
	await actionIcon(path.join(IMGS, "actions/workout-dial"), PATHS.timer);

	// --- Status Dial ---
	await actionIcon(path.join(IMGS, "actions/status-dial"), PATHS.barChart);

	console.log("\nDone!");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
