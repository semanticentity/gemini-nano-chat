// Tool library for the on-device model.
//
// Rule of thumb: anything that has to be correct is written and tested here.
// The model only picks a tool and fills in its inputs (JSON mode), which
// small models are good at. It never does the math or writes the code.
//
// Each tool: { name, summary, example, network, validate(args), run(args) }.
// run() returns a plain object. Network tools only call APIs that are free,
// need no key, and allow requests from web pages.

// ---------- calculate ----------

// A small, safe expression parser. No eval.
// Supports: + - * / ^, parentheses, unary minus, postfix % (divide by 100),
// sqrt() round() abs() floor() ceil(), pi, × ÷, and commas in numbers.
export function evaluateExpression(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Empty expression.');
  const src = input
    .replace(/(\d),(?=\d{3}\b)/g, '$1') // 2,450 -> 2450
    .replace(/[×xX](?=\s*[\d(.])/g, '*')
    .replace(/÷/g, '/')
    .replace(/\*\*/g, '^')
    .replace(/[$€£]/g, '')
    .trim();

  const tokens = [];
  const re = /\s*(\d+\.?\d*|\.\d+|[a-z]+|[-+*/^%()])/giy;
  let m;
  let consumed = 0;
  while ((m = re.exec(src))) {
    tokens.push(m[1].toLowerCase());
    consumed = re.lastIndex;
  }
  if (src.slice(consumed).trim()) throw new Error(`Can't read "${src.slice(consumed).trim()}".`);

  let i = 0;
  const peek = () => tokens[i];
  const take = (t) => {
    if (tokens[i] !== t) throw new Error(`Expected "${t}".`);
    i++;
  };
  const FUNCS = { sqrt: Math.sqrt, round: Math.round, abs: Math.abs, floor: Math.floor, ceil: Math.ceil };

  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = tokens[i++] === '+' ? v + term() : v - term();
    return v;
  }
  function term() {
    let v = power();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[i++];
      const r = power();
      if (op === '/' && r === 0) throw new Error('Division by zero.');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function power() {
    const base = unary();
    if (peek() === '^') { i++; return base ** power(); }
    return base;
  }
  function unary() {
    if (peek() === '-') { i++; return -unary(); }
    if (peek() === '+') { i++; return unary(); }
    return postfix();
  }
  function postfix() {
    let v = primary();
    while (peek() === '%') { i++; v /= 100; }
    return v;
  }
  function primary() {
    const t = tokens[i++];
    if (t === undefined) throw new Error('The expression ended early.');
    if (/^(\d|\.)/.test(t)) return parseFloat(t);
    if (t === '(') { const v = expr(); take(')'); return v; }
    if (t === 'pi') return Math.PI;
    if (FUNCS[t]) { take('('); const v = expr(); take(')'); return FUNCS[t](v); }
    throw new Error(`Unknown "${t}".`);
  }

  const value = expr();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}".`);
  if (!Number.isFinite(value)) throw new Error('The result is not a finite number.');
  return Number(value.toPrecision(12));
}

const calculate = {
  name: 'calculate',
  label: 'Calculator',
  summary: 'math and percentages',
  example: { expression: '0.18 * 2450' },
  network: false,
  validate: (a) => (typeof a.expression === 'string' && a.expression.trim() ? null : 'Needs "expression" as text.'),
  run: (a) => ({ expression: a.expression, result: evaluateExpression(a.expression) }),
};

// ---------- dates ----------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86400000;

// Dates are handled as UTC midnight so time zones and DST never shift a day.
export function parseDay(value, now = new Date()) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const s = String(value ?? '').trim().toLowerCase();
  if (!s || s === 'today' || s === 'now') return today;
  if (s === 'tomorrow') return today + DAY_MS;
  if (s === 'yesterday') return today - DAY_MS;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const parsed = Date.parse(`${value} 12:00`);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  throw new Error(`Can't read the date "${value}". Use YYYY-MM-DD or "today".`);
}

export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekday = (ms) => WEEKDAYS[new Date(ms).getUTCDay()];

const daysBetween = {
  name: 'days_between',
  label: 'Days between dates',
  summary: 'days between two dates',
  example: { from: '2026-03-01', to: '2026-12-25' },
  network: false,
  validate: (a) => (a.from !== undefined && a.to !== undefined ? null : 'Needs "from" and "to".'),
  run: (a) => {
    const from = parseDay(a.from);
    const to = parseDay(a.to);
    return {
      from: isoDay(from), from_weekday: weekday(from),
      to: isoDay(to), to_weekday: weekday(to),
      days: Math.round((to - from) / DAY_MS),
    };
  },
};

const addDays = {
  name: 'add_days',
  label: 'Date math',
  summary: 'the date some days before or after a date',
  example: { date: 'today', days: 100 },
  network: false,
  validate: (a) => (Number.isFinite(Number(a.days)) ? null : 'Needs "days" as a number (negative for earlier).'),
  run: (a) => {
    const start = parseDay(a.date);
    const end = start + Math.round(Number(a.days)) * DAY_MS;
    return { start: isoDay(start), days: Number(a.days), date: isoDay(end), weekday: weekday(end) };
  },
};

// ---------- convert_units ----------

const UNIT_TABLE = {
  length: { base: 'm', units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, nmi: 1852 } },
  mass: { base: 'kg', units: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318, t: 1000 } },
  volume: { base: 'l', units: { l: 1, ml: 0.001, gal: 3.785411784, qt: 0.946352946, pt: 0.473176473, cup: 0.2365882365, floz: 0.0295735295625, tbsp: 0.01478676478125, tsp: 0.00492892159375 } },
  speed: { base: 'm/s', units: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, knot: 0.514444 } },
  area: { base: 'm2', units: { m2: 1, km2: 1e6, ft2: 0.09290304, acre: 4046.8564224, ha: 10000, mi2: 2589988.110336 } },
};

const UNIT_ALIASES = {
  meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km',
  centimeter: 'cm', centimeters: 'cm', millimeter: 'mm', millimeters: 'mm',
  mile: 'mi', miles: 'mi', yard: 'yd', yards: 'yd', foot: 'ft', feet: 'ft',
  inch: 'in', inches: 'in', 'nautical mile': 'nmi', 'nautical miles': 'nmi',
  kilogram: 'kg', kilograms: 'kg', kgs: 'kg', gram: 'g', grams: 'g', milligram: 'mg', milligrams: 'mg',
  pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz', stone: 'st', tonne: 't', tonnes: 't',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', milliliter: 'ml', milliliters: 'ml',
  gallon: 'gal', gallons: 'gal', quart: 'qt', quarts: 'qt', pint: 'pt', pints: 'pt', cups: 'cup',
  'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz',
  tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp',
  kph: 'km/h', kmh: 'km/h', 'km per hour': 'km/h', 'kilometers per hour': 'km/h',
  'miles per hour': 'mph', knots: 'knot', 'meters per second': 'm/s', mps: 'm/s',
  'square meters': 'm2', 'sq m': 'm2', 'square feet': 'ft2', 'sq ft': 'ft2', acres: 'acre', hectare: 'ha', hectares: 'ha',
  'square kilometers': 'km2', 'square miles': 'mi2',
  celsius: 'c', fahrenheit: 'f', kelvin: 'k', '°c': 'c', '°f': 'f', degc: 'c', degf: 'f',
};

function normalizeUnit(u) {
  const s = String(u ?? '').trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[s] || UNIT_ALIASES[s.replace(/^degrees?\s+/, '')] || s.replace(/^°/, '');
}

export function convert(value, fromUnit, toUnit) {
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error('"value" must be a number.');
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  const temps = ['c', 'f', 'k'];
  if (temps.includes(from) || temps.includes(to)) {
    if (!temps.includes(from) || !temps.includes(to)) throw new Error(`Can't convert ${fromUnit} to ${toUnit}.`);
    const c = from === 'c' ? v : from === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
    const out = to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    return Number(out.toPrecision(10));
  }
  for (const { units } of Object.values(UNIT_TABLE)) {
    if (from in units && to in units) return Number(((v * units[from]) / units[to]).toPrecision(10));
  }
  throw new Error(`Can't convert "${fromUnit}" to "${toUnit}".`);
}

const convertUnits = {
  name: 'convert_units',
  label: 'Unit converter',
  summary: 'unit conversion (length, weight, volume, speed, area, temperature)',
  example: { value: 26.2, from: 'mi', to: 'km' },
  network: false,
  validate: (a) => (a.value !== undefined && a.from && a.to ? null : 'Needs "value", "from", and "to".'),
  run: (a) => ({ value: Number(a.value), from: a.from, to: a.to, result: convert(a.value, a.from, a.to) }),
};

// ---------- text_stats ----------

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function textStats(text) {
  const t = String(text ?? '');
  const words = t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const sentences = t.split(/[.!?]+(?:\s|$)/).filter((s) => /[\p{L}\p{N}]/u.test(s));
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const wc = words.length;
  const sc = Math.max(1, sentences.length);
  const flesch = wc ? 206.835 - 1.015 * (wc / sc) - 84.6 * (syl / wc) : null;
  return {
    words: wc,
    sentences: sentences.length,
    characters: [...t].length,
    characters_no_spaces: [...t.replace(/\s/g, '')].length,
    letters: (t.match(/\p{L}/gu) || []).length,
    reading_minutes: Number((wc / 230).toFixed(1)),
    flesch_reading_ease: flesch === null ? null : Math.round(flesch),
  };
}

const textStatsTool = {
  name: 'text_stats',
  label: 'Text stats',
  summary: 'count words, sentences, letters, or characters in a given text',
  example: { text: 'the exact text' },
  network: false,
  validate: (a) => (typeof a.text === 'string' && a.text.length ? null : 'Needs "text".'),
  run: (a) => textStats(a.text),
};

// ---------- network recipes ----------

async function getJSON(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}.`);
  return res.json();
}

const wikipedia = {
  name: 'wikipedia',
  label: 'Wikipedia',
  summary: 'look up a person, place, or thing on Wikipedia',
  example: { query: 'Ada Lovelace' },
  network: 'en.wikipedia.org',
  validate: (a) => (typeof a.query === 'string' && a.query.trim() ? null : 'Needs "query".'),
  run: async (a, { signal } = {}) => {
    // One call: search, then the intro of the best match. origin=* allows browser requests.
    const u = new URL('https://en.wikipedia.org/w/api.php');
    Object.entries({
      action: 'query', format: 'json', formatversion: '2', origin: '*',
      generator: 'search', gsrsearch: a.query, gsrlimit: '1',
      prop: 'extracts|info', exintro: '1', explaintext: '1', exsentences: '4', inprop: 'url', redirects: '1',
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    const data = await getJSON(u, signal);
    const page = data.query && data.query.pages && data.query.pages[0];
    if (!page) return { found: false, query: a.query };
    return { found: true, title: page.title, summary: String(page.extract || '').slice(0, 700), url: page.fullurl };
  },
};

const WMO = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};
const toF = (c) => Math.round(c * 9 / 5 + 32);

const weather = {
  name: 'weather',
  label: 'Weather',
  summary: 'current weather and 3 day forecast for a place',
  example: { place: 'Austin' },
  network: 'open-meteo.com',
  validate: (a) => (typeof a.place === 'string' && a.place.trim() ? null : 'Needs "place".'),
  run: async (a, { signal } = {}) => {
    // "Austin, TX" -> search "Austin", prefer a match whose region or country mentions "TX".
    const [name, ...rest] = a.place.split(',').map((s) => s.trim());
    const hint = rest.join(' ').toLowerCase();
    const g = new URL('https://geocoding-api.open-meteo.com/v1/search');
    g.searchParams.set('name', name);
    g.searchParams.set('count', '5');
    g.searchParams.set('language', 'en');
    g.searchParams.set('format', 'json');
    const geo = await getJSON(g, signal);
    const results = geo.results || [];
    if (!results.length) return { found: false, place: a.place };
    const pick = (hint && results.find((r) => [r.admin1, r.country, r.country_code].join(' ').toLowerCase().includes(hint))) || results[0];

    const f = new URL('https://api.open-meteo.com/v1/forecast');
    f.searchParams.set('latitude', pick.latitude);
    f.searchParams.set('longitude', pick.longitude);
    f.searchParams.set('current', 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m');
    f.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code');
    f.searchParams.set('timezone', 'auto');
    f.searchParams.set('forecast_days', '3');
    const w = await getJSON(f, signal);
    const c = w.current || {};
    const d = w.daily || {};
    return {
      found: true,
      place: [pick.name, pick.admin1, pick.country].filter(Boolean).join(', '),
      now: {
        temp_c: c.temperature_2m, temp_f: toF(c.temperature_2m),
        feels_like_f: toF(c.apparent_temperature),
        conditions: WMO[c.weather_code] || `code ${c.weather_code}`,
        wind_kmh: c.wind_speed_10m, precipitation_mm: c.precipitation,
      },
      days: (d.time || []).map((day, i) => ({
        date: day,
        high_f: toF(d.temperature_2m_max[i]), low_f: toF(d.temperature_2m_min[i]),
        rain_chance: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
        conditions: WMO[d.weather_code[i]] || `code ${d.weather_code[i]}`,
      })),
    };
  },
};

// ---------- describing a call ----------

// One short line about a finished call, for the chat's "Used ..." label.
export function describeCall(name, args = {}, out = {}) {
  if (out.declined) return 'not sent, you said no';
  if (!out.ok) return `failed: ${out.error || 'unknown error'}`;
  const r = out.result || {};
  switch (name) {
    case 'calculate': return `${args.expression} = ${r.result}`;
    case 'days_between': return `${r.from} to ${r.to}: ${r.days} days`;
    case 'add_days': return `${r.date}, a ${r.weekday}`;
    case 'convert_units': return `${args.value} ${args.from} = ${r.result} ${args.to}`;
    case 'text_stats': return `${r.words} words, ${r.characters} characters`;
    case 'wikipedia': return r.found ? r.title : `no match for "${args.query}"`;
    case 'weather': return r.found ? `${r.place}: ${r.now.temp_f}°F, ${r.now.conditions}` : `couldn't find "${args.place}"`;
    default: return 'done';
  }
}

// ---------- catalog ----------

export const TOOLS = [calculate, daysBetween, addDays, convertUnits, textStatsTool, wikipedia, weather];
export const toolByName = (name) => TOOLS.find((t) => t.name === name);

// Short catalog text for the model. Kept tiny on purpose: every word costs
// memory in a 9,216 token window.
export function catalogPrompt(tools = TOOLS, today = new Date()) {
  const lines = tools.map((t) => `${t.name}: ${t.summary}. args: ${JSON.stringify(t.example)}`);
  return [
    'You route the user\'s message to one tool, or to "none".',
    'Reply with JSON only: {"tool": "...", "args": {...}}',
    `Today is ${isoDay(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))}.`,
    'Messages may start with the current date and time in brackets. That is context, not part of the question.',
    '',
    'Tools:',
    ...lines,
    'none: anything else, like writing, chat, advice, or explaining. args: {}',
    '',
    'Rules:',
    '- Use a tool only when it clearly helps. Otherwise pick "none".',
    '- For any arithmetic, use calculate. Write the expression with numbers and + - * / ^ only.',
    '- For converting units, like kg to pounds or miles to km, use convert_units, not calculate.',
    '- For dates, use YYYY-MM-DD, or "today".',
  ].join('\n');
}

// JSON schema for the routing reply.
export function routeSchema(tools = TOOLS) {
  return {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: [...tools.map((t) => t.name), 'none'] },
      args: { type: 'object' },
    },
    required: ['tool', 'args'],
  };
}

// Validate and run a routed call. Never throws: errors come back as data,
// so they can be shown to the person or fed back to the model.
export async function runTool(name, args, opts = {}) {
  const tool = toolByName(name);
  if (!tool) return { ok: false, error: `Unknown tool "${name}".` };
  const a = args && typeof args === 'object' ? args : {};
  const problem = tool.validate(a);
  if (problem) return { ok: false, error: problem };
  try {
    return { ok: true, result: await tool.run(a, opts) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
