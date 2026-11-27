import * as THREE from 'three';
import { createVR } from './vr.js';

/* ==========================================================================
   SLOP APE — оригинальный прототип «паркур двумя руками».
   Вся геометрия процедурная, ассеты свои. Управление: два стика = две руки.
   ========================================================================== */

// ---------------------------------------------------------------- утилиты
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

const CFG = {
  gravity: 22,
  armReach: 1.65,
  handRadius: 0.16,
  bodyRadius: 0.42,
  gripRadius: 0.55,     // насколько близко рука цепляется за поверхность
  pullStrength: 34,
  maxSpeed: 8.5,
  damping: 6.5,
  handFollow: 22,       // скорость, с которой рука догоняет цель
};

// ---------------------------------------------------------------- рендер
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.Fog(0x05070d, 22, 62);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
camera.position.set(0, 4, 9);

// эмулятор шлема: стерео, IPD, трекинг головы, профили устройств
const vr = createVR({ renderer, scene, camera, canvas });

scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x0a1220, 1.15));

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(6, 12, 5);
scene.add(sun);

const rim = new THREE.PointLight(0x3ddc84, 60, 40, 2);
rim.position.set(-4, 8, -6);
scene.add(rim);

// ---------------------------------------------------------------- материалы
const MAT = {
  rock: new THREE.MeshStandardMaterial({ color: 0x1b2a3f, roughness: 0.92, metalness: 0.05 }),
  rockTop: new THREE.MeshStandardMaterial({ color: 0x24405c, roughness: 0.85, metalness: 0.1 }),
  edge: new THREE.LineBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.55 }),
  body: new THREE.MeshStandardMaterial({ color: 0x2f6f52, roughness: 0.7 }),
  face: new THREE.MeshStandardMaterial({ color: 0x7c5a3c, roughness: 0.8 }),
  hand: new THREE.MeshStandardMaterial({ color: 0x3ddc84, roughness: 0.4, emissive: 0x0d3d24 }),
  handGrip: new THREE.MeshStandardMaterial({ color: 0x9dffcf, roughness: 0.2, emissive: 0x2fbf74 }),
  gem: new THREE.MeshStandardMaterial({ color: 0x8dffc4, emissive: 0x2fe08a, roughness: 0.15, metalness: 0.3 }),
};

// ---------------------------------------------------------------- уровень
/** @type {{mesh: THREE.Mesh, box: THREE.Box3}[]} */
const platforms = [];
const MOVE_PLATFORMS = [];

function addPlatform(x, y, z, w, h, d, moving = null) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, MAT.rock);
  mesh.position.set(x, y, z);
  scene.add(mesh);

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), MAT.edge);
  edges.position.copy(mesh.position);
  scene.add(edges);

  const grass = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.06, d * 0.98), MAT.rockTop);
  grass.position.set(x, y + h / 2 + 0.03, z);
  scene.add(grass);

  const item = { mesh, edges, grass, h, box: new THREE.Box3().setFromObject(mesh), base: new THREE.Vector3(x, y, z) };
  platforms.push(item);
  if (moving) {
    item.motion = moving;
    MOVE_PLATFORMS.push(item);
  }
  return item;
}

// стартовая площадка
addPlatform(0, 0, 0, 9, 0.6, 9);

// лестница вверх по спирали
let angle = 0;
for (let i = 0; i < 22; i++) {
  angle += 0.62;
  const radius = 6.5 + Math.sin(i * 0.7) * 1.4;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = 0.9 + i * 0.85;
  const w = 2.6 - Math.min(i * 0.03, 0.9);
  const moving = i % 6 === 3 ? { axis: 'y', amp: 0.8, speed: 1.1 + i * 0.03 } : null;
  addPlatform(x, y, z, w, 0.45, w, moving);
}

// финальная площадка с камнем
const topY = 0.9 + 22 * 0.85 + 1.6;
addPlatform(0, topY, 0, 6, 0.7, 6);

const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), MAT.gem);
gem.position.set(0, topY + 1.9, 0);
scene.add(gem);
const gemGlow = new THREE.PointLight(0x54ffb0, 40, 14, 2);
gemGlow.position.copy(gem.position);
scene.add(gemGlow);

// звёзды
(() => {
  const g = new THREE.BufferGeometry();
  const n = 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 60 + Math.random() * 80;
    const a = Math.random() * Math.PI * 2;
    const h = Math.random() * 90 - 10;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = h;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7fa8c8, size: 0.5, sizeAttenuation: true })));
})();

// ---------------------------------------------------------------- обезьяна
const ape = new THREE.Group();
scene.add(ape);

const torso = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.95, 0.6), MAT.body);
torso.position.y = 0.35;
ape.add(torso);

const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.55), MAT.face);
head.position.set(0, 1.12, 0.06);
ape.add(head);

const eyeGeo = new THREE.BoxGeometry(0.1, 0.09, 0.04);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xeafff5, emissive: 0x8effc8 });
const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
eyeL.position.set(-0.14, 1.18, 0.34);
const eyeR = eyeL.clone();
eyeR.position.x = 0.14;
ape.add(eyeL, eyeR);

// руки: два звена (плечо-локоть-кисть рисуем линиями + шар-кулак)
function makeLimb(color) {
  const geo = new THREE.CylinderGeometry(0.09, 0.075, 1, 6);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  mesh.castShadow = false;
  scene.add(mesh);
  return mesh;
}

const armL = makeLimb(0x2f6f52);
const armR = makeLimb(0x2f6f52);

const fistGeo = new THREE.SphereGeometry(0.22, 12, 10);
const fistL = new THREE.Mesh(fistGeo, MAT.hand);
const fistR = new THREE.Mesh(fistGeo, MAT.hand);
scene.add(fistL, fistR);

// ---------------------------------------------------------------- игрок
const player = {
  pos: new THREE.Vector3(0, 1.2, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  hands: [
    { side: -1, active: false, gripping: false, pos: new THREE.Vector3(-0.9, 1.2, 0.7), anchor: new THREE.Vector3(), mesh: fistL, arm: armL },
    { side: 1, active: false, gripping: false, pos: new THREE.Vector3(0.9, 1.2, 0.7), anchor: new THREE.Vector3(), mesh: fistR, arm: armR },
  ],
  checkpoint: new THREE.Vector3(0, 1.2, 0),
  finished: false,
  time: 0,
};

// ---------------------------------------------------------------- ввод
const input = {
  L: { x: 0, y: 0, active: false },
  R: { x: 0, y: 0, active: false },
};

function bindStick(el, target) {
  let pid = null;
  let base = { x: 0, y: 0 };
  let radius = 1;
  const thumb = el.querySelector('.thumb');

  const recenter = () => {
    const r = el.getBoundingClientRect();
    base = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    radius = Math.max(24, r.width * 0.34);
  };

  const move = (cx, cy) => {
    let dx = cx - base.x;
    let dy = cy - base.y;
    const len = Math.hypot(dx, dy) || 1;
    const k = len > radius ? radius / len : 1;
    dx *= k;
    dy *= k;
    if (thumb) thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    target.x = clamp(dx / radius, -1, 1);
    target.y = clamp(-dy / radius, -1, 1);
  };

  el.addEventListener('pointerdown', (e) => {
    if (pid !== null) return;
    pid = e.pointerId;
    el.setPointerCapture(pid);
    el.classList.add('active');
    recenter();
    target.active = true;
    move(e.clientX, e.clientY);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    move(e.clientX, e.clientY);
  });
  const end = (e) => {
    if (e && e.pointerId !== pid) return;
    pid = null;
    el.classList.remove('active');
    target.active = false;
    target.x = 0;
    target.y = 0;
    if (thumb) thumb.style.transform = 'translate(0px,0px)';
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
}

bindStick(document.getElementById('padL'), input.L);
bindStick(document.getElementById('padR'), input.R);

// клавиатура для проверки на ПК
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function keyboardInput() {
  const w = keys.has('KeyW'), s = keys.has('KeyS'), a = keys.has('KeyA'), d = keys.has('KeyD');
  if (w || s || a || d) {
    input.L.active = true;
    input.L.x = (d ? 1 : 0) - (a ? 1 : 0);
    input.L.y = (w ? 1 : 0) - (s ? 1 : 0);
    input.L.kb = true;
  } else if (input.L.kb) {
    input.L.active = false;
    input.L.x = 0;
    input.L.y = 0;
    input.L.kb = false;
  }

  const up = keys.has('ArrowUp'), dn = keys.has('ArrowDown'), lf = keys.has('ArrowLeft'), rt = keys.has('ArrowRight');
  if (up || dn || lf || rt) {
    input.R.active = true;
    input.R.x = (rt ? 1 : 0) - (lf ? 1 : 0);
    input.R.y = (up ? 1 : 0) - (dn ? 1 : 0);
    input.R.kb = true;
  } else if (input.R.kb) {
    input.R.active = false;
    input.R.x = 0;
    input.R.y = 0;
    input.R.kb = false;
  }
}

// ---------------------------------------------------------------- физика рук
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

/** ближайшая точка на поверхности AABB к точке p */
function clampToBox(p, box, out) {
  out.set(
    clamp(p.x, box.min.x, box.max.x),
    clamp(p.y, box.min.y, box.max.y),
    clamp(p.z, box.min.z, box.max.z)
  );
  return out;
}

function handTargetWorld(hand, out) {
  // цель руки в пространстве камеры (по горизонтали — стик), затем поворот на yaw
  const localX = hand.side * 0.62 + input[hand.side < 0 ? 'L' : 'R'].x * 1.05;
  const localY = -0.25 + input[hand.side < 0 ? 'L' : 'R'].y * 1.15;
  const localZ = 0.75;

  const cos = Math.cos(player.yaw);
  const sin = Math.sin(player.yaw);

  out.set(
    player.pos.x + localX * cos + localZ * sin,
    player.pos.y + localY,
    player.pos.z - localX * sin + localZ * cos
  );
  return out;
}

function updateHand(hand, dt) {
  const inp = input[hand.side < 0 ? 'L' : 'R'];
  const want = handTargetWorld(hand, tmpV);

  hand.active = inp.active;

  // рука тянется к цели
  const follow = 1 - Math.exp(-CFG.handFollow * dt);
  hand.pos.lerp(want, follow);

  // не дальше вытянутой руки от тела
  tmpV2.copy(hand.pos).sub(player.pos);
  const dist = tmpV2.length();
  if (dist > CFG.armReach) {
    hand.pos.copy(player.pos).add(tmpV2.multiplyScalar(CFG.armReach / dist));
  }

  // захват поверхности: сверху платформы — «прилипание» к верхней грани,
  // сбоку — прилипание к ближайшей точке бокса
  hand.gripping = false;
  if (hand.active) {
    for (const plat of platforms) {
      const b = plat.box;
      const inXZ =
        hand.pos.x > b.min.x - 0.4 && hand.pos.x < b.max.x + 0.4 &&
        hand.pos.z > b.min.z - 0.4 && hand.pos.z < b.max.z + 0.4;

      if (inXZ && hand.pos.y < b.max.y + 0.65 && hand.pos.y > b.min.y - 1.2) {
        hand.gripping = true;
        hand.anchor.set(
          clamp(hand.pos.x, b.min.x, b.max.x),
          b.max.y,
          clamp(hand.pos.z, b.min.z, b.max.z)
        );
        break;
      }

      clampToBox(hand.pos, b, tmpV2);
      if (hand.pos.distanceTo(tmpV2) < CFG.gripRadius) {
        hand.gripping = true;
        hand.anchor.copy(tmpV2);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- физика тела
function resolveBodyCollisions() {
  for (const plat of platforms) {
    const box = plat.box;
    const closest = clampToBox(player.pos, box, tmpV);
    const d = player.pos.distanceTo(closest);
    if (d < CFG.bodyRadius) {
      const push = tmpV2.copy(player.pos).sub(closest);
      if (push.lengthSq() < 1e-6) {
        // внутри бокса — выталкиваем вверх
        player.pos.y = box.max.y + CFG.bodyRadius;
        if (player.vel.y < 0) player.vel.y = 0;
      } else {
        push.normalize().multiplyScalar(CFG.bodyRadius - d);
        player.pos.add(push);
        const n = push.normalize();
        const vn = player.vel.dot(n);
        if (vn < 0) player.vel.addScaledVector(n, -vn);
      }
    }
  }
}

function respawn() {
  player.pos.copy(player.checkpoint);
  player.vel.set(0, 0, 0);
}

let respawnFlash = 0;

function updatePlayer(dt) {
  player.time += dt;

  // притяжение к захваченным рукам
  const gripped = player.hands.filter((h) => h.gripping);
  if (gripped.length) {
    const mid = tmpV.set(0, 0, 0);
    for (const h of gripped) mid.add(h.anchor);
    mid.multiplyScalar(1 / gripped.length);

    // тело стремится так, чтобы руки были в удобном положении: чуть ниже и позади
    const target = tmpV2.copy(mid).add(new THREE.Vector3(0, -0.55, 0));
    const toTarget = target.clone().sub(player.pos);
    const dist = toTarget.length();
    if (dist > 0.05) {
      player.vel.addScaledVector(toTarget.normalize(), CFG.pullStrength * dt * Math.min(dist, 1.2));
    }
  }

  // гравитация + затухание
  player.vel.y -= CFG.gravity * dt;
  if (gripped.length) player.vel.multiplyScalar(1 - Math.min(CFG.damping * dt * 0.55, 0.5));
  else player.vel.multiplyScalar(1 - Math.min(0.6 * dt, 0.1));

  const speed = player.vel.length();
  if (speed > CFG.maxSpeed) player.vel.multiplyScalar(CFG.maxSpeed / speed);

  player.pos.addScaledVector(player.vel, dt);
  resolveBodyCollisions();

  // чекпоинты: касание новой платформы фиксирует точку возврата
  for (const plat of platforms) {
    if (player.pos.distanceTo(plat.mesh.position) < 2.6) {
      const stand = tmpV.set(plat.mesh.position.x, plat.box.max.y + 0.9, plat.mesh.position.z);
      if (stand.y > player.checkpoint.y + 0.4) player.checkpoint.copy(stand);
    }
  }

  if (player.pos.y < -8) {
    respawn();
    respawnFlash = 1;
  }

  // камера-поворот по направлению движения
  const horiz = tmpV.set(player.vel.x, 0, player.vel.z);
  if (horiz.length() > 1.4) {
    const wantYaw = Math.atan2(horiz.x, horiz.z);
    let diff = wantYaw - player.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    player.yaw += diff * Math.min(dt * 2.2, 0.06);
  }

  // финиш
  if (!player.finished && player.pos.distanceTo(gem.position) < 1.5) {
    player.finished = true;
    onFinish();
  }
}

// ---------------------------------------------------------------- визуал игрока
function updateVisuals(dt) {
  ape.position.copy(player.pos);
  ape.rotation.y = player.yaw;

  // покачивание при движении
  const bob = Math.sin(player.time * 8) * Math.min(player.vel.length() / 12, 0.08);
  torso.position.y = 0.35 + bob;
  head.position.y = 1.12 + bob;

  for (const hand of player.hands) {
    hand.mesh.position.copy(hand.pos);
    hand.mesh.material = hand.gripping ? MAT.handGrip : MAT.hand;
    hand.mesh.scale.setScalar(hand.gripping ? 1.12 : 0.92);

    // рука: цилиндр от плеча к кулаку
    const shoulder = new THREE.Vector3(hand.side * 0.4, 0.85, 0.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw).add(player.pos);
    const dir = new THREE.Vector3().subVectors(hand.pos, shoulder);
    const len = Math.max(dir.length(), 0.001);
    hand.arm.position.copy(shoulder);
    hand.arm.scale.set(1, len, 1);
    hand.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  // камера
  const camDist = 5.4;
  const camHeight = 2.6;
  const cos = Math.cos(player.yaw);
  const sin = Math.sin(player.yaw);
  const desired = new THREE.Vector3(
    player.pos.x - sin * camDist,
    player.pos.y + camHeight,
    player.pos.z - cos * camDist
  );
  camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
  camera.lookAt(player.pos.x, player.pos.y + 0.7, player.pos.z);

  gem.rotation.y += dt * 1.4;
  gem.rotation.x += dt * 0.6;
  gem.position.y = gem.position.y + Math.sin(player.time * 2) * dt * 0.4;

  if (respawnFlash > 0) {
    respawnFlash = Math.max(0, respawnFlash - dt * 2);
    document.body.style.boxShadow = `inset 0 0 120px rgba(255,80,110,${respawnFlash * 0.55})`;
  }
}

// ---------------------------------------------------------------- движение платформ
function updatePlatforms(dt, t) {
  for (const plat of MOVE_PLATFORMS) {
    const m = plat.motion;
    const offset = Math.sin(t * m.speed) * m.amp;
    if (m.axis === 'y') {
      plat.mesh.position.y = plat.base.y + offset;
      plat.edges.position.copy(plat.mesh.position);
      plat.grass.position.y = plat.mesh.position.y + plat.h / 2 + 0.03;
      plat.box.setFromObject(plat.mesh);
    }
  }
}

// ---------------------------------------------------------------- HUD
const hud = {
  time: document.getElementById('statTime'),
  height: document.getElementById('statHeight'),
  hint: document.getElementById('hint'),
  win: document.getElementById('win'),
  winTime: document.getElementById('winTime'),
  grips: document.querySelectorAll('[data-grip]'),
};

function updateHud() {
  if (hud.time) hud.time.textContent = `${player.time.toFixed(1)}с`;
  if (hud.height) hud.height.textContent = `${Math.max(0, player.pos.y).toFixed(1)}м`;
  hud.grips.forEach((el) => {
    const hand = player.hands[el.dataset.grip === 'L' ? 0 : 1];
    el.classList.toggle('on', hand.gripping);
  });
}

function onFinish() {
  if (hud.win) {
    hud.win.hidden = false;
    if (hud.winTime) hud.winTime.textContent = `${player.time.toFixed(1)} секунд`;
  }
}

document.getElementById('btnRestart').addEventListener('click', () => {
  player.pos.set(0, 1.2, 0);
  player.vel.set(0, 0, 0);
  player.checkpoint.set(0, 1.2, 0);
  player.time = 0;
  player.finished = false;
  player.yaw = 0;
  if (hud.win) hud.win.hidden = true;
});

// ---------------------------------------------------------------- цикл
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

let last = performance.now();
let elapsed = 0;

function tick(dt) {
  elapsed += dt;
  keyboardInput();
  updatePlatforms(dt, elapsed);

  if (!player.finished) {
    updateHand(player.hands[0], dt);
    updateHand(player.hands[1], dt);
    updatePlayer(dt);
  }

  updateVisuals(dt);
  updateHud();
  vr.render();
  vr.tickFps();
}

function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  tick(dt);
  requestAnimationFrame(loop);
}

// отладочный доступ: удобно и в консоли телефона, и в автотестах
window.__SLOPAPE__ = { player, input, platforms, CFG, tick, respawn, scene, camera, vr };

resize();
requestAnimationFrame(loop);

setTimeout(() => {
  if (hud.hint) hud.hint.classList.add('hide');
}, 8000);

// прячем предупреждение о WebGL, если всё ок
document.getElementById('loading')?.remove();
