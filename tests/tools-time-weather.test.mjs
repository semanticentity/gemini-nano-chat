import assert from 'node:assert/strict';
import { parseTarget, isHere, runTool, describeCall, catalogPrompt, TOOLS } from '../tools.js';
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
const now = new Date(2026, 9, 16, 20, 47); // Fri Oct 16 2026, 8:47 PM, local time
await t('midnight', () => assert.equal(+parseTarget('midnight', now), +new Date(2026, 9, 17, 0, 0)));
await t('5pm passed -> tomorrow', () => assert.equal(+parseTarget('5pm', now), +new Date(2026, 9, 17, 17, 0)));
await t('9:30 pm today', () => assert.equal(+parseTarget('9:30 PM', now), +new Date(2026, 9, 16, 21, 30)));
await t('24h', () => assert.equal(+parseTarget('22:15', now), +new Date(2026, 9, 16, 22, 15)));
await t('12am', () => assert.equal(+parseTarget('12 am', now), +new Date(2026, 9, 17, 0, 0)));
await t('a.m. dots', () => assert.equal(+parseTarget('7 a.m.', now), +new Date(2026, 9, 17, 7, 0)));
await t('iso date', () => assert.equal(+parseTarget('2026-12-25', now), +new Date(2026, 11, 25)));
await t('iso datetime', () => assert.equal(+parseTarget('2026-12-31T23:59', now), +new Date(2026, 11, 31, 23, 59)));
await t('bare number rejected', () => assert.throws(() => parseTarget('5', now)));
await t('junk rejected', () => assert.throws(() => parseTarget('soonish', now)));
await t('run midnight', async () => {
  const r = await runTool('time_until', { time: 'midnight' }, { now });
  assert.equal(r.ok, true); assert.equal(r.result.minutes, 193); assert.equal(r.result.in_words, '3 hours 13 minutes');
});
await t('run new year', async () => {
  const r = await runTool('time_until', { time: '2027-01-01' }, { now });
  // Works in any time zone: compare to real elapsed minutes, which include a DST change if there is one.
  assert.equal(r.result.minutes, Math.round((new Date(2027, 0, 1) - now) / 60000));
});
await t('describe time', async () => {
  const r = await runTool('time_until', { time: 'midnight' }, { now });
  assert.match(describeCall('time_until', { time: 'midnight' }, r), /^3 hours 13 minutes until Saturday, October 17/);
});
await t('isHere', () => { for (const s of ['here', 'Near me', 'my location', ' current location ', 'nearby']) assert.ok(isHere(s), s); for (const s of ['Austin', 'Hereford', 'near Austin']) assert.ok(!isHere(s), s); });
await t('weather here uses locate', async () => {
  const calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u)); return { ok: true, json: async () => ({ current: { temperature_2m: 20, apparent_temperature: 19, weather_code: 0 }, daily: { time: ['2026-10-16'], temperature_2m_max: [25], temperature_2m_min: [15], precipitation_probability_max: [5], weather_code: [1] } }) }; };
  const r = await runTool('weather', { place: 'near me' }, { locate: async () => ({ latitude: 30.1, longitude: -97.7 }) });
  assert.equal(r.ok, true); assert.equal(r.result.place, 'Your location');
  assert.equal(calls.length, 1); assert.ok(calls[0].includes('latitude=30.1'));
  assert.equal(describeCall('weather', { place: 'here' }, r, { units: 'metric' }), 'Your location: 20°C, clear');
  assert.equal(describeCall('weather', { place: 'here' }, r), 'Your location: 68°F, clear');
});
await t('weather here without locate fails cleanly', async () => {
  const r = await runTool('weather', { place: 'here' });
  assert.equal(r.ok, false); assert.match(r.error, /Location/);
});
const cat = catalogPrompt(TOOLS, now);
console.log(`catalog ~${Math.round(cat.length / 4)} tokens`);
console.log(`${n} checks passed`);
