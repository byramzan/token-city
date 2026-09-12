// Мини-движок твинов для плавных анимаций камеры, построек и UI-объектов.

const active = new Set();

export const Ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/**
 * tween({ duration, delay, ease, onUpdate(k), onDone })
 * k идёт от 0 до 1. Возвращает объект с .cancel().
 */
export function tween({ duration = 500, delay = 0, ease = Ease.inOut, onUpdate, onDone }) {
  const tw = { elapsed: -delay, duration, ease, onUpdate, onDone, done: false };
  tw.cancel = () => { active.delete(tw); };
  active.add(tw);
  return tw;
}

export function updateTweens(dtMs) {
  for (const tw of [...active]) {
    tw.elapsed += dtMs;
    if (tw.elapsed < 0) continue;
    const t = Math.min(1, tw.elapsed / tw.duration);
    tw.onUpdate?.(tw.ease(t));
    if (t >= 1) {
      active.delete(tw);
      tw.onDone?.();
    }
  }
}
