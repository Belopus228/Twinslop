#!/usr/bin/env bash
# install-re-tools.sh — ставит набор инструментов для реверса APK.
#
# Проверено на: Ubuntu 22.04/24.04, Debian 12, Kali, WSL2.
# macOS поддерживается частично (brew), Windows — только через WSL.
#
# Использование:
#   ./scripts/install-re-tools.sh              # базовый набор
#   ./scripts/install-re-tools.sh --full       # + Ghidra, mitmproxy, MobSF, Cutter
#   ./scripts/install-re-tools.sh --check      # только показать, что уже стоит
#   ./scripts/install-re-tools.sh --dry-run    # показать план, ничего не делать
#   ./scripts/install-re-tools.sh --dir ~/re   # куда ставить (по умолчанию ~/re-tools)
#   ./scripts/install-re-tools.sh --no-sudo    # если sudo недоступен
#
# Скрипт идемпотентен: уже установленное пропускает.
#
# Эти инструменты — для анализа СВОИХ приложений, стендов и образцов с
# разрешения. Реверс чужого ПО ради обхода защиты/копирования — нарушение закона.

set -uo pipefail

TOOLS_DIR="${HOME}/re-tools"
MODE="core"
DRY_RUN=0
CHECK_ONLY=0
USE_SUDO=1
WITH_DEVICE=0

# ---------------------------------------------------------------- вывод
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_ERR=""; C_DIM=""; C_OFF=""
fi
ok()   { printf '%s  ok %s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s  !! %s %s\n' "$C_WARN" "$C_OFF" "$*"; }
err()  { printf '%s  xx %s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; }
step() { printf '\n%s== %s ==%s\n' "$C_DIM" "$*" "$C_OFF"; }
have() {
  command -v "$1" >/dev/null 2>&1 && return 0
  [ -x "${BIN_DIR:-/nonexistent}/$1" ] && return 0
  [ -x "${SDK_DIR:-/nonexistent}/build-tools/34.0.0/$1" ] && return 0
  [ -x "${SDK_DIR:-/nonexistent}/platform-tools/$1" ] && return 0
  return 1
}

where() {
  command -v "$1" 2>/dev/null \
    || { [ -x "${BIN_DIR:-/nonexistent}/$1" ] && echo "${BIN_DIR}/$1"; } \
    || { [ -x "${SDK_DIR:-/nonexistent}/build-tools/34.0.0/$1" ] && echo "${SDK_DIR}/build-tools/34.0.0/$1"; } \
    || { [ -x "${SDK_DIR:-/nonexistent}/platform-tools/$1" ] && echo "${SDK_DIR}/platform-tools/$1"; }
}

run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry] %s\n' "$*"
    return 0
  fi
  "$@"
}

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# ---------------------------------------------------------------- аргументы
while [ $# -gt 0 ]; do
  case "$1" in
    --full) MODE="full" ;;
    --minimal) MODE="core" ;;
    --check) CHECK_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --no-sudo) USE_SUDO=0 ;;
    --with-device) WITH_DEVICE=1 ;;
    --dir) shift; TOOLS_DIR="${1:-}" ;;
    -h|--help) usage ;;
    *) err "неизвестный аргумент: $1 (--help)"; exit 64 ;;
  esac
  shift
done

[ -n "$TOOLS_DIR" ] || { err "пустой --dir"; exit 64; }

BIN_DIR="$HOME/.local/bin"
SDK_DIR="$TOOLS_DIR/android-sdk"

# ---------------------------------------------------------------- ОС
OS="unknown"
PKG=""
if [ "$(uname -s)" = "Darwin" ]; then
  OS="macos"
  have brew || warn "Homebrew не найден — часть пакетов не поставится: https://brew.sh"
elif [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}${ID_LIKE:-}" in
    *debian*|*ubuntu*|*kali*) OS="debian"; PKG="apt" ;;
    *fedora*|*rhel*|*centos*) OS="fedora"; PKG="dnf" ;;
    *arch*|*manjaro*) OS="arch"; PKG="pacman" ;;
  esac
else
  OS="linux"
fi

SUDO=""
if [ "$USE_SUDO" = 1 ] && [ "$(id -u)" != "0" ] && have sudo; then
  SUDO="sudo"
fi

printf 'ОС: %s · пакеты: %s · каталог: %s · режим: %s%s\n' \
  "$OS" "${PKG:-—}" "$TOOLS_DIR" "$MODE" "$([ "$DRY_RUN" = 1 ] && echo ' (dry-run)')"

if [ "$OS" = "unknown" ] && [ "$CHECK_ONLY" = 0 ]; then
  warn "неизвестная ОС: системные пакеты не поставим, продолжу с ручными установками"
fi

# ---------------------------------------------------------------- пакеты ОС
apt_install() {
  local pkgs=("$@")
  local missing=()
  for p in "${pkgs[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
  done
  [ ${#missing[@]} -eq 0 ] && { ok "системные: ${pkgs[*]} (уже стоят)"; return 0; }
  run $SUDO apt-get update -qq
  run $SUDO apt-get install -y --no-install-recommends "${missing[@]}"
  ok "системные: ${missing[*]}"
}

install_system_packages() {
  step "системные пакеты"
  local base=(curl unzip zip xz-utils git python3 python3-pip python3-venv openjdk-17-jdk binutils file xxd jq)
  if [ "$OS" = "debian" ]; then
    apt_install "${base[@]}"
    apt_install ripgrep || warn "ripgrep недоступен — не критично"
    # radare2 есть не везде — не ломаем установку
    dpkg -s radare2 >/dev/null 2>&1 || run $SUDO apt-get install -y --no-install-recommends radare2 || warn "radare2 не поставился (не критично)"
    [ "$MODE" = "full" ] && { apt_install mitmproxy || warn "mitmproxy: поставлю через pipx"; }
  elif [ "$OS" = "fedora" ]; then
    run $SUDO dnf install -y curl unzip zip xz git python3 python3-pip java-17-openjdk-devel binutils file jq ripgrep
  elif [ "$OS" = "arch" ]; then
    run $SUDO pacman -S --needed --noconfirm curl unzip zip xz git python python-pip jdk17-openjdk binutils file jq ripgrep
  elif [ "$OS" = "macos" ]; then
    run brew install curl unzip xz git python openjdk@17 binutils jq ripgrep
  fi
}

# ---------------------------------------------------------------- helpers
ensure_dirs() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry] mkdir -p %s %s\n' "$TOOLS_DIR" "$BIN_DIR"
    return 0
  fi
  mkdir -p "$TOOLS_DIR" "$BIN_DIR" 2>/dev/null || true
}

# gh_asset <repo> <regex> → URL первого подходящего ассета последнего релиза
gh_asset() {
  local repo="$1" pat="$2"
  curl -fsSL --retry 2 "https://api.github.com/repos/${repo}/releases/latest" 2>/dev/null \
    | python3 -c 'import json,sys,re
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for a in d.get("assets",[]):
    if re.search(sys.argv[1], a.get("name","")):
        print(a["browser_download_url"]); break' "$pat"
}

download() { # url dest
  local url="$1" dest="$2"
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry] curl -L %s → %s\n' "$url" "$dest"
    return 0
  fi
  curl -fL --retry 3 --progress-bar "$url" -o "$dest" || { err "скачать не удалось: $url"; return 1; }
}

link_bin() { # target name
  local target="$1" name="$2"
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry] ln -sf %s %s/%s\n' "$target" "$BIN_DIR" "$name"
    return 0
  fi
  mkdir -p "$BIN_DIR"
  ln -sf "$target" "$BIN_DIR/$name"
  ok "$name → $target"
}

# ---------------------------------------------------------------- jadx
install_jadx() {
  step "jadx (dex → Java)"
  if have jadx; then ok "jadx уже есть: $(jadx --version 2>/dev/null | head -n1)"; return 0; fi

  local url; url=$(gh_asset "skylot/jadx" 'jadx-[0-9]+\.[0-9]+\.[0-9]+\.zip$')
  [ -n "$url" ] || { err "не нашёл релиз jadx"; return 1; }
  local zip="$TOOLS_DIR/jadx.zip"
  download "$url" "$zip" || return 1
  run rm -rf "$TOOLS_DIR/jadx"
  run unzip -q -o "$zip" -d "$TOOLS_DIR/jadx"
  run rm -f "$zip"
  link_bin "$TOOLS_DIR/jadx/bin/jadx" jadx
  link_bin "$TOOLS_DIR/jadx/bin/jadx-gui" jadx-gui
}

# ---------------------------------------------------------------- apktool
install_apktool() {
  step "apktool (ресурсы + smali)"
  if have apktool; then ok "apktool уже есть: $(apktool --version 2>/dev/null | head -n1)"; return 0; fi

  local url; url=$(gh_asset "iBotPeaches/Apktool" 'apktool_[0-9.]+\.jar$')
  [ -n "$url" ] || { err "не нашёл релиз apktool"; return 1; }
  run mkdir -p "$HOME/.local/share/apktool"
  download "$url" "$HOME/.local/share/apktool/apktool.jar" || return 1

  if [ "$DRY_RUN" = 0 ]; then
    mkdir -p "$BIN_DIR"
    cat > "$BIN_DIR/apktool" <<'WRAP'
#!/usr/bin/env bash
exec java ${JAVA_OPTS:--Xmx1024m} -jar "$HOME/.local/share/apktool/apktool.jar" "$@"
WRAP
    chmod +x "$BIN_DIR/apktool"
  fi
  ok "apktool → ~/.local/share/apktool/apktool.jar"
}

# ---------------------------------------------------------------- Android SDK
install_android_sdk() {
  step "Android SDK (aapt2, apksigner, adb)"
  if [ -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
    ok "cmdline-tools уже распакованы"
  else
    local zip="$TOOLS_DIR/cmdline-tools.zip"
    local url="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
    [ "$OS" = "macos" ] && url="https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
    download "$url" "$zip" || return 1
    run mkdir -p "$SDK_DIR/cmdline-tools"
    run unzip -q -o "$zip" -d "$SDK_DIR/cmdline-tools"
    run rm -f "$zip"
    run mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest" 2>/dev/null || true
  fi

  if [ "$DRY_RUN" = 0 ]; then
    export ANDROID_HOME="$SDK_DIR"
    export PATH="$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"
    yes | sdkmanager --licenses >/dev/null 2>&1 || true
    sdkmanager --install "platform-tools" "build-tools;34.0.0" >/dev/null 2>&1 \
      || warn "sdkmanager не смог поставить пакеты (нет сети?)"
    for t in aapt2 apksigner zipalign; do
      [ -x "$SDK_DIR/build-tools/34.0.0/$t" ] && link_bin "$SDK_DIR/build-tools/34.0.0/$t" "$t"
    done
    [ -x "$SDK_DIR/platform-tools/adb" ] && link_bin "$SDK_DIR/platform-tools/adb" adb
  fi
}

# ---------------------------------------------------------------- Python-инструменты
install_python_tools() {
  step "Python-инструменты (androguard, apkid, frida-tools)"
  have pipx || run $SUDO apt-get install -y pipx 2>/dev/null || true
  python3 -m pip --version >/dev/null 2>&1 || { warn "pip нет — пропускаю"; return 0; }

  local pkgs=(androguard pyaxmlparser apkid)
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry] python3 -m pip install --user --break-system-packages %s\n' "${pkgs[*]}"
  else
    python3 -m pip install --user --quiet --break-system-packages "${pkgs[@]}" 2>/dev/null \
      || python3 -m pip install --user --quiet "${pkgs[@]}" 2>/dev/null \
      || warn "pip: часть пакетов не встала (PEP 668?) — используй venv"
  fi
  ok "androguard / pyaxmlparser / apkid"

  # frida-tools в отдельный venv, чтобы не ломать системный python
  local fv="$TOOLS_DIR/frida-venv"
  if [ ! -x "$fv/bin/frida" ]; then
    run python3 -m venv "$fv"
    run "$fv/bin/pip" install --quiet --upgrade pip
    run "$fv/bin/pip" install --quiet frida-tools objection
  fi
  [ -x "$fv/bin/frida" ] && link_bin "$fv/bin/frida" frida
  [ -x "$fv/bin/frida-ps" ] && link_bin "$fv/bin/frida-ps" frida-ps
  [ -x "$fv/bin/objection" ] && link_bin "$fv/bin/objection" objection
}

# ---------------------------------------------------------------- dex2jar
install_dex2jar() {
  step "dex2jar (dex → jar)"
  if have d2j-dex2jar; then ok "dex2jar уже есть"; return 0; fi

  local url; url=$(gh_asset "pxb1988/dex2jar" 'dex-tools.*\.zip$')
  [ -n "$url" ] || { err "не нашёл релиз dex2jar"; return 1; }
  local zip="$TOOLS_DIR/dex2jar.zip"
  download "$url" "$zip" || return 1
  run rm -rf "$TOOLS_DIR/dex2jar"
  run unzip -q -o "$zip" -d "$TOOLS_DIR/dex2jar"
  run rm -f "$zip"
  local dir; dir=$(find "$TOOLS_DIR/dex2jar" -maxdepth 2 -name 'd2j-dex2jar.sh' -printf '%h\n' 2>/dev/null | head -n1)
  [ -n "$dir" ] && run chmod +x "$dir"/*.sh 2>/dev/null
  [ -n "$dir" ] && link_bin "$dir/d2j-dex2jar.sh" d2j-dex2jar
}

# ---------------------------------------------------------------- .NET + IL2CPP
install_il2cpp() {
  step ".NET runtime + Il2CppDumper (Unity IL2CPP)"
  if ! have dotnet; then
    if [ "$OS" = "debian" ]; then
      run $SUDO apt-get install -y dotnet-runtime-8.0 2>/dev/null \
        || warn "dotnet-runtime-8.0 нет в репозитории — поставь вручную: https://dot.net"
    else
      warn "поставь .NET 8 runtime вручную: https://dot.net"
    fi
  fi
  have dotnet && ok "dotnet: $(dotnet --version 2>/dev/null | head -n1)"

  if [ -d "$TOOLS_DIR/Il2CppDumper" ]; then ok "Il2CppDumper уже распакован"; return 0; fi
  local url; url=$(gh_asset "Perfare/Il2CppDumper" '\.zip$')
  [ -n "$url" ] || { warn "не нашёл релиз Il2CppDumper"; return 0; }
  local zip="$TOOLS_DIR/il2cppdumper.zip"
  download "$url" "$zip" || return 1
  run mkdir -p "$TOOLS_DIR/Il2CppDumper"
  run unzip -q -o "$zip" -d "$TOOLS_DIR/Il2CppDumper"
  run rm -f "$zip"
  ok "Il2CppDumper → $TOOLS_DIR/Il2CppDumper"
}

# ---------------------------------------------------------------- Ghidra
install_ghidra() {
  step "Ghidra (нативный код → псевдо-C)"
  have ghidraRun && { ok "Ghidra уже есть"; return 0; }
  if [ -x "$TOOLS_DIR/ghidra/support/ghidraRun" ]; then ok "Ghidra уже распакована"; else
    local url; url=$(gh_asset "NationalSecurityAgency/ghidra" 'ghidra_.*_PUBLIC_.*\.zip$')
    [ -n "$url" ] || { warn "не нашёл релиз Ghidra"; return 0; }
    warn "Ghidra ~450 МБ, качается долго"
    local zip="$TOOLS_DIR/ghidra.zip"
    download "$url" "$zip" || return 1
    run rm -rf "$TOOLS_DIR/ghidra"
    run unzip -q -o "$zip" -d "$TOOLS_DIR"
    run rm -f "$zip"
    local dir; dir=$(find "$TOOLS_DIR" -maxdepth 1 -type d -name 'ghidra_*' | head -n1)
    [ -n "$dir" ] && run mv "$dir" "$TOOLS_DIR/ghidra"
  fi
  link_bin "$TOOLS_DIR/ghidra/support/ghidraRun" ghidraRun
}

# ---------------------------------------------------------------- доп. в --full
install_extras() {
  step "дополнительно (--full)"
  have mitmproxy || {
    local mv="$TOOLS_DIR/mitm-venv"
    if [ ! -x "$mv/bin/mitmproxy" ]; then
      run python3 -m venv "$mv"
      run "$mv/bin/pip" install --quiet --upgrade pip
      run "$mv/bin/pip" install --quiet mitmproxy
    fi
    [ -x "$mv/bin/mitmproxy" ] && link_bin "$mv/bin/mitmproxy" mitmproxy
  }

  if have docker; then
    ok "docker есть — MobSF можно поднять так:"
    printf '     docker run --rm -p 8000:8000 opensecurity/mobile-security-framework-mobsf\n'
  else
    warn "docker не найден — MobSF пропущен (https://github.com/MobSF/Mobile-Security-Framework-MobSF)"
  fi

  cat <<'EOF'

  Полезное из GitHub (ставь по необходимости):
    • Cutter / rizin      — GUI к radare2
    • Zygisk-Il2CppDumper — дамп IL2CPP из памяти (нужен root + Magisk/Zygisk)
    • frida-server        — на устройство, версия должна совпадать с frida на ПК
    • jadx-gui            — уже поставлен вместе с jadx
EOF
}

# ---------------------------------------------------------------- frida-server на устройство
install_frida_server() {
  step "frida-server на устройство (--with-device)"
  have adb || { warn "adb нет — пропускаю"; return 0; }
  have frida || { warn "frida нет — пропускаю"; return 0; }

  local serial
  serial=$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}')
  [ -n "$serial" ] || { warn "устройство не подключено (adb devices) — пропускаю"; return 0; }

  local abi ver asset
  abi=$(adb -s "$serial" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r')
  ver=$(frida --version 2>/dev/null | tr -d '\r')
  case "$abi" in
    arm64-v8a) asset="android-arm64" ;;
    armeabi-v7a) asset="android-arm" ;;
    x86_64) asset="android-x86_64" ;;
    x86) asset="android-x86" ;;
    *) warn "неизвестная ABI: ${abi:-?}"; return 0 ;;
  esac

  local url="https://github.com/frida/frida/releases/download/${ver}/frida-server-${ver}-${asset}.xz"
  local out="$TOOLS_DIR/frida-server-${ver}-${asset}"
  download "$url" "${out}.xz" || return 1
  if [ "$DRY_RUN" = 0 ]; then
    xz -df "${out}.xz" 2>/dev/null || { warn "не распаковал .xz"; return 1; }
    adb -s "$serial" push "$out" /data/local/tmp/frida-server >/dev/null 2>&1 \
      && adb -s "$serial" shell chmod 755 /data/local/tmp/frida-server \
      && ok "frida-server ${ver} (${asset}) на устройстве"
  fi
  cat <<'EOF'
     запуск (нужен root):
       adb shell "su -c '/data/local/tmp/frida-server &'"
       frida-ps -U
EOF
}

# ---------------------------------------------------------------- PATH
setup_path() {
  step "PATH"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ok "$BIN_DIR уже в PATH" ;;
    *) ok "добавлю $BIN_DIR в PATH (в rc-файл)"
       if [ "$DRY_RUN" = 0 ]; then
         local rc="$HOME/.bashrc"
         [ -n "${SHELL:-}" ] && [ "${SHELL##*/}" = "zsh" ] && rc="$HOME/.zshrc"
         grep -q 're-tools PATH' "$rc" 2>/dev/null || {
           printf '\n# re-tools PATH\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
         }
       fi
       ;;
  esac
  [ -x "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ] && ok "Android SDK: $SDK_DIR"
}

# ---------------------------------------------------------------- проверка
verify() {
  step "проверка установленного"
  local tools=(jadx apktool aapt2 apksigner adb d2j-dex2jar frida dotnet python3)
  [ "$MODE" = "full" ] && tools+=(ghidraRun)
  local missing=()
  for t in "${tools[@]}"; do
    if have "$t"; then
      printf '   %s%-14s%s %s\n' "$C_OK" "$t" "$C_OFF" "$(where "$t")"
    else
      printf '   %s%-14s%s нет\n' "$C_WARN" "$t" "$C_OFF"
      missing+=("$t")
    fi
  done
  if have python3; then
    python3 - <<'PY' 2>/dev/null || true
for m in ("androguard", "apkid"):
    try:
        __import__(m); print(f"   {m:<14} ok")
    except Exception:
        print(f"   {m:<14} нет")
PY
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    printf '\n%sНе установлено:%s %s\n' "$C_WARN" "$C_OFF" "${missing[*]}"
    printf 'Открой новый терминал (PATH) и запусти скрипт ещё раз.\n'
  else
    printf '\n%sВсё на месте.%s\n' "$C_OK" "$C_OFF"
  fi
}

# ---------------------------------------------------------------- главное
main() {
  if [ "$CHECK_ONLY" = 1 ]; then
    verify
    [ -d "$TOOLS_DIR" ] && printf '\nкаталог инструментов: %s (%s)\n' "$TOOLS_DIR" "$(du -sh "$TOOLS_DIR" 2>/dev/null | cut -f1)"
    exit 0
  fi

  [ "$OS" = "unknown" ] || install_system_packages
  ensure_dirs

  install_jadx
  install_apktool
  install_android_sdk
  install_python_tools
  install_dex2jar
  install_il2cpp
  [ "$MODE" = "full" ] && install_ghidra
  [ "$MODE" = "full" ] && install_extras
  [ "$WITH_DEVICE" = 1 ] && install_frida_server

  setup_path
  [ "$DRY_RUN" = 0 ] && verify

  cat <<EOF

Дальше:
  1. новый терминал (или: export PATH="$BIN_DIR:\$PATH")
  2. триаж APK:      ./scripts/apk-triage.sh app.apk out/
  3. инструкция:     docs/REVERSE-APK.md
  4. устройство:     adb devices && frida-ps -U

Напоминание: инструменты — для своих приложений, стендов и образцов
с разрешения. Обход защиты чужого ПО — нарушение закона и правил магазинов.
EOF
}

main
