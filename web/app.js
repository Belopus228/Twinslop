/* Twinslop Hands — два стика = две руки. */
(() => {
  'use strict';

  const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);
  const $ = (sel) => document.querySelector(sel);

  // Офлайн-режим: в APK приложение открывается с file:// и вообще не имеет
  // разрешения INTERNET. Никаких сетевых проверок в этом случае не делаем.
  const OFFLINE = location.protocol === 'file:' || window.TWINSLOP_OFFLINE === true;

  // ---------------------------------------------------------------- состояние
  const S = {
    L: { x: 0, y: 0, trigger: 0, grip: 0 },
    R: { x: 0, y: 0, trigger: 0, grip: 0 },
    sens: 1.3,
    dead: 0.06,
    inv: false,
    vib: true,
    wake: true,
    swap: false,
  };

  const store = {
    load() {
      try {
        const raw = localStorage.getItem('twinslop-hands');
        if (raw) Object.assign(S, JSON.parse(raw));
      } catch (_) { /* ignore */ }
    },
    save() {
      try {
        localStorage.setItem('twinslop-hands', JSON.stringify({
          sens: S.sens, dead: S.dead, inv: S.inv, vib: S.vib, wake: S.wake, swap: S.swap,
        }));
      } catch (_) { /* ignore */ }
    },
  };

  // ---------------------------------------------------------------- стики
  const pads = {};

  // какой рукой управляет этот стик (с учётом настройки «поменять руки»)
  function handOf(side) {
    if (!S.swap) return side;
    return side === 'L' ? 'R' : 'L';
  }

  function setupPad(el, handName) {
    const hand = S[handOf(handName)];
    const thumb = el.querySelector('.pad-thumb');
    let pid = null;
    let base = { x: 0, y: 0 };
    let radius = 1;

    function recenter() {
      const r = el.getBoundingClientRect();
      base = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      radius = Math.max(24, r.width * 0.33);
    }

    function apply(clientX, clientY) {
      let dx = clientX - base.x;
      let dy = clientY - base.y;
      const len = Math.hypot(dx, dy) || 1;
      const k = len > radius ? radius / len : 1;
      dx *= k;
      dy *= k;
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;

      let nx = dx / radius;
      let ny = dy / radius;
      const m = Math.hypot(nx, ny);
      if (m < S.dead) {
        nx = 0;
        ny = 0;
      } else {
        const scaled = (m - S.dead) / (1 - S.dead);
        nx = (nx / m) * scaled;
        ny = (ny / m) * scaled;
      }
      let mag = Math.hypot(nx, ny) * S.sens;
      if (mag > 1) mag = 1;
      const ang = Math.atan2(ny, nx);
      hand.x = clamp(Math.cos(ang) * mag);
      hand.y = clamp(S.inv ? -Math.sin(ang) * mag : Math.sin(ang) * mag);
      dirty();
    }

    function release() {
      pid = null;
      hand.x = 0;
      hand.y = 0;
      thumb.style.transform = 'translate(0px, 0px)';
      el.classList.remove('active');
      dirty();
    }

    el.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId;
      el.setPointerCapture(pid);
      recenter();
      el.classList.add('active');
      hideHint();
      buzz(8);
      apply(e.clientX, e.clientY);
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      apply(e.clientX, e.clientY);
      e.preventDefault();
    });

    const stop = (e) => {
      if (e.pointerId !== pid) return;
      release();
    };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('lostpointercapture', stop);
    window.addEventListener('blur', release);

    return { release };
  }

  // ---------------------------------------------------------------- кнопки
  function setupButtons() {
    document.querySelectorAll('.abtn').forEach((btn) => {
      const hand = S[handOf(btn.dataset.hand)];
      const field = btn.dataset.btn;
      let pid = null;

      const down = (e) => {
        if (pid !== null) return;
        pid = e.pointerId;
        btn.setPointerCapture(pid);
        hand[field] = 1;
        btn.classList.add('pressed');
        buzz(field === 'grip' ? 14 : 8);
        dirty();
        hideHint();
        e.preventDefault();
      };

      const up = (e) => {
        if (pid !== null && e.pointerId !== pid) return;
        pid = null;
        hand[field] = 0;
        btn.classList.remove('pressed');
        dirty();
      };

      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    });
  }

  function buzz(ms) {
    if (!S.vib) return;
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  // ---------------------------------------------------------------- сеть
  let online = false;
  let lastSent = 0;
  let pending = true;
  const netLabel = { el: null };
  let okCount = 0;
  let failCount = 0;

  function dirty() { pending = true; }

  async function push() {
    if (OFFLINE) {
      // локальный режим: руки считаются на месте, сеть не трогаем вообще
      online = true;
      const led = $('#led');
      if (led) { led.classList.add('on'); led.classList.remove('err'); }
      const note = $('#netNote');
      if (note) note.textContent = 'локальный режим: сеть не используется';
      return;
    }
    if (!pending && Date.now() - lastSent < 400) return;
    pending = false;
    lastSent = Date.now();
    const body = JSON.stringify({ L: S.L, R: S.R, sensitivity: S.sens, deadzone: S.dead });
    try {
      const res = await fetch('./api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
      online = res.ok;
      okCount++;
      failCount = 0;
    } catch (_) {
      failCount++;
      if (failCount > 2) online = false;
    }
    const led = $('#led');
    if (led) {
      led.classList.toggle('on', online);
      led.classList.toggle('err', !online);
    }
    const note = $('#netNote');
    if (note) {
      note.textContent = online
        ? `связь с сервером: ок (${okCount} пакетов)`
        : 'связь с сервером: нет — открой страницу с сервера (node server.js)';
    }
  }

  // ---------------------------------------------------------------- отрисовка
  const canvas = $('#view');
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  const trails = { L: [], R: [] };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function toScreen(x, y) {
    const mx = W * 0.12;
    const my = H * 0.16;
    return [W / 2 + x * (W / 2 - mx), H / 2 - y * (H / 2 - my)];
  }

  function drawHand(hand, name, color) {
    const [px, py] = toScreen(hand.x, hand.y);
    const t = trails[name];
    t.push([px, py]);
    if (t.length > 14) t.shift();

    // хвост
    for (let i = 0; i < t.length - 1; i++) {
      const a = (i / t.length) * 0.5;
      ctx.beginPath();
      ctx.strokeStyle = color.replace('ALPHA', String(a * 0.5));
      ctx.lineWidth = 2 + (i / t.length) * 6;
      ctx.lineCap = 'round';
      ctx.moveTo(t[i][0], t[i][1]);
      ctx.lineTo(t[i + 1][0], t[i + 1][1]);
      ctx.stroke();
    }

    const r = 9 + hand.trigger * 10;
    ctx.beginPath();
    ctx.fillStyle = color.replace('ALPHA', '0.18');
    ctx.arc(px, py, r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = color.replace('ALPHA', '0.95');
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    if (hand.grip > 0) {
      ctx.beginPath();
      ctx.strokeStyle = color.replace('ALPHA', '0.9');
      ctx.lineWidth = 2;
      ctx.arc(px, py, r + 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = color.replace('ALPHA', '0.75');
    ctx.fillText(name, px + r + 8, py + 4);
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);

    // сетка плоскости
    ctx.strokeStyle = 'rgba(120,160,200,0.09)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      const [x1] = toScreen(i / 2, 0);
      ctx.beginPath();
      ctx.moveTo(x1, H * 0.08);
      ctx.lineTo(x1, H * 0.92);
      ctx.stroke();
      const [, y1] = toScreen(0, i / 2);
      ctx.beginPath();
      ctx.moveTo(W * 0.06, y1);
      ctx.lineTo(W * 0.94, y1);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(160,190,220,0.16)';
    ctx.beginPath();
    ctx.moveTo(W / 2, H * 0.08);
    ctx.lineTo(W / 2, H * 0.92);
    ctx.moveTo(W * 0.06, H / 2);
    ctx.lineTo(W * 0.94, H / 2);
    ctx.stroke();

    drawHand(S.L, 'L', 'rgba(61,220,132,ALPHA)');
    drawHand(S.R, 'R', 'rgba(255,138,91,ALPHA)');

    const vl = $('#valL');
    const vr = $('#valR');
    if (vl) vl.textContent = `${S.L.x.toFixed(2)} · ${S.L.y.toFixed(2)}`;
    if (vr) vr.textContent = `${S.R.x.toFixed(2)} · ${S.R.y.toFixed(2)}`;

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- подсказка/настройки
  let hintTimer = null;
  function hideHint() {
    const h = $('#hint');
    if (h && !h.classList.contains('hide')) h.classList.add('hide');
    if (hintTimer) clearTimeout(hintTimer);
  }

  function setupSettings() {
    // все настройки живут на отдельной странице settings.html и в localStorage;
    // здесь — только полноэкранный режим и перечитывание настроек при возврате
    $('#btnFull').addEventListener('click', async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(() => {});
          }
        } else {
          await document.exitFullscreen();
        }
      } catch (_) { /* ignore */ }
      setTimeout(resize, 250);
    });
  }

  // ---------------------------------------------------------------- wake lock
  let wakeLock = null;
  async function requestWake() {
    if (!S.wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) { /* ignore */ }
  }
  function releaseWake() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // буквы на стиках показывают, какой рукой они управляют
  function paintHandLabels() {
    [['padL', handOf('L')], ['padR', handOf('R')]].forEach(([id, hand]) => {
      const el = document.getElementById(id);
      const label = el && el.querySelector('.pad-thumb span');
      if (label) label.textContent = hand;
    });
  }

  // ---------------------------------------------------------------- клавиатура
  function setupKeyboard() {
    const keys = new Set();
    const map = {
      KeyW: ['L', 'y', 1], KeyS: ['L', 'y', -1], KeyA: ['L', 'x', -1], KeyD: ['L', 'x', 1],
      ArrowUp: ['R', 'y', 1], ArrowDown: ['R', 'y', -1], ArrowLeft: ['R', 'x', -1], ArrowRight: ['R', 'x', 1],
    };

    function sync() {
      S.L.x = 0; S.L.y = 0; S.R.x = 0; S.R.y = 0;
      keys.forEach((code) => {
        const m = map[code];
        if (!m) return;
        S[m[0]][m[1]] += m[2];
      });
      S.L.x = clamp(S.L.x); S.L.y = clamp(S.L.y);
      S.R.x = clamp(S.R.x); S.R.y = clamp(S.R.y);
      dirty();
    }

    window.addEventListener('keydown', (e) => {
      if (map[e.code]) {
        keys.add(e.code);
        sync();
        e.preventDefault();
        hideHint();
      }
      if (e.code === 'Space') { S.L.grip = 1; S.R.grip = 1; dirty(); e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { S.L.trigger = 1; S.R.trigger = 1; dirty(); }
    });

    window.addEventListener('keyup', (e) => {
      if (map[e.code]) { keys.delete(e.code); sync(); }
      if (e.code === 'Space') { S.L.grip = 0; S.R.grip = 0; dirty(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { S.L.trigger = 0; S.R.trigger = 0; dirty(); }
    });
  }

  // ---------------------------------------------------------------- старт
  function init() {
    store.load();
    pads.L = setupPad($('#padL'), 'L');
    pads.R = setupPad($('#padR'), 'R');
    setupButtons();
    setupSettings();
    setupKeyboard();
    paintHandLabels();

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 300));

    requestAnimationFrame(frame);
    setInterval(push, 33);
    push();

    requestWake();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestWake();
    });

    window.addEventListener('pageshow', () => { store.load(); paintHandLabels(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { store.load(); paintHandLabels(); }
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    hintTimer = setTimeout(hideHint, 9000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
