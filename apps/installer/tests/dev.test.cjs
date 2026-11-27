// Development loop helpers: Marionette framing, argument parsing, and payload drift.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const engine = require('../installer/engine.cjs');
const { Marionette, decode, encode } = require('../scripts/marionette.cjs');
const { drift, parse, pick } = require('../scripts/dev.cjs');
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
  assert.deepEqual(parse(['shot', 'menu', '--native', '--size=1200x800', '--wait', '900', '--setup=x=1', '--']),
    { command: 'shot', args: ['menu'], options: { native: true, size: '1200x800', wait: '900', setup: 'x=1' } });
});

test('Marionette surfaces session refusal and times out when NewSession stalls', async t => {
  let connections = 0;
  const server = net.createServer(socket => {
    const connection = ++connections;
    socket.write(encode({ applicationType: 'gecko', marionetteProtocol: 3 }));
    if (connection === 1) socket.once('data', () => {
      socket.write(encode([1, 1, { error: 'session not created', message: 'Already in use' }, null]));
    });
    socket.resume();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  await assert.rejects(Marionette.connect(port, { timeout: 2000 }), /session not created: Already in use/);
  assert.equal(connections, 1);
  await assert.rejects(Marionette.connect(port, { timeout: 250 }), /handshake timed out/);
  assert.equal(connections, 2);
});

test('Marionette closes a session when a command times out after the handshake', async t => {
  const server = net.createServer(socket => {
    socket.write(encode({ applicationType: 'gecko', marionetteProtocol: 3 }));
    socket.once('data', () => {
      socket.once('data', () => socket.write(encode([1, 2, null, {}])));
      socket.write(encode([1, 1, null, {}]));
    });
    socket.resume();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = await Marionette.connect(server.address().port, { timeout: 2000 });
  await assert.rejects(client.execute('return true', [], 100), /ExecuteScript timed out after 100 ms/);
  assert.equal(client.closed, true);
  await assert.rejects(client.execute('return true'), /connection closed/);
});

test('development instance selection refuses an app linked outside its version folder', async t => {
  const target = await fixture(t);
  const root = path.join(target.root, 'dev-zen');
  const versionPath = path.join(root, '1.23.4b');
  await fs.mkdir(versionPath, { recursive: true });
  await fs.symlink(target.app, path.join(versionPath, 'Zen'), 'junction');
  await assert.rejects(pick('1.23.4b', root), /symbolic link or junction/);
});

test('drift reports source and installed payload changes', async t => {
  const target = await fixture(t);
  const payload = path.join(target.root, 'payload');
  await fs.cp(path.join(__dirname, '..', 'payload'), payload, { recursive: true });
  const instance = { app: target.app, profile: target.profile, version: '1.23.4b' };
  const removedFile = path.join(payload, 'Local-Only.txt');
  await fs.writeFile(removedFile, 'removed later');
  assert.equal((await drift(instance, payload)).reason, 'not installed');
  await engine.install(target.app, target.profile, { ...target.options, payload });
  const clean = await drift(instance, payload);
  assert.equal(clean.current, true, clean.reason);
  await fs.appendFile(path.join(payload, 'zennia.uc.js'), '\n// edited\n');
  const edited = await drift(instance, payload);
  assert.equal(edited.current, false);
  assert.deepEqual(edited.changed, ['zennia.uc.js']);
  const installed = path.join(target.profile, 'chrome', engine.NAMES.root);
  await fs.copyFile(path.join(installed, 'zennia.uc.js'), path.join(payload, 'zennia.uc.js'));
  await fs.appendFile(path.join(installed, 'zennia.uc.js'), '\n// edited after install\n');
  assert.deepEqual((await drift(instance, payload)).changed, ['zennia.uc.js']);
  await fs.unlink(path.join(installed, 'zennia.uc.js'));
  await fs.unlink(removedFile);
  const missing = await drift(instance, payload);
  assert.deepEqual(missing.changed, ['zennia.uc.js']);
  assert.deepEqual(missing.removed, ['Local-Only.txt']);
  await fs.unlink(path.join(payload, 'zennia.cfg'));
  await fs.unlink(path.join(payload, 'zennia-autoconfig.js'));
  const missingLoaders = await drift(instance, payload);
  assert.deepEqual(missingLoaders.missingLoaders, ['zennia.cfg', 'zennia-autoconfig.js']);
  assert.deepEqual(missingLoaders.removed, ['zennia.cfg', 'zennia-autoconfig.js', 'Local-Only.txt']);
});
