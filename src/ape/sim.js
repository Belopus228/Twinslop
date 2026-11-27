/**
 * «APE HEIST» — своя игра в жанре «обезьяна на руках»: без ассетов и кода чужой игры.
 *
 * Здесь только симуляция: физика рук, шум, монстр, золото, выход.
 * Никакого three.js — чтобы это тестировалось в Node без canvas.
 *
 * Механика: два стика = две руки. Тянешь руку к опоре — она цепляется,
 * тело подтягивается к ней. Быстро двигаешься — шумишь — монстр слышит.
 */

export const CFG = {
  gravity: -19,
  pullStrength: 34,
  maxSpeed: 7.4,
  damping: 2.6,
  armReach: 1.5,
  grabRadius: 0.62,
  armSpeed: 9.0,
  playerRadius: 0.34,
  bounds: 13,               // половина комнаты по X/Z
  hearBase: 4.2,
  hearNoise: 8.4,
  catchDist: 1.05,
  monsterSpeed: { patrol: 1.15, alert: 1.85, chase: 2.75 },
  heistTime: 180,
  hideTime: 90,
  heistLoot: 3,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Детерминированный ГПСЧ: один и тот же уровень при одном и том же seed. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- уровень

function buildLevel(rnd) {
  const crates = [];

  // три ряда колонн разной высоты — по ним и лазаем руками
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      const h = 1.0 + Math.round(rnd() * 3) * 0.45;      // 1.0 … 2.35
      crates.push({ x: ix * 4.4, y: 0, z: iz * 4.4, w: 1.9, h, d: 1.9 });
      if (rnd() > 0.55) {
        crates.push({ x: ix * 4.4 + 0.5, y: h, z: iz * 4.4 - 0.4, w: 1.2, h: 0.8, d: 1.2 });
      }
    }
  }

  // пара «балок» у стен, чтобы забираться повыше
  crates.push({ x: -9.5, y: 1.6, z: 0, w: 1.0, h: 0.4, d: 6.0 });
  crates.push({ x: 9.5, y: 2.2, z: 0, w: 1.0, h: 0.4, d: 6.0 });

  // точки захвата: верхние углы и центр каждой крышки
  const anchors = [];
  for (const c of crates) {
    const top = c.y + c.h;
    const hw = c.w / 2 - 0.12;
    const hd = c.d / 2 - 0.12;
    anchors.push({ x: c.x - hw, y: top + 0.06, z: c.z - hd });
    anchors.push({ x: c.x + hw, y: top + 0.06, z: c.z - hd });
    anchors.push({ x: c.x - hw, y: top + 0.06, z: c.z + hd });
    anchors.push({ x: c.x + hw, y: top + 0.06, z: c.z + hd });
  }

  // добыча: на крышках
  const loot = [];
  const spots = crates.filter((c) => c.y + c.h > 1.2);
  let n = 0;
  for (const c of spots) {
    if (loot.length >= 6) break;
    const type = n % 3 === 2 ? 'gem' : 'gold';
    loot.push({
      id: `l${n++}`,
      type,
      x: c.x + (rnd() - 0.5) * 0.5,
      y: c.y + c.h + 0.35,
      z: c.z + (rnd() - 0.5) * 0.5,
      taken: false,
    });
  }
  while (loot.length < 6) {
    loot.push({ id: `l${loot.length}`, type: 'gold', x: (rnd() - 0.5) * 8, y: 0.4, z: (rnd() - 0.5) * 8, taken: false });
  }

  return { crates, anchors, loot };
}

// ---------------------------------------------------------------- создание мира

export function createSim(opts = {}) {
  const mode = opts.mode === 'hide' ? 'hide' : 'heist';
  const rnd = mulberry32(opts.seed ?? 1337);
  const { crates, anchors, loot } = buildLevel(rnd);

  const sim = {
    mode,
    seed: opts.seed ?? 1337,
    t: 0,
    state: 'play',
    timeLimit: mode === 'hide' ? CFG.hideTime : CFG.heistTime,
    crates,
    anchors,
    loot,
    exit: { x: -11, y: 0, z: -11, r: 1.9 },
    yaw: 0,
    player: {
      p: [10.5, CFG.playerRadius, -10.5],
      v: [0, 0, 0],
      hands: {
        L: { pos: [10.5, 1.1, -10.5], grabbed: false, anchor: null },
        R: { pos: [10.5, 1.1, -10.5], grabbed: false, anchor: null },
      },
      input: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } },
      grounded: false,
    },
    monster: {
      p: [9, 0, 9],
      state: 'patrol',
      target: [0, 0, 0],
      lostFor: 0,
      lastHeard: null,
    },
    noise: 0,
    events: [],
  };
  return sim;
}

// ---------------------------------------------------------------- ввод рук

/** dir: {x,y} в экранных координатах стика, |dir| ≤ 1. */
export function setHandInput(sim, side, dir) {
  const h = sim.player.input[side];
  if (!h) return;
  h.x = clamp(dir?.x || 0, -1, 1);
  h.y = clamp(dir?.y || 0, -1, 1);
}

export function handTarget(sim, side) {
  const inp = sim.player.input[side];
  const p = sim.player.p;
  const mag = Math.min(1, Math.hypot(inp.x, inp.y));
  const sign = side === 'L' ? -1 : 1;

  // рука всегда впереди тела, стик добавляет высоту/смещение
  const up = 0.35 + (inp.y || 0) * CFG.armReach * 0.9;
  const sideOff = (inp.x || 0) * CFG.armReach * 0.9 + sign * 0.28;
  const fwd = 0.55 + mag * 0.5;

  const cos = Math.cos(sim.yaw);
  const sin = Math.sin(sim.yaw);
  return [
    p[0] + fwd * sin + sideOff * cos,
    p[1] + up,
    p[2] + fwd * cos - sideOff * sin,
  ];
}

// ---------------------------------------------------------------- физика

function resolveCrate(p, v, r, c) {
  const minX = c.x - c.w / 2, maxX = c.x + c.w / 2;
  const minY = c.y, maxY = c.y + c.h;
  const minZ = c.z - c.d / 2, maxZ = c.z + c.d / 2;

  const cx = clamp(p[0], minX, maxX);
  const cy = clamp(p[1], minY, maxY);
  const cz = clamp(p[2], minZ, maxZ);
  const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > r * r) return null;

  if (d2 < 1e-8) {                    // центр внутри — выталкиваем вверх
    p[1] = maxY + r;
    if (v[1] < 0) v[1] = 0;
    return [0, 1, 0];
  }

  const d = Math.sqrt(d2);
  const n = [dx / d, dy / d, dz / d];
  const push = r - d;
  p[0] += n[0] * push; p[1] += n[1] * push; p[2] += n[2] * push;

  const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  if (vn < 0) { v[0] -= n[0] * vn; v[1] -= n[1] * vn; v[2] -= n[2] * vn; }
  return n;
}

function updateHand(sim, side, dt) {
  const hand = sim.player.hands[side];
  const inp = sim.player.input[side];
  const mag = Math.hypot(inp.x, inp.y);
  const target = handTarget(sim, side);

  if (hand.grabbed) {
    const anchor = hand.anchor;
    hand.pos = [anchor[0], anchor[1], anchor[2]];
    const d = dist(sim.player.p, anchor);
    // отпускаем, если стик отпущен или опора стала слишком далеко
    if (mag < 0.2 || d > CFG.armReach * 2.0) {
      hand.grabbed = false;
      hand.anchor = null;
    } else {
      const pull = [
        (anchor[0] - sim.player.p[0]),
        (anchor[1] - sim.player.p[1]),
        (anchor[2] - sim.player.p[2]),
      ];
      const l = len(pull) || 1;
      const k = CFG.pullStrength * dt;
      sim.player.v[0] += (pull[0] / l) * k;
      sim.player.v[1] += (pull[1] / l) * k;
      sim.player.v[2] += (pull[2] / l) * k;
    }
    return;
  }

  // свободная рука летит к цели
  const k = Math.min(1, CFG.armSpeed * dt);
  hand.pos[0] += (target[0] - hand.pos[0]) * k;
  hand.pos[1] += (target[1] - hand.pos[1]) * k;
  hand.pos[2] += (target[2] - hand.pos[2]) * k;

  if (mag > 0.25) {
    let best = null;
    let bestD = CFG.grabRadius;
    for (const a of sim.anchors) {
      const d = dist(hand.pos, [a.x, a.y, a.z]);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) {
      hand.grabbed = true;
      hand.anchor = [best.x, best.y, best.z];
      hand.pos = [best.x, best.y, best.z];
      sim.events.push('grab');
    }
  }
}

function updateNoise(sim, dt, movedFast) {
  const speed = len(sim.player.v);
  const target = clamp(speed / CFG.maxSpeed, 0, 1) * 0.8;
  const rate = target > sim.noise ? 6.0 : 1.4;
  sim.noise += (target - sim.noise) * Math.min(1, rate * dt);
  if (movedFast) sim.noise = Math.max(sim.noise, 0.85);
  sim.noise = clamp(sim.noise, 0, 1);
}

function hearingRange(sim) {
  return CFG.hearBase + CFG.hearNoise * sim.noise;
}

function updateMonster(sim, dt) {
  const m = sim.monster;
  const p = sim.player.p;
  const d = dist(m.p, p);

  if (d < hearingRange(sim)) {
    m.lastHeard = [p[0], p[1], p[2]];
    if (m.state === 'patrol') { m.state = 'alert'; sim.events.push('monster:heard'); }
    if (d < 6.5 && sim.noise > 0.22) { m.state = 'chase'; }
    else if (m.state !== 'chase') { m.state = 'alert'; }
  }

  if (m.state === 'chase' && (d > 9.5 || sim.noise < 0.07)) {
    m.lostFor += dt;
    if (m.lostFor > 2.4) { m.state = 'alert'; m.lostFor = 0; }
  } else if (m.state === 'chase') {
    m.lostFor = 0;
  }

  if (m.state === 'alert' && m.lastHeard) {
    m.target = m.lastHeard;
    if (dist(m.p, m.lastHeard) < 0.7) { m.state = 'patrol'; m.lastHeard = null; }
  }
  if (m.state === 'chase') m.target = [p[0], 0, p[2]];
  if (m.state === 'patrol') {
    // обход по углам комнаты
    if (!m.waypoints) {
      m.waypoints = [[9, 0, 9], [-9, 0, 9], [9, 0, -9], [-9, 0, -9]];
      m.wp = 0;
    }
    m.target = m.waypoints[m.wp];
    if (dist(m.p, m.target) < 1.2) m.wp = (m.wp + 1) % 4;
  }

  const speed = CFG.monsterSpeed[m.state] || 1.2;
  const dir = [m.target[0] - m.p[0], 0, m.target[2] - m.p[2]];
  const l = len(dir) || 1;
  m.p[0] += (dir[0] / l) * speed * dt;
  m.p[2] += (dir[2] / l) * speed * dt;

  // монстр не проходит сквозь ящики
  for (const c of sim.crates) {
    const minX = c.x - c.w / 2 - 0.45, maxX = c.x + c.w / 2 + 0.45;
    const minZ = c.z - c.d / 2 - 0.45, maxZ = c.z + c.d / 2 + 0.45;
    if (m.p[0] > minX && m.p[0] < maxX && m.p[2] > minZ && m.p[2] < maxZ && c.y < 1.6) {
      const pushX = Math.min(m.p[0] - minX, maxX - m.p[0]);
      const pushZ = Math.min(m.p[2] - minZ, maxZ - m.p[2]);
      if (pushX < pushZ) m.p[0] += (m.p[0] < c.x ? -pushX : pushX);
      else m.p[2] += (m.p[2] < c.z ? -pushZ : pushZ);
    }
  }

  if (dist(m.p, p) < CFG.catchDist) {
    sim.state = 'lost';
    sim.events.push('caught');
  }
}

// ---------------------------------------------------------------- шаг

export function step(sim, dtRaw) {
  if (!sim || sim.state !== 'play') return sim;
  const dt = Math.min(0.05, Math.max(0.001, dtRaw));
  sim.t += dt;

  const player = sim.player;
  const p = player.p;
  const v = player.v;
  const wasOnGround = p[1] <= CFG.playerRadius + 0.03;
  const fallSpeed = v[1];

  updateHand(sim, 'L', dt);
  updateHand(sim, 'R', dt);

  // гравитация и затухание
  v[1] += CFG.gravity * dt;
  const damp = Math.max(0, 1 - CFG.damping * dt);
  v[0] *= damp; v[2] *= damp;

  const speed = len(v);
  if (speed > CFG.maxSpeed) {
    const k = CFG.maxSpeed / speed;
    v[0] *= k; v[1] *= k; v[2] *= k;
  }

  p[0] += v[0] * dt;
  p[1] += v[1] * dt;
  p[2] += v[2] * dt;

  // пол и стены
  if (p[1] < CFG.playerRadius) {
    p[1] = CFG.playerRadius;
    if (v[1] < 0) v[1] = 0;
  }
  const lim = CFG.bounds - CFG.playerRadius;
  p[0] = clamp(p[0], -lim, lim);
  p[2] = clamp(p[2], -lim, lim);
  if (Math.abs(p[0]) >= lim - 0.001) v[0] = 0;
  if (Math.abs(p[2]) >= lim - 0.001) v[2] = 0;

  let hitUp = false;
  for (const c of sim.crates) {
    const n = resolveCrate(p, v, CFG.playerRadius, c);
    if (n && n[1] > 0.5) hitUp = true;
  }

  const onGround = p[1] <= CFG.playerRadius + 0.03;
  player.grounded = onGround;

  // приземление после падения — громко
  const landed = onGround && !wasOnGround && fallSpeed < -5;
  if (landed) sim.events.push('landloud');

  updateNoise(sim, dt, landed || (!onGround && speed > CFG.maxSpeed * 0.8));

  // добыча: подбираем рукой или телом
  for (const item of sim.loot) {
    if (item.taken) continue;
    const at = [item.x, item.y, item.z];
    const byBody = dist(p, at) < 0.95;
    const byHand = dist(player.hands.L.pos, at) < 0.8 || dist(player.hands.R.pos, at) < 0.8;
    if (byBody || byHand) {
      item.taken = true;
      sim.events.push(item.type === 'gem' ? 'gem' : 'gold');
    }
  }

  updateMonster(sim, dt);

  // условия конца
  const gold = sim.loot.filter((l) => l.taken && l.type === 'gold').length;
  const gems = sim.loot.filter((l) => l.taken && l.type === 'gem').length;

  if (sim.mode === 'heist') {
    if (gold + gems >= CFG.heistLoot && dist(p, [sim.exit.x, p[1], sim.exit.z]) < sim.exit.r) {
      sim.state = 'won';
      sim.events.push('extracted');
    }
  } else if (sim.t >= sim.timeLimit) {
    sim.state = 'won';
    sim.events.push('survived');
  }

  if (sim.t >= sim.timeLimit && sim.state === 'play') {
    sim.state = 'lost';
    sim.events.push('timeout');
  }

  return sim;
}

// ---------------------------------------------------------------- снимок для HUD/тестов

export function snapshot(sim) {
  const gold = sim.loot.filter((l) => l.taken && l.type === 'gold').length;
  const gems = sim.loot.filter((l) => l.taken && l.type === 'gem').length;
  return {
    mode: sim.mode,
    state: sim.state,
    t: +sim.t.toFixed(2),
    timeLeft: +Math.max(0, sim.timeLimit - sim.t).toFixed(1),
    gold,
    gems,
    total: gold + gems,
    needed: CFG.heistLoot,
    noise: +sim.noise.toFixed(2),
    hands: {
      L: sim.player.hands.L.grabbed,
      R: sim.player.hands.R.grabbed,
    },
    monster: {
      state: sim.monster.state,
      dist: +dist(sim.monster.p, sim.player.p).toFixed(2),
    },
    atExit: dist(sim.player.p, [sim.exit.x, sim.player.p[1], sim.exit.z]) < sim.exit.r,
  };
}
