// Settings page: a form for the profile (saved automatically to
// storage.local.profile), photo and signature as {name, dataUrl} in
// storage.local.photo / .signature, backup export/import, and the same profile
// as JSON under "Advanced".

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const statusEl = $('#status');

function status(msg, kind = '') {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

// --- What the form asks: one entry per field, keyed by its place in the profile ---

const F = (key, label, opts = {}) => ({ key, label, ...opts });
const GPA = { inputmode: 'decimal', pattern: '\\d(\\.\\d{1,2})?' };

// Dropdowns hold the form's own options (lib/lists.js, copied from a real
// Teletalk form by scripts/form-lists.js), so answers match it word for word.
const FORM = globalThis.TAF_LISTS;
const THIS_YEAR = new Date().getFullYear();
// Oldest first, as the form lists years.
const YEARS = Array.from({ length: THIS_YEAR - 1974 }, (_, i) => String(1975 + i));
const examNames = (level) => FORM[level].exams.map(([name]) => name);
const examCode = (level, name) => (FORM[level].exams.find(([n]) => n === name) || [])[1];

// The form's rule for which groups an exam offers: vocational exams get
// vocational trades, diplomas get technology or medical subjects.
const GROUP_TYPE = {
  ssc: (code) => (['3', '6'].includes(code) ? 'V' : 'G'),
  hsc: (code) => ({ 4: 'T', 7: 'M', 10: 'M', 8: 'V' })[code] || 'G',
};
const groupsFor = (level) => (get) => {
  const type = GROUP_TYPE[level](examCode(level, get(`${level}.exam`)));
  return FORM[level].groups.filter(([, t]) => t === type).map(([name]) => name);
};

// Graduation exams this form's post doesn't allow but other Teletalk forms
// list, with their Teletalk codes: they go in code order, as on those forms.
const MORE_GRAD_EXAMS = [['B.Sc (Agricultural Science)', '2'], ['M.B.B.S/B.D.S', '3'], ['Pass Course', '5'], ['Fazil', '6']];
const GRAD_EXAMS = [...FORM.graduation.exams, ...MORE_GRAD_EXAMS].sort((a, b) => a[1] - b[1]).map(([name]) => name);

// Suggestions for boxes that stay typed (none at the moment).
const LISTS = {};

const SELECT = (options, more = {}) => ({ type: 'select', options, ...more });

const address = (p) => [
  F(`${p}.careOf`, 'Care Of'),
  F(`${p}.village`, 'Village/ Road/ House/ Flat', { type: 'textarea', rows: 2 }),
  F(`${p}.district`, 'District', SELECT(FORM.districts)),
  F(`${p}.upazila`, 'Upazila/P.S.', SELECT((get) => FORM.upazilas[get(`${p}.district`)] || [], { from: `${p}.district` })),
  F(`${p}.postOffice`, 'Post Office'),
  F(`${p}.postCode`, 'Post Code', { inputmode: 'numeric', pattern: '\\d{4}', maxlength: 4 }),
];

// Two columns, in the form's order: Examination | Board, Roll No | Result, ...
const school = (s) => [
  F(`${s}.exam`, 'Examination', SELECT(examNames(s))),
  F(`${s}.board`, 'Board', SELECT(FORM[s].boards, { other: true })),
  F(`${s}.roll`, 'Roll No', { inputmode: 'numeric' }),
  F(`${s}.result`, 'Result', SELECT(FORM[s].results, { reveal: { key: `${s}.gpa`, when: 'gpa', placeholder: 'GPA', mark: true, ...GPA } })),
  F(`${s}.group`, 'Group/Subject', SELECT(groupsFor(s), { from: `${s}.exam`, other: true })),
  F(`${s}.year`, 'Passing Year', SELECT(YEARS)),
];

const university = (s, exams) => [
  F(`${s}.exam`, 'Examination', SELECT(exams)),
  F(`${s}.subject`, 'Subject/Degree', SELECT(FORM.subjects, { other: true })),
  F(`${s}.institute`, 'University/Inst.', SELECT(FORM.universities, { other: true })),
  F(`${s}.result`, 'Result', SELECT(FORM[s].results, { reveal: { key: `${s}.gpa`, when: 'gpa', placeholder: 'CGPA', mark: true, ...GPA } })),
  F(`${s}.year`, 'Passing Year', SELECT(YEARS)),
  F(`${s}.duration`, 'Course Duration', SELECT(FORM[s].durations)),
];

const ID = { inputmode: 'numeric' };

const FIELDS = {
  basic: [
    F('nameEn', "Applicant's Name", { autocomplete: 'name' }),
    F('nameBn', 'আবেদনকারীর নাম (বাংলায়)', { lang: 'bn', placeholder: 'আবেদনকারীর নাম (বাংলায়)' }),
    F('fatherEn', "Father's Name"),
    F('fatherBn', 'পিতার নাম (বাংলায়)', { lang: 'bn', placeholder: 'পিতার নাম (বাংলায়)' }),
    F('motherEn', "Mother's Name"),
    F('motherBn', 'মাতার নাম (বাংলায়)', { lang: 'bn', placeholder: 'মাতার নাম (বাংলায়)' }),
    F('dob', 'Date of Birth', { type: 'date' }),
    F('nationality', 'Nationality', SELECT(FORM.basic.nationalities, { default: 'Bangladeshi' })),
    F('religion', 'Religion', SELECT(FORM.basic.religions)),
    F('gender', 'Gender', SELECT(FORM.basic.genders)),
    // Like the form: Yes/No first, the number box appears beside it on "Yes".
    F('nid', 'National ID', { type: 'idnum', reveal: { label: '[National ID Number]', ...ID, pattern: '\\d{10}|\\d{13}|\\d{17}' } }),
    F('birthReg', 'Birth Registration', { type: 'idnum', reveal: { label: '[Birth Registration Number]', ...ID, pattern: '\\d{17}' } }),
    F('passport', 'Passport ID', { type: 'idnum', reveal: { label: '[Passport Number]' } }),
    F('maritalStatus', 'Marital Status', { type: 'select', options: FORM.basic.maritalStatuses,
      reveal: { key: 'spouseName', when: '^married$', label: '[Spouse Name]' } }),
    F('mobile', 'Mobile Number', { type: 'tel', inputmode: 'numeric', pattern: '01[3-9]\\d{8}', maxlength: 11, placeholder: '01XXXXXXXXX' }),
    F('confirmMobile', 'Confirm Mobile Number', { type: 'mirror', of: 'mobile', hint: 'Filled in from Mobile Number.' }),
    F('email', 'Email', { type: 'email', autocomplete: 'email' }),
    F('quota', 'Quota', { type: 'select', options: FORM.basic.quotas, reveal: { key: 'quotaDetails', when: 'freedom fighter|birangana|war heroine|ethnic',
      label: (v) => (/ethnic/i.test(v) ? '[Ethnicity Name]' : /birangana|heroine/i.test(v) ? '[Birangana Details]' : '[Freedom Fighter Details]'),
      placeholder: 'Name, certificate no, date etc.' } }),
    F('departmentalStatus', 'Departmental Status', SELECT(FORM.basic.departmentalStatuses)),
    F('homeDistrict', 'Home District', { list: 'districts', optional: true, hint: 'Only if a form asks for it. Leave empty to use your permanent address district.' }),
  ],
  present: address('present'),
  permanent: address('permanent'),
  ssc: school('ssc'),
  hsc: school('hsc'),
  graduation: university('graduation', GRAD_EXAMS),
  masters: university('masters', examNames('masters')),
  job: [
    F('employmentType', 'Employed on', SELECT(FORM.employmentTypes)),
    F('organization', 'Organization'),
    F('designation', 'Designation/Post'),
    F('address', 'Address'),
    F('from', 'Length of Service', { type: 'service' }),
    F('responsibilities', 'Job Description', { type: 'textarea', rows: 3, wide: true, maxlength: 300, counter: true }),
  ],
};

// --- Building the form: one row per field, label beside its box ---

let uid = 0;
const revealLabels = new Map(); // reveal box -> its label, or a function of the answer
const selectSpecs = new Map(); // dropdown -> its field (for options that depend on another answer)

function control(spec, attr) {
  let c;
  if (spec.type === 'select') {
    c = document.createElement('select');
    const list = typeof spec.options === 'function' ? [] : spec.options; // filled by fillChoices
    for (const o of ['', ...list, ...(spec.other ? ['Other'] : [])]) c.add(new Option(o || 'Select', o));
    selectSpecs.set(c, spec);
  } else if (spec.type === 'textarea') {
    c = document.createElement('textarea');
    c.rows = spec.rows || 2;
  } else {
    c = document.createElement('input');
    c.type = spec.type && !['idnum', 'service', 'mirror'].includes(spec.type) ? spec.type : 'text';
  }
  c.setAttribute(attr, spec.key);
  if (spec.list) c.setAttribute('list', `dl-${spec.list}`);
  for (const a of ['pattern', 'inputmode', 'maxlength', 'lang', 'autocomplete', 'placeholder']) if (spec[a]) c.setAttribute(a, spec[a]);
  if (spec.default) c.dataset.default = spec.default;
  if (spec.optional) c.classList.add('opt');
  return c;
}

function checkbox(key, attr, text) {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.setAttribute(attr, key);
  const label = document.createElement('label');
  label.className = 'ifapp';
  label.append(box, ` ${text}`);
  return label;
}

function buildRow(spec, attr) {
  const id = `f${++uid}`;
  // "Other" opens a box for the name, as on the form. The box holds the answer.
  if (spec.other) spec = { ...spec, reveal: { other: true, when: '^other$', placeholder: 'Type the name' } };
  const row = document.createElement('div');
  row.className = `frow${spec.wide ? ' wide' : ''}${spec.right ? ' right' : ''}`;
  const label = document.createElement('label');
  label.className = 'flabel';
  label.htmlFor = id;
  label.textContent = spec.label;
  const ctl = document.createElement('div');
  ctl.className = 'fctl';

  if (spec.reveal) {
    // A box the answer opens beside the dropdown, as on the form: "Yes" opens
    // the ID number, "Married" the spouse name, a GPA result the GPA.
    let main;
    if (spec.type === 'idnum') {
      main = document.createElement('select');
      for (const o of ['', 'Yes', 'No']) main.add(new Option(o || 'Select', o));
      main.dataset.has = spec.key;
    } else main = control(spec, attr);
    main.id = id;
    const r = { key: spec.key, when: '^yes$', ...spec.reveal };
    const tag = document.createElement('span');
    tag.className = 'reveal-label';
    const box = control({ ...r, key: r.other ? spec.key : r.key, type: 'text', list: undefined }, r.other ? 'data-other-for' : attr);
    box.dataset.revealFrom = id;
    box.dataset.when = r.when;
    revealLabels.set(box, r.label || '');
    box.setAttribute('aria-label', typeof r.label === 'string' ? r.label.replace(/[[\]]/g, '') : r.placeholder || spec.label);
    ctl.classList.add('inline');
    if (r.mark) ctl.classList.add('mark');
    if (r.other) ctl.classList.add('other');
    ctl.append(main, tag, box);
  } else if (spec.type === 'service') {
    // As on the form: [from] to [to], with CurrentlyWorking under the "to" box.
    // Neither date can be after today.
    const today = new Date().toISOString().slice(0, 10);
    const from = control({ key: 'from', type: 'date' }, attr);
    from.id = id;
    const to = control({ key: 'to', type: 'date' }, attr);
    to.setAttribute('aria-label', 'to');
    from.max = to.max = today;
    const start = document.createElement('div');
    start.append(from);
    const end = document.createElement('div');
    end.className = 'end';
    const word = document.createElement('span');
    word.className = 'to';
    word.textContent = 'to';
    const now = checkbox('continuing', attr, 'CurrentlyWorking');
    now.className = 'now';
    end.append(word, to, now);
    const wrap = document.createElement('div');
    wrap.className = 'service';
    wrap.append(start, end);
    ctl.append(wrap);
  } else if (spec.type === 'mirror') {
    const m = control({ key: spec.key }, 'data-mirror');
    m.dataset.mirror = spec.of;
    m.id = id;
    m.readOnly = true;
    m.tabIndex = -1;
    m.classList.add('mirror');
    ctl.append(m);
  } else {
    const c = control(spec, attr);
    c.id = id;
    ctl.append(c);
    // "300" under Job Description, counting down like the form's.
    if (spec.counter) {
      const left = document.createElement('span');
      left.className = 'char-length';
      left.dataset.countFor = id;
      ctl.append(left);
    }
  }
  if (spec.hint) {
    const small = document.createElement('small');
    small.textContent = spec.hint;
    ctl.append(small);
  }
  row.append(label, ctl);
  return row;
}

function buildForm() {
  for (const box of $$('#profile [data-fields]')) {
    box.append(...FIELDS[box.dataset.fields].map((spec) => buildRow(spec, 'data-key')));
  }
  for (const [id, items] of Object.entries(LISTS)) {
    const dl = document.createElement('datalist');
    dl.id = `dl-${id}`;
    dl.append(...items.map((v) => new Option(v)));
    document.body.append(dl);
  }
}

// --- Reading and writing values ---

const getPath = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, key, value) {
  const keys = key.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
  o[keys.at(-1)] = value;
}

const read = (el) => (el.type === 'checkbox' ? el.checked : el.value.trim());

// Options of a dropdown that depend on another answer (upazilas of the
// district, groups of the exam). Keeps the choice if it's still offered.
function fillChoices(sel) {
  const spec = selectSpecs.get(sel);
  if (!spec || typeof spec.options !== 'function') return;
  const source = $(`[data-key="${spec.from}"]`)?.value || '';
  if (sel.dataset.source === source) return;
  sel.dataset.source = source;
  const keep = sel.value;
  const list = spec.options((key) => $(`[data-key="${key}"]`)?.value || '');
  sel.replaceChildren(...['', ...list, ...(spec.other ? ['Other'] : [])].map((o) => new Option(o || 'Select', o)));
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
}

function write(el, value) {
  if (el.type === 'checkbox') {
    el.checked = !!value;
    return;
  }
  const v = value ?? el.dataset.default ?? '';
  if (el.tagName !== 'SELECT') {
    el.value = v;
    return;
  }
  fillChoices(el);
  const other = el.parentElement.querySelector('[data-other-for]');
  if (other) other.value = '';
  if (!v) {
    el.value = '';
    return;
  }
  // An answer worded differently ("First Division", "Computer Science and
  // Engineering") picks the form's option; one the form doesn't list goes in
  // "Other"'s box, or stays as it is where there's no "Other".
  const options = [...el.options].filter((o) => o.value && o.value !== 'Other').map((o) => ({ text: o.text, value: o.value }));
  const hit = options.find((o) => o.value === v) || globalThis.TAF_ENGINE.pickAny(options, v).hit;
  if (hit) el.value = hit.value;
  else if (other) {
    el.value = 'Other';
    other.value = v;
  } else {
    el.add(new Option(v, v));
    el.value = v;
  }
}

// Drop empty answers (and sections left empty) so the profile only holds what was filled in.
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    const c = clean(x);
    if (c === '' || c === undefined) continue;
    if (c && typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length) continue;
    out[k] = c;
  }
  return out;
}

const toggle = (name) => $(`[data-toggle="${name}"]`);

// The profile as last loaded or saved. Fields the form has no box for (e.g. a
// job's "organizationType" set in JSON) are kept from here.
let current = {};

function collect() {
  const p = structuredClone(current);
  for (const el of $$('#profile [data-key]')) {
    // A hidden box is not an answer: the GPA of a division/class result, an ID
    // number after "No", a spouse name when not married.
    setPath(p, el.dataset.key, el.closest('[hidden]') ? '' : read(el));
  }
  for (const box of $$('#profile [data-other-for]')) {
    if (!box.hidden && box.value.trim()) setPath(p, box.dataset.otherFor, box.value.trim());
  }
  if (!toggle('masters').checked) p.masters = null;
  delete p.departmentalCandidate; // replaced by departmentalStatus
  p.confirmMobile = p.mobile;
  p.jobs = !toggle('jobs').checked ? [] : $$('#job-list .job').map((card) => {
    const job = { ...card.orig };
    for (const el of $$('[data-job-key]', card)) job[el.dataset.jobKey] = read(el);
    if (job.continuing) job.to = '';
    return job;
  }).filter((job) => Object.entries(clean(job)).some(([k, v]) => k !== 'continuing' || v));
  return clean(p);
}

function render(profile) {
  current = profile || {};
  // Older profiles answered "Departmental candidate: Yes/No".
  if (!current.departmentalStatus && current.departmentalCandidate) {
    current.departmentalStatus = /^yes$/i.test(current.departmentalCandidate) ? 'Departmental Candidate' : 'Not Applicable';
  }
  const fresh = !Object.keys(current).length;
  for (const el of $$('#profile [data-key]')) write(el, getPath(current, el.dataset.key));
  for (const has of $$('[data-has]')) has.value = getPath(current, has.dataset.has) ? 'Yes' : fresh ? '' : 'No';
  toggle('masters').checked = !!current.masters && typeof current.masters === 'object';
  toggle('jobs').checked = !!(current.jobs && current.jobs.length);
  $('#job-list').replaceChildren();
  for (const job of current.jobs || []) addJob(job);
  refresh();
}

// Lock, show or hide what depends on other answers, and colour the boxes.
function refresh() {
  for (const sel of selectSpecs.keys()) fillChoices(sel);
  $('#permanent-box').disabled = $('[data-key="permanentSameAsPresent"]').checked;
  for (const t of $$('[data-toggle]')) $(`[data-gated="${t.dataset.toggle}"]`).disabled = !t.checked;
  for (const box of $$('[data-reveal-from]')) {
    const answer = document.getElementById(box.dataset.revealFrom).value;
    const open = new RegExp(box.dataset.when, 'i').test(answer);
    const label = revealLabels.get(box);
    const tag = box.previousElementSibling;
    tag.textContent = typeof label === 'function' ? label(answer) : label;
    tag.hidden = !open || !tag.textContent;
    box.hidden = !open;
    box.parentElement.classList.toggle('open', open);
  }
  for (const m of $$('[data-mirror]')) m.value = $(`[data-key="${m.dataset.mirror}"]`).value;
  const jobs = $$('#job-list .job');
  jobs.forEach((card, i) => {
    $('.num', card).textContent = i + 1;
    $('[data-act="up"]', card).disabled = i === 0;
    $('[data-act="down"]', card).disabled = i === jobs.length - 1;
    // Like the form: CurrentlyWorking locks "to" showing today's date (not saved).
    const to = $('[data-job-key="to"]', card);
    to.disabled = $('[data-job-key="continuing"]', card).checked;
    if (to.disabled && !to.value) to.value = to.max;
  });
  for (const left of $$('[data-count-for]')) {
    const box = document.getElementById(left.dataset.countFor);
    left.textContent = box.maxLength - box.value.length;
  }
  for (const c of $$('#profile input:not([type=checkbox]):not([type=file]), #profile select, #profile textarea:not(#json)')) {
    c.classList.toggle('filled', !!c.value.trim());
  }
  readiness();
}

// --- Ready to apply: what's still empty, by section ---

const SECTION_NAMES = { basic: 'Basic Information', address: 'Address', education: 'Education', jobs: 'Job Experiences', uploads: 'Photo & Signature' };

// A box's name as the form calls it: its row's label, or the bracketed label
// of a box an answer opened ("[Spouse Name]"), prefixed "Job 2" in a job.
function boxName(el) {
  const row = el.closest('.frow');
  const label = row ? $('.flabel', row).textContent.replace(/\*$/, '').trim() : '';
  let name = label;
  if (el.dataset.revealFrom) {
    const tag = el.previousElementSibling;
    name = tag && tag.textContent ? tag.textContent.replace(/[[\]]/g, '') : `${label} ${el.placeholder || ''}`.trim();
  }
  if (el.dataset.otherFor) name = `${label} (name for Other)`;
  const level = el.closest('[data-fields]')?.dataset.fields;
  if (['ssc', 'hsc', 'graduation', 'masters'].includes(level)) name = `${{ ssc: 'SSC', hsc: 'HSC', graduation: 'Graduation', masters: 'Masters' }[level]} ${name}`;
  const job = el.closest('.job');
  if (job) name = `Job ${$('.num', job).textContent} ${name}`;
  return name;
}

// Bring one box into view and mark it, so it's clear what to fill.
function showField(target) {
  lastShown = target;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (target.matches('input, select, textarea')) target.focus({ preventScroll: true });
  target.classList.remove('flash-field');
  void target.offsetWidth; // restart the animation
  target.classList.add('flash-field');
}

// The missing boxes in page order, for "Next" in the menu bar.
let missingTargets = [];

// "Next": the first missing box after the one you're in (or after the last
// one shown), wrapping round to the first.
let lastShown = null;
$('#next-todo').addEventListener('click', () => {
  const from = document.activeElement && document.activeElement !== document.body && $('#profile').contains(document.activeElement)
    ? document.activeElement : lastShown;
  const after = from && missingTargets.find((t) => t !== from && !t.contains(from) && from.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
  const target = after || missingTargets[0];
  if (target) showField(target);
});

function readiness() {
  const box = $('#readiness');
  if (!box) return;
  const todo = {};
  const add = (section, name, detail, target) => (todo[section] ||= []).push({ name, detail, target });
  // Every box the form will ask for: shown, not locked (same-as-present,
  // unticked Masters/Jobs), not optional, and still empty.
  for (const el of $$('#profile [data-key], #profile [data-job-key], #profile [data-has], #profile [data-other-for]')) {
    if (el.type === 'checkbox' || el.type === 'file' || el.disabled || el.closest('[hidden]') || el.closest('fieldset[disabled]')) continue;
    if (el.classList.contains('opt') || el.dataset.mirror !== undefined || el.value.trim()) continue;
    const section = el.closest('#basic, #address, #education, #jobs');
    if (section) add(section.id, boxName(el), '', el);
  }
  for (const up of $$('.upload')) {
    const what = up.dataset.key === 'photo' ? 'Photo' : 'Signature';
    if (up.dataset.state === 'missing') add('uploads', what, 'not saved', up);
    else if (up.dataset.state === 'wrong') add('uploads', what, up.dataset.problem, up);
  }
  const sections = Object.keys(SECTION_NAMES).filter((k) => todo[k]);
  const count = sections.reduce((n, k) => n + todo[k].length, 0);
  missingTargets = sections.flatMap((k) => todo[k].map((t) => t.target))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const next = $('#next-todo');
  next.hidden = !count;
  next.textContent = `${count} still to do · Next ↓`;
  box.className = count ? 'todo-list' : 'ready';
  if (!count) {
    box.textContent = '✓ Ready to apply: every detail the form asks for is filled in, and the photo and signature fit.';
    return;
  }
  const el = (tag, cls, ...kids) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.append(...kids);
    return e;
  };
  // One row per section: its name links there; each missing item is a tag.
  const groups = sections.map((k) => {
    const link = el('a', 'sec', `${SECTION_NAMES[k]} →`);
    link.href = `#${k}`;
    // Each tag takes you to its own box: scrolled into view, outlined, ready to type in.
    const items = todo[k].map(({ name, detail, target }) => {
      const tag = el('button', detail ? 'item wide' : 'item', el('b', '', name), ...(detail ? [el('span', 'detail', detail)] : []));
      tag.type = 'button';
      tag.title = detail && target.matches('.upload') ? `Show the ${name.toLowerCase()} and its resize options` : `Go to ${name}`;
      tag.addEventListener('click', () => showField(target));
      return el('li', '', tag);
    });
    return el('div', 'group', link, el('ul', '', ...items));
  });
  box.replaceChildren(el('div', 'title', 'Still to do before applying', el('span', 'count', String(count))), ...groups);
}

// --- Jobs ---

function addJob(job = {}) {
  const card = $('#job-template').content.firstElementChild.cloneNode(true);
  card.orig = job;
  $('[data-fields="job"]', card).append(...FIELDS.job.map((spec) => buildRow(spec, 'data-job-key')));
  for (const el of $$('[data-job-key]', card)) write(el, job[el.dataset.jobKey]);
  $('#job-list').append(card);
  return card;
}

$('#add-job').addEventListener('click', () => {
  toggle('jobs').checked = true;
  const card = addJob();
  refresh();
  $('[data-job-key]', card).focus();
  changed();
});

// Ticking "If Applicable" with no jobs yet opens an empty one to fill.
toggle('jobs').addEventListener('change', (e) => {
  if (e.target.checked && !$$('#job-list .job').length) addJob();
  refresh();
});

$('#job-list').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const card = e.target.closest('.job');
  if (act === 'remove') {
    const name = $('[data-job-key="designation"]', card).value || 'this job';
    if (!confirm(`Remove ${name}?`)) return;
    card.remove();
  }
  if (act === 'up' && card.previousElementSibling) card.previousElementSibling.before(card);
  if (act === 'down' && card.nextElementSibling) card.nextElementSibling.after(card);
  refresh();
  changed();
});

// --- Saving: automatic, a moment after the last change ---

// Set once the person types, imports or picks an image, so the page's own
// loading (at the bottom) never overwrites what they just did.
let touched = false;
let saveTimer = null;

function changed() {
  touched = true;
  status('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const profile = collect();
  await chrome.storage.local.set({ profile });
  current = profile;
  status('All changes saved', 'okmsg');
  if ($('#advanced').open && !jsonEdited) showJson();
}

const flush = () => (saveTimer ? saveNow() : Promise.resolve());

$('#profile').addEventListener('input', (e) => {
  if (!e.target.closest('[data-key], [data-job-key], [data-toggle], [data-has], [data-other-for]')) return;
  refresh();
  changed();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    flush();
  }
});
document.addEventListener('visibilitychange', () => document.hidden && flush());

// --- Backup and JSON ---

// Returns the parsed profile or throws a message pointing at the problem.
function parseProfile(text) {
  let p;
  try {
    p = JSON.parse(text);
  } catch (e) {
    const pos = Number((/position (\d+)/.exec(e.message) || [])[1]);
    const line = Number.isFinite(pos) ? ` (line ${text.slice(0, pos).split('\n').length})` : '';
    throw new Error(`Not valid JSON${line}: ${e.message}\nCheck for a missing comma or quote.`);
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('The profile must be a { ... } object.');
  if (p.dob && !/^\d{4}-\d{2}-\d{2}$/.test(p.dob)) throw new Error(`"dob" must look like 1998-05-14 (got "${p.dob}").`);
  if (p.jobs !== undefined && p.jobs !== null) {
    if (!Array.isArray(p.jobs)) throw new Error('"jobs" must be a list: [ { ... }, { ... } ] (or [] for none).');
    p.jobs.forEach((j, i) => {
      for (const k of ['from', 'to']) {
        if (j && j[k] && !/^\d{4}-\d{2}-\d{2}$/.test(j[k])) throw new Error(`Job ${i + 1}: "${k}" must look like 2021-07-01 (got "${j[k]}").`);
      }
    });
  }
  // A profile.json from the terminal tool holds file paths; images live below instead.
  delete p.photo;
  delete p.signature;
  return p;
}

// A backup is one file holding the details, photo and signature, so moving to
// another PC is export here, import there. A plain profile JSON (older backups,
// or profile.json from the terminal tool) imports as details only.
const BACKUP_TAG = 'teletalk-autofill-backup';

$('#import').addEventListener('change', async (e) => {
  touched = true;
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // parseProfile below explains what's wrong
    }
    const isBackup = data && data.format === BACKUP_TAG;
    const profile = parseProfile(isBackup ? JSON.stringify(data.profile) : text);
    const images = {};
    for (const key of isBackup ? ['photo', 'signature'] : []) if (data[key] && data[key].dataUrl) images[key] = data[key];
    clearTimeout(saveTimer);
    saveTimer = null;
    await chrome.storage.local.set({ profile, ...images });
    render(profile);
    for (const box of $$('.upload')) if (images[box.dataset.key]) showUpload(box, images[box.dataset.key]);
    const got = Object.keys(images);
    status(isBackup ? `Restored details${got.length ? ` + ${got.join(' + ')}` : ''}.` : 'Imported details.', 'okmsg');
  } catch (err) {
    status(err.message, 'err');
  }
});

$('#export').addEventListener('click', async () => {
  await flush();
  const { profile, photo, signature } = await chrome.storage.local.get(['profile', 'photo', 'signature']);
  if (!profile) return status('Nothing saved yet.', 'err');
  const backup = { format: BACKUP_TAG, version: 1, profile, photo: photo || null, signature: signature || null };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  a.download = 'teletalk-autofill-backup.json';
  // Firefox needs the link in the page, and cancels the download if the URL is revoked at once.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  const parts = ['details', photo && 'photo', signature && 'signature'].filter(Boolean);
  status(`Backup saved (${parts.join(' + ')}). It holds your NID and address — keep it private.`, 'okmsg');
});

// The JSON view is a fixed template: every detail in the form's order, ""
// when empty (null for unticked Masters), so keys never vanish or move.
// Keys the form has no box for follow at the end.
function profileForJson() {
  const p = collect();
  const out = {};
  const blank = (el) => (el.type === 'checkbox' ? false : '');
  for (const el of $$('#profile [data-key]')) {
    const v = getPath(p, el.dataset.key);
    setPath(out, el.dataset.key, v ?? blank(el));
    if (el.dataset.key === 'mobile') out.confirmMobile = p.confirmMobile ?? '';
  }
  if (p.masters === null) out.masters = null;
  const order = FIELDS.job.flatMap((f) => (f.type === 'service' ? ['from', 'to', 'continuing'] : [f.key]));
  out.jobs = (p.jobs || []).map((job) => {
    const j = {};
    for (const k of order) j[k] = job[k] ?? (k === 'continuing' ? false : '');
    return Object.assign(j, job);
  });
  // Anything else saved (keys from older versions, or added in JSON).
  const merge = (to, from) => {
    for (const [k, v] of Object.entries(from || {})) {
      if (!(k in to)) to[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && to[k] && typeof to[k] === 'object') merge(to[k], v);
    }
  };
  merge(out, p);
  return out;
}

// Kept up to date while you edit the form, unless you're editing the JSON itself.
let jsonEdited = false;
const showJson = () => {
  $('#json').value = JSON.stringify(profileForJson(), null, 2);
  jsonEdited = false;
};
$('#json').addEventListener('input', () => { jsonEdited = true; });

$('#advanced').addEventListener('toggle', async (e) => {
  if (!e.target.open) return;
  await flush();
  showJson();
});

$('#apply-json').addEventListener('click', async () => {
  touched = true;
  try {
    const profile = parseProfile($('#json').value);
    clearTimeout(saveTimer);
    saveTimer = null;
    await chrome.storage.local.set({ profile });
    render(profile);
    showJson();
    status('JSON applied.', 'okmsg');
  } catch (err) {
    status(err.message, 'err');
  }
});

// --- Photo and signature ---

const readDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

const dataUrlKb = (dataUrl) => Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75 / 1024);

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('This file is not an image the browser can open.'));
  img.src = src;
});

// Resize an image to what Teletalk accepts, only when the person asks:
//   fit      exactly w×h, the whole picture scaled in and centred on white
//   crop     exactly w×h, filled, the edges trimmed evenly
//   compress same size, re-saved as a JPEG under the size limit
async function resizeImage(dataUrl, { w, h, kb }, mode) {
  const img = await loadImage(dataUrl);
  const from = { w: img.naturalWidth, h: img.naturalHeight, kb: dataUrlKb(dataUrl) };
  const canvas = document.createElement('canvas');
  canvas.width = mode === 'compress' ? from.w : w;
  canvas.height = mode === 'compress' ? from.h : h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingQuality = 'high';
  const scale = mode === 'compress' ? 1 : mode === 'crop' ? Math.max(w / from.w, h / from.h) : Math.min(w / from.w, h / from.h);
  g.drawImage(img, (canvas.width - from.w * scale) / 2, (canvas.height - from.h * scale) / 2, from.w * scale, from.h * scale);
  let out;
  for (let q = 0.92; q >= 0.3; q -= 0.08) {
    out = canvas.toDataURL('image/jpeg', q);
    if (dataUrlKb(out) <= kb) break;
  }
  return { dataUrl: out, from, mode };
}

const rules = (box) => ({ w: Number(box.dataset.w), h: Number(box.dataset.h), kb: Number(box.dataset.kb) });

async function saveImage(box, item) {
  await chrome.storage.local.set({ [box.dataset.key]: item });
  showUpload(box, item);
}

// A resized image keeps the one you chose (item.original), so Undo and
// "Crop instead" still work after the page is reloaded, always from the original.
async function resizeSaved(box, source, mode) {
  try {
    const result = await resizeImage(source.dataUrl, rules(box), mode);
    const item = {
      name: `${source.name.replace(/\.[^.]+$/, '')}.jpg`,
      dataUrl: result.dataUrl,
      resized: { mode, from: result.from },
      original: { name: source.name, dataUrl: source.dataUrl },
    };
    try {
      await saveImage(box, item);
      status('Image resized', 'okmsg');
    } catch {
      // Browsers cap what an extension may store; a very large original may not fit.
      delete item.original;
      await saveImage(box, item);
      status('Image resized. The original was too large to keep, so Undo isn\'t available for it.', 'err');
    }
  } catch (err) {
    status(err.message, 'err');
  }
}

function showUpload(box, item) {
  const img = $('img', box);
  const info = $('.info', box);
  $('.preview', box).classList.toggle('has', !!item);
  if (!item) {
    img.removeAttribute('src');
    info.textContent = '';
    box.dataset.state = 'missing';
    readiness();
    return;
  }
  img.onload = () => {
    const kb = dataUrlKb(item.dataUrl);
    const want = rules(box);
    info.replaceChildren(`${item.name} · ${img.naturalWidth}×${img.naturalHeight} · ${kb} KB`);
    const line = (cls, ...parts) => {
      const d = document.createElement('div');
      d.className = cls;
      d.append(...parts);
      info.append(d);
      return d;
    };
    const button = (text, onClick, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = text;
      if (title) b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };
    const { resized, original } = item;
    if (resized) {
      const how = { fit: 'fitted whole', crop: 'cropped to fill', compress: 'saved smaller' }[resized.mode];
      const other = { fit: 'crop', crop: 'fit' }[resized.mode];
      line('fitted', `✓ Resized from ${resized.from.w}×${resized.from.h}, ${resized.from.kb} KB (${how}). `,
        ...(original ? [
          button('Undo', () => saveImage(box, original).then(() => status('Original image back', 'okmsg')), 'Go back to the image you chose'),
          ...(other ? [button(other === 'crop' ? 'Crop instead' : 'Fit instead', () => resizeSaved(box, original, other),
            other === 'crop' ? 'Fill the frame from your original, trimming the edges' : 'Keep the whole original picture, with white borders')] : []),
        ] : []));
    }
    const wrongSize = img.naturalWidth !== want.w || img.naturalHeight !== want.h;
    const tooBig = kb > want.kb;
    const notJpeg = !/^data:image\/jpe?g/.test(item.dataUrl);
    box.dataset.state = wrongSize || tooBig || notJpeg ? 'wrong' : 'fits';
    // Only what's wrong: "600×600 px → needs 300×300 px".
    const has = [wrongSize && `${img.naturalWidth}×${img.naturalHeight} px`, tooBig && `${kb} KB`, notJpeg && 'not a JPG'].filter(Boolean);
    const needs = [wrongSize && `${want.w}×${want.h} px`, tooBig && `max ${want.kb} KB`, notJpeg && 'JPG'].filter(Boolean);
    box.dataset.problem = `${has.join(', ')} → needs ${needs.join(', ')}`;
    readiness();
    if (wrongSize || tooBig || notJpeg) {
      const problems = [wrongSize && `${want.w}×${want.h} px`, tooBig && `at most ${want.kb} KB`, notJpeg && 'a JPG'].filter(Boolean);
      line('warn', `⚠ Teletalk wants ${problems.join(', ')} — the form will reject this one.`);
      line('fix', 'Resize it: ', ...(wrongSize
        ? [button(`Fit to ${want.w}×${want.h}`, () => resizeSaved(box, item, 'fit'), 'Keep the whole picture, with white borders where it doesn\'t fill the frame'),
          button(`Crop to ${want.w}×${want.h}`, () => resizeSaved(box, item, 'crop'), 'Fill the frame, trimming the edges evenly')]
        : [button(`Make it a JPG under ${want.kb} KB`, () => resizeSaved(box, item, 'compress'), 'Same picture and size, saved smaller')]));
    }
  };
  img.src = item.dataUrl;
}

for (const box of $$('.upload')) {
  const key = box.dataset.key;
  $('input', box).addEventListener('change', async (e) => {
    touched = true;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readDataUrl(file);
      await loadImage(dataUrl); // must be a picture the browser can open
      // Saved exactly as chosen; resizing is offered, not done.
      try {
        await saveImage(box, { name: file.name, dataUrl });
      } catch {
        throw new Error(`This image is too large for the extension to keep (${(file.size / 1048576).toFixed(1)} MB). Choose a smaller one, e.g. resized in a photo app.`);
      }
      status(`${key === 'photo' ? 'Photo' : 'Signature'} saved`, 'okmsg');
    } catch (err) {
      status(err.message, 'err');
    }
  });
  $('.remove', box).addEventListener('click', async () => {
    await chrome.storage.local.remove(key);
    showUpload(box, null);
  });
}

// --- Start ---

// Arriving from the form's report panel (options.html#uploads): briefly mark
// the section to fix.
function flashSection() {
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (!target) return;
  const box = target.matches('fieldset') ? target : target.querySelector('fieldset') || target;
  box.classList.remove('flash');
  void box.offsetWidth; // restart the animation
  box.classList.add('flash');
}
window.addEventListener('hashchange', flashSection);

// The form's panel asked for the settings page while this one is open: come
// forward and show the section (the background script then opens no new tab).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'show-settings') return;
  chrome.tabs.getCurrent((tab) => {
    if (!tab) return sendResponse(false);
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
    if (msg.section && location.hash !== `#${msg.section}`) location.hash = msg.section; // flashes it
    else flashSection();
    if (msg.section) document.getElementById(msg.section)?.scrollIntoView();
    sendResponse(true);
  });
  return true;
});

// Section links land just below the sticky menu, however tall it is (it wraps
// on narrow windows): the page keeps that much room above a section it jumps to.
const menu = $('.menu');
new ResizeObserver(() => document.documentElement.style.setProperty('--menu-h', `${menu.offsetHeight}px`)).observe(menu);

buildForm();
(async () => {
  const saved = await chrome.storage.local.get(['profile', 'photo', 'signature']);
  if (!touched) {
    render(saved.profile);
    for (const box of $$('.upload')) showUpload(box, saved[box.dataset.key]);
    status(saved.profile ? 'All changes saved' : 'Fill in your details — they save automatically.', saved.profile ? 'okmsg' : '');
  }
  document.body.dataset.ready = '1';
  flashSection();
})();
