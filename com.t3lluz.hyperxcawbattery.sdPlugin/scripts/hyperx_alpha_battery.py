#!/usr/bin/env python3
"""
Read battery from HyperX Cloud Alpha Wireless via USB HID (dongle).

Protocol matches community documentation and HyerpxAlpha-Linux:
  VID 0x03f0, PID 0x098d
  31-byte output reports: 0x21 0xBB cmd_hi cmd_lo ...
  Responses (read): 0x21 0xBB byte[2]=0x0b → battery % in byte[3];
                   byte[2]=0x0c → charging when byte[3]==0x01.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

try:
    import hid
except ImportError:
    hid = None  # type: ignore[assignment, misc]

VID = 0x03F0
PID = 0x098D

REPORT_LEN = 31


def _cmd_packet(b2: int, b3: int = 0) -> list[int]:
    buf = [0x21, 0xBB, b2, b3] + [0] * (REPORT_LEN - 4)
    return buf


def _strip_hid_prefix(data: bytes) -> bytes:
    """Normalize hid_read buffers across platforms."""
    if not data:
        return b""
    # Some hosts return a leading report ID 0 before the payload.
    if len(data) > REPORT_LEN and data[0] == 0 and data[1] == 0x21:
        return data[1:]
    return data


def _parse_reports(data: bytes, level: int | None, charging: bool) -> tuple[int | None, bool]:
    """Scan a read buffer for 0x0b / 0x0c frames (may contain multiple packets)."""
    d = _strip_hid_prefix(data)
    for i in range(0, max(0, len(d) - 3)):
        if d[i] == 0x21 and d[i + 1] == 0xBB:
            kind = d[i + 2]
            val = d[i + 3]
            if kind == 0x0B:
                lvl = int(val)
                if 0 <= lvl <= 100:
                    level = lvl
            elif kind == 0x0C:
                charging = val == 0x01
    return level, charging


def _read_updates(dev: hid.device, duration_s: float = 0.45) -> tuple[int | None, bool]:
    level: int | None = None
    charging = False
    end = time.monotonic() + duration_s
    while time.monotonic() < end:
        try:
            chunk = dev.read(64, timeout_ms=120)
        except OSError:
            break
        if not chunk:
            continue
        raw = bytes(chunk) if not isinstance(chunk, bytes) else chunk
        level, charging = _parse_reports(raw, level, charging)
        if level is not None:
            # Still drain briefly so 0x0c can land after 0x0b
            pass
    return level, charging


def _try_path(path: bytes | str) -> tuple[int, bool, str] | None:
    dev = hid.device()
    try:
        dev.open_path(path)
    except OSError:
        return None

    try:
        dev.write(_cmd_packet(0x0B, 0x00))
        dev.write(_cmd_packet(0x0C, 0x00))
        time.sleep(0.02)
        level, charging = _read_updates(dev)
        if level is None:
            return None
        product = "HyperX Cloud Alpha Wireless"
        try:
            ps = dev.get_product_string()
            if ps:
                product = str(ps)
        except Exception:
            pass
        return level, charging, product
    except OSError:
        return None
    finally:
        try:
            dev.close()
        except Exception:
            pass


def read_battery() -> dict:
    if hid is None:
        return {
            "ok": False,
            "error": "Python hidapi not installed. Run: pip install hidapi",
            "error_code": "import_error",
        }

    entries: list[dict] = []
    for info in hid.enumerate(VID, PID):
        p = info.get("path")
        if p:
            entries.append(info)

    if not entries:
        return {
            "ok": False,
            "error": f"No HID device for VID=0x{VID:04x} PID=0x{PID:04x} (plug in the wireless dongle).",
            "error_code": "not_found",
        }

    # De-duplicate paths while keeping stable order
    seen: set[bytes | str] = set()
    ordered: list[bytes | str] = []
    for info in entries:
        p = info.get("path")
        if not p or p in seen:
            continue
        seen.add(p)
        ordered.append(p)

    last_err = "Could not read battery on any HID interface."
    for path in ordered:
        got = _try_path(path)
        if got is None:
            continue
        level, charging, product = got
        return {
            "ok": True,
            "level": level,
            "charging": charging,
            "status": "Charging" if charging else "Discharging",
            "proto": "hyperx_hid",
            "mv": 0,
            "product": product,
            "pid": f"0x{PID:04x}",
        }

    return {
        "ok": False,
        "error": last_err + " Close HyperX NGENUITY if it holds the device exclusively.",
        "error_code": "no_response",
    }


def cmd_list() -> int:
    if hid is None:
        print("hidapi not installed. Run: pip install hidapi", file=sys.stderr)
        return 1
    rows = [i for i in hid.enumerate(VID, PID) if i.get("path")]
    if not rows:
        print(f"No HID paths for VID=0x{VID:04x} PID=0x{PID:04x}")
        return 1
    print(f"HID paths for HyperX Cloud Alpha Wireless dongle (0x{VID:04x}:0x{PID:04x}):\n")
    for info in rows:
        iface = info.get("interface_number")
        prod = info.get("product_string") or "?"
        manu = info.get("manufacturer_string") or "?"
        print(f"  IFace={iface!s:>4}  {manu} / {prod}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="HyperX Cloud Alpha Wireless battery via HID.")
    parser.add_argument("--list", action="store_true", help="List HID interfaces for the dongle.")
    parser.add_argument("--json", action="store_true", help="Single JSON line for Stream Deck.")
    args = parser.parse_args()

    if args.list:
        return cmd_list()

    if args.json:
        result = read_battery()
        print(json.dumps(result))
        return 0 if result.get("ok") else 1

    result = read_battery()
    if not result.get("ok"):
        print(result.get("error", "Unknown error"))
        return 1
    chg = "charging" if result.get("charging") else "on battery"
    print(f"{result.get('product')}: {result['level']}% ({chg})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
