import streamDeck from "@elgato/streamdeck";

process.on("uncaughtException", (err) => {
	streamDeck.logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
});
process.on("unhandledRejection", (reason) => {
	streamDeck.logger.error(`Unhandled rejection: ${reason}`);
});

import { StartStopAction } from "./actions/start-stop";
import { SpeedUpAction } from "./actions/speed-up";
import { SpeedDownAction } from "./actions/speed-down";
import { StatusDisplayAction } from "./actions/status-display";
import { WorkoutAction } from "./actions/workout";
import { SpeedDialAction } from "./actions/speed-dial";
import { WorkoutDialAction } from "./actions/workout-dial";
import { StatusDialAction } from "./actions/status-dial";
import { workoutManager } from "./services/workout-manager";
import type { FitDeckGlobalSettings } from "./types";

streamDeck.settings.onDidReceiveGlobalSettings<FitDeckGlobalSettings>((ev) => {
	workoutManager.loadPlans(ev.settings);
});

streamDeck.actions.registerAction(new StartStopAction());
streamDeck.actions.registerAction(new SpeedUpAction());
streamDeck.actions.registerAction(new SpeedDownAction());
streamDeck.actions.registerAction(new StatusDisplayAction());
streamDeck.actions.registerAction(new WorkoutAction());
streamDeck.actions.registerAction(new SpeedDialAction());
streamDeck.actions.registerAction(new WorkoutDialAction());
streamDeck.actions.registerAction(new StatusDialAction());

streamDeck.connect().then(() => {
	streamDeck.settings.getGlobalSettings<FitDeckGlobalSettings>();
});
