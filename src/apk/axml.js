/**
 * Разбор бинарного AndroidManifest.xml (AXML).
 *
 * Полноценный обход дерева тегов тут не нужен: нам интересны строки —
 * имя пакета, разрешения, активности. Они лежат в строковом пуле (chunk 0x0001),
 * который читается надёжно. Дальше классифицируем их эвристиками.
 */

export function readStringPool(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // заголовок файла: type 0x0003, headerSize, size
  if (bytes.length < 8 || dv.getUint16(0, true) !== 0x0003) {
    throw new Error('не похоже на бинарный AndroidManifest.xml');
  }

  // ищем чанк строкового пула
  let off = dv.getUint16(2, true);
  while (off + 8 <= bytes.length) {
    const type = dv.getUint16(off, true);
    const headerSize = dv.getUint16(off + 2, true);
    const size = dv.getUint32(off + 4, true);
    if (size === 0) break;
    if (type === 0x0001) return parsePool(bytes, off, headerSize, size);
    off += size;
  }
  throw new Error('строковый пул не найден');
}

function parsePool(bytes, off, headerSize, size) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(off + 8, true);
  const flags = dv.getUint32(off + 16, true);
  const stringsStart = dv.getUint32(off + 20, true);
  const utf8 = (flags & 0x100) !== 0;

  const strings = [];
  for (let i = 0; i < count; i++) {
    const rel = dv.getUint32(off + headerSize + i * 4, true);
    const p = off + stringsStart + rel;
    try {
      strings.push(utf8 ? readUtf8(bytes, p) : readUtf16(bytes, p));
    } catch (_) {
      strings.push('');
    }
  }
  return { strings, utf8, count };
}

function readUtf16(bytes, p) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let len = dv.getUint16(p, true);
  let start = p + 2;
  if (len & 0x8000) {
    // длинная строка: длина в двух словах
    len = ((len & 0x7fff) << 16) | dv.getUint16(p + 2, true);
    start = p + 4;
  }
  let out = '';
  for (let i = 0; i < len && start + i * 2 + 1 < bytes.length; i++) {
    out += String.fromCharCode(dv.getUint16(start + i * 2, true));
  }
  return out;
}

function readUtf8(bytes, p) {
  let utf16len = bytes[p++];
  if (utf16len & 0x80) utf16len = ((utf16len & 0x7f) << 8) | bytes[p++];
  let len = bytes[p++];
  if (len & 0x80) len = ((len & 0x7f) << 8) | bytes[p++];
  const slice = bytes.subarray(p, p + len);
  return new TextDecoder('utf-8').decode(slice);
}

const PERMISSION = /^android\.permission\.[A-Z_0-9]+$/;
const CUSTOM_PERMISSION = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+\.permission\.[A-Z_0-9]+$/i;
const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/i;
const COMPONENT = /^(?:[a-z0-9_]+\.)+[A-Z][A-Za-z0-9_]*$/;
const VERSION = /^\d+(\.\d+){1,3}[a-z]?\d*$/;

export function parseManifest(bytes) {
  const pool = readStringPool(bytes);
  const s = pool.strings.filter(Boolean);

  const permissions = [...new Set(s.filter((x) => PERMISSION.test(x) || CUSTOM_PERMISSION.test(x)))];
  const packages = s.filter((x) => PACKAGE.test(x) && !PERMISSION.test(x));
  const components = s.filter((x) => COMPONENT.test(x) && x.includes('.'));
  const versions = s.filter((x) => VERSION.test(x));
  const labels = s.filter((x) => /[А-Яа-яЁё]|^[A-Z][a-z]+( [A-Z][a-z]+)*$/.test(x) && x.length < 40);

  // имя пакета: обычно первая «длинная» строка вида com.x.y до активностей
  const packageName =
    packages.find((p) => s.indexOf(p) < s.length * 0.5) ||
    packages[0] ||
    null;

  return {
    utf8Pool: pool.utf8,
    strings: s,
    packageName,
    permissions,
    components: components.slice(0, 40),
    versions: versions.slice(0, 5),
    labels: labels.slice(0, 5),
  };
}
