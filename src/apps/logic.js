/**
 * Логика экрана «Приложения на телефоне» — без DOM, чтобы тестировалась в Node.
 *
 * app = { package, label, system, permissions: string[], targetSdk, category }
 */

export const OWN_PACKAGE = 'ai.arena.twinslop';

const VR_PERMISSIONS = [
  'org.khronos.openxr.permission.OPENXR',
  'org.khronos.openxr.permission.OPENXR_SYSTEM',
  'com.oculus.permission.USE_ANCHOR_API',
  'com.oculus.permission.HAND_TRACKING',
];

/**
 * Что реально произойдёт, если нажать «Запустить».
 * launch  — откроется ли вообще
 * attach  — можно ли «прицепиться» и подменить ввод/картинку
 */
export function verdictFor(app) {
  if (!app || !app.package) {
    return { level: 'unknown', launch: false, attach: false, title: 'Неизвестное приложение', text: '' };
  }

  if (app.package === OWN_PACKAGE) {
    return {
      level: 'own',
      launch: true,
      attach: false,
      title: 'Это мы сами',
      text: 'Наш APK запускается системой как обычное приложение. Цепляться к себе смысла нет.',
    };
  }

  const vr = (app.permissions || []).some((p) => VR_PERMISSIONS.includes(p));
  const perms = app.permissions || [];
  const sandbox = 'Android не даёт читать чужую память и подменять чужой ввод: приложение живёт в своей песочнице (UID, SELinux). Нужен root — с ним это уже не «эмулятор», а инструмент взлома.';

  if (vr) {
    return {
      level: 'vr',
      launch: false,
      attach: false,
      title: 'VR-приложение (OpenXR / Meta)',
      text: `Запрошены VR-разрешения. На телефоне нет OpenXR-рантайма и сервисов Meta, поэтому приложение упадёт на старте — запускать бессмысленно, а «эмулировать» нечего: ему нужен шлем, а не экран.`,
      details: perms.filter((p) => VR_PERMISSIONS.includes(p)),
    };
  }

  return {
    level: 'app',
    launch: true,
    attach: false,
    title: 'Обычное приложение',
    text: `Запустится — это обычный startActivity. Но прицепиться к его процессу нельзя: ${sandbox}`,
    details: [],
  };
}

export function filterApps(apps, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return apps;
  return apps.filter((a) =>
    (a.label || '').toLowerCase().includes(q) || (a.package || '').toLowerCase().includes(q));
}

export function sortApps(apps) {
  return apps.slice().sort((a, b) => {
    if (!!a.system !== !!b.system) return a.system ? 1 : -1;
    return String(a.label || '').localeCompare(String(b.label || ''), 'ru');
  });
}

export function summarize(apps) {
  const vr = apps.filter((a) => verdictFor(a).level === 'vr').length;
  return { total: apps.length, vr, normal: apps.length - vr };
}
