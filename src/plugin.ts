import streamDeck from "@elgato/streamdeck";

import { HyperXBatteryAction } from "./actions/hyperx-battery.js";

streamDeck.logger.setLevel("info");

const batteryAction = new HyperXBatteryAction();
streamDeck.actions.registerAction(batteryAction);
streamDeck.system.onSystemDidWakeUp(() => {
	batteryAction.wakeRefreshAll();
});

streamDeck.connect();
