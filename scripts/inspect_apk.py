#!/usr/bin/env python3
"""
Снимает «паспорт» с APK и складывает отчёт в указанную папку.

Запускается на GitHub Actions (там есть интернет и apt), поэтому не боится
докачивать зависимости. Всё, что может упасть, обёрнуто в try/except:
отчёт должен появиться даже если какой-то шаг не сработал.

Использование: python3 scripts/inspect_apk.py <path.apk> <outdir>
"""

import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from collections import Counter

apk_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/app.apk"
out_dir = sys.argv[2] if len(sys.argv) > 2 else "apk-report"

os.makedirs(out_dir, exist_ok=True)
report = {"apk_path": apk_path}

if os.path.exists(apk_path):
    report["size_bytes"] = os.path.getsize(apk_path)
    report["size_human"] = f"{os.path.getsize(apk_path) / 1024 / 1024:.1f} MB"


def run(cmd, timeout=300):
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return res.returncode, res.stdout.decode("utf-8", "replace"), res.stderr.decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return -1, "", repr(exc)


# --------------------------------------------------------------------------
# 1. Содержимое архива
# --------------------------------------------------------------------------
entries = []
try:
    with zipfile.ZipFile(apk_path) as zf:
        for info in zf.infolist():
            entries.append({"name": info.filename, "size": info.file_size, "compressed": info.compress_size})
except Exception as exc:  # noqa: BLE001
    report["zip_error"] = repr(exc)

report["entries_count"] = len(entries)
report["total_uncompressed"] = sum(e["size"] for e in entries)

# крупнейшие файлы — сразу видно движок и вес
report["largest_files"] = sorted(entries, key=lambda e: e["size"], reverse=True)[:40]

# группировка по верхним папкам
top = Counter()
for e in entries:
    parts = e["name"].split("/")
    top[parts[0] if len(parts) > 1 else e["name"]] += e["size"]
report["top_level"] = [{"path": k, "bytes": v} for k, v in top.most_common(40)]

names = [e["name"] for e in entries]
joined = "\n".join(names)

# определение движка / типа приложения
engine = []
checks = {
    "Unity": ["libunity.so", "assets/bin/Data"],
    "Unreal Engine": ["libUE4.so", "libUnreal.so", "assets/UE4"],
    "Godot": ["libgodot"],
    "Flutter": ["libflutter.so"],
    "React Native": ["libreactnativejni", "index.android.bundle"],
    "Cordova/WebView": ["assets/www/", "cordova.js"],
    "Xamarin/.NET": ["libmonodroid", "assemblies/"],
    "Cocos": ["libcocos"],
}
for label, needles in checks.items():
    if any(n in joined for n in needles):
        engine.append(label)
report["engines"] = engine or ["не определён"]

report["native_libs"] = sorted(
    {os.path.basename(n) for n in names if n.startswith("lib/") and n.endswith(".so")}
)[:120]
report["assets_sample"] = [n for n in names if n.startswith("assets/")][:120]
report["dex_files"] = [n for n in names if n.endswith(".dex")]
report["has_signature"] = any(n.startswith("META-INF/") and n.endswith((".RSA", ".DSA", ".EC")) for n in names)

# --------------------------------------------------------------------------
# 2. AndroidManifest через aapt / androguard
# --------------------------------------------------------------------------
badging = {"stdout": "", "source": None}
code, out, err = run(["aapt", "dump", "badging", apk_path])
if code == 0 and out:
    badging = {"stdout": out[:20000], "source": "aapt"}
    report["package"] = re.search(r"package: name='([^']+)'", out).group(1) if re.search(r"package: name='([^']+)'", out) else None
    ver = re.search(r"versionName='([^']+)'", out)
    report["version_name"] = ver.group(1) if ver else None
    report["permissions"] = re.findall(r"uses-permission: name='([^']+)'", out)
    report["features"] = re.findall(r"uses-feature: name='([^']+)'", out)
    report["launchable_activity"] = re.findall(r"launchable-activity: name='([^']+)'", out)
    report["sdk"] = re.findall(r"sdkVersion:'([^']+)'", out)
    report["label"] = re.findall(r"application-label:'([^']+)'", out)[:5]

if not report.get("package"):
    try:  # резервный путь
        from androguard.core.apk import APK  # type: ignore

        a = APK(apk_path)
        report["package"] = a.get_package()
        report["version_name"] = a.get_androidversion_name()
        report["permissions"] = a.get_permissions()
        report["launchable_activity"] = [a.get_main_activity()]
        report["activities"] = a.get_activities()[:80]
        report["services"] = a.get_services()[:80]
        report["receivers"] = a.get_receivers()[:80]
        badging = {"stdout": "androguard", "source": "androguard"}
    except Exception as exc:  # noqa: BLE001
        report["manifest_error"] = repr(exc)

report["badging_source"] = badging["source"]

# --------------------------------------------------------------------------
# 3. Строки: URL, хосты, сокеты, ключи
# --------------------------------------------------------------------------
strings_file = os.path.join(out_dir, "strings_sample.txt")
try:
    code, out, _ = run(["sh", "-c", f"strings -n 6 '{apk_path}' | head -c 8000000"], timeout=600)
    raw = out
except Exception:  # noqa: BLE001
    raw = ""

if raw:
    urls = sorted(set(re.findall(r"https?://[A-Za-z0-9\.\-_/:%#\?=&~+]{4,120}", raw)))
    ws = sorted(set(re.findall(r"wss?://[A-Za-z0-9\.\-_/:%#\?=&~+]{4,120}", raw)))
    hosts = sorted(set(re.findall(r"\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ru|xyz|top|site|app|dev|me)\b", raw)))
    packages = Counter(re.findall(r"\bcom\.[a-z0-9_]+\.[a-z0-9_]+", raw))
    ips = sorted(set(re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", raw)))

    report["urls"] = urls[:150]
    report["ws_urls"] = ws[:50]
    report["domains"] = hosts[:150]
    report["ip_literals"] = ips[:50]
    report["top_packages"] = packages.most_common(40)

    keywords = [
        "websocket", "socket.io", "firebase", "supabase", "okhttp", "retrofit",
        "adMob", "unityads", "applovin", "ffmpeg", "webrtc", "openai", "gemini",
        "tts", "gpt", "vpn", "proxy", "wireguard", "v2ray", "xray", "shadowsocks",
        "minio", "s3", "rtmp", "hls", "m3u8", "youtube", "twitch", "vk.com",
    ]
    found = {}
    low = raw.lower()
    for kw in keywords:
        c = low.count(kw.lower())
        if c:
            found[kw] = c
    report["keywords"] = dict(sorted(found.items(), key=lambda kv: kv[1], reverse=True))
    with open(strings_file, "w", encoding="utf-8") as fh:
        fh.write(raw[:2000000])

# --------------------------------------------------------------------------
# 4. Сохранение
# --------------------------------------------------------------------------
with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)

if badging["stdout"]:
    with open(os.path.join(out_dir, "aapt-badging.txt"), "w", encoding="utf-8") as fh:
        fh.write(badging["stdout"])

lines = []
lines.append("# Паспорт APK\n")
lines.append(f"- Файл: `{os.path.basename(apk_path)}`")
if report.get("size_human"):
    lines.append(f"- Размер: **{report['size_human']}**")
if report.get("package"):
    lines.append(f"- Пакет: `{report['package']}`")
if report.get("version_name"):
    lines.append(f"- Версия: `{report['version_name']}`")
lines.append(f"- Движок: {', '.join(report.get('engines', []))}")
lines.append(f"- Файлов внутри: {report.get('entries_count')}, распаковано {report.get('total_uncompressed', 0) / 1024 / 1024:.1f} MB")
lines.append(f"- Подпись: {'есть' if report.get('has_signature') else 'нет'}")
if report.get("launchable_activity"):
    lines.append(f"- Запуск: `{', '.join(report['launchable_activity'])}`")
lines.append("")

if report.get("permissions"):
    lines.append("## Разрешения\n")
    for p in report["permissions"][:60]:
        lines.append(f"- `{p}`")
    lines.append("")

if report.get("native_libs"):
    lines.append("## Нативные библиотеки\n")
    for lib in report["native_libs"]:
        lines.append(f"- `{lib}`")
    lines.append("")

if report.get("top_level"):
    lines.append("## Что занимает место\n")
    lines.append("| путь | МБ |")
    lines.append("|---|---|")
    for item in report["top_level"][:25]:
        lines.append(f"| `{item['path']}` | {item['bytes'] / 1024 / 1024:.1f} |")
    lines.append("")

if report.get("urls"):
    lines.append("## URL внутри\n")
    for u in report["urls"][:60]:
        lines.append(f"- `{u}`")
    lines.append("")

if report.get("domains"):
    lines.append("## Домены\n")
    lines.append(", ".join(f"`{d}`" for d in report["domains"][:60]))
    lines.append("")

if report.get("keywords"):
    lines.append("## Ключевые слова (по частоте)\n")
    for k, v in list(report["keywords"].items())[:40]:
        lines.append(f"- `{k}` — {v}")
    lines.append("")

if report.get("top_packages"):
    lines.append("## Java-пакеты внутри\n")
    for k, v in report["top_packages"][:40]:
        lines.append(f"- `{k}` — {v}")
    lines.append("")

with open(os.path.join(out_dir, "SUMMARY.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

print("\n".join(lines[:60]))
print(f"\nОтчёт готов: {out_dir}")
