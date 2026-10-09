#!/usr/bin/env node
/*
 * StreetTasker design-system check
 * --------------------------------
 * Counts design-system violations per file and fails if any file has MORE
 * than the saved baseline. Existing violations are tolerated until cleaned
 * up; new ones are not. As the cleanup progresses, run with --update to
 * lower the baseline so it can only go down.
 *
 *   node tools/check-design-system.js           check (exit 1 on regressions)
 *   node tools/check-design-system.js --update  rewrite the baseline
 *   node tools/check-design-system.js --report  list totals per rule
 *
 * Rules (see DESIGN-SYSTEM.md section 1):
 *   hex      raw hex colour       -> use a token from css/tokens.css
 *   rgb      raw rgb()/rgba()     -> use a token
 *   inline   style="..." attribute -> use a class
 *   important  !important          -> needs a real reason
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'design-baseline.json');
const SKIP_FILES = new Set(['css/tokens.css']);     // tokens are allowed to hold raw values
const SKIP_DIRS = new Set(['node_modules', '.git', 'images', 'tools']);

const RULES = {
  hex:       /(?<!href=")(?<!url\()(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
  rgb:       /\brgba?\(/g,
  inline:    /\sstyle\s*=\s*["']/g,
  important: /!important/g,
};

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(html|css|js)$/.test(name)) out.push(full);
  }
  return out;
}

function scan() {
  const result = {};
  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (SKIP_FILES.has(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const counts = {};
    for (const [rule, re] of Object.entries(RULES)) {
      const n = (text.match(re) || []).length;
      if (n) counts[rule] = n;
    }
    if (Object.keys(counts).length) result[rel] = counts;
  }
  return result;
}

const current = scan();
const arg = process.argv[2];

if (arg === '--update') {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log('Baseline updated: ' + Object.keys(current).length + ' files.');
  process.exit(0);
}

if (arg === '--report') {
  const totals = {};
  for (const c of Object.values(current)) for (const [r, n] of Object.entries(c)) totals[r] = (totals[r] || 0) + n;
  console.log('Totals:', totals);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('No baseline found. Run: node tools/check-design-system.js --update');
  process.exit(1);
}

const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const problems = [];
for (const [file, counts] of Object.entries(current)) {
  for (const [rule, n] of Object.entries(counts)) {
    const allowed = (base[file] && base[file][rule]) || 0;
    if (n > allowed) problems.push(`${file}: ${rule} ${allowed} -> ${n} (+${n - allowed})`);
  }
}

if (problems.length) {
  console.error('Design-system check FAILED. New violations:\n  ' + problems.join('\n  '));
  console.error('\nUse tokens and classes from DESIGN-SYSTEM.md instead of raw values.');
  process.exit(1);
}

// Tell the developer when things have improved so the baseline can be tightened.
let improved = 0;
for (const [file, counts] of Object.entries(base)) {
  for (const [rule, n] of Object.entries(counts)) {
    const now = (current[file] && current[file][rule]) || 0;
    if (now < n) improved++;
  }
}
console.log('Design-system check passed.' + (improved ? ` ${improved} counts are below baseline; run with --update to lock in the progress.` : ''));
