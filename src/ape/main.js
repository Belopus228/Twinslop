import * as THREE from 'three';
import { createSim, step, setHandInput, snapshot, CFG } from './sim.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
let mode = params.get('mode') === 'hide' ? 'hide' : 'heist';
let sim = createSim({ mode });

// ---------------------------------------------------------------- three.js

const canvas = $('apeCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x070a12, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x070a12, 18, 46);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
let yaw = 0;
let pitch = 0.28;
let camDist = 7.2;

const hemi = new THREE.HemisphereLight(0x8fb6ff, 0x1a1208, 0.75);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffd9a0, 1.05);
key.position.set(9, 14, 6);
scene.add(key);
const rim = new THREE.PointLight(0xff7a4d, 0.9, 26);
rim.position.set(0, 6, -6);
scene.add(rim);

// пол и стены
const floorMat = new THREE.MeshStandardMaterial({ color: 0x141d2b, roughness: 0.95, metalness: 0.05 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(CFG.bounds * 2, CFG.bounds * 2, 1, 1), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(CFG.bounds * 2, 26, 0x2a3b52, 0x1b2736);
grid.position.y = 0.01;
scene.add(grid);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x0d1622, roughness: 1, metalness: 0, side: THREE.DoubleSide });
const wallH = 6;
for (const [x, z, rot] of [[0, -CFG.bounds, 0], [0, CFG.bounds, 0], [-CFG.bounds, 0, Math.PI / 2], [CFG.bounds, 0, Math.PI / 2]]) {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(CFG.bounds * 2, wallH), wallMat);
  wall.position.set(x, wallH / 2, z);
  wall.rotation.y = rot;
  scene.add(wall);
}

// ---------------------------------------------------------------- мир игры

let world = null;

function disposeWorld() {
  if (!world) return;
  scene.remove(world.group);
  world.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
  world = null;
}

function orient(mesh, a, b) {
  const va = new THREE.Vector3(a[0], a[1], a[2]);
  const vb = new THREE.Vector3(b[0], b[1], b[2]);
  const dir = new THREE.Vector3().subVectors(vb, va);
  const l = dir.length() || 0.0001;
  mesh.position.copy(va).addScaledVector(dir, 0.5);
  mesh.scale.set(1, l, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

function buildWorld() {
  disposeWorld();
  const group = new THREE.Group();
  scene.add(group);

  // ящики-опоры
  const crateMats = [
    new THREE.MeshStandardMaterial({ color: 0x3a4c66, roughness: 0.75, metalness: 0.25 }),
    new THREE.MeshStandardMaterial({ color: 0x2f4157, roughness: 0.8, metalness: 0.2 }),
  ];
  const crates = sim.crates.map((c, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), crateMats[i % 2]);
    mesh.position.set(c.x, c.y + c.h / 2, c.z);
    group.add(mesh);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x6f9cc9, transparent: true, opacity: 0.35 }),
    );
    edge.position.copy(mesh.position);
    group.add(edge);
    return { mesh, edge };
  });

  // добыча
  const lootMeshes = sim.loot.map((item) => {
    const geo = item.type === 'gem'
      ? new THREE.OctahedronGeometry(0.28)
      : new THREE.BoxGeometry(0.62, 0.2, 0.3);
    const mat = new THREE.MeshStandardMaterial({
      color: item.type === 'gem' ? 0x63f5ff : 0xffc93c,
      emissive: item.type === 'gem' ? 0x1f8fa0 : 0xa86a00,
      emissiveIntensity: 0.9,
      metalness: 0.7,
      roughness: 0.25,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(item.x, item.y, item.z);
    group.add(mesh);

    const light = new THREE.PointLight(item.type === 'gem' ? 0x63f5ff : 0xffb52e, 0.5, 5);
    light.position.copy(mesh.position);
    group.add(light);
    return { mesh, light, baseY: item.y };
  });

  // выход
  const exitMat = new THREE.MeshStandardMaterial({
    color: 0x2bd67b, emissive: 0x0f7a3f, emissiveIntensity: 0.8, transparent: true, opacity: 0.32,
  });
  const exitRing = new THREE.Mesh(new THREE.CylinderGeometry(sim.exit.r, sim.exit.r, 0.18, 28), exitMat);
  exitRing.position.set(sim.exit.x, 0.09, sim.exit.z);
  group.add(exitRing);
  const exitLight = new THREE.PointLight(0x3ddc84, 1.1, 9);
  exitLight.position.set(sim.exit.x, 1.6, sim.exit.z);
  group.add(exitLight);

  // обезьяна
  const fur = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 14), fur);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), fur);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xc9a37a, roughness: 0.9 }));
  const hands = [
    new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), fur),
    new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), fur),
  ];
  const arms = [
    new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 8), fur),
    new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 8), fur),
  ];
  group.add(body, head, muzzle, hands[0], hands[1], arms[0], arms[1]);

  // монстр
  const monsterMat = new THREE.MeshStandardMaterial({ color: 0x2a0e14, roughness: 0.7, metalness: 0.15 });
  const monster = new THREE.Group();
  const mBody = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 1.5, 10), monsterMat);
  mBody.position.y = 0.75;
  const mHead = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), monsterMat);
  mHead.position.y = 1.7;
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2e4d, emissive: 0xff2e4d, emissiveIntensity: 2 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.12, 1.74, 0.27);
  eyeR.position.set(0.12, 1.74, 0.27);
  const mGlow = new THREE.PointLight(0xff2e4d, 0.85, 6);
  mGlow.position.y = 1.7;
  monster.add(mBody, mHead, eyeL, eyeR, mGlow);
  group.add(monster);

  world = { group, crates, lootMeshes, body, head, muzzle, hands, arms, monster };
}

// ---------------------------------------------------------------- ввод

const stickState = {
  L: { active: false, id: null, x: 0, y: 0, el: null, knob: null, cx: 0, cy: 0, radius: 46 },
  R: { active: false, id: null, x: 0, y: 0, el: null, knob: null, cx: 0, cy: 0, radius: 46 },
};

function setupStick(side) {
  const el = $(`stick${side}`);
  const knob = $(`knob${side}`);
  if (!el || !knob) return;

  const st = stickState[side];
  st.el = el; st.knob = knob;

  const rect = () => el.getBoundingClientRect();
  const start = (ev) => {
    const r = rect();
    st.active = true;
    st.id = ev.pointerId;
    st.cx = r.left + r.width / 2;
    st.cy = r.top + r.height / 2;
    st.radius = r.width * 0.36;
    el.classList.add('active');
    el.setPointerCapture?.(ev.pointerId);
    move(ev);
  };
  const move = (ev) => {
    if (!st.active || ev.pointerId !== st.id) return;
    let dx = ev.clientX - st.cx;
    let dy = ev.clientY - st.cy;
    const d = Math.hypot(dx, dy);
    const max = st.radius;
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    st.x = dx / max;
    st.y = -dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const end = (ev) => {
    if (ev && ev.pointerId !== st.id) return;
    st.active = false;
    st.id = null;
    st.x = 0; st.y = 0;
    knob.style.transform = 'translate(0px, 0px)';
    el.classList.remove('active');
  };

  el.addEventListener('pointerdown', start);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
}

setupStick('L');
setupStick('R');

// клавиатура (десктоп): WASD — левая рука, стрелки — правая
const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));

function keyboardHand(side) {
  const map = side === 'L'
    ? { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }
    : { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const x = (keys.has(map.right) ? 1 : 0) - (keys.has(map.left) ? 1 : 0);
  const y = (keys.has(map.up) ? 1 : 0) - (keys.has(map.down) ? 1 : 0);
  return { x, y };
}

// поворот камеры — свайп по свободной части экрана
let look = null;
canvas.addEventListener('pointerdown', (e) => {
  look = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  if (!look || e.pointerId !== look.id) return;
  const dx = e.clientX - look.x;
  const dy = e.clientY - look.y;
  look.x = e.clientX; look.y = e.clientY;
  yaw -= dx * 0.006;
  pitch = Math.min(0.85, Math.max(-0.15, pitch + dy * 0.004));
});
const endLook = (e) => { if (!look || !e || e.pointerId === look.id) look = null; };
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);
canvas.addEventListener('lostpointercapture', endLook);

// ---------------------------------------------------------------- HUD

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

const MONSTER_RU = { patrol: 'обходит', alert: 'услышал', chase: 'гонится' };

let hudTick = 0;
function updateHud(dt) {
  const s = snapshot(sim);

  $('hudGold').textContent = String(s.gold);
  $('hudGems').textContent = String(s.gems);
  $('hudTimer').textContent = fmtTime(s.timeLeft);
  $('noiseFill').style.width = `${Math.round(s.noise * 100)}%`;
  $('noiseFill').dataset.level = s.noise > 0.66 ? 'high' : s.noise > 0.33 ? 'mid' : 'low';

  const mstate = $('monsterState');
  mstate.textContent = MONSTER_RU[s.monster.state] || s.monster.state;
  mstate.dataset.level = s.monster.state;

  $('handL').classList.toggle('on', s.hands.L);
  $('handR').classList.toggle('on', s.hands.R);

  const goal = sim.mode === 'hide'
    ? `продержись ${fmtTime(s.timeLeft)}`
    : `собери ${s.needed} и уходи к зелёному кругу (${s.total}/${s.needed})`;
  $('goalText').textContent = goal;

  // баннер
  if (s.state !== 'play') {
    showBanner(s);
  }
}

function showBanner(s) {
  const banner = $('banner');
  if (!banner.hidden) return;
  const won = s.state === 'won';
  banner.hidden = false;
  banner.className = `banner ${won ? 'won' : 'lost'}`;
  $('bannerTitle').textContent = won
    ? (sim.mode === 'hide' ? 'ПРОДЕРЖАЛСЯ' : 'УНЁС ДОБЫЧУ')
    : 'ТЕБЯ УСЛЫШАЛИ';
  $('bannerText').textContent = won
    ? `золото: ${s.gold} · алмазы: ${s.gems} · время: ${fmtTime(s.t)}`
    : `золото: ${s.gold} · алмазы: ${s.gems} · продержался ${fmtTime(s.t)}`;
}

// ---------------------------------------------------------------- цикл

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const tmp = new THREE.Vector3();

function renderFrame(dt) {
  const p = sim.player.p;

  // тело
  world.body.position.set(p[0], p[1], p[2]);
  world.head.position.set(p[0], p[1] + 0.45, p[2]);
  world.muzzle.position.set(p[0] + Math.sin(yaw) * 0.2, p[1] + 0.42, p[2] + Math.cos(yaw) * 0.2);

  // руки: плечо → кисть
  const shoulders = [[p[0] - 0.3, p[1] + 0.1, p[2]], [p[0] + 0.3, p[1] + 0.1, p[2]]];
  const hp = [sim.player.hands.L.pos, sim.player.hands.R.pos];
  for (let i = 0; i < 2; i++) {
    world.hands[i].position.set(hp[i][0], hp[i][1], hp[i][2]);
    orient(world.arms[i], shoulders[i], hp[i]);
  }

  // добыча: покачивание
  world.lootMeshes.forEach((l, i) => {
    if (!l.mesh.visible) return;
    l.mesh.rotation.y += dt * 1.6;
    const bob = Math.sin(performance.now() / 600 + i) * 0.06;
    l.mesh.position.y = l.baseY + bob;
    l.light.position.y = l.baseY + bob;
  });

  // монстр
  const m = sim.monster;
  world.monster.position.set(m.p[0], 0, m.p[2]);
  const md = Math.atan2(p[0] - m.p[0], p[2] - m.p[2]);
  world.monster.rotation.y = md;

  // камера за спиной
  const target = tmp.set(p[0], p[1] + 1.0, p[2]);
  const camX = p[0] - Math.sin(yaw) * camDist * Math.cos(pitch);
  const camZ = p[2] - Math.cos(yaw) * camDist * Math.cos(pitch);
  const camY = p[1] + 2.2 + camDist * Math.sin(pitch);
  camera.position.set(camX, camY, camZ);
  camera.lookAt(target);
}

let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (sim.state === 'play') {
    const kl = keyboardHand('L');
    const kr = keyboardHand('R');
    const L = stickState.L.active ? stickState.L : kl;
    const R = stickState.R.active ? stickState.R : kr;
    setHandInput(sim, 'L', L);
    setHandInput(sim, 'R', R);
    sim.yaw = yaw;
    step(sim, dt);

    // исчезновение подобранной добычи
    sim.loot.forEach((item, i) => {
      if (item.taken && world.lootMeshes[i].mesh.visible) {
        world.lootMeshes[i].mesh.visible = false;
        world.lootMeshes[i].light.visible = false;
      }
    });
  }

  hudTick += dt;
  if (hudTick > 0.08) { hudTick = 0; updateHud(dt); }

  renderFrame(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- перезапуск и режимы

function restart(nextMode) {
  if (nextMode) mode = nextMode;
  sim = createSim({ mode });
  yaw = 0; pitch = 0.28;
  $('banner').hidden = true;
  buildWorld();
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === mode);
  });
}

document.querySelectorAll('[data-mode]').forEach((b) => {
  b.addEventListener('click', () => restart(b.dataset.mode));
});
$('bannerRestart')?.addEventListener('click', () => restart());
$('hudRestart')?.addEventListener('click', () => restart());

const hintClose = $('hintClose');
if (hintClose) {
  hintClose.addEventListener('click', () => {
    const hint = $('hint');
    if (hint) hint.hidden = true;
  });
}

resize();
buildWorld();
restart(mode);
updateHud(0);
requestAnimationFrame(frame);

// отладочный доступ (как у SLOP APE)
window.__APEHEIST__ = {
  get sim() { return sim; },
  snapshot: () => snapshot(sim),
  restart,
  CFG,
};
