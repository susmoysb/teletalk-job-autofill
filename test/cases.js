// Layout variants of test/form.html: how real forms hide Masters, lay out the
// job section, or leave sections out. Each case changes the page, fills it with
// the shared engine and checks the result. Exits non-zero on any failure.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { fillPage } = require('../lib/filler');

const FORM = pathToFileURL(path.join(__dirname, 'form.html')).href;
const base = require('./profile.json');

// Stacked job block: label beside each field, day/month/year selects, "Currently working here".
function stackedJobs() {
  document.getElementById('has-exp').closest('p').remove();
  const sel = (n, list, ph) => `<select name="${n}"><option value="">${ph}</option>${list.map((o) => `<option>${o}</option>`).join('')}</select>`;
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const years = Array.from({ length: 30 }, (_, i) => String(2026 - i));
  const date = (p) => sel(`${p}_d`, days, 'Day') + sel(`${p}_m`, months, 'Month') + sel(`${p}_y`, years, 'Year');
  document.getElementById('exp').outerHTML = `<div id="exp">
    <p>Designation <input name="s_desig"></p><p>Organization Name <input name="s_org"></p>
    <p>Organization Address <input name="s_addr"></p><p>Responsibilities <textarea name="s_resp"></textarea></p>
    <p>Start Date ${date('s_from')}</p><p>End Date ${date('s_to')}</p>
    <p><label><input type="checkbox" name="s_cur"> Currently working here</label></p></div>`;
}

// The upload step after the application form, with a stand-in for the page's
// own check: a picture of the wrong size is removed and an error shown.
const uploadPage = (stated) => `<form>
  <p>${stated ? 'Photo (300x300 pixel, max 100KB)' : 'Photo'} <input type="file" name="photo" onchange="check(this, 300, 300, 100)"><span id="photo_err"></span></p>
  <p>${stated ? 'Signature (300x80 pixel, max 60KB)' : 'Signature'} <input type="file" name="signature" onchange="check(this, 300, 80, 60)"><span id="signature_err"></span></p>
</form>
<script>
  function check(input, w, h, kb) {
    const f = input.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth !== w || img.naturalHeight !== h || f.size > kb * 1024) {
        input.value = '';
        document.getElementById(input.name + '_err').textContent = 'Image dimension must be ' + w + 'X' + h + ' pixel and size max ' + kb + 'KB';
      }
    };
    img.src = URL.createObjectURL(f);
  }
</script>`;

// A control's value by name, id or class (checkboxes: checked or not).
// The real form's "Job Experiences" block (from a screenshot): two columns,
// date boxes under "Length of Service", "CurrentlyWorking" puts today's date in
// "to" and locks it, and "ADD MORE" adds another numbered block.
function realJobBlocks() {
  document.getElementById('exp').outerHTML = `<div id="exp">
    <div>Job Experiences <button id="add-more">ADD MORE</button></div><div id="blocks"></div></div>`;
  document.querySelector('form').insertAdjacentHTML('beforeend', '<h3>Declaration</h3><div id="far"></div>');
  const add = () => {
    const i = document.querySelectorAll('[name$="[organization]"]').length;
    const f = document.createElement('fieldset');
    f.innerHTML = `<b>${i + 1}</b>
      <div>Employed on <select name="job[${i}][employment_type]"><option value="">Select</option>
        <option>Regular Basis Under Revenue Budget</option><option>Ad-hoc Basis</option>
        <option>Contractual Basis</option><option>Under Development Project</option><option>Outsourcing</option></select>
        Organization <input name="job[${i}][organization]"></div>
      <div>Designation/Post <input name="job[${i}][designation]"> Address <input name="job[${i}][office_address]"></div>
      <div>Length of Service <input type="date" name="job[${i}][from_date]"> to <input type="date" name="job[${i}][to_date]">
        <input type="checkbox" name="job[${i}][currently_working]"> <i>CurrentlyWorking</i></div>
      <div>Job Description <textarea name="job[${i}][job_description]" maxlength="300"></textarea></div>`;
    // Where ADD MORE puts the new block: below (usual), on top, or past a later heading.
    if (!i || !window.jobsGoTo) document.getElementById('blocks').appendChild(f);
    else if (window.jobsGoTo === 'top') document.getElementById('blocks').prepend(f);
    else document.getElementById('far').appendChild(f);
    const to = f.querySelector('[name$="[to_date]"]');
    f.querySelector('[name$="[currently_working]"]').addEventListener('change', (e) => {
      to.disabled = e.target.checked;
      if (e.target.checked) to.value = new Date().toISOString().slice(0, 10);
    });
    // Like the real form: new blocks follow the "If Applicable" lock.
    if (!document.getElementById('has-exp').checked) f.querySelectorAll('input, select, textarea').forEach((x) => { x.disabled = true; });
  };
  document.getElementById('add-more').addEventListener('click', add);
  document.getElementById('has-exp').addEventListener('change', (e) =>
    document.querySelectorAll('#blocks input, #blocks select, #blocks textarea').forEach((x) => { x.disabled = !e.target.checked; }));
  add();
}

// The real form's dropdowns (parjatan.teletalk.com.bd): their options, labels
// and the hidden "Other" box beside University/Inst., with stand-ins for its
// onchange handlers.
const opts = (list, start = 1) => '<option value selected disabled>Select</option>' +
  list.map((v, i) => (Array.isArray(v) ? `<option value="${v[1]}">${v[0]}</option>` : `<option value="${i + start}">${v}</option>`)).join('');
const row = (label, control) => `<div class="form-group"><label for="${/id="([^"]+)"/.exec(control)[1]}">${label}<span>*</span></label><div>${control}</div></div>`;
const unis = opts([['Dhaka University', 1], ['Rajshahi University', 2], ['University of Dhaka', 3], ['Other', 999]]);
const REAL_DROPDOWNS = `<form>
  <fieldset><legend>Basic Information</legend>
    ${row('Religion', `<select name="religion" id="religion">${opts(['Islam', 'Hinduism', 'Buddhism', 'Christianity', 'Other'])}</select>`)}
    ${row('Quota', `<select name="quota" id="quota">${opts([['Child of Freedom Fighter', 1], ['Physically Challenged', 4], ['Ethnic Minority', 6], ['Not Applicable', 8]])}</select>`)}
    ${row('Departmental Status', `<select name="dep_status" id="dep_status">${opts([['Govt. Employee', 1], ['Semi Govt. Employee', 2], ['Autonomous', 3],
      ['Departmental Candidate', 4], ['Non-Government Organization (NGO)', 7], ['Private Organization', 8], ['Not Applicable', 9]])}</select>`)}
  </fieldset>
  <fieldset><legend>SSC/Equivalent Level</legend>
    ${row('Result', `<select name="ssc_result_type" id="ssc_result_type" onchange="onChangeResult(this)">${opts(['1st Division', '2nd Division', '3rd Division', 'GPA(out of 4)', 'GPA(out of 5)'])}</select>
      <input class="gpaVal" name="ssc_gpa" style="display:none">`)}
  </fieldset>
  <fieldset><legend>Graduation/Equivalent Level</legend>
    ${row('Examination', `<select name="gra_exam" id="gra_exam" onchange="onChangeExamTypeGRA(this)">${opts([['B.Sc Engineering', 1], ['Honors', 4], ['Graduation Equivalent', 8]])}</select>`)}
    ${row('Subject/Degree', `<select name="gra_subject" id="gra_subject" onchange="onChangeSubUni(this)">${opts([])}</select>`)}
    ${row('University/Inst.', `<select name="gra_institute" id="gra_institute" onchange="onChangeSubUni(this)">${unis}</select>
      <input type="text" name="gra_institute_other" id="gra_institute_other" class="other_value" style="display:none">`)}
  </fieldset>
  <fieldset><legend>Masters/Equivalent Level</legend>
    ${row('University/Inst.', `<select name="mas_institute" id="mas_institute" onchange="onChangeSubUni(this)">${unis}</select>
      <input type="text" name="mas_institute_other" id="mas_institute_other" class="other_value" style="display:none">`)}
  </fieldset>
  <fieldset><legend>Job Experiences</legend>
    ${row('Employed on', `<select name="job[0][employment_type]" id="employment_type">${opts(['Regular Basis Under Revenue Budget',
      'Ad-hoc Basis Under Revenue Budget', 'Temporary Basis Under Revenue Budget', 'Work Charged Basis Under Revenue Budget',
      'Temporary Basis Under Development Project', 'Work Charged Basis Under Development Project',
      'Autonomous/Semi Autonomous Organization', 'Private Organization', 'Business/Self Employed'])}</select>`)}
    ${row('Designation/Post', '<input name="job[0][designation]" id="designation">')}
  </fieldset>
</form>
<script>
  function onChangeResult(el) { el.parentElement.querySelector('.gpaVal').style.display = el.value == 4 || el.value == 5 ? '' : 'none'; }
  function onChangeSubUni(el) { const o = el.parentElement.querySelector('.other_value'); if (o) o.style.display = el.value == 999 ? '' : 'none'; }
  function onChangeExamTypeGRA() {
    document.getElementById('gra_subject').innerHTML = '<option value selected disabled>Select</option>' +
      ['Computer Science', 'Computer Science & Engineering', 'Electrical & Electronics Engineering'].map((v, i) => '<option value="' + (i + 1) + '">' + v + '</option>').join('');
  }
</script>`;

// Marital Status and Quota as on the real form: choosing "Married" or a
// freedom fighter quota opens a box beside the dropdown.
const reveal = (id, label, name) => `<div class="col hide" id="${id}"><label><span>${label}</span><input type="text" name="${name}" id="${name}"></label></div>`;
const REAL_REVEALS = `<style>.hide { display: none; }</style><form>
  <fieldset><legend>Basic Information</legend>
    <div class="form-group"><label for="marital_status">Marital Status<span>*</span></label>
      <div><select name="marital_status" id="marital_status" onchange="show(this, 'maritalElm', ['Married'])">${opts([['Single', 'Single'], ['Married', 'Married'], ['Other', 'Other']])}</select></div>
      ${reveal('maritalElm', '[Spouse Name]', 'spouse_name')}</div>
    <div class="form-group"><label for="quota">Quota<span>*</span></label>
      <div><select name="quota" id="quota" onchange="show(this, 'quotaDetailsElm', ['1', '2', '3', '6'])">${opts([['Child of Freedom Fighter', 1],
        ['Child of Martyred Freedom Fighter', 2], ['Child of War Heroine (Birangana)', 3], ['Physically Challenged', 4], ['Ethnic Minority', 6], ['Not Applicable', 8]])}</select></div>
      ${reveal('quotaDetailsElm', '[Freedom Fighter Details] i.e, Name, Certificate No, Date etc', 'quota_details')}</div>
    <div class="form-group"><label for="name">Applicant's Name<span>*</span></label><div><input name="name" id="name"></div></div>
  </fieldset>
</form>
<script>
  function show(el, id, values) { document.getElementById(id).classList.toggle('hide', !values.includes(el.value)); }
</script>`;

const val = (name) => {
  const el = document.querySelector(`[name="${name}"]`) || document.getElementById(name) || document.querySelector(`.${name}`);
  if (!el) return null;
  if (el.type === 'file') return el.files[0]?.name || '';
  return el.type === 'checkbox' ? el.checked : el.value;
};

const CASES = [
  {
    name: 'Upload step states 300x300: a wrong-size photo is not uploaded, and the report says why',
    html: uploadPage(true),
    profile: { photo: 'fixtures/big-photo.jpg', signature: 'signature.jpg' },
    expect: { photo: '', signature: 'signature.jpg' },
    check: (r) => r.problems.some((p) => p.key === 'photo' && /Not uploaded.*640×800.*300×300 px, up to 100 KB/.test(p.error)) &&
      r.filled.some((f) => f.key === 'signature') && !r.filled.some((f) => f.key === 'photo'),
  },
  {
    name: 'The page rejects the photo: reported as rejected, not as filled',
    html: uploadPage(false),
    profile: { photo: 'fixtures/big-photo.jpg', signature: 'signature.jpg' },
    expect: { photo: '', signature: 'signature.jpg' },
    check: (r) => r.problems.some((p) => p.key === 'photo' && /rejected your photo \(640×800/.test(p.error) && /dimension must be 300X300/.test(p.error)) &&
      !r.filled.some((f) => f.key === 'photo'),
  },
  {
    name: 'Right-size photo and signature are uploaded and kept',
    html: uploadPage(true),
    profile: { photo: 'photo.jpg', signature: 'signature.jpg' },
    expect: { photo: 'photo.jpg', signature: 'signature.jpg' },
    check: (r) => !r.problems.length && r.filled.some((f) => f.key === 'photo' && /300×300 px/.test(f.value)) &&
      r.filled.some((f) => f.key === 'signature' && /300×80 px/.test(f.value)),
  },
  {
    name: 'Married and a freedom fighter quota: the boxes they open are filled',
    html: REAL_REVEALS,
    profile: { nameEn: 'MD. EXAMPLE', maritalStatus: 'Married', spouseName: 'MST. SPOUSE BEGUM',
      quota: 'Child of Freedom Fighter', quotaDetails: 'Late MD. X, Certificate 12345, 1990' },
    expect: { marital_status: 'Married', spouse_name: 'MST. SPOUSE BEGUM', quota: '1',
      quota_details: 'Late MD. X, Certificate 12345, 1990', name: 'MD. EXAMPLE' },
  },
  {
    name: 'Single, no quota: the hidden boxes stay empty',
    html: REAL_REVEALS,
    profile: { nameEn: 'MD. EXAMPLE', maritalStatus: 'Single', spouseName: 'left over', quota: 'Not Applicable', quotaDetails: 'left over' },
    expect: { marital_status: 'Single', spouse_name: '', quota: '8', quota_details: '', name: 'MD. EXAMPLE' },
  },
  {
    name: "Real form's dropdowns: wording differences resolved, no wrong guesses",
    html: REAL_DROPDOWNS,
    profile: {
      religion: 'Others', quota: 'Physically Handicapped', departmentalCandidate: 'No',
      ssc: { result: 'First Division' },
      graduation: { exam: 'B.Sc (Engineering/Architecture)', subject: 'Computer Science and Engineering', institute: 'Pabna University of Science and Technology' },
      masters: { institute: 'University of Rajshahi' },
      jobs: [{ designation: 'Engineer', employmentType: 'Temporary' }],
    },
    expect: {
      religion: '5', quota: '4', dep_status: '9', ssc_result_type: '1', gra_exam: '1', gra_subject: '2',
      gra_institute: '999', gra_institute_other: 'Pabna University of Science and Technology', mas_institute: '2',
      'job[0][employment_type]': '',
    },
    check: (r) => r.notes.some((n) => n.key === 'graduation.institute') &&
      r.problems.some((p) => p.key === 'job1.employmentType' && /fits more than one/.test(p.error) && /Development Project/.test(p.error)),
  },
  {
    name: 'Masters behind "If Applicable" (sample form as is)',
    expect: { 'has-level': true, mast_exam: 'M.Sc', mast_duration: '01 Year' },
    check: (r) => r.filled.some((f) => f.key === 'masters (show section)'),
  },
  {
    name: 'Masters behind a Yes/No question',
    setup: () => {
      const b = [...document.querySelectorAll('#edu > div')].at(-1);
      b.querySelector('p').outerHTML = '<p>Do you have a Masters degree? <select id="mq"><option value="">Select</option><option>Yes</option><option>No</option></select></p>';
      document.getElementById('mq').onchange = (e) =>
        b.querySelectorAll('table select, table input').forEach((x) => { x.disabled = e.target.value !== 'Yes'; });
    },
    expect: { mast_exam: 'M.Sc' },
  },
  {
    name: 'Masters locked with no switch: reported as locked',
    setup: () => [...document.querySelectorAll('#edu > div')].at(-1).querySelector('p').remove(),
    expect: { mast_exam: '' },
    check: (r) => r.blocked.some((b) => b.key === 'masters.exam' && /locked/.test(b.reason)),
  },
  {
    name: 'Profile without Masters: switch left alone',
    profile: { ...base, masters: null },
    expect: { 'has-level': false, mast_exam: '' },
  },
  {
    name: 'Jobs in a table: one row each, Post Name untouched',
    expect: {
      post: '', 'has-exp': true, exp1_designation: 'Software Engineer', exp1_cont: true, exp1_resp: '',
      'job[0][employment_type]': 'Private Organization', 'job[0][office_address]': 'Gulshan, Dhaka',
      'job[1][employment_type]': 'Temporary Basis Under Development Project', 'job[1][office_address]': '',
      exp2_designation: 'Intern', exp2_resp: 'Software testing', exp2_from: '01/12/2020', exp2_to: '31/05/2021', exp3_designation: '',
    },
    check: (r) => !r.empty.some((e) => /^3 \|/.test(e)), // spare row 3 is not "to do"
  },
  {
    name: 'Job section half-locked: "If Applicable" still ticked',
    setup: () => document.querySelectorAll('#exp select').forEach((e) => { e.disabled = false; }),
    expect: { 'has-exp': true, exp1_designation: 'Software Engineer', 'job[0][employment_type]': 'Private Organization' },
  },
  {
    name: 'Real job layout: the extension presses ADD MORE for job 2, without submitting',
    setup: realJobBlocks,
    profile: { ...base, jobs: [{ ...base.jobs[0], employmentType: 'Regular' }, { ...base.jobs[1], employmentType: 'Contract' }] },
    check: (r) => r.jobSection === true && r.filled.some((f) => f.key === 'job2 (ADD MORE)') && !r.missing.some((k) => k.startsWith('job')) && !r.problems.length,
    // A second fill finds both blocks there and adds no third.
    again: () => {},
    expect: {
      'job[0][employment_type]': 'Regular Basis Under Revenue Budget', 'job[0][designation]': 'Software Engineer',
      'job[0][organization]': 'Example Tech Ltd.', 'job[0][office_address]': 'Gulshan, Dhaka',
      'job[0][from_date]': '2021-07-01', 'job[0][currently_working]': true,
      'job[1][employment_type]': 'Contractual Basis', 'job[1][designation]': 'Intern', 'job[1][job_description]': 'Software testing',
      'job[1][from_date]': '2020-12-01', 'job[1][to_date]': '2021-05-31', 'job[1][currently_working]': false,
    },
    checkAgain: (r) => !r.filled.some((f) => /ADD MORE/.test(f.key)) && !r.missing.some((k) => k.startsWith('job')) && !r.problems.length,
  },
  ...[['top', 'on top of job 1'], ['far', 'under a later heading']].map(([where, text]) => ({
    name: `ADD MORE puts the new block ${text}: job 2 is filled there, and a second click adds no third`,
    init: `window.jobsGoTo = '${where}'`,
    setup: realJobBlocks,
    profile: { ...base, jobs: [{ ...base.jobs[0], employmentType: 'Regular' }, { ...base.jobs[1], employmentType: 'Contract' }] },
    check: (r) => r.filled.some((f) => f.key === 'job2 (ADD MORE)') && !r.missing.some((k) => k.startsWith('job')) && !r.problems.length,
    again: () => {},
    expect: {
      'job[0][designation]': 'Software Engineer', 'job[0][currently_working]': true,
      'job[1][employment_type]': 'Contractual Basis', 'job[1][designation]': 'Intern', 'job[1][job_description]': 'Software testing',
      'job[1][from_date]': '2020-12-01', 'job[1][to_date]': '2021-05-31', 'job[1][currently_working]': false,
    },
    checkAgain: (r) => !r.filled.some((f) => /ADD MORE/.test(f.key)) && !r.missing.some((k) => k.startsWith('job')) && !r.problems.length,
  })),
  {
    name: 'Job description longer than the form allows is cut to 300 and flagged',
    setup: realJobBlocks,
    profile: { ...base, jobs: [{ ...base.jobs[0], employmentType: 'Private', responsibilities: 'x'.repeat(350) }] },
    expect: { 'job[0][job_description]': 'x'.repeat(300) },
    check: (r) => r.notes.some((n) => n.key === 'job1.responsibilities' && /300-character/.test(n.note)),
  },
  {
    name: 'Unknown "Employed on" value: every option is listed',
    setup: realJobBlocks,
    check: (r) => r.problems.some((p) => p.key === 'job1.employmentType' &&
      ['Regular Basis Under Revenue Budget', 'Ad-hoc Basis', 'Contractual Basis', 'Under Development Project', 'Outsourcing']
        .every((o) => p.error.includes(o))),
  },
  {
    name: 'Jobs in a stacked block with date dropdowns',
    setup: stackedJobs,
    expect: { s_desig: 'Software Engineer', s_from_d: '01', s_from_m: 'Jul', s_from_y: '2021', s_cur: true, s_to_y: '' },
    check: (r) => r.missing.includes('job2.designation'),
  },
  {
    name: 'A job that ended, stacked block',
    setup: stackedJobs,
    profile: { ...base, jobs: [{ designation: 'Engineer', organization: 'Org', address: 'Dhaka', responsibilities: 'Dev', from: '2019-03-15', to: '2022-08-09' }] },
    expect: { s_addr: 'Dhaka', s_resp: 'Dev', s_to_d: '09', s_to_m: 'Aug', s_to_y: '2022', s_cur: false },
  },
  {
    name: 'Form without a job section: nothing touched',
    setup: () => {
      document.getElementById('has-exp').closest('p').remove();
      document.getElementById('exp').remove();
      [...document.querySelectorAll('h3')].find((h) => h.textContent === 'Job Experience').remove();
    },
    expect: { post: '' },
    check: (r) => !r.filled.some((f) => f.key.startsWith('job')) && r.jobSection === false,
    panel: { has: /no Job Experience section/, not: /no ADD MORE found|job1:/ },
  },
  {
    name: 'Panel buttons after the extension was reloaded: they say so instead of doing nothing',
    init: () => { window.chrome = { runtime: { sendMessage: () => { throw new Error('Extension context invalidated.'); } } }; },
    panel: { click: 'Edit details in settings', has: /The extension was reloaded: click its toolbar button again/, not: /^$/ },
  },
  {
    name: 'Profile without jobs: switch left alone',
    profile: { ...base, jobs: [] },
    expect: { 'has-exp': false, exp1_designation: '' },
  },
  {
    name: 'Badly written job date is reported',
    profile: { ...base, jobs: [{ designation: 'X', from: '01/07/2021' }] },
    check: (r) => r.problems.some((p) => p.key === 'job1.from'),
  },
];

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const c of CASES) {
    const page = await browser.newPage();
    if (c.html) await page.setContent(c.html);
    else await page.goto(FORM);
    if (c.init) await page.evaluate(c.init);
    if (c.setup) await page.evaluate(c.setup);
    let report = await fillPage(page, c.profile || base, __dirname);
    const errors = [];
    if (c.check && !c.check(report)) errors.push(`report check failed: ${JSON.stringify({ missing: report.missing, blocked: report.blocked, problems: report.problems })}`);
    if (c.panel) {
      const text = await page.evaluate(([r, click]) => {
        globalThis.TAF_ENGINE.showReport(r);
        const root = document.getElementById('taf-panel').shadowRoot;
        if (click) [...root.querySelectorAll('button')].find((b) => b.textContent === click).click();
        return root.textContent;
      }, [report, c.panel.click]);
      if (!c.panel.has.test(text) || c.panel.not.test(text)) errors.push(`panel text: ${text}`);
    }
    if (c.again) {
      await page.evaluate(c.again);
      report = await fillPage(page, c.profile || base, __dirname);
      if (c.checkAgain && !c.checkAgain(report)) errors.push(`second fill check failed: ${JSON.stringify({ missing: report.missing, problems: report.problems })}`);
    }
    for (const [name, want] of Object.entries(c.expect || {})) {
      const actual = await page.evaluate(val, name);
      if (actual !== want) errors.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
    }
    if (!report.filled.length) errors.push('nothing filled');
    if (await page.evaluate(() => !!window.submitted)) errors.push('form was submitted');
    console.log(`${errors.length ? '✗' : '✓'} ${c.name}${errors.map((e) => `\n    ${e}`).join('')}`);
    failed += errors.length ? 1 : 0;
    await page.close();
  }
  await browser.close();
  console.log(failed ? `\n${failed} case(s) failed` : `\nAll ${CASES.length} cases passed`);
  process.exit(failed ? 1 : 0);
})();
