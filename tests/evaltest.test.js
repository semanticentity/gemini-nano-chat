// Headless run of eval.html with a fake model and mocked network.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, cdnPath, check } = require('./lib');

// Fake router: right for most questions, deliberately wrong for a few.
const fake = `
  window.__clones = 0;
  const ROUTES = [
    [/18% of 2,450/, { tool: 'calculate', args: { expression: '0.18 * 2450' } }],
    [/1234 times 5678/, { tool: 'calculate', args: { expression: '1234 * 5678' } }],
    [/187\\.50/, { tool: 'calculate', args: { expression: '187.50 / 6' } }],
    [/square root/, { tool: 'calculate', args: { expression: 'sqrt(1764)' } }],
    [/tip/, { tool: 'calculate', args: {} }],                                      // bad inputs on purpose
    [/100 days/, { tool: 'add_days', args: { date: 'today', days: 100 } }],
    [/between March/, { tool: 'days_between', args: { from: '2026-03-01', to: '2026-12-25' } }],
    [/45 days after/, { tool: 'add_days', args: { date: '2026-11-20', days: 45 } }],
    [/Fahrenheit/, { tool: 'convert_units', args: { value: 72, from: 'F', to: 'C' } }],
    [/marathon/, { tool: 'convert_units', args: { value: 26.2, from: 'mi', to: 'km' } }],
    [/80 kg/, { tool: 'calculate', args: { expression: '80 * 2.2' } }],            // wrong tool on purpose
    [/Count the words/, { tool: 'text_stats', args: { text: 'Count the words in this sentence: The quick brown fox jumps over the lazy dog.' } }], // copies too much
    [/letters/, { tool: 'text_stats', args: { text: 'antidisestablishmentarianism' } }],
    [/Ada Lovelace/, { tool: 'wikipedia', args: { query: 'Ada Lovelace' } }],
    [/Eiffel/, { tool: 'wikipedia', args: { query: 'Eiffel Tower' } }],
    [/Austin/, { tool: 'weather', args: { place: 'Austin' } }],
    [/Tel Aviv/, { tool: 'weather', args: { place: 'Tel Aviv' } }],
    [/haiku/, { tool: 'none', args: {} }],
    [/Hi!/, { tool: 'none', args: {} }],
    [/CPU/, { tool: 'wikipedia', args: { query: 'CPU' } }],                         // wrong on purpose
    [/friendlier/, 'not json at all'],                                               // bad JSON on purpose
  ];
  const BASE = { '18%': 'It is 441.', '1234': 'About 7,000,000.', '187': 'Each pays $31.25.', 'square': '42', 'tip': 'The tip is $12.96.', '100 days': 'It will be a Monday.', 'between': '298 days.', '45 days': 'January 4, 2027', 'Fahrenheit': '22.2°C', 'marathon': '42.2 km', '80 kg': '176.4 pounds', 'Count': '9 words', 'letters': '27 letters' };
  class S extends EventTarget {
    constructor(o) { super(); this.sys = o.initialPrompts[0].content; this.contextUsage = Math.ceil(this.sys.length / 4); this.contextWindow = 9216; }
    clone() { window.__clones++; return new S({ initialPrompts: [{ content: this.sys }] }); }
    async prompt(q, opts = {}) {
      await new Promise((r) => setTimeout(r, 5));
      if (this.sys.startsWith('You route')) {
        if (!opts.responseConstraint) throw new Error('expected schema');
        const hit = ROUTES.find(([re]) => re.test(q));
        const v = hit ? hit[1] : { tool: 'none', args: {} };
        return typeof v === 'string' ? v : JSON.stringify(v);
      }
      if (q.includes('100 days')) {
        // Always one day off, so this baseline answer is wrong on any date.
        const d = new Date(); d.setDate(d.getDate() + 101);
        return 'It will be a ' + d.toLocaleDateString('en-US', { weekday: 'long' }) + '.';
      }
      const k = Object.keys(BASE).find((key) => q.includes(key));
      return k ? BASE[k] : 'I am not sure.';
    }
    destroy() {}
  }
  window.LanguageModel = { availability: async () => 'available', create: async (o) => new S(o) };
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(fake);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://test.local' });
  await page.route('http://test.local/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    const file = p === '/' || p === '/eval.html' ? 'eval.html' : p.slice(1);
    const type = file.endsWith('.js') ? 'text/javascript' : 'text/html';
    r.fulfill({ body: fs.readFileSync(path.join(ROOT, file)), contentType: type });
  });
  // Mock Wikipedia and Open-Meteo.
  const cors = { 'access-control-allow-origin': '*' };
  await page.route('https://en.wikipedia.org/**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('gsrsearch');
    const title = /eiffel/i.test(q) ? 'Eiffel Tower' : /lovelace/i.test(q) ? 'Ada Lovelace' : q;
    const extract = /eiffel/i.test(q) ? 'The Eiffel Tower is a wrought-iron lattice tower in Paris, France.' : `${title} was notable.`;
    r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ query: { pages: [{ title, extract, fullurl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` }] } }) });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', (r) => {
    const name = new URL(r.request().url()).searchParams.get('name');
    const results = /austin/i.test(name)
      ? [{ name: 'Austin', admin1: 'Texas', country: 'United States', country_code: 'US', latitude: 30.27, longitude: -97.74 }]
      : [{ name: 'Tel Aviv', admin1: 'Tel Aviv', country: 'Israel', country_code: 'IL', latitude: 32.08, longitude: 34.78 }];
    r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ results }) });
  });
  await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
    contentType: 'application/json', headers: cors,
    body: JSON.stringify({
      current: { temperature_2m: 24, apparent_temperature: 25, precipitation: 0, weather_code: 2, wind_speed_10m: 10 },
      daily: { time: ['2026-10-16', '2026-10-17', '2026-10-18'], temperature_2m_max: [28, 27, 26], temperature_2m_min: [18, 17, 16], precipitation_probability_max: [10, 40, 70], weather_code: [2, 61, 63] },
    }),
  }));

  await page.goto('http://test.local/eval.html');
  await page.click('#run-tools');
  await page.waitForFunction(() => /passed/.test(document.getElementById('tools-status').textContent));
  const toolStatus = await page.textContent('#tools-status');

  await page.click('#run-model');
  await page.waitForFunction(() => /Done|Stopped/.test(document.getElementById('model-status').textContent), null, { timeout: 60000 });
  const scores = await page.locator('.score').allTextContents();
  const report = JSON.parse(await page.inputValue('#report'));
  await page.click('#copy-report');
  const copyStatus = await page.textContent('#copy-status');
  const selected = await page.evaluate(() => { const r = document.getElementById('report'); return r.selectionEnd - r.selectionStart === r.value.length; });
  await page.screenshot({ path: path.join(OUT, 'eval-page.png'), fullPage: true });

  const r = {
    toolStatus,
    scores,
    reportScores: report.model.scores,
    catalogTokens: report.model.catalogTokens,
    clones: await page.evaluate(() => window.__clones),
    failures: report.model.results.filter((r) => !r.endToEnd).map((r) => ({ id: r.id, picked: r.picked, argsOk: r.argsOk, raw: r.raw, toolOut: r.toolOut })),
    baselineFails: report.model.results.filter((r) => r.baseline === false).map((r) => r.id),
    copyStatus, fallbackSelectedAll: selected,
    reportBytes: (await page.inputValue('#report')).length,
    errors,
  };
  // The fake model makes 5 deliberate mistakes; the scoring must catch them.
  check('Eval page scoring', r, { equals: {
    toolStatus: '7 of 7 passed.',
    'reportScores.picked_right_tool': '18/21', 'reportScores.valid_inputs': '15/17',
    'reportScores.right_answer_with_tools': '16/21', 'reportScores.right_answer_without_tools': '9/13',
    'reportScores.schema_rejected': '0/21',
    failures: (f) => JSON.stringify(f.map((x) => x.id)) === '["calc-tip","unit-kg","text-words","none-explain","none-rewrite"]',
    baselineFails: ['calc-mult', 'date-weekday', 'date-between', 'text-letters'],
  } });
  await browser.close();
})();
