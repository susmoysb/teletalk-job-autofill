// Builds one store-ready zip per browser from extension/:
//   dist/teletalk-autofill-chrome-<version>.zip   Chrome Web Store (also Edge, Brave, Opera)
//   dist/teletalk-autofill-firefox-<version>.zip  addons.mozilla.org (Firefox desktop + Android)
// The shared manifest carries both browsers' keys; each package keeps only its own.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const WEB_EXT = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'web-ext.cmd' : 'web-ext');

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const targets = {
  chrome: (m) => {
    delete m.browser_specific_settings;
    m.background = { service_worker: m.background.service_worker };
  },
  firefox: (m) => {
    m.background = { scripts: m.background.scripts };
  },
};

fs.mkdirSync(DIST, { recursive: true });
// Only the current version's zips stay (signed .xpi files are kept).
for (const f of fs.readdirSync(DIST)) {
  if (/^teletalk-autofill-(chrome|firefox)-.+\.zip$/.test(f) && !f.endsWith(`-${manifest.version}.zip`)) fs.rmSync(path.join(DIST, f));
}
for (const [name, adapt] of Object.entries(targets)) {
  const tmp = path.join(DIST, `.build-${name}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(SRC, tmp, { recursive: true });
  const m = structuredClone(manifest);
  adapt(m);
  fs.writeFileSync(path.join(tmp, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
  const file = `teletalk-autofill-${name}-${manifest.version}.zip`;
  execFileSync(WEB_EXT, ['build', '--source-dir', tmp, '--artifacts-dir', DIST, '--filename', file, '--overwrite-dest'], { stdio: 'ignore' });
  console.log(`dist/${file}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(path.join(DIST, name), { recursive: true, force: true }); // unpacked folders from older builds
}
