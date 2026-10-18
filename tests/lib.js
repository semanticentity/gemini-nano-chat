// Shared helpers for the headless tests.
//
// The tests load the real pages from the repo into Chromium (Playwright),
// but fake the browser's built-in AI (LanguageModel, Summarizer, and so on)
// and every network call. So they run anywhere, with no model and no internet.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output'); // screenshots land here (gitignored)
fs.mkdirSync(OUT, { recursive: true });

// The page loads marked and DOMPurify from jsDelivr. Tests serve the same
// pinned versions from node_modules instead.
function cdnPath(url) {
  return url.includes('marked')
    ? path.join(__dirname, 'node_modules', 'marked', 'lib', 'marked.umd.js')
    : path.join(__dirname, 'node_modules', 'dompurify', 'dist', 'purify.min.js');
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Checks a results object and prints PASS or FAIL lines.
// - Any boolean false fails, unless its key is in allowFalse.
// - Any key containing "errors" must be an empty array.
// - equals: { key: expectedValue | (value) => boolean } for specific checks.
//   Keys can be dotted paths, like "mtp.creates".
function check(name, results, { allowFalse = [], equals = {} } = {}) {
  const fails = [];
  let count = 0;
  (function walk(obj, prefix) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (/errors/i.test(k) && Array.isArray(v)) {
        count++;
        if (v.length) fails.push(`${key}: ${JSON.stringify(v)}`);
      } else if (v === false) {
        count++;
        if (!allowFalse.includes(key)) fails.push(`${key} is false`);
      } else if (v === true) {
        count++;
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, key);
      }
    }
  })(results, '');
  for (const [key, want] of Object.entries(equals)) {
    count++;
    const got = key.split('.').reduce((o, k) => (o == null ? o : o[k]), results);
    const ok = typeof want === 'function' ? !!want(got) : same(got, want);
    if (!ok) fails.push(`${key}: got ${JSON.stringify(got)}${typeof want === 'function' ? '' : `, wanted ${JSON.stringify(want)}`}`);
  }
  if (fails.length) {
    console.log(`FAIL ${name}`);
    fails.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`PASS ${name} (${count} checks)`);
  }
  return !fails.length;
}

module.exports = { ROOT, OUT, cdnPath, check };
