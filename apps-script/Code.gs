/**
 * NQEMT-2 Activity Management System — Google Apps Script backend.
 *
 * Deploy this bound to (or pointed at) the "NQEMT-2 Activities" Google Sheet.
 * It serves the sheet's rows as JSON (GET) and lets the static site read and
 * write activities (POST): quick single-field edits, full create/update, and
 * delete.
 *
 * SETUP
 * 1. Open the "NQEMT-2 Activities" Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Delete the default content of Code.gs and paste this whole file in.
 * 4. Confirm SHEET_NAME below matches the tab name at the bottom of the
 *    spreadsheet (it's usually "Sheet1" for a sheet created from a CSV
 *    import — rename either the tab or this constant so they match).
 * 5. Edit the APP_USERS map below to your own username/password pairs, and
 *    copy the SAME pairs into the APP_USERS list in config.js on the static
 *    site — the site's login screen and this script's own check must agree,
 *    or every request will be rejected as Unauthorized.
 * 6. Deploy > New deployment > select type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 7. Copy the deployment's "Web app URL" (ends in /exec) into config.js
 *    as API_URL in the static site.
 * 8. Re-deploy (Deploy > Manage deployments > edit > new version) any time
 *    you change this file — editing alone does not update a live deployment.
 *
 * SHEET COLUMNS (header row, any order — the script reads columns by name)
 *   id, year, month, monthName, startDate, endDate, startDay, endDay,
 *   activity, description, category, categoryGroup, responsiblePerson,
 *   supportingTeam, priority, status, notes, actualStart, actualEnd,
 *   delayOverrideDays, delayEndDate
 * Any column this script writes to that doesn't exist yet is silently
 * skipped — add the header first if you want that field to persist.
 *
 * A second tab, "Categories" (see CATEGORIES_SHEET_NAME below), backs the
 * site's Category management page. Add a tab with that name and a header
 * row of just `id, name, group` — the site reads/writes it the same
 * generic way as the Activities tab, selected via a "sheet":"categories"
 * flag on each request instead of a different endpoint.
 *
 * A third tab, "SubActivities" (see SUBACTIVITIES_SHEET_NAME below), backs
 * the Activity Timeline's optional Main Activity + Sub-activities (phases)
 * feature. Each phase now tracks the same Planned/Actual/Status/Delay
 * fields as a Main Activity. Add a tab with that name and a header row of
 * `id, activityId, name, startDate, endDate, actualStart, actualEnd,
 * status, delayEndDate, order` — selected the same
 * generic way via a "sheet":"subactivities" flag. Each row is one named
 * phase (e.g. Tender, Design, Construction, Reporting) belonging to one
 * activity (activityId matches that activity's own id in Sheet1). An
 * activity with no rows here just keeps showing its existing automatic
 * Planned/In Progress/Delay bar — this is purely additive.
 *
 * SETUP HELPERS
 * Don't want to add the columns/tabs above by hand? After pasting this file
 * in, pick "setupSheet" from the function dropdown at the top of the Apps
 * Script editor (next to "Debug") and click "Run". It adds any missing
 * Activities headers and creates the Categories and SubActivities tabs if
 * needed — it never touches or removes existing data, and is safe to run
 * more than once. The first run will ask you to authorize the script (same
 * as deploying).
 *
 * The Categories tab starts out empty — that's normal, not a bug — the
 * Category page will show "0 categories" until it has rows. Once
 * setupSheet has run, pick "seedCategoriesFromActivities" from the same
 * dropdown and click Run: it scans every category name already used across
 * your activities, works out each one's most common chart-color group, and
 * adds one row per category to the Categories tab. It only adds names that
 * aren't already there, so it's safe to run again later after you add new
 * activities with new category names.
 */

const SHEET_ID = '1OSKJYMr4HOmDbWK04OQKHn2ojbnBLpUtKmlzSANwAks'; // NQEMT-2 Activities
const SHEET_NAME = 'Sheet1';
const CATEGORIES_SHEET_NAME = 'Categories';
const SUBACTIVITIES_SHEET_NAME = 'SubActivities';

// Maps the "sheet" request parameter/body-field to the actual tab name and
// the JSON key its rows are returned/expected under. Add an entry here (and
// a matching tab) to expose another generic sheet the same way, without
// touching doGet/doPost themselves.
const SHEET_ROUTES = {
  'categories': { tab: CATEGORIES_SHEET_NAME, listKey: 'categories', resultKey: 'category' },
  'subactivities': { tab: SUBACTIVITIES_SHEET_NAME, listKey: 'subActivities', resultKey: 'subActivity' }
};
function _routeFor(sheetParam) {
  return SHEET_ROUTES.hasOwnProperty(sheetParam)
    ? SHEET_ROUTES[sheetParam]
    : { tab: SHEET_NAME, listKey: 'activities', resultKey: 'activity' };
}
// Fields the site's inline quick-edit controls are allowed to touch via the
// legacy {id, field, value} POST shape. Full create/update (below) can write
// any column that exists in the sheet's header row.
const EDITABLE_FIELDS = ['status', 'notes', 'actualDate', 'actualStart', 'actualEnd', 'priority', 'responsiblePerson', 'supportingTeam', 'delayOverrideDays', 'delayEndDate'];

// Login accounts for the site's login screen — must have the exact same
// username/password pairs as the APP_USERS list in config.js (the two are
// kept in sync by hand; there's no shared source of truth between a static
// site and this script). This is what actually protects your data: even
// someone who finds this Web app's /exec URL directly (e.g. from the site's
// page source) gets rejected here unless they also have a valid username
// and password. It is NOT strong security — the values below live in this
// script's plain-text source, and anyone with edit access to this Apps
// Script project (or who guesses/leaks a password) can read or bypass it —
// but it does stop casual/opportunistic access by people who merely find
// the site's link.
const APP_USERS = {
  'admin': 'admin2026'
};
function _isAuthorized(e) {
  const u = e && e.parameter && e.parameter.u;
  const p = e && e.parameter && e.parameter.p;
  if (!u) return false;
  return APP_USERS.hasOwnProperty(u) && APP_USERS[u] === p;
}

function doGet(e) {
  if (!_isAuthorized(e)) return _json({ ok: false, error: 'Unauthorized', unauthorized: true });
  const route = _routeFor(e && e.parameter && e.parameter.sheet);
  const sheet = _sheet(route.tab);
  if (!sheet) {
    const res = { ok: false, error: '"' + route.tab + '" tab not found' + (route.tab === SHEET_NAME ? '.' : ' — add it to the Sheet first.') };
    res[route.listKey] = [];
    return _json(res);
  }
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1)
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
  const res = { ok: true };
  res[route.listKey] = rows;
  return _json(res);
}

function doPost(e) {
  if (!_isAuthorized(e)) return _json({ ok: false, error: 'Unauthorized', unauthorized: true });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (!e.postData || !e.postData.contents) {
      return _json({ ok: false, error: 'missing request body' });
    }
    const body = JSON.parse(e.postData.contents);
    const action = body.action || 'updateField';
    const route = _routeFor(body.sheet);
    const resultKey = route.resultKey;
    const sheet = _sheet(route.tab);
    if (!sheet) {
      return _json({ ok: false, error: '"' + route.tab + '" tab not found — add it to the Sheet first.' });
    }
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    if (idCol === -1) return _json({ ok: false, error: 'sheet is missing an "id" column' });

    if (action === 'updateField') return _updateField(sheet, data, headers, idCol, body);
    if (action === 'update') return _update(sheet, data, headers, idCol, body, resultKey);
    if (action === 'create') return _create(sheet, data, headers, idCol, body, resultKey);
    if (action === 'delete') return _delete(sheet, data, idCol, body);
    return _json({ ok: false, error: 'unknown action "' + action + '"' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function _updateField(sheet, data, headers, idCol, body) {
  const id = String(body.id || '');
  const field = body.field;
  const value = body.value === undefined ? '' : body.value;
  if (!id) return _json({ ok: false, error: 'missing id' });
  if (EDITABLE_FIELDS.indexOf(field) === -1) {
    return _json({ ok: false, error: 'field "' + field + '" is not editable' });
  }
  const fieldCol = headers.indexOf(field);
  if (fieldCol === -1) return _json({ ok: false, error: 'sheet is missing an expected column' });
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === id) {
      sheet.getRange(r + 1, fieldCol + 1).setValue(value);
      return _json({ ok: true, id: id, field: field, value: value });
    }
  }
  return _json({ ok: false, error: 'no activity with id ' + id });
}

function _update(sheet, data, headers, idCol, body, resultKey) {
  resultKey = resultKey || 'activity';
  const id = String(body.id || '');
  const fields = body.fields || {};
  if (!id) return _json({ ok: false, error: 'missing id' });
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === id) {
      Object.keys(fields).forEach(function (key) {
        const col = headers.indexOf(key);
        if (col !== -1) sheet.getRange(r + 1, col + 1).setValue(fields[key]);
      });
      const updated = {};
      headers.forEach(function (h, i) {
        updated[h] = (h === 'id') ? id : (fields.hasOwnProperty(h) ? fields[h] : data[r][i]);
      });
      const res = { ok: true }; res[resultKey] = updated;
      return _json(res);
    }
  }
  return _json({ ok: false, error: 'no row with id ' + id });
}

function _create(sheet, data, headers, idCol, body, resultKey) {
  resultKey = resultKey || 'activity';
  const fields = body.fields || {};
  let maxId = 0;
  for (let r = 1; r < data.length; r++) {
    const n = parseInt(data[r][idCol], 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  }
  const newId = String(maxId + 1);
  const row = headers.map(function (h) {
    if (h === 'id') return newId;
    return fields.hasOwnProperty(h) ? fields[h] : '';
  });
  sheet.appendRow(row);
  const created = {};
  headers.forEach(function (h, i) { created[h] = row[i]; });
  const res = { ok: true }; res[resultKey] = created;
  return _json(res);
}

function _delete(sheet, data, idCol, body) {
  const id = String(body.id || '');
  if (!id) return _json({ ok: false, error: 'missing id' });
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === id) {
      sheet.deleteRow(r + 1);
      return _json({ ok: true, id: id });
    }
  }
  return _json({ ok: false, error: 'no row with id ' + id });
}

/**
 * One-time setup helper — run this once from the Apps Script editor
 * (select "setupSheet" in the function dropdown, then click Run) to add the
 * columns and the Categories tab the site needs. Safe to run more than
 * once: it only appends headers that are missing and never removes,
 * reorders, or overwrites anything already in the sheet.
 */
function setupSheet() {
  const REQUIRED_ACTIVITY_HEADERS = [
    'id', 'year', 'month', 'monthName', 'startDate', 'endDate',
    'startDay', 'endDay', 'activity', 'description', 'category',
    'categoryGroup', 'responsiblePerson', 'supportingTeam', 'priority',
    'status', 'notes', 'actualStart', 'actualEnd', 'delayOverrideDays',
    'delayEndDate'
  ];
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('"' + SHEET_NAME + '" tab not found — check the SHEET_NAME constant at the top of this file.');
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const missingActivityHeaders = REQUIRED_ACTIVITY_HEADERS.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missingActivityHeaders.length) {
    sheet.getRange(1, lastCol + 1, 1, missingActivityHeaders.length).setValues([missingActivityHeaders]);
  }

  let catSheet = ss.getSheetByName(CATEGORIES_SHEET_NAME);
  let categoriesCreated = false;
  if (!catSheet) {
    catSheet = ss.insertSheet(CATEGORIES_SHEET_NAME);
    catSheet.getRange(1, 1, 1, 3).setValues([['id', 'name', 'group']]);
    categoriesCreated = true;
  } else {
    const catLastCol = catSheet.getLastColumn();
    const catExisting = catLastCol > 0 ? catSheet.getRange(1, 1, 1, catLastCol).getValues()[0] : [];
    const missingCatHeaders = ['id', 'name', 'group'].filter(function (h) { return catExisting.indexOf(h) === -1; });
    if (missingCatHeaders.length) {
      catSheet.getRange(1, catLastCol + 1, 1, missingCatHeaders.length).setValues([missingCatHeaders]);
    }
  }

  const SUBACT_HEADERS = ['id', 'activityId', 'name', 'startDate', 'endDate', 'actualStart', 'actualEnd', 'status', 'delayEndDate', 'order'];
  let subSheet = ss.getSheetByName(SUBACTIVITIES_SHEET_NAME);
  let subActivitiesCreated = false;
  if (!subSheet) {
    subSheet = ss.insertSheet(SUBACTIVITIES_SHEET_NAME);
    subSheet.getRange(1, 1, 1, SUBACT_HEADERS.length).setValues([SUBACT_HEADERS]);
    subActivitiesCreated = true;
  } else {
    const subLastCol = subSheet.getLastColumn();
    const subExisting = subLastCol > 0 ? subSheet.getRange(1, 1, 1, subLastCol).getValues()[0] : [];
    const missingSubHeaders = SUBACT_HEADERS.filter(function (h) { return subExisting.indexOf(h) === -1; });
    if (missingSubHeaders.length) {
      subSheet.getRange(1, subLastCol + 1, 1, missingSubHeaders.length).setValues([missingSubHeaders]);
    }
  }

  Logger.log(
    'Setup complete.\nActivities headers added: ' +
    (missingActivityHeaders.length ? missingActivityHeaders.join(', ') : '(none needed, already present)') +
    '.\nCategories tab: ' + (categoriesCreated ? 'created new' : 'already existed, checked headers') +
    '.\nSubActivities tab: ' + (subActivitiesCreated ? 'created new' : 'already existed, checked headers') + '.'
  );
}

/**
 * One-time setup helper — run this once (after setupSheet) to populate the
 * Categories tab from the category names already used in your activities.
 * For each unique category name found in Sheet1, it works out the most
 * common categoryGroup value paired with it (falling back to "Other") and
 * appends one row. Existing rows in the Categories tab are left untouched;
 * it only adds names that aren't already there, so it's safe to re-run
 * after adding new activities with new category names.
 */
function seedCategoriesFromActivities() {
  const VALID_GROUPS = ['Training & Workshops', 'QIWG', 'Coaching', 'Meetings & Partners', 'Assessment', 'Other'];
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('"' + SHEET_NAME + '" tab not found — check the SHEET_NAME constant at the top of this file.');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const catCol = headers.indexOf('category');
  const groupCol = headers.indexOf('categoryGroup');
  if (catCol === -1) throw new Error('"' + SHEET_NAME + '" has no "category" column — run setupSheet first.');

  const tally = {}; // name -> { groupName: count }
  for (let r = 1; r < data.length; r++) {
    const name = String(data[r][catCol] || '').trim();
    if (!name) continue;
    const rawGroup = groupCol !== -1 ? String(data[r][groupCol] || '').trim() : '';
    const group = VALID_GROUPS.indexOf(rawGroup) >= 0 ? rawGroup : 'Other';
    if (!tally[name]) tally[name] = {};
    tally[name][group] = (tally[name][group] || 0) + 1;
  }

  const catSheet = ss.getSheetByName(CATEGORIES_SHEET_NAME);
  if (!catSheet) throw new Error('"' + CATEGORIES_SHEET_NAME + '" tab not found — run setupSheet first.');
  const catData = catSheet.getDataRange().getValues();
  const catHeaders = catData[0] || [];
  const nameCol = catHeaders.indexOf('name');
  const idColC = catHeaders.indexOf('id');
  const groupColC = catHeaders.indexOf('group');
  if (nameCol === -1 || idColC === -1 || groupColC === -1) {
    throw new Error('"' + CATEGORIES_SHEET_NAME + '" tab is missing id/name/group headers — run setupSheet first.');
  }

  const existingNames = {};
  let maxId = 0;
  for (let r = 1; r < catData.length; r++) {
    const n = String(catData[r][nameCol] || '').trim();
    if (n) existingNames[n] = true;
    const idNum = parseInt(catData[r][idColC], 10);
    if (!isNaN(idNum) && idNum > maxId) maxId = idNum;
  }

  const newRows = [];
  Object.keys(tally).sort().forEach(function (name) {
    if (existingNames[name]) return;
    const counts = tally[name];
    let bestGroup = 'Other', bestCount = -1;
    Object.keys(counts).forEach(function (g) {
      if (counts[g] > bestCount) { bestCount = counts[g]; bestGroup = g; }
    });
    maxId += 1;
    newRows.push([String(maxId), name, bestGroup]);
  });

  if (newRows.length) {
    catSheet.getRange(catSheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
  }

  Logger.log(
    'Seed complete. Categories added: ' + newRows.length +
    (newRows.length ? ' (' + newRows.map(function (r) { return r[1]; }).join(', ') + ')' : ' (none needed, all already present).')
  );
}

function _sheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name || SHEET_NAME);
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
