import { load, save, reset, DEFAULTS } from '../shared/settings.js';

const $ = (id) => document.getElementById(id);

const el = {
  swap: $('swap'),
  sens: $('sens'),
  dead: $('dead'),
  inv: $('inv'),
  vib: $('vib'),
  wake: $('wake'),
  lblSens: $('lblSens'),
  lblDead: $('lblDead'),
  pvHandL: $('pvHandL'),
  pvHandR: $('pvHandR'),
  pvStickL: $('pvStickL'),
  pvStickR: $('pvStickR'),
  reset: $('reset'),
};

let s = load();

function preview() {
  if (!el.pvHandL) return;
  if (s.swap) {
    el.pvHandL.textContent = 'правая рука';
    el.pvHandR.textContent = 'левая рука';
    el.pvStickL.classList.add('swap');
    el.pvStickR.classList.add('swap');
  } else {
    el.pvHandL.textContent = 'левая рука';
    el.pvHandR.textContent = 'правая рука';
    el.pvStickL.classList.remove('swap');
    el.pvStickR.classList.remove('swap');
  }
}

function paint() {
  el.swap.checked = s.swap;
  el.sens.value = String(s.sens);
  el.dead.value = String(s.dead);
  el.inv.checked = s.inv;
  el.vib.checked = s.vib;
  el.wake.checked = s.wake;
  el.lblSens.textContent = `${Number(s.sens).toFixed(1)}×`;
  el.lblDead.textContent = Number(s.dead).toFixed(2);
  preview();
}

function commit(patch) {
  s = save({ ...s, ...patch });
  paint();
}

el.swap.addEventListener('change', () => commit({ swap: el.swap.checked }));
el.sens.addEventListener('input', () => commit({ sens: Number(el.sens.value) }));
el.dead.addEventListener('input', () => commit({ dead: Number(el.dead.value) }));
el.inv.addEventListener('change', () => commit({ inv: el.inv.checked }));
el.vib.addEventListener('change', () => {
  commit({ vib: el.vib.checked });
  if (s.vib && navigator.vibrate) navigator.vibrate(12);
});
el.wake.addEventListener('change', () => commit({ wake: el.wake.checked }));

el.reset.addEventListener('click', () => {
  s = reset();
  paint();
  if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
});

// вернулись из другой страницы — перечитали (могли поменять в другом месте)
window.addEventListener('pageshow', () => { s = load(); paint(); });

document.documentElement.dataset.sens = String(DEFAULTS.sens);
paint();
