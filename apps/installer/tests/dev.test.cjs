// Development loop helpers: Marionette framing, argument parsing, and payload drift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const engine = require('../installer/engine.cjs');
const { decode, encode } = require('../scripts/marionette.cjs');
const { drift, parse } = require('../scripts/dev.cjs');
const { fixture } = require('./engine-fixture.cjs');

test('Marionette frames decode across chunk boundaries and multibyte text', () => {
  const frames = Buffer.concat([encode([1, 1, null, { value: 'ü' }]), encode([1, 2, null, { value: 2 }])]);
  const first = decode(frames.subarray(0, 9));
  assert.deepEqual(first.messages, []);
  const rest = decode(Buffer.concat([first.rest, frames.subarray(9)]));
  assert.deepEqual(rest.messages, [[1, 1, null, { value: 'ü' }], [1, 2, null, { value: 2 }]]);
  assert.equal(rest.rest.length, 0);
  assert.throws(() => decode(Buffer.from('x:{}')), /Malformed/);
});

test('dev arguments accept flags, inline values and separate values', () => {
  assert.deepEqual(parse(['shot', 'menu', '--native', '--size=1200x800', '--wait', '900', '--']),
    { command: 'shot', args: ['menu'], options: { native: true, size: '1200x800', wait: '900' } });
});

test('drift reports nothing until a payload file changes', async t => {
  const target = await fixture(t);
  const payload = path.join(target.root, 'payload');
  await fs.cp(path.join(__dirname, '..', 'payload'), payload, { recursive: true });
  const instance = { app: target.app, profile: target.profile, version: '1.23.4b' };
  assert.equal((await drift(instance, payload)).reason, 'not installed');
  await engine.install(target.app, target.profile, { ...target.options, payload });
  const clean = await drift(instance, payload);
  assert.equal(clean.current, true, clean.reason);
  await fs.appendFile(path.join(payload, 'zennia.uc.js'), '\n// edited\n');
  const edited = await drift(instance, payload);
  assert.equal(edited.current, false);
  assert.deepEqual(edited.changed, ['zennia.uc.js']);
});
