// Toolbar button: fill the form in the current tab from the saved profile.
// Chrome runs this as a service worker, Firefox as a background script.

const ENGINE_FILES = ['lib/fields.js', 'lib/engine.js'];

function badge(tabId, text, color, title) {
  chrome.action.setBadgeText({ tabId, text });
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setTitle({ tabId, title: title || 'Fill this application form' });
}

async function loadProfile() {
  const { profile, photo, signature } = await chrome.storage.local.get(['profile', 'photo', 'signature']);
  // Only the image to upload; a resized image's original stays in storage.
  const upload = (item) => item && { name: item.name, dataUrl: item.dataUrl };
  return profile ? { ...profile, photo: upload(photo), signature: upload(signature) } : null;
}

// Tabs showing a fill result: the "GO" badge must not replace it.
const resultTabs = new Set();
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') resultTabs.delete(tabId);
});

async function fillTab(tab) {
  const profile = await loadProfile();
  if (!profile) {
    chrome.runtime.openOptionsPage();
    return null;
  }
  const target = { tabId: tab.id, allFrames: true };
  try {
    badge(tab.id, '…', '#666');
    await chrome.scripting.executeScript({ target, files: ENGINE_FILES });
    const results = await chrome.scripting.executeScript({
      target,
      func: (p) => globalThis.TAF_ENGINE && globalThis.TAF_ENGINE.fill(p),
      args: [profile],
    });
    const reports = results.map((r) => r.result).filter(Boolean);
    const [{ result: summary }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: (rs) => globalThis.TAF_ENGINE.showReport(globalThis.TAF_ENGINE.mergeReports(rs)),
      args: [reports],
    });
    resultTabs.add(tab.id);
    if (summary.problems) badge(tab.id, String(summary.filled), '#d32f2f', `${summary.problems} problem(s) — see the panel on the page`);
    else badge(tab.id, String(summary.filled), '#2e7d32', `Filled ${summary.filled} field(s)`);
    return summary;
  } catch (e) {
    // e.g. browser pages (chrome://, addons store) that extensions may not touch
    badge(tab.id, '✗', '#d32f2f', `Could not fill this page: ${e.message}`);
    console.error(e);
    return { error: e.message };
  }
}

chrome.action.onClicked.addListener(fillTab);

// The report panel's "Fix in settings" buttons: open the settings page at a
// section (#uploads, #education...), next to the form's tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // detect.js: a Teletalk application form is open in this tab.
  if (msg && msg.type === 'form-ready' && sender.tab && !resultTabs.has(sender.tab.id)) {
    badge(sender.tab.id, 'GO', '#1565c0', 'Teletalk form open — click to fill it');
    return;
  }
  if (!msg || msg.type !== 'open-settings') return;
  const section = /^[a-z-]+$/.test(msg.section || '') ? msg.section : '';
  // A settings page already open comes forward instead of a second one opening.
  const open = () => chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${section ? `#${section}` : ''}`), index: sender.tab ? sender.tab.index + 1 : undefined });
  chrome.runtime.sendMessage({ type: 'show-settings', section })
    .then((shown) => shown || open(), open)
    .then(() => sendResponse(true), () => sendResponse(false));
  return true; // answers once the tab is shown
});
globalThis.fillTab = fillTab; // for tests
