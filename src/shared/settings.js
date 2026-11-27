/**
 * Общие настройки: один ключ на всё приложение.
 * Используется страницей настроек, контроллером и игрой APE HEIST.
 */

export const KEY = 'twinslop-hands';

export const DEFAULTS = Object.freeze({
  sens: 1.3,     // чувствительность стиков
  dead: 0.06,    // мёртвая зона
  inv: false,    // инверсия вертикали
  vib: true,     // вибрация
  wake: true,    // не гасить экран
  swap: false,   // левый стик управляет правой рукой
});

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function num(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

/** Приводит что угодно к валидным настройкам. */
export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    sens: num(r.sens, 0.4, 2.6, DEFAULTS.sens),
    dead: num(r.dead, 0, 0.4, DEFAULTS.dead),
    inv: r.inv === undefined ? DEFAULTS.inv : !!r.inv,
    vib: r.vib === undefined ? DEFAULTS.vib : !!r.vib,
    wake: r.wake === undefined ? DEFAULTS.wake : !!r.wake,
    swap: r.swap === undefined ? DEFAULTS.swap : !!r.swap,
  };
}

function safeStore(store) {
  if (store) return store;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (_) { /* приватный режим */ }
  return null;
}

export function load(store) {
  const st = safeStore(store);
  if (!st) return { ...DEFAULTS };
  try {
    return normalize(JSON.parse(st.getItem(KEY) || '{}'));
  } catch (_) {
    return { ...DEFAULTS };
  }
}

export function save(settings, store) {
  const clean = normalize(settings);
  const st = safeStore(store);
  if (st) {
    try { st.setItem(KEY, JSON.stringify(clean)); } catch (_) { /* переполнение */ }
  }
  return clean;
}

export function reset(store) {
  return save({ ...DEFAULTS }, store);
}

/** Какой рукой управляет стик с учётом «поменять руки». */
export function handForStick(side, settings) {
  const swap = !!(settings && settings.swap);
  if (!swap) return side;
  return side === 'L' ? 'R' : 'L';
}

/** Превращает положение стика в команду конкретной руке. */
export function stickToHand(side, dir, settings) {
  const s = normalize(settings || {});
  const x = clamp((dir && dir.x) || 0, -1, 1);
  const y = clamp((dir && dir.y) || 0, -1, 1);
  return {
    hand: handForStick(side, s),
    x: clamp(x * s.sens, -1, 1),
    y: clamp(y * s.sens * (s.inv ? -1 : 1), -1, 1),
  };
}
