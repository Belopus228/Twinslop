#!/usr/bin/env python3
"""
Глубокий разбор Unity/IL2CPP APK на GitHub Actions.

Что делает:
  1. вытаскивает из APK libil2cpp.so + global-metadata.dat
  2. гоняет Il2CppDumper -> dump.cs + stringliteral.json
  3. выжимает из дампа: список сборок, игровые классы, методы, UI-строки
  4. UnityPy: сцены, имена ассетов, текстовые ассеты (локализация/конфиги)

Наружу отдаёт только компактные выжимки в outdir, потому что полный дамп
занимает сотни мегабайт и в git не лезет.

Использование: python3 scripts/deep_inspect.py <apk> <outdir>
"""

import json
import os
import re
import subprocess
import sys
import zipfile
from collections import Counter, defaultdict

APK = sys.argv[1] if len(sys.argv) > 1 else "/tmp/apk/app.apk"
OUT = sys.argv[2] if len(sys.argv) > 2 else "apk-report/deep"
WORK = "/tmp/deep"
os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)

stats = {}
log_lines = []


def log(msg):
    print(msg, flush=True)
    log_lines.append(str(msg))


def run(cmd, timeout=900, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, env=e)
        return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return -1, "", repr(exc)


# ---------------------------------------------------------------- 1. распаковка
PREFIXES = ("lib/arm64-v8a/", "assets/bin/Data/Managed/Metadata/", "assets/bin/Data/")
wanted = {}
try:
    with zipfile.ZipFile(APK) as zf:
        for info in zf.infolist():
            n = info.filename
            if n == "lib/arm64-v8a/libil2cpp.so" or n.endswith("global-metadata.dat"):
                wanted[n] = os.path.join(WORK, os.path.basename(n))
            elif n.startswith("assets/bin/Data/") and "/" not in n[len("assets/bin/Data/"):] and info.file_size < 200 * 1024 * 1024:
                wanted[n] = os.path.join(WORK, "data_" + os.path.basename(n))
        for name, dest in wanted.items():
            with zf.open(name) as src, open(dest, "wb") as dst:
                dst.write(src.read())
    log(f"распаковано файлов: {len(wanted)}")
except Exception as exc:  # noqa: BLE001
    log(f"ошибка распаковки: {exc!r}")

il2cpp = os.path.join(WORK, "libil2cpp.so")
metadata = os.path.join(WORK, "global-metadata.dat")
stats["il2cpp_exists"] = os.path.exists(il2cpp)
stats["metadata_exists"] = os.path.exists(metadata)
if os.path.exists(il2cpp):
    stats["il2cpp_mb"] = round(os.path.getsize(il2cpp) / 1048576, 1)
if os.path.exists(metadata):
    stats["metadata_mb"] = round(os.path.getsize(metadata) / 1048576, 1)

# ---------------------------------------------------------------- 2. Il2CppDumper
dump_cs = None
dump_dir = os.path.join(WORK, "dump")
if os.path.exists(il2cpp) and os.path.exists(metadata):
    dumper = None
    for root, _dirs, files in os.walk("/tmp/icd"):
        for f in files:
            if f.lower() == "il2cppdumper.dll":
                dumper = os.path.join(root, f)
    if dumper:
        code, out, err = run(
            ["dotnet", dumper, il2cpp, metadata, dump_dir],
            timeout=1200,
            env={"DOTNET_ROLL_FORWARD": "LatestMajor", "DOTNET_CLI_TELEMETRY_OPTOUT": "1"},
        )
        log(f"Il2CppDumper code={code}")
        log((out or err)[-1500:])
        candidate = os.path.join(dump_dir, "dump.cs")
        if os.path.exists(candidate):
            dump_cs = candidate
    else:
        log("Il2CppDumper.dll не найден")
stats["dump_ok"] = bool(dump_cs)

# ---------------------------------------------------------------- 3. разбор дампа
GAME_SKIP = (
    "System", "Microsoft", "Mono", "UnityEngine", "UnityEditor", "Unity",
    "TMPro", "Newtonsoft", "JetBrains", "DG.Tweening", "Cysharp", "MessagePack",
    "Google", "Firebase", "ILRuntime", "Microsoft", "Internal", "Il2Cpp",
    "AOT", "Mono.Security", "Interop", "Oculus", "Meta", "Vive", "OpenXR",
)

images = []
classes = []           # (namespace, name, kind)
methods_by_class = defaultdict(list)
interesting = defaultdict(list)

if dump_cs:
    ns = ""
    cur_class = None
    pending_method = False
    class_re = re.compile(r"^\s*(?:public|internal|private|protected|sealed|abstract|static|partial|readonly|\s)*\b(class|struct|enum|interface)\s+([A-Za-z0-9_`<>,\.]+)")
    ns_re = re.compile(r"^// Namespace:\s*(.*)$")
    image_re = re.compile(r"^// Image \d+:\s*(.+?)\s*-")
    method_re = re.compile(r"^\s*(?:public|private|protected|internal|static|virtual|override|sealed|abstract|extern|readonly|unsafe|new|\s)+[\w<>\[\],\.\?\*&:\s]+?\s+([A-Za-z0-9_<>`]+)\s*\(")

    with open(dump_cs, "r", encoding="utf-8", errors="replace") as fh:
        for i, line in enumerate(fh):
            if i < 400:
                m = image_re.match(line)
                if m:
                    images.append(m.group(1))
            m = ns_re.match(line)
            if m:
                ns = m.group(1).strip()
                continue
            if line.startswith("// RVA:"):
                pending_method = True
                continue
            m = class_re.match(line)
            if m:
                cur_class = f"{ns}.{m.group(2)}" if ns else m.group(2)
                classes.append((ns, m.group(2), m.group(1)))
                pending_method = False
                continue
            if pending_method:
                pending_method = False
                mm = method_re.match(line)
                if mm and cur_class:
                    methods_by_class[cur_class].append(mm.group(1))
                    continue
            if cur_class and not line.startswith(("//", "}", "{")) and method_re.match(line):
                mm = method_re.match(line)
                if mm:
                    methods_by_class[cur_class].append(mm.group(1))

    log(f"классов в дампе: {len(classes)}")

    def is_game(ns_name):
        return not any(ns_name.startswith(p) for p in GAME_SKIP)

    game_classes = sorted({f"{n}.{c}" if n else c for n, c, _ in classes if is_game(n)})
    with open(os.path.join(OUT, "classes.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(game_classes[:25000]))
    with open(os.path.join(OUT, "assemblies.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(images))

    KEYWORDS = [
        "stream", "twitch", "rtmp", "webrtc", "mic", "audio", "video", "camera",
        "setting", "option", "menu", "ui", "panel", "chat", "overlay", "record",
        "token", "auth", "login", "account", "network", "socket", "server",
        "quality", "bitrate", "fps", "resolution", "encoder", "scene", "hand",
        "controller", "input", "keyboard", "touch", "gesture", "voice", "tts",
    ]
    for cls in game_classes:
        low = cls.lower()
        for kw in KEYWORDS:
            if kw in low:
                interesting[kw].append(cls)

    lines = ["# Игровые классы по темам\n"]
    for kw in sorted(interesting, key=lambda k: -len(interesting[k])):
        lines.append(f"\n## {kw} ({len(interesting[k])})\n")
        for cls in interesting[kw][:40]:
            ms = methods_by_class.get(cls, [])[:12]
            lines.append(f"- `{cls}`" + (f" — {', '.join(ms)}" if ms else ""))
    with open(os.path.join(OUT, "game-classes.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    stats["game_classes"] = len(game_classes)
    stats["keyword_hits"] = {k: len(v) for k, v in sorted(interesting.items(), key=lambda kv: -len(kv[1]))}
    with open(os.path.join(OUT, "methods-sample.txt"), "w", encoding="utf-8") as fh:
        for kw in stats["keyword_hits"]:
            for cls in interesting[kw][:15]:
                ms = methods_by_class.get(cls, [])[:40]
                if ms:
                    fh.write(f"{cls}\n    " + "\n    ".join(ms) + "\n\n")

# ---------------------------------------------------------------- 4. строковые литералы
strlit = os.path.join(dump_dir, "stringliteral.json")
values = []
if os.path.exists(strlit):
    try:
        with open(strlit, "r", encoding="utf-8", errors="replace") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    v = item.get("value") or item.get("Value")
                    if v:
                        values.append(v)
                elif isinstance(item, str):
                    values.append(item)
    except Exception as exc:  # noqa: BLE001
        log(f"stringliteral.json: {exc!r}")

log(f"строковых литералов: {len(values)}")
stats["string_literals"] = len(values)

if values:
    def is_human(s):
        if not (3 <= len(s) <= 160):
            return False
        if sum(ch.isalpha() for ch in s) < max(3, len(s) * 0.4):
            return False
        if re.fullmatch(r"[0-9a-fA-F]{6,}", s):
            return False
        if s.count("/") > len(s) * 0.3:
            return False
        return True

    human = sorted({s for s in values if is_human(s)}, key=lambda s: (len(s), s))
    with open(os.path.join(OUT, "strings-ui.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(human[:30000]))
    stats["ui_strings"] = len(human)

    ru = [s for s in human if re.search(r"[А-Яа-яЁё]", s)]
    with open(os.path.join(OUT, "strings-ru.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(ru[:15000]))
    stats["russian_strings"] = len(ru)

    interesting_re = re.compile(r"(https?://|wss?://|api[_.-]|token|secret|client_id|\.json|\.png|\.dat|@|stream|twitch|rtmp|webrtc)", re.I)
    tech = sorted({s for s in values if interesting_re.search(s) and 3 <= len(s) <= 300})
    with open(os.path.join(OUT, "strings-tech.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(tech[:8000]))

# ---------------------------------------------------------------- 5. UnityPy
try:
    import UnityPy  # type: ignore

    data_dir = WORK
    level_files = sorted(f for f in os.listdir(data_dir) if f.startswith("data_"))
    stats["data_files"] = len(level_files)

    type_counter = Counter()
    names_seen = Counter()
    text_assets = []
    scenes = []

    for fname in level_files:
        path = os.path.join(data_dir, fname)
        try:
            env = UnityPy.load(path)
        except Exception:  # noqa: BLE001
            continue
        for obj in env.objects:
            tname = getattr(obj.type, "name", str(obj.type))
            type_counter[tname] += 1
            if tname in ("TextAsset", "Sprite", "Texture2D", "AudioClip", "MonoBehaviour", "GameObject", "Scene"):
                try:
                    data = obj.read()
                except Exception:  # noqa: BLE001
                    continue
                name = getattr(data, "m_Name", "") or getattr(data, "name", "")
                if name:
                    names_seen[f"{tname}:{name}"] += 1
                if tname == "TextAsset":
                    raw = getattr(data, "m_Script", None) or getattr(data, "script", None)
                    if isinstance(raw, bytes):
                        try:
                            txt = raw.decode("utf-8")
                        except Exception:  # noqa: BLE001
                            txt = ""
                        if txt and len(txt) < 80000 and sum(c.isprintable() or c in "\n\r\t" for c in txt) > len(txt) * 0.9:
                            text_assets.append((name or "unnamed", txt))
            if tname in ("BuildSettings", "PlayerSettings"):
                try:
                    d = obj.read_typetree()
                    for sc in d.get("scenes", []) or []:
                        p = sc.get("path") or sc.get("name")
                        if p:
                            scenes.append(str(p))
                except Exception:  # noqa: BLE001
                    pass

    with open(os.path.join(OUT, "assets.md"), "w", encoding="utf-8") as fh:
        fh.write("# Типы объектов в assets/bin/Data\n\n")
        for t, c in type_counter.most_common(40):
            fh.write(f"- {t}: {c}\n")
        fh.write("\n## Сцены\n\n")
        fh.write("\n".join(f"- `{s}`" for s in sorted(set(scenes))[:200]) or "(не найдены)")
        fh.write("\n\n## Имена объектов (топ-300)\n\n")
        fh.write("\n".join(f"- `{n}`" for n, _ in names_seen.most_common(300)))

    stats["unity_types"] = dict(type_counter.most_common(12))
    stats["text_assets"] = len(text_assets)

    os.makedirs(os.path.join(OUT, "text-assets"), exist_ok=True)
    written = 0
    total_bytes = 0
    for name, txt in text_assets:
        if written >= 120 or total_bytes > 3 * 1024 * 1024:
            break
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)[:60] or "asset"
        dest = os.path.join(OUT, "text-assets", f"{written:03d}_{safe}.txt")
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(txt[:60000])
        written += 1
        total_bytes += len(txt)
    log(f"текстовых ассетов сохранено: {written}")
except Exception as exc:  # noqa: BLE001
    log(f"UnityPy: {exc!r}")
    stats["unitypy_error"] = repr(exc)

# ---------------------------------------------------------------- 6. итог
with open(os.path.join(OUT, "stats.json"), "w", encoding="utf-8") as fh:
    json.dump(stats, fh, ensure_ascii=False, indent=2)

with open(os.path.join(OUT, "run-log.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(log_lines))

print(json.dumps(stats, ensure_ascii=False, indent=2))
