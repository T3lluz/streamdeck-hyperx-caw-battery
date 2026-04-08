import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "com.t3lluz.hyperxcawbattery.sdPlugin");
const dest = path.join(
	process.env.APPDATA || "",
	"Elgato",
	"StreamDeck",
	"Plugins",
	"com.t3lluz.hyperxcawbattery.sdPlugin",
);

if (!existsSync(src)) {
	console.error("Missing folder:", src);
	process.exit(1);
}

mkdirSync(path.dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("Deployed to:", dest);
