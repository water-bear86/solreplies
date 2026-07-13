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

function loadAppScript(options = {}) {
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
    location: { href: `http://localhost/${options.search || ''}`, search: options.search || '' },
    navigator: {},
    screen: { width: 1280, height: 800 },
    URLSearchParams,
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

test('browser app preloads a Tweet URL from query parameters', () => {
  const tweetUrl = 'https://x.com/context/status/123';
  const { elements } = loadAppScript({ search: `?tweetUrl=${encodeURIComponent(tweetUrl)}` });

  assert.equal(elements.get('targetInput').value, tweetUrl);
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
  const openRouterCall = calls.at(-1);
  assert.equal(openRouterCall.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(openRouterCall.init.headers.Authorization, 'Bearer test-secret');
});

test('reply API enriches tweet URL prompts with oEmbed tweet text', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-secret';
  const handler = require('../api/reply.js');
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://publish.x.com/oembed')) {
      return {
        ok: true,
        async json() {
          return {
            author_name: 'Context Account',
            html:
              '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Solana builders need sharper context &amp; better replies.</p>&mdash; Context Account (@context) <a href="https://x.com/context/status/1">May 31, 2026</a></blockquote>',
          };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: ' Context-aware model reply ' } }],
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
    await handler({ method: 'POST', body: { tweetUrl: 'https://x.com/context/status/1' } }, res);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.text, 'Context-aware model reply');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/publish\.x\.com\/oembed\?/);

  const openRouterBody = JSON.parse(calls[1].init.body);
  const userMessage = openRouterBody.messages.find((message) => message.role === 'user').content;
  assert.match(userMessage, /Tweet context/i);
  assert.match(userMessage, /Context Account/);
  assert.match(userMessage, /Solana builders need sharper context & better replies\./);
  assert.doesNotMatch(userMessage, /<blockquote|&amp;/);
});

test('reply prompts instruct the model to return only the written reply', () => {
  const handler = require('../api/reply.js');
  const originalRandom = Math.random;

  try {
    Math.random = () => 0.01;
    const premium = handler._private.getVariant();
    Math.random = () => 0.5;
    const defaultVariant = handler._private.getVariant();

    for (const variant of [premium, defaultVariant]) {
      assert.match(variant.systemPrompt, /Return only the written reply/i);
      assert.match(variant.systemPrompt, /Do not include/i);
      assert.match(variant.systemPrompt, /constraint/i);
      assert.match(variant.systemPrompt, /explanation/i);
      assert.match(variant.defaultPrompt, /Only return the reply text/i);
      assert.match(variant.tweetPrompt('https://x.com/a/status/1'), /Only return the reply text/i);
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('PWA manifest and service worker are wired for home-screen install', () => {
  const html = read('index.html');

  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /href="\/privacy\.html"/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/service-worker\.js'\)/);

  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Solana Reply Generator');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));

  const serviceWorker = read('service-worker.js');
  assert.match(serviceWorker, /install/);
  assert.match(serviceWorker, /fetch/);
  assert.match(serviceWorker, /\/srgmark\.png/);
  assert.match(serviceWorker, /\/srgwordmark\.png/);
});

test('supplied brand assets are wired into the app bundle', () => {
  const html = read('index.html');
  const build = read('build.js');

  assert.match(html, /src="\/srgmark\.png"/);
  assert.match(html, /src="\/srgwordmark\.png"/);
  assert.match(build, /'srgmark\.png'/);
  assert.match(build, /'srgwordmark\.png'/);
  assert.ok(fs.statSync(path.join(root, 'srgmark.png')).size > 0);
  assert.ok(fs.statSync(path.join(root, 'srgwordmark.png')).size > 0);
});

test('privacy policy discloses extension data use and providers', () => {
  const privacy = read('privacy.html');

  assert.match(privacy, /Privacy Policy/);
  assert.match(privacy, /Effective date: June 1, 2026/);
  assert.match(privacy, /We do not intentionally save user data/);
  assert.match(privacy, /We do not intentionally store generated replies/);
  assert.match(privacy, /Tweet\/X URL or tweet ID/);
  assert.match(privacy, /OpenRouter/);
  assert.match(privacy, /X \/ Twitter oEmbed/);
  assert.match(privacy, /Vercel/);
  assert.match(privacy, /contextMenus/);
  assert.match(privacy, /tabs/);
  assert.match(privacy, /Chrome Web Store User Data Policy/);
});

test('Chrome extension manifest defines a Manifest V3 context-menu extension', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'service_worker.js');
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.host_permissions.includes('https://solanareplygenerator.lol/*'));
});

function loadExtensionCore() {
  const context = { URL, URLSearchParams };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('extension/reply-generator-core.js'), context);
  return context.SolReplyExtension;
}

test('Chrome extension extracts a tweet target from right-click context', () => {
  const extension = loadExtensionCore();

  assert.deepEqual(
    JSON.parse(JSON.stringify(extension.getTweetTarget({
      linkUrl: 'https://x.com/water/status/1234567890?s=20',
      pageUrl: 'https://example.com/',
    }))),
    {
      sourceUrl: 'https://x.com/water/status/1234567890?s=20',
      tweetId: '1234567890',
      tweetUrl: 'https://x.com/i/status/1234567890',
    }
  );
});

test('Chrome extension context menu creates a generated X reply intent', async () => {
  const extension = loadExtensionCore();
  const openedTabs = [];
  const fetchCalls = [];

  const result = await extension.handleContextMenuClick(
    {
      menuItemId: extension.MENU_ID,
      linkUrl: 'https://x.com/water/status/1234567890',
    },
    {},
    {
      fetch: async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        return {
          ok: true,
          async json() {
            return { text: 'Generated contextual reply' };
          },
        };
      },
      openTab: async (url) => openedTabs.push(url),
    }
  );

  assert.equal(result.action, 'open-reply-intent');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://solanareplygenerator.lol/api/reply');
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), {
    tweetUrl: 'https://x.com/i/status/1234567890',
    tweetId: '1234567890',
  });
  assert.equal(openedTabs.length, 1);

  const intentUrl = new URL(openedTabs[0]);
  assert.equal(intentUrl.origin + intentUrl.pathname, 'https://x.com/intent/post');
  assert.equal(intentUrl.searchParams.get('in_reply_to'), '1234567890');
  assert.match(intentUrl.searchParams.get('text'), /Generated contextual reply/);
});
