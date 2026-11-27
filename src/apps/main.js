import { verdictFor, filterApps, sortApps, summarize } from './logic.js';

const $ = (id) => document.getElementById(id);

const ui = {
  list: $('appList'),
  search: $('appSearch'),
  status: $('appsStatus'),
  detail: $('appDetail'),
  demo: $('appsDemo'),
  summary: $('appsSummary'),
};

let apps = [];
let selected = null;
let bridge = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadApps() {
  const api = window.TwinslopApp;
  if (!api || typeof api.listApps !== 'function') return null;
  try {
    const raw = api.listApps();
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function renderList() {
  if (!ui.list) return;
  const items = sortApps(filterApps(apps, ui.search?.value));

  if (!items.length) {
    ui.list.innerHTML = '<li class="empty">ничего не нашлось</li>';
    return;
  }

  ui.list.innerHTML = items.map((a) => {
    const v = verdictFor(a);
    const badge = v.level === 'vr' ? 'VR' : a.system ? 'система' : '';
    return `<li class="app-item ${selected && selected.package === a.package ? 'active' : ''}" data-pkg="${esc(a.package)}">
      <div class="app-icon ${v.level}">${esc((a.label || '?').slice(0, 1).toUpperCase())}</div>
      <div class="app-meta">
        <div class="app-label">${esc(a.label)}</div>
        <div class="app-pkg">${esc(a.package)}</div>
      </div>
      ${badge ? `<span class="badge ${v.level}">${badge}</span>` : ''}
    </li>`;
  }).join('');

  ui.list.querySelectorAll('.app-item').forEach((el) => {
    el.addEventListener('click', () => {
      const app = apps.find((a) => a.package === el.dataset.pkg);
      if (app) selectApp(app);
    });
  });
}

function selectApp(app) {
  selected = app;
  renderList();

  const v = verdictFor(app);
  if (!ui.detail) return;
  ui.detail.hidden = false;

  const details = (v.details || []).map((d) => `<li><code>${esc(d)}</code></li>`).join('');

  ui.detail.innerHTML = `
    <div class="verdict verdict-${v.level}">
      <div class="verdict-badge">${v.attach ? 'можно' : 'нельзя прицепиться'}</div>
      <h2>${esc(v.title)}</h2>
      <p class="app-title">${esc(app.label)} <code>${esc(app.package)}</code></p>
      <p>${esc(v.text)}</p>
      ${details ? `<ul class="perms">${details}</ul>` : ''}
      <div class="actions">
        <button class="primary" id="launchBtn" ${v.launch ? '' : 'disabled'}>
          ${v.launch ? 'Запустить' : 'Запуск не имеет смысла'}
        </button>
      </div>
      <p class="muted small" id="launchNote"></p>
    </div>
  `;

  const btn = $('launchBtn');
  if (btn && v.launch) {
    btn.addEventListener('click', () => {
      try {
        const ok = window.TwinslopApp.launch(app.package);
        const note = $('launchNote');
        note.textContent = ok ? 'приложение открыто системой' : 'система отказала в запуске';
      } catch (err) {
        const note = $('launchNote');
        if (note) note.textContent = 'ошибка запуска: ' + (err.message || err);
      }
    });
  }
}

function init() {
  const api = window.TwinslopApp;
  const list = loadApps();

  if (!api || typeof api.listApps !== 'function') {
    if (ui.demo) ui.demo.hidden = false;
    if (ui.list) ui.list.innerHTML = '';
    if (ui.status) ui.status.textContent = '';
    return;
  }

  if (list === null) {
    if (ui.status) ui.status.textContent = 'система не отдала список приложений (нет разрешения QUERY_ALL_PACKAGES)';
    return;
  }

  apps = list;
  bridge = api;

  const s = summarize(apps);
  if (ui.summary) ui.summary.textContent = `${s.total} приложений · VR: ${s.vr} · обычных: ${s.normal}`;
  if (ui.status) ui.status.textContent = '';

  renderList();

  if (ui.search) {
    ui.search.addEventListener('input', () => renderList());
  }

  // кнопка «все приложения» из настроек Android
  const more = $('openSettings');
  if (more) {
    more.addEventListener('click', () => {
      try { window.TwinslopApp.openUrl('https://github.com/Belopus228/Twinslop/releases/tag/hands'); } catch (_) {}
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
