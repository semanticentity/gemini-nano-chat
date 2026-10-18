// Runs every test file in order and prints a summary.
// Usage: npm test   (or: node run-all.js)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname)
  .filter((f) => /\.test\.(m?js)$/.test(f))
  .sort((a, b) => (a.endsWith('.mjs') === b.endsWith('.mjs') ? a.localeCompare(b) : a.endsWith('.mjs') ? -1 : 1));

const failed = [];
for (const f of files) {
  console.log(`\n# ${f}`);
  const res = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', timeout: 6 * 60 * 1000 });
  if (res.status !== 0) failed.push(f);
}
console.log(`\n${files.length - failed.length} of ${files.length} test files passed.`);
if (failed.length) {
  console.log(`Failed: ${failed.join(', ')}`);
  process.exit(1);
}
