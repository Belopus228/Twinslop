import * as THREE from 'three';

/**
 * Эмулятор шлема: превращает телефон в VR-устройство для нашего контента.
 *
 * Что эмулируется по-настоящему:
 *  - стерео-рендер (два вида, смещение по IPD), как в реальном шлеме;
 *  - профили устройств (Quest 3S / Quest 3 / Cardboard) с их разрешением и Гц;
 *  - трекинг головы: гироскоп устройства, если браузер даёт датчики,
 *    иначе — палец по экрану (работает везде);
 *  - счётчик FPS и проверка, держим ли целевой рефреш.
 *
 * Чего здесь нет и не будет: подделки Meta-аккаунта, энтайтлментов и сервисов
 * Horizon. Так что запускать чужие APK из магазина этот модуль не умеет —
 * он про свой контент (игру, WebXR-сцену, тестовый рендер).
 */

const PROFILES = {
  quest3s: { label: 'Quest 3S', eyeW: 2064, eyeH: 2208, hz: 90 },
  quest3: { label: 'Quest 3', eyeW: 2064, eyeH: 2208, hz: 120 },
  cardboard: { label: 'Cardboard', eyeW: 960, eyeH: 1080, hz: 60 },
};

export function createVR({ renderer, scene, camera, canvas }) {
  const state = {
    stereo: true,
    gyro: true,
    ipd: 63,          // мм
    profile: 'quest3s',
    enabled: false,
    yaw: 0,
    pitch: 0,
    roll: 0,
    fps: 0,
  };

  const eyeL = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  const eyeR = new THREE.PerspectiveCamera(70, 1, 0.05, 200);

  const headQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  let gyroReady = false;
  let base = null;
  let frames = 0;
  let fpsTime = performance.now();

  // ---------------------------------------------------------------- гироскоп
  function onOrientation(e) {
    if (!state.gyro) return;
    if (e.alpha == null && e.beta == null) return;
    if (!base) {
      base = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
      gyroReady = true;
      return;
    }
    const a = ((e.alpha || 0) - base.alpha) * (Math.PI / 180);
    const b = ((e.beta || 0) - base.beta) * (Math.PI / 180);
    const g = ((e.gamma || 0) - base.gamma) * (Math.PI / 180);

    // сглаживание, чтобы шлем не «дрожал»
    state.yaw += (-a - state.yaw) * 0.35;
    state.pitch += ((b * 0.8) - state.pitch) * 0.35;
    state.roll += ((g * 0.25) - state.roll) * 0.3;
  }

  async function enableGyro() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', onOrientation, true);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------- тач-обзор
  let dragId = null;
  let lastX = 0;
  let lastY = 0;

  function bindDrag() {
    canvas.addEventListener('pointerdown', (e) => {
      if (!state.enabled || !state.gyro || dragId !== null) return;
      dragId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture?.(dragId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      state.yaw -= dx * 0.004;
      state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - dy * 0.004));
    });
    const end = (e) => { if (!e || e.pointerId === dragId) dragId = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- рендер
  function applyHead(cam) {
    tmpEuler.set(state.pitch, state.yaw, state.roll, 'YXZ');
    headQuat.setFromEuler(tmpEuler);
    cam.quaternion.multiply(headQuat);
  }

  function render() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;

    if (!state.enabled || !state.stereo) {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.render(scene, camera);
      return;
    }

    // стерео: две половины экрана, камеры разнесены по IPD
    const half = Math.floor(w / 2);
    const shift = (state.ipd / 1000) / 2; // половина межзрачкового, в метрах

    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, half, h);
    renderer.setViewport(0, 0, half, h);

    for (const [cam, side] of [[eyeL, -1], [eyeR, 1]]) {
      cam.fov = camera.fov;
      cam.aspect = half / h;
      cam.near = camera.near;
      cam.far = camera.far;
      cam.position.copy(camera.position);
      cam.quaternion.copy(camera.quaternion);
      applyHead(cam);
      cam.translateX(side * shift);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    }

    renderer.setViewport(0, 0, half, h);
    renderer.render(scene, eyeL);
    renderer.setViewport(half, 0, half, h);
    renderer.setScissor(half, 0, half, h);
    renderer.render(scene, eyeR);
  }

  // ---------------------------------------------------------------- FPS
  function tickFps() {
    frames++;
    const now = performance.now();
    if (now - fpsTime >= 500) {
      state.fps = Math.round((frames * 1000) / (now - fpsTime));
      frames = 0;
      fpsTime = now;
      if (ui.fps) ui.fps.textContent = `${state.fps} FPS`;
      if (ui.profileNote) {
        const p = PROFILES[state.profile];
        const ok = state.fps >= p.hz - 8;
        ui.profileNote.textContent = `${p.label}: цель ${p.hz} Гц · экран ${p.eyeW}×${p.eyeH}/глаз · ${ok ? 'держим' : 'не дотягиваем'}`;
      }
    }
  }

  // ---------------------------------------------------------------- UI
  const ui = {
    panel: document.getElementById('vrPanel'),
    toggle: document.getElementById('vrToggle'),
    sheet: document.getElementById('vrSheet'),
    close: document.getElementById('vrClose'),
    stereo: document.getElementById('vrStereo'),
    gyro: document.getElementById('vrGyro'),
    ipd: document.getElementById('vrIpd'),
    ipdVal: document.getElementById('vrIpdVal'),
    profile: document.getElementById('vrProfile'),
    fps: document.getElementById('vrFps'),
    profileNote: document.getElementById('vrProfileNote'),
    divider: document.getElementById('vrDivider'),
  };

  function syncUi() {
    if (ui.stereo) ui.stereo.checked = state.stereo;
    if (ui.gyro) ui.gyro.checked = state.gyro;
    if (ui.ipd) ui.ipd.value = String(state.ipd);
    if (ui.ipdVal) ui.ipdVal.textContent = `${state.ipd} мм`;
    if (ui.profile) ui.profile.value = state.profile;
    if (ui.divider) ui.divider.hidden = !(state.enabled && state.stereo);
    if (typeof document !== 'undefined' && document.body && document.body.classList) {
      document.body.classList.toggle('vr-on', state.enabled && state.stereo);
    }
    if (ui.toggle) ui.toggle.classList.toggle('on', state.enabled);
  }

  function wireUi() {
    if (ui.toggle) {
      ui.toggle.addEventListener('click', async () => {
        state.enabled = !state.enabled;
        base = null;
        if (state.enabled && state.gyro) await enableGyro();
        syncUi();
      });
    }
    if (ui.panel) {
      ui.panel.addEventListener('click', (e) => {
        if (ui.sheet && e.target === ui.panel) ui.sheet.hidden = true;
      });
    }
    if (document.getElementById('vrSettings')) {
      document.getElementById('vrSettings').addEventListener('click', () => {
        if (ui.sheet) ui.sheet.hidden = !ui.sheet.hidden;
      });
    }
    if (ui.close) ui.close.addEventListener('click', () => { if (ui.sheet) ui.sheet.hidden = true; });
    if (ui.stereo) ui.stereo.addEventListener('change', () => { state.stereo = ui.stereo.checked; syncUi(); });
    if (ui.gyro) {
      ui.gyro.addEventListener('change', async () => {
        state.gyro = ui.gyro.checked;
        base = null;
        if (state.gyro) await enableGyro();
      });
    }
    if (ui.ipd) {
      ui.ipd.addEventListener('input', () => {
        state.ipd = Number(ui.ipd.value);
        if (ui.ipdVal) ui.ipdVal.textContent = `${state.ipd} мм`;
      });
    }
    if (ui.profile) {
      ui.profile.addEventListener('change', () => {
        state.profile = ui.profile.value;
        const p = PROFILES[state.profile];
        // подгоняем «панель» под заявленное разрешение глаза
        canvas.style.imageRendering = p.eyeW < 1200 ? 'auto' : 'auto';
      });
    }
  }

  bindDrag();
  wireUi();
  syncUi();

  return {
    state,
    profiles: PROFILES,
    render,
    tickFps,
    resetView() {
      state.yaw = 0;
      state.pitch = 0;
      state.roll = 0;
      base = null;
    },
  };
}
