// Writes extension/lib/lists.js, the dropdown options the settings page offers,
// from a saved Teletalk application form page (File → Save Page As, HTML).
//
//   node scripts/form-lists.js path/to/application.html
//
// Reads the page's <select> options and the data lists its script fills the
// dependent dropdowns from (upazilas, groups, subjects), keeping the form's
// order everywhere. Nothing on the page is run.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clean = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/`/g, "'").replace(/\s+/g, ' ').trim();
const unique = (list) => [...new Set(list)];
const isOther = (x) => /^other$/i.test(Array.isArray(x) ? x[0] : x);

function listsFromHtml(html) {
  // <select name="..."> -> [[text, value], ...] without the "Select" placeholder.
  function options(name) {
    const m = new RegExp(`<select[^>]*name="${name.replace(/[[\]]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
    if (!m) throw new Error(`no <select name="${name}"> on the page`);
    return [...m[1].matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)]
      .map(([, attrs, text]) => [clean(text), (/value="([^"]*)"/.exec(attrs) || [])[1] ?? ''])
      .filter(([text, value]) => value !== '' && text !== 'Select');
  }
  const names = (name) => options(name).map(([text]) => text);
  // "Other" is added back by the settings page, last, as on the form.
  const listed = (name) => names(name).filter((x) => !isOther(x));

  // `var name = [ ... ];` in the page's inline script, read as data only.
  function dataList(name) {
    const m = new RegExp(`var\\s+${name}\\s*=\\s*\\[`).exec(html);
    if (!m) throw new Error(`no ${name} list on the page`);
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < html.length; j++) {
      if (html[j] === '[') depth++;
      else if (html[j] === ']' && --depth === 0) break;
    }
    return vm.runInNewContext(`(${html.slice(m.index + m[0].length - 1, j + 1)})`, {}, { timeout: 1000 });
  }

  // The form lists a district's upazilas in the order of its data list.
  const upazilas = {};
  for (const u of dataList('upazilaThanaList')) (upazilas[clean(u.dist_name)] ||= []).push(clean(u.thana));
  for (const d of Object.keys(upazilas)) upazilas[d] = unique(upazilas[d]);
  const groups = (list) => list.filter((g) => !isOther(g.value)).map((g) => [clean(g.value), g.type]);

  return {
    source: `${clean((/<title>([^<]*)<\/title>/.exec(html) || [, 'a Teletalk form'])[1])}, ${new Date().toISOString().slice(0, 10)}`,
    basic: {
      nationalities: names('nationality'),
      religions: names('religion'),
      genders: names('gender'),
      maritalStatuses: names('marital_status'),
      quotas: names('quota'),
      departmentalStatuses: names('dep_status'),
    },
    districts: names('present_district'),
    upazilas,
    ssc: { exams: options('ssc_exam'), boards: listed('ssc_board'), results: names('ssc_result_type'), groups: groups(dataList('subjectGroupSSC')) },
    hsc: { exams: options('hsc_exam'), boards: listed('hsc_board'), results: names('hsc_result_type'), groups: groups(dataList('subjectGroupHSC')) },
    graduation: { exams: options('gra_exam'), results: names('gra_result_type'), durations: names('gra_duration') },
    masters: { exams: options('mas_exam'), results: names('mas_result_type'), durations: names('mas_duration') },
    universities: listed('gra_institute'),
    // The full subject list (Masters'), then any graduation-only subjects.
    subjects: unique([...listed('mas_subject'), ...dataList('subjectDegreeListGRA').map((s) => clean(s.value)).filter((s) => !isOther(s))]),
    employmentTypes: names('job[0][employment_type]'),
  };
}

// lists.js source: one line per list, nested lists one level in.
function listsSource(lists) {
  const line = ([k, v]) => (v && v.constructor === Object && k !== 'upazilas'
    ? `  ${k}: {\n${Object.entries(v).map(([kk, vv]) => `    ${kk}: ${JSON.stringify(vv)},`).join('\n')}\n  },`
    : `  ${k}: ${JSON.stringify(v)},`);
  return `// Dropdown options for the settings page, copied from a Teletalk application
// form by scripts/form-lists.js, in the form's order, so answers are worded
// exactly as the forms'. Exams carry the form's codes (they decide which groups
// an exam offers); groups carry their type. Upazilas are keyed by district.
globalThis.TAF_LISTS = {\n${Object.entries(lists).map(line).join('\n')}\n};
`;
}

module.exports = { listsFromHtml, listsSource };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/form-lists.js path/to/application.html');
    process.exit(1);
  }
  const lists = listsFromHtml(fs.readFileSync(file, 'utf8'));
  const out = path.join(__dirname, '..', 'extension', 'lib', 'lists.js');
  fs.writeFileSync(out, listsSource(lists));
  const count = (v) => (Array.isArray(v) ? v.length : Object.values(v).flat().length);
  console.log(`Wrote ${path.relative(process.cwd(), out)} from ${lists.source}`);
  for (const [k, v] of Object.entries(lists)) {
    if (k === 'source') continue;
    console.log(`  ${k}: ${v.constructor === Object && k !== 'upazilas'
      ? Object.entries(v).map(([kk, vv]) => `${kk} ${count(vv)}`).join(', ') : count(v)}`);
  }
}
