// Headless test of chat saving with a fake LanguageModel.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, cdnPath, check } = require('./lib');

const PAGE = path.join(ROOT, 'index.html');

// The fake records initialPrompts and replies with how many prompts it saw.
// quota: create() throws QuotaExceededError if initialPrompts is longer than this.
const init = (quota) => `
  window.__inits = [];
  class S extends EventTarget {
    constructor(o) { super(); this.n = o.initialPrompts.length; this.contextUsage = 10; this.contextWindow = 4096; }
    async prompt(t) { return '**echo** ' + t + ' (context ' + this.n + ')'; }
    destroy() {}
  }
  window.LanguageModel = {
    availability: async () => 'available',
    async create(o) {
      window.__inits.push(o.initialPrompts.map((p) => p.role).join(','));
      if (o.initialPrompts.length > ${quota}) {
        const e = new DOMException('too long', 'QuotaExceededError'); throw e;
      }
      return new S(o);
    },
  };
`;

async function setup(browser, quota = 999) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    const file = cdnPath(route.request().url());
    route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('http://test.local/', (r) => r.fulfill({ body: fs.readFileSync(PAGE), contentType: 'text/html' }));
  await page.addInitScript(init(quota));
  return { ctx, page, errors };
}

async function send(page, text) {
  const before = await page.locator('.msg.ai:not(.pending)').count();
  await page.fill('#prompt', text);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.msg.ai:not(.pending)').length > n, before);
}

(async () => {
  const browser = await chromium.launch();

  // 1. Chat, reload, check bubbles and model context come back.
  {
    const { page, errors } = await setup(browser);
    await page.goto('http://test.local/');
    await send(page, 'first');
    await send(page, 'second');
    await page.reload();
    await page.waitForTimeout(400);
    const restored = await page.locator('.msg').count();
    const boldRestored = await page.locator('.msg.ai strong').count();
    const inits = await page.evaluate(() => window.__inits);
    await send(page, 'third');
    const lastReply = await page.locator('.msg.ai').last().textContent();
    check('saved chat: reload restores messages and model memory', { restored, boldRestored, inits, lastReply, errors }, { equals: { restored: 4, boldRestored: 2, inits: ['system,user,assistant,user,assistant'], lastReply: (s) => s.includes('echo third') } });

    // 2. New chat clears screen and storage.
    await page.click('#new-chat');
    await page.waitForTimeout(300);
    const afterNew = await page.locator('.msg').count();
    const stored = await page.evaluate(() => localStorage.getItem('gemini-nano-chat:history:v1'));
    await page.reload();
    await page.waitForTimeout(400);
    check('saved chat: New chat clears screen and storage', { afterNew, stored, afterReload: await page.locator('.msg').count(), emptyVisible: await page.isVisible('#empty') }, { equals: { afterNew: 0, stored: null, afterReload: 0 } });
  }

  // 3. Saved chat too long for the model: falls back to fewer messages.
  {
    const { page, errors } = await setup(browser, 3);
    await page.goto('http://test.local/');
    await page.evaluate(() => {
      const h = [];
      for (let i = 0; i < 10; i++) h.push({ role: 'user', content: 'q' + i }, { role: 'assistant', content: 'a' + i });
      localStorage.setItem('gemini-nano-chat:history:v1', JSON.stringify(h));
    });
    await page.reload();
    await page.waitForTimeout(500);
    check('saved chat: too long for memory falls back to fewer messages', { shown: await page.locator('.msg').count(), inits: await page.evaluate(() => window.__inits), status: await page.textContent('#status'), errors }, { equals: { shown: 20, inits: (a) => JSON.stringify(a.map((s) => s.split(',').length)) === '[21,5,1]', status: (s) => s.startsWith('Ready') } });
  }

  // 4. Corrupt storage does not break the page.
  {
    const { page, errors } = await setup(browser);
    await page.goto('http://test.local/');
    await page.evaluate(() => localStorage.setItem('gemini-nano-chat:history:v1', '{not json'));
    await page.reload();
    await page.waitForTimeout(400);
    await send(page, 'still works');
    check('saved chat: corrupt storage is ignored', { msgs: await page.locator('.msg').count(), errors }, { equals: { msgs: 2 } });
  }

  await browser.close();
  process.exit(process.exitCode || 0);
})();
