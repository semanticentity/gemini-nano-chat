// Headless test of tools inside the chat, with a fake model and mocked network.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, cdnPath, check } = require('./lib');

const fake = (o = {}) => `
  window.__routerSystems = [];
  window.__mainPrompts = [];
  window.__routerCalls = 0;
  const ROUTES = [
    [/18% of/, { tool: 'calculate', args: { expression: '0.18 * 2450' } }],
    [/broken math/, { tool: 'calculate', args: { expression: '2 + hello' } }],
    [/Lovelace|Eiffel|Turing/, (q) => ({ tool: 'wikipedia', args: { query: q.match(/Lovelace|Eiffel|Turing/)[0] } })],
    [/weather/, { tool: 'weather', args: { place: 'Austin' } }],
  ];
  class S extends EventTarget {
    constructor(o) { super(); this.sys = o.initialPrompts[0].content; this.router = this.sys.startsWith('You route'); this.contextUsage = 200; this.contextWindow = 9216; }
    clone() { return new S({ initialPrompts: [{ content: this.sys }] }); }
    async prompt(q, opts = {}) {
      await new Promise((r) => setTimeout(r, 20));
      if (opts.signal && opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (this.router) {
        window.__routerCalls++;
        if (${!!o.rejectSchema} && opts.responseConstraint) throw new DOMException('no schema', 'NotSupportedError');
        const m = q.split('New message: ').pop();
        const hit = ROUTES.find(([re]) => re.test(m));
        const v = hit ? (typeof hit[1] === 'function' ? hit[1](m) : hit[1]) : { tool: 'none', args: {} };
        return JSON.stringify(v);
      }
      window.__mainPrompts.push(q);
      return q.includes('[Result from') ? 'Answer **using** the tool.' : q.includes('chose not to send') ? 'Answer from memory.' : q.includes('tool failed') ? 'The tool failed, sorry.' : 'Plain answer.';
    }
    destroy() {}
  }
  window.LanguageModel = {
    availability: async () => 'available',
    async create(o) { const s = new S(o); if (s.router) window.__routerSystems.push(s.sys); return s; },
  };
`;

async function setup(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, colorScheme: o.dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  const net = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('dialog'); d.dismiss(); });
  await page.addInitScript(fake(o));
  await page.route('http://test.local/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    const file = p === '/' ? 'index.html' : p.slice(1);
    r.fulfill({ body: fs.readFileSync(path.join(ROOT, file)), contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    const f = cdnPath(route.request().url());
    route.fulfill({ body: fs.readFileSync(f), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  const cors = { 'access-control-allow-origin': '*' };
  await page.route('https://en.wikipedia.org/**', (r) => {
    net.push('wikipedia');
    const q = new URL(r.request().url()).searchParams.get('gsrsearch');
    r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ query: { pages: [{ title: q === 'Lovelace' ? 'Ada Lovelace' : q, extract: `${q} summary.`, fullurl: 'https://en.wikipedia.org/wiki/X' }] } }) });
  });
  await page.route('https://*.open-meteo.com/**', (r) => { net.push('open-meteo'); r.fulfill({ contentType: 'application/json', headers: cors, body: '{}' }); });
  await page.goto('http://test.local/');
  await page.waitForTimeout(400);
  return { page, errors, net };
}

async function send(page, text) {
  await page.fill('#prompt', text);
  await page.keyboard.press('Enter');
}
const waitReply = (page, n) => page.waitForFunction((k) => document.querySelectorAll('.msg.ai:not(.pending)').length >= k, n, { timeout: 8000 });
const lastMain = (page) => page.evaluate(() => window.__mainPrompts[window.__mainPrompts.length - 1] || '');
const chips = (page) => page.locator('.tool-use summary').allTextContents();

(async () => {
  const browser = await chromium.launch();
  const r = {};
  {
    const { page, errors, net } = await setup(browser);

    // 1. Local tool: no approval, result goes to the model.
    await send(page, 'What is 18% of 2,450?');
    await waitReply(page, 1);
    r.calcChip = (await chips(page))[0];
    r.calcPromptHasResult = (await lastMain(page)).includes('[Result from the Calculator tool: {"expression":"0.18 * 2450","result":441}]');
    r.calcReplyRendered = (await page.locator('.msg.ai').last().innerHTML()).includes('<strong>using</strong>');

    // 2. Plain chat: router says none, no chip.
    await send(page, 'Write a haiku about coffee.');
    await waitReply(page, 2);
    r.chipsAfterHaiku = (await chips(page)).length;
    const hp = await lastMain(page);
    r.haikuPromptPlain = hp.startsWith('Write a haiku about coffee.\n\n(Background note');
    r.stamp = hp.split('\n').pop();
    r.stampLooksRight = /^\(Background note, do not repeat: it is now \w{3}, \w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s[AP]M [A-Z]{2,5} \([A-Za-z_]+\/[A-Za-z_]+\)\.\)$/.test(r.stamp);
    r.routerSawStamp = await page.evaluate(() => !!window.__routerSystems.length);

    // 3. Web tool asks first. Allow once.
    await send(page, 'Who was Ada Lovelace?');
    await page.waitForSelector('.tool-ask');
    r.askText = await page.textContent('.tool-ask p');
    r.netBeforeAllow = net.length;
    await page.screenshot({ path: path.join(OUT, 'chat-ask.png') });
    await page.click('.tool-ask button:has-text("Allow once")');
    await waitReply(page, 3);
    r.wikiChip = (await chips(page))[1];
    r.netAfterAllow = net.slice();
    r.askGone = (await page.locator('.tool-ask').count()) === 0;

    // 4. Allow once means it asks again. Then Always allow.
    await send(page, 'Look up the Eiffel Tower.');
    await page.waitForSelector('.tool-ask');
    r.askedAgain = true;
    await page.click('.tool-ask button:has-text("Always allow")');
    await waitReply(page, 4);
    r.sitesSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('gemini-nano-chat:settings:v2')).tools.sites);
    await send(page, 'Tell me about Turing.');
    await waitReply(page, 5);
    r.noAskAfterAlways = (await page.locator('.tool-ask').count()) === 0 && (await chips(page)).length === 4;

    // 5. Don't send: nothing leaves, model told to answer from memory.
    await send(page, 'What is the weather like?');
    await page.waitForSelector('.tool-ask');
    await page.click('.tool-ask button:has-text("Don\'t send")');
    await waitReply(page, 6);
    r.declineChip = (await chips(page))[4];
    r.declineNoNetwork = !net.includes('open-meteo');
    r.declinePrompt = (await lastMain(page)).includes('chose not to send this to open-meteo.com');

    // 6. Stop while waiting for approval.
    await send(page, 'What is the weather today?');
    await page.waitForSelector('.tool-ask');
    await page.click('#send'); // Stop
    await page.waitForTimeout(200);
    r.stopBubble = await page.locator('.msg.ai').last().textContent();
    r.stopAskRemoved = (await page.locator('.tool-ask').count()) === 0;
    r.stopNoNetwork = !net.includes('open-meteo');

    // 7. Tool error: chip shows failure, model is told.
    await send(page, 'Do some broken math please.');
    await waitReply(page, 7);
    r.errorChip = (await chips(page)).slice(-1)[0];
    r.errorChipClass = await page.locator('.tool-use').last().getAttribute('class');
    r.errorPrompt = (await lastMain(page)).includes('[The Calculator tool failed:');
    await page.screenshot({ path: path.join(OUT, 'chat-tools.png'), fullPage: false });

    // 8. Reload: chips come back in place.
    await page.reload();
    await page.waitForTimeout(600);
    r.chipsAfterReload = (await chips(page)).length;
    r.orderAfterReload = await page.evaluate(() => [...document.querySelectorAll('#chat > .msg, #chat > .tool-use')].slice(0, 4).map((e) => e.className.split(' ')[0] + (e.classList.contains('user') ? ':user' : '')));

    // 9. Settings: turn off Calculator and remove the saved site.
    await page.click('#mode-btn');
    r.toolRows = await page.locator('.tool-item').count();
    r.siteRows = await page.locator('.site-row').count();
    await page.locator('.tool-item', { hasText: 'Calculator' }).locator('input').uncheck();
    await page.locator('.site-row button').click();
    await page.screenshot({ path: path.join(OUT, 'settings-tools.png') });
    await page.click('#settings-apply');
    await page.waitForTimeout(200);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gemini-nano-chat:settings:v2')).tools);
    r.savedTools = saved;
    await send(page, 'Who was Ada Lovelace?');
    await page.waitForSelector('.tool-ask'); // site removed, so it asks again
    r.askAgainAfterRemove = true;
    await page.click('.tool-ask button:has-text("Allow once")');
    await waitReply(page, 8);
    const lastSys = await page.evaluate(() => window.__routerSystems[window.__routerSystems.length - 1]);
    r.catalogDropsCalculator = !lastSys.includes('calculate:') && lastSys.includes('wikipedia:');

    // 10. Turn tools off entirely: router not called.
    await page.click('#mode-btn');
    await page.uncheck('#tools-enabled');
    r.listDimmed = (await page.getAttribute('#tool-list', 'class')).includes('off');
    await page.click('#settings-apply');
    const callsBefore = await page.evaluate(() => window.__routerCalls);
    await send(page, 'What is 18% of 2,450?');
    await waitReply(page, 9);
    r.noRoutingWhenOff = (await page.evaluate(() => window.__routerCalls)) === callsBefore;

    // 11. New chat clears chips too.
    await page.click('#new-chat');
    r.chipsAfterNewChat = await page.locator('.tool-use, .tool-ask').count();
    r.errors = errors;
  }

  // 12. JSON prompt skips tools; schema rejection falls back.
  {
    const { page, errors } = await setup(browser, { rejectSchema: true });
    await send(page, 'What is 18% of 2,450?');
    await waitReply(page, 1);
    r.fallbackChip = (await chips(page))[0];
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('gemini-nano-chat:settings:v2')) || { active: 'default', presets: [], sampling: 'auto', language: 'en' };
      s.presets.push({ id: 'j', name: 'J', prompt: 'x', format: 'json', schema: '{"type":"object"}' });
      s.active = 'j';
      localStorage.setItem('gemini-nano-chat:settings:v2', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => window.__routerCalls);
    await send(page, 'What is 18% of 2,450?');
    await waitReply(page, 2);
    r.jsonSkipsTools = (await page.evaluate(() => window.__routerCalls)) === before;
    r.errors2 = errors;
  }

  // Dark mode look.
  {
    const { page } = await setup(browser, { dark: true });
    await send(page, 'What is 18% of 2,450?');
    await waitReply(page, 1);
    await send(page, 'Who was Ada Lovelace?');
    await page.waitForSelector('.tool-ask');
    await page.screenshot({ path: path.join(OUT, 'chat-tools-dark.png') });
  }

  check('Tools in the chat', r, { equals: {
    calcChip: 'Used Calculator: 0.18 * 2450 = 441', chipsAfterHaiku: 1, netBeforeAllow: 0, netAfterAllow: ['wikipedia'],
    sitesSaved: ['en.wikipedia.org'], declineChip: 'Skipped Weather: not sent, you said no', stopBubble: 'Stopped.',
    errorChipClass: 'tool-use failed', chipsAfterReload: 6, toolRows: 8, siteRows: 1,
    savedTools: { enabled: true, off: ['calculate'], sites: [] }, chipsAfterNewChat: 0,
    fallbackChip: 'Used Calculator: 0.18 * 2450 = 441',
  } });
  await browser.close();
})();
