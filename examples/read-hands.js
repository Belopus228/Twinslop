'use strict';

/**
 * Пример потребителя: читает состояние рук с контроллера и печатает его.
 *
 *   node examples/read-hands.js [http://localhost:3000]
 *
 * Запускай на том же устройстве, где сервер, либо в той же сети.
 * Дальше эти значения можно отдавать куда угодно: в игру, в OBS, в бота.
 */

const base = process.argv[2] || process.env.HANDS_URL || 'http://localhost:3000';

async function poll() {
  try {
    const res = await fetch(`${base}/api/state`);
    const s = await res.json();
    const f = (h) => `${h.x.toFixed(2)},${h.y.toFixed(2)} t=${h.trigger} g=${h.grip}`;
    process.stdout.write(`L[${f(s.L)}]  R[${f(s.R)}]  age=${s.age_ms}ms\n`);
  } catch (err) {
    console.error('нет связи:', err.message);
  }
}

// 20 Гц — достаточно для рук, не грузит телефон
setInterval(poll, 50);
console.log(`слушаю ${base}  (Ctrl+C — выход)`);
