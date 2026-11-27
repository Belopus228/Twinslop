# Разбор APK: `WVRClientv1release.1.apk`

> Отчёт собран автоматически на GitHub Actions (`apk-inspect`) — раннер скачал APK,
> распаковал, снял паспорт, вытащил строки из нативных библиотек и имена скриптов
> Unity. Сырые выжимки лежат в `apk-report/` и `apk-report/deep/`.
> Дата сборки отчёта: 2026-11-27.

---

## 1. Что это за файл

Это **не «клиент для телефона»**, а полноценная VR-игра для шлема (Quest) —
социальная песочница **Gilla** от Playgilla, собранная на Unity с поддержкой
OpenXR, плюс встроенная подсистема стриминга на Twitch.

| Параметр | Значение |
|---|---|
| Пакет | `com.playgilla.gilla` |
| Название | `Gilla` |
| Версия | `0.1.0` (versionCode `462973`) |
| Размер | 549.9 МБ / 1021.6 МБ распакованного |
| minSdk / targetSdk | 29 / 34 (Android 10+ / 14) |
| Движок | Unity, скриптовый бэкенд **IL2CPP** (arm64-v8a) |
| Точка входа | `com.unity3d.player.UnityPlayerGameActivity` |
| Файлов внутри | 1934 |
| Подпись | есть |

Разрешения скромные и логичные для VR-игры со стримом:
`INTERNET`, `ACCESS_NETWORK_STATE`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`,
`org.khronos.openxr.permission.*`.

---

## 2. Из чего собрано

**Игровая часть (C#/IL2CPP):**

- **Photon Fusion** — сетевая синхронизация (`FusionBootstrap`, `FusionMonoBehaviour`, `NetworkTransform`, лаг-компенсация);
- **Photon Voice** — голосовой чат (`FusionVoiceClient`, `GillaVoiceClient`, `GillaPushToTalk`, `GillaVoiceGate`, `GillaVoiceVolume` + `libwebrtc-audio.so`, `libopus_egpv.so`);
- **PlayFab** — аккаунты, инвентарь, покупки, лидерборды, отчёты (`GillaPlayFabRoute`, `CosmeticCatalog`, `GillaPurchases`);
- **Oculus/Meta Platform SDK** (`libovrplatformloader.so`, `AbuseReport`, аватары);
- **Unity Input System** — включая режим эмуляции тача (`Touch`-simulation есть в строках документации пакета);
- **URP + Entities/Burst/Collections** — 3.2 тыс. шейдеров, 105 тыс. материалов.

**Нативная часть (Rust/C++):**

| Библиотека | Роль |
|---|---|
| `libil2cpp.so` (105 МБ) | игровой код C# (обфусцирован) |
| `liblck_core.so` | Rust-бэкенд-клиент «LCK»: HTTP/2, TLS-корни, прокси, телеметрия, скачивание косметики, msgpack |
| `liblck_streaming_rs.so` | Rust-обёртка стримера: `CreateStreamer`, `StartStreamer`, `StopStreamer`, `SetStreamerUrlOverride`, `SetPacketInterleaverEnabled` |
| `libminirtmp.so` | форк librtmp (Flash-эпоха, `FCPublish`/`FCSubscribe`, токен «Justin.tv») — то, чем реально отправляется поток на `ingest.twitch.tv` |
| `libnative_microphone.so` | захват микрофона через **AAudio**, ресемплинг в моно/стерео |
| `libmodkit_gilla.so` | сторонний «модкит», упакован и зашифрован (`Invalid access!`, свои `JNI_OnLoad`) |
| `libngfx_rs.so`, `libnanosockets.so`, `lib_burst_generated.so` | графика/сеть/генерация Burst |

---

## 3. Как устроен стрим

Цепочка вырисовывается по строкам и символам:

1. **Авторизация.** `lck_streaming_rs` при старте ищет в `lck_core` символы
   `key_exchange` / `authorisation` (шифрованный обмен), иначе падает с
   `Failed to load lck-core library`. Токен стрима приходит с бэкенда
   (`get_twitch_stream_url`, `streaming.rs:125`), хардкода ключа в бинаре нет — хорошо.
2. **Подъём потока.** `CreateStreamer` → `StartStreamer` → `RTMP_IsConnected`.
   Внутри — `libminirtmp`, то есть классический RTMP.
3. **Видео.** Захват кадра игры + интерлив пакетов (`SetPacketInterleaverEnabled`)
   — это оптимизация под мобильные сети, чтобы пакеты не «слипались».
4. **Звук.** `libnative_microphone` пишет с AAudio и ресемплит; в игре есть
   `MicLevel`, `MicWrapper`, `MicAmplifier` — уровень микрофона виден в UI.
5. **Подмена адреса.** Есть `SetStreamerUrlOverride` и `SetGlobalUrlOverride`,
   а в `lck_core` — переменная окружения `LCK_BACKEND_STAGING`. То есть SDK умеет
   переключаться на другой бэкенд — это либо стенд для тестов, либо удобная дырка.

**Телеметрия.** `lck_core` отправляет отчёты в **Sentry** и собирает контекст:
`trackingId`, `projectName`, `gameVersion`, `companyName`, `engineVersion`,
`graphicsAPI`, `renderPipelineType`, `interactionSystems`, `appIdentifier`,
`rawDeviceModel`. Плюс полноценный HTTP-клиент с набором корневых CA и
**поддержкой прокси-туннелей** (`proxy authorization`, `tunnel error`).

---

## 4. Игровая часть: что внутри по системам

Из 3264 имён MonoScript-ов — **144 скрипта с префиксом `Gilla`**. Это карта
механик (имена говорят сами за себя):

- **Экономика/кастомизация:** `GillaPurchases`, `GillaBoltShop`, `GillaOutfits`, `GillaOwned`, `GillaBundleStand`, `GillaStash`, `GillaStashSave`, `CosmeticCatalog`, `CosmeticSkin`, `CosmeticFloppy`, `CosmeticToy`;
- **Соцчасть:** `GillaFriends`, `GillaLeaderboard`, `GillaDisplayName`, `GillaTerms`, `GillaReviewBoard`, `GillaFanArtBoard`, `GillaBotReport`;
- **Квесты:** `GillaQuests`, `GillaQuestTracker`, `GillaQuestBoard`;
- **Голос:** `GillaVoiceClient`, `GillaPushToTalk`, `GillaVoiceGate`, `GillaVoiceVolume`;
- **Карта/мир:** `GillaAreas`, `GillaLevel`, `GillaLevelPanel`, `GillaPlaces`, `GillaBackroomsSwitch`, `GillaTeleport`, `GillaOutOfMap`, `GillaSceneGuard`, `GillaOreField`, `GillaOreVeins`, `GillaCaveFuses`, `GillaKeycardReader`;
- **Физика/предметы:** `GillaPush`, `GillaPull`, `GillaSaw`, `GillaBearTrap`, `GillaDynamite`, `GillaFireGlow`, `GillaHeldApe`, `GillaItemDirector`;
- **Мини-игры/режимы:** `GillaSplashDirector`, `GillaSplashGame`, `GillaSplashMonster`, `GillaSplashSpectate`, `GillaVoxelSplash`, `BecomeMonsterButton`;
- **Производительность/сеть:** `GillaPerformance`, `GillaIntegrity`, `GillaPeerCheck`, `GillaPhotonVersion`, `GillaBackoff`.

Масштаб контента: **527 загружаемых сцен**, 16.6 млн `GameObject`-ов,
1.49 млн `MonoBehaviour`, 773 тыс. мешей, 8010 аудиоклипов, 27.5 тыс. `MonoScript`.

---

## 5. Главное: это модифицированная сборка

Три независимых признака:

1. **`global-metadata.dat` зашифрован** (магия файла не `0xFAB11BAF`) — стоковая
   Unity-сборка так не выглядит; метаданные перепакованы защитой.
2. **`libmodkit_gilla.so`** — сторонняя JNI-библиотека с обфускацией и защитой
   (`Invalid access!`, «свой» `JNI_OnLoad`), плюс в дампе скриптов есть классы
   **`ModMenu` и `ModMenuAccess`**, а также `FreeCamera` / `GillaFreecam`.
3. В метаданных встречаются строки вида `frida server on port`, `frida server at`
   (самой `libfrida-gadget.so` в APK нет — значит либо подгружается извне,
   либо осталась от инструментов сборки).

Вывод: APK = официальная игра + вшитый сторонний мод-/menu-слой.

### Чем это рискованно (по делу)

- **ModMenu ломает правила игры.** За такое банят аккаунт и устройство; для
  VR-игр с античитом это вопрос времени, а не вероятности.
- **Чужой код в вашем APK.** `libmodkit_gilla.so` — чёрный ящик. Он исполняется
  с правами игры: микрофон, сеть, файлы. Что он отправляет наружу — неизвестно,
  телеметрия LCK идёт в Sentry, а модкит вообще без публичной документации.
- **Frida-следы.** Если gadget активируется, он открывает порт: любой в той же
  сети может подключиться и выполнить свой код на шлеме. Для VR-шлема, который
  часто лежит в общей Wi-Fi-сети, это прямой путь к компромату.
- **`SetGlobalUrlOverride` + прокси-поддержка** означают, что трафик и поток
  технически можно перенаправить. Кто управляет этой ручкой — вопрос к сборке.

---

## 6. Чего не удалось (честные ограничения)

- **Нет уровня методов.** `Il2CppDumper` падает на зашифрованных метаданных;
  `Cpp2IL` в текущем виде тоже не гарантирует результат. Поэтому список фич —
  это имена скриптов + строки нативных библиотек, а не восстановленный C#.
- **Нет текстов интерфейса.** UI-строки лежат в зашифрованных метаданных либо
  в обфусцированном `libil2cpp.so`; «русские строки», которые попадались, —
  это встроенные в Unity данные локализации (`Аравдугаар сар` и т. п.), а не UI игры.
- **Локализация/конфиги-ассеты.** TextAsset-ов в корне `assets/bin/Data` нет —
  контент лежит в бинарных `.resource`-файлах.
- **Modkit.** Упакован: строки обфусцированы, статический анализ почти ничего не даёт.

Что можно докрутить, если нужно глубже: снять список **всех** asset-ов и сцен по
уровням (`level0…level526`), вытащить имена объектов окружения, попробовать
`Cpp2IL` на распакованной копии, снять `AndroidManifest` целиком через `androguard`.

---

## 7. Что где лежит

```
apk-report/
  SUMMARY.md        — паспорт APK: пакет, разрешения, движок, крупнейшие файлы
  report.json       — то же машинночитаемо
  aapt-badging.txt  — сырой вывод aapt
  strings_sample.txt— первые 8 МБ строк из APK
  deep/
    scripts.txt     — 3264 имени MonoScript (все скрипты игры) ← самое полезное
    libs/           — все строки нативных библиотек (стрим, микрофон, модкит)
    dex-classes.txt — 5809 Java/Kotlin-классов (Android-обвязка)
    il2cpp-idents.txt, strings-ui.txt, strings-ru.txt, urls.txt, stats.json
```

Пересобрать отчёт в любой момент:

```bash
gh workflow run apk-inspect --ref arena/ac9c8af6-twinslop
# через 2-3 минуты: git pull
```

---

## 8. Итог одной строкой

`WVRClientv1release.1.apk` — это VR-игра **Gilla** (Unity + IL2CPP + Photon Fusion +
PlayFab + OpenXR) с собственным Rust-стримером на Twitch (`liblck_*` + `libminirtmp`),
в которую вшит сторонний модкит с `ModMenu`. Кнопок «под телефон» в ней нет:
управление рассчитано на OpenXR-контроллеры и шлем.

---

## 9. Попытка расшифровать модификацию (что делали и что вышло)

Отдельный скрипт `scripts/decrypt_probe.py` гоняется на раннере и пробует вскрыть
защиту. Результаты — в `apk-report/deep/decrypt/`.

**Метаданные IL2CPP (`global-metadata.dat`, 15.3 МБ).**

| Проверка | Результат |
|---|---|
| Магия заголовка | `0xc9c79c25` вместо `0xfab11baf` — заголовок не Unity |
| Энтропия по регионам | первые **8.0 МБ — ровно 8.0 бит/байт**, дальше 3.0–6.3 |
| Граница открытого текста | **8 441 856 байт** (~8.05 МБ) |
| Маркеры после границы | `Photon` (8.18 МБ), `Gilla` (8.18 МБ), `UnityEngine` (8.44 МБ), `mscorlib` (13.56 МБ), `Assembly-CSharp` (13.74 МБ) |
| XOR с ключом ≤8 байт | **не подошёл** (`None`) |
| zlib / gzip / LZ4 / zstd | ни одного валидного потока |

Читаем это так: **зашифрована только первая половина файла** (заголовок + таблицы
типов/полей/методов), а строковый блоб с именами остался в открытом виде. Простое
XOR-шифрование исключено, сжатие тоже. Значит, расшифровка делается своим кодом
в нативном загрузчике, и статически её без реверса алгоритма не снять.

Ремонт заголовка не помог: Il2CppDumper падает на всех версиях метаданных
(21, 24, 27, 28, 29, 30, 31) — тело файла внутренне не согласовано, пока его
не расшифруют правильным ключом.

**Модкит (`libmodkit_gilla.so`, 1 МБ).**

- 22 ELF-секции, крупнейшая — 852 КБ с энтропией **6.8** (упакованный код);
- читаемых строк почти нет: только рантайм libc++ и `Invalid access!` —
  типичная подпись коммерческого протектора, строки зашифрованы по одной;
- есть `mprotect`, `dlopen`, `JNI_OnLoad` → библиотека сама открывает
  процесс, меняет права страниц памяти и патчит игру на ходу;
- имена вида `I7Cxl2i5n`, `ThV8`, `Pii8` — обфускация символов.

**Frida.** Файлов `libfrida-gadget.so` / конфигов гейджета в APK **нет**.
Строки про `frida server` попадались в метаданных — это остатки инструментов
сборки, а не рабочая интеграция.

**Вывод.** Расшифровать модификацию статически не получается: защита не
самодельная «для вида», а нормальная — шифрование половины метаданных своим
алгоритмом + упакованный нативный модкит. Дальнейший разбор возможен только
динамически (запуск с инструментацией на устройстве), и это уже не анализ файла,
а вмешательство в чужую игру — за такое я не берусь.

Что при этом **точно** известно про модификацию:

1. она добавляет в игру Unity-скрипты `ModMenu` и `ModMenuAccess` (плюс `GillaFreecam`);
2. их логика лежит в зашифрованной части метаданных, то есть в открытом виде её не прочитать;
3. нативный слой (`libmodkit_gilla.so`) работает через прямую правку памяти процесса;
4. в сумме это клиентское меню с читами, вживлённое в официальную игру.

---

## 10. Twinslop Hands (телефонный контроллер)

Пока разбирался APK, в этом же репозитории собран контроллер «два стика = две руки»:
`web/` + `server.js`, запуск `node server.js`, открывается на телефоне.
Интерфейс и протокол — в `README.md`.

Важно про совместимость: **Gilla сама по себе не принимает внешние «руки»** —
ввод идёт через OpenXR. Стики отдают нормализованные значения (`x, y` от -1 до 1)
по `GET /api/state` и SSE `/api/stream`, поэтому подключить их можно к чему угодно,
где есть мост: своё приложение, эмулятор ввода, бот, тестовый стенд. Но «из коробки
телефон вместо контроллеров в Gilla» не заработает — для этого нужен приёмник
на стороне шлема, а его в игре нет.
