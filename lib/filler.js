// Terminal side of the filler: runs the extension's in-page engine
// (extension/lib/fields.js + engine.js) in every frame of a Playwright page.
const fs = require('fs');
const path = require('path');

const EXT_LIB = path.join(__dirname, '..', 'extension', 'lib');
const ENGINE_SRC = ['fields.js', 'engine.js'].map((f) => fs.readFileSync(path.join(EXT_LIB, f), 'utf8')).join('\n');
require(path.join(EXT_LIB, 'engine.js')); // for mergeReports; nothing else runs outside a page
const { mergeReports } = globalThis.TAF_ENGINE;

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.pdf': 'application/pdf' };

// The engine takes uploads as {name, dataUrl}; profile.json holds file paths.
function loadFile(baseDir, p) {
  const file = path.resolve(baseDir, String(p));
  if (!fs.existsSync(file)) return { name: path.basename(file), error: `file not found: ${file}` };
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return { name: path.basename(file), dataUrl: `data:${type};base64,${fs.readFileSync(file).toString('base64')}` };
}

async function fillPage(page, profile, baseDir) {
  const prof = { ...profile };
  for (const k of ['photo', 'signature']) if (typeof prof[k] === 'string' && prof[k]) prof[k] = loadFile(baseDir, prof[k]);
  const script = `(async () => {\n${ENGINE_SRC}\nreturn TAF_ENGINE.fill(${JSON.stringify(prof)});\n})()`;
  const reports = [];
  for (const frame of page.frames()) {
    try {
      reports.push(await frame.evaluate(script));
    } catch (e) {
      reports.push({ problems: [{ key: '(frame)', label: frame.url(), error: e.message.split('\n')[0] }] });
    }
  }
  return mergeReports(reports);
}

function printReport(r) {
  const short = (s) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);
  console.log(`\nFilled ${r.filled.length} field(s):`);
  for (const f of r.filled) console.log(`  ✓ ${f.key.padEnd(22)} ${short(f.value).padEnd(28)} ← ${short(f.label)}`);
  if (r.notes && r.notes.length) {
    console.log(`\nCheck these (${r.notes.length}):`);
    for (const n of r.notes) console.log(`  ! ${n.key.padEnd(22)} ${n.note}`);
  }
  if (r.problems.length) {
    console.log(`\nProblems (${r.problems.length}) — fill these by hand:`);
    for (const p of r.problems) console.log(`  ✗ ${p.key.padEnd(22)} ${p.error}  [${short(p.label)}]`);
  }
  if (r.blocked.length) {
    console.log(`\nFound but hidden or locked (${r.blocked.length}) — the form must show or unlock them first:`);
    for (const x of r.blocked) console.log(`  ✗ ${x.key.padEnd(22)} ${x.reason}  [${short(x.label)}]`);
  }
  if (r.missing.length) {
    console.log(`\nNot found on this page (fine if the form doesn't ask for them): ${r.missing.join(', ')}`);
  }
  if (r.empty.length) {
    console.log(`\nStill empty (${r.empty.length}) — check these yourself:`);
    for (const e of r.empty) console.log(`  • ${short(e)}`);
  }
  console.log('\nNothing was submitted. Review the form, solve the captcha and submit it yourself.');
}

module.exports = { fillPage, printReport };
