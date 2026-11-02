// Fills the form in the current frame from a profile. Runs inside the page:
// injected by the extension on toolbar click, or evaluated by fill.js.
// Never clicks buttons or submits anything.
//
// Needs lib/fields.js loaded first. Defines globalThis.TAF_ENGINE:
//   fill(profile)          -> report {filled, missing, problems, empty}
//   mergeReports(reports)  -> one report for all frames
//   showReport(report)     -> floating summary panel (top frame)
//
// profile.photo / profile.signature are {name, dataUrl} (or {name, error}).

(() => {
  if (globalThis.TAF_ENGINE) return;

  const SKIP_TEXT = 'SCRIPT,STYLE,NOSCRIPT,OPTION,SELECT,TEXTAREA,BUTTON';
  const ENHANCED = /select2|chosen|selectize|nice-select|choices|bootstrap-select/i;
  const GENERIC_SWITCH = /applicable|প্রযোজ্য|\bhave\b|আছে/i;
  // Field texts that contain a section word but aren't headings ("Currently working", "Till Present").
  const NOT_HEADING = /same|একই|continu|currently|till|to date|চলমান|^(up ?to )?present( job)?$/i;
  const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Case, spaces and punctuation don't matter, and "&" is "and" ("Computer Science & Engineering").
  const norm = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]/gu, '');

  // --- Reading the page ---

  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
    getComputedStyle(el).visibility !== 'hidden';

  // A <select> hidden behind a select2/chosen widget is still the real control.
  const isEnhanced = (el) => el.tagName === 'SELECT' && [el.nextElementSibling, el.parentElement]
    .some((n) => n && n !== el && ENHANCED.test(n.className || ''));

  function explicitLabel(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && clean(l.textContent)) return clean(l.textContent);
    }
    const anc = el.closest('label');
    if (anc && clean(anc.textContent)) return clean(anc.textContent);
    return clean(el.getAttribute('aria-label'));
  }

  // "[x] If Applicable": a checkbox's text usually follows it.
  function textAfter(el) {
    for (let n = el.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === Node.ELEMENT_NODE && (n.matches('input,select,textarea,br') || n.querySelector('input,select,textarea'))) return '';
      const t = clean(n.textContent);
      if (t) return t.slice(0, 80);
    }
    return '';
  }

  function columnHeader(el) {
    const cell = el.closest('td,th');
    const table = cell && cell.closest('table');
    if (!table || !table.rows.length || cell.parentElement === table.rows[0]) return '';
    const head = table.rows[0].cells[cell.cellIndex];
    // A first row holding controls is a form row, not a header (and its
    // textContent would include <option> texts).
    if (!head || head.querySelector('input,select,textarea')) return '';
    return clean(head.textContent).slice(0, 60);
  }

  // Describes every form control: its label (explicit <label>, else the nearest
  // text before it, plus the table column header), the section heading it sits
  // under, visibility and current value. Radios are grouped by name.
  function collect(sectionRe) {
    const controls = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let lastText = '';
    let lastNode = null;
    let lastSection = '';
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP_TEXT) || p.closest('#taf-panel')) continue;
        const t = clean(n.textContent);
        if (!/[\p{L}\p{N}]/u.test(t)) continue; // only "*", ":" etc.
        lastText = t.slice(0, 120);
        lastNode = n;
        if (t.length < 80 && sectionRe.test(t) && !NOT_HEADING.test(t)) lastSection = t;
        continue;
      }
      if (!n.matches('input,select,textarea')) continue;
      const type = (n.getAttribute('type') || n.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
      controls.push({ el: n, type, lastText, lastNode, lastSection });
    }

    const out = [];
    const groups = {};
    for (const c of controls) {
      const el = c.el;
      const base = {
        ref: el,
        node: el, // the DOM element (for a radio group: its first radio)
        i: out.length,
        tag: el.tagName.toLowerCase(),
        type: c.type,
        name: el.name || '',
        id: el.id || '',
        section: c.lastSection,
        visible: isVisible(el) || isEnhanced(el),
        disabled: el.disabled,
        readOnly: el.readOnly,
      };
      if (c.type === 'radio') {
        const g = el.name || `_${out.length}`;
        if (!groups[g]) {
          groups[g] = { ...base, ref: `radio:${g}`, tag: 'radiogroup', label: [c.lastText, el.name].join(' | '), options: [], value: '' };
          out.push(groups[g]);
        }
        groups[g].options.push({ el, text: explicitLabel(el) || el.value, value: el.value });
        if (el.checked) groups[g].value = el.value;
        groups[g].visible = groups[g].visible || base.visible;
        continue;
      }
      const own = explicitLabel(el) || (c.type === 'checkbox' && textAfter(el));
      // Under a header row, text before the control from an earlier row is just
      // the last column's header ("Responsibilities"), not this field's name.
      const header = columnHeader(el);
      const row = el.closest('tr');
      const near = !header || (row && c.lastNode && row.contains(c.lastNode)) ? c.lastText : '';
      const label = [own || near, header, el.placeholder, el.name, el.id]
        .filter(Boolean).join(' | ');
      const d = { ...base, label };
      if (base.tag === 'select') {
        d.options = selectOptions(el);
        d.value = el.selectedIndex > 0 || (el.selectedIndex === 0 && el.value) ? el.value : '';
      } else if (c.type === 'checkbox') {
        d.value = el.checked ? 'on' : '';
      } else if (c.type === 'file') {
        d.value = el.files && el.files.length ? el.files[0].name : '';
      } else {
        d.value = el.value;
      }
      out.push(d);
    }
    return out;
  }

  // --- Matching ---

  // The option a value means: its exact text (or value); else, for answers of
  // 3+ letters, the one option starting with it, the longest option it starts
  // with ("B.Sc (Engineering/Architecture)" -> "B.Sc Engineering"), or the one
  // option containing it. Several equally good options -> {ambiguous}: never a
  // guess (short "No" must not pick "Non-Government Organization").
  function matchOption(options, value, exactOnly = false) {
    const v = norm(value);
    if (!v) return {};
    const named = options.filter((o) => norm(o.text));
    const exact = named.find((o) => norm(o.text) === v || norm(o.value) === v);
    if (exact) return { hit: exact };
    if (exactOnly || v.length < 3) return {};
    const one = (list) => (list.length === 1 ? { hit: list[0] } : { ambiguous: list });
    const starts = named.filter((o) => norm(o.text).startsWith(v));
    if (starts.length) return one(starts);
    const within = named.filter((o) => norm(o.text).length >= 3 && v.startsWith(norm(o.text)));
    if (within.length) {
      const longest = Math.max(...within.map((o) => norm(o.text).length));
      return one(within.filter((o) => norm(o.text).length === longest));
    }
    const contains = named.filter((o) => norm(o.text).includes(v));
    return contains.length ? one(contains) : {};
  }

  const pickOption = (options, value, exactOnly) => matchOption(options, value, exactOnly).hit || null;

  // matchOption, then exact matches on other ways of writing the same thing:
  // "University of Rajshahi" <-> "Rajshahi University", and SYNONYMS
  // ("Non Quota" -> "Not Applicable", "First Division" -> "1st Division").
  function pickAny(options, value) {
    const first = matchOption(options, value);
    if (first.hit) return first;
    const v = String(value).trim();
    const uniOf = /^university of (.+)$/i.exec(v);
    const xUni = /^(.+?) university$/i.exec(v);
    const alts = [uniOf ? `${uniOf[1]} University` : xUni ? `University of ${xUni[1]}` : null];
    alts.push(...((globalThis.TAF_FIELDS.SYNONYMS || []).find((g) => g.some((s) => norm(s) === norm(v))) || []));
    for (const alt of alts.filter(Boolean)) {
      const h = pickOption(options, alt, true);
      if (h) return { hit: h };
    }
    return first;
  }

  // Exactly a yes/no question (not e.g. a quota list containing "Not Applicable").
  const isYesNo = (options) => ['yes', 'no'].every((w) => {
    const words = (globalThis.TAF_FIELDS.SYNONYMS || []).find((g) => g.some((s) => norm(s) === w)) || [w];
    return (options || []).some((o) => words.some((x) => norm(x) === norm(o.text)));
  });

  const getPath = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

  // Could this control be filled right now? Date pickers are often read-only
  // text boxes; nothing else should be.
  const stateOk = (def, d) => d.visible && !d.disabled && !(d.readOnly && def.kind !== 'date');
  const kindOk = (def, d) => stateOk(def, d) && typeOk(def, d);

  function typeOk(def, d) {
    // "Do you have a Masters degree? Yes/No" is a section switch, never an exam field.
    if (def.section && isYesNo(d.options)) return false;
    if (def.kind === 'file') return d.type === 'file';
    if (def.kind === 'checkbox') return d.type === 'checkbox';
    if (d.type === 'file' || d.type === 'checkbox') return false;
    if (def.kind === 'select') return d.tag === 'select' || d.tag === 'radiogroup';
    if (def.kind === 'yesno') return (d.tag === 'select' || d.tag === 'radiogroup') && isYesNo(d.options);
    if (def.kind === 'text') return d.tag === 'input' || d.tag === 'textarea';
    return true;
  }

  function candidates(def, descs, ctx, ok = kindOk) {
    const { used, SECTIONS, ends } = ctx;
    // Job 2's fields come after job 1's on the page.
    const prev = def.after && ends[def.after];
    // Boxes ADD MORE added for a job belong to that job only, wherever they sit.
    const tag = (d) => (d.node && d.node.dataset && d.node.dataset.tafJob) || '';
    const label = (d) => def.label.test(d.label) && !(def.exclude && def.exclude.test(d.label));
    const own = def.group ? descs.filter((d) => tag(d) === def.group) : [];
    if (own.length) return own.filter((d) => !used.has(d.ref) && ok(def, d) && label(d));
    const free = (d) => !used.has(d.ref) && ok(def, d) && !tag(d) && !(prev && !(prev.compareDocumentPosition(d.node) & FOLLOWING));
    const matches = descs.filter((d) => free(d) && label(d));
    if (!matches.length && def.fallback) return descs.filter(free);
    if (!def.section) return matches;
    // Prefer controls under the right heading; if the page has no detectable
    // headings, fall back to document order (present before permanent, SSC before HSC...).
    const sectionOf = (d) => d.section || `${d.name} ${d.id}`;
    const hit = matches.filter((d) => SECTIONS[def.section](sectionOf(d)));
    if (hit.length || def.strict) return hit;
    return matches.filter((d) => !Object.values(SECTIONS).some((f) => f(sectionOf(d))));
  }

  // --- Setting values (with the events page scripts listen for) ---

  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  function setValue(el, value) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    // The prototype setter, so frameworks that wrap `value` still see a change.
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    fire(el, 'input');
    fire(el, 'change');
    el.dispatchEvent(new Event('blur'));
  }

  const selectOptions = (el) => [...el.options].map((o) => ({ value: o.value, text: clean(o.text) }))
    // A leading "-- Select --" placeholder must never be picked.
    .filter((o, i) => !(i === 0 && (!o.value || /select|choose|--|নির্বাচন/i.test(o.text))));

  // Cascading selects (district -> upazila) load their options after the parent changes.
  async function waitForOptions(el, ms = 5000) {
    for (let t = 0; t < ms && !selectOptions(el).length; t += 100) await sleep(100);
    return selectOptions(el);
  }

  const listOf = (options) => `${options.slice(0, 15).map((o) => o.text).join(' · ')}${options.length > 15 ? ' · ...' : ''}`;

  async function selectValue(el, value, def) {
    const options = await waitForOptions(el);
    const { hit: opt, ambiguous } = pickAny(options, value);
    if (!opt) {
      if (ambiguous) return { error: `"${value}" fits more than one option: ${listOf(ambiguous)}. Write it exactly.` };
      const other = def && def.allowOther && options.find((o) => /^others?$/i.test(o.text.trim()));
      if (other) return chooseOther(el, other, value);
      return { error: `no option "${value}" (have: ${listOf(options)})` };
    }
    // Re-selecting the current value would make the page reset dependent fields.
    if (el.value !== opt.value) {
      setValue(el, opt.value);
      await sleep(150); // let change handlers clear/reload dependent selects
    }
    return { value: opt.text, changedSelect: true };
  }

  // Not in the form's list (a university, a subject): choose "Other" and type
  // the name into the box that choice opens.
  async function chooseOther(el, other, value) {
    if (el.value !== other.value) {
      setValue(el, other.value);
      await sleep(200);
    }
    const scope = el.closest('div, td, li, p') || el.parentElement;
    const box = [...scope.querySelectorAll('input:not([type]), input[type=text]')].find((i) => isVisible(i) && !i.disabled);
    if (!box) return { error: `"${value}" isn't in the form's list, and choosing "Other" opened no box to type it in` };
    if (box.value !== value) setValue(box, value);
    return {
      value: `Other: ${value}`, changedSelect: true, also: box,
      note: `"${value}" isn't in the form's list, so "Other" was chosen and the name typed in. Check it, or pick a listed name.`,
    };
  }

  function dataUrlBytes(dataUrl) {
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function dataUrlToFile({ name, dataUrl }) {
    const type = (/^data:([^;,]+)/.exec(dataUrl) || [])[1] || '';
    return new File([dataUrlBytes(dataUrl)], name, { type });
  }

  // Width and height of a JPEG or PNG, read from its bytes (no image loading).
  function imageSize(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e) {
      return { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
    }
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    for (let i = 2; i + 8 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += m === 0xff ? 1 : 2; continue; }
      // SOF markers carry the size; C4/C8/CC are other tables.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }

  // What the page says it accepts, from the box's label: "Photo (300x300 pixel, max 100KB)".
  function imageRules(el, label) {
    const near = el.closest('.form-group, td, li, p');
    const text = /\d{2,4}\s*[x×X*]\s*\d{2,4}|k\.?\s?b\b/i.test(label) ? label : `${label} ${near ? clean(near.textContent).slice(0, 200) : ''}`;
    const dims = /(\d{2,4})\s*(?:px|pixels?)?\s*[x×X*]\s*(\d{2,4})/.exec(text) || /width\D{0,12}(\d{2,4})\D{1,30}height\D{0,12}(\d{2,4})/i.exec(text);
    const kb = [...text.matchAll(/(\d{1,4})\s*k\.?\s?b\b/gi)].map((m) => Number(m[1]));
    return { w: dims ? Number(dims[1]) : 0, h: dims ? Number(dims[2]) : 0, kb: kb.length ? Math.max(...kb) : 0 };
  }

  const kbOf = (bytes) => Math.round(bytes / 1024);
  const describeImage = (size, bytes) => `${size ? `${size.w}×${size.h} px, ` : ''}${kbOf(bytes)} KB`;
  const describeRules = (r) => [r.w && `${r.w}×${r.h} px`, r.kb && `up to ${r.kb} KB`].filter(Boolean).join(', ');

  // Visible text in the box's surroundings, to notice an error message the page adds.
  function textsNear(el) {
    const scope = el.closest('.form-group, td, fieldset, form') || el.parentElement;
    const out = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = clean(n.textContent);
      if (t && n.parentElement && isVisible(n.parentElement)) out.push(t);
    }
    return out;
  }

  // Upload an image only if it fits what the page states, then check the page
  // kept it: Teletalk forms check the picture and clear the box if it's wrong.
  async function uploadImage(el, item, label) {
    const file = dataUrlToFile(item);
    const size = imageSize(dataUrlBytes(item.dataUrl));
    const rules = imageRules(el, label);
    const what = /sign/i.test(label) ? 'signature' : 'photo';
    const fix = 'Resize it in the extension\'s settings (button below).';
    const wrongSize = rules.w && size && (size.w !== rules.w || size.h !== rules.h);
    if (wrongSize || (rules.kb && file.size > rules.kb * 1024)) {
      return { error: `Not uploaded: your ${what} is ${describeImage(size, file.size)}, this form wants ${describeRules(rules)}. ${fix}` };
    }
    const before = textsNear(el);
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    fire(el, 'input');
    fire(el, 'change');
    // The page checks the picture once it has loaded it.
    const kept = () => el.files.length === 1 && el.files[0].name === file.name && el.files[0].size === file.size;
    for (let t = 0; t < 1200 && kept(); t += 100) await sleep(100);
    const said = textsNear(el).filter((t) => !before.includes(t) && /dimension|pixel|size|\bkb\b|invalid|must|allowed|format|jpe?g|large|small/i.test(t));
    if (!kept() || said.length) {
      return { error: `The form ${kept() ? 'objected to' : 'rejected'} your ${what} (${describeImage(size, file.size)})${said.length ? `: "${said.join(' ').slice(0, 160)}"` : ''}. ${rules.w || rules.kb ? `It wants ${describeRules(rules)}. ` : ''}${fix}` };
    }
    return { value: `${item.name} (${describeImage(size, file.size)})` };
  }

  async function setControl(d, value, def) {
    const el = d.ref;
    if (d.tag === 'radiogroup') {
      const { hit: opt, ambiguous } = pickAny(d.options, value);
      if (!opt) return { error: ambiguous ? `"${value}" fits more than one option: ${listOf(ambiguous)}. Write it exactly.` : `no option "${value}" (have: ${d.options.map((o) => o.text).join(', ')})` };
      if (!opt.el.checked) opt.el.click();
      return { value: opt.text, el: opt.el };
    }
    if (d.tag === 'select') return selectValue(el, value, def);
    if (d.type === 'checkbox') {
      if (value && !el.checked) el.click();
      return { value: 'checked' };
    }
    if (d.type === 'file') {
      if (!value || value.error || !value.dataUrl) return { error: (value && value.error) || 'no file saved in profile' };
      return uploadImage(el, value, d.label);
    }
    // A script-typed value isn't held to the box's limit, but the form would reject it.
    let text = String(value);
    let note;
    if (el.maxLength > 0 && text.length > el.maxLength) {
      text = text.slice(0, el.maxLength);
      note = `Cut to the form's ${el.maxLength}-character limit. Check the end still reads well.`;
    }
    if (el.value !== text) setValue(el, text);
    return { value: text, note };
  }

  // Day/month/year selects of one date: adjacent selects from the first one.
  function dateSelects(cands) {
    const selects = cands.filter((c) => c.tag === 'select');
    const group = selects.slice(0, 1);
    for (const s of selects.slice(1)) {
      if (group.length === 3 || s.i !== group[group.length - 1].i + 1) break;
      group.push(s);
    }
    return group;
  }

  // A date (YYYY-MM-DD): one text/date input, or day/month/year selects.
  async function fillDate(cands, iso, used) {
    const [y, m, d] = iso.split('-');
    const done = [];
    const selects = dateSelects(cands);
    if (selects.length >= 2) {
      for (const s of selects) {
        const options = selectOptions(s.ref);
        const texts = options.map((o) => o.text.toLowerCase());
        let want;
        if (texts.some((t) => /^(19|20)\d\d$/.test(t))) want = [y];
        else if (texts.some((t) => MONTHS.some((mo) => t.startsWith(mo))) || options.length <= 12) {
          want = [MONTHS[Number(m) - 1], m, String(Number(m))];
        } else want = [d, String(Number(d))];
        const opt = want.map((w) => pickOption(options, w)).find(Boolean);
        if (!opt) continue;
        if (s.ref.value !== opt.value) setValue(s.ref, opt.value);
        used.add(s.ref);
        done.push({ d: s, value: opt.text });
      }
      return done;
    }
    const input = cands.find((c) => c.tag === 'input');
    if (!input) return done;
    let value;
    if (input.type === 'date') value = iso;
    else {
      // Follow the format the field asks for (dd/mm/yyyy, yyyy-mm-dd, dd-mm-yyyy...).
      const fmt = /(dd|mm|yyyy)([/.-])(dd|mm)\2(dd|yyyy)/i.exec(input.label);
      const parts = { dd: d, mm: m, yyyy: y };
      value = fmt ? [fmt[1], fmt[3], fmt[4]].map((p) => parts[p.toLowerCase()]).join(fmt[2]) : `${d}/${m}/${y}`;
    }
    setValue(input.ref, value);
    used.add(input.ref);
    done.push({ d: input, value });
    return done;
  }

  // --- Highlighting ---

  const COLORS = { ok: '#2e7d32', bad: '#d32f2f', todo: '#ef6c00' };

  function mark(el, kind) {
    if (!(el instanceof Element)) return;
    if (el.dataset.tafOutline === undefined) el.dataset.tafOutline = el.style.outline;
    el.style.outline = `2px solid ${COLORS[kind]}`;
    el.style.outlineOffset = '1px';
  }

  function unmarkAll() {
    for (const el of document.querySelectorAll('[data-taf-outline]')) {
      el.style.outline = el.dataset.tafOutline;
      el.style.outlineOffset = '';
      delete el.dataset.tafOutline;
    }
  }

  const markDesc = (d, kind, el) => {
    if (el) mark(el, kind);
    else if (d.tag === 'radiogroup') d.options.forEach((o) => mark(o.el, kind));
    else mark(d.ref, kind);
  };

  // --- Filling ---

  // The job section's ADD MORE: a button (not a submit) whose text says so,
  // e.g. Teletalk's #addNewJob. Its default action is cancelled while clicking,
  // so even a button that would submit the form only runs the page's "add a
  // block" code. Nothing else is ever clicked.
  const ADD_MORE = /\badd\s*(more|new|another)\b|আরও যোগ/i;
  async function addJobBlock(descs, SECTIONS) {
    // Next to the job section's title, e.g. inside its "Job Experiences" bar.
    const inJobs = (b) => {
      let p = b.parentElement;
      for (let i = 0; p && i < 3; i++, p = p.parentElement) if (SECTIONS.experience(clean(p.textContent).slice(0, 60))) return true;
      return false;
    };
    const button = [...document.querySelectorAll('button, a, input[type=button]')].find((b) =>
      ADD_MORE.test(clean(b.textContent || b.value || '')) && isVisible(b) && !b.disabled &&
      b.getAttribute('type') !== 'submit' && (b.id === 'addNewJob' || inJobs(b)));
    if (!button) return false;
    const before = new Set(document.querySelectorAll('input, select, textarea'));
    const blocks = before.size;
    const noDefault = (e) => e.preventDefault();
    button.addEventListener('click', noDefault);
    button.click();
    button.removeEventListener('click', noDefault);
    for (let t = 0; t < 2000 && document.querySelectorAll('input, select, textarea').length === blocks; t += 100) await sleep(100);
    await sleep(150);
    // The boxes that appeared are the new block, wherever the page put it.
    const fresh = [...document.querySelectorAll('input, select, textarea')].filter((el) => !before.has(el));
    return fresh.length ? fresh : null;
  }

  async function fill(profile) {
    const report = { filled: [], notes: [], missing: [], blocked: [], problems: [], empty: [] };
    if (!document.body || !globalThis.TAF_FIELDS) return report;
    const { defs, SECTIONS, SECTION_KEYWORDS, SWITCHABLE } = globalThis.TAF_FIELDS;
    const sectionRe = new RegExp(SECTION_KEYWORDS, 'i');
    unmarkAll();
    let descs = collect(sectionRe);
    if (!descs.length) return report;
    const used = new Set();
    const ends = {}; // entry (job1, job2...) -> its last control on the page
    const ctx = { used, SECTIONS, ends };
    let sameTicked = false;

    const extend = (group, node) => {
      if (!group || !node) return;
      if (!ends[group] || ends[group].compareDocumentPosition(node) & FOLLOWING) ends[group] = node;
    };

    // A section the profile has but the form keeps hidden or locked (e.g. behind
    // "If Applicable" or a Masters Yes/No): switch it on first.
    for (const [s, needed] of Object.entries(SWITCHABLE)) {
      if (!needed(profile)) continue;
      // Open = the section's own fields (exam, result, year...) can be filled and
      // none is locked: forms sometimes leave one dropdown usable behind "If Applicable".
      // Not any control under the heading: photo/captcha often follow the last section.
      const own = (test) => defs.some((def) => def.section === s && descs.some((d) => SECTIONS[s](d.section || '') &&
        test(def, d) && def.label.test(d.label) && !(def.exclude && def.exclude.test(d.label))));
      const open = own(kindOk) && !own((def, d) => d.visible && d.disabled && typeOk(def, d));
      if (open) continue;
      const isSwitch = (d) => d.visible && !d.disabled && !used.has(d.ref) &&
        ((d.type === 'checkbox' && !d.value) || ((d.tag === 'select' || d.tag === 'radiogroup') && isYesNo(d.options)));
      // Named after the section ("I have a Masters degree"), or a generic
      // "If Applicable" box just before the section's heading or right after it.
      let sw = descs.find((d) => isSwitch(d) && SECTIONS[s](d.label));
      if (!sw) {
        const first = descs.findIndex((d) => SECTIONS[s](d.section || ''));
        if (first >= 0) sw = [descs[first], descs[first - 1]].find((d) => d && isSwitch(d) && GENERIC_SWITCH.test(d.label));
      }
      if (!sw) continue;
      used.add(sw.ref);
      const res = await setControl(sw, sw.type === 'checkbox' ? true : 'Yes');
      if (res.error) continue;
      report.filled.push({ key: `${s} (show section)`, label: sw.label, value: res.value });
      markDesc(sw, 'ok', res.el);
      await sleep(300);
      descs = collect(sectionRe);
    }

    // Job 2, 3...: when the form has no block for the next job yet, press its
    // ADD MORE once (as Teletalk's own autofill does) and read the page again.
    const opened = new Set();
    const groupDefs = (g) => defs.filter((d) => d.group === g);

    for (const def of defs) {
      if (def.group && def.after && !opened.has(def.group) && def.exists && def.exists(profile)) {
        opened.add(def.group);
        const hasBlock = groupDefs(def.group).some((d) => candidates(d, descs, ctx, typeOk).length);
        const fresh = !hasBlock && await addJobBlock(descs, SECTIONS);
        if (fresh) {
          for (const el of fresh) el.dataset.tafJob = def.group;
          report.filled.push({ key: `${def.group} (ADD MORE)`, label: 'ADD MORE', value: 'clicked' });
          descs = collect(sectionRe);
        }
      }
      let value = def.value ? def.value(profile) : getPath(profile, def.key);
      if (profile.permanentSameAsPresent && def.key.startsWith('permanent.')) {
        // The form copies the address itself once "same as present" is ticked;
        // without such a checkbox, type the present address in again.
        if (sameTicked) continue;
        value = getPath(profile, def.key.replace(/^permanent\./, 'present.'));
      }
      if (value === undefined || value === null || value === '' || value === false) {
        // A field this job leaves empty still belongs to it: the next job must
        // start after it, not take it.
        if (def.group && def.exists && def.exists(profile)) {
          const spot = candidates(def, descs, ctx, typeOk);
          extend(def.group, (def.kind === 'date' ? dateSelects(spot).at(-1) : null)?.node || (spot[0] && spot[0].node));
        }
        continue;
      }

      const cands = candidates(def, descs, ctx);
      if (!cands.length) {
        if (def.optional) continue;
        // Say why when the field exists but can't be filled: that is fixable by hand.
        const near = candidates(def, descs, ctx, typeOk)[0];
        if (near) {
          const reason = !near.visible ? 'hidden' : near.disabled ? 'locked (disabled)' : 'read-only';
          report.blocked.push({ key: def.key, label: near.label, reason });
          markDesc(near, 'bad');
        } else report.missing.push(def.key);
        continue;
      }
      try {
        if (def.kind === 'date') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
            report.problems.push({ key: def.key, label: cands[0].label, error: `date must look like 2021-07-01 (got "${value}")` });
            continue;
          }
          const done = await fillDate(cands, String(value), used);
          if (!done.length) report.problems.push({ key: def.key, label: cands[0].label, error: 'could not set the date' });
          for (const r of done) {
            report.filled.push({ key: def.key, label: r.d.label, value: r.value });
            markDesc(r.d, 'ok');
            extend(def.group, r.d.node);
          }
          continue;
        }
        const d = cands[0];
        used.add(d.ref);
        // A form asking Yes/No ("Departmental Candidate?") gets Yes/No for the profile's answer.
        if (def.yesNo && (d.tag === 'select' || d.tag === 'radiogroup') && isYesNo(d.options)) value = def.yesNo(value);
        const res = await setControl(d, value, def);
        if (res.also) used.add(res.also);
        if (res.error) {
          report.problems.push({ key: def.key, label: d.label, error: res.error });
          markDesc(d, 'bad');
        } else {
          report.filled.push({ key: def.key, label: d.label, value: res.value });
          markDesc(d, res.note ? 'todo' : 'ok', res.el);
          if (res.note) report.notes.push({ key: def.key, label: d.label, note: res.note });
          extend(def.group, d.node);
          if (def.key === 'permanentSameAsPresent') sameTicked = true;
        }
        // A select change can reveal fields or reload dependent options: re-read the page.
        if (res.changedSelect || d.type === 'checkbox') descs = collect(sectionRe);
      } catch (e) {
        report.problems.push({ key: def.key, label: cands[0].label, error: String(e.message || e).split('\n')[0] });
      }
    }

    // Spare job rows the form offers beyond the profile's jobs are not "to do".
    const lastJob = Object.values(ends).reduce((a, n) => (!a || a.compareDocumentPosition(n) & FOLLOWING ? n : a), null);
    const jobDefs = defs.filter((def) => def.group);
    const spareJobField = (d) => lastJob && SECTIONS.experience(d.section || '') &&
      lastJob.compareDocumentPosition(d.node) & FOLLOWING &&
      jobDefs.some((def) => def.label.test(d.label) && !(def.exclude && def.exclude.test(d.label)));

    for (const d of collect(sectionRe)) {
      if (d.visible && !d.disabled && !d.value && d.type !== 'checkbox' && !used.has(d.ref) && !spareJobField(d)) {
        report.empty.push(d.label || `${d.tag} ${d.name}`);
        markDesc(d, 'todo');
      }
    }
    // Whether the form asks for job experience at all (some don't, e.g. for freshers' posts).
    report.jobSection = descs.some((d) => SECTIONS.experience(d.section || ''));
    return report;
  }

  function mergeReports(reports) {
    const r = { filled: [], notes: [], missing: [], blocked: [], problems: [], empty: [] };
    for (const x of reports) for (const k of Object.keys(r)) r[k].push(...(x[k] || []));
    // A key missing from one frame may have been filled in another.
    const filled = new Set(r.filled.map((f) => f.key));
    r.blocked = r.blocked.filter((b) => !filled.has(b.key));
    const blocked = new Set(r.blocked.map((b) => b.key));
    r.missing = [...new Set(r.missing)].filter((k) => !filled.has(k) && !blocked.has(k));
    r.jobSection = reports.some((x) => x.jobSection);
    return r;
  }

  // --- Summary panel ---

  // Where on the settings page a detail is fixed (its section's id there).
  const SETTINGS_SECTIONS = { uploads: 'Photo & Signature', basic: 'Basic Information', address: 'Address', education: 'Education', jobs: 'Job Experiences' };
  const settingsSection = (key) => (/^(photo|signature)$/.test(key) ? 'uploads'
    : /^(present|permanent)\./.test(key) ? 'address'
      : /^(ssc|hsc|graduation|masters)\./.test(key) ? 'education'
        : /^job\d/.test(key) ? 'jobs' : 'basic');

  // ["job2.designation", "job2.from", "nid"] -> ["job2: designation, from", "nid"]
  function groupKeys(keys) {
    const groups = new Map();
    for (const k of keys) {
      const [head, rest] = k.includes('.') ? [k.slice(0, k.indexOf('.')), k.slice(k.indexOf('.') + 1)] : [k, ''];
      if (!groups.has(head)) groups.set(head, []);
      if (rest) groups.get(head).push(rest);
    }
    return [...groups].map(([head, rest]) => (rest.length ? `${head}: ${rest.join(', ')}` : head));
  }

  // Asks the background script to open (or bring forward) the settings page.
  // After the extension is reloaded or updated, a panel already on the page
  // can't reach it any more: say so instead of doing nothing.
  function openSettings(button, section) {
    const lost = () => {
      button.textContent = 'The extension was reloaded: click its toolbar button again, then this button.';
      button.disabled = true;
    };
    try {
      const sent = chrome.runtime.sendMessage({ type: 'open-settings', section });
      if (sent && sent.then) sent.then((ok) => { if (!ok) lost(); }, lost);
    } catch (e) {
      lost();
    }
  }

  function showReport(r) {
    document.getElementById('taf-panel')?.remove();
    const host = document.createElement('div');
    host.id = 'taf-panel';
    const root = host.attachShadow({ mode: 'open' });
    const short = (s) => (s.length > 70 ? `${s.slice(0, 67)}...` : s);
    // Built with textContent only: labels come from the page.
    const el = (tag, cls, ...kids) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      e.append(...kids);
      return e;
    };
    const list = (items) => el('ul', '', ...items.map((i) => el('li', '', ...[].concat(i))));

    const style = el('style', '', `
      .box { position: fixed; top: 12px; right: 12px; z-index: 2147483647; width: 340px; max-height: 70vh;
        overflow: auto; background: #fff; color: #222; border: 1px solid #bbb; border-radius: 8px;
        box-shadow: 0 4px 18px rgba(0,0,0,.25); font: 13px/1.4 system-ui, sans-serif; padding: 10px 12px; }
      h2 { font-size: 14px; margin: 0 0 6px; }
      h3 { font-size: 13px; margin: 10px 0 2px; }
      ul { margin: 0; padding-left: 18px; }
      .ok { color: ${COLORS.ok}; } .bad { color: ${COLORS.bad}; } .todo { color: ${COLORS.todo}; }
      .x { position: absolute; top: 6px; right: 8px; border: 0; background: none; font-size: 18px; cursor: pointer; color: #666; }
      .note { margin-top: 10px; color: #555; }
      details { margin-top: 8px; }
      summary { cursor: pointer; }
      .muted summary { color: #555; }
      p.muted { color: #555; margin: 6px 0; }
      details ul { margin-top: 4px; }
      .fix { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
      .go { font: 600 12px system-ui, sans-serif; padding: 4px 10px; border: 0; border-radius: 4px; background: #1b5e20; color: #fff; cursor: pointer; }
      .go:hover { background: #134718; }
      .go.edit { background: #fff; color: #1b5e20; border: 1px solid #1b5e20; }
      .go.edit:hover { background: #e8f5e9; }
      .note b { font-weight: 600; }
      .hint { color: #666; font-size: 12px; }`);
    const close = el('button', 'x', '×');
    close.title = 'Close';
    close.addEventListener('click', () => host.remove());
    // Short lists show in full; long ones fold behind a line that opens them.
    const fold = (summary, items, cls = '') => {
      const d = el('details', cls, el('summary', '', summary), list(items));
      return d;
    };
    // Which details went in ("photo, signature" on an upload step), not just how many.
    const filledKeys = groupKeys([...new Set(r.filled.map((f) => f.key))]);
    const filled = `✓ Filled ${r.filled.length} field(s) — green outline`;
    const box = el('div', 'box', close, el('h2', '', 'Teletalk Autofill'),
      !filledKeys.length ? el('div', 'note', 'Nothing was filled on this page.')
        : filledKeys.length <= 4 ? el('div', 'ok', `${filled}: ${filledKeys.join(', ')}`) : fold(filled, filledKeys, 'ok'));
    if (r.problems.length) {
      box.append(el('h3', 'bad', `Problems (${r.problems.length}) — red outline, fill by hand`),
        list(r.problems.map((p) => [el('b', '', p.key), `: ${p.error}`])));
    }
    if (r.notes.length) {
      box.append(el('h3', 'todo', `Check these (${r.notes.length}) — orange outline`),
        list(r.notes.map((n) => [el('b', '', n.key), `: ${n.note}`])));
    }
    // A button per settings section holding something to fix: it opens the
    // settings page there (the background script opens the tab).
    const toFix = [...new Set([...r.problems, ...r.notes].map((p) => p.key).filter((k) => !k.startsWith('(')).map(settingsSection))];
    if (toFix.length && globalThis.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      box.append(el('div', 'fix', ...toFix.map((section) => {
        const b = el('button', 'go', `Fix in settings: ${SETTINGS_SECTIONS[section]}`);
        b.addEventListener('click', () => openSettings(b, section));
        return b;
      })));
    }
    if (r.empty.length) box.append(el('h3', 'todo', `Still empty (${r.empty.length}) — orange outline`), list(r.empty.map(short)));
    if (r.blocked.length) {
      box.append(el('h3', 'bad', `Found but hidden or locked (${r.blocked.length}) — red outline`),
        list(r.blocked.map((b) => [el('b', '', b.key), `: ${b.reason} — ${short(b.label)}`])));
    }
    // Details the page doesn't ask for: expected on a step that only asks a few
    // things (photo upload), so a long list stays folded.
    // A form with no job section: the jobs are simply not needed here.
    const noJobs = r.jobSection === false && r.missing.some((k) => /^job\d+\./.test(k));
    if (noJobs) box.append(el('p', 'muted', 'This form has no Job Experience section, so your jobs were left out. Nothing to do.'));
    const notAsked = noJobs ? r.missing.filter((k) => !/^job\d+\./.test(k)) : r.missing;
    if (notAsked.length) {
      const missing = groupKeys(notAsked);
      // Say why, where it's known: a job the form has no block for yet, or the uploads.
      const hint = (line) => (/^job\d+:/.test(line) ? [line, el('div', 'hint', "The form has no place for this job (no ADD MORE found). Add a block there if you can, then click the extension button again.")]
        : /^(photo|signature)$/.test(line) ? [line, el('div', 'hint', 'Teletalk usually asks for this on the next step.')] : line);
      box.append(missing.length <= 4 ? el('h3', '', 'Not on this page') : '',
        missing.length <= 4 ? list(missing.map(hint))
        : fold(`${notAsked.length} of your details aren't asked on this page — normal for a step like photo upload`, missing, 'muted'));
    }
    // Always a way to the settings page, e.g. for a box left empty above.
    if (globalThis.chrome && chrome.runtime && chrome.runtime.sendMessage) {
      const edit = el('button', 'go edit', 'Edit details in settings');
      edit.addEventListener('click', () => openSettings(edit));
      box.append(el('div', 'fix', edit));
    }
    box.append(el('div', 'note', toFix.length ? 'After fixing it in settings, click the extension button again on this page. Nothing was submitted.'
      : 'Nothing was submitted. Check the form, fill the captcha and submit it yourself.'));
    root.append(style, box);
    document.documentElement.appendChild(host);
    return { filled: r.filled.length, problems: r.problems.length, empty: r.empty.length };
  }

  globalThis.TAF_ENGINE = { fill, mergeReports, showReport, matchOption, pickAny, imageSize, imageRules };
})();
