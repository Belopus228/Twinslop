// Headless-проверка игровой логики: рендер заглушён, физика настоящая.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/game/main.js'],
  bundle: true,
  format: 'iife',
  outfile: '/tmp/game.test.bundle.js',
  alias: { three: './test/three-stub.js' },
  logLevel: 'error',
});

// --- минимальный DOM
const el = () => ({
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  style: {},
  textContent: '',
  hidden: false,
  dataset: {},
  addEventListener() {},
  setPointerCapture() {},
  querySelector: () => el(),
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
  remove() {},
});

const elements = {};
globalThis.document = {
  getElementById: (id) => (elements[id] ||= el()),
  querySelector: () => el(),
  querySelectorAll: () => [],
  body: { style: {} },
  addEventListener() {},
};
globalThis.window = {
  addEventListener() {},
  innerWidth: 900,
  innerHeight: 420,
  devicePixelRatio: 2,
};
globalThis.requestAnimationFrame = () => 0;
globalThis.performance = { now: () => 0 };
globalThis.setTimeout = (fn) => 0;

// --- загрузка бандла
const code = await import('node:fs').then((fs) => fs.readFileSync('/tmp/game.test.bundle.js', 'utf8'));
new Function(code)();

const api = globalThis.window.__SLOPAPE__;
if (!api) throw new Error('игра не инициализировалась: нет __SLOPAPE__');

const { player, input, platforms, tick } = api;
const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ok  ' + msg); };

console.log(`платформ: ${platforms.length}`);

// 1. падение на стартовую площадку
for (let i = 0; i < 120; i++) tick(1 / 60);
assert(player.pos.y > 0.6 && player.pos.y < 1.2, `тело стоит на площадке (y=${player.pos.y.toFixed(2)})`);
assert(Number.isFinite(player.pos.x + player.pos.y + player.pos.z), 'позиция без NaN');

// 2. удержание стика вниз-вперёд => рука цепляется за землю
input.L.active = true;
input.L.x = 0;
input.L.y = -1;
let gripped = false;
for (let i = 0; i < 60; i++) {
  tick(1 / 60);
  if (player.hands[0].gripping) gripped = true;
}
assert(gripped, 'левая рука зацепилась за поверхность');

// 3. зацепка подтягивает тело — оно должно сместиться
const before = player.pos.clone();
for (let i = 0; i < 60; i++) tick(1 / 60);
const moved = player.pos.distanceTo(before);
assert(moved > 0.02, `тело подтянулось к руке (сдвиг ${moved.toFixed(3)}м)`);

// 3b. скорость подтягивания в разумных пределах
let peak = 0;
input.L.active = true;
input.L.y = -1;
for (let i = 0; i < 90; i++) {
  tick(1 / 60);
  peak = Math.max(peak, Math.hypot(player.vel.x, player.vel.z));
}
assert(peak > 0.8 && peak < 9.5, `скорость подтягивания в норме (пик ${peak.toFixed(2)} м/с)`);

// 4. отпустили — отпускается и рука
input.L.active = false;
for (let i = 0; i < 30; i++) tick(1 / 60);
assert(!player.hands[0].gripping, 'после отпускания захват снят');

// 5. долгий прогон: физика не взрывается
for (let i = 0; i < 600; i++) tick(1 / 60);
const p = player.pos;
assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'после 10с физика стабильна');
assert(Math.abs(p.y) < 200, `тело не улетело в космос (y=${p.y.toFixed(2)})`);

// 6. респавн по падению
player.pos.set(0, -20, 0);
tick(1 / 60);
assert(player.pos.y > -5, 'падение вниз возвращает на чекпоинт');

console.log('\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
