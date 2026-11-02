# Teletalk Autofill

Fills Teletalk (alljobs.teletalk.com.bd) job application forms from your saved details.
It never clicks Submit or pays — you check the form, type the captcha and submit yourself.

## Browser extension (recommended)

Works in Chrome, Edge, Brave, Opera and Firefox (desktop and Android). The extension is the
`extension/` folder.

**Publishing to the stores** (easiest install on every browser and device): `npm run ext:build`
makes one package per store in `dist/`. Follow [store/LISTING.md](store/LISTING.md) for the steps,
listing text and privacy answers; screenshots and the promo tile are in `store/`.

Installing by hand, for development:

**Install — Chrome / Edge / Brave**
1. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder. Chrome warns that `background.scripts`
   needs manifest version 2: that line is for Firefox, and Chrome ignores it. The unzipped Chrome zip
   from `dist/` has no such line.
4. Pin it: puzzle-piece icon in the toolbar → pin **Teletalk Autofill**.

**Install — Firefox**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `extension/manifest.json`.

`npm run ext:build` makes one zip per browser in `dist/`, to copy to another computer (unzip, then
load the folder) or to sign. On this computer, load `extension/` directly.

After changing the code: **Reload** on that same page.

Firefox removes temporary add-ons when it closes, and their saved details may go with them
(use **Export backup** on the settings page). To install it permanently, sign it for free as a
private (unlisted) add-on:
1. Sign in at https://addons.mozilla.org/developers/addon/api/key/ and generate API credentials.
2. Run (JWT issuer and secret from that page):
   ```
   WEB_EXT_API_KEY=<JWT issuer> WEB_EXT_API_SECRET=<JWT secret> npm run ext:sign
   ```
3. Open the signed `.xpi` from `dist/` in Firefox (File → Open File, or drag it into a window)
   and click **Add**. Bump `version` in `extension/manifest.json` before signing again.

**Set up once**: the settings page opens the first time you click the button (or right-click
the button → Options). Fill in the form (it saves as you type) and add your photo and signature.
Add jobs in the order the application form lists them. The same details can be edited as JSON
under **Advanced**.

**Apply**: open the job's application form (the toolbar button shows **GO** on a Teletalk form),
choose the post, click the toolbar button. In Firefox the GO badge needs the add-on's permission for
teletalk.com.bd (about:addons → Teletalk Autofill → Permissions); filling works either way.
The settings page lists anything still missing under **Still to do before applying**.
Green outline = filled, red = problem, orange = still empty; a panel on the page lists them.

**Another PC**: on the settings page click **Export backup** — one file with your details,
photo and signature. On the other PC install the extension (copy the signed `.xpi`), then
**Import backup…** that file. Delete the copy afterwards: it holds your NID and address.

## Terminal version

The same filler, driven by Playwright. Details live in `profile.json`
(copy `profile.example.json`) with photo and signature in `files/`.

```
npm install
npm run fill        # opens a browser; go to the form and press Enter in the terminal
npm test            # sample form, layout cases (test/cases.js) and the real extension in Chromium (test/extension.js)
```

## Layout

- `extension/lib/fields.js` — which profile value goes into which form field (label rules)
- `extension/lib/engine.js` — reads the page, fills it, highlights fields, shows the report
- `extension/background.js`, `options.*` — toolbar button and settings page
- `fill.js`, `lib/filler.js` — terminal version; runs the same engine in the page
- `scripts/build.js` — builds the Chrome and Firefox store packages into `dist/`
- `scripts/form-lists.js` — rewrites `extension/lib/lists.js` (the settings page's dropdown options)
  from a saved Teletalk form page: `npm run lists -- path/to/application.html`. `npm test` checks the
  settings page's dropdowns against the saved form dropdowns in `test/fixtures/`, options and order
- `store/` — listing text, privacy policy, screenshots
