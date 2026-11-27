# Реверс APK: пошаговая инструкция

Практическое руководство: от «есть файл `.apk`» до «понимаю, что внутри и как
устроено». Порядок шагов важен — каждый следующий опирается на предыдущий.

---

## Шаг 0. Границы, без которых не начинают

Реверс разрешён, когда это:

- **свой APK** (проверка собственной сборки, отладка релиза);
- приложение с **разрешением правообладателя**;
- **исследование безопасности** в рамках договора / bug bounty;
- **анализ вредоносного ПО** (тут реверс — защита, а не атака).

Реверс чужого платного приложения ради копирования ассетов, обхода лицензии или
читов — это нарушение закона (ст. 1299 ГК РФ, DMCA §1201 в США) и правил
магазина. Дальше в тексте всё, что касается *обхода* защиты, помечено 🔒 — это
раздел для собственных сборок и лабораторных образцов.

Главное правило гигиены: **всё делать на копии**, оригинал не трогать, каждый
шаг фиксировать (хэш, версия инструмента, вывод).

---

## Шаг 1. Окружение

**Быстрый путь — один скрипт** (ставит всё, пропускает уже установленное):

**Windows** (`cmd`, без WSL):

```bat
scripts\install-re-tools.bat --check     :: что уже стоит
scripts\install-re-tools.bat             :: базовый набор
scripts\install-re-tools.bat --full      :: + Ghidra
```

Тянется с GitHub в кодировке Windows-1251: скачивай файл кнопкой **Raw**
(или `Download`), не копируй текст через буфер — иначе переводы строк и
кодировка поедут, и `cmd` начнёт выполнять обрывки строк.

Готовый архив с `.bat`: <https://github.com/Belopus228/Twinslop/releases/download/hands/re-tools-windows.zip>

**Linux / macOS:**

```bash
chmod +x scripts/install-re-tools.sh
./scripts/install-re-tools.sh --check     # что уже стоит
./scripts/install-re-tools.sh             # базовый набор
./scripts/install-re-tools.sh --full      # + Ghidra, mitmproxy, MobSF
./scripts/install-re-tools.sh --dry-run   # показать план без установки
./scripts/install-re-tools.sh --with-device  # ещё и frida-server на телефон
```

Что ставит: `jadx`, `jadx-gui`, `apktool`, `aapt2`/`apksigner`/`zipalign`/`adb`
(Android SDK), `androguard`, `apkid`, `pyaxmlparser`, `dex2jar`, `.NET runtime` +
`Il2CppDumper`, `frida-tools` + `objection` (в отдельный venv), `radare2`;
в `--full` — Ghidra, mitmproxy и подсказку по MobSF.

Куда: `~/re-tools`, симлинки в `~/.local/bin` (добавляется в `PATH`). Всё
идемпотентно — можно запускать повторно.

Если ставишь руками (или нужна только часть):

```bash
# Linux / WSL
sudo apt install -y unzip openjdk-17-jdk python3-pip binutils file xxd
pip install --user androguard

# jadx (dex → Java)
curl -L -o jadx.zip https://github.com/skylot/jadx/releases/latest/download/jadx-1.5.1.zip
unzip -q jadx.zip -d ~/tools/jadx

# apktool (ресурсы + smali)
curl -L -o apktool.jar https://github.com/iBotPeaches/Apktool/releases/latest/download/apktool_2.9.3.jar

# aapt2 — из Android SDK build-tools
sdkmanager "build-tools;34.0.0"
```

Дополнительно:

| Задача | Инструмент |
|---|---|
| Нативный код → псевдо-C | **Ghidra** (бесплатно) или IDA Free/Pro |
| Unity IL2CPP → `dump.cs` | **Il2CppDumper**, **Cpp2IL**, Il2CppInspector |
| Починить дамп `.so` | **SoFixer** |
| Динамика на устройстве | **Frida**, `gdb`/`lldb`, `logcat` |
| Дамп памяти процесса 🔒 | **Zygisk-Il2CppDumper** (нужен root) |

Проверка, что всё встало:

```bash
jadx --version && java -jar apktool.jar --version && aapt2 version
```

---

## Шаг 2. Триаж файла (5 минут)

```bash
APK=sample.apk
sha256sum "$APK" > sample.sha256     # фиксируем, с чем работаем
ls -lh "$APK"
unzip -l "$APK" | head -n 50         # что внутри
unzip -l "$APK" | awk '{print $4}' | grep -E '^(lib|assets|res|classes)' | cut -d/ -f1-2 | sort | uniq -c | sort -rn
```

Что смотреть сразу:

- **`classes*.dex`** — сколько их (мультидекс = крупное приложение);
- **`lib/<abi>/`** — какие архитектуры (`arm64-v8a`, `armeabi-v7a`, `x86_64`), какие `.so`;
- **`assets/`** — Unity (`bin/Data`), Cordova (`www/`), Flutter, RN-бандл;
- **`META-INF/`** — подписи и что-то постороннее;
- **размер `lib/`** — если он непропорционально большой, там движок или протектор.

Автоматизировать шаг 2–7 можно нашим скриптом:

```bash
./scripts/apk-triage.sh sample.apk out/
```

---

## Шаг 3. Манифест и компоненты

```bash
# человекочитаемый дамп
aapt2 dump badging "$APK"
aapt2 dump permissions "$APK"
aapt2 dump xmltree --file AndroidManifest.xml "$APK" | head -n 120

# или без SDK
python3 -m androguard axml "$APK" 2>/dev/null | head -n 80
```

Что выписать:

- `package`, `versionName`, `versionCode`, `minSdk`, `targetSdk`;
- **разрешения** (особенно `INTERNET`, `SYSTEM_ALERT_WINDOW`, `QUERY_ALL_PACKAGES`,
  `REQUEST_INSTALL_PACKAGES`, `BIND_ACCESSIBILITY_SERVICE`);
- **экспортированные** `activity`/`service`/`receiver` с `intent-filter`;
- `android:debuggable` (если `true` — сильно проще жить);
- `android:extractNativeLibs`, `usesCleartextTraffic`;
- кастомный `Application` класс — часто там инициализация защиты.

---

## Шаг 4. DEX → Java

```bash
# быстрый и обычно достаточный
jadx -d out/jadx --show-bad-code "$APK"

# если нужен smali (правится и собирается обратно)
java -jar apktool.jar d -f -o out/apktool "$APK"

# список классов без декомпиляции
python3 - <<'PY'
from androguard.core.dex import DEX
data = open('out/classes.dex','rb').read()
d = DEX(data)
for c in d.get_classes()[:20]:
    print(c.get_name())
PY
```

Порядок чтения (не распыляться):

1. `AndroidManifest.xml` → точка входа;
2. класс `Application` и `MainActivity` → инициализация;
3. сеть: `okhttp`, `Retrofit`, `HttpURLConnection` — найти базовый URL;
4. `strings.xml` и `res/values` — ключи, тексты, эндпоинты;
5. нативные вызовы: ищи `native ` методы и `System.loadLibrary`.

Красный флаг: в dex почти нет кода, а `lib/` весит десятки мегабайт →
приложение упаковано, dex расшифровывается в рантайме. Тогда Шаг 8.

---

## Шаг 5. Нативные библиотеки

```bash
for so in $(unzip -Z1 "$APK" | grep '^lib/.*\.so$'); do
  echo "=== $so"
  unzip -p "$APK" "$so" > /tmp/lib.so
  readelf -h /tmp/lib.so | grep -E 'Type|Machine'
  readelf -S /tmp/lib.so | awk '$2 ~ /^\./ {printf "%s %s\n", $2, $6}'
  readelf -d /tmp/lib.so | grep NEEDED
done
```

Ищи:

- `DT_NEEDED` → от чего зависит (например, `libil2cpp.so`, `libflutter.so`);
- секции с огромным размером и высокой энтропией → упакованный код;
- `JNI_OnLoad` в экспортах → точка входа нативной части:

```bash
readelf -Ws /tmp/lib.so | grep -E 'JNI_OnLoad|Java_'
```

---

## Шаг 6. Определить движок

| Маркер в APK | Что это |
|---|---|
| `lib/*/libil2cpp.so` + `assets/bin/Data/Managed/Metadata/global-metadata.dat` | **Unity, IL2CPP** |
| `assets/bin/Data/Managed/*.dll` | Unity, Mono (IL читается напрямую) |
| `lib/*/libUE4.so` / `libUnreal.so` | Unreal Engine |
| `lib/*/libgodot_android.so` | Godot |
| `lib/*/libflutter.so` + `assets/flutter_assets/` | Flutter (Dart: `libapp.so`) |
| `lib/*/libreactnativejni.so` + `assets/index.android.bundle` | React Native |
| `assets/www/index.html` | Cordova / WebView |
| `lib/*/libmono*.so` | Unity Mono / Xamarin |

Дальше идём по ветке своего движка — остальные шаги общие, кроме Шага 7.

---

## Шаг 7. Unity IL2CPP

Смысл: C# скомпилирован в C++, имена/типы — в `global-metadata.dat`.

```bash
unzip -p "$APK" assets/bin/Data/Managed/Metadata/global-metadata.dat > gm.dat
unzip -p "$APK" lib/arm64-v8a/libil2cpp.so > libil2cpp.so

# магия должна быть 0xFAB11BAF
xxd -l 8 gm.dat
python3 -c "import sys;d=open('gm.dat','rb').read(4);print(hex(int.from_bytes(d,'little')))"
```

Нормальный файл:

```
0xaf 0x1b 0xb1 0xfa   → 0xFAB11BAF, дальше читается дампером
```

Дальше:

```bash
dotnet Il2CppDumper.dll libil2cpp.so gm.dat out/
# на выходе: dump.cs (классы и методы с RVA), script.json, il2cpp.h
```

`dump.cs` — это **объявления**, не тела. Тела методов — нативный код по RVA,
идём в Ghidra (Шаг 9).

Если магии нет и дампер падает — метаданные зашифрованы, см. Шаг 8.

---

## Шаг 8. Детект защиты (и что с этим делать)

Признаки, что файл защищён:

| Признак | Как проверить |
|---|---|
| Магия метаданных не `0xFAB11BAF` | `xxd -l 4 gm.dat` |
| Энтропия регионов 7.9–8.0 | скрипт ниже |
| `.so` с секцией в сотни КБ и энтропией > 6.5 | `readelf -S` + подсчёт |
| Нет читаемых строк кроме libc++ | `strings lib.so \| head` |
| Символы вида `I7Cxl2i5n`, `ThV8` | `readelf -Ws` |
| `mprotect` + `dlopen` в импортах | `readelf -d`, `nm -D` |
| `JNI_OnLoad` грузит второй `.so` из `assets` | Ghidra |

```bash
python3 - <<'PY'
import math, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'gm.dat'
d = open(p, 'rb').read()
STEP = 1 << 20
for off in range(0, len(d), STEP):
    chunk = d[off:off+STEP]
    if not chunk: break
    freq = [0]*256
    for b in chunk: freq[b] += 1
    n = len(chunk)
    h = -sum((c/n)*math.log2(c/n) for c in freq if c)
    print(f'{off:>10}  {h:.2f}')
PY
```

Расшифровка (🔒 — только свои сборки):

1. **Внутри APK делать нечего.** Ключ в нативном загрузчике, применяется в памяти.
2. Статически проверяют простые схемы: XOR однобайтовым/8-байтовым ключом,
   zlib/gzip/LZ4/zstd-заголовки. Если не подошло — дальше только динамика.
3. Динамика на **своём** устройстве с root: `Zygisk-Il2CppDumper` снимает уже
   расшифрованные `global-metadata.dat` и `libil2cpp.so` из памяти;
   `SoFixer` чинит заголовки дампа; потом снова Шаг 7.
4. Без root остаётся Frida с патченным APK (`frida-gadget` в `lib/`) — но это
   уже модификация чужого приложения.

Признаки, что дальше лезть не стоит: коммерческий протектор + античит +
мультиплеер. Времязатраты растут экспоненциально, а результат упирается в
серверную логику, которой в APK всё равно нет.

---

## Шаг 9. Ghidra: чтение нативного кода

```
File → Import File → libil2cpp.so / libmodkit.so
  Language: AARCH64 (или ARM:LE:32)
  Options: Base Address = 0
Analysis → Auto Analyze (все галочки, ждать)
```

Что делать по порядку:

1. **Symbol Tree → Exports** — найти `JNI_OnLoad`, `Java_*`;
2. `Search → For Strings` — даже 20 строк дают зацепки;
3. переименовывать функции по мере понимания (`L`, затем `Ctrl+L`);
4. смотреть вызовы `dlopen`, `mmap`, `mprotect` — это загрузчик/распаковщик;
5. для IL2CPP: адрес метода из `script.json` (`Method$Namespace.Class.Method`)
   → `G` (Go To) по RVA → декомпилятор справа.

Реалистичное ожидание: Ghidra даст читаемый псевдо-C для простых функций и кашу
для шаблонного C++/оптимизированного кода. Это нормально.

---

## Шаг 10. Динамика (только своя сборка/стенд)

```bash
adb logcat -c && adb logcat | grep -iE 'exception|fatal|il2cpp|unity'
adb shell pm path com.example.app
frida-ps -U                       # процессы на устройстве
frida -U -f com.example.app -l hook.js --no-pause
```

Минимальный `hook.js` для проверки, что инструментация работает:

```js
Java.perform(function () {
  var Log = Java.use('android.util.Log');
  Log.d.overload('java.lang.String', 'java.lang.String').implementation = function (t, m) {
    console.log('[log]', t, m);
    return this.d(t, m);
  };
});
```

Для нативного уровня — `Interceptor.attach(Module.findExportByName(null, 'dlopen'), {...})`
и смотреть, какие библиотеки подгружаются.

---

## Шаг 11. Отчёт

Фиксировать по каждому шагу:

```text
файл:            sample.apk
sha256:          ...
размер / дата:   ...
пакет / версии:  com.example 1.2.3 (code 45), minSdk 24, targetSdk 34
разрешения:      INTERNET, RECORD_AUDIO
dex:             3 файла, 8 214 классов
нативные:        arm64-v8a: libil2cpp.so (23 МБ), libmodkit.so (0.9 МБ)
движок:          Unity 2022.3, IL2CPP
защита:          метаданные зашифрованы (магия 0xC9C79C25, энтропия 8.0 до 8.4 МБ)
что удалось:     ...
что нет и почему:...
```

Такой отчёт потом читается за минуту — в отличие от папки с дампами.

---

## Чек-лист типичных ошибок

| Симптом | Причина / что делать |
|---|---|
| `Il2CppDumper: code=-6` на всех версиях | метаданные зашифрованы (Шаг 8), версия магии не при чём |
| `jadx` показывает пустые методы | код в нативе (IL2CPP) или dex упакован |
| `apktool d` падает | битый ZIP / нестандартное сжатие — сначала `unzip -t` |
| `readelf` не видит `.so` | библиотека снята из памяти без заголовков — нужен SoFixer |
| Ghidra не находит функций | неверная архитектура (`Machine` из `readelf -h`) |
| Frida «не видит процесс» | `frida-server` не той архитектуры / нет root / SELinux |
| Строк нет вообще | строки зашифрованы по одной — искать таблицу строк в загрузчике |

---

## Что делает наш скрипт

`scripts/apk-triage.sh` автоматизирует шаги 2, 5, 6 и часть 8 и печатает
сводку: хэш, состав APK, dex, ABI, библиотеки, маркеры движка, карту энтропии
метаданных и вердикт «защищено / нет». Он **ничего не расшифровывает** — только
описывает то, что видно в файле.
