import {
	spawnSync,
	type SpawnSyncOptionsWithStringEncoding,
	type SpawnSyncReturns,
} from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import streamDeck, { action, type KeyAction, SingletonAction, Target } from "@elgato/streamdeck";
import type {
	DidReceiveSettingsEvent,
	KeyDownEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { buildBatteryKeyDataUrl, buildErrorKeyDataUrl } from "../key-art.js";

/** Bundled plugin.js lives in `<sdPlugin>/bin/plugin.js`; script is sibling `scripts/`. */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SCRIPT = path.join(PLUGIN_ROOT, "scripts", "hyperx_alpha_battery.py");

export type BatterySettings = {
	pythonPath?: string;
	scriptPath?: string;
	pollSeconds?: number;
};

type BatteryJson =
	| {
			ok: true;
			level: number;
			charging?: boolean;
			status: string;
			proto: string;
			mv: number;
			product: string;
			pid: string;
	  }
	| {
			ok: false;
			error: string;
			error_code?: string;
	  };

/** Prefer the last line that parses as JSON (handles a leading warning line on stdout). */
function parseLastBatteryJson(stdout: string): BatteryJson | undefined {
	const lines = stdout
		.split(/\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!;
		if (!line.startsWith("{")) {
			continue;
		}
		try {
			return JSON.parse(line) as BatteryJson;
		} catch {
			continue;
		}
	}
	return undefined;
}

function failureKeyLabel(data: Extract<BatteryJson, { ok: false }>): string {
	switch (data.error_code) {
		case "import_error":
			return "PIP";
		case "not_found":
			return "USB";
		case "no_response":
			return "HID";
		default:
			return "HID";
	}
}

function spawnEnv(): NodeJS.ProcessEnv {
	return { ...process.env, PYTHONUNBUFFERED: "1" };
}

const SPAWN_OPTS: SpawnSyncOptionsWithStringEncoding = {
	encoding: "utf-8",
	timeout: 20_000,
	windowsHide: true,
	env: spawnEnv(),
};

/** Split PI field e.g. `py -3` or `"C:\Program Files\Python312\python.exe"` */
function parsePythonCommandLine(raw: string): { exe: string; prefix: string[] } {
	const tokens =
		raw.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((t) => t.replace(/^"|"$/g, "")) ?? [raw];
	return { exe: tokens[0]!, prefix: tokens.slice(1) };
}

function windowsPythonExeCandidates(): string[] {
	const versions = ["313", "312", "311", "310", "39"];
	const dirs: string[] = [];
	const local = process.env.LOCALAPPDATA;
	const pf = process.env.ProgramFiles;
	const pf86 = process.env["ProgramFiles(x86)"];
	if (local) {
		for (const v of versions) {
			dirs.push(path.join(local, "Programs", "Python", `Python${v}`, "python.exe"));
		}
	}
	if (pf) {
		for (const v of versions) {
			dirs.push(path.join(pf, `Python${v}`, "python.exe"));
		}
	}
	if (pf86) {
		for (const v of versions) {
			dirs.push(path.join(pf86, `Python${v}`, "python.exe"));
		}
	}
	return [...new Set(dirs.filter((p) => existsSync(p)))];
}

/**
 * Run the bundled script with --json. Tries known Windows install paths (Stream Deck often has a minimal PATH),
 * then python / py -3 / python3. Uses -u + PYTHONUNBUFFERED so stdout is not stuck in a pipe buffer.
 */
function spawnBatteryJson(
	script: string,
	explicitPython: string | undefined,
): SpawnSyncReturns<string> {
	const argsFor = (prefix: string[]): string[] => [...prefix, "-u", script, "--json"];

	if (explicitPython) {
		const { exe, prefix } = parsePythonCommandLine(explicitPython.trim());
		return spawnSync(exe, argsFor(prefix), SPAWN_OPTS);
	}

	const attempts: Array<[string, string[]]> = [];

	if (process.platform === "win32") {
		for (const pyexe of windowsPythonExeCandidates()) {
			attempts.push([pyexe, argsFor([])]);
		}
		attempts.push(["py", argsFor(["-3"])]);
		attempts.push(["python", argsFor([])]);
		attempts.push(["python3", argsFor([])]);
	} else {
		attempts.push(["python3", argsFor([])]);
		attempts.push(["python", argsFor([])]);
	}

	let last: SpawnSyncReturns<string> | undefined;
	for (const [cmd, args] of attempts) {
		const r = spawnSync(cmd, args, SPAWN_OPTS);
		last = r;
		if (r.error) {
			continue;
		}
		if (parseLastBatteryJson(r.stdout ?? "") !== undefined) {
			return r;
		}
	}
	return last!;
}

@action({ UUID: "com.t3lluz.hyperxcawbattery.battery" })
export class HyperXBatteryAction extends SingletonAction<BatterySettings> {
	private readonly pollHandles = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly busy = new Set<string>();
	private readonly liveActions = new Map<string, KeyAction<BatterySettings>>();

	wakeRefreshAll(): void {
		for (const action of this.liveActions.values()) {
			void action.getSettings().then((s) => this.refresh(action, s));
		}
	}

	override async onWillAppear(ev: WillAppearEvent<BatterySettings>): Promise<void> {
		const keyAction = ev.action as KeyAction<BatterySettings>;
		this.liveActions.set(keyAction.id, keyAction);
		this.startPolling(keyAction, ev.payload.settings);
	}

	override async onWillDisappear(ev: WillDisappearEvent<BatterySettings>): Promise<void> {
		this.liveActions.delete(ev.action.id);
		this.stopPolling(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BatterySettings>): Promise<void> {
		this.startPolling(ev.action as KeyAction<BatterySettings>, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<BatterySettings>): Promise<void> {
		await this.refresh(ev.action, await ev.action.getSettings());
	}

	private stopPolling(actionId: string): void {
		const h = this.pollHandles.get(actionId);
		if (h !== undefined) {
			clearTimeout(h);
			this.pollHandles.delete(actionId);
		}
	}

	private startPolling(action: KeyAction<BatterySettings>, initial: BatterySettings): void {
		this.stopPolling(action.id);

		const armNext = (): void => {
			void (async () => {
				const s = await action.getSettings();
				const sec = Math.max(5, s.pollSeconds ?? 10);
				const h = setTimeout(() => {
					void (async () => {
						const s2 = await action.getSettings();
						await this.refresh(action, s2);
						armNext();
					})();
				}, sec * 1000);
				this.pollHandles.set(action.id, h);
			})();
		};

		void (async () => {
			await this.refresh(action, initial);
			armNext();
		})();
	}

	private async refresh(action: KeyAction<BatterySettings>, settings: BatterySettings): Promise<void> {
		if (this.busy.has(action.id)) {
			return;
		}
		this.busy.add(action.id);

		try {
			const script = settings.scriptPath?.trim() || DEFAULT_SCRIPT;
			const explicitPy = settings.pythonPath?.trim();

			const imgOpts = { target: Target.HardwareAndSoftware as const };
			const titleOpts = { target: Target.HardwareAndSoftware as const };

			if (!existsSync(script)) {
				streamDeck.logger.warn(`battery script missing: ${script}`);
				await action.setTitle("", titleOpts);
				await action.setImage(buildErrorKeyDataUrl("SCR"), imgOpts);
				return;
			}

			const result = spawnBatteryJson(script, explicitPy);

			if (result.error) {
				streamDeck.logger.warn(`spawn failed: ${result.error.message}`);
				await action.setTitle("", titleOpts);
				await action.setImage(buildErrorKeyDataUrl("PY"), imgOpts);
				return;
			}

			const data = parseLastBatteryJson(result.stdout ?? "");
			if (data === undefined) {
				const errOut = (result.stderr ?? "").trim().slice(0, 500);
				streamDeck.logger.warn(
					`no JSON in stdout: stdout=${result.stdout?.slice(0, 200)}${errOut ? ` stderr=${errOut}` : ""}`,
				);
				await action.setTitle("", titleOpts);
				await action.setImage(buildErrorKeyDataUrl("—"), imgOpts);
				return;
			}

			if (!data.ok) {
				streamDeck.logger.info(`battery read failed: ${data.error}`);
				await action.setTitle("", titleOpts);
				await action.setImage(buildErrorKeyDataUrl(failureKeyLabel(data)), imgOpts);
				return;
			}

			const charging = Boolean(data.charging) || data.status === "Charging";
			await action.setTitle(`${data.level}%`, titleOpts);
			await action.setImage(buildBatteryKeyDataUrl(data.level, charging), imgOpts);
		} finally {
			this.busy.delete(action.id);
		}
	}
}
