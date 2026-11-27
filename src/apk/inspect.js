/**
 * Разбор APK внутри приложения: структура, движок, манифест, вердикт.
 *
 * Честная часть: исполнять чужой APK изнутри своего приложения Android не даёт,
 * поэтому главный результат разбора — что это за файл и что ему нужно, чтобы
 * запуститься (система, OpenXR-рантайм, сервисы Meta и т. д.).
 */

import { openZip } from './zip.js';
import { parseManifest } from './axml.js';

const OWN_PACKAGE = 'ai.arena.twinslop';

const ENGINES = [
  ['Unity (IL2CPP)', ['lib/arm64-v8a/libil2cpp.so', 'assets/bin/Data/Managed/Metadata/global-metadata.dat']],
  ['Unity (Mono)', ['assets/bin/Data/Managed/Assembly-CSharp.dll']],
  ['Unreal Engine', ['lib/arm64-v8a/libUE4.so', 'lib/arm64-v8a/libUnreal.so']],
  ['Godot', ['lib/arm64-v8a/libgodot_android.so']],
  ['Flutter', ['lib/arm64-v8a/libflutter.so']],
  ['React Native', ['lib/arm64-v8a/libreactnativejni.so', 'assets/index.android.bundle']],
  ['Cordova / WebView', ['assets/www/']],
];

const META_MARKERS = [
  'lib/arm64-v8a/libovrplatformloader.so',
  'lib/arm64-v8a/libopenxr_loader.so',
  'lib/arm64-v8a/libUnityOpenXR.so',
];

export async function inspectApk(file, onStep) {
  const step = (msg) => { if (onStep) onStep(msg); };

  step('читаю файл');
  const buffer = await file.arrayBuffer();
  const zip = openZip(buffer);

  const names = zip.entries.map((e) => e.name);
  const has = (n) => names.includes(n);
  const byPrefix = (p) => names.filter((n) => n.startsWith(p));

  step('смотрю структуру');
  const archs = [...new Set(names
    .filter((n) => n.startsWith('lib/'))
    .map((n) => n.split('/')[1]))];

  const engines = ENGINES.filter(([, markers]) => markers.some((m) => has(m))).map(([name]) => name);

  const dexFiles = names.filter((n) => /^classes\d*\.dex$/.test(n));
  const nativeLibs = byPrefix('lib/').map((n) => n.split('/').pop());
  const openxr = nativeLibs.some((l) => /openxr/i.test(l));
  const meta = META_MARKERS.some((m) => has(m)) || nativeLibs.some((l) => /ovrplatform|oculus|meta/i.test(l));

  const biggest = zip.entries
    .slice()
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .slice(0, 6)
    .map((e) => ({ name: e.name, mb: +(((e.size || 0) / 1048576).toFixed(1)) }));

  step('читаю манифест');
  let manifest = null;
  let manifestError = null;
  try {
    const raw = await zip.extract('AndroidManifest.xml');
    if (raw && raw.length > 8) manifest = parseManifest(raw);
    else manifestError = 'AndroidManifest.xml не найден';
  } catch (err) {
    manifestError = err.message || String(err);
  }

  // зашифрованные метаданные IL2CPP: магия должна быть 0xAF 0x1B 0xB1 0xFA
  let metadataState = null;
  if (has('assets/bin/Data/Managed/Metadata/global-metadata.dat')) {
    try {
      const md = await zip.extract('assets/bin/Data/Managed/Metadata/global-metadata.dat');
      const magic = md && md.length >= 4
        ? (md[0] | (md[1] << 8) | (md[2] << 16) | (md[3] << 24)) >>> 0
        : 0;
      metadataState = magic === 0xfab11baf ? 'открытые' : `зашифрованы (0x${magic.toString(16)})`;
    } catch (_) {
      metadataState = 'не читаются';
    }
  }

  const report = {
    fileName: file.name || 'файл.apk',
    sizeMB: +((buffer.byteLength || 0) / 1048576).toFixed(1),
    entries: names.length,
    packageName: manifest?.packageName || null,
    permissions: manifest?.permissions || [],
    components: manifest?.components || [],
    versions: manifest?.versions || [],
    manifestError,
    archs,
    engines: engines.length ? engines : ['не определён'],
    dexFiles: dexFiles.length,
    nativeLibs: nativeLibs.slice(0, 24),
    openxr,
    meta,
    metadataState,
    biggest,
  };

  report.verdict = buildVerdict(report);
  step('готово');
  return report;
}

function buildVerdict(r) {
  if (r.packageName === OWN_PACKAGE) {
    return {
      level: 'own',
      title: 'Это наше приложение — Twinslop Hands',
      text: 'Ставится системой как обычный APK, внутрь себя его грузить не нужно. Если стоит старая версия — скачай свежую из релиза и установи поверх.',
      canRun: true,
      why: 'Свой APK запускается установкой в системе, а не из нашего приложения.',
    };
  }

  const vr = r.openxr || r.meta || (r.permissions || []).some((p) => /openxr/i.test(p));

  if (vr) {
    return {
      level: 'vr',
      title: 'VR-приложение (Quest / OpenXR)',
      text: 'Такому APK нужен OpenXR-рантайм и, если игра из магазина Meta, ещё и сервисы Meta: аккаунт, лицензия, лобби. Ни телефона, ни нашего приложения это не заменяет.',
      canRun: false,
      why: [
        r.openxr ? 'внутри есть OpenXR-загрузчик — нужен рантайм шлема' : null,
        r.meta ? 'есть библиотеки Meta/Oculus — нужны сервисы аккаунта' : null,
        'своего OpenXR-рантайма в Android «из коробки» нет',
      ].filter(Boolean).join('; '),
    };
  }

  return {
    level: 'android',
    title: 'Обычное Android-приложение',
    text: 'Устанавливается системой и запускается как отдельная программа. Android не позволяет одному приложению исполнять код другого — поэтому «загрузить» APK внутрь чужого приложения физически нельзя.',
    canRun: false,
    why: 'нужна установка в системе: Android изолирует приложения друг от друга',
  };
}
