const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const content = path.join(__dirname, "../payload/content");
function load(file, name) {
  const scope = {};
  vm.runInNewContext(fs.readFileSync(path.join(content, file), "utf8"), scope, {
    filename: file,
  });
  return scope[name];
}
function clock() {
  let next = 0;
  const timers = new Map();
  return {
    timers,
    matchMedia: () => ({ matches: false }),
    setTimeout(fn) {
      timers.set(++next, fn);
      return next;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
}
test("one feature can stop without cancelling another feature in the same window", () => {
  const window = clock();
  const motion = load("shared/motion.js", "ArcMotion");
  const sidebar = motion.install(window),
    downloads = motion.install(window);
  let calls = 0;
  sidebar.later(() => {
    throw Error("cancelled sidebar timer ran");
  }, 10);
  downloads.later(() => calls++, 10);
  sidebar.destroy();
  assert.equal(window.timers.size, 1);
  for (const [id, fn] of window.timers) {
    window.timers.delete(id);
    fn();
  }
  assert.equal(calls, 1);
  downloads.destroy();
  assert.equal(window.timers.size, 0);
});
test("destroy cancels animation and prevents delayed continuations from scheduling more work", async () => {
  const window = clock();
  const motion = load("shared/motion.js", "ArcMotion").install(window);
  let reject,
    cancelled = 0;
  const animation = {
    finished: new Promise((resolve, fail) => {
      reject = fail;
    }),
    cancel() {
      cancelled++;
      reject(Error("cancelled"));
    },
  };
  const element = { animate: () => animation };
  const finished = motion.animate(element, [], {});
  motion.destroy();
  await finished;
  assert.ok(cancelled > 0);
  assert.equal(
    motion.later(() => {}, 1),
    0,
  );
  await motion.animate(
    {
      animate() {
        throw Error("destroyed motion restarted");
      },
    },
    [],
    {},
  );
  assert.equal(window.timers.size, 0);
});
test("reduced motion skips visual animation but leaves nonvisual feedback timers working", async () => {
  const window = clock();
  window.matchMedia = () => ({ matches: true });
  const motion = load("shared/motion.js", "ArcMotion").install(window);
  await motion.animate(
    {
      animate() {
        throw Error("animation should be skipped");
      },
    },
    [],
    {},
  );
  motion.later(() => {}, 1);
  assert.equal(window.timers.size, 1);
  motion.destroy();
});
function widthFixture(prefs) {
  const listeners = new Map(),
    values = new Map();
  const toolbox = {
    style: { setProperty: (key, value) => values.set(key, value) },
    setAttribute: (key, value) => values.set(key, value),
  };
  const window = {
    document: { getElementById: () => toolbox },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      assert.equal(listeners.get(type), fn);
      listeners.delete(type);
    },
  };
  const feature = load("features/sidebar/width.js", "ArcSidebarWidth").install(
    window,
    { Services: { prefs } },
  );
  return { feature, toolbox, listeners, values };
}
test("initial sidebar width is set once and subsequent windows preserve the user width", () => {
  let initialized = false;
  const prefs = {
    getBoolPref: () => initialized,
    setBoolPref: (key, value) => {
      initialized = value;
    },
  };
  const first = widthFixture(prefs);
  assert.equal(first.toolbox.style.width, "264px");
  assert.equal(first.values.get("--zen-sidebar-width"), "264px");
  const second = widthFixture(prefs);
  assert.equal(second.toolbox.style.width, undefined);
  first.feature.destroy();
  second.feature.destroy();
  assert.equal(first.listeners.size, 0);
  assert.equal(second.listeners.size, 0);
});
test("only primary-button double-clicks on the native splitter are intercepted", () => {
  const { feature, listeners } = widthFixture({ getBoolPref: () => true });
  let blocked = 0;
  const event = {
    button: 0,
    target: { id: "zen-sidebar-splitter" },
    preventDefault: () => blocked++,
    stopImmediatePropagation: () => blocked++,
  };
  const handler = listeners.get("dblclick");
  handler({ ...event, button: 1 });
  handler({ ...event, target: { id: "other" } });
  assert.equal(blocked, 0);
  handler(event);
  assert.equal(blocked, 2);
  feature.destroy();
});
test("stylesheet entrypoint imports existing local styles exactly once", () => {
  const css = fs.readFileSync(path.join(content, "../arc.css"), "utf8");
  const imports = [
    ...css.matchAll(/@import url\("chrome:\/\/arc-ui\/content\/([^"\n]+)"\);/g),
  ].map((match) => match[1]);
  assert.ok(imports.length > 0);
  assert.equal(new Set(imports).size, imports.length);
  for (const file of imports) {
    assert.ok(fs.readFileSync(path.join(content, file), "utf8").trim(), file);
    assert.ok(!file.includes(".."));
  }
});
