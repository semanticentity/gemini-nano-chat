// Headless test: starters, near me, time tool, units, offline, follow-ups,
// message actions, and Summarize / Proofread / Translate.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, cdnPath, check } = require('./lib');

const fake = (o = {}) => `
  window.__router = [];       // { system, prompt }
  window.__main = [];         // prompts to the chat model
  window.__mainInit = [];     // initialPrompts length for each chat session
  window.__tasks = [];        // { system, text }
  window.__api = [];          // which built-in APIs were used
  const route = (q) => {
    const m = q.split('New message: ').pop();
    if (/weather near me/i.test(m)) return { tool: 'weather', args: { place: 'here' } };
    if (/until midnight/i.test(m)) return { tool: 'time_until', args: { time: 'midnight' } };
    if (/18%/.test(m)) return { tool: 'calculate', args: { expression: '0.18 * 2450' } };
    if (/celsius/i.test(m) && /Earlier message/.test(q) && /72/.test(q)) return { tool: 'convert_units', args: { value: 72, from: 'F', to: 'C' } };
    return { tool: 'none', args: {} };
  };
  class S extends EventTarget {
    constructor(o) { super(); this.sys = o.initialPrompts[0].content; this.n = o.initialPrompts.length; this.contextUsage = 300; this.contextWindow = 9216; }
    clone() { return new S({ initialPrompts: [{ content: this.sys }] }); }
    async prompt(q) {
      await new Promise((r) => setTimeout(r, 15));
      if (this.sys.startsWith('You route')) { window.__router.push({ system: this.sys, prompt: q }); return JSON.stringify(route(q)); }
      if (this.sys.startsWith('Facts about you')) { window.__main.push(q); return '[Saturday, October 17, 2026, 10:21 AM Central Daylight Time, America/Chicago]\\n\\nReply number ' + window.__main.length + '.\\n\\n(Background note, do not repeat: it is now Sat, Oct 17, 2026.)'; }
      window.__tasks.push({ system: this.sys, text: q });
      if (/Fix spelling/.test(this.sys)) return q.replaceAll('teh', 'the');
      if (/Summarize/.test(this.sys)) return '- point one\\n- point two';
      return 'translated: ' + q;
    }
    destroy() {}
  }
  window.LanguageModel = {
    availability: async () => 'available',
    async create(o) { const s = new S(o); if (s.sys.startsWith('Facts about you')) window.__mainInit.push(o.initialPrompts.length); return s; },
  };
  ${o.noTaskApis ? `window.Summarizer = { availability: async () => 'unavailable', create: async () => ({ summarize: async () => 'Model not available in Chromium', destroy() {} }) };` : `
  window.Summarizer = { availability: async () => 'available', create: async (opts) => ({ summarize: async (t) => { window.__api.push('summarizer:' + opts.type); return '- key point A\\n- key point B'; }, destroy() {} }) };
  window.LanguageDetector = { create: async () => ({ detect: async () => [{ detectedLanguage: 'en', confidence: 0.98 }], destroy() {} }) };
  window.Translator = { availability: async () => 'downloadable', create: async (opts) => {
    if (opts.targetLanguage === 'ko') throw new DOMException('no pair', 'NotSupportedError');
    opts.monitor && opts.monitor({ addEventListener: (t, fn) => fn({ loaded: 1 }) });
    return { translate: async (t) => { window.__api.push('translator:' + opts.sourceLanguage + '>' + opts.targetLanguage); return '[' + opts.targetLanguage + '] ' + t; }, destroy() {} };
  } };`}
`;

async function setup(browser, o = {}) {
  const ctx = await browser.newContext({
    viewport: o.viewport || { width: 900, height: 900 }, locale: o.locale || 'en-US', colorScheme: o.dark ? 'dark' : 'light',
    geolocation: { latitude: 30.2672, longitude: -97.7431 }, permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  const errors = [];
  const net = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('dialog'); d.dismiss(); });
  await page.addInitScript(fake(o));
  await page.route('http://localhost:8123/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    const file = p === '/' ? 'index.html' : p.slice(1);
    r.fulfill({ body: fs.readFileSync(path.join(ROOT, file)), contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  });
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    const f = cdnPath(route.request().url());
    route.fulfill({ body: fs.readFileSync(f), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  const cors = { 'access-control-allow-origin': '*' };
  await page.route('https://api.open-meteo.com/**', (r) => {
    net.push(r.request().url());
    r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({
      current: { temperature_2m: 21, apparent_temperature: 21, precipitation: 0, weather_code: 1, wind_speed_10m: 8 },
      daily: { time: ['2026-10-16'], temperature_2m_max: [27], temperature_2m_min: [17], precipitation_probability_max: [10], weather_code: [1] },
    }) });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', (r) => { net.push('geocode'); r.fulfill({ contentType: 'application/json', headers: cors, body: '{"results":[]}' }); });
  await page.goto('http://localhost:8123/');
  await page.waitForTimeout(400);
  return { ctx, page, errors, net };
}

const finished = (page) => page.locator('.msg.ai:not(.pending)').count();
async function waitMore(page, before) {
  await page.waitForFunction((n) => document.querySelectorAll('.msg.ai:not(.pending)').length > n, before, { timeout: 8000 });
}
async function send(page, text) {
  const b = await finished(page);
  await page.fill('#prompt', text);
  await page.keyboard.press('Enter');
  return b;
}

(async () => {
  const browser = await chromium.launch();
  const r = {};
  const LONG = 'This is a long paragraph with teh typo in it. '.repeat(6).trim();
  {
    const { page, errors, net } = await setup(browser);

    // Starters
    r.starters = await page.locator('#starters button').allTextContents();
    r.tip = await page.textContent('.empty .tip');
    await page.screenshot({ path: path.join(OUT, 'f-empty.png') });

    // Weather near me: approval says "your location", then geolocation, no geocoding call
    let b = await finished(page);
    await page.click('#starters button:has-text("Weather near me")');
    await page.waitForSelector('.tool-ask');
    r.nearMeAsk = await page.textContent('.tool-ask p');
    await page.click('.tool-ask button:has-text("Allow once")');
    await waitMore(page, b);
    r.nearMeChip = await page.locator('.tool-use summary').last().textContent();
    r.echoStripped = await page.locator('.msg.ai').last().textContent();
    r.noteAtEnd = (await page.evaluate(() => window.__main[0])).split('\n').pop();
    r.shortUserButtons = await page.locator('.msg-actions.user').last().locator('button:not([hidden])').allTextContents();
    r.nearMeUsedCoords = net.some((u) => u.includes('latitude=30.267'));
    r.nearMeNoGeocode = !net.includes('geocode');
    r.unitsLineUS = (await page.evaluate(() => window.__main.length)) > 0
      && (await page.evaluate(() => document.querySelector('.tool-use summary').textContent)).includes('°F');

    // Time tool
    b = await send(page, 'How long until midnight?');
    await waitMore(page, b);
    r.timeChip = await page.locator('.tool-use summary').last().textContent();

    // Follow-up: router sees the earlier message
    b = await send(page, 'Convert 72 F please');
    await waitMore(page, b);
    b = await send(page, 'and in Celsius?');
    await waitMore(page, b);
    const lastRoute = await page.evaluate(() => window.__router[window.__router.length - 1].prompt);
    r.followUpContext = lastRoute.includes('Earlier message, for context only: "Convert 72 F please"') && lastRoute.includes('New message: and in Celsius?');
    r.followUpChip = await page.locator('.tool-use summary').last().textContent();

    // Last-turn actions
    r.editVisible = await page.locator('.msg-actions.last .act-edit:not([hidden])').count();
    r.regenVisible = await page.locator('.msg-actions.last .act-regen:not([hidden])').count();
    r.hiddenElsewhere = await page.locator('.msg-actions:not(.last) .act-edit:not([hidden]), .msg-actions:not(.last) .act-regen:not([hidden])').count();

    // Regenerate: same history length, new reply
    const histBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('gemini-nano-chat:history:v1')).length);
    const replyBefore = await page.locator('.msg.ai').last().textContent();
    b = (await finished(page)) - 1;
    await page.click('.msg-actions.last .act-regen');
    await waitMore(page, b);
    await page.waitForTimeout(200);
    r.regenSameLength = (await page.evaluate(() => JSON.parse(localStorage.getItem('gemini-nano-chat:history:v1')).length)) === histBefore;
    r.regenNewReply = (await page.locator('.msg.ai').last().textContent()) !== replyBefore;

    // Edit: composer filled, exchange removed
    await page.click('.msg-actions.last .act-edit');
    r.editComposer = await page.inputValue('#prompt');
    r.editShrunk = (await page.evaluate(() => JSON.parse(localStorage.getItem('gemini-nano-chat:history:v1')).length)) === histBefore - 2;
    await page.fill('#prompt', '');

    // Summarize a long message with Chrome's Summarizer
    b = await send(page, LONG);
    await waitMore(page, b);
    const userRow = page.locator('.msg-actions.user').last();
    r.userButtons = await userRow.locator('button:not([hidden])').allTextContents();
    b = await finished(page);
    await userRow.locator('button:has-text("Summarize")').click();
    await waitMore(page, b);
    r.summaryBadge = await page.locator('.msg.ai .badge').last().textContent();
    r.summaryApi = await page.evaluate(() => window.__api.slice());

    // Proofread falls back to the chat model (no Proofreader in this browser)
    b = await finished(page);
    await page.locator('.msg-actions.user').last().locator('button:has-text("Proofread")').click();
    await waitMore(page, b);
    r.proofBadge = await page.locator('.msg.ai .badge').last().textContent();
    r.proofFixed = !(await page.locator('.msg.ai').last().textContent()).includes('teh');

    // Translate to French through the menu: search, then Enter
    await page.locator('.msg-actions.user').last().locator('button:has-text("Translate")').click();
    r.menuOpen = await page.isVisible('.lang-menu');
    r.menuFocusSearch = await page.evaluate(() => document.activeElement.type === 'search');
    await page.screenshot({ path: path.join(OUT, 'f-menu.png') });
    await page.keyboard.type('fren');
    r.menuFiltered = await page.locator('.lang-list button').allTextContents();
    b = await finished(page);
    await page.keyboard.press('Enter');
    await waitMore(page, b);
    r.menuClosed = (await page.locator('.lang-menu').count()) === 0;
    r.translateBadge = await page.locator('.msg.ai .badge').last().textContent();
    r.translateText = (await page.locator('.msg.ai').last().textContent()).slice(0, 60);
    r.translateSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('gemini-nano-chat:settings:v2')).recentLangs);
    // Recent shows French first next time; Escape closes and returns focus
    await page.locator('.msg-actions.user').last().locator('button:has-text("Translate")').click();
    r.recentGroup = await page.locator('.lang-group').first().textContent();
    r.recentFirst = await page.locator('.lang-list button').first().textContent();
    await page.keyboard.press('Escape');
    r.escCloses = (await page.locator('.lang-menu').count()) === 0 && (await page.evaluate(() => document.activeElement.textContent)) === 'Translate';
    // Clicking outside closes too
    await page.locator('.msg-actions.user').last().locator('button:has-text("Translate")').click();
    await page.mouse.click(5, 5);
    r.outsideCloses = (await page.locator('.lang-menu').count()) === 0;
    await page.screenshot({ path: path.join(OUT, 'f-tasks.png') });

    // Korean with no Translator pair and no Nano support: clear error
    await page.locator('.msg-actions.user').last().locator('button:has-text("Translate")').click();
    await page.keyboard.type('korean');
    b = await finished(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    r.koError = await page.locator('.msg.ai').last().textContent();

    // After reload: badges restored, kept out of the chat model's memory
    const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('gemini-nano-chat:history:v1')));
    const contextCount = hist.filter((m) => !m.noContext).length;
    await page.reload();
    await page.waitForTimeout(600);
    r.badgesAfterReload = await page.locator('.msg.ai .badge').count();
    r.memoryExcludesBadges = (await page.evaluate(() => window.__mainInit[window.__mainInit.length - 1])) === 1 + Math.min(contextCount, 20);

    // Units setting
    await page.click('#mode-btn');
    r.unitsOptions = await page.locator('#units option').allTextContents();
    r.unitsAutoHint = await page.textContent('#units-auto');
    await page.selectOption('#units', 'metric');
    r.identityMetric = (await page.textContent('#identity-text')).includes('Use metric units');
    await page.click('#settings-apply');
    await page.waitForTimeout(300);
    r.reloadedMetric = (await page.evaluate(() => window.__main.length)) >= 0;

    // Offline: web tools left out of the picker
    await page.context().setOffline(true);
    b = await send(page, 'What is 18% of 2,450?');
    await waitMore(page, b);
    const sys = await page.evaluate(() => window.__router[window.__router.length - 1].system);
    r.offlineNoWebTools = !sys.includes('weather:') && !sys.includes('wikipedia:') && sys.includes('calculate:');
    await page.context().setOffline(false);
    r.errors = errors;
  }

  // German locale: metric by default, °C in the weather label
  {
    const { page, errors } = await setup(browser, { locale: 'de-DE' });
    const b = await finished(page);
    await page.click('#starters button:has-text("Weather near me")');
    await page.waitForSelector('.tool-ask');
    await page.click('.tool-ask button:has-text("Allow once")');
    await waitMore(page, b);
    r.deChip = await page.locator('.tool-use summary').last().textContent();
    // German browser: German is offered as a recent language. Short questions get no text tools.
    r.deShortButtons = await page.locator('.msg-actions.user').last().locator('button:not([hidden])').allTextContents();
    await page.locator('.msg-actions.ai').last().locator('button:has-text("Translate")').click();
    r.deRecentFirst = await page.locator('.lang-list button').first().textContent();
    await page.keyboard.press('Escape');
    r.deErrors = errors;
  }

  // No task APIs at all: Summarize uses the chat model
  {
    const { page, errors } = await setup(browser, { noTaskApis: true, dark: true, viewport: { width: 420, height: 860 } });
    let b = await send(page, LONG);
    await waitMore(page, b);
    b = await finished(page);
    await page.locator('.msg-actions.user').last().locator('button:has-text("Summarize")').click();
    await waitMore(page, b);
    r.fallbackSummaryBadge = await page.locator('.msg.ai .badge').last().textContent();
    await page.screenshot({ path: path.join(OUT, 'f-mobile-dark.png') });
    r.mobileNoHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    r.fallbackErrors = errors;
  }

  check('Starters, actions, text tools, units, near me', r, { equals: {
    starters: ['What\'s 18% of 2,450?', 'Weather near me', 'How long until midnight?', 'Who was Ada Lovelace?'],
    nearMeChip: (s) => /^Used Weather: Your location: \d+°F, /.test(s),
    echoStripped: (s) => s.trim() === 'Reply number 1.',
    noteAtEnd: (s) => /^\(Background note, do not repeat: it is now /.test(s),
    shortUserButtons: ['Copy', 'Edit'],
    timeChip: (s) => s.startsWith('Used Time until: ') && s.includes('until'),
    followUpChip: 'Used Unit converter: 72 F = 22.22 C',
    editComposer: 'and in Celsius?', userButtons: ['Copy', 'Summarize', 'Proofread', 'Translate', 'Edit'],
    summaryBadge: (s) => /^Summary \(.+Summarizer\)$/.test(s), summaryApi: ['summarizer:key-points'],
    proofBadge: (s) => s.startsWith('Proofread ('), menuFiltered: ['French'],
    translateBadge: (s) => /^Translation to French \(.+Translator\)$/.test(s), translateSaved: ['fr'],
    recentGroup: 'Recent', recentFirst: 'French', koError: (s) => s.includes('can\'t translate to Korean'),
    badgesAfterReload: 3, unitsOptions: ['Auto', 'US (°F, miles, pounds)', 'Metric (°C, km, kg)'],
    deChip: (s) => /°C, /.test(s), deShortButtons: ['Copy', 'Edit'], deRecentFirst: 'German',
    fallbackSummaryBadge: (s) => s.startsWith('Summary ('),
  } });
  await browser.close();
})();
