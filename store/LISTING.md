# Publishing Teletalk Autofill

Build the packages first:

```
npm run ext:build
```

This makes `dist/teletalk-autofill-chrome-<version>.zip` and `dist/teletalk-autofill-firefox-<version>.zip`.
For every update, raise `version` in `extension/manifest.json` and build again.

Both stores need a public URL for the privacy policy: put `store/PRIVACY.md` somewhere public
(for example a GitHub Gist) after filling in your email address.

---

## Firefox Add-ons (free) — Firefox desktop and Android

1. Sign in at https://addons.mozilla.org/developers/ → **Submit a New Add-on**.
2. Choose **On this site** (listed). A listed add-on can be found on addons.mozilla.org,
   installs in one click and comes back automatically through Firefox Sync.
3. Upload `dist/teletalk-autofill-firefox-<version>.zip`. Tick **Firefox for Android** as well.
4. Source code question: **No** (the code is not minified or bundled).
5. Fill the listing from the text below, and upload the screenshots from `store/`.

Review is usually quick (minutes to a few days).

## Chrome Web Store ($5 once) — Chrome, Edge, Brave, Opera, Vivaldi

1. Register at https://chrome.google.com/webstore/devconsole and pay the one-time fee.
2. **New item** → upload `dist/teletalk-autofill-chrome-<version>.zip`.
3. **Store listing**: text below, `store/screenshot-*.png` (1280×800), `store/promo-440x280.png`
   as the small promo tile, category **Productivity**, language **English**.
4. **Privacy practices**: use the answers below.
5. **Distribution → Visibility**: **Public**, or **Unlisted** (installable only with the link).
6. **Submit for review.** Review usually takes a few days.

Edge, Brave, Opera and Vivaldi install straight from the Chrome Web Store. Edge asks once to
"Allow extensions from other stores".

---

## Listing text

**Name:** Teletalk Autofill

**Summary** (132 characters max):
> Unofficial helper: fills Teletalk job application forms from your saved profile in one click. Never submits or pays.

**Description:**
> Tired of typing the same details into every Teletalk job application? Save them once, then fill any application form with one click.
>
> HOW IT WORKS
> 1. Open the extension's settings, enter your details and add your photo and signature.
> 2. Open a job's application form on Teletalk and choose the post.
> 3. Click the extension's toolbar button.
>
> It fills names (English and Bangla), parents' names, date of birth, NID / birth registration / passport, contact details, quota, present and permanent address (including district and upazila), SSC, HSC, graduation and masters results, and uploads your photo and signature.
>
> Filled fields get a green outline, fields that need your attention get red or orange, and a panel on the page lists them.
>
> SAFE BY DESIGN
> • Never clicks Submit and never pays. You check the form, type the captcha and submit it yourself.
> • Your details stay in your browser, on your device. Nothing is sent anywhere. No tracking, no ads.
> • Export backup puts your details, photo and signature in one file for moving to another computer.
>
> Unofficial. Not affiliated with or endorsed by Teletalk Bangladesh Ltd.

---

## Chrome Web Store: privacy practices

**Single purpose:**
> Fills Teletalk job application forms with the details the user saved in the extension, when the user clicks the toolbar button.

**Permission justifications:**
- **activeTab** — to fill the application form in the tab where the user clicked the toolbar button.
- **scripting** — to run the form-filling script in that tab and its frames when the button is clicked.
- **storage** — to keep the user's saved details, photo and signature on their device.
- **Host permission (`*://*.teletalk.com.bd/*`)** — Teletalk application forms can be embedded from other teletalk.com.bd subdomains. This lets the button fill those embedded forms too.

**Remote code:** No, I am not using remote code.

**Data usage:** tick **Personally identifiable information**. The extension stores it locally to fill forms, even though it never transmits it. Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** the public link to `store/PRIVACY.md`.
