// Headless test of the Settings drawer: prompt, saved prompts, JSON format,
// creativity and language, with fallbacks.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, cdnPath, check } = require('./lib');

const PAGE = path.join(ROOT, 'index.html');
const KEY = 'gemini-nano-chat:settings:v2';

// o.onlyMostPredictable: create() rejects any other samplingMode (like MTP Chrome).
// o.rejectLang: create() rejects expectedInputs.
// o.rejectSchema: prompt() rejects responseConstraint.
const init = (o) => `
  window.__creates = [];
  window.__prompts = [];
  class S extends EventTarget {
    constructor(opts) { super(); this.contextUsage = 300; this.contextWindow = 9216; }
    async measureContextUsage(t) { return Math.ceil(t.length / 3.5); }
    async prompt(t, opts = {}) {
      window.__prompts.push({ schema: !!opts.responseConstraint, text: t });
      if (opts.responseConstraint) {
        if (${!!o.rejectSchema}) throw new DOMException('no', 'NotSupportedError');
        return '{"answer":"Paris","confidence":"high"}';
      }
      if (t.includes('Reply with only a JSON object')) return '\`\`\`json\\n{"answer":"Paris","confidence":"medium"}\\n\`\`\`';
      return 'plain **reply**';
    }
    destroy() {}
  }
  window.LanguageModel = {
    availability: async () => 'available',
    async create(opts) {
      window.__creates.push({ system: opts.initialPrompts[0].content, sampling: opts.samplingMode || null, langs: opts.expectedOutputs ? opts.expectedOutputs[0].languages : null });
      if (${!!o.onlyMostPredictable} && opts.samplingMode && opts.samplingMode !== 'most-predictable') throw new DOMException('MTP', 'NotSupportedError');
      if (${!!o.rejectLang} && opts.expectedInputs) throw new DOMException('lang', 'NotSupportedError');
      return new S(opts);
    },
  };
`;

async function setup(browser, o = {}) {
  const ctx = await browser.newContext({ colorScheme: o.dark ? 'dark' : 'light', viewport: o.viewport || { width: 1000, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    const file = cdnPath(route.request().url());
    route.fulfill({ body: fs.readFileSync(file), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('http://test.local/', (r) => r.fulfill({ body: fs.readFileSync(PAGE), contentType: 'text/html' }));
  await page.addInitScript(init(o));
  if (o.before) await page.addInitScript(o.before);
  await page.goto('http://test.local/');
  await page.waitForTimeout(300);
  return { page, errors };
}

async function send(page, text) {
  const before = await page.locator('.msg.ai:not(.pending)').count();
  await page.fill('#prompt', text);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.msg.ai:not(.pending)').length > n, before);
}
const lastCreate = (page) => page.evaluate(() => window.__creates[window.__creates.length - 1]);
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);

(async () => {
  const browser = await chromium.launch();
  const r = {};

  {
    const { page, errors } = await setup(browser, {
      // Old mode-based settings from the previous version should be cleared.
      before: `try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('gemini-nano-chat:settings:v1', '{"preset":"bias"}'); sessionStorage.setItem('seeded', '1'); } } catch {}`,
    });
    r.oldSettingsCleared = await page.evaluate(() => localStorage.getItem('gemini-nano-chat:settings:v1')) === null;
    r.buttonLabel = (await page.textContent('#mode-name')).trim();
    r.defaultCreate = await lastCreate(page);

    await page.click('#mode-btn');
    r.presetOptions = await page.locator('#preset option').allTextContents();
    r.deleteDisabledOnDefault = await page.isDisabled('#preset-delete');
    r.samplingOptions = await page.locator('#sampling option').count();
    r.languageOptions = await page.locator('#language option').allTextContents();
    r.samplingNow = await page.textContent('#sampling-now');
    await page.waitForTimeout(400);
    r.meter = await page.textContent('#prompt-meter .meter-text');
    await page.screenshot({ path: path.join(OUT, 'drawer-light.png') });

    // Edit the Default prompt: restore link appears, then restores.
    await page.locator('#sys-prompt').press('End');
    await page.locator('#sys-prompt').type(' Be funny.');
    r.restoreShown = await page.isVisible('#prompt-reset');
    await page.click('#prompt-reset');
    r.restoreWorked = !(await page.inputValue('#sys-prompt')).includes('Be funny');

    // New prompt: empty name shows an error, not a dialog.
    await page.click('#preset-new');
    await page.click('#new-save');
    r.emptyNameError = await page.textContent('#new-error');
    await page.fill('#new-name', 'default');
    await page.click('#new-save');
    r.dupNameError = await page.textContent('#new-error');
    await page.fill('#new-name', 'Spanish tutor');
    await page.keyboard.press('Enter');
    r.newSelected = await page.locator('#preset option:checked').textContent();
    r.deleteEnabled = !(await page.isDisabled('#preset-delete'));
    await page.fill('#sys-prompt', 'You are a patient Spanish tutor. Correct my mistakes gently.');
    await page.selectOption('#language', 'es');
    await page.selectOption('#sampling', 'creative');
    await page.click('#settings-apply');
    await page.waitForTimeout(400);
    r.drawerClosed = !(await page.isVisible('#settings'));
    r.buttonAfter = (await page.textContent('#mode-name')).trim();
    const c = await lastCreate(page);
    r.createAfter = { factsFirst: c.system.startsWith('Facts about you'), tutor: c.system.includes('Spanish tutor'), replyIn: c.system.includes('Always reply in Spanish.'), sampling: c.sampling, langs: c.langs };
    const s = await stored(page);
    r.storedAfter = { active: s.presets.find((p) => p.id === s.active).name, count: s.presets.length, sampling: s.sampling, language: s.language };

    // Switch back to Default with Cancel in between.
    await page.click('#mode-btn');
    await page.selectOption('#preset', 'default');
    await page.click('#settings-cancel');
    r.cancelKept = (await page.textContent('#mode-name')).trim();

    // JSON format on a new prompt, bad schema blocks Apply inline.
    await page.click('#mode-btn');
    await page.click('#preset-new');
    await page.fill('#new-name', 'Quick facts');
    await page.click('#new-save');
    await page.check('input[name="format"][value="json"]');
    r.exampleSchemaFilled = (await page.inputValue('#schema')).includes('"confidence"');
    await page.fill('#schema', '{ not json');
    await page.click('#settings-apply');
    r.badSchemaError = await page.textContent('#schema-error');
    r.drawerStillOpen = await page.isVisible('#settings');
    await page.fill('#schema', JSON.stringify({ type: 'object', properties: { answer: { type: 'string' }, confidence: { type: 'string' } }, required: ['answer', 'confidence'] }));
    const createsBefore = await page.evaluate(() => window.__creates.length);
    await page.click('#settings-apply');
    await page.waitForTimeout(400);
    await send(page, 'Capital of France?');
    r.jsonPromptUsedSchema = (await page.evaluate(() => window.__prompts)).slice(-1)[0].schema;
    r.jsonRendered = (await page.locator('.msg.ai pre code').last().textContent()).includes('"answer": "Paris"');
    r.reloadedForNewPrompt = (await page.evaluate(() => window.__creates.length)) > createsBefore;
    await page.screenshot({ path: path.join(OUT, 'json-reply.png') });

    // Restored JSON replies still render as JSON after reload.
    await page.reload();
    await page.waitForTimeout(500);
    r.jsonAfterReload = (await page.locator('.msg.ai pre code').count()) >= 1;
    r.buttonAfterReload = (await page.textContent('#mode-name')).trim();

    // Delete with Undo inside the drawer, then delete for real.
    await page.click('#mode-btn');
    await page.click('#preset-delete');
    r.afterDeleteSelected = await page.locator('#preset option:checked').textContent();
    r.toastText = await page.textContent('#toast-text');
    r.toastVisibleOverDrawer = await page.evaluate(() => {
      const t = document.getElementById('toast').getBoundingClientRect();
      const el = document.elementFromPoint(t.left + 10, t.top + t.height / 2);
      return !!el && !!el.closest('#toast');
    });
    await page.click('#toast-action');
    r.undoRestored = await page.locator('#preset option:checked').textContent();
    await page.click('#preset-delete');
    await page.click('#settings-apply');
    await page.waitForTimeout(300);
    r.finalNames = (await stored(page)).presets.map((p) => p.name);

    // Escape closes and returns focus.
    await page.click('#mode-btn');
    await page.keyboard.press('Escape');
    r.escape = !(await page.isVisible('#settings')) && (await page.evaluate(() => document.activeElement.id)) === 'mode-btn';
    r.errors = errors;
  }

  // MTP Chrome: only most-predictable allowed. Creative falls back and tells the user.
  {
    const { page, errors } = await setup(browser, {
      onlyMostPredictable: true,
      before: `localStorage.setItem('${KEY}', JSON.stringify({ active: 'default', presets: [], sampling: 'creative', language: 'en' }))`,
    });
    await page.waitForTimeout(300);
    r.mtp = {
      creates: await page.evaluate(() => window.__creates.map((c) => c.sampling)),
      toast: await page.textContent('#toast-text'),
      toastVisible: await page.isVisible('#toast'),
      errors,
    };
  }

  // Chrome rejects the language hint: falls back, prompt still asks.
  {
    const { page, errors } = await setup(browser, {
      rejectLang: true,
      before: `localStorage.setItem('${KEY}', JSON.stringify({ active: 'default', presets: [], sampling: 'auto', language: 'fr' }))`,
    });
    const c = await lastCreate(page);
    r.lang = { langs: c.langs, replyInFrench: c.system.includes('Always reply in French.'), toast: await page.textContent('#toast-text'), errors };
  }

  // Schema rejected by prompt(): falls back, still renders JSON.
  {
    const { page, errors } = await setup(browser, {
      rejectSchema: true,
      before: `localStorage.setItem('${KEY}', JSON.stringify({ active: 'j', presets: [{ id: 'j', name: 'J', prompt: 'Be brief.', format: 'json', schema: '{"type":"object"}' }], sampling: 'auto', language: 'en' }))`,
    });
    await send(page, 'Capital of France?');
    r.schemaFallback = {
      calls: await page.evaluate(() => window.__prompts.map((p) => p.schema)),
      rendered: (await page.locator('.msg.ai pre code').last().textContent()).includes('"confidence": "medium"'),
      errors,
    };
  }

  // Phone, dark.
  {
    const { page } = await setup(browser, { dark: true, viewport: { width: 390, height: 844 } });
    await page.click('#mode-btn');
    await page.check('input[name="format"][value="json"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'drawer-mobile-dark.png'), fullPage: false });
    r.mobileNoHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  }

  check('Settings drawer', r, { allowFalse: ['reloadedForNewPrompt'], equals: {
    buttonLabel: 'Settings', presetOptions: ['Default'], samplingOptions: 8,
    languageOptions: ['English', 'Spanish', 'Japanese', 'German', 'French'],
    emptyNameError: 'Give it a name.', dupNameError: 'You already have a prompt with that name.',
    newSelected: 'Spanish tutor', buttonAfter: 'Spanish tutor', cancelKept: 'Spanish tutor',
    'createAfter.sampling': 'creative', 'createAfter.langs': ['es'],
    'storedAfter.active': 'Spanish tutor', 'storedAfter.count': 2,
    // The new prompt copied the tutor's text, so no model reload was needed.
    reloadedForNewPrompt: false,
    buttonAfterReload: 'Quick facts', afterDeleteSelected: 'Default', undoRestored: 'Quick facts',
    finalNames: ['Default', 'Spanish tutor'],
    'mtp.creates': ['creative', 'most-predictable'], 'mtp.toast': (s) => s.includes('didn\'t accept "Creative"'),
    'lang.langs': null, 'lang.toast': (s) => s.includes('French language setting'),
    'schemaFallback.calls': [true, false],
  } });
  await browser.close();
})();
