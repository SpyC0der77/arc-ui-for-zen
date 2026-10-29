/* Timers and animations owned by one feature. Reduced motion skips animation, not the action. */
var ArcMotion = {
  install(window, dependencies = {}) {
    let destroyed = false;
    const timers = new Set(),
      animations = new Set();
    const reduced = () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const later = (fn, ms) => {
      if (destroyed) return 0;
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    };
    const clear = (id) => {
      window.clearTimeout(id);
      timers.delete(id);
    };
    const animate = (el, frames, options) => {
      if (destroyed || reduced()) return Promise.resolve();
      const a = el.animate(frames, options);
      animations.add(a);
      return a.finished
        .catch(() => {})
        .finally(() => {
          animations.delete(a);
          a.cancel();
        });
    };

    return {
      later,
      clear,
      animate,
      reduced,
      destroy() {
        destroyed = true;
        for (const timer of timers) window.clearTimeout(timer);
        for (const animation of animations) animation.cancel();
        timers.clear();
        animations.clear();
      },
    };
  },
};
