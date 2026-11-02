// extension/lib/lists.js must be exactly what scripts/form-lists.js makes from
// the saved form dropdowns (test/fixtures), so the settings page offers the
// form's options in the form's order. Exits non-zero if they differ.
const fs = require('fs');
const path = require('path');
const { listsFromHtml } = require('../scripts/form-lists');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'teletalk-form-dropdowns.html'), 'utf8');
const made = listsFromHtml(fixture);
require('../extension/lib/lists.js');
const shipped = globalThis.TAF_LISTS;
delete made.source;
const { source, ...rest } = shipped;
const same = JSON.stringify(made) === JSON.stringify(rest);
console.log(same ? '✓ lists.js matches the form\'s dropdowns' : '✗ lists.js differs from what scripts/form-lists.js makes — run: npm run lists -- test/fixtures/teletalk-form-dropdowns.html');
process.exit(same ? 0 : 1);
