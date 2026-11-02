// Runs on Teletalk pages: if this is an application form, tell the toolbar
// button so it can show "GO". Reads the page only; fills nothing.
(() => {
  const controls = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
    .filter((el) => el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const labels = document.body ? document.body.innerText : '';
  if (controls.length >= 5 && /applicant'?s name|father'?s name|examination|আবেদনকারীর নাম/i.test(labels)) {
    chrome.runtime.sendMessage({ type: 'form-ready' });
  }
})();
