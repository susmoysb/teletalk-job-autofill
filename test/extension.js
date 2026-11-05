// End to end: loads the real extension into Chromium, sets it up through its
// settings page, fills test/form.html (also inside an iframe) through the
// toolbar-button handler, and moves the profile to a fresh browser by backup.
// Exits non-zero on any failure.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'taf-ext-'));
const PORT = 8765;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : `\n    ${detail}`}`);
};

// Test copy of the extension: allowed on localhost, since a scripted call has
// no real click to grant activeTab.
const ext = path.join(TMP, 'extension');
fs.cpSync(path.join(ROOT, 'extension'), ext, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
manifest.content_scripts[0].matches.push('http://127.0.0.1/*'); // the "GO" badge on the test pages
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (req.url === '/framed') return res.end('<h1>Outer page</h1><iframe src="/form.html" width="900" height="600"></iframe>');
  // An upload step asking for sizes the saved images don't have.
  if (req.url === '/upload-small') {
    return res.end(`<p>Photo (200x200 pixel, max 50KB) <input type="file" name="photo"></p>
      <p>Signature (200x60 pixel, max 30KB) <input type="file" name="signature"></p>`);
  }
  // The step after the application form: only the photo and signature.
  if (req.url === '/upload') {
    return res.end(`<h3>Upload Photo and Signature</h3>
      <p>Photo (300x300 pixel, max 100KB) <input type="file" name="photo" accept="image/jpeg"></p>
      <p>Signature (300x80 pixel, max 60KB) <input type="file" name="signature" accept="image/jpeg"></p>`);
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'form.html')));
});

async function launch(name) {
  const ctx = await chromium.launchPersistentContext(path.join(TMP, name), {
    channel: 'chromium', headless: true, acceptDownloads: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const optionsUrl = `chrome-extension://${sw.url().split('/')[2]}/options.html`;
  // What a toolbar click does, for the tab showing `url`.
  const click = (url) => sw.evaluate(async (u) => fillTab((await chrome.tabs.query({})).find((t) => t.url === u)), url);
  return { ctx, sw, optionsUrl, click };
}

// Same shape as the settings page saves: no empty answers, keys in a fixed order.
const clean = (v) => (Array.isArray(v) ? v.map(clean) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, clean(x)]))
  : v);

const formValues = (frame) => frame.evaluate(() => Object.fromEntries([...document.querySelectorAll('input, select, textarea')]
  .filter((e) => e.name)
  .map((e) => [e.name, e.type === 'checkbox' ? e.checked : e.type === 'file' ? e.files[0]?.name || '' : e.value])));

const EXPECT = {
  post: '', name_en: 'MD. EXAMPLE RAHMAN', dob_month: 'May', has_nid: '1', nid: '1234567890', quota: 'Not Applicable',
  pr_upazila: 'Savar', pm_upazila: 'Paba', ssc_gpa: '5.00', grad_duration: '04 Years', mast_exam: 'M.Sc',
  exp1_designation: 'Software Engineer', exp1_cont: true, 'job[0][employment_type]': 'Private Organization', 'job[0][office_address]': 'Gulshan, Dhaka', exp2_resp: 'Software testing', exp2_to: '31/05/2021',
  photo: 'photo.jpg', sign: 'signature.jpg', captcha: '',
};
const diff = (v) => Object.entries(EXPECT).filter(([k, want]) => v[k] !== want).map(([k, want]) => `${k}: expected ${JSON.stringify(want)}, got ${JSON.stringify(v[k])}`);

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const formUrl = `http://127.0.0.1:${PORT}/form.html`;
  const framedUrl = `http://127.0.0.1:${PORT}/framed`;

  // --- Browser 1: first click opens the settings page ---
  const a = await launch('pc1');
  const tab = await a.ctx.newPage();
  await tab.goto(formUrl);
  let [opt] = await Promise.all([a.ctx.waitForEvent('page'), a.click(formUrl)]);
  await opt.waitForLoadState();
  check('First click without a profile opens the settings page', opt.url() === a.optionsUrl, opt.url());
  await opt.waitForFunction(() => document.body.dataset.ready);
  opt.on('dialog', (d) => d.accept()); // "Remove this job?"
  const stored = async () => (await a.sw.evaluate(() => chrome.storage.local.get('profile'))).profile;
  const settled = () => opt.waitForFunction(() => document.querySelector('#status').textContent === 'All changes saved');
  const job = (n, key) => opt.locator(`#job-list .job:nth-child(${n}) [data-job-key="${key}"]`);

  // --- Settings page: JSON under "Advanced" ---
  await opt.click('#advanced summary');
  await opt.waitForFunction(() => document.querySelector('#json').value.length > 0);
  await opt.fill('#json', '{ broken');
  await opt.click('#apply-json');
  check('Broken JSON is refused with a line number', /Not valid JSON \(line 1\)/.test(await opt.textContent('#status')));
  await opt.fill('#json', JSON.stringify({ nameEn: 'A', jobs: [{ from: '01/07/2021' }] }));
  await opt.click('#apply-json');
  check('A badly written job date is refused', /Job 1: "from"/.test(await opt.textContent('#status')));
  await opt.fill('#json', JSON.stringify({ nameEn: 'A', departmentalCandidate: 'Yes' }));
  await opt.click('#apply-json');
  check('An old "Departmental candidate: Yes" shows as Departmental Candidate',
    (await opt.inputValue('[data-key="departmentalStatus"]')) === 'Departmental Candidate');

  // Answers saved in other wordings pick the form's options; an unlisted
  // university goes into "Other"'s box and is saved from there.
  await opt.fill('#json', JSON.stringify({
    nameEn: 'A',
    quota: 'Non Quota',
    ssc: { exam: 'S.S.C Vocational', group: 'Computer and Information Technology', result: 'First Division' },
    graduation: { exam: 'B.Sc (Engineering/Architecture)', subject: 'Computer Science and Engineering', institute: 'Govt. Edward College, Pabna' },
    jobs: [{ designation: 'X', employmentType: 'Permanent' }],
  }));
  await opt.click('#apply-json');
  const worded = await opt.evaluate(() => {
    const v = (k) => document.querySelector(`[data-key="${k}"]`).value;
    const other = document.querySelector('[data-other-for="graduation.institute"]');
    return { exam: v('graduation.exam'), subject: v('graduation.subject'), institute: v('graduation.institute'),
      otherShown: !other.hidden, otherText: other.value, result: v('ssc.result'), group: v('ssc.group'),
      vocational: [...document.querySelector('[data-key="ssc.group"]').options].some((o) => o.value === 'Plumbing and Pipe Fittings'),
      employed: document.querySelector('[data-job-key="employmentType"]').value, quota: v('quota') };
  });
  await opt.fill('[data-key="nameEn"]', 'B');
  await settled();
  const reworded = await stored();
  check('Older wordings pick the form\'s options; an unlisted university goes to "Other"',
    worded.exam === 'B.Sc Engineering' && worded.subject === 'Computer Science & Engineering' && worded.institute === 'Other' &&
    worded.otherShown && worded.otherText === 'Govt. Edward College, Pabna' && worded.result === '1st Division' &&
    worded.group === 'Computer and Information Technology' && worded.vocational && worded.employed === 'Permanent' && worded.quota === 'Not Applicable' &&
    reworded.graduation.institute === 'Govt. Edward College, Pabna' && reworded.graduation.exam === 'B.Sc Engineering' &&
    reworded.ssc.result === '1st Division', JSON.stringify({ worded, saved: reworded.graduation }));

  // --- Settings page: the form ---
  // (JSON view checks follow the import below.)
  const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'profile.json'), 'utf8'));
  await opt.setInputFiles('#import', path.join(__dirname, 'profile.json'));
  await opt.waitForFunction(() => document.querySelector('#status').textContent === 'Imported details.');
  const shown = await opt.evaluate(() => ({
    name: document.querySelector('[data-key="nameEn"]').value,
    board: document.querySelector('[data-key="ssc.board"]').value,
    masters: document.querySelector('[data-toggle="masters"]').checked,
    jobs: document.querySelectorAll('#job-list .job').length,
    job1ToLocked: document.querySelector('#job-list .job [data-job-key="to"]').disabled,
    nidShown: document.querySelector('[data-has="nid"]').value === 'Yes' && !document.querySelector('[data-key="nid"]').hidden,
  }));
  check('Imported details show in the form', shown.name === profile.nameEn && shown.board === 'Rajshahi' &&
    shown.masters && shown.jobs === 2 && shown.job1ToLocked && shown.nidShown, JSON.stringify(shown));

  // The JSON view keeps every key in place: emptying a box shows "", refilling puts it back where it was.
  if (!(await opt.$eval('#advanced', (d) => d.open))) await opt.click('#advanced summary');
  await opt.waitForFunction(() => document.querySelector('#advanced').open && /nameEn/.test(document.querySelector('#json').value));
  const keyOrder = () => opt.evaluate(() => { const j = JSON.parse(document.querySelector('#json').value); return { keys: Object.keys(j), nameEn: j.nameEn, email: j.email }; });
  const before = await keyOrder();
  await opt.fill('[data-key="email"]', '');
  await settled();
  const emptied = await keyOrder();
  await opt.fill('[data-key="email"]', profile.email);
  await settled();
  const refilled = await keyOrder();
  check('JSON view: an emptied detail stays in place as "", and returns to the same place',
    emptied.email === '' && refilled.email === profile.email && JSON.stringify(before.keys) === JSON.stringify(emptied.keys) &&
    JSON.stringify(before.keys) === JSON.stringify(refilled.keys) && before.keys.indexOf('email') < before.keys.indexOf('quota'),
    JSON.stringify({ before: before.keys.slice(0, 20), emptied: emptied.email, refilled: refilled.email }));

  // Every detail in the profile has a box of its own showing it.
  const leaves = (o, pre = '') => Object.entries(o).flatMap(([k, v]) =>
    (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
  const want = leaves(profile).filter(([k, v]) => !/^(photo|signature|confirmMobile|jobs)$/.test(k) && v !== '');
  profile.jobs.forEach((j, i) => Object.entries(j).forEach(([k, v]) => want.push([`job${i + 1}:${k}`, v])));
  const unbound = await opt.evaluate((pairs) => pairs.filter(([k, v]) => {
    const [, n, jk] = /^job(\d+):(.+)$/.exec(k) || [];
    const el = n ? document.querySelector(`#job-list .job:nth-child(${n}) [data-job-key="${jk}"]`)
      : document.querySelector(`[data-key="${k}"]`);
    return !el || (el.type === 'checkbox' ? el.checked !== !!v : el.value !== String(v));
  }).map(([k]) => k), want);
  check(`Every detail (${want.length}) has its own box showing it`, !unbound.length, `no box or wrong value: ${unbound.join(', ')}`);

  // The top menu's links land with the section's first line clear of the sticky menu.
  const cut = [];
  for (const href of await opt.$$eval('.menu a', (as) => as.map((a) => a.getAttribute('href')))) {
    await opt.evaluate(() => window.scrollTo(0, 0));
    await opt.click(`.menu a[href="${href}"]`);
    const gap = await opt.evaluate((h) => {
      const section = document.querySelector(h);
      const first = section.querySelector('legend, .ifapp, .pair-head') || section;
      return Math.round(Math.min(section.getBoundingClientRect().top, first.getBoundingClientRect().top) - document.querySelector('.menu').getBoundingClientRect().bottom);
    }, href);
    if (gap < 4) cut.push(`${href}: ${gap}px`);
  }
  check('Top menu links show each section\'s title clear of the menu', !cut.length, cut.join(', '));

  // Upazila/P.S. offers the chosen district's upazilas.
  const upazilas = () => opt.evaluate(() => [...document.querySelector('[data-key="present.upazila"]').options].map((o) => o.value));
  const inDhaka = await upazilas();
  await opt.selectOption('[data-key="present.district"]', 'Rajshahi');
  const inRajshahi = await upazilas();
  const cleared = await opt.inputValue('[data-key="present.upazila"]');
  await opt.selectOption('[data-key="present.district"]', profile.present.district);
  await opt.selectOption('[data-key="present.upazila"]', profile.present.upazila);
  check('Upazila/P.S. lists only the chosen district\'s upazilas',
    inDhaka.includes('Savar') && !inDhaka.includes('Paba') && inRajshahi.includes('Paba') && !inRajshahi.includes('Savar') && cleared === '',
    JSON.stringify({ dhaka: inDhaka.length, rajshahi: inRajshahi.length, cleared }));

  // Every box round-trips: editing anything saves the whole form back unchanged.
  await opt.fill('[data-key="nameEn"]', 'X');
  await opt.fill('[data-key="nameEn"]', profile.nameEn);
  await settled();
  const expected = clean({ ...profile, photo: undefined, signature: undefined, confirmMobile: profile.mobile,
    jobs: profile.jobs.map((j) => ({ ...j, continuing: !!j.continuing })) });
  const roundTrip = clean(await stored());
  check('The form saves every detail back exactly', JSON.stringify(roundTrip) === JSON.stringify(expected),
    `saved:    ${JSON.stringify(roundTrip)}\n    expected: ${JSON.stringify(expected)}`);

  await opt.check('[data-key="permanentSameAsPresent"]');
  await settled();
  check('"Same as Present Address" locks the permanent address and saves',
    (await stored()).permanentSameAsPresent === true && await opt.locator('#permanent-box').evaluate((f) => f.disabled));
  await opt.uncheck('[data-key="permanentSameAsPresent"]');

  await opt.uncheck('[data-toggle="masters"]');
  await settled();
  const noMasters = (await stored()).masters;
  await opt.check('[data-toggle="masters"]');
  await settled();
  check('Unticking Masters "If Applicable" saves no masters; ticking brings it back',
    noMasters === null && (await stored()).masters.exam === 'M.Sc', JSON.stringify(noMasters));

  await opt.selectOption('[data-key="ssc.result"]', '1st Division');
  await settled();
  const division = (await stored()).ssc;
  await opt.selectOption('[data-key="ssc.result"]', 'GPA(out of 5)');
  await opt.fill('[data-key="ssc.gpa"]', '5.00');
  await settled();
  check('GPA box only counts for GPA results', division.gpa === undefined && (await stored()).ssc.gpa === '5.00', JSON.stringify(division));

  await opt.selectOption('[data-has="passport"]', 'Yes');
  await opt.fill('[data-key="passport"]', 'A1234567');
  await settled();
  const withPassport = (await stored()).passport;
  await opt.selectOption('[data-has="passport"]', 'No');
  await settled();
  check('Passport: number saved on "Yes", dropped on "No"', withPassport === 'A1234567' && (await stored()).passport === undefined);

  await opt.selectOption('[data-key="maritalStatus"]', 'Married');
  const spouseShown = await opt.locator('[data-key="spouseName"]').isVisible();
  await opt.fill('[data-key="spouseName"]', 'MST. SPOUSE');
  await opt.selectOption('[data-key="quota"]', 'Ethnic Minority');
  const quotaLabel = await opt.locator('[data-key="quotaDetails"]').evaluate((box) => box.previousElementSibling.textContent);
  await opt.fill('[data-key="quotaDetails"]', 'Chakma');
  await settled();
  const married = await stored();
  await opt.selectOption('[data-key="maritalStatus"]', profile.maritalStatus);
  await opt.selectOption('[data-key="quota"]', profile.quota);
  await settled();
  const back = await stored();
  check('"Married" opens [Spouse Name], Ethnic Minority opens [Ethnicity Name]; both drop when changed back',
    spouseShown && married.spouseName === 'MST. SPOUSE' && quotaLabel === '[Ethnicity Name]' && married.quotaDetails === 'Chakma' &&
    back.spouseName === undefined && back.quotaDetails === undefined, JSON.stringify({ spouseShown, quotaLabel, married: married.spouseName }));

  await opt.click('#add-job');
  await job(3, 'designation').fill('Trainee');
  await job(3, 'from').fill('2018-01-01');
  await settled();
  const three = (await stored()).jobs;
  await opt.click('#job-list .job:nth-child(3) [data-act="up"]');
  await settled();
  const moved = (await stored()).jobs.map((j) => j.designation);
  await opt.click('#job-list .job:nth-child(2) [data-act="remove"]');
  await settled();
  const after = (await stored()).jobs.map((j) => j.designation);
  check('Jobs can be added, moved and removed',
    three.length === 3 && three[2].from === '2018-01-01' && moved.join() === 'Software Engineer,Trainee,Intern' &&
    after.join() === 'Software Engineer,Intern', JSON.stringify({ moved, after }));

  // A photo is saved exactly as chosen; resizing is offered, and only done when asked.
  const bigPhoto = fs.readFileSync(path.join(__dirname, 'fixtures', 'big-photo.jpg')).toString('base64');
  const photoNow = () => opt.evaluate(async () => {
    const { photo } = await chrome.storage.local.get('photo');
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = photo.dataUrl; });
    // How white the left edge is: fitting a tall photo into a square leaves white borders.
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const px = c.getContext('2d').getImageData(0, 100, 8, 100).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
    return { b64: photo.dataUrl.split(',')[1], w: img.naturalWidth, h: img.naturalHeight,
      kb: Math.round((photo.dataUrl.length - photo.dataUrl.indexOf(',') - 1) * 0.75 / 1024),
      jpeg: photo.dataUrl.startsWith('data:image/jpeg'), leftEdge: Math.round(sum / (px.length / 4)),
      info: document.querySelector('.upload[data-key=photo] .info').textContent };
  });
  const photoButton = (text) => opt.locator('.upload[data-key=photo] .info button', { hasText: text });
  await opt.setInputFiles('.upload[data-key=photo] input', path.join(__dirname, 'fixtures', 'big-photo.jpg'));
  await opt.waitForFunction(() => /Teletalk wants/.test(document.querySelector('.upload[data-key=photo] .info').textContent));
  const chosen = await photoNow();
  check('A 640×800, 342 KB photo is saved as chosen, with Fit and Crop offered',
    chosen.b64 === bigPhoto && chosen.w === 640 && /Fit to 300×300/.test(chosen.info) && /Crop to 300×300/.test(chosen.info),
    JSON.stringify({ ...chosen, b64: undefined }));

  await photoButton('Fit to 300×300').click();
  await opt.waitForFunction(() => /fitted whole/.test(document.querySelector('.upload[data-key=photo] .info').textContent));
  const fit = await photoNow();
  // Undo and the other resize survive reloading the page; both work from the original.
  const reloadSettings = async (expect) => {
    await opt.reload();
    await opt.waitForFunction(() => document.body.dataset.ready);
    await opt.waitForFunction((re) => new RegExp(re).test(document.querySelector('.upload[data-key=photo] .info').textContent), expect);
    return opt.textContent('.upload[data-key=photo] .info');
  };
  const afterReload = await reloadSettings('fitted whole');
  await photoButton('Crop instead').click();
  await opt.waitForFunction(() => /cropped to fill/.test(document.querySelector('.upload[data-key=photo] .info').textContent));
  const crop = await photoNow();
  const afterSecondReload = await reloadSettings('cropped to fill');
  await photoButton('Undo').click();
  await opt.waitForFunction(() => /Teletalk wants/.test(document.querySelector('.upload[data-key=photo] .info').textContent));
  const undone = await photoNow();
  check('Fit: 300×300 JPEG under 100 KB with white borders; Crop: 300×300, no borders',
    fit.w === 300 && fit.h === 300 && fit.kb <= 100 && fit.jpeg && fit.leftEdge >= 250 && !/Teletalk wants/.test(fit.info) &&
    crop.w === 300 && crop.h === 300 && crop.kb <= 100 && crop.leftEdge < 250,
    JSON.stringify({ fit: { ...fit, b64: undefined }, crop: { ...crop, b64: undefined } }));
  check('After reloading settings, Undo and "Crop instead" are still offered and work from the original',
    /Undo/.test(afterReload) && /Crop instead/.test(afterReload) && /Undo/.test(afterSecondReload) && /Fit instead/.test(afterSecondReload) &&
    /Resized from 640×800, 342 KB/.test(afterSecondReload) && undone.b64 === bigPhoto,
    JSON.stringify({ afterReload, afterSecondReload, undoneIsOriginal: undone.b64 === bigPhoto }));

  // One that already fits is kept exactly as it is.
  await opt.setInputFiles('.upload[data-key=photo] input', path.join(__dirname, 'photo.jpg'));
  await opt.setInputFiles('.upload[data-key=signature] input', path.join(__dirname, 'signature.jpg'));
  await opt.waitForFunction(() => document.querySelectorAll('.preview.has').length === 2 &&
    !/Resized/.test(document.querySelector('.upload[data-key=photo] .info').textContent));
  const keptAsIs = await a.sw.evaluate(() => chrome.storage.local.get('photo'));
  const fitsInfo = await opt.textContent('.upload[data-key=photo] .info');
  check('A photo that already fits is saved unchanged, with no resize offered',
    keptAsIs.photo.dataUrl.split(',')[1] === fs.readFileSync(path.join(__dirname, 'photo.jpg')).toString('base64') &&
    !/Teletalk wants|Fit to|Crop to/.test(fitsInfo), fitsInfo);
  check('Nothing else changed: the form still matches the test profile', JSON.stringify(clean(await stored())) === JSON.stringify(expected));

  // --- Filling ---
  await tab.close();
  for (const url of [formUrl, framedUrl]) {
    const page = await a.ctx.newPage();
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const badgeOf = (u) => a.sw.evaluate(async (x) => chrome.action.getBadgeText({ tabId: (await chrome.tabs.query({})).find((t) => t.url === x).id }), u);
    if (url === formUrl) {
      await page.waitForTimeout(300);
      const before = await badgeOf(url);
      check('The toolbar button shows GO on an application form', before === 'GO', before);
    }
    const summary = await a.click(url);
    if (url === formUrl) check('After filling, the button shows the count instead of GO', (await badgeOf(url)) === String(summary.filled));
    const frame = page.frames().find((f) => f.url().endsWith('/form.html'));
    const where = url === framedUrl ? ' (inside an iframe)' : '';
    const bad = diff(await formValues(frame));
    check(`Fills the form${where}: ${summary.filled} fields, ${summary.problems} problems`, !bad.length && !summary.problems, bad.join('\n    '));
    if (!where) {
      // The settings page is open: that tab comes forward, no second one.
      const fix = page.locator('#taf-panel button', { hasText: 'Edit details in settings' });
      const tabsBefore = a.ctx.pages().length;
      await fix.click();
      await page.waitForTimeout(800);
      const front = await opt.evaluate(() => new Promise((done) => chrome.tabs.getCurrent((t) => done(t.active))));
      check('With the settings page open, "Edit details in settings" brings it forward instead of opening another',
        a.ctx.pages().length === tabsBefore && front && /Edit details/.test(await fix.textContent()),
        `${a.ctx.pages().length} tabs (was ${tabsBefore}), settings tab active: ${front}`);
      // Not open: it opens.
      await opt.close();
      await page.bringToFront();
      const [settingsTab] = await Promise.all([a.ctx.waitForEvent('page'), fix.click()]);
      await settingsTab.waitForLoadState();
      check('The panel\'s "Edit details in settings" opens the settings page', settingsTab.url() === a.optionsUrl, settingsTab.url());
      opt = settingsTab; // used again for the backup checks
      await opt.waitForFunction(() => document.body.dataset.ready === '1');
      opt.on('dialog', (d) => d.accept());
    }
    check(`Shows the report panel, submits nothing${where}`,
      (await page.evaluate(() => !!document.getElementById('taf-panel'))) && !(await frame.evaluate(() => !!window.submitted)));
    if (url === formUrl) {
      await a.click(url);
      const again = diff(await formValues(frame));
      check('A second click changes nothing', !again.length, again.join('\n    '));
    }
    await page.close();
  }

  // --- The upload step: the panel says what it filled; the long "not here" list stays folded ---
  const upload = await a.ctx.newPage();
  await upload.goto(`http://127.0.0.1:${PORT}/upload`);
  await a.click(`http://127.0.0.1:${PORT}/upload`);
  const panel = await upload.evaluate(() => {
    const root = document.getElementById('taf-panel').shadowRoot;
    const folded = [...root.querySelectorAll('details')].map((d) => ({ summary: d.querySelector('summary').textContent, open: d.open }));
    return { filledLine: root.querySelector('.ok').textContent, folded,
      files: [...document.querySelectorAll('input[type=file]')].map((i) => i.files[0]?.name || '') };
  });
  check('Upload step: panel names photo and signature, folds the long "not on this page" list',
    /Filled 2 field\(s\).*photo, signature/.test(panel.filledLine) && panel.files.join() === 'photo.jpg,signature.jpg' &&
    panel.folded.length === 1 && !panel.folded[0].open && /aren't asked on this page/.test(panel.folded[0].summary),
    JSON.stringify(panel));
  await upload.close();

  // --- A rejected image: the panel's button opens settings at Photo & Signature ---
  const small = await a.ctx.newPage();
  await small.goto(`http://127.0.0.1:${PORT}/upload-small`);
  await a.click(`http://127.0.0.1:${PORT}/upload-small`);
  const fixButton = small.locator('#taf-panel button', { hasText: 'Fix in settings: Photo & Signature' });
  const buttons = await small.locator('#taf-panel .fix button', { hasText: 'Fix in settings' }).count();
  // The settings page is already open (opt): it comes forward at that section.
  const tabsBefore = a.ctx.pages().length;
  await fixButton.click();
  await opt.waitForFunction(() => location.hash === '#uploads' && document.getElementById('uploads').classList.contains('flash'));
  await opt.waitForTimeout(300);
  const fixTab = opt;
  const landed = await fixTab.evaluate(() => ({
    url: location.href, flashed: document.getElementById('uploads').classList.contains('flash'),
    visible: document.getElementById('uploads').getBoundingClientRect().top < innerHeight,
  }));
  check('A rejected photo\'s "Fix in settings" button opens settings at Photo & Signature',
    buttons === 1 && landed.url === `${a.optionsUrl}#uploads` && landed.flashed && landed.visible && a.ctx.pages().length === tabsBefore,
    JSON.stringify({ buttons, ...landed, tabs: a.ctx.pages().length, tabsBefore }));
  await small.close();
  // An address problem goes to its own box (Permanent Address), not the top of the address part.
  await opt.evaluate(() => chrome.runtime.sendMessage({ type: 'open-settings', section: 'permanent-box' }));
  const atPermanent = await opt.waitForFunction(() => location.hash === '#permanent-box' &&
    document.getElementById('permanent-box').classList.contains('flash')).then(() => true, () => false);
  check('"Fix in settings: Permanent Address" lands on the Permanent Address box', atPermanent);

  // --- Backup to a fresh browser ---
  const [download] = await Promise.all([opt.waitForEvent('download'), opt.click('#export')]);
  const backup = path.join(TMP, 'backup.json');
  await download.saveAs(backup);
  await a.ctx.close();

  const b = await launch('pc2');
  const opt2 = await b.ctx.newPage();
  await opt2.goto(b.optionsUrl);
  await opt2.waitForFunction(() => document.body.dataset.ready);
  await opt2.setInputFiles('#import', backup);
  await opt2.waitForFunction(() => /Restored/.test(document.querySelector('#status').textContent));
  const restored = await opt2.textContent('#status');
  check('Backup restores details, photo and signature in a fresh browser',
    restored === 'Restored details + photo + signature.', restored);
  const page = await b.ctx.newPage();
  await page.goto(formUrl);
  await b.click(formUrl);
  const bad = diff(await formValues(page.mainFrame()));
  check('The fresh browser fills the form too', !bad.length, bad.join('\n    '));

  // --- Ready to apply: lists what's still empty, by section, until nothing is ---
  await opt2.reload();
  await opt2.waitForFunction(() => document.body.dataset.ready);
  const ready = () => opt2.textContent('#readiness');
  const listed = await ready();
  // A tag takes you to its box: in view, focused, outlined.
  await opt2.evaluate(() => window.scrollTo(0, 0));
  await opt2.click('#readiness button.item:has-text("Job 2 Address")');
  await opt2.waitForFunction(() => {
    const r = document.querySelector('#job-list .job:nth-child(2) [data-job-key="address"]').getBoundingClientRect();
    return r.top > 60 && r.bottom < innerHeight;
  }, null, { timeout: 4000 }).catch(() => {});
  const atBox = await opt2.evaluate(() => {
    const box = document.querySelector('#job-list .job:nth-child(2) [data-job-key="address"]');
    const r = box.getBoundingClientRect();
    return { focused: document.activeElement === box, inView: r.top > 60 && r.bottom < innerHeight, flashed: box.classList.contains('flash-field') };
  });
  check('Clicking a "Still to do" tag shows that box, focused and outlined', atBox.focused && atBox.inView && atBox.flashed, JSON.stringify(atBox));
  // "Next" in the menu bar goes on to the next missing box without scrolling back up.
  await opt2.evaluate(() => window.scrollTo(0, 0));
  await opt2.click('#readiness button.item:has-text("Job 1 Job Description")');
  const nextLabel = await opt2.textContent('#next-todo');
  await opt2.click('#next-todo');
  const nextFocused = await opt2.evaluate(() => document.activeElement === document.querySelector('#job-list .job:nth-child(2) [data-job-key="address"]'));
  await opt2.click('#next-todo');
  const wrapped = await opt2.evaluate(() => document.activeElement === document.querySelector('#job-list .job:nth-child(1) [data-job-key="responsibilities"]'));
  check('"Next" in the menu bar goes to the next missing box, then wraps round',
    nextLabel === '2 still to do · Next ↓' && nextFocused && wrapped, JSON.stringify({ nextLabel, nextFocused, wrapped }));
  await opt2.fill('#job-list .job:nth-child(1) [data-job-key="responsibilities"]', 'Web development');
  await opt2.fill('#job-list .job:nth-child(2) [data-job-key="address"]', 'Dhaka');
  const done = await ready();
  const nextGone = await opt2.locator('#next-todo').isHidden();
  await opt2.click('.upload[data-key=photo] .remove');
  const noPhoto = await ready();
  await opt2.click('#readiness a[href="#uploads"]');
  const flashed = await opt2.waitForFunction(() => document.getElementById('uploads').classList.contains('flash'), null, { timeout: 3000 })
    .then(() => true, () => false);
  check('Ready check lists what\'s empty, says "Ready to apply" when nothing is, and links to the section',
    /Still to do before applying2/.test(listed) && /Job 1 Job Description/.test(listed) && /Job 2 Address/.test(listed) &&
    /Ready to apply/.test(done) && nextGone && /Photonot saved/.test(noPhoto) && !/Signaturenot saved/.test(noPhoto) && flashed,
    JSON.stringify({ listed, done, noPhoto, flashed }));

  // --- Every dropdown offers the real form's options, in the form's order ---
  // Compared with the saved form dropdowns (test/fixtures). The form writes
  // "Cox`s Bazar"; the settings page shows "Cox's Bazar".
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'teletalk-form-dropdowns.html'), 'utf8');
  const tidy = (t) => t.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/`/g, "'").replace(/\s+/g, ' ').trim();
  const formOptions = (name) => [...new RegExp(`<select[^>]*name="${name.replace(/[[\]]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</select>`).exec(fixture)[1]
    .matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].filter(([, attrs]) => /value="[^"]+"/.test(attrs)).map(([, attrs, t]) => [tidy(t), /value="([^"]*)"/.exec(attrs)[1]]);
  const formList = (name) => {
    const m = new RegExp(`var\\s+${name}\\s*=\\s*`).exec(fixture);
    let depth = 0;
    let j = m.index + m[0].length;
    for (; j < fixture.length; j++) { if (fixture[j] === '[') depth++; else if (fixture[j] === ']' && --depth === 0) break; }
    return require('vm').runInNewContext(`(${fixture.slice(m.index + m[0].length, j + 1)})`);
  };
  const settings = await b.ctx.newPage();
  await settings.goto(b.optionsUrl);
  await settings.waitForFunction(() => document.body.dataset.ready);
  const offered = (sel) => settings.$eval(sel, (el) => [...el.options].map((o) => o.value).filter(Boolean));
  const misordered = [];
  const compare = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) misordered.push(`${what}: got ${JSON.stringify(got.slice(0, 6))}…, form ${JSON.stringify(want.slice(0, 6))}…`); };
  const SAME = {
    '[data-key="nationality"]': 'nationality', '[data-key="religion"]': 'religion', '[data-key="gender"]': 'gender',
    '[data-has="nid"]': 'nid', '[data-has="birthReg"]': 'breg', '[data-has="passport"]': 'passport',
    '[data-key="maritalStatus"]': 'marital_status', '[data-key="quota"]': 'quota', '[data-key="departmentalStatus"]': 'dep_status',
    '[data-key="present.district"]': 'present_district', '[data-key="permanent.district"]': 'permanent_district',
    '[data-key="ssc.exam"]': 'ssc_exam', '[data-key="ssc.board"]': 'ssc_board', '[data-key="ssc.result"]': 'ssc_result_type',
    '[data-key="hsc.exam"]': 'hsc_exam', '[data-key="hsc.board"]': 'hsc_board', '[data-key="hsc.result"]': 'hsc_result_type',
    '[data-key="graduation.institute"]': 'gra_institute', '[data-key="graduation.subject"]': 'mas_subject',
    '[data-key="graduation.result"]': 'gra_result_type', '[data-key="graduation.duration"]': 'gra_duration',
    '[data-key="masters.exam"]': 'mas_exam', '[data-key="masters.institute"]': 'mas_institute', '[data-key="masters.subject"]': 'mas_subject',
    '[data-key="masters.result"]': 'mas_result_type', '[data-key="masters.duration"]': 'mas_duration',
    '[data-job-key="employmentType"]': 'job[0][employment_type]',
  };
  for (const [sel, name] of Object.entries(SAME)) compare(sel, await offered(sel), formOptions(name).map(([t]) => t));
  // Years: the form's years (limited by this post's age rules) in the same order, within the page's longer run.
  for (const level of ['ssc', 'hsc', 'graduation', 'masters']) {
    const got = await offered(`[data-key="${level}.year"]`);
    const want = formOptions(`${level === 'graduation' ? 'gra' : level === 'masters' ? 'mas' : level}_year`).map(([t]) => t);
    compare(`${level}.year`, got.slice(got.indexOf(want[0]), got.indexOf(want[0]) + want.length), want);
  }
  // Graduation exams: the form's, in its order, with other forms' exams placed by their codes.
  const gradExams = await offered('[data-key="graduation.exam"]');
  compare('graduation.exam', gradExams.filter((e) => formOptions('gra_exam').some(([t]) => t === e)), formOptions('gra_exam').map(([t]) => t));
  // Upazila/P.S. for every district, as the form's onChangeDistrict lists them.
  const upazilaList = formList('upazilaThanaList');
  for (const d of formList('districtList')) {
    await settings.selectOption('[data-key="present.district"]', tidy(d.dist_name));
    compare(`upazilas of ${d.dist_name}`, await offered('[data-key="present.upazila"]'),
      upazilaList.filter((u) => u.dist_code === d.dist_code).map((u) => tidy(u.thana)));
  }
  // Group/Subject for every exam, by the form's onChangeExamTypeSSC/HSC rules.
  const groupRule = { ssc: (code) => (['3', '6'].includes(code) ? 'V' : 'G'), hsc: (code) => ({ 4: 'T', 7: 'M', 10: 'M', 8: 'V' })[code] || 'G' };
  let exams = 0;
  for (const level of ['ssc', 'hsc']) {
    const list = formList(level === 'ssc' ? 'subjectGroupSSC' : 'subjectGroupHSC');
    for (const [exam, code] of formOptions(`${level}_exam`)) {
      exams++;
      await settings.selectOption(`[data-key="${level}.exam"]`, exam);
      compare(`${level} groups for ${exam}`, await offered(`[data-key="${level}.group"]`),
        list.filter((g) => g.type === groupRule[level](code) || g.type === 'Z').map((g) => tidy(g.value)));
    }
  }
  check(`Every dropdown offers the form's options in its order (${Object.keys(SAME).length + 5} dropdowns, upazilas of ${formList('districtList').length} districts, groups of ${exams} exams)`,
    !misordered.length, misordered.slice(0, 6).join('\n    '));

  await b.ctx.close();

  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
