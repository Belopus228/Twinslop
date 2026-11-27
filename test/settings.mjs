// Проверка настроек: валидация, «какой стик за какую руку», чувствительность/инверсия.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/shared/settings.js'],
  bundle: true,
  format: 'esm',
  outfile: '/tmp/settings.mjs',
  logLevel: 'error',
});

const {
  DEFAULTS, KEY, normalize, load, save, reset, handForStick, stickToHand,
} = await import('/tmp/settings.mjs');

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok  ' + msg);
};

// фейковое хранилище
function fakeStore(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    data,
  };
}

// ---------------------------------------------------------------- значения по умолчанию
assert(DEFAULTS.swap === false, 'по умолчанию левый стик — левая рука');
const d = normalize({});
assert(d.sens === DEFAULTS.sens && d.dead === DEFAULTS.dead, 'пустой объект даёт дефолты');

// ---------------------------------------------------------------- валидация мусора
assert(normalize({ sens: 'abc' }).sens === DEFAULTS.sens, 'мусор в sens отбрасывается');
assert(normalize({ sens: 999 }).sens === 2.6, 'sens ограничен сверху');
assert(normalize({ sens: -5 }).sens === 0.4, 'sens ограничен снизу');
assert(normalize({ dead: 9 }).dead === 0.4, 'мёртвая зона ограничена');
assert(normalize(null).inv === false, 'null не ломает нормализацию');
assert(normalize({ swap: 1 }).swap === true, 'swap приводится к true');

// ---------------------------------------------------------------- карта стик → рука
assert(handForStick('L', { swap: false }) === 'L', 'без swap: левый стик → левая рука');
assert(handForStick('R', { swap: false }) === 'R', 'без swap: правый стик → правая рука');
assert(handForStick('L', { swap: true }) === 'R', 'со swap: левый стик → правая рука');
assert(handForStick('R', { swap: true }) === 'L', 'со swap: правый стик → левая рука');

// ---------------------------------------------------------------- чувствительность и инверсия
const low = stickToHand('L', { x: 0.5, y: 0.5 }, { sens: 0.5, swap: false });
assert(Math.abs(low.x - 0.25) < 1e-9, `чувствительность 0.5 уменьшает ход (${low.x})`);

const high = stickToHand('L', { x: 0.9, y: 0.9 }, { sens: 2.6, swap: false });
assert(high.x === 1 && high.y === 1, `большая чувствительность обрезается по 1 (${high.x})`);

const inv = stickToHand('L', { x: 0, y: 0.8 }, { sens: 1, inv: true });
assert(inv.y === -0.8, `инверсия переворачивает вертикаль (${inv.y})`);

const sw = stickToHand('R', { x: 0, y: 1 }, { sens: 1, swap: true });
assert(sw.hand === 'L', 'stickToHand учитывает swap');
assert(stickToHand('L', { x: 5, y: -5 }, {}).x === 1, 'вход за пределами [-1,1] обрезается');

// ---------------------------------------------------------------- сохранение и чтение
const store = fakeStore();
save({ sens: 2.0, swap: true }, store);
assert(store.data.has(KEY), 'настройки легли в localStorage под общим ключом');

const back = load(store);
assert(back.sens === 2.0 && back.swap === true, 'прочитались обратно');
assert(back.vib === DEFAULTS.vib, 'недостающие поля добираются из дефолтов');

store.data.set(KEY, '{битый json');
assert(load(store).sens === DEFAULTS.sens, 'битый JSON не роняет приложение');

const resetStore = fakeStore();
save({ swap: true, sens: 2.5 }, resetStore);
const afterReset = reset(resetStore);
assert(afterReset.swap === false && afterReset.sens === DEFAULTS.sens, 'сброс возвращает дефолты');
assert(JSON.parse(resetStore.data.get(KEY)).swap === false, 'сброс записан в хранилище');

console.log('\nВСЕ ПРОВЕРКИ НАСТРОЕК ПРОЙДЕНЫ');
