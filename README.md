# NQEMT-2 Activity Management System — GitHub Pages + Google Sheets

A static site (hosted free on GitHub Pages) reading and writing a Google Sheet
through a small Google Apps Script backend. No servers, no hosting bills.

**Phase 1 of the Activity Management System upgrade is in this folder**:
sidebar navigation, a filterable Dashboard, full Activities management
(search/filter/sort/paginate/export, with View/Edit/Delete/Duplicate), an
Add/Edit Activity form, the auto delay engine, and the improved Schedule
Timeline. **Calendar (month/week/day) and Reports are Phase 2**, coming next —
their nav items are already there with a placeholder for Reports, and the
Timeline nav item carries today's Schedule Timeline.

## What's already done

- ✅ **The Google Sheet is live**: "NQEMT-2 Activities", already in your Google
  Drive (longsophal@gmail.com), pre-loaded with all 128 activities.
  https://docs.google.com/spreadsheets/d/1OSKJYMr4HOmDbWK04OQKHn2ojbnBLpUtKmlzSANwAks/edit
- ✅ **The site code** (this folder) — ready to publish as-is.
- ✅ **The Apps Script backend code** (`apps-script/Code.gs`) — ready to paste in,
  now with full create/update/delete support, not just single-field edits.

## What you need to do (needs your own Google + GitHub logins, so I can't do these for you)

### 1. Add the new columns to the Google Sheet, and the "Categories" tab

**Easiest way — let the script do it (recommended):** once you've pasted
`apps-script/Code.gs` into the Apps Script editor (step 2 below), pick
**setupSheet** from the function dropdown at the top of the editor (next to
the "Debug" button) and click **Run**. The first time, it'll ask you to
authorize the script — same as deploying. It adds every missing header to
row 1 and creates the **Categories** tab (with its own headers) for you.
It never touches or removes anything already in the sheet, and it's safe to
run more than once if you're not sure whether it already ran.

**Or by hand, if you'd rather:** open the Sheet and add these header names
in the next empty cells of row 1, spelled **exactly** like this
(case-sensitive — the script reads the header row to build the JSON, so
header text becomes the field name): `description`, `responsiblePerson`,
`supportingTeam`, `priority`, `delayOverrideDays` (and `actualStart` /
`actualEnd` too, if the earlier Timeline update didn't already add them).
Any of these you skip just won't be saved when you add/edit an activity
from the site — the rest still works.

Then, for the Category page: click **+** at the bottom of the spreadsheet
to add a new tab, name it exactly **Categories**, and add these three
headers in its row 1: `id`, `name`, `group`. Leave the rest of the tab
empty — the site creates rows here itself the first time you add a
category. If you skip this tab, the Category page still opens but shows
"0 categories" until you add it.

### 1c. Fill the Categories tab from your existing activities (optional but recommended)

Right after `setupSheet` creates the Categories tab, it's empty — the
Category page will correctly show "0 categories" until it has rows; that's
expected, not a bug. To populate it with the category names you're already
using across your 128 activities (instead of typing them in one by one),
run **seedCategoriesFromActivities** from the same function dropdown, right
after running `setupSheet`. It scans every activity's category, works out
its most common color group, and adds one row per unique category name. It
skips any name already in the tab, so it's safe to re-run later after
adding new activities with new category names.

### 2. Deploy the Apps Script backend (~3 minutes)

1. Open the Sheet (link above) → **Extensions → Apps Script**.
2. Delete the placeholder `Code.gs` content and paste in the contents of
   `apps-script/Code.gs` from this folder (this is a full replacement — it
   now handles create/update/delete, not just single-field edits).
3. Check the tab name: at the bottom of the spreadsheet the single tab is
   probably called **Sheet1** — if you renamed it, update the `SHEET_NAME`
   constant at the top of the script to match.
4. If you already have a deployment: **Deploy → Manage deployments → edit
   (pencil) → New version → Deploy** (editing the script alone never updates
   a live `/exec` URL). If this is your first time: **Deploy → New
   deployment** → type **Web app** → Execute as **Me** → Who has access
   **Anyone** → **Deploy** → **Authorize access** (approve the "Google
   hasn't verified this app" warning via **Advanced → Go to (project
   name)**) → copy the **Web app URL** (ends in `/exec`).

### 3. Point the site at it

Open `config.js` and make sure `API_URL` has your real deployed URL (already
done if you set this up before):

```js
const API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

### 4. Put it on GitHub Pages

Upload/overwrite these files at the repo root: `index.html`, `styles.css`,
`app.js`, `data.js`, `config.js`, and `apps-script/Code.gs` (in its
subfolder) — same filenames, same locations as before. GitHub Pages picks up
the change automatically once committed.

## What's new in this update

### Sidebar navigation

A left sidebar (collapses to a hamburger menu on phones/narrow screens) with
**Dashboard**, **Calendar / Timeline**, **Schedule Timeline** (new — a
separate full-year Gantt view, see below), **Activities**, **Add Activity**,
**Category**, **Reports** (Phase 2 placeholder), and **Settings**.

### Dashboard

KPI cards (Total, Completed, In Progress, Upcoming, Delayed, Overdue) and
four charts (by month, by status, by category, planned vs. actual), plus a
Delay Summary — all computed live from whatever the Year / Month / Category
/ Responsible Person / Status filters at the top currently select.

A note on two KPIs that sound similar: **Delayed** counts activities that
*finished* late (an actual end date recorded after the planned end).
**Overdue** counts activities that are *currently* late — the planned end
date has passed and there's no actual end date yet. Let me know if you'd
rather these be defined differently.

### Activities page

The searchable/filterable/sortable table now has an ID column, a
Responsible column, a Delay column (auto-computed), pagination (10/25/50/100
rows per page), and an Action column with **View** (read-only details),
**Edit** (opens the Add/Edit form pre-filled), **Duplicate** (opens the form
pre-filled as a new copy, status reset to Planned, nothing saved until you
submit), and **Delete** (asks for confirmation first). Export CSV now
includes every new field.

### Category page (new)

A dedicated "Category" page in the sidebar for managing the category list
activities are tagged with — a table of every category with its chart-color
group and how many activities currently use it, plus **Add**, **Edit**, and
**Delete**. Renaming a category updates every activity already using the old
name automatically, so nothing is left showing a stale category. Deleting is
blocked (with a message telling you how many activities are affected) while
any activity still uses that category — reassign those activities on the
Activities page first, then delete. This list is stored in the new
**Categories** tab (step 1b above); the Add/Edit Activity form's category
field still accepts free text too, for one-off or legacy values.

### Add / Edit Activity form

All the fields from your spec: Activity Name, Description, Category,
Responsible Person, Supporting Person/Team, Priority, Status, Planned
Start/End, Actual Start/End, Remarks. The Activity ID is generated
automatically (shown read-only when editing). Category, Responsible Person,
and Supporting Team are free-text with autocomplete suggestions drawn from
your existing data (they're not fixed lists, since your organization doesn't
have one predefined) — Category Group (used for chart colors) is guessed
automatically from the category text. Year/month/week position for the
timeline are worked out automatically from the Planned dates — you don't
enter them.

There's also an optional **Delay override (days)** field, per the spec's
"don't allow typing the delay unless there's an override field" — leave it
blank and delay is auto-computed from dates; fill it in only if you need to
force a specific delay figure.

### Delay engine (used everywhere — Dashboard, Activities, Timeline, Schedule Timeline)

- **Upcoming** — the planned start date hasn't arrived yet; nothing has
  started.
- **On Time** — the planned period has started, the planned end date hasn't
  passed yet, and nothing about it looks late — i.e. it's currently underway
  and still tracking on schedule.
- **Delayed** — planned end date has passed and no actual end date is
  recorded yet.
- **Completed** — an actual end date is recorded on/before the planned end.
- **Completed (delayed)** — an actual end date is recorded, but after the
  planned end.
- **Rescheduled** — the actual period doesn't overlap the planned period at
  all.
- **Cancelled** — driven by the Status field, same as before.

**Upcoming vs. On Time**, since these look similar at a glance: both mean
"nothing to worry about yet," but Upcoming means it hasn't begun, while On
Time means it has begun (today is on/after the planned start) and is still
within its planned window. This is separate from the manual Status field —
an activity can show Status "Planned" while its Delay reads "On Time"
because it entered its planned window without anyone updating Status yet.

### Timeline

Delay/status badges on each bar, a weekly period scale under each month,
planned-vs-actual bars when they differ, a Delay Summary, and a legend.
Clicking a bar jumps to that activity in the Activities table.

Activities that overlap in date range are now automatically placed on
separate horizontal lanes within their month, so bars never cover each
other — a month with several overlapping activities simply grows taller.
Non-overlapping activities still share a lane. This is calculated
automatically from each activity's planned dates (sorted by start, then end)
every time the timeline renders — there's nothing to configure per activity,
and nothing in the Sheet changes. On narrow screens the timeline scrolls
horizontally rather than squeezing bars unreadably thin.

### Schedule Timeline (new — separate page)

A new **"Schedule Timeline"** item in the sidebar, right under Calendar /
Timeline. It's a completely separate page — the existing Calendar / Timeline
page above is untouched, same code, same route, same look.

This one is a full-year Gantt: every activity gets its own row (so bars
never overlap), with Jan–Dec running across the top and each month split
into wider week columns matching the layout in the reference you shared —
sized for readability rather than the cramped, compressed look of the
first version. Each week column is a real Sunday–Saturday calendar week —
the same week you'd see on any calendar — not an artificial even split of
each month's day count, so an activity always lines up under the actual
week it falls in. A week that straddles two months (e.g. its last couple
of days spill into the next month) is grouped under whichever month holds
most of its days, same as an ordinary month-view calendar; because of
that, the number of week columns per month (4 or 5) now comes from the
real calendar for that year rather than a fixed pattern, and can shift
slightly year to year. The Activities column stays pinned on the left
while you scroll sideways through the year, and the header row stays
pinned while you scroll down through a long activity list.

Each row shows the planned (budget) period as a colored bar (colored by
category, same as the other charts), with a second, hatched bar underneath
for the Actual Start/End dates whenever they're recorded and differ from the
plan. Instead of the activity name, the bar is labeled with the total
number of budget days it covers (e.g. "30 Days" — Planned Start through
Planned End, inclusive). The bar's left edge always sits exactly at the
Planned Start date and never moves; its width is the real date span
whenever that's already enough to hold the label. Only when the true
duration is genuinely too narrow for "N Days" to fit does the bar's right
edge extend a little further — just enough for the text, never across
whole extra weeks — so a short (1–2 day) activity's bar still starts and
reads at the correct place on the grid and the label always stays inside
the bar rather than floating outside it. Hovering any bar still gives the
full detail — activity, category, exact dates, status, delay — as a
tooltip. Under the activity name in the pinned column
you'll now also see its Budget Category (the same Category field used
everywhere else), its Budget Start – End dates (the same Planned Start/End
dates, formatted as a range), then its Status and an auto-computed Delay
chip (Upcoming / On Time / Delayed +Nd / Completed / Rescheduled /
Cancelled, same delay engine as everywhere else in the app). Filters at the
top narrow it down by
Year (which year's Jan–Dec grid to show), Month, Category, Responsible
Person, and Status. Clicking any bar opens that activity's full detail
popup (the same one as the Activities page's "View" button).

### Settings

Light / dark / system theme toggle (remembered per browser), a link to open
the Google Sheet directly, a live/demo connection indicator, and the current
activity count.

## Known limitations to flag now

- The timeline draws each activity within a single month (day-of-month
  position). An activity whose Planned End spans into the next month still
  saves correctly and shows correctly everywhere else, but its timeline bar
  is drawn through the end of its start month. Let me know if activities
  routinely span multiple months and I'll rework the timeline to handle it.
- There's still no login/auth on the Apps Script endpoint (same as before) —
  anyone with the URL can read and write the Sheet. That was an accepted
  trade-off for the "no servers" approach; happy to add a shared-secret
  check if you want one.
- Calendar (month/week/day views) and the Reports section are Phase 2 — the
  nav items exist now so the sidebar won't need to change shape later.

## Files in this folder

| File | Purpose |
|---|---|
| `index.html` | The page itself (sidebar, all sections) |
| `styles.css` | All styling |
| `app.js` | Routing, dashboard, activities, categories, timeline, Schedule Timeline (Gantt), form, and save-to-Sheet logic |
| `data.js` | Bundled sample snapshot (used only until `config.js` is set — lets the page work immediately after upload, before you deploy the script) |
| `config.js` | **Edit this** — your Apps Script URL, and optionally your Sheet's URL |
| `apps-script/Code.gs` | Paste into the Sheet's Apps Script editor |

## Note on the CSV export button

This is a real static page, so the Export CSV button (visible on the
Activities page) downloads a normal file straight from the browser — no
extra setup needed.
