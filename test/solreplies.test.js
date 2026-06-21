const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function extractInlineScript() {
  const html = read('index.html');
  const match = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
  assert.ok(match, 'index.html should contain the app inline script');
  return match[1];
}

function createElement(id) {
  return {
    id,
    value: '',
    textContent: id === 'reply' ? 'press execute reply' : '',
    className: '',
    disabled: false,
    style: {},
    events: {},
    classList: {
      add() {},
      remove() {},
    },
    appendChild() {},
    remove() {},
    getContext() {
      return {
        fillRect() {},
        fillText() {},
      };
    },
    addEventListener(type, handler) {
      this.events[type] = handler;
    },
    click() {
      if (this.events.click) this.events.click();
    },
  };
}

function loadAppScript() {
  const ids = [
    'matrix',
    'cardWrap',
    'btn',
    'targetInput',
    'reply',
    'replyMeta',
    'statReplies',
    'statFollows',
    'statGas',
    'txStatus',
    'loadingBar',
    'loadingFill',
    'celebration',
    'replyBtn',
    'installBtn',
  ];
  const elements = new Map(ids.map((id) => [id, createElement(id)]));
  const timers = [];
  const context = {
    console,
    document: {
      body: { innerHTML: '' },
      createElement: (tag) => createElement(tag),
      getElementById: (id) => elements.get(id),
    },
    location: { href: 'http://localhost/' },
    navigator: {},
    screen: { width: 1280, height: 800 },
    window: {
      innerWidth: 420,
      innerHeight: 700,
      opener: {},
      top: {},
      addEventListener() {},
      close() {},
      focus() {},
      onblur: null,
      onload: null,
      open() {},
    },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout(fn, delay) {
      timers.push({ fn, delay, cleared: false });
      return timers.length - 1;
    },
    clearTimeout(id) {
      if (timers[id]) timers[id].cleared = true;
    },
    AbortController: class {
      constructor() {
        this.signal = {};
      }
      abort() {}
    },
  };
  context.window.top = context.window;
  context.window.location = context.location;
  context.window.document = context.document;
  context.window.navigator = context.navigator;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(extractInlineScript(), context);
  timers.length = 0;
  return { context, elements, timers };
}

async function runPendingTimers(timers) {
  for (let i = 0; i < timers.length; i++) {
    const timer = timers[i];
    if (!timer.cleared) await timer.fn();
  }
}

test('generated replies are printed into the review window', async () => {
  const { context, elements, timers } = loadAppScript();
  context.generateReply = async () => ({
    text: 'Generated reviewable reply',
    legendary: false,
    premium: true,
  });

  assert.equal(elements.get('replyBtn').disabled, true);

  elements.get('btn').click();
  await runPendingTimers(timers);

  assert.equal(elements.get('reply').textContent, 'Generated reviewable reply');
  assert.equal(elements.get('replyBtn').disabled, false);
});

test('reply workflow asks for the tweet before generation and reply handoff', () => {
  const html = read('index.html');

  const inputIndex = html.indexOf('id="targetInput"');
  const generateIndex = html.indexOf('id="btn"');
  const replyIndex = html.indexOf('id="reply"');
  const replyButtonIndex = html.indexOf('id="replyBtn"');

  assert.notEqual(inputIndex, -1);
  assert.notEqual(generateIndex, -1);
  assert.notEqual(replyIndex, -1);
  assert.notEqual(replyButtonIndex, -1);
  assert.ok(inputIndex < generateIndex, 'tweet input should appear before the generate button');
  assert.ok(generateIndex < replyIndex, 'generated reply preview should appear after generation');
  assert.ok(replyIndex < replyButtonIndex, 'reply-to-tweet action should follow the preview');
  assert.match(html, /id="replyBtn"[^>]*disabled/);
  assert.doesNotMatch(html, /setTimeout\(\(\)\s*=>\s*btn\.click\(\),\s*500\)/);
});

test('browser app uses the local reply API instead of exposing OpenRouter secrets', () => {
  const html = read('index.html');

  assert.match(html, /fetch\(['"]\/api\/reply['"]/);
  assert.doesNotMatch(html, /__OR_KEY__|OPENROUTER_API_KEY|openrouter\.ai\/api|Authorization:\s*`Bearer/);
});

test('reply API returns model output without leaking the API key to clients', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-secret';
  const handler = require('../api/reply.js');
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: ' Fresh model reply ' } }],
        };
      },
    };
  };

  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  try {
    await handler({ method: 'POST', body: { tweetUrl: 'https://x.com/a/status/1' } }, res);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.text, 'Fresh model reply');
  assert.equal(res.payload.source, 'model');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-secret');
});

test('PWA manifest and service worker are wired for home-screen install', () => {
  const html = read('index.html');

  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/service-worker\.js'\)/);

  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Solana Reply Generator');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));

  const serviceWorker = read('service-worker.js');
  assert.match(serviceWorker, /install/);
  assert.match(serviceWorker, /fetch/);
});

test('supplied brand assets are wired into the app bundle', () => {
  const html = read('index.html');
  const build = read('build.js');

  assert.match(html, /src="\/srgmark\.jpeg"/);
  assert.match(html, /src="\/srgmasrjk\.jpeg"/);
  assert.match(build, /'srgmark\.jpeg'/);
  assert.match(build, /'srgmasrjk\.jpeg'/);
  assert.ok(fs.statSync(path.join(root, 'srgmark.jpeg')).size > 0);
  assert.ok(fs.statSync(path.join(root, 'srgmasrjk.jpeg')).size > 0);
});
