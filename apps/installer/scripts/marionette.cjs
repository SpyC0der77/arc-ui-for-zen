// Minimal Marionette client for driving a development Zen from Node.
// Protocol: each message is `<byte length>:<JSON>`. Commands are
// [0, id, name, params]; responses are [1, id, error, result].
const net = require('node:net');

// Splits a receive buffer into complete messages and the unread remainder.
function decode(buffer) {
  const messages = [];
  let rest = buffer;
  for (;;) {
    const colon = rest.indexOf(0x3a);
    if (colon < 0) break;
    const length = Number(rest.subarray(0, colon).toString('ascii'));
    if (!Number.isInteger(length) || length < 0) throw new Error('Malformed Marionette frame');
    if (rest.length < colon + 1 + length) break;
    messages.push(JSON.parse(rest.subarray(colon + 1, colon + 1 + length).toString('utf8')));
    rest = rest.subarray(colon + 1 + length);
  }
  return { messages, rest };
}

function encode(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`${body.length}:`, 'ascii'), body]);
}

class Marionette {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.ready = new Promise((resolve, reject) => { this.handshake = { resolve, reject }; });
    socket.on('data', chunk => this.receive(chunk));
    socket.on('close', () => this.fail(new Error('Marionette connection closed')));
    socket.on('error', error => this.fail(error));
  }

  receive(chunk) {
    const { messages, rest } = decode(Buffer.concat([this.buffer, chunk]));
    this.buffer = rest;
    for (const message of messages) {
      if (!Array.isArray(message)) { this.handshake.resolve(message); continue; }
      const [, id, error, result] = message;
      const waiter = this.pending.get(id);
      if (!waiter) continue;
      this.pending.delete(id);
      if (error) waiter.reject(Object.assign(new Error(`${error.error}: ${error.message}`), { marionette: error }));
      else waiter.resolve(result);
    }
  }

  fail(error) {
    this.closed = true;
    this.handshake.reject(error);
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  // Connects to Marionette, retrying until the browser answers or the timeout passes.
  static async connect(port = 2828, { timeout = 30000 } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      try {
        const socket = await new Promise((resolve, reject) => {
          const s = net.connect({ host: '127.0.0.1', port }, () => resolve(s));
          s.once('error', reject);
          s.setTimeout(10000, () => s.destroy(new Error('Marionette handshake timed out')));
        });
        const client = new Marionette(socket);
        await client.ready;
        socket.setTimeout(0);
        await client.send('WebDriver:NewSession', { capabilities: {} });
        await client.send('Marionette:SetContext', { value: 'chrome' });
        return client;
      } catch (error) {
        if (Date.now() > end) throw new Error(`Marionette did not answer on port ${port}: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
  }

  send(name, params = {}) {
    if (this.closed) return Promise.reject(new Error('Marionette connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(encode([0, id, name, params]));
    });
  }

  // Runs chrome-context JavaScript as a function body; `return` sends a value back.
  async execute(script, args = []) {
    return (await this.send('WebDriver:ExecuteScript', { script, args })).value;
  }

  // PNG of the browser window's chrome and content (popups are separate windows).
  async screenshot() {
    return Buffer.from((await this.send('WebDriver:TakeScreenshot', { full: false, hash: false })).value, 'base64');
  }

  async close() {
    if (!this.closed) await this.send('WebDriver:DeleteSession').catch(() => {});
    this.socket.destroy();
  }
}

module.exports = { Marionette, decode, encode };
