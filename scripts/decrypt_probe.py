#!/usr/bin/env python3
"""
Попытка «расшифровать» защиту APK: метаданные IL2CPP и модкит.

Что проверяем:
  1. реально ли global-metadata.dat зашифрован целиком, или только заголовок
     (тогда тело в открытом виде — ищем маркеры mscorlib/UnityEngine/Assembly-CSharp)
  2. если это простой XOR с коротким ключом — восстанавливаем ключ по известному
     открытому тексту (магия 0xFAB11BAF + версия) и расшифровываем
  3. структуру libmodkit_gilla.so: ELF-секции, энтропия, признаки упаковки
  4. наличие Frida-gadget / его конфига в ассетах

Использование: python3 scripts/decrypt_probe.py <apk> <outdir>
"""

import math
import os
import re
import struct
import sys
import zipfile
from collections import Counter

APK = sys.argv[1] if len(sys.argv) > 1 else "/tmp/apk/app.apk"
OUT = sys.argv[2] if len(sys.argv) > 2 else "apk-report/deep/decrypt"
WORK = "/tmp/decrypt"
os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)

MAGIC = 0xFAB11BAF
MARKERS = [b"mscorlib", b"UnityEngine", b"Assembly-CSharp", b"System.String",
           b"global-metadata", b"Photon", b"PlayFab", b"Gilla"]
notes = []


def note(msg):
    print(msg, flush=True)
    notes.append(str(msg))


def entropy(data):
    if not data:
        return 0.0
    c = Counter(data)
    n = len(data)
    return -sum((v / n) * math.log2(v / n) for v in c.values())


def xor_periodic(buf, key):
    """XOR с повторяющимся ключом — быстро, через translate по срезам."""
    out = bytearray(buf)
    n = len(key)
    for i in range(n):
        table = bytes((b ^ key[i]) for b in range(256))
        out[i::n] = out[i::n].translate(table)
    return bytes(out)


def try_dumper(meta_path, il2cpp_path, out_dir):
    dumper = None
    for root, _d, files in os.walk("/tmp/icd"):
        for f in files:
            if f.lower() == "il2cppdumper.dll":
                dumper = os.path.join(root, f)
    if not dumper or not os.path.exists(il2cpp_path):
        return None, "нет Il2CppDumper или libil2cpp.so"
    import subprocess
    env = dict(os.environ, DOTNET_ROLL_FORWARD="LatestMajor", DOTNET_CLI_TELEMETRY_OPTOUT="1")
    try:
        p = subprocess.run(["dotnet", dumper, il2cpp_path, meta_path, out_dir],
                           capture_output=True, timeout=420, env=env)
        tail = (p.stderr or p.stdout).decode("utf-8", "replace")[-600:]
        return p.returncode, tail
    except Exception as exc:  # noqa: BLE001
        return None, repr(exc)


zf = zipfile.ZipFile(APK)
report = {}

# ---------------------------------------------------------------- 1. метаданные
meta_name = next((n for n in zf.namelist() if n.endswith("global-metadata.dat")), None)
il2cpp_name = "lib/arm64-v8a/libil2cpp.so"
meta_path = os.path.join(WORK, "global-metadata.dat")
il2cpp_path = os.path.join(WORK, "libil2cpp.so")
if meta_name:
    with zf.open(meta_name) as src, open(meta_path, "wb") as dst:
        dst.write(src.read())
with zf.open(il2cpp_name) as src, open(il2cpp_path, "wb") as dst:
    dst.write(src.read())

with open(meta_path, "rb") as fh:
    meta = fh.read()

report["metadata_size"] = len(meta)
report["header_hex"] = meta[:32].hex()
report["magic_read"] = hex(struct.unpack_from("<I", meta, 0)[0])
report["version_read"] = struct.unpack_from("<I", meta, 4)[0]
note(f"metadata: {len(meta)} байт, header={report['header_hex']}")
note(f"магия: {report['magic_read']} (ожидается {hex(MAGIC)}), версия-поле: {report['version_read']}")

# энтропия по регионам
regions = []
for start in range(0, len(meta), max(1, len(meta) // 12)):
    chunk = meta[start:start + max(1, len(meta) // 12)]
    regions.append({"offset": start, "entropy": round(entropy(chunk[:65536]), 2)})
report["entropy_by_region"] = regions
note(f"энтропия: {[r['entropy'] for r in regions]}")

# поиск маркеров в открытом виде
marker_hits = {}
for m in MARKERS:
    idx = meta.find(m)
    marker_hits[m.decode()] = idx
report["markers"] = marker_hits
note(f"маркеры: {marker_hits}")

# ---------------------------------------------------------------- 1b. граница шифра
boundary = None
for off in range(0, len(meta), 4096):
    chunk = meta[off:off + 4096]
    if sum(1 for b in chunk if 32 <= b < 127) > 3500:
        boundary = off
        break
report["plaintext_boundary"] = boundary
note(f"граница открытого текста: {boundary}")

# ---------------------------------------------------------------- 1c. сжатие?
import zlib
compression_hits = {"zlib": [], "gzip": [], "lz4": [], "zstd": []}
head = meta[:max(1, boundary or 2_000_000)]
for i in range(0, min(len(head) - 8, 400_000)):
    if head[i] == 0x78 and head[i + 1] in (0x01, 0x5E, 0x9C, 0xDA):
        try:
            zlib.decompressobj().decompress(head[i:i + 65536])
            compression_hits["zlib"].append(i)
        except Exception:  # noqa: BLE001
            pass
    if head[i:i + 2] == b"\x1f\x8b":
        compression_hits["gzip"].append(i)
    if head[i:i + 4] == b"\x04\x22\x4d\x18":
        compression_hits["lz4"].append(i)
    if head[i:i + 4] == b"\x28\xb5\x2f\xfd":
        compression_hits["zstd"].append(i)
report["compression_hits"] = {k: v[:3] for k, v in compression_hits.items()}

# ---------------------------------------------------------------- 2. XOR-попытки
cracked = None
if True:
    best = None
    sample_offsets = [0, len(meta) // 3, 2 * len(meta) // 3, len(meta) - 200000]
    for version in range(16, 41):
        plain8 = struct.pack("<I", MAGIC) + struct.pack("<I", version)
        for klen in range(1, 9):
            key = bytearray(klen)
            for i in range(klen):
                key[i] = meta[i] ^ plain8[i]
            hits = 0
            for off in sample_offsets:
                chunk = meta[off:off + 65536]
                dec = xor_periodic(chunk, bytes(key))
                hits += sum(1 for m in MARKERS if m in dec)
                hits += 2 if sum(1 for b in dec[:4096] if 32 <= b < 127) > 3000 else 0
            if hits and (best is None or hits > best[0]):
                best = (hits, version, bytes(key))
    report["xor_best"] = {"hits": best[0], "version": best[1], "key_hex": best[2].hex()} if best else None
    note(f"XOR-поиск: {report['xor_best']}")

    if best and best[0] >= 3:
        dec = xor_periodic(meta, best[2])
        dec_path = os.path.join(WORK, "metadata.dec.bin")
        with open(dec_path, "wb") as fh:
            fh.write(dec)
        report["xor_decrypted"] = True
        code, tail = try_dumper(dec_path, il2cpp_path, os.path.join(WORK, "dump_xor"))
        report["dumper_xor"] = {"code": code, "tail": tail}
        note(f"Il2CppDumper на расшифрованном: code={code}: {tail[-200:]}")
        if code == 0 and os.path.exists(os.path.join(WORK, "dump_xor", "dump.cs")):
            cracked = os.path.join(WORK, "dump_xor", "dump.cs")

# ---------------------------------------------------------------- 3. ремонт заголовка
if cracked is None and (marker_hits.get("mscorlib", -1) >= 0 or marker_hits.get("UnityEngine", -1) >= 0):
    note("тело метаданных в открытом виде — пробуем починить заголовок")
    for version in (31, 30, 29, 28, 27, 24, 21):
        patched = bytearray(meta)
        struct.pack_into("<I", patched, 0, MAGIC)
        struct.pack_into("<I", patched, 4, version)
        p = os.path.join(WORK, f"meta_v{version}.dat")
        with open(p, "wb") as fh:
            fh.write(patched)
        code, tail = try_dumper(p, il2cpp_path, os.path.join(WORK, f"dump_v{version}"))
        note(f"версия {version}: code={code} {tail[-140:]}")
        report.setdefault("dumper_tries", []).append({"version": version, "code": code, "tail": tail[-300:]})
        if code == 0 and os.path.exists(os.path.join(WORK, f"dump_v{version}", "dump.cs")):
            cracked = os.path.join(WORK, f"dump_v{version}", "dump.cs")
            report["header_fixed_version"] = version
            break

# если дамп получился — выжимаем игровые классы и строки
if cracked:
    note(f"дамп получен: {cracked}")
    classes, strs = [], set()
    with open(cracked, "r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            m = re.match(r"\s*(?:public|internal|private|protected|sealed|abstract|static|partial|\s)*\b(class|struct|enum|interface)\s+([A-Za-z0-9_`<>,\.]+)", line)
            if m:
                classes.append(m.group(2))
    with open(os.path.join(OUT, "dumped-classes.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(sorted(set(classes))))
    report["dumped_classes"] = len(set(classes))

    strlit = os.path.join(os.path.dirname(cracked), "stringliteral.json")
    if os.path.exists(strlit):
        import json
        try:
            data = json.load(open(strlit, encoding="utf-8", errors="replace"))
            for item in data:
                v = item.get("value") if isinstance(item, dict) else item
                if isinstance(v, str) and 3 <= len(v) <= 200 and sum(c.isalpha() for c in v) > len(v) * 0.4:
                    strs.add(v)
        except Exception as exc:  # noqa: BLE001
            note(f"stringliteral: {exc!r}")
        with open(os.path.join(OUT, "dumped-strings.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(sorted(strs, key=lambda s: (len(s), s))[:40000]))
        report["dumped_strings"] = len(strs)

# ---------------------------------------------------------------- 4. модкит
modlib = None
for n in zf.namelist():
    if "modkit" in n.lower() and n.endswith(".so"):
        modlib = n
        break
if modlib:
    blob = zf.read(modlib)
    info = {"name": modlib, "size": len(blob), "entropy": round(entropy(blob[:2_000_000]), 2)}
    if blob[:4] == b"\x7fELF":
        is64 = blob[4] == 2
        try:
            if is64:
                e_shoff = struct.unpack_from("<Q", blob, 0x28)[0]
                e_shentsize, e_shnum, e_shstrndx = struct.unpack_from("<HHH", blob, 0x3A)
            else:
                e_shoff = struct.unpack_from("<I", blob, 0x20)[0]
                e_shentsize, e_shnum, e_shstrndx = struct.unpack_from("<HHH", blob, 0x2E)
            sections = []
            for i in range(min(e_shnum, 60)):
                base = e_shoff + i * e_shentsize
                if is64:
                    name, typ, flags, addr, off, size = struct.unpack_from("<IIQQQQ", blob, base)
                else:
                    name, typ, flags, addr, off, size = struct.unpack_from("<IIIIII", blob, base)
                if off + size > len(blob) or size == 0:
                    continue
                sections.append({
                    "name_off": name, "type": typ, "offset": off, "size": size,
                    "entropy": round(entropy(blob[off:off + min(size, 200000)]), 2),
                })
            info["sections"] = sections
            covered = max((s["offset"] + s["size"]) for s in sections) if sections else 0
            info["file_size"] = len(blob)
            info["appended_bytes"] = len(blob) - covered
            if covered < len(blob):
                tail = blob[covered:covered + 64]
                info["appended_head_hex"] = tail.hex()
                info["appended_entropy"] = round(entropy(blob[covered:covered + 500000]), 2)
        except Exception as exc:  # noqa: BLE001
            info["elf_error"] = repr(exc)
    report["modkit"] = info
    note(f"модкит: {info.get('size')} байт, энтропия {info.get('entropy')}, секций {len(info.get('sections', []))}")

# ---------------------------------------------------------------- 5. frida
frida_files = [n for n in zf.namelist() if "frida" in n.lower() or "gadget" in n.lower()]
report["frida_files"] = frida_files[:20]
note(f"frida/gadget файлы: {frida_files[:10]}")
for n in frida_files:
    if n.lower().endswith((".json", ".config", ".txt")):
        try:
            data = zf.read(n)
            os.makedirs(os.path.join(OUT, "frida"), exist_ok=True)
            with open(os.path.join(OUT, "frida", os.path.basename(n)), "wb") as fh:
                fh.write(data)
        except Exception:  # noqa: BLE001
            pass

# поиск конфига гейджета внутри assets/*.json
json_assets = [n for n in zf.namelist() if n.startswith("assets/") and n.lower().endswith(".json")]
report["json_assets"] = json_assets[:20]

# ---------------------------------------------------------------- 5b. кто расшифровывает
CRYPTO = ["decrypt", "encrypt", "aes", "chacha", "salsa", "xxtea", "tea", "rc4",
          "xsalsa", "poly1305", "metadata", "global-metadata", "il2cpp", "mmap",
          "mprotect", "dlopen", "frida", "hook", "inline", "bangcle", "ijiami",
          "virbox", "naga", "hardening", "obfuscat", "anti", "ptrace", "debugger"]
loaders = {}
for name in zf.namelist():
    if not (name.startswith("lib/") and name.endswith(".so")):
        continue
    base = os.path.basename(name)
    if base in ("libil2cpp.so", "libunity.so", "libc++_shared.so"):
        continue
    try:
        data = zf.read(name)
    except Exception:  # noqa: BLE001
        continue
    hits = Counter()
    for m in re.finditer(rb"[\x20-\x7e]{4,80}", data):
        s = m.group().decode("ascii", "ignore").lower()
        for kw in CRYPTO:
            if kw in s:
                hits[kw] += 1
    if hits:
        loaders[base] = {"size": len(data), "hits": dict(hits.most_common(12))}
report["loader_scan"] = loaders
note(f"скан загрузчиков: { {k: list(v['hits'])[:6] for k, v in loaders.items()} }")

# ---------------------------------------------------------------- 6. отчёт
import json as _json
with open(os.path.join(OUT, "probe.json"), "w", encoding="utf-8") as fh:
    _json.dump(report, fh, ensure_ascii=False, indent=2)

lines = ["# Крипто-проба APK", ""]
lines.append(f"- Метаданные: {report.get('metadata_size')} байт, заголовок `{report.get('header_hex')}`")
lines.append(f"- Магия прочитана: `{report.get('magic_read')}` (должна быть `0xfab11baf`)")
lines.append(f"- Регионы (энтропия): {[r['entropy'] for r in regions]}")
lines.append(f"- Маркеры в открытом виде: {marker_hits}")
if report.get("xor_best"):
    lines.append(f"- XOR-гипотеза: {report['xor_best']}")
if report.get("header_fixed_version"):
    lines.append(f"- Заголовок починен, версия {report['header_fixed_version']} — дамп получен")
if report.get("dumped_classes"):
    lines.append(f"- Классов из дампа: {report['dumped_classes']}")
lines.append(f"- Frida/gadget: {report.get('frida_files')}")
mod = report.get("modkit") or {}
if mod:
    lines.append(f"- Модкит: {mod.get('size')} байт, энтропия {mod.get('entropy')}")
    if "appended_bytes" in mod:
        lines.append(f"- Данные за последней секцией: {mod['appended_bytes']} байт "
                     f"(энтропия {mod.get('appended_entropy')}, начало `{mod.get('appended_head_hex')}`)")
    for sec in (mod.get("sections") or [])[:20]:
        lines.append(f"  - секция @{sec['offset']} size={sec['size']} entropy={sec['entropy']}")
with open(os.path.join(OUT, "PROBE.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

with open(os.path.join(OUT, "run-log.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(notes))

print("\n".join(lines))
