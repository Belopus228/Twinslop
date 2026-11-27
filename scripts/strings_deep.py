#!/usr/bin/env python3
"""
Строковый анализ APK (v2): аккуратная фильтрация.

global-metadata.dat зашифрован, а libil2cpp.so обфусцирован, поэтому:
  - UI-тексты берём только ASCII (или валидный UTF-8 с кириллицей) и только
    там, где реально есть слова: пробелы, буквы >= 60%
  - отдельно складываем ВСЕ строки маленьких Rust/C++ библиотек
    (потоковый SDK и modkit) — именно там видно, что умеет приложение
  - отдельно — Java/Kotlin-классы из dex

Использование: python3 scripts/strings_deep.py <apk> <outdir>
"""

import os
import re
import sys
import zipfile
from collections import Counter

APK = sys.argv[1] if len(sys.argv) > 1 else "/tmp/apk/app.apk"
OUT = sys.argv[2] if len(sys.argv) > 2 else "apk-report/deep"
os.makedirs(OUT, exist_ok=True)

BIG = "lib/arm64-v8a/libil2cpp.so"
SMALL = [
    "lib/arm64-v8a/liblck_streaming_rs.so",
    "lib/arm64-v8a/liblck_core.so",
    "lib/arm64-v8a/liblck_rs.so",
    "lib/arm64-v8a/libmodkit_gilla.so",
    "lib/arm64-v8a/libnanosockets.so",
    "lib/arm64-v8a/libnative_microphone.so",
    "lib/arm64-v8a/libminirtmp.so",
    "lib/arm64-v8a/lib_rust.so",
]
DEX = ["classes.dex", "classes2.dex", "classes3.dex"]

RUN = re.compile(rb"[\x20-\x7e]{5,300}")
URL_RE = re.compile(r"^(https?|wss?|rtmps?)://[A-Za-z0-9.\-]+\.[A-Za-z]{2,}[^\s\"'<>]{0,120}$")
WORDY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ,.\-/%()&:'\"!?+_]{4,160}$")
CYR_RE = re.compile(r"[\u0400-\u04FF]")


def bad(s):
    """Отсекаем то, что похоже на код, hex, базу64, пути и мусор."""
    if not s or s.count(" ") + s.count(".") == 0:
        return True
    if re.search(r"[{}<>\\^~|]{1}|::|;$", s):
        return True
    if re.search(r"_Z[A-Za-z0-9_]{5,}", s):
        return True
    letters = sum(ch.isalpha() for ch in s)
    if letters < len(s) * 0.6:
        return True
    if len(set(s)) < 5:
        return True
    if re.search(r"[A-Za-z]{2,}\d{3,}|[0-9a-f]{16,}", s):
        return True
    if s.count("/") > 3 or s.count("=") > 2:
        return True
    return False


urls, human, cyr, dex_classes = set(), set(), set(), Counter()
small_dump = {}
big_idents = Counter()

try:
    zf = zipfile.ZipFile(APK)
except Exception as exc:  # noqa: BLE001
    print(f"не открыть APK: {exc!r}")
    sys.exit(0)

# --- маленькие библиотеки: сохраняем всё, что похоже на строку
for target in SMALL:
    try:
        with zf.open(target) as fh:
            blob = fh.read()
    except KeyError:
        continue
    lines = []
    for m in RUN.finditer(blob):
        s = m.group().decode("ascii", "ignore").strip()
        if len(s) < 4:
            continue
        if URL_RE.match(s):
            urls.add(s)
        if not bad(s):
            human.add(s)
            lines.append(s)
        elif re.match(r"^[A-Za-z_][A-Za-z0-9_]{3,60}$", s):
            lines.append(s)
    small_dump[target] = sorted(set(lines))
    print(f"{target}: {len(set(lines))} строк")

# --- валидный UTF-8 с кириллицей (локализация, русские тексты)
for target in [BIG] + SMALL:
    try:
        with zf.open(target) as fh:
            blob = fh.read()
    except KeyError:
        continue
    for m in re.finditer(rb"(?:[\xd0\xd1][\x80-\xbf]|[\x20-\x7e]){6,200}", blob):
        try:
            s = m.group().decode("utf-8")
        except UnicodeDecodeError:
            continue
        if CYR_RE.search(s) and s.count(" ") >= 1 and len(CYR_RE.findall(s)) >= 3:
            s = s.strip()
            if not bad(s) or CYR_RE.search(s):
                cyr.add(s)

# --- большой бинарь: только ASCII-идентификаторы и URL
try:
    with zf.open(BIG) as fh:
        blob = fh.read()
    for m in RUN.finditer(blob):
        s = m.group().decode("ascii", "ignore").strip()
        if URL_RE.match(s):
            urls.add(s)
        elif re.fullmatch(r"[A-Z][A-Za-z0-9_]{3,50}", s):
            big_idents[s] += 1
    del blob
except KeyError:
    pass

# --- dex: Java/Kotlin классы
for target in DEX:
    try:
        with zf.open(target) as fh:
            blob = fh.read()
    except KeyError:
        continue
    for m in re.finditer(rb"L([A-Za-z0-9_/$]{6,120});", blob):
        dex_classes[m.group(1).decode("ascii", "ignore").replace("/", ".")] += 1
    for m in re.finditer(rb"[\x20-\x7e]{8,200}", blob):
        s = m.group().decode("ascii", "ignore").strip()
        if URL_RE.match(s):
            urls.add(s)
    print(f"{target}: {len(dex_classes)} классов")

# --- сохранение
with open(os.path.join(OUT, "strings-ui.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(sorted(human, key=lambda s: (len(s), s))[:40000]))

with open(os.path.join(OUT, "strings-ru.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(sorted(cyr)[:20000]))

with open(os.path.join(OUT, "urls.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(sorted(urls)[:2000]))

os.makedirs(os.path.join(OUT, "libs"), exist_ok=True)
for target, lines in small_dump.items():
    name = os.path.basename(target).replace(".so", "") + ".txt"
    with open(os.path.join(OUT, "libs", name), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines[:30000]))

with open(os.path.join(OUT, "dex-classes.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(f"{k} ({v})" for k, v in dex_classes.most_common(5000)))

with open(os.path.join(OUT, "il2cpp-idents.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(f"{k} ({v})" for k, v in big_idents.most_common(20000)))

with open(os.path.join(OUT, "strings-stats.txt"), "w", encoding="utf-8") as fh:
    fh.write(f"urls={len(urls)} human={len(human)} cyr={len(cyr)} dex_classes={len(dex_classes)} il2cpp_idents={len(big_idents)}\n")
    for k, v in small_dump.items():
        fh.write(f"{k}: {len(v)}\n")

print(f"итого: urls={len(urls)} human={len(human)} cyr={len(cyr)} dex={len(dex_classes)} idents={len(big_idents)}")
