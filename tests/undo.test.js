// Headless test of New chat + Undo toast with a fake LanguageModel.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, cdnPath, check } = require('./lib');

const PAGE = path.join(ROOT, 'index.html');
const KEY = 'gemini-nano-chat:history:v1';

const init = `
  window.__inits = [];
  class S extends EventTarget {
    constructor(o) { super(); this.n = o.initialPrompts.length; this.contextUsage = 10; this.contextWindow = 9216; }
    async prompt(t) { return '**echo** ' + t + ' (context ' + this.n + ')'; }
    destroy() { this.dead = true; }
  }
  window.LanguageModel = {
    availability: async () => 'available',
    async create(o) {
      window.__inits.push(o.initialPrompts.length);
      await new Promise((r) => setTimeout(r, 150)); // simulate load time
      return new S(o);
    },
  };
`;

async function send(page, text) {
  const before = await page.locator('.msg.ai:not(.pending)').count();
  await page.fill('#prompt', text);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.msg.ai:not(.pending)').length > n, before);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
  const errors = [];
  let dialogs = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    const file = cdnPath(route.request().url());
    route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('http://test.local/', (r) => r.fulfill({ body: fs.readFileSync(PAGE), contentType: 'text/html' }));
  await page.addInitScript(init);
  await page.goto('http://test.local/');

  await send(page, 'first');
  await send(page, 'second');

  // New chat: clears immediately, shows toast, no dialog.
  await page.click('#new-chat');
  const r = {};
  r.msgsAfterNew = await page.locator('.msg').count();
  r.toastVisible = await page.isVisible('#toast');
  r.toastText = await page.textContent('#toast-text');
  r.actionLabel = await page.textContent('#toast-action');
  r.storedAfterNew = await page.evaluate((k) => localStorage.getItem(k), KEY);
  await page.screenshot({ path: path.join(OUT, 'toast.png') });

  // Undo quickly, while the empty model is still loading.
  await page.click('#toast-action');
  await page.waitForTimeout(600);
  r.msgsAfterUndo = await page.locator('.msg').count();
  r.toastAfterUndo = await page.isVisible('#toast');
  r.storedAfterUndo = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY) || '[]').length;
  r.inits = await page.evaluate(() => window.__inits);
  await send(page, 'third');
  r.replyAfterUndo = (await page.locator('.msg.ai').last().textContent()).trim();

  // Sending after New chat closes the Undo window.
  await page.click('#new-chat');
  await send(page, 'fresh');
  r.toastAfterSend = await page.isVisible('#toast');
  r.msgsAfterFresh = await page.locator('.msg').count();

  // Close button works.
  await page.click('#new-chat');
  await page.click('#toast-close');
  r.toastAfterClose = await page.isVisible('#toast');

  // New chat on an empty chat shows no toast.
  await page.click('#new-chat');
  r.toastOnEmpty = await page.isVisible('#toast');

  r.dialogs = dialogs;
  r.errors = errors;
  check('New chat and Undo', r, { allowFalse: ['toastAfterUndo', 'toastAfterSend', 'toastAfterClose', 'toastOnEmpty'], equals: {
    msgsAfterNew: 0, toastText: 'Chat cleared.', actionLabel: 'Undo', storedAfterNew: null, msgsAfterUndo: 4, storedAfterUndo: 4,
    inits: [1, 1, 5], replyAfterUndo: (s) => s.includes('echo third'), msgsAfterFresh: 2, dialogs: 0,
    toastAfterUndo: false, toastAfterSend: false, toastAfterClose: false, toastOnEmpty: false,
  } });
  process.exitCode = process.exitCode || 0;
  await browser.close();
})();
