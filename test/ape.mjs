// Проверка механик APE HEIST: хватка рук, шум, монстр, добыча, выход.
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

// ---------------------------------------------------------------- структура
const sim = createSim({ seed: 7 });
assert(sim.crates.length >= 9, `в комнате ${sim.crates.length} опор`);
assert(sim.anchors.length >= 40, `${sim.anchors.length} точек захвата`);
assert(sim.loot.length === 6, `добычи ${sim.loot.length} штук`);
assert(sim.loot.filter((l) => l.type === 'gem').length >= 1, 'есть алмазы, не только золото');
assert(sim.state === 'play' && sim.t === 0, 'игра начинается в состоянии «играем»');

// детерминированность уровня
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

// ---------------------------------------------------------------- хватка и подтягивание
const grab = createSim({ seed: 7 });
const anchor = grab.anchors
  .filter((a2) => a2.y > 1.4 && a2.y < 2.6)
  .sort((x, y) => x.y - y.y)[0];

grab.yaw = 0;
grab.player.p = [anchor.x, anchor.y - 1.5, anchor.z - 1.05];
grab.player.v = [0, 0, 0];
setHandInput(grab, 'L', { x: 0, y: 1 });
setHandInput(grab, 'R', { x: 0, y: 1 });

const target = handTarget(grab, 'L');
const reached = Math.hypot(target[0] - anchor.x, target[1] - anchor.y, target[2] - anchor.z);
assert(reached < CFG.grabRadius, `рука дотягивается до опоры (${reached.toFixed(2)} < ${CFG.grabRadius})`);

const yBefore = grab.player.p[1];
run(grab, 0.8);
const grabbedNow = grab.player.hands.L.grabbed || grab.player.hands.R.grabbed;
assert(grabbedNow, 'рука цепляется за опору');
assert(grab.player.p[1] > yBefore + 0.25, `тело подтянулось вверх (${yBefore.toFixed(2)} → ${grab.player.p[1].toFixed(2)})`);

// отпускание
setHandInput(grab, 'L', { x: 0, y: 0 });
setHandInput(grab, 'R', { x: 0, y: 0 });
step(grab, 1 / 60);
assert(!grab.player.hands.L.grabbed && !grab.player.hands.R.grabbed, 'отпустил стик — руки разжались');

// свободный полёт руки вверх поднимает кисть
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
const snapLoot = snapshot(lootSim);
assert(snapLoot.total === 1, `счётчик добычи отработал (${snapLoot.total})`);

// ---------------------------------------------------------------- монстр слышит
const heard = createSim({ seed: 7 });
heard.monster.p = [-4.5, 0, 6.5];                 // свободное место у стены, не ящик
heard.player.p = [-7.5, CFG.playerRadius, 6.5];
heard.player.v = [-6, 0, 0];
setHandInput(heard, 'L', { x: 1, y: 0 });
setHandInput(heard, 'R', { x: 1, y: 0 });
run(heard, 0.5);
assert(heard.noise > 0.15, `быстрое движение шумит (${heard.noise.toFixed(2)})`);
assert(heard.monster.state === 'alert' || heard.monster.state === 'chase',
  `монстр среагировал (${heard.monster.state})`);

// остановился — шум спадает
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
assert(win.events.includes('extracted'), 'событие выноса записано');

// без добычи выход не срабатывает
const notYet = createSim({ seed: 7 });
notYet.player.p = [notYet.exit.x, CFG.playerRadius, notYet.exit.z];
step(notYet, 1 / 60);
assert(notYet.state === 'play', 'без добычи выход не засчитывается');

// ---------------------------------------------------------------- режим «продержись»
const hide = createSim({ seed: 7, mode: 'hide' });
assert(hide.timeLimit === CFG.hideTime, `в режиме «продержись» ${CFG.hideTime} секунд`);
// держим игрока в углу, монстра — далеко, чтобы проверить именно таймер
for (let i = 0; i < 2000 && hide.state === 'play'; i++) {
  hide.monster.p = [12, 0, 12];
  hide.player.p = [-12, CFG.playerRadius, -12];
  hide.player.v = [0, 0, 0];
  step(hide, 1 / 20);
}
assert(hide.state === 'won', `дожил до конца таймера — победа (${hide.t.toFixed(1)} с)`);
assert(hide.events.includes('survived'), 'событие выживания записано');

// ---------------------------------------------------------------- снимок для HUD
const snap = snapshot(createSim({ seed: 7 }));
for (const key of ['mode', 'state', 'timeLeft', 'gold', 'gems', 'noise', 'hands', 'monster', 'atExit']) {
  assert(key in snap, `в HUD-снимке есть поле ${key}`);
}
assert(snap.needed === CFG.heistLoot, `цель по добыче: ${snap.needed}`);

console.log('\nВСЕ ПРОВЕРКИ МЕХАНИК APE HEIST ПРОЙДЕНЫ');
