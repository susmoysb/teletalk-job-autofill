// Which profile value goes into which form field.
//
// Each def is matched against the controls on the page:
//   label    regex tested on the control's label text (+ placeholder, name, id)
//   exclude  regex that disqualifies a control even if `label` matched
//   section  key of SECTIONS; controls under that heading are preferred
//   strict   only controls under the section's heading, never elsewhere
//   group    fields of one entry (a job); `after` names the entry whose fields
//            these must follow on the page, so entries never mix
//   exists   function(profile) -> whether the entry exists at all
//   kind     'select' | 'text' | 'file' | 'checkbox' | 'date' | 'yesno' to restrict control types
//   value    function(profile) -> value, when it isn't simply profile[key]
//   fallback for 'file': use the next unused file input if no label matches
//   optional not reported as missing when the form doesn't have it
//   allowOther  not in the dropdown: choose its "Other" and type the value in the box it opens
//   yesNo    function(value) -> 'Yes'|'No' when the form asks this as a yes/no question
//
// Loaded as a plain script (extension content script, or evaluated in the page
// by the terminal tool), so it defines a global instead of exporting.
//
// Order matters: a control is only ever used once, so more specific defs
// (e.g. "Father's Name (Bangla)") come before generic ones ("Name").

(() => {
  const SECTIONS = {
    present: (t) => /present|mailing|বর্তমান/i.test(t),
    permanent: (t) => /permanent|স্থায়ী/i.test(t),
    ssc: (t) => /\bssc\b|s\.\s?s\.\s?c|এসএসসি|secondary|মাধ্যমিক|dakhil|দাখিল/i.test(t) &&
      !/higher|\bhsc\b|h\.\s?s\.\s?c|উচ্চ|alim/i.test(t),
    hsc: (t) => /\bhsc\b|h\.\s?s\.\s?c|higher secondary|এইচএসসি|উচ্চ মাধ্যমিক|alim|আলিম/i.test(t),
    graduation: (t) => /graduation|graduate|honou?rs|bachelor|স্নাতক|fazil/i.test(t) &&
      !/post|master|স্নাতকোত্তর/i.test(t),
    masters: (t) => /master|post.?graduat|স্নাতকোত্তর|kamil/i.test(t),
    experience: (t) => /experience|employment|job history|service record|অভিজ্ঞতা/i.test(t),
  };

  // Sections a form may keep closed behind "If Applicable": which profile data needs them.
  const SWITCHABLE = {
    ssc: (p) => !!p.ssc,
    hsc: (p) => !!p.hsc,
    graduation: (p) => !!p.graduation,
    masters: (p) => !!p.masters,
    experience: (p) => !!(p.jobs && p.jobs.length),
  };

  // Any text on the page matching this can start a section.
  const SECTION_KEYWORDS =
    'present|mailing|permanent|বর্তমান|স্থায়ী|ssc|s\\.\\s?s\\.\\s?c|secondary|মাধ্যমিক|এসএসসি|এইচএসসি|' +
    'hsc|h\\.\\s?s\\.\\s?c|graduation|graduate|honou?rs|bachelor|স্নাতক|master|post.?graduat|dakhil|alim|fazil|kamil|' +
    'experience|employment|job history|service record|অভিজ্ঞতা';

  const NOT_ENGLISH = /bangla|bengali|বাংলা/i;

  // Equivalent option texts: when a dropdown has none of the profile's wording,
  // an exact match on one of these is used instead.
  const SYNONYMS = [
    ['Not Applicable', 'Non Quota', 'No Quota', 'None', 'N/A', 'General', 'প্রযোজ্য নয়'],
    ['Islam', 'Muslim'],
    ['Hinduism', 'Hindu'],
    ['Buddhism', 'Buddhist'],
    ['Christianity', 'Christian'],
    ['Single', 'Unmarried'],
    ['Bangladeshi', 'Bangladesh'],
    // New and old English spellings of districts and boards.
    ['Chattogram', 'Chittagong'],
    ['Cumilla', 'Comilla'],
    ['Barishal', 'Barisal'],
    ['Jashore', 'Jessore'],
    ['Bogura', 'Bogra'],
    ['Jhalokathi', 'Jhalakathi', 'Jhalokati'],
    ['Moulvibazar', 'Maulvibazar'],
    ['Netrokona', 'Netrakona'],
    ['Lakshmipur', 'Laxmipur'],
    ['Khagrachhari', 'Khagrachari'],
    // Teletalk writes results with numbers: "1st Division", "2nd Class".
    ['1st Division', 'First Division'],
    ['2nd Division', 'Second Division'],
    ['3rd Division', 'Third Division'],
    ['1st Class', 'First Class'],
    ['2nd Class', 'Second Class'],
    ['3rd Class', 'Third Class'],
    ['Other', 'Others'],
    ['Physically Challenged', 'Physically Handicapped', 'Disabled'],
    ['Yes', 'হ্যাঁ'],
    ['No', 'না'],
  ];

  // Some forms ask "National ID: Yes/No" first and only show the number box
  // after "Yes". The yes/no def answers that; the number def then takes the box.
  function idDefs(key, label, exclude) {
    return [
      { key: `${key} (Yes/No)`, kind: 'yesno', label, exclude, optional: true, value: (p) => (p[key] ? 'Yes' : 'No') },
      { key, kind: 'text', label, exclude },
    ];
  }

  function addressDefs(s) {
    return [
      { key: `${s}.careOf`, section: s, label: /care of|c\/o|কেয়ার/i },
      { key: `${s}.village`, section: s, label: /village|road|house|street|holding|গ্রাম|রাস্তা|বাসা/i },
      { key: `${s}.district`, section: s, label: /district|zill?a|জেলা/i, exclude: /upazill?a|উপজেলা|home|নিজ/i },
      { key: `${s}.upazila`, section: s, label: /upazill?a|thana|p\.?\s?s\b|উপজেলা|থানা/i },
      { key: `${s}.postOffice`, section: s, label: /post\s*office|\bp\.?\s?o\b|ডাকঘর/i, exclude: /code/i },
      { key: `${s}.postCode`, section: s, label: /post\s*code|postal|zip|পোস্ট\s*কোড/i },
    ];
  }

  // Job experience: profile.jobs = [{designation, organization, ...}] in the order
  // the form lists them. Dates are YYYY-MM-DD; "continuing" ticks "currently working".
  const JOB_FIELDS = [
    ['designation', { label: /designation|position|job title|\bpost\b|\brank\b|পদবি|পদের নাম/i, exclude: /post\s*(name|office|code)|appl(y|ied)|আবেদন/i }],
    ['organization', { label: /organi[sz]ation|company|employer|institution|\boffice\b|প্রতিষ্ঠান|অফিস|সংস্থা/i, exclude: /type|address|post\s*office|ধরন|ঠিকানা/i }],
    // "Employed on: Permanent / Temporary / Contractual..."
    ['employmentType', { label: /employ(ed|ment)[\s_]*(on|type|status|basis|nature)|নিয়োগের ধরন|চাকরির (ধরন|প্রকৃতি)/i }],
    ['organizationType', { label: /type|ধরন/i, exclude: /employ|নিয়োগ|চাকরির/i }],
    ['address', { label: /address|location|ঠিকানা/i }],
    ['responsibilities', { label: /responsib|dut(y|ies)|job description|দায়িত্ব/i }],
    ['from', { kind: 'date', label: /from|start|join|length of service|service period|যোগদান|শুরু|হতে/i }],
    ['continuing', { kind: 'checkbox', label: /continu|current|present|till now|to date|চলমান|বর্তমান/i }],
    ['to', { kind: 'date', label: /\bto\b|end|till|until|leav|শেষ|পর্যন্ত/i, exclude: /continu|current/i }],
  ];
  const MAX_JOBS = 5;

  function jobDefs(i) {
    const job = (p) => (p.jobs || [])[i];
    return JOB_FIELDS.map(([field, d]) => ({
      ...d,
      key: `job${i + 1}.${field}`,
      section: 'experience',
      strict: true,
      group: `job${i + 1}`,
      after: i ? `job${i}` : undefined,
      exists: (p) => !!job(p),
      value: (p) => (job(p) || {})[field],
    }));
  }

  const defs = [
    // --- Personal ---
    { key: 'fatherBn', label: /(father|পিতা).*(bangla|bengali|বাংলা)|(bangla|bengali|বাংলা).*(father|পিতা)|পিতার নাম/i, exclude: /english|ইংরেজি/i },
    { key: 'fatherEn', label: /father|পিতা/i, exclude: NOT_ENGLISH },
    { key: 'motherBn', label: /(mother|মাতা).*(bangla|bengali|বাংলা)|(bangla|bengali|বাংলা).*(mother|মাতা)|মাতার নাম/i, exclude: /english|ইংরেজি/i },
    { key: 'motherEn', label: /mother|মাতা/i, exclude: NOT_ENGLISH },
    { key: 'nameBn', label: /(name|নাম).*(bangla|bengali|বাংলা)|(bangla|bengali|বাংলা).*(name|নাম)|প্রার্থীর নাম|আবেদনকারীর নাম/i, exclude: /father|mother|spouse|guardian|পিতা|মাতা|স্বামী|english|ইংরেজি/i },
    { key: 'nameEn', label: /name/i, exclude: /father|mother|spouse|guardian|bangla|bengali|বাংলা|institute|university|board|post|exam|district|upazila|user|course/i },

    // Only birth registration: SSC/HSC forms have their own "Registration No".
    ...idDefs('birthReg', /birth\s*reg|birth.*(certificate|\bno\b|number)|\bbrn\b|জন্ম নিবন্ধন/i, /date|ssc|hsc|exam|board|পরীক্ষা/i),
    { key: 'dob', kind: 'date', label: /date of birth|birth\s*date|\bdob\b|জন্ম তারিখ|জন্ম/i, exclude: /reg|নিবন্ধন|place|district|জেলা/i },
    ...idDefs('nid', /national id|\bnid\b|n\.i\.d|জাতীয় পরিচয়/i, /birth/i),
    ...idDefs('passport', /passport|পাসপোর্ট/i),
    { key: 'gender', label: /gender|\bsex\b|লিঙ্গ/i },
    { key: 'religion', label: /religion|ধর্ম/i },
    { key: 'nationality', label: /nationality|জাতীয়তা/i },
    { key: 'maritalStatus', label: /marital|বৈবাহিক/i },
    // Opened by "Married".
    { key: 'spouseName', label: /spouse|husband|wife|স্বামী|স্ত্রী/i },
    { key: 'confirmMobile', label: /(confirm|re-?type|retype|again|পুনরায়).*(mobile|phone|মোবাইল)|(mobile|phone|মোবাইল).*(confirm|re-?type|retype|again|পুনরায়)/i },
    { key: 'mobile', label: /mobile|phone|cell|মোবাইল/i, exclude: /confirm|re-?type|retype|again|পুনরায়/i },
    { key: 'email', label: /e-?mail|ই-?মেইল/i, exclude: /confirm|re-?type/i },
    { key: 'quota', label: /quota|কোটা/i, exclude: /detail|বিবরণ/i },
    // Opened by a freedom fighter, Birangana or ethnic minority quota.
    { key: 'quotaDetails', label: /quota[\s_]*details?|freedom fighter details|birangana details|ethnicity|কোটার বিবরণ/i },
    // "Departmental Status: Govt. Employee / ... / Not Applicable"; older profiles
    // answered "Departmental candidate: Yes/No". Forms asking Yes/No get Yes only
    // for "Departmental Candidate".
    {
      key: 'departmentalStatus',
      label: /departmental|বিভাগীয় প্রার্থী/i,
      value: (p) => p.departmentalStatus ||
        ({ yes: 'Departmental Candidate', no: 'Not Applicable' })[String(p.departmentalCandidate || '').toLowerCase()],
      yesNo: (v) => (/^(yes|departmental candidate)$/i.test(v) ? 'Yes' : 'No'),
    },
    // Worked out from the address, and most forms don't ask: don't report it as missing.
    { key: 'homeDistrict', optional: true, value: (p) => p.homeDistrict || ((p.permanentSameAsPresent ? p.present : p.permanent) || {}).district, label: /home district|নিজ জেলা/i },

    // --- Addresses (present first: if headings aren't detected, the first of each goes here) ---
    ...addressDefs('present'),
    // Ticked before the permanent fields; when true the filler skips `permanent.*`.
    { key: 'permanentSameAsPresent', kind: 'checkbox', label: /same as|same with|একই|অনুরূপ/i },
    ...addressDefs('permanent'),

    // --- Education ---
    ...['ssc', 'hsc', 'graduation', 'masters'].flatMap((s) => [
      { key: `${s}.exam`, section: s, label: /exam|degree|পরীক্ষা|ডিগ্রি/i, exclude: /year|roll|board|result|সন|রোল|বোর্ড/i },
      ...(s === 'ssc' || s === 'hsc'
        ? [{ key: `${s}.board`, section: s, label: /board|বোর্ড/i, allowOther: true }, { key: `${s}.roll`, section: s, label: /roll|রোল/i }]
        : [{ key: `${s}.institute`, section: s, label: /institute|university|বিশ্ববিদ্যালয়|প্রতিষ্ঠান/i, allowOther: true }]),
      { key: `${s}.result`, section: s, kind: 'select', label: /result|division|class|ফলাফল/i },
      { key: `${s}.gpa`, section: s, kind: 'text', label: /gpa|cgpa|mark|point|result|ফলাফল/i },
      { key: `${s}.group`, section: s, label: /group|subject|বিভাগ|বিষয়/i, allowOther: true },
      { key: `${s}.subject`, section: s, label: /subject|বিষয়/i, allowOther: true },
      { key: `${s}.year`, section: s, label: /year|সন|সাল/i, exclude: /duration|মেয়াদ/i },
      { key: `${s}.duration`, section: s, label: /duration|course|মেয়াদ/i },
    ]),

    // --- Job experience ---
    ...Array.from({ length: MAX_JOBS }, (_, i) => jobDefs(i)).flat(),

    // --- Uploads ---
    { key: 'photo', kind: 'file', label: /photo|picture|image|ছবি/i, exclude: /signature|স্বাক্ষর/i, fallback: true },
    { key: 'signature', kind: 'file', label: /signature|sign|স্বাক্ষর/i, fallback: true },
  ];

  globalThis.TAF_FIELDS = { defs, SECTIONS, SECTION_KEYWORDS, SWITCHABLE, SYNONYMS };
})();
