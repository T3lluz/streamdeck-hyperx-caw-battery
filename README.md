# HyperX Cloud Alpha Wireless — Stream Deck battery

Stream Deck plugin plus a small Python HID reader for the **HyperX Cloud Alpha Wireless** USB dongle (**VID `0x03F0`**, **PID `0x098D`**). The key image is a **144×144 SVG** drawn each refresh: large **Outfit** percentage in **red** (OFL font, embedded), dark background with a **red-tinted** top rim, and a **Heroicons** lightning bolt (MIT) overlaid on the **top-right** when `charging` is true in `--json`. Protocol details follow community documentation (e.g. [ArchWiki](https://wiki.archlinux.org/title/HyperX_Cloud_Alpha_Wireless), [HyerpxAlpha-Linux](https://github.com/WaffleThief123/HyerpxAlpha-Linux)).

## Repository layout

| Path | Purpose |
|------|--------|
| `hyperx_alpha_battery.py` | CLI + `--json` for the plugin |
| `com.t3lluz.hyperxcawbattery.sdPlugin/` | Stream Deck plugin bundle (copy this folder into Stream Deck’s plugins directory after `npm run build`) |
| `com.t3lluz.hyperxcawbattery.sdPlugin/fonts/` | **Outfit** variable font (`Outfit-Variable.ttf`) + `OFL-Outfit.txt` |
| `src/` | TypeScript plugin source (`key-art.ts` builds SVG data URLs) |

## Prerequisites

- **Stream Deck** 6.9+ with **Node.js 20** (bundled with recent Stream Deck releases).
- **Python 3** on `PATH` (`python` on Windows).
- **hidapi**: `pip install -r requirements.txt`
- Close **HyperX NGENUITY** while testing if HID access fails.

## Build the plugin

After cloning the repo you **must** compile the Node plugin (the `.gitignore` excludes `bin/plugin.js`).

```powershell
cd "$env:USERPROFILE\Documents\My Projects\HyperXCAWBattery"
npm install
npm run fetch-assets
npm run icons
npm run build
```

- `npm run fetch-assets` downloads **Outfit** from Google Fonts (OFL) into `com.t3lluz.hyperxcawbattery.sdPlugin/fonts/`. Skip if those files are already present from the repo.
- `npm run icons` generates marketplace / placeholder PNGs under `com.t3lluz.hyperxcawbattery.sdPlugin/imgs/`.

Attribution: see `com.t3lluz.hyperxcawbattery.sdPlugin/NOTICES.txt`.

## Install in Stream Deck

1. Quit Stream Deck (recommended).
2. Ensure `npm run build` has produced `com.t3lluz.hyperxcawbattery.sdPlugin\bin\plugin.js`.
3. Copy the entire folder:

   `com.t3lluz.hyperxcawbattery.sdPlugin`

   into:

   `%APPDATA%\Elgato\StreamDeck\Plugins\`

4. Start Stream Deck. Under **HyperX CAW Battery**, add **Headset battery** to a key.

## Key settings

- **Python** — launcher command (default `python`).
- **Script path** — leave empty to use the bundled `scripts/hyperx_alpha_battery.py` inside the `.sdPlugin` folder. Override if you keep a copy elsewhere.
- **Poll (sec)** — how often to refresh (minimum 5).

Press the key to force an immediate refresh.

## CLI usage

```powershell
python hyperx_alpha_battery.py
python hyperx_alpha_battery.py --json
python hyperx_alpha_battery.py --list
```

`--json` prints one line of JSON for automation (used by the plugin).

## Publish to GitHub

```powershell
cd "$env:USERPROFILE\Documents\My Projects\HyperXCAWBattery"
git init
git add .
git commit -m "Initial commit: HyperX Cloud Alpha Wireless battery Stream Deck plugin"
```

Create a new empty repository on GitHub, then:

```powershell
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git branch -M main
git push -u origin main
```

Replace the `Author` field in `com.t3lluz.hyperxcawbattery.sdPlugin/manifest.json` and the plugin **UUID** if you plan to ship on the Elgato Marketplace (UUIDs must be unique).

## Credits

- HID framing aligns with public HyperX Cloud Alpha Wireless dongle documentation and open-source tools (see NOTICES).

## License

MIT — use at your own risk. This project is not affiliated with HyperX or HP Inc.
