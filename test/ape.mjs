// Проверка механик APE HEIST: коллизии кистей, захват за поверхность, шум, монстр, добыча, выход.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/ape/sim.js'],
  bundle: true,
  format: 'esm',
  outfile: '/tmp/ape.sim.mjs',
  logLevel: 'error',
});

const { createSim, step, setHandInput, handTarget, snapshot, CFG } = await import('/tmp/ape.sim.mjs');

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok  ' + msg);
};

const run = (sim, seconds, dt = 1 / 60) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) step(sim, dt);
  return sim;
};

const insideCrate = (sim, pos) => sim.crates.some((c) =>
  pos[0] > c.x - c.w / 2 && pos[0] < c.x + c.w / 2 &&
  pos[1] > c.y && pos[1] < c.y + c.h &&
  pos[2] > c.z - c.d / 2 && pos[2] < c.z + c.d / 2);

// переносит тело и руки в точку (кисти не должны лететь через всю комнату)
function teleport(sim, p) {
  sim.player.p = [p[0], p[1], p[2]];
  sim.player.v = [0, 0, 0];
  ['L', 'R'].forEach((side) => {
    const h = sim.player.hands[side];
    h.pos = [p[0], p[1] + 1.0, p[2]];
    h.grabbed = false;
    h.anchor = null;
    h.normal = null;
    h.contact = undefined;
  });
}

// ставит тело перед ящиком и тянет руку прямо в него
function faceCrate(sim, crate, gap = 1.0) {
  sim.yaw = 0;
  teleport(sim, [crate.x, CFG.playerRadius, crate.z - (crate.d / 2 + gap)]);
  setHandInput(sim, 'L', { x: 0, y: 1 });
  setHandInput(sim, 'R', { x: 0, y: 1 });
}

// ---------------------------------------------------------------- структура
const sim = createSim({ seed: 7 });
assert(sim.crates.length >= 9, `в комнате ${sim.crates.length} опор`);
assert(sim.loot.length === 6, `добычи ${sim.loot.length} штук`);
assert(sim.loot.filter((l) => l.type === 'gem').length >= 1, 'есть алмазы, не только золото');
assert(sim.state === 'play' && sim.t === 0, 'игра начинается в состоянии «играем»');
assert(sim.player.hands.L.contact === undefined, 'на старте рука ничего не касается');

const a = createSim({ seed: 42 }).crates.map((c) => c.h).join(',');
const b = createSim({ seed: 42 }).crates.map((c) => c.h).join(',');
assert(a === b, 'один seed — один и тот же уровень');

// ---------------------------------------------------------------- тишина
const quiet = createSim({ seed: 7 });
setHandInput(quiet, 'L', { x: 0, y: 0 });
setHandInput(quiet, 'R', { x: 0, y: 0 });
run(quiet, 2);
assert(quiet.noise < 0.15, `стоя на месте шум низкий (${quiet.noise.toFixed(2)})`);
assert(quiet.monster.state === 'patrol', 'монстр спокоен, когда тихо и далеко');

// ---------------------------------------------------------------- коллизии кистей
const handSim = createSim({ seed: 7 });
const tall = handSim.crates.find((c) => c.h > 1.9) || handSim.crates[0];
faceCrate(handSim, tall);

let everInside = false;
for (let i = 0; i < 60; i++) {
  step(handSim, 1 / 60);
  if (insideCrate(handSim, handSim.player.hands.L.pos) || insideCrate(handSim, handSim.player.hands.R.pos)) {
    everInside = true;
  }
}
assert(!everInside, 'ни одна кисть ни разу не оказалась внутри ящика');

const contact = handSim.player.hands.L.contact || handSim.player.hands.R.contact;
assert(!!contact, 'кисть упирается в поверхность и знает точку контакта');
assert(Array.isArray(contact.point) && contact.point.length === 3, 'точка контакта — трёхмерная');

// кисть не протыкает геометрию, даже если цель руки глубоко внутри ящика
const deep = createSim({ seed: 7 });
const crateDeep = deep.crates.find((c) => c.h > 1.9) || deep.crates[0];
faceCrate(deep, crateDeep, 0.4);
let deepViolations = 0;
for (let i = 0; i < 40; i++) {
  step(deep, 1 / 60);
  if (insideCrate(deep, deep.player.hands.L.pos) || insideCrate(deep, deep.player.hands.R.pos)) deepViolations++;
}
assert(deepViolations === 0, `40 кадров в упор к ящику — ни одного протыкания (${deepViolations})`);

// кисть не уходит под пол
const floorSim = createSim({ seed: 7 });
setHandInput(floorSim, 'L', { x: 0, y: -1 });
setHandInput(floorSim, 'R', { x: 0, y: -1 });
run(floorSim, 0.5);
assert(floorSim.player.hands.L.pos[1] >= CFG.handRadius - 1e-9,
  `кисть не проваливается под пол (${floorSim.player.hands.L.pos[1].toFixed(3)} ≥ ${CFG.handRadius})`);

// ---------------------------------------------------------------- захват за поверхность
const surf = createSim({ seed: 7 });
const crate2 = surf.crates.find((c) => c.h > 1.9) || surf.crates[0];
faceCrate(surf, crate2);
run(surf, 0.3);      // рука должна долететь до поверхности

assert(surf.player.hands.L.grabbed || surf.player.hands.R.grabbed,
  'рука цепляется за гладкую поверхность');

const anchor = surf.player.hands.L.grabbed ? surf.player.hands.L.anchor : surf.player.hands.R.anchor;
const onSurface = surf.crates.some((c) => {
  const dx = Math.min(Math.abs(anchor[0] - (c.x - c.w / 2)), Math.abs(anchor[0] - (c.x + c.w / 2)));
  const dy = Math.min(Math.abs(anchor[1] - c.y), Math.abs(anchor[1] - (c.y + c.h)));
  const dz = Math.min(Math.abs(anchor[2] - (c.z - c.d / 2)), Math.abs(anchor[2] - (c.z + c.d / 2)));
  const inXZ = anchor[0] >= c.x - c.w / 2 - 1e-6 && anchor[0] <= c.x + c.w / 2 + 1e-6 &&
               anchor[2] >= c.z - c.d / 2 - 1e-6 && anchor[2] <= c.z + c.d / 2 + 1e-6;
  const inY = anchor[1] >= c.y - 1e-6 && anchor[1] <= c.y + c.h + 1e-6;
  return Math.min(dx, dy, dz) < 1e-5 && (inXZ || inY);
});
assert(onSurface, 'точка захвата лежит ровно на грани ящика');

const yStart = surf.player.p[1];
run(surf, 0.7);
assert(surf.player.p[1] > yStart + 0.2,
  `зацепился и подтянулся вверх (${yStart.toFixed(2)} → ${surf.player.p[1].toFixed(2)})`);
assert(!insideCrate(surf, surf.player.hands.L.pos), 'во время подтягивания кисть не влезает в ящик');

// отпускание
setHandInput(surf, 'L', { x: 0, y: 0 });
setHandInput(surf, 'R', { x: 0, y: 0 });
step(surf, 1 / 60);
assert(!surf.player.hands.L.grabbed && !surf.player.hands.R.grabbed, 'отпустил стик — руки разжались');

// свободная рука летит вверх
const free = createSim({ seed: 7 });
free.yaw = 0;
setHandInput(free, 'R', { x: 0, y: 1 });
run(free, 0.4);
assert(free.player.hands.R.pos[1] > free.player.p[1] + 0.9, 'стик вверх поднимает руку');

// ---------------------------------------------------------------- добыча
const lootSim = createSim({ seed: 7 });
const item = lootSim.loot[0];
item.x = lootSim.player.p[0];
item.y = lootSim.player.p[1];
item.z = lootSim.player.p[2];
step(lootSim, 1 / 60);
assert(item.taken === true, 'добыча подбирается при касании');
assert(snapshot(lootSim).total === 1, 'счётчик добычи отработал');

// ---------------------------------------------------------------- монстр слышит
const heard = createSim({ seed: 7 });
heard.monster.p = [-4.5, 0, 6.5];
heard.player.p = [-7.5, CFG.playerRadius, 6.5];
heard.player.v = [-6, 0, 0];
setHandInput(heard, 'L', { x: 1, y: 0 });
setHandInput(heard, 'R', { x: 1, y: 0 });
run(heard, 0.5);
assert(heard.noise > 0.15, `быстрое движение шумит (${heard.noise.toFixed(2)})`);
assert(heard.monster.state === 'alert' || heard.monster.state === 'chase',
  `монстр среагировал (${heard.monster.state})`);

setHandInput(heard, 'L', { x: 0, y: 0 });
setHandInput(heard, 'R', { x: 0, y: 0 });
heard.player.v = [0, 0, 0];
const noisy = heard.noise;
run(heard, 2.5);
assert(heard.noise < noisy * 0.35, `остановился — стало тише (${noisy.toFixed(2)} → ${heard.noise.toFixed(2)})`);

// ---------------------------------------------------------------- поимка
const caught = createSim({ seed: 7 });
caught.player.p = [caught.monster.p[0], CFG.playerRadius, caught.monster.p[2]];
step(caught, 1 / 60);
assert(caught.state === 'lost', 'монстр вплотную — проигрыш');
assert(caught.events.includes('caught'), 'событие поимки записано');

// ---------------------------------------------------------------- выход с добычей
const win = createSim({ seed: 7 });
win.loot.slice(0, 3).forEach((l) => { l.taken = true; l.type = 'gold'; });
win.player.p = [win.exit.x, CFG.playerRadius, win.exit.z];
step(win, 1 / 60);
assert(win.state === 'won', 'с 3 единицами добычи выход срабатывает');

const notYet = createSim({ seed: 7 });
notYet.player.p = [notYet.exit.x, CFG.playerRadius, notYet.exit.z];
step(notYet, 1 / 60);
assert(notYet.state === 'play', 'без добычи выход не засчитывается');

// ---------------------------------------------------------------- режим «продержись»
const hide = createSim({ seed: 7, mode: 'hide' });
assert(hide.timeLimit === CFG.hideTime, `в режиме «продержись» ${CFG.hideTime} секунд`);
for (let i = 0; i < 2000 && hide.state === 'play'; i++) {
  hide.monster.p = [12, 0, 12];
  hide.player.p = [-12, CFG.playerRadius, -12];
  hide.player.v = [0, 0, 0];
  step(hide, 1 / 20);
}
assert(hide.state === 'won', `дожил до конца таймера — победа (${hide.t.toFixed(1)} с)`);

// ---------------------------------------------------------------- снимок для HUD
const snap = snapshot(createSim({ seed: 7 }));
for (const key of ['mode', 'state', 'timeLeft', 'gold', 'gems', 'noise', 'hands', 'monster', 'atExit']) {
  assert(key in snap, `в HUD-снимке есть поле ${key}`);
}
assert(snap.needed === CFG.heistLoot, `цель по добыче: ${snap.needed}`);

console.log('\nВСЕ ПРОВЕРКИ МЕХАНИК APE HEIST ПРОЙДЕНЫ');
