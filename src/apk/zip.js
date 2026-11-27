/**
 * Минимальный читатель ZIP (APK) без сторонних библиотек.
 * Умеет: список файлов, извлечение записи (stored + deflate через DecompressionStream).
 */

export function openZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  // ищем End Of Central Directory (максимум 64 КБ комментария)
  let eocd = -1;
  const min = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('это не ZIP/APK: не найден конец центрального каталога');

  const count = dv.getUint16(eocd + 10, true);
  let offset = dv.getUint32(eocd + 16, true);

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(offset, true) !== 0x02014b50) break;
    const flags = dv.getUint16(offset + 8, true);
    const method = dv.getUint16(offset + 10, true);
    const compSize = dv.getUint32(offset + 20, true);
    const size = dv.getUint32(offset + 24, true);
    const nameLen = dv.getUint16(offset + 28, true);
    const extraLen = dv.getUint16(offset + 30, true);
    const commentLen = dv.getUint16(offset + 32, true);
    const localOffset = dv.getUint32(offset + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    entries.push({ name, method, compSize, size, localOffset, flags });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  function find(name) {
    return entries.find((e) => e.name === name);
  }

  async function extract(entryOrName) {
    const entry = typeof entryOrName === 'string' ? find(entryOrName) : entryOrName;
    if (!entry) return null;

    const base = entry.localOffset;
    if (dv.getUint32(base, true) !== 0x04034b50) throw new Error('битый локальный заголовок');
    const nameLen = dv.getUint16(base + 26, true);
    const extraLen = dv.getUint16(base + 28, true);
    const start = base + 30 + nameLen + extraLen;
    const raw = bytes.subarray(start, start + entry.compSize);

    if (entry.method === 0) return raw;
    if (entry.method !== 8) throw new Error(`сжатие method=${entry.method} не поддерживается`);
    return inflateRaw(raw);
  }

  return { entries, find, extract, size: bytes.length };
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('браузер не умеет распаковку deflate');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
