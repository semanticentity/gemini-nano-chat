// Headless test of each onboarding state with a fake LanguageModel.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, cdnPath, check } = require('./lib');

const ALL = [];

const PAGE = path.join(ROOT, 'index.html');

// opts: api (bool), avail (string | 'hang' | 'throw'), brands, mobile, createDelay
function init(o) {
  return `
    (() => {
      const o = ${JSON.stringify(o)};
      if (o.brands) {
        Object.defineProperty(navigator, 'userAgentData', { get: () => ({ brands: o.brands, mobile: !!o.mobile }) });
      }
      if (o.noUad) Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
      window.__creates = 0;
      window.__sys = null;
      if (!o.api) return;
      class S extends EventTarget {
        constructor(){ super(); this.contextUsage = 50; this.contextWindow = 4096; }
        async prompt(){ return '**hi**'; }
        destroy(){}
      }
      window.LanguageModel = {
        availability(opts) {
          if (o.avail === 'hang') return new Promise(() => {});
          if (o.avail === 'throw') return Promise.reject(new Error('boom'));
          // Simulate MTP Chrome: plain options say unavailable, samplingMode says available.
          if (o.avail === 'mtp') return Promise.resolve(opts.samplingMode ? 'available' : 'unavailable');
          return Promise.resolve(o.avail);
        },
        async create(opts) {
          window.__creates++;
          window.__sys = opts.initialPrompts[0].content;
          opts.monitor && opts.monitor({ addEventListener: (t, fn) => { if (o.download) { fn({ loaded: 0.5 }); } } });
          await new Promise((r) => setTimeout(r, o.createDelay || 50));
          return new S();
        },
      };
    })();
  `;
}

let browser;
async function run(name, o, extra) {
  browser = browser || await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 800, height: 900 }, ...(o.ua ? { userAgent: o.ua } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    const url = route.request().url();
    const file = cdnPath(url);
    route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('http://test.local/', (r) => r.fulfill({ body: fs.readFileSync(PAGE), contentType: 'text/html' }));
  await page.addInitScript(init(o));
  await page.goto('http://test.local/');
  await page.waitForTimeout(o.avail === 'hang' ? 8600 : 400);
  const out = {
    name,
    // count() first: waiting on a card that isn't there would hit the 30s timeout.
    card: (await page.locator('.card').count()) ? await page.locator('.card').getAttribute('data-state') : null,
    title: (await page.locator('.card h3').count()) ? await page.locator('.card h3').textContent() : null,
    status: await page.textContent('#status'),
    creates: await page.evaluate(() => window.__creates),
    chips: await page.locator('.card .chip code').allTextContents(),
    fact: await page.evaluate(() => (window.__sys || '').split('\n')[0].slice(0, 110)),
  };
  if (extra) Object.assign(out, await extra(page));
  out.errors = errors;
  if (o.shot) await page.screenshot({ path: path.join(OUT, `ob-${name}.png`) });
  await ctx.close();
  ALL.push(out);
}

const CHROME = (v) => [{ brand: 'Google Chrome', version: String(v) }, { brand: 'Chromium', version: String(v) }];

(async () => {
  await run('available', { api: true, avail: 'available', brands: CHROME(150) });
  await run('mtp', { api: true, avail: 'mtp', brands: CHROME(150) });
  await run('downloadable', { api: true, avail: 'downloadable', brands: CHROME(150), download: true, createDelay: 300, shot: true }, async (page) => {
    await page.click('.card .actions .primary');
    await page.waitForTimeout(100);
    const during = await page.textContent('#status');
    await page.waitForTimeout(500);
    return { statusDuring: during, cardAfter: await page.locator('.card').count(), note: await page.locator('.msg.note').textContent().catch(() => null) };
  });
  await run('downloading', { api: true, avail: 'downloading', brands: CHROME(150) });
  await run('unavailable', { api: true, avail: 'unavailable', brands: CHROME(150), shot: true });
  await run('hang', { api: true, avail: 'hang', brands: CHROME(150) });
  await run('throw', { api: true, avail: 'throw', brands: CHROME(150) });
  await run('api-off', { api: false, brands: CHROME(150), shot: true }, async (page) => ({
    chips: await page.locator('.card .chip').count(),
  }));
  await run('old-chrome', { api: false, brands: CHROME(140), shot: true });
  await run('not-chrome', { api: false, brands: [{ brand: 'Chromium', version: '150' }] });
  await run('mobile', { api: false, brands: CHROME(150), mobile: true });
  // Sending a message after onboarding still works.
  await run('send-after', { api: true, avail: 'downloadable', brands: CHROME(150) }, async (page) => {
    await page.fill('#prompt', 'hello');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.msg.ai strong', { timeout: 3000 });
    return { cardAfter: await page.locator('.card').count(), reply: await page.locator('.msg.ai').innerHTML() };
  });
  // New chat on a loaded session reloads it without a click.
  await run('new-chat', { api: true, avail: 'available', brands: CHROME(150) }, async (page) => {
    await page.click('#new-chat');
    await page.waitForTimeout(300);
    return { createsAfterNew: await page.evaluate(() => window.__creates), statusAfterNew: await page.textContent('#status') };
  });
  // Browser-aware cases.
  const EDGE = (v) => [{ brand: 'Microsoft Edge', version: String(v) }, { brand: 'Chromium', version: String(v) }];
  await run('edge-off', { api: false, brands: EDGE(150) });
  await run('edge-available', { api: true, avail: 'available', brands: EDGE(150) });
  await run('edge-unavailable', { api: true, avail: 'unavailable', brands: EDGE(150), shot: true });
  await run('edge-downloadable', { api: true, avail: 'downloadable', brands: EDGE(150) }, async (page) => ({ intro: await page.locator('.card p').first().textContent() }));
  await run('chrome-identity', { api: true, avail: 'available', brands: CHROME(150) });
  await run('brave-with-api', { api: true, avail: 'available', brands: [{ brand: 'Brave', version: '150' }, { brand: 'Chromium', version: '150' }] });
  await run('ua-firefox', { api: false, noUad: true, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0' });
  await run('ua-edge', { api: false, noUad: true, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0' });
  await run('ua-iphone', { api: false, noUad: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });

  // Expected setup card (or none) for each browser and model state.
  const by = Object.fromEntries(ALL.map((o) => [o.name, o]));
  const card = (name, want, more = {}) => check(`onboarding: ${name}`, by[name], { equals: { card: want, ...more } });
  card('available', null, { creates: 1, fact: (f) => f.includes('Gemini Nano') });
  card('mtp', null, { creates: 1 });
  card('downloadable', 'downloadable', { statusDuring: (s) => /Downloading model: 50%/.test(s), cardAfter: 0, note: (n) => /ready/.test(n) });
  card('downloading', 'downloading');
  card('unavailable', 'unavailable', { chips: (c) => c.includes('chrome://on-device-internals') });
  card('hang', 'stalled');
  card('throw', 'check-failed');
  card('api-off', 'api-off', { chips: 2 });
  card('old-chrome', 'old-chrome');
  card('not-chrome', 'not-chrome');
  card('mobile', 'mobile');
  card('send-after', 'downloadable', { cardAfter: 0, reply: (h) => h.includes('<strong>hi</strong>') });
  card('new-chat', null, { createsAfterNew: 2 });
  card('edge-off', 'edge-off', { chips: ['edge://flags'] });
  card('edge-available', null, { fact: (f) => f.includes('Microsoft builds into the Edge') });
  card('edge-unavailable', 'unavailable', { chips: ['edge://on-device-internals', 'edge://flags'] });
  card('edge-downloadable', 'downloadable', { intro: (s) => s.includes('20 GB') });
  card('chrome-identity', null, { fact: (f) => f.includes('Gemini Nano, the AI model built into Google Chrome') });
  card('brave-with-api', null, { fact: (f) => f.includes('built into this web browser') });
  card('ua-firefox', 'not-chrome');
  card('ua-edge', 'edge-off');
  card('ua-iphone', 'mobile');
  await browser.close();
  process.exit(process.exitCode || 0);
})();
