// Headless-проверка разбора APK: собираем синтетический APK в памяти и парсим его.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

await build({
  entryPoints: ['src/apk/inspect.js'],
  bundle: true,
  format: 'esm',
  outfile: '/tmp/apk.inspect.mjs',
  logLevel: 'error',
});

const { inspectApk } = await import('/tmp/apk.inspect.mjs');

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok  ' + msg);
};

// ---------------------------------------------------------------- AXML
function buildAxml(strings) {
  const poolHeaderSize = 0x1c;
  const offsetsLen = strings.length * 4;

  const chunks = strings.map((s) => {
    const chars = Buffer.from(s, 'utf16le');
    const head = Buffer.alloc(2);
    head.writeUInt16LE(s.length, 0);
    return Buffer.concat([head, chars, Buffer.alloc(2)]);
  });
  const stringsBlob = Buffer.concat(chunks);
  const stringsStart = poolHeaderSize + offsetsLen;

  const pool = Buffer.alloc(poolHeaderSize + offsetsLen + stringsBlob.length);
  pool.writeUInt16LE(0x0001, 0);                       // RES_STRING_POOL_TYPE
  pool.writeUInt16LE(poolHeaderSize, 2);
  pool.writeUInt32LE(pool.length, 4);
  pool.writeUInt32LE(strings.length, 8);
  pool.writeUInt32LE(0, 12);                           // styleCount
  pool.writeUInt32LE(0, 16);                           // flags: UTF-16
  pool.writeUInt32LE(stringsStart, 20);
  pool.writeUInt32LE(0, 24);                           // stylesStart

  let cursor = 0;
  strings.forEach((_, i) => {
    pool.writeUInt32LE(cursor, poolHeaderSize + i * 4);
    cursor += chunks[i].length;
  });
  stringsBlob.copy(pool, stringsStart);

  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);                     // RES_XML_TYPE
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + pool.length, 4);

  return Buffer.concat([header, pool]);
}

// ---------------------------------------------------------------- ZIP (stored)
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);                          // method: stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(Buffer.concat([local, nameBuf, data]));
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += local.length + nameBuf.length + data.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

// ---------------------------------------------------------------- сборка тестового APK
const axml = buildAxml([
  'com.test.app',
  'android.permission.INTERNET',
  'android.permission.RECORD_AUDIO',
  '1.2.3',
  'com.test.app.MainActivity',
  'Test Application',
]);

const fake = (n) => Buffer.alloc(n, 0x41);

const apk = buildZip({
  'AndroidManifest.xml': axml,
  'classes.dex': fake(1024),
  'lib/arm64-v8a/libil2cpp.so': fake(4096),
  'lib/arm64-v8a/libovrplatformloader.so': fake(512),
  'assets/bin/Data/Managed/Metadata/global-metadata.dat': Buffer.from([0x01, 0x02, 0x03, 0x04, 0, 0, 0, 0]),
});

const file = {
  name: 'test.apk',
  arrayBuffer: async () => apk.buffer.slice(apk.byteOffset, apk.byteOffset + apk.byteLength),
};

console.log('разбираю синтетический APK');
const r = await inspectApk(file);

assert(r.entries === 5, `найдено 5 файлов внутри (${r.entries})`);
assert(r.packageName === 'com.test.app', `имя пакета (${r.packageName})`);
assert(r.permissions.includes('android.permission.INTERNET'), 'разрешение INTERNET найдено');
assert(r.permissions.includes('android.permission.RECORD_AUDIO'), 'разрешение RECORD_AUDIO найдено');
assert(r.engines.includes('Unity (IL2CPP)'), 'движок определён как Unity IL2CPP');
assert(r.archs.includes('arm64-v8a'), 'архитектура arm64-v8a определена');
assert(r.meta === true, 'наличие Meta/Oculus SDK определено');
assert(String(r.metadataState).startsWith('зашифрованы'), `метаданные помечены как защищённые (${r.metadataState})`);
assert(r.verdict.level === 'vr', `вердикт для VR-сборки (${r.verdict.level})`);
assert(r.verdict.canRun === false, 'честно сообщено, что запустить нельзя');

// обычный APK — другой вердикт
const plainApk = buildZip({
  'AndroidManifest.xml': buildAxml(['com.example.plain', 'android.permission.CAMERA', '1.0']),
  'classes.dex': fake(64),
});
const plain = await inspectApk({
  name: 'plain.apk',
  arrayBuffer: async () => plainApk.buffer.slice(plainApk.byteOffset, plainApk.byteOffset + plainApk.byteLength),
});

assert(plain.verdict.level === 'android', `вердикт для обычного APK (${plain.verdict.level})`);
assert(plain.engines.includes('не определён'), 'движок не выдумывается, если его нет');

console.log('\nВСЕ ПРОВЕРКИ РАЗБОРА APK ПРОЙДЕНЫ');
