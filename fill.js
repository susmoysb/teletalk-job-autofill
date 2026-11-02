#!/usr/bin/env node
// Fill a Teletalk job application form from profile.json.
//
//   node fill.js [url-or-file] [--profile profile.json] [--auto]
//
// Opens a browser (logins and cookies are kept in .browser-profile/). Go to the
// application form, then press Enter here to fill it; press Enter again after
// moving to the next page. Nothing is ever submitted or paid.
//
// --auto fills the page right away in a headless browser, prints the report and
// exits (non-zero if anything went wrong). Used by `npm test`.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { fillPage, printReport } = require('./lib/filler');

const DEFAULT_URL = 'https://alljobs.teletalk.com.bd/';

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, profile: 'profile.json', auto: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--auto') args.auto = true;
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else args.url = a;
  }
  return args;
}

function toUrl(s) {
  if (/^[a-z]+:\/\//i.test(s)) return s;
  if (fs.existsSync(s)) return pathToFileURL(path.resolve(s)).href;
  return `https://${s}`;
}

// Re-read on every fill so edits to the profile apply without restarting.
function loadProfile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} not found. Copy profile.example.json to profile.json and fill in your details.`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
}

async function runAuto(url, profileFile) {
  const profile = loadProfile(profileFile);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const report = await fillPage(page, profile, path.dirname(path.resolve(profileFile)));
    printReport(report);
    return report.problems.length || report.missing.length || report.blocked.length ? 1 : 0;
  } finally {
    await browser.close();
  }
}

async function runInteractive(url, profileFile) {
  loadProfile(profileFile); // fail early on a missing or broken profile
  const context = await chromium.launchPersistentContext(path.join(__dirname, '.browser-profile'), {
    headless: false,
    viewport: null,
  });
  const first = context.pages()[0] || (await context.newPage());
  await first.goto(url);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  let closed = false;
  context.on('close', () => {
    closed = true;
    rl.close();
  });

  try {
    while (!closed) {
      const answer = await ask('\nOpen the application form, then press Enter to fill it (q + Enter to quit): ');
      if (closed || answer.trim().toLowerCase() === 'q') break;
      // The form often opens in a new tab: use the newest one.
      const page = context.pages().filter((p) => !p.isClosed()).at(-1);
      if (!page) break;
      try {
        await page.bringToFront();
        printReport(await fillPage(page, loadProfile(profileFile), path.dirname(path.resolve(profileFile))));
      } catch (e) {
        console.error(`Fill failed: ${e.message}`);
      }
    }
  } finally {
    rl.close();
    if (!closed) await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node fill.js [url-or-file] [--profile profile.json] [--auto]');
    return 0;
  }
  const url = toUrl(args.url);
  return args.auto ? runAuto(url, args.profile) : (await runInteractive(url, args.profile), 0);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e.message);
    process.exit(1);
  },
);
