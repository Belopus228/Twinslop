import { inspectApk } from './inspect.js';

const $ = (id) => document.getElementById(id);

const ui = {
  input: $('apkFile'),
  pick: $('pickBtn'),
  drop: $('dropZone'),
  status: $('apkStatus'),
  result: $('apkResult'),
  release: $('openRelease'),
};

function setStatus(text) {
  if (ui.status) ui.status.textContent = text || '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(r) {
  const v = r.verdict;
  const perms = r.permissions.length
    ? r.permissions.slice(0, 14).map((p) => `<li><code>${esc(p)}</code></li>`).join('')
    : '<li class="muted">разрешения не прочитались</li>';

  const rows = [
    ['Файл', `${esc(r.fileName)} · ${r.sizeMB} МБ`],
    ['Пакет', r.packageName ? `<code>${esc(r.packageName)}</code>` : '<span class="muted">не определён</span>'],
    ['Файлов внутри', String(r.entries)],
    ['Архитектуры', r.archs.length ? r.archs.map(esc).join(', ') : 'нет нативных библиотек'],
    ['Движок', r.engines.join(', ')],
    ['DEX-файлов', String(r.dexFiles)],
    ['OpenXR', r.openxr ? 'да' : 'нет'],
    ['Meta / Oculus SDK', r.meta ? 'да' : 'нет'],
    ['Метаданные IL2CPP', r.metadataState ? esc(r.metadataState) : '—'],
  ];

  ui.result.innerHTML = `
    <div class="verdict verdict-${v.level}">
      <div class="verdict-badge">${v.canRun ? 'запускается' : 'не запустится здесь'}</div>
      <h2>${esc(v.title)}</h2>
      <p>${esc(v.text)}</p>
      <p class="why"><b>Причина:</b> ${esc(v.why)}</p>
    </div>

    <div class="card">
      <h3>Что внутри файла</h3>
      <dl class="facts">
        ${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join('')}
      </dl>
    </div>

    <div class="card">
      <h3>Разрешения (${r.permissions.length})</h3>
      <ul class="perms">${perms}</ul>
    </div>

    ${r.biggest.length ? `
    <div class="card">
      <h3>Самые крупные файлы</h3>
      <ul class="perms">
        ${r.biggest.map((b) => `<li><code>${esc(b.name)}</code> — ${b.mb} МБ</li>`).join('')}
      </ul>
    </div>` : ''}

    ${r.manifestError ? `<p class="muted small">Манифест: ${esc(r.manifestError)}</p>` : ''}
  `;
  ui.result.hidden = false;
}

async function handleFile(file) {
  if (!file) return;
  setStatus(`разбираю ${file.name}…`);
  try {
    const report = await inspectApk(file, (msg) => setStatus(`${msg}…`));
    render(report);
    setStatus('');
  } catch (err) {
    setStatus('');
    ui.result.hidden = false;
    ui.result.innerHTML = `
      <div class="verdict verdict-error">
        <div class="verdict-badge">ошибка</div>
        <h2>Не получилось прочитать файл</h2>
        <p>${esc(err.message || String(err))}</p>
        <p class="muted small">Нужен именно APK (ZIP). Если файл с другого сайта «перепакован» — он может быть битым.</p>
      </div>`;
  }
}

if (ui.pick && ui.input) {
  ui.pick.addEventListener('click', () => ui.input.click());
  ui.input.addEventListener('change', () => handleFile(ui.input.files?.[0]));
}

['dragenter', 'dragover'].forEach((ev) => {
  if (!ui.drop) return;
  ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.add('over'); });
});
['dragleave', 'drop'].forEach((ev) => {
  if (!ui.drop) return;
  ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.remove('over'); });
});
if (ui.drop) {
  ui.drop.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));
}

if (ui.release) {
  ui.release.addEventListener('click', () => {
    const url = 'https://github.com/Belopus228/Twinslop/releases/tag/hands';
    if (window.TwinslopApp && typeof window.TwinslopApp.openUrl === 'function') {
      window.TwinslopApp.openUrl(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  });
}
