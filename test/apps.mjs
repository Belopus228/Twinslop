// Проверка логики экрана «Приложения»: вердикты, фильтр, сортировка.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/apps/logic.js'],
  bundle: true,
  format: 'esm',
  outfile: '/tmp/apps.logic.mjs',
  logLevel: 'error',
});

const { verdictFor, filterApps, sortApps, summarize, OWN_PACKAGE } = await import('/tmp/apps.logic.mjs');

const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok  ' + msg);
};

const own = { package: OWN_PACKAGE, label: 'Twinslop Hands', permissions: [] };
const vrApp = {
  package: 'com.playgilla.gilla',
  label: 'Gilla',
  permissions: ['android.permission.INTERNET', 'org.khronos.openxr.permission.OPENXR', 'android.permission.RECORD_AUDIO'],
};
const plain = { package: 'com.example.notes', label: 'Заметки', permissions: ['android.permission.CAMERA'] };
const system = { package: 'com.android.settings', label: 'Настройки', system: true, permissions: [] };

const vOwn = verdictFor(own);
assert(vOwn.level === 'own' && vOwn.launch === true, 'своё приложение помечено и запускаемо');

const vVr = verdictFor(vrApp);
assert(vVr.level === 'vr', 'VR-приложение распознано по разрешению OpenXR');
assert(vVr.launch === false, 'VR-приложению честно отказано в запуске');
assert(vVr.details.some((p) => p.includes('openxr')), 'показаны VR-разрешения как причина');

const vPlain = verdictFor(plain);
assert(vPlain.level === 'app', 'обычное приложение распознано');
assert(vPlain.launch === true, 'обычное приложение запускается системой');
assert(vPlain.attach === false, 'attach для чужого процесса запрещён во всех случаях');

assert(verdictFor(plain).attach === false && verdictFor(vrApp).attach === false && verdictFor(own).attach === false,
  '«прицепиться» нельзя ни к одному приложению');

const apps = [plain, system, vrApp, own];
const filtered = filterApps(apps, 'замет');
assert(filtered.length === 1 && filtered[0].package === 'com.example.notes', 'поиск по названию работает');
assert(filterApps(apps, 'gilla').length === 1, 'поиск по пакету/имени работает');
assert(filterApps(apps, '   ').length === 4, 'пустой запрос возвращает всё');

const sorted = sortApps(apps);
assert(sorted[sorted.length - 1].system === true, 'системные приложения уходят в конец');

const s = summarize(apps);
assert(s.total === 4 && s.vr === 1 && s.normal === 3, `сводка посчитана (${s.total}/${s.vr}/${s.normal})`);

console.log('\nВСЕ ПРОВЕРКИ ЭКРАНА ПРИЛОЖЕНИЙ ПРОЙДЕНЫ');
