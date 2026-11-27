#!/usr/bin/env python3
"""
Глубокий разбор Unity/IL2CPP APK (v2) — без Il2CppDumper.

Почему без дампера: у этого APK метаданные новее, чем понимает публичный
Il2CppDumper, и он падает с "Metadata file not found or encrypted".
Но в global-metadata.dat лежат таблицы имён (классы, методы, поля) и все
строковые литералы — этого хватает, чтобы понять устройство приложения.

Что делает:
  1. достаёт из APK libunity.so / global-metadata.dat / мелкие текстовые файлы
  2. тянет из метаданных: имена типов, методов, UI-тексты (в т.ч. русские)
  3. UnityPy: имена MonoScript (= все скрипты игры), TextAsset-ы, счётчики
  4. пишет компактные выжимки в outdir

Использование: python3 scripts/deep_inspect.py <apk> <outdir>
"""

import io
import json
import os
import re
import zipfile
from collections import Counter

import sys

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


TEXT_EXT = (".json", ".txt", ".csv", ".xml", ".yaml", ".yml", ".html", ".js", ".lua", ".ini", ".cfg", ".bytes")

# ---------------------------------------------------------------- 1. распаковка
extracted = {}
ext_counter = Counter()
text_candidates = []
try:
    with zipfile.ZipFile(APK) as zf:
        for info in zf.infolist():
            n = info.filename
            ext = os.path.splitext(n)[1].lower()
            ext_counter[ext or "(none)"] += 1
            if n.endswith("global-metadata.dat") or n.endswith("libil2cpp.so"):
                dest = os.path.join(WORK, os.path.basename(n))
                with zf.open(n) as src, open(dest, "wb") as dst:
                    dst.write(src.read())
                extracted[n] = dest
            elif n.startswith("assets/bin/Data/") and "/" not in n[len("assets/bin/Data/"):]:
                dest = os.path.join(WORK, "data_" + os.path.basename(n))
                with zf.open(n) as src, open(dest, "wb") as dst:
                    dst.write(src.read())
                extracted[n] = dest
            elif ext in TEXT_EXT and 0 < info.file_size < 400 * 1024 and not n.startswith("META-INF/"):
                text_candidates.append((n, info.file_size))

        # текстовые конфиги/локализация — вытаскиваем как есть
        text_candidates.sort(key=lambda x: x[1])
        os.makedirs(os.path.join(WORK, "texts"), exist_ok=True)
        for idx, (n, _size) in enumerate(text_candidates[:200]):
            safe = re.sub(r"[^A-Za-z0-9_.-]", "_", n)[-70:]
            dest = os.path.join(WORK, "texts", f"{idx:03d}_{safe}")
            try:
                with zf.open(n) as src, open(dest, "wb") as dst:
                    dst.write(src.read())
            except Exception:  # noqa: BLE001
                pass
    log(f"файлов в APK: {sum(ext_counter.values())}, распаковано ключевых: {len(extracted)}")
except Exception as exc:  # noqa: BLE001
    log(f"ошибка распаковки: {exc!r}")

stats["extensions"] = dict(ext_counter.most_common(25))
stats["text_candidates"] = len(text_candidates)

# версия Unity из libunity.so
unity_version = None
try:
    with zipfile.ZipFile(APK) as zf:
        for cand in ("lib/arm64-v8a/libunity.so", "lib/armeabi-v7a/libunity.so"):
            try:
                with zf.open(cand) as fh:
                    blob = fh.read(40 * 1024 * 1024)
                m = re.search(rb"(20\d\d\.\d+\.\d+[abfp]\d+)", blob)
                if m:
                    unity_version = m.group(1).decode()
                    break
            except KeyError:
                continue
except Exception as exc:  # noqa: BLE001
    log(f"unity version error: {exc!r}")
stats["unity_version"] = unity_version
log(f"Unity: {unity_version}")

metadata_path = os.path.join(WORK, "global-metadata.dat")
if os.path.exists(metadata_path):
    with open(metadata_path, "rb") as fh:
        head = fh.read(8)
    if len(head) >= 8:
        stats["metadata_magic"] = hex(int.from_bytes(head[0:4], "little"))
        stats["metadata_version"] = int.from_bytes(head[4:8], "little")
    stats["metadata_mb"] = round(os.path.getsize(metadata_path) / 1048576, 1)

# ---------------------------------------------------------------- 2. метаданные
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_`<>]{1,64}$")
ident_counts = Counter()
literals = set()

if os.path.exists(metadata_path):
    with open(metadata_path, "rb") as fh:
        blob = fh.read()
    # вытаскиваем "печатаемые" последовательности байт
    for m in re.finditer(rb"[\x20-\x7e\xc0-\xff\xd0-\xd1\xa8\xb8]{3,400}", blob):
        try:
            s = m.group().decode("utf-8")
        except UnicodeDecodeError:
            try:
                s = m.group().decode("cp1251")
            except Exception:  # noqa: BLE001
                continue
        if not s:
            continue
        if IDENT.match(s):
            ident_counts[s] += 1
        else:
            literals.add(s)

    log(f"идентификаторов: {len(ident_counts)}, литералов: {len(literals)}")
    stats["identifiers"] = len(ident_counts)
    stats["literals"] = len(literals)

    # --- имена типов/методов: всё, что похоже на C#-идентификатор
    idents = sorted(ident_counts, key=lambda s: (-ident_counts[s], s))
    with open(os.path.join(OUT, "identifiers.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(idents[:60000]))

    # классы: CamelCase, начинается с большой буквы
    classes = sorted({s for s in ident_counts if re.fullmatch(r"[A-Z][A-Za-z0-9]{2,48}", s)})
    with open(os.path.join(OUT, "classes.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(classes[:40000]))
    stats["class_like"] = len(classes)

    # --- UI-литералы: есть пробелы/пунктуация, похоже на человеческий текст
    def human(s):
        if not (3 <= len(s) <= 200):
            return False
        letters = sum(ch.isalpha() for ch in s)
        if letters < 3 or letters < len(s) * 0.35:
            return False
        if s.count("/") > max(2, len(s) * 0.25):
            return False
        if re.search(r"[\u0400-\u04FF]", s):
            return True
        if " " in s or "!" in s or "?" in s or "." in s:
            return True
        return False

    ui = sorted({s.strip() for s in literals if human(s)}, key=lambda s: (len(s), s))
    with open(os.path.join(OUT, "strings-ui.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(ui[:40000]))
    stats["ui_strings"] = len(ui)

    ru = [s for s in ui if re.search(r"[\u0400-\u04FF]", s)]
    with open(os.path.join(OUT, "strings-ru.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(ru[:20000]))
    stats["russian_strings"] = len(ru)

    tech_re = re.compile(r"(https?://|wss?://|rtmp://|token|secret|client_id|api[_./-]|\.json\b|\.png\b|\.dat\b|@|stream|twitch|webrtc|socket)", re.I)
    tech = sorted({s for s in literals if tech_re.search(s) and 3 <= len(s) <= 300})
    with open(os.path.join(OUT, "strings-tech.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(tech[:10000]))
    stats["tech_strings"] = len(tech)

    # --- поиск домена/URL внутри литералов
    urls = sorted({s for s in literals if re.match(r"^(https?|wss?)://", s.strip())})
    with open(os.path.join(OUT, "urls.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(urls[:2000]))

# ---------------------------------------------------------------- 3. UnityPy
script_names = set()
text_assets = []
type_counter = Counter()
try:
    import UnityPy  # type: ignore

    if os.path.exists(os.path.join(OUT, "scripts.txt")):
        log("scripts.txt уже есть — UnityPy-проход пропущен")
        raise SystemExit

    files = sorted(f for f in os.listdir(WORK) if f.startswith("data_"))
    for fname in files:
        try:
            env = UnityPy.load(os.path.join(WORK, fname))
        except Exception:  # noqa: BLE001
            continue
        for obj in env.objects:
            tname = getattr(obj.type, "name", str(obj.type))
            type_counter[tname] += 1
            if tname == "MonoScript":
                try:
                    d = obj.read()
                    nm = getattr(d, "m_ClassName", "") or getattr(d, "m_Name", "")
                    if nm:
                        script_names.add(str(nm))
                except Exception:  # noqa: BLE001
                    pass
            elif tname == "TextAsset":
                try:
                    d = obj.read()
                    raw = getattr(d, "m_Script", None) or getattr(d, "script", None)
                    nm = getattr(d, "m_Name", "") or "unnamed"
                    if isinstance(raw, bytes) and 0 < len(raw) < 200000:
                        try:
                            txt = raw.decode("utf-8")
                        except Exception:  # noqa: BLE001
                            txt = ""
                        if txt and sum(ch.isprintable() or ch in "\n\r\t" for ch in txt) > len(txt) * 0.9:
                            text_assets.append((str(nm), txt))
                except Exception:  # noqa: BLE001
                    pass

    log(f"MonoScript-ов: {len(script_names)}, TextAsset-ов: {len(text_assets)}")
    with open(os.path.join(OUT, "scripts.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(sorted(script_names)))

    os.makedirs(os.path.join(OUT, "text-assets"), exist_ok=True)
    total = 0
    for idx, (nm, txt) in enumerate(text_assets[:150]):
        if total > 4 * 1024 * 1024:
            break
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", nm)[:60] or "asset"
        with open(os.path.join(OUT, "text-assets", f"{idx:03d}_{safe}.txt"), "w", encoding="utf-8") as fh:
            fh.write(txt[:80000])
        total += len(txt)
    stats["text_assets"] = len(text_assets)
except Exception as exc:  # noqa: BLE001
    log(f"UnityPy: {exc!r}")
    stats["unitypy_error"] = repr(exc)

stats["unity_types"] = dict(type_counter.most_common(15))

# ---------------------------------------------------------------- 4. текстовые файлы из APK
try:
    text_dir = os.path.join(WORK, "texts")
    os.makedirs(os.path.join(OUT, "raw-texts"), exist_ok=True)
    kept = 0
    for name in sorted(os.listdir(text_dir)):
        src = os.path.join(text_dir, name)
        if os.path.getsize(src) > 200 * 1024:
            continue
        with open(src, "rb") as fh:
            raw = fh.read()
        try:
            txt = raw.decode("utf-8")
        except Exception:  # noqa: BLE001
            continue
        if sum(ch.isprintable() or ch in "\n\r\t" for ch in txt) < len(txt) * 0.9:
            continue
        with open(os.path.join(OUT, "raw-texts", name), "w", encoding="utf-8") as fh:
            fh.write(txt)
        kept += 1
        if kept >= 120:
            break
    stats["raw_texts_kept"] = kept
except Exception as exc:  # noqa: BLE001
    log(f"raw texts: {exc!r}")

# ---------------------------------------------------------------- 5. итог
with open(os.path.join(OUT, "stats.json"), "w", encoding="utf-8") as fh:
    json.dump(stats, fh, ensure_ascii=False, indent=2)
with open(os.path.join(OUT, "run-log.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(log_lines))

print(json.dumps(stats, ensure_ascii=False, indent=2))
