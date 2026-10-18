import assert from 'node:assert/strict';
import { evaluateExpression as calc, parseDay, isoDay, convert, textStats, runTool, catalogPrompt, routeSchema, TOOLS } from '../tools.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

// calculate
t('pct', () => assert.equal(calc('0.18 * 2450'), 441));
t('pct postfix', () => assert.equal(calc('18% * 2,450'), 441));
t('commas', () => assert.equal(calc('1,234 * 5,678'), 7006652));
t('precedence', () => assert.equal(calc('2 + 3 * 4 ^ 2'), 50));
t('right assoc', () => assert.equal(calc('2^3^2'), 512));
t('parens unary', () => assert.equal(calc('-(3 - 5) * 2'), 4));
t('sqrt', () => assert.equal(calc('sqrt(1764)'), 42));
t('split bill', () => assert.equal(calc('$187.50 / 6'), 31.25));
t('times sign', () => assert.equal(calc('12 × 3 ÷ 4'), 9));
t('x as times', () => assert.equal(calc('12 x 3'), 36));
t('pi round', () => assert.equal(calc('round(pi * 100)'), 314));
t('float tidy', () => assert.equal(calc('0.1 + 0.2'), 0.3));
t('div zero', () => assert.throws(() => calc('1/0'), /zero/));
t('junk', () => assert.throws(() => calc('2 + hello')));
t('no eval', () => assert.throws(() => calc('alert(1)')));
t('trailing', () => assert.throws(() => calc('2 +')));

// dates
const now = new Date(2026, 9, 16, 15, 0); // Oct 16 2026 local
t('today', () => assert.equal(isoDay(parseDay('today', now)), '2026-10-16'));
t('iso', () => assert.equal(isoDay(parseDay('2026-03-01', now)), '2026-03-01'));
t('words date', () => assert.equal(isoDay(parseDay('December 25, 2026', now)), '2026-12-25'));
t('bad date', () => assert.throws(() => parseDay('someday soon', now)));

// units
t('F to C', () => near(convert(72, 'fahrenheit', 'C'), 22.222));
t('mi to km', () => near(convert(26.2, 'miles', 'km'), 42.165));
t('kg to lb', () => near(convert(80, 'kg', 'pounds'), 176.37));
t('cups to ml', () => near(convert(2, 'cups', 'ml'), 473.18));
t('mph to kmh', () => near(convert(60, 'mph', 'km/h'), 96.56));
t('acre to m2', () => near(convert(1, 'acres', 'sq m'), 4046.86));
t('K to F', () => near(convert(300, 'kelvin', '°F'), 80.33));
t('mismatch', () => assert.throws(() => convert(1, 'kg', 'km')));

// text
t('words', () => assert.equal(textStats('The quick brown fox jumps over the lazy dog.').words, 9));
t('chars', () => assert.equal(textStats('antidisestablishmentarianism').characters, 28));
t('sentences', () => assert.equal(textStats('Hi there. How are you? Fine!').sentences, 3));
t('emoji chars', () => assert.equal(textStats('a😀b').characters, 3));
t('flesch', () => assert.ok(textStats('The cat sat on the mat.').flesch_reading_ease > 90));

// runTool never throws
const run = async () => {
  const r1 = await runTool('calculate', { expression: '2+2' });
  assert.deepEqual(r1, { ok: true, result: { expression: '2+2', result: 4 } }); n++;
  const r2 = await runTool('calculate', {});
  assert.equal(r2.ok, false); n++;
  const r3 = await runTool('nope', {});
  assert.equal(r3.ok, false); n++;
  const r4 = await runTool('add_days', { date: '2026-11-20', days: 45 });
  assert.equal(r4.result.date, '2027-01-04'); assert.equal(r4.result.weekday, 'Monday'); n++;
  const r5 = await runTool('days_between', { from: '2026-03-01', to: '2026-12-25' });
  assert.equal(r5.result.days, 299); n++;
  const r6 = await runTool('calculate', { expression: '1/0' });
  assert.equal(r6.ok, false); n++;
  // catalog size
  const cat = catalogPrompt(TOOLS, now);
  console.log(`catalog: ${cat.length} chars, ~${Math.round(cat.length / 4)} tokens; schema enum: ${routeSchema().properties.tool.enum.join(',')}`);
  console.log(`${n} checks passed${process.exitCode ? ', with failures above' : ''}`);
};
run().catch((e) => { console.log('FAIL async', e.message); process.exitCode = 1; });
