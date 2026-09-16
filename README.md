# NQEMT-2 Activity Tracker — GitHub Pages + Google Sheets

Same tracker as before, rebuilt on the architecture you spotted in the Kampong Chhnang
feedback site: a static site (hosted free on GitHub Pages) reading and writing a
Google Sheet through a small Google Apps Script backend. No servers, no hosting bills.

## What's already done

- ✅ **The Google Sheet is live**: "NQEMT-2 Activities", already in your Google
  Drive (longsophal@gmail.com), pre-loaded with all 128 activities.
  https://docs.google.com/spreadsheets/d/1OSKJYMr4HOmDbWK04OQKHn2ojbnBLpUtKmlzSANwAks/edit
- ✅ **The site code** (this folder) — ready to publish as-is.
- ✅ **The Apps Script backend code** (`apps-script/Code.gs`) — ready to paste in.

## What you need to do (needs your own Google + GitHub logins, so I can't do these for you)

### 1. Deploy the Apps Script backend (~3 minutes)

1. Open the Sheet (link above) → **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content and paste in the contents of
   `apps-script/Code.gs` from this folder.
3. Check the tab name: at the bottom of the spreadsheet the single tab is
   probably called **Sheet1** — if you renamed it, update the `SHEET_NAME`
   constant at the top of the script to match.
4. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, then **Authorize access** and approve the consent screen
   (it'll warn "Google hasn't verified this app" — that's normal for your own
   script; click **Advanced → Go to (project name)** to proceed).
6. Copy the **Web app URL** (ends in `/exec`).

### 2. Point the site at it

Open `config.js` in this folder and replace the placeholder with the URL you
just copied:

```js
const API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

### 3. Put it on GitHub Pages (~2 minutes)

I don't have a GitHub connection in this session, so this part is on you:

1. Create a new repository on GitHub (e.g. `nqemt2-tracker`) — public, so
   Pages can serve it for free.
2. Upload these files to the repo root: `index.html`, `styles.css`,
   `app.js`, `data.js`, `config.js` (with your real API_URL already pasted in).
   Easiest way: on the repo page, **Add file → Upload files**, then drag in
   all of them from this folder, and commit.
3. Go to **Settings → Pages** in the repo. Under "Build and deployment",
   set **Source: Deploy from a branch**, branch **main**, folder **/ (root)**,
   then **Save**.
4. GitHub gives you a URL like `https://<your-username>.github.io/nqemt2-tracker/`
   — that's your live tracker, shareable with anyone.

### Keeping it updated later

- Edit statuses/notes/dates either straight in the Google Sheet, or through
  the site itself (both write to the same Sheet).
- If you ever edit `Code.gs` again, you must **Deploy → Manage deployments →
  edit (pencil) → New version** — saving the script alone does not update
  the live URL.

## Files in this folder

| File | Purpose |
|---|---|
| `index.html` | The page itself |
| `styles.css` | All styling |
| `app.js` | Chart, timeline, table, and save-to-Sheet logic |
| `data.js` | Bundled sample snapshot (used only until `config.js` is set — lets the page work immediately after upload, before you deploy the script) |
| `config.js` | **Edit this** — one line, your Apps Script URL |
| `apps-script/Code.gs` | Paste into the Sheet's Apps Script editor |

## Note on the CSV export button

Unlike the Claude-hosted version, this is a real static page, so the Export
CSV button downloads a normal file straight from the browser — no extra
setup needed.
