#!/usr/bin/env bash
# apk-triage.sh — быстрый триаж APK: состав, движок, нативные библиотеки, защита.
# Ничего не расшифровывает: только описывает то, что видно в файле.
#
# Использование:
#   ./scripts/apk-triage.sh app.apk [каталог-отчёта]
#
# Зависимости: unzip, sha256sum, python3, readelf (binutils; опционально).
# aapt2/jadx — не обязательны, скрипт скажет, чего не хватает.

set -u

APK="${1:-}"
OUT="${2:-apk-triage-out}"

if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "usage: $0 <file.apk> [outdir]" >&2
  exit 64
fi

mkdir -p "$OUT"
REPORT="$OUT/triage.txt"
: > "$REPORT"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
h() { say ""; say "== $* =="; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- 1. файл
h "файл"
SIZE=$(wc -c < "$APK")
SHA=$(sha256sum "$APK" | awk '{print $1}')
say "путь:    $APK"
say "размер:  $SIZE байт ($(awk -v s="$SIZE" 'BEGIN{printf "%.1f", s/1048576}') МБ)"
say "sha256:  $SHA"

if ! unzip -tqq "$APK" >/dev/null 2>&1; then
  say "ОШИБКА: ZIP не проходит проверку (unzip -t). Файл битый или не APK."
  exit 65
fi
say "zip:     корректен"

LIST="$OUT/entries.txt"
unzip -Z1 "$APK" > "$LIST" 2>/dev/null || true
TOTAL_ENTRIES=$(wc -l < "$LIST")
say "файлов:  $TOTAL_ENTRIES"

# ---------------------------------------------------------------- 2. состав
h "состав"
DEX_LIST=$(grep -E '^classes[0-9]*\.dex$' "$LIST" || true)
DEX_COUNT=$(printf '%s' "$DEX_LIST" | grep -c . || true)
say "dex:     ${DEX_COUNT:-0} шт. $(printf '%s' "$DEX_LIST" | tr '\n' ' ')"
say "манифест: $(grep -qx 'AndroidManifest.xml' "$LIST" && echo есть || echo НЕТ)"
say "ресурсы: $(grep -c '^res/' "$LIST" || true) файлов"
say "assets:  $(grep -c '^assets/' "$LIST" || true) файлов"

ABIS=$(grep -E '^lib/[^/]+/' "$LIST" | cut -d/ -f2 | sort -u | tr '\n' ' ')
say "ABI:     ${ABIS:-нет нативных библиотек}"

LIBS=$(grep -E '^lib/[^/]+/.*\.so$' "$LIST" | sed 's|.*/||' | sort -u | tr '\n' ' ')
say "libs:    ${LIBS:-—}"

# крупнейшие файлы внутри
h "крупнейшие файлы"
unzip -l "$APK" 2>/dev/null | awk 'NR>3 && $1 ~ /^[0-9]+$/ && $4 != "" {print $1, $4}' \
  | sort -rn | head -n 8 | awk '{printf "  %8.2f МБ  %s\n", $1/1048576, $2}' | tee -a "$REPORT"

# ---------------------------------------------------------------- 3. движок
h "движок"
engine="не определён"
if grep -qE '^lib/.*/libil2cpp\.so$' "$LIST"; then
  engine="Unity (IL2CPP)"
elif grep -qE '^assets/bin/Data/Managed/.*\.dll$' "$LIST"; then
  engine="Unity (Mono)"
elif grep -qE '^lib/.*/libUE4\.so$|^lib/.*/libUnreal\.so$' "$LIST"; then
  engine="Unreal Engine"
elif grep -qE '^lib/.*/libgodot_android\.so$' "$LIST"; then
  engine="Godot"
elif grep -qE '^lib/.*/libflutter\.so$' "$LIST"; then
  engine="Flutter"
elif grep -qE '^lib/.*/libreactnativejni\.so$|^assets/index\.android\.bundle$' "$LIST"; then
  engine="React Native"
elif grep -qE '^assets/www/index\.html$' "$LIST"; then
  engine="Cordova / WebView"
fi
say "движок:  $engine"
[ "$engine" = "Unity (IL2CPP)" ] && say "metadata: $(grep -qx 'assets/bin/Data/Managed/Metadata/global-metadata.dat' "$LIST" && echo есть || echo НЕТ)"

# ---------------------------------------------------------------- 4. нативные библиотеки
h "нативные библиотеки"
if have readelf; then
  first_so=$(grep -E '^lib/.*\.so$' "$LIST" | head -n 1)
  if [ -n "$first_so" ]; then
    while IFS= read -r so; do
      tmp=$(mktemp)
      unzip -p "$APK" "$so" > "$tmp" 2>/dev/null || { rm -f "$tmp"; continue; }
      machine=$(readelf -h "$tmp" 2>/dev/null | awk -F: '/Machine/ {gsub(/^ +/,"",$2); print $2}' | cut -c1-18)
      type=$(readelf -h "$tmp" 2>/dev/null | awk -F: '/Type:/ {gsub(/^ +/,"",$2); print $2}' | awk '{print $1}')
      sections=$(readelf -S "$tmp" 2>/dev/null | grep -c '^  \[' || true)
      size=$(wc -c < "$tmp")
      printf '  %-30s %9.1f КБ  %-18s %-5s секций: %s\n' \
        "$(basename "$so")" "$(awk -v s="$size" 'BEGIN{print s/1024}')" "${machine:-?}" "${type:-?}" "$sections" | tee -a "$REPORT"
      rm -f "$tmp"
    done < <(grep -E '^lib/.*\.so$' "$LIST")
  else
    say "  нет .so"
  fi
else
  say "  readelf не найден (binutils) — пропускаю разбор ELF"
fi

# ---------------------------------------------------------------- 5. защита
h "признаки защиты"
PROTECT=0

# 5.1 манифест должен быть бинарным AXML: первое слово 0x0003
tmpm=$(mktemp)
if unzip -p "$APK" AndroidManifest.xml > "$tmpm" 2>/dev/null; then
  type=$(python3 - "$tmpm" <<'PY'
import sys, struct
d = open(sys.argv[1], 'rb').read(8)
print(hex(struct.unpack('<H', d[:2])[0]) if len(d) >= 2 else '?')
PY
)
  if [ "$type" = "0x3" ]; then
    say "манифест: бинарный AXML (норма)"
  else
    say "манифест: тип $type — не AXML, возможно переупакован"
  fi
fi
rm -f "$tmpm"

# 5.2 метаданные IL2CPP
GM='assets/bin/Data/Managed/Metadata/global-metadata.dat'
if grep -qx "$GM" "$LIST"; then
  tmpg=$(mktemp)
  unzip -p "$APK" "$GM" > "$tmpg" 2>/dev/null
  MAGIC=$(python3 - "$tmpg" <<'PY'
import sys
d = open(sys.argv[1], 'rb').read(4)
print(hex(int.from_bytes(d, 'little')) if len(d) == 4 else '?')
PY
)
  say "metadata: магия $MAGIC (должна быть 0xfab11baf)"
  if [ "$MAGIC" = "0xfab11baf" ]; then
    say "metadata: НЕ зашифрованы — Il2CppDumper справится"
  else
    say "metadata: ЗАШИФРОВАНЫ — статически не читаются"
    PROTECT=1
  fi

  say "энтропия metadata по 1 МБ:"
  MARK=$([ "$MAGIC" = "0xfab11baf" ] && echo 0 || echo 1) python3 - "$tmpg" <<'PY' | tee -a "$REPORT"
import os, sys, math
mark = os.environ.get('MARK') == '1'
d = open(sys.argv[1], 'rb').read()
STEP = 1 << 20
for off in range(0, len(d), STEP):
    chunk = d[off:off+STEP]
    if not chunk:
        break
    freq = [0] * 256
    for b in chunk:
        freq[b] += 1
    n = len(chunk)
    h = -sum((c / n) * math.log2(c / n) for c in freq if c)
    flag = '  <- шифр' if (h > 7.9 and mark) else ''
    print(f'  {off/1048576:6.1f} МБ  {h:.2f}{flag}')
PY
  rm -f "$tmpg"
fi

# 5.3 упакованные библиотеки: доля печатных строк
if have readelf; then
  while IFS= read -r so; do
    tmp=$(mktemp)
    unzip -p "$APK" "$so" > "$tmp" 2>/dev/null || { rm -f "$tmp"; continue; }
    if readelf -h "$tmp" >/dev/null 2>&1; then
      printable=$(LC_ALL=C grep -aoE '[ -~]{6,}' "$tmp" | wc -l)
      if [ "$printable" -lt 30 ]; then
        say "  $(basename "$so"): читаемых строк почти нет ($printable) — похоже на упаковку/шифрование"
        PROTECT=1
      fi
    fi
    rm -f "$tmp"
  done < <(grep -E '^lib/.*\.so$' "$LIST")
fi

# ---------------------------------------------------------------- 6. вердикт
h "вердикт"
if [ "$PROTECT" -eq 1 ]; then
  say "Файл защищён: часть данных зашифрована. Статический разбор остановится на"
  say "описании структуры; расшифровка возможна только в памяти процесса."
else
  say "Явных признаков упаковки/шифрования нет: файл читается статически."
fi
say ""
say "отчёт: $REPORT"
