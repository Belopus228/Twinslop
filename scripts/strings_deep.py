#!/usr/bin/env python3
"""
Строковый анализ нативных библиотек и classes.dex.

global-metadata.dat в этом APK зашифрован, поэтому классы/тексты достаём
из .rodata библиотек и из dex — там они лежат в открытом виде.

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

TARGETS = [
    "lib/arm64-v8a/libil2cpp.so",
    "lib/arm64-v8a/liblck_streaming_rs.so",
    "lib/arm64-v8a/liblck_core.so",
    "lib/arm64-v8a/liblck_rs.so",
    "lib/arm64-v8a/libmodkit_gilla.so",
    "lib/arm64-v8a/libmain.so",
    "lib/arm64-v8a/libnanosockets.so",
    "classes.dex",
    "classes2.dex",
    "classes3.dex",
]

PRINTABLE = re.compile(rb"[\x09\x0a\x20-\x7e\xc0-\xff]{4,300}")


def decode(raw):
    for enc in ("utf-8", "cp1251", "latin-1"):
        try:
            return raw.decode(enc)
        except Exception:  # noqa: BLE001
            continue
    return None


urls = set()
human = set()
idents = Counter()
tech = set()
per_file = {}

try:
    zf = zipfile.ZipFile(APK)
except Exception as exc:  # noqa: BLE001
    print(f"не открыть APK: {exc!r}")
    sys.exit(0)

for target in TARGETS:
    try:
        with zf.open(target) as fh:
            blob = fh.read()
    except KeyError:
        continue
    except Exception as exc:  # noqa: BLE001
        print(f"{target}: {exc!r}")
        continue

    found = 0
    for m in PRINTABLE.finditer(blob):
        s = decode(m.group())
        if not s:
            continue
        s = s.strip()
        if not (4 <= len(s) <= 300):
            continue
        found += 1

        if re.match(r"^(https?|wss?|rtmp|rtmps)://", s):
            urls.add(s)
            continue
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_`]{3,64}", s):
            idents[s] += 1
            continue
        letters = sum(ch.isalpha() for ch in s)
        if letters >= 4 and letters >= len(s) * 0.45 and not re.search(r"[{}<>;\\]|::|\bvoid\b", s):
            human.add(s)
            continue
        if re.search(r"(token|secret|client_id|api|stream|twitch|webrtc|socket|frida|hook|mod)", s, re.I):
            tech.add(s)

    per_file[target] = found
    print(f"{target}: {found} строк")
    del blob

human_sorted = sorted(human, key=lambda s: (len(s), s))
with open(os.path.join(OUT, "strings-ui.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(human_sorted[:50000]))

ru = [s for s in human_sorted if re.search(r"[\u0400-\u04FF]", s)]
with open(os.path.join(OUT, "strings-ru.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(ru[:25000]))

with open(os.path.join(OUT, "urls.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(sorted(urls)[:3000]))

with open(os.path.join(OUT, "identifiers.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(s for s, _ in idents.most_common(60000)))

with open(os.path.join(OUT, "strings-tech.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(sorted(tech)[:15000]))

with open(os.path.join(OUT, "strings-stats.txt"), "w", encoding="utf-8") as fh:
    fh.write(f"urls: {len(urls)}\nhuman: {len(human)}\nrussian: {len(ru)}\nidents: {len(idents)}\ntech: {len(tech)}\n\n")
    for k, v in per_file.items():
        fh.write(f"{k}: {v}\n")

print(f"итого: urls={len(urls)} human={len(human)} ru={len(ru)} idents={len(idents)} tech={len(tech)}")
