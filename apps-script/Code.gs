/**
 * NQEMT-2 Activity Tracker — Google Apps Script backend.
 *
 * Deploy this bound to (or pointed at) the "NQEMT-2 Activities" Google Sheet.
 * It serves the sheet's rows as JSON (GET) and lets the static site update
 * one cell at a time (POST) — status, notes, or actual completion date.
 *
 * SETUP
 * 1. Open the "NQEMT-2 Activities" Google Sheet.
 * 2. Extensions > Apps Script.
 * 3. Delete the default content of Code.gs and paste this whole file in.
 * 4. Confirm SHEET_NAME below matches the tab name at the bottom of the
 *    spreadsheet (it's usually "Sheet1" for a sheet created from a CSV
 *    import — rename either the tab or this constant so they match).
 * 5. Deploy > New deployment > select type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 6. Copy the deployment's "Web app URL" (ends in /exec) into config.js
 *    as API_URL in the static site.
 * 7. Re-deploy (Deploy > Manage deployments > edit > new version) any time
 *    you change this file — editing alone does not update a live deployment.
 */

const SHEET_ID = '1OSKJYMr4HOmDbWK04OQKHn2ojbnBLpUtKmlzSANwAks'; // NQEMT-2 Activities
const SHEET_NAME = 'Sheet1';
const EDITABLE_FIELDS = ['status', 'notes', 'actualDate'];

function doGet(e) {
  const sheet = _sheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const activities = data.slice(1)
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
  return _json({ ok: true, activities: activities });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (!e.postData || !e.postData.contents) {
      return _json({ ok: false, error: 'missing request body' });
    }
    const body = JSON.parse(e.postData.contents);
    const id = String(body.id || '');
    const field = body.field;
    const value = body.value === undefined ? '' : body.value;

    if (!id) return _json({ ok: false, error: 'missing id' });
    if (EDITABLE_FIELDS.indexOf(field) === -1) {
      return _json({ ok: false, error: 'field "' + field + '" is not editable' });
    }

    const sheet = _sheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const fieldCol = headers.indexOf(field);
    if (idCol === -1 || fieldCol === -1) {
      return _json({ ok: false, error: 'sheet is missing an expected column' });
    }

    for (let r = 1; r < data.length; r++) {
      if (String(data[r][idCol]) === id) {
        sheet.getRange(r + 1, fieldCol + 1).setValue(value);
        return _json({ ok: true, id: id, field: field, value: value });
      }
    }
    return _json({ ok: false, error: 'no activity with id ' + id });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function _sheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
