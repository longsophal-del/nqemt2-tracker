(function () {
  "use strict";

  // =========================================================================
  // Constants
  // =========================================================================
  var CATEGORY_GROUPS = ["Training & Workshops", "QIWG", "Coaching", "Meetings & Partners", "Assessment", "Other"];
  var GROUP_COLOR_VAR = {
    "Training & Workshops": "--cat-training",
    "QIWG": "--cat-qiwg",
    "Coaching": "--cat-coaching",
    "Meetings & Partners": "--cat-meetings",
    "Assessment": "--cat-assessment",
    "Other": "--cat-other"
  };
  // The Status field is the single source of truth for an activity's
  // status/delay display — see computeDelayInfo below. It is only ever
  // changed by a user editing the Add/Edit form; nothing here derives or
  // recomputes it from dates.
  var STATUS_LIST = ["Planned", "In Progress", "Completed", "Stuck", "Cancelled"];
  var PRIORITY_LIST = ["High", "Medium", "Low"];
  var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAY_MS = 86400000;
  // One entry per STATUS_LIST value (STATUS_TO_CODE below maps a raw Status
  // string to its key here) — display label + color swatch only.
  var DELAY_INFO = {
    planned: { label: "Planned", swatch: "--st-planned" },
    inprogress: { label: "In Progress", swatch: "--st-progress" },
    stuck: { label: "Stuck", swatch: "--st-stuck" },
    completed: { label: "Completed", swatch: "--st-completed" },
    cancelled: { label: "Cancelled", swatch: "--st-cancelled" }
  };
  var STATUS_TO_CODE = {
    "Planned": "planned",
    "In Progress": "inprogress",
    "Completed": "completed",
    "Stuck": "stuck",
    "Cancelled": "cancelled"
  };
  var ROUTE_TITLES = {
    activities: "Activities",
    categories: "Category",
    schedule: "Activity Timeline",
    add: "Add activity",
    reports: "Reports",
    settings: "Settings"
  };

  // =========================================================================
  // Small helpers
  // =========================================================================
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function groupColor(group) { return cssVar(GROUP_COLOR_VAR[group] || "--cat-other"); }
  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
  function statusClass(status) { return "st-" + String(status || "").replace(/\s+/g, ""); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function csvEscape(s) {
    s = String(s == null ? "" : s);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  // Keeps only the leading YYYY-MM-DD out of whatever a cell came back as
  // (Google Sheets can hand back a date cell as a full ISO timestamp).
  function dateOnly(s) {
    if (!s) return "";
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s));
    return m ? m[1] : "";
  }
  function parseDateLocal(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function diffDays(a, b) { return Math.round((a.getTime() - b.getTime()) / DAY_MS); }
  function prettyDate(s) {
    var d = parseDateLocal(s);
    if (!d) return "—";
    return MONTH_ABBR[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }
  function fmtRange(startS, endS) {
    if (!startS && !endS) return "—";
    return prettyDate(startS) + " – " + prettyDate(endS);
  }
  function todayLocal() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  // Formats a Date as a local YYYY-MM-DD string — NOT Date#toISOString(),
  // which converts to UTC first and can shift the date by a day depending
  // on the browser's timezone offset.
  function toISODateLocal(d) {
    if (!d) return "";
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function uniqueSorted(list, fn) {
    var seen = {}, out = [];
    list.forEach(function (d) {
      var v = fn(d);
      if (v == null || v === "" || seen[v]) return;
      seen[v] = true; out.push(v);
    });
    out.sort();
    return out;
  }
  // Best-effort category -> category-group guess for activities added or
  // edited through the form (existing seeded rows already carry their group).
  function categorizeToGroup(cat) {
    var c = String(cat || "").toLowerCase();
    if (/qiwg/.test(c)) return "QIWG";
    if (/coach/.test(c)) return "Coaching";
    if (/meet|partner|moh|board|ngo/.test(c)) return "Meetings & Partners";
    if (/assess|valid/.test(c)) return "Assessment";
    if (/train|workshop|consultat|coaching/.test(c)) return "Training & Workshops";
    return "Other";
  }
  function normalizeDoc(raw) {
    var d = Object.assign({}, raw);
    d.id = String(d.id != null ? d.id : "");
    d.year = Number(d.year) || 0;
    d.month = Number(d.month) || 0;
    d.startDay = Number(d.startDay) || 1;
    d.endDay = Number(d.endDay) || d.startDay;
    d.startDate = dateOnly(d.startDate);
    d.endDate = dateOnly(d.endDate);
    d.actualStart = dateOnly(d.actualStart);
    d.actualEnd = dateOnly(d.actualEnd);
    d.activity = d.activity || "";
    d.category = d.category || "";
    d.categoryGroup = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : categorizeToGroup(d.category);
    // "Upcoming" was renamed to "Planned", and the "Delayed" status option
    // was removed (the Activity Timeline's auto-calculated red/brown bar
    // segment covers that now — see Section 5 of the technical manual).
    // Any row still carrying one of those old values (e.g. untouched rows
    // in the live Google Sheet from before this change) is transparently
    // migrated to "Planned" here, so it displays correctly immediately and
    // gets written back as "Planned" the next time that activity is saved.
    if (d.status === "Upcoming" || d.status === "Delayed") d.status = "Planned";
    d.status = d.status || "Planned";
    d.priority = PRIORITY_LIST.indexOf(d.priority) >= 0 ? d.priority : "Medium";
    d.notes = d.notes || "";
    d.description = d.description || "";
    d.responsiblePerson = d.responsiblePerson || "";
    d.supportingTeam = d.supportingTeam || "";
    d.delayOverrideDays = (d.delayOverrideDays === 0 || d.delayOverrideDays) ? d.delayOverrideDays : "";
    d.delayEndDate = dateOnly(d.delayEndDate);
    return d;
  }
  function normalizeCategory(raw) {
    return {
      id: String(raw.id != null ? raw.id : ""),
      name: raw.name || "",
      group: CATEGORY_GROUPS.indexOf(raw.group) >= 0 ? raw.group : "Other"
    };
  }
  // One named phase (Tender, Design, Construction, Reporting, …) belonging
  // to one activity — see "Main Activity + Sub-activities" in
  // renderScheduleTimeline. activityId links it back to that activity's own
  // id (from Sheet1 / SAMPLE_ACTIVITIES), never the sub-activity's own id.
  // Each phase now carries the same Planned/Actual/Status/Delay fields as a
  // Main Activity (startDate/endDate = Planned Start/End; actualStart/
  // actualEnd; status; delayEndDate), so its own bar and delay/stuck
  // calculation work exactly like a Main Activity's — see
  // buildActivityBarSegments below, which both a Main Activity row and a
  // phase row call with their own fields.
  function normalizeSubActivity(raw) {
    return {
      id: String(raw.id != null ? raw.id : ""),
      activityId: String(raw.activityId != null ? raw.activityId : ""),
      name: raw.name || "",
      startDate: dateOnly(raw.startDate),
      endDate: dateOnly(raw.endDate),
      actualStart: dateOnly(raw.actualStart),
      actualEnd: dateOnly(raw.actualEnd),
      status: STATUS_LIST.indexOf(raw.status) >= 0 ? raw.status : "Planned",
      delayEndDate: dateOnly(raw.delayEndDate),
      order: Number(raw.order) || 0
    };
  }

  // =========================================================================
  // Status display (manual-only — no date-based computation)
  // =========================================================================
  // Returns {code, label, delayDays}. This is driven ENTIRELY by the
  // activity's manually-set Status field (STATUS_TO_CODE above) — it never
  // looks at today's date or the planned/actual date fields, so the
  // Completed/Planned/In Progress/Stuck/Cancelled label shown
  // in the Activities table, the Activity Timeline, and the Status Summary
  // only ever changes when a user edits an activity's Status via the
  // Add/Edit form. `delayDays` is always 0 — kept only so existing call
  // sites that read it (and old exported CSVs) keep working.
  function computeDelayInfo(d) {
    var code = STATUS_TO_CODE[d.status] || "planned";
    return { code: code, label: DELAY_INFO[code].label, delayDays: 0 };
  }

  // =========================================================================
  // Login (see loginScreen in index.html and _isAuthorized in Code.gs)
  // =========================================================================
  // Session-only (sessionStorage, not localStorage) — closing every tab for
  // this site requires logging in again. The username/password are kept
  // alongside the flag (not just a "logged in" boolean) so every live API
  // call below can carry them, since Code.gs's own _isAuthorized check
  // needs to see them on every request, not just once at login.
  var AUTH_KEY = "nqemt2_auth";
  function isAuthed() {
    try { return sessionStorage.getItem(AUTH_KEY) === "1"; } catch (e) { return false; }
  }
  function setAuthed(u, p) {
    try {
      sessionStorage.setItem(AUTH_KEY, "1");
      sessionStorage.setItem(AUTH_KEY + "_u", u);
      sessionStorage.setItem(AUTH_KEY + "_p", p);
    } catch (e) { /* ignore — falls back to asking again next load */ }
  }
  function clearAuthed() {
    try {
      sessionStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(AUTH_KEY + "_u");
      sessionStorage.removeItem(AUTH_KEY + "_p");
    } catch (e) { /* ignore */ }
  }
  function authedUser() {
    try { return sessionStorage.getItem(AUTH_KEY + "_u") || ""; } catch (e) { return ""; }
  }
  function checkCredentials(u, p) {
    return typeof APP_USERS !== "undefined" && Array.isArray(APP_USERS) &&
      APP_USERS.some(function (acc) { return acc.username === u && acc.password === p; });
  }
  // Appends the logged-in username/password to a live API URL as query
  // params, so Code.gs's _isAuthorized can check them on every request —
  // not just the front end deciding locally whether to show the app.
  function withAuth(url) {
    var u = "", p = "";
    try { u = sessionStorage.getItem(AUTH_KEY + "_u") || ""; p = sessionStorage.getItem(AUTH_KEY + "_p") || ""; } catch (e) { /* ignore */ }
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "u=" + encodeURIComponent(u) + "&p=" + encodeURIComponent(p);
  }
  // Called whenever a live request comes back "unauthorized" — e.g. the
  // password was changed on the backend after this browser already had a
  // session. Drops the stored session and brings the login screen back
  // (rather than silently falling through to the bundled demo sample, which
  // would look like data loss instead of what it actually is: a login
  // that's no longer valid).
  function forceReLogin() {
    clearAuthed();
    var scr = document.getElementById("loginScreen");
    if (!scr) return;
    scr.classList.remove("hide");
    var msg = document.getElementById("loginMsg");
    if (msg) { msg.hidden = false; msg.className = "form-msg err"; msg.textContent = "Your session is no longer valid — please log in again."; }
    var passField = document.getElementById("loginPass");
    if (passField) passField.value = "";
  }

  // =========================================================================
  // Network / persistence
  // =========================================================================
  var usingLiveApi = typeof API_URL === "string" && API_URL.indexOf("http") === 0;

  function apiPost(payload) {
    return fetch(withAuth(API_URL), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.unauthorized) { forceReLogin(); throw new Error("session expired — please log in again"); }
      if (!res || !res.ok) throw new Error((res && res.error) || "request failed");
      return res;
    });
  }

  function nextLocalId() {
    var max = 0;
    state.docs.forEach(function (d) { var n = parseInt(d.id, 10); if (!isNaN(n) && n > max) max = n; });
    return String(max + 1);
  }

  function createActivity(fields) {
    if (!usingLiveApi) {
      var doc = normalizeDoc(Object.assign({ id: nextLocalId() }, fields));
      return Promise.resolve(doc);
    }
    return apiPost({ action: "create", fields: fields }).then(function (res) { return normalizeDoc(res.activity); });
  }

  function updateActivity(id, fields) {
    if (!usingLiveApi) {
      var doc = state.docs.find(function (d) { return d.id === id; });
      if (doc) Object.assign(doc, fields);
      return Promise.resolve(normalizeDoc(Object.assign({ id: id }, doc, fields)));
    }
    return apiPost({ action: "update", id: id, fields: fields }).then(function (res) { return normalizeDoc(res.activity); });
  }

  function deleteActivityRemote(id) {
    if (!usingLiveApi) return Promise.resolve({ ok: true });
    return apiPost({ action: "delete", id: id });
  }

  function nextLocalCategoryId() {
    var max = 0;
    state.categories.forEach(function (c) { var n = parseInt(c.id, 10); if (!isNaN(n) && n > max) max = n; });
    return String(max + 1);
  }
  function createCategory(fields) {
    if (!usingLiveApi) {
      var cat = normalizeCategory(Object.assign({ id: nextLocalCategoryId() }, fields));
      return Promise.resolve(cat);
    }
    return apiPost({ action: "create", sheet: "categories", fields: fields }).then(function (res) { return normalizeCategory(res.category); });
  }
  function updateCategory(id, fields) {
    if (!usingLiveApi) {
      var cat = state.categories.find(function (c) { return c.id === id; });
      if (cat) Object.assign(cat, fields);
      return Promise.resolve(normalizeCategory(Object.assign({ id: id }, cat, fields)));
    }
    return apiPost({ action: "update", sheet: "categories", id: id, fields: fields }).then(function (res) { return normalizeCategory(res.category); });
  }
  function deleteCategoryRemote(id) {
    if (!usingLiveApi) return Promise.resolve({ ok: true });
    return apiPost({ action: "delete", sheet: "categories", id: id });
  }

  // ---- Sub-activities (phases) --------------------------------------------
  // No in-place update: the Add/Edit form just replaces an activity's whole
  // phase list on every save (see replaceSubActivitiesFor below) rather than
  // diffing row-by-row, since the list is short and edited as a set.
  function nextLocalSubActivityId() {
    var max = 0;
    state.subActivities.forEach(function (sa) { var n = parseInt(sa.id, 10); if (!isNaN(n) && n > max) max = n; });
    return String(max + 1);
  }
  function createSubActivity(fields) {
    if (!usingLiveApi) {
      var sa = normalizeSubActivity(Object.assign({ id: nextLocalSubActivityId() }, fields));
      return Promise.resolve(sa);
    }
    return apiPost({ action: "create", sheet: "subactivities", fields: fields }).then(function (res) { return normalizeSubActivity(res.subActivity); });
  }
  function deleteSubActivityRemote(id) {
    if (!usingLiveApi) return Promise.resolve({ ok: true });
    return apiPost({ action: "delete", sheet: "subactivities", id: id });
  }
  // Replaces every sub-activity currently on file for `activityId` with
  // `phases` ([{name,startDate,endDate}, …], in display order) — deletes the
  // old rows then creates the new ones, one request at a time so a slow
  // connection can't race the Sheet's lock (same pattern as
  // renameCategoryOnActivities). Used on every Add/Edit Activity save,
  // whether or not the phase list actually changed, to keep this simple.
  function replaceSubActivitiesFor(activityId, phases) {
    var existing = state.subActivities.filter(function (sa) { return sa.activityId === activityId; });
    var chain = existing.reduce(function (p, sa) {
      return p.then(function () { return deleteSubActivityRemote(sa.id); });
    }, Promise.resolve());
    return chain.then(function () {
      state.subActivities = state.subActivities.filter(function (sa) { return sa.activityId !== activityId; });
      return phases.reduce(function (p, ph, idx) {
        return p.then(function (acc) {
          return createSubActivity({
            activityId: activityId, name: ph.name, startDate: ph.startDate, endDate: ph.endDate,
            actualStart: ph.actualStart || "", actualEnd: ph.actualEnd || "",
            status: ph.status || "Planned", delayEndDate: ph.delayEndDate || "",
            order: idx + 1
          }).then(function (created) { acc.push(created); return acc; });
        });
      }, Promise.resolve([]));
    }).then(function (created) {
      state.subActivities = state.subActivities.concat(created);
      return created;
    });
  }
  // Cascades a category rename onto every activity currently using the old
  // name, one at a time (so a slow connection can't race the Sheet's lock).
  function renameCategoryOnActivities(oldName, newName, newGroup) {
    var affected = state.docs.filter(function (d) { return d.category === oldName; });
    return affected.reduce(function (chain, d) {
      return chain.then(function () {
        return updateActivity(d.id, { category: newName, categoryGroup: newGroup }).then(function (updated) {
          Object.assign(d, updated);
        });
      });
    }, Promise.resolve());
  }

  function saveField(id, field, value, el) {
    var doc = state.docs.find(function (d) { return d.id === id; });
    if (doc) doc[field] = value;
    renderAll();
    if (!usingLiveApi) { flashSaved(el, false, "demo mode — not saved"); return; }
    apiPost({ id: id, field: field, value: value })
      .then(function () { flashSaved(el, true, "saved"); })
      .catch(function (err) { flashSaved(el, false, err.message || "not saved"); });
  }
  function flashSaved(el, ok, label) {
    if (!el) return;
    var flag = el.parentElement && el.parentElement.querySelector(".save-flag");
    if (!flag) return;
    flag.textContent = label || (ok ? "saved" : "not saved");
    flag.style.color = ok ? "" : cssVar("--st-delayed");
    flag.classList.add("show");
    setTimeout(function () { flag.classList.remove("show"); }, 1600);
  }

  // =========================================================================
  // State
  // =========================================================================
  var state = {
    docs: [],
    categories: [],
    subActivities: [],
    route: "schedule",
    // sch.year is no longer a filter — the Activity Timeline now spans a
    // continuous range across all activity/sub-activity dates. It's kept
    // here only as the last value picked in the "Jump to year" control
    // (see wireScheduleFilters/scrollScheduleToYear).
    sch: { year: null, month: "", category: "", responsible: "", status: "", _layout: null },
    act: { search: "", year: "", category: "", responsible: "", status: "", sortKey: "start", sortDir: "asc", page: 1, pageSize: 25 },
    editingId: null,
    duplicating: false
  };

  var els = {};
  function cacheEls() {
    [
      "loadingOverlay",
      "sidebar", "sidebarBackdrop", "hamburgerBtn", "mainNav", "routeTitle", "exportBtn", "syncBanner", "sidebarSync",
      "searchInput", "filterYear", "filterCategory", "filterResponsible", "filterStatus", "rowCount", "tableBody", "pagination",
      "categoriesTableBody", "categoryCount", "addCategoryBtn",
      "schYear", "schMonth", "schCategory", "schResponsible", "schStatus", "schReset",
      "scheduleHint", "scheduleStatusSummary", "scheduleOuter", "scheduleLegend",
      "addFormTitle", "addFormHint", "activityForm", "idField", "fId", "fName", "fDescription", "fCategory",
      "fResponsible", "responsibleList", "fSupporting", "supportingList", "fPriority", "fStatus",
      "fPlannedStart", "fPlannedEnd", "fActualStart", "fActualEnd", "fDelayOverride", "fDelayEndDate", "fRemarks",
      "subActivityRows", "addSubActivityBtn",
      "formMsg", "formSubmitBtn", "formCancelBtn",
      "themeToggle", "settingsDataSource", "openSheetBtn", "settingsCount", "settingsAccount", "logoutBtn",
      "modalBackdrop", "modalBody"
    ].forEach(function (id) { els[id] = document.getElementById(id); });
  }

  // =========================================================================
  // Router
  // =========================================================================
  // Remembers which sidebar menu item was last open, so refreshing the page
  // (or coming back later) reopens the same view instead of always landing
  // back on the Activity Timeline. Best-effort only — if the browser blocks
  // storage (private window, blocked site data), the app just falls back to
  // the Activity Timeline on load, same as before.
  var LAST_ROUTE_KEY = "nqemt2_last_route";
  function saveLastRoute(route) {
    try { window.localStorage.setItem(LAST_ROUTE_KEY, route); } catch (e) { /* ignore */ }
  }
  function loadLastRoute() {
    try {
      var r = window.localStorage.getItem(LAST_ROUTE_KEY);
      return (r && ROUTE_TITLES.hasOwnProperty(r)) ? r : null;
    } catch (e) { return null; }
  }

  // Remembers whether the sidebar is collapsed (desktop/tablet widths only —
  // on narrow screens the same button just opens/closes the overlay menu,
  // which never needs to persist). Also best-effort via localStorage.
  var SIDEBAR_COLLAPSED_KEY = "nqemt2_sidebar_collapsed";
  function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    els.hamburgerBtn.setAttribute("aria-label", collapsed ? "Show menu" : "Hide menu");
    els.hamburgerBtn.title = collapsed ? "Show menu" : "Hide menu";
    try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  function loadSidebarCollapsed() {
    try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch (e) { return false; }
  }
  function setRoute(route) {
    state.route = route;
    saveLastRoute(route);
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = (v.id !== "view-" + route); });
    document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-route") === route); });
    els.routeTitle.textContent = ROUTE_TITLES[route] || route;
    els.exportBtn.hidden = route !== "activities";
    els.sidebar.classList.remove("open");
    els.sidebarBackdrop.classList.remove("show");
    if (route === "activities") renderActivitiesTable();
    else if (route === "categories") renderCategoriesTable();
    else if (route === "schedule") { populateScheduleFilterOptions(); renderScheduleTimeline(); }
    else if (route === "add") { if (!state.editingId && !state.duplicating) resetForm(); populateFormDatalists(); }
    else if (route === "settings") renderSettings();
  }

  function wireNav() {
    els.mainNav.querySelectorAll(".nav-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var route = btn.getAttribute("data-route");
        if (route === "add") { state.editingId = null; state.duplicating = false; }
        setRoute(route);
      });
    });
    // One button, two jobs depending on screen width: on narrow screens (the
    // existing behavior) it slides the sidebar in/out as an overlay; on
    // wider screens it collapses the sidebar to width 0 in place instead, so
    // wide views like the Activity Timeline get the full window width. Only
    // one of the two CSS effects is ever active at a given width, so toggling
    // both classes together is safe.
    els.hamburgerBtn.addEventListener("click", function () {
      els.sidebar.classList.toggle("open");
      els.sidebarBackdrop.classList.toggle("show");
      setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });
    els.sidebarBackdrop.addEventListener("click", function () {
      els.sidebar.classList.remove("open");
      els.sidebarBackdrop.classList.remove("show");
    });
  }

  // =========================================================================
  // Shared: status summary + timeline legend (used by the Activity Timeline)
  // A pure tally of the manually-set Status field — no delay calculation of
  // any kind, just how many activities currently sit in each status.
  // =========================================================================
  function renderStatusSummary(list, targetEl, yearLabel) {
    if (!targetEl) return;
    var infos = list.map(function (d) { return computeDelayInfo(d); });
    var total = list.length;
    var completed = infos.filter(function (i) { return i.code === "completed"; }).length;
    var planned = infos.filter(function (i) { return i.code === "planned"; }).length;
    var inProgress = infos.filter(function (i) { return i.code === "inprogress"; }).length;
    var stuck = infos.filter(function (i) { return i.code === "stuck"; }).length;
    var cancelled = infos.filter(function (i) { return i.code === "cancelled"; }).length;
    var cards = [
      ["Total activities", total, ""],
      ["Completed", completed, "completed"],
      ["Planned", planned, "planned"],
      ["In progress", inProgress, "inprogress"],
      ["Stuck", stuck, "stuck"],
      ["Cancelled", cancelled, "cancelled"]
    ];
    targetEl.innerHTML = '<div class="ds-title">Status summary' + (yearLabel ? " — " + escapeHtml(String(yearLabel)) : "") + '</div><div class="ds-grid">' +
      cards.map(function (c) {
        return '<div class="ds-card' + (c[2] ? " ds-" + c[2] : "") + '"><div class="ds-n">' + c[1] + '</div><div class="ds-l">' + c[0] + '</div></div>';
      }).join("") + '</div>';
  }

  function renderTimelineLegend(targetEl) {
    if (!targetEl) return;
    // Each activity's bar is now one continuous strip made of up to four
    // colored segments (left-to-right, chronological) instead of the
    // earlier separate Planned/Actual/Delay-override bars: Planned (blue),
    // In Progress actual-so-far (green), auto-calculated Delay (red, once
    // Planned End has passed and the activity isn't Completed/Cancelled),
    // and Stuck (brown, frozen once Status is set to Stuck). The Status
    // chip colors below are separate — they mirror the manually-set
    // Status field, same as everywhere else in the app.
    var items = [
      ["Bar — Planned", "--st-planned"],
      ["Bar — In progress (actual so far)", "--sch-progress"],
      ["Bar — Delay (auto, past due)", "--st-delayed"],
      ["Bar — Stuck", "--st-stuck"],
      ["Status — Planned", "--st-planned"],
      ["Status — In Progress", "--st-progress"],
      ["Status — Stuck", "--st-stuck"],
      ["Status — Completed ✓", "--st-completed"],
      ["Status — Cancelled 🚫", "--st-cancelled"]
    ];
    targetEl.innerHTML = items.map(function (it) {
      return '<span class="sw"><span class="dot" style="background:' + cssVar(it[1]) + '"></span>' + it[0] + '</span>';
    }).join("") + '<span class="sw" style="color:var(--muted); font-style:italic;">An activity with named phases (Tender, Design, …) lists each phase as its own indented row below it, with its own Planned/Actual/Delay/Stuck bar — using the same colors as above.</span>';
  }

  // =========================================================================
  // Activities table
  // =========================================================================
  function populateActivitiesFilterOptions() {
    var years = uniqueSorted(state.docs, function (d) { return d.year; });
    var cats = uniqueSorted(state.docs, function (d) { return d.category; });
    var people = uniqueSorted(state.docs, function (d) { return d.responsiblePerson; });
    var curY = els.filterYear.value, curC = els.filterCategory.value, curP = els.filterResponsible.value, curS = els.filterStatus.value;
    els.filterYear.innerHTML = '<option value="">All years</option>' + years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join("");
    els.filterCategory.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join("");
    els.filterResponsible.innerHTML = '<option value="">All responsible people</option>' + people.map(function (p) { return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>'; }).join("");
    if (!els.filterStatus.options.length || els.filterStatus.options.length === 1) {
      els.filterStatus.innerHTML = '<option value="">All statuses</option>' + STATUS_LIST.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join("");
    }
    els.filterYear.value = curY; els.filterCategory.value = curC; els.filterResponsible.value = curP; els.filterStatus.value = curS;
  }

  function getFilteredSortedActivities() {
    var f = state.act;
    var list = state.docs.filter(function (d) {
      if (f.year && String(d.year) !== f.year) return false;
      if (f.category && d.category !== f.category) return false;
      if (f.responsible && d.responsiblePerson !== f.responsible) return false;
      if (f.status && d.status !== f.status) return false;
      if (f.search) {
        var hay = ((d.activity || "") + " " + (d.notes || "") + " " + (d.responsiblePerson || "") + " " + (d.description || "")).toLowerCase();
        if (hay.indexOf(f.search.toLowerCase()) === -1) return false;
      }
      return true;
    });
    var key = f.sortKey, dir = f.sortDir === "asc" ? 1 : -1;
    list.sort(function (a, b) {
      var av, bv;
      if (key === "id") { av = parseInt(a.id, 10) || 0; bv = parseInt(b.id, 10) || 0; }
      else if (key === "start") { av = a.startDate; bv = b.startDate; }
      else if (key === "activity") { av = a.activity || ""; bv = b.activity || ""; }
      else if (key === "category") { av = a.category || ""; bv = b.category || ""; }
      else if (key === "responsible") { av = a.responsiblePerson || ""; bv = b.responsiblePerson || ""; }
      else if (key === "status") { av = a.status || ""; bv = b.status || ""; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return list;
  }

  function renderActivitiesTable() {
    populateActivitiesFilterOptions();
    var full = getFilteredSortedActivities();
    var pageSize = state.act.pageSize;
    var totalPages = Math.max(1, Math.ceil(full.length / pageSize));
    if (state.act.page > totalPages) state.act.page = totalPages;
    if (state.act.page < 1) state.act.page = 1;
    var startIdx = (state.act.page - 1) * pageSize;
    var pageItems = full.slice(startIdx, startIdx + pageSize);

    els.rowCount.textContent = full.length + " of " + state.docs.length + " activities";
    els.tableBody.innerHTML = pageItems.map(function (d) {
      var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
      var info = computeDelayInfo(d);
      var delayText = info.label;
      return '<tr id="row-' + d.id + '">' +
        '<td class="date-cell">' + escapeHtml(d.id) + '</td>' +
        '<td class="activity-name">' + escapeHtml(d.activity) + '</td>' +
        '<td><span class="cat-chip"><span class="dot" style="background:' + groupColor(g) + '"></span>' + escapeHtml(d.category) + '</span></td>' +
        '<td>' + escapeHtml(d.responsiblePerson || "—") + '</td>' +
        '<td class="date-cell">' + escapeHtml(fmtRange(d.startDate, d.endDate)) + '</td>' +
        '<td class="date-cell">' + escapeHtml(d.actualStart || d.actualEnd ? fmtRange(d.actualStart, d.actualEnd) : "—") + '</td>' +
        '<td><span class="cat-chip">' + escapeHtml(d.status) + '</span></td>' +
        '<td><span class="delay-chip dc-' + info.code + '">' + escapeHtml(delayText) + '</span></td>' +
        '<td><div class="row-actions">' +
          '<button class="icon-btn" data-action="view" data-id="' + d.id + '" title="View">👁</button>' +
          '<button class="icon-btn" data-action="edit" data-id="' + d.id + '" title="Edit">✏️</button>' +
          '<button class="icon-btn" data-action="duplicate" data-id="' + d.id + '" title="Duplicate">📄</button>' +
          '<button class="icon-btn danger" data-action="delete" data-id="' + d.id + '" title="Delete">🗑</button>' +
        '</div></td>' +
        '</tr>';
    }).join("") || '<tr><td colspan="9" style="text-align:center; color:var(--muted); padding:24px;">No activities match the current filters.</td></tr>';

    renderPagination(full.length, totalPages);
  }

  function renderPagination(totalItems, totalPages) {
    var from = totalItems ? (state.act.page - 1) * state.act.pageSize + 1 : 0;
    var to = Math.min(totalItems, state.act.page * state.act.pageSize);
    els.pagination.innerHTML =
      '<span>Rows per page</span>' +
      '<select id="pageSizeSel"><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select>' +
      '<span>' + from + '–' + to + ' of ' + totalItems + '</span>' +
      '<button class="btn" id="pagePrev" ' + (state.act.page <= 1 ? "disabled" : "") + '>‹ Prev</button>' +
      '<span>Page ' + state.act.page + ' of ' + totalPages + '</span>' +
      '<button class="btn" id="pageNext" ' + (state.act.page >= totalPages ? "disabled" : "") + '>Next ›</button>';
    document.getElementById("pageSizeSel").value = String(state.act.pageSize);
    document.getElementById("pageSizeSel").addEventListener("change", function (e) {
      state.act.pageSize = Number(e.target.value); state.act.page = 1; renderActivitiesTable();
    });
    document.getElementById("pagePrev").addEventListener("click", function () { state.act.page--; renderActivitiesTable(); });
    document.getElementById("pageNext").addEventListener("click", function () { state.act.page++; renderActivitiesTable(); });
  }

  function wireActivitiesControls() {
    document.querySelectorAll("#view-activities thead th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (state.act.sortKey === key) state.act.sortDir = state.act.sortDir === "asc" ? "desc" : "asc";
        else { state.act.sortKey = key; state.act.sortDir = "asc"; }
        renderActivitiesTable();
      });
    });
    els.searchInput.addEventListener("input", function () { state.act.search = els.searchInput.value; state.act.page = 1; renderActivitiesTable(); });
    els.filterYear.addEventListener("change", function () { state.act.year = els.filterYear.value; state.act.page = 1; renderActivitiesTable(); });
    els.filterCategory.addEventListener("change", function () { state.act.category = els.filterCategory.value; state.act.page = 1; renderActivitiesTable(); });
    els.filterResponsible.addEventListener("change", function () { state.act.responsible = els.filterResponsible.value; state.act.page = 1; renderActivitiesTable(); });
    els.filterStatus.addEventListener("change", function () { state.act.status = els.filterStatus.value; state.act.page = 1; renderActivitiesTable(); });

    els.tableBody.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("button[data-action]") : null;
      if (!btn) return;
      var id = btn.getAttribute("data-id"), action = btn.getAttribute("data-action");
      if (action === "view") viewActivityRow(id);
      else if (action === "edit") editActivityRow(id);
      else if (action === "duplicate") duplicateActivityRow(id);
      else if (action === "delete") deleteActivityRow(id);
    });

    els.exportBtn.addEventListener("click", function () {
      var list = getFilteredSortedActivities();
      var header = ["Activity ID", "Activity", "Category", "Responsible Person", "Supporting Team", "Priority", "Planned Start", "Planned End", "Actual Start", "Actual End", "Status", "Remarks"];
      var rows = list.map(function (d) {
        return [d.id, d.activity, d.category, d.responsiblePerson || "", d.supportingTeam || "", d.priority, d.startDate, d.endDate, d.actualStart || "", d.actualEnd || "", d.status, d.notes || ""].map(csvEscape).join(",");
      });
      var csv = header.join(",") + "\n" + rows.join("\n");
      var blob = new Blob([csv], { type: "text/csv" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "nqemt2_activities.csv";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    });
  }

  // =========================================================================
  // Categories (add / edit / delete the category list activities use)
  // =========================================================================
  function renderCategoriesTable() {
    var cats = state.categories.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    els.categoryCount.textContent = cats.length + " categor" + (cats.length === 1 ? "y" : "ies");
    els.categoriesTableBody.innerHTML = cats.map(function (c) {
      var count = state.docs.filter(function (d) { return d.category === c.name; }).length;
      return '<tr>' +
        '<td class="activity-name">' + escapeHtml(c.name) + '</td>' +
        '<td><span class="cat-chip"><span class="dot" style="background:' + groupColor(c.group) + '"></span>' + escapeHtml(c.group) + '</span></td>' +
        '<td>' + count + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="icon-btn" data-action="edit-cat" data-id="' + c.id + '" title="Edit">✏️</button>' +
          '<button class="icon-btn danger" data-action="delete-cat" data-id="' + c.id + '" title="Delete">🗑</button>' +
        '</div></td>' +
        '</tr>';
    }).join("") || '<tr><td colspan="4" style="text-align:center; color:var(--muted); padding:24px;">No categories yet — add one to get started.</td></tr>';
  }

  function categoryModalForm(c) {
    c = c || { id: "", name: "", group: "Other" };
    var groupOptions = CATEGORY_GROUPS.map(function (g) {
      return '<option value="' + escapeHtml(g) + '"' + (g === c.group ? " selected" : "") + '>' + escapeHtml(g) + '</option>';
    }).join("");
    return '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<h3>' + (c.id ? "Edit category" : "Add category") + '</h3>' +
      '<form id="categoryForm">' +
        '<div class="form-grid">' +
          '<div class="field field-wide"><label for="catName">Category name *</label><input type="text" id="catName" required value="' + escapeHtml(c.name) + '" placeholder="e.g. Coaching"></div>' +
          '<div class="field field-wide"><label for="catGroup">Group (used for chart colors) *</label><select id="catGroup" required>' + groupOptions + '</select></div>' +
        '</div>' +
        '<div id="catFormMsg" class="form-msg" hidden></div>' +
        '<div class="form-actions"><button type="submit" class="btn btn-primary">' + (c.id ? "Save changes" : "Add category") + '</button><button type="button" class="btn" id="catCancelBtn">Cancel</button></div>' +
      '</form>';
  }

  function openCategoryModal(existing) {
    openModal(categoryModalForm(existing));
    var closeBtn = document.getElementById("modalCloseBtn"), cancelBtn = document.getElementById("catCancelBtn");
    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);
    document.getElementById("categoryForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = document.getElementById("catName").value.trim();
      var group = document.getElementById("catGroup").value;
      var msgEl = document.getElementById("catFormMsg");
      function showMsg(text, kind) { msgEl.hidden = false; msgEl.className = "form-msg " + (kind || ""); msgEl.textContent = text; }
      if (!name) { showMsg("Category name is required.", "err"); return; }
      var dup = state.categories.find(function (c) { return c.name.toLowerCase() === name.toLowerCase() && (!existing || c.id !== existing.id); });
      if (dup) { showMsg("A category named \"" + name + "\" already exists.", "err"); return; }

      var submitBtn = ev.target.querySelector("button[type=submit]");
      submitBtn.disabled = true;

      if (existing && existing.id) {
        var oldName = existing.name;
        updateCategory(existing.id, { name: name, group: group }).then(function (updated) {
          var idx = state.categories.findIndex(function (c) { return c.id === existing.id; });
          if (idx >= 0) state.categories[idx] = updated;
          if (oldName !== name) return renameCategoryOnActivities(oldName, name, group);
        }).then(function () {
          closeModal();
          renderAll();
        }).catch(function (err) { showMsg("Couldn't save: " + err.message, "err"); submitBtn.disabled = false; });
      } else {
        createCategory({ name: name, group: group }).then(function (created) {
          state.categories.push(created);
          closeModal();
          renderAll();
        }).catch(function (err) { showMsg("Couldn't save: " + err.message, "err"); submitBtn.disabled = false; });
      }
    });
  }

  function deleteCategoryRow(id) {
    var c = state.categories.find(function (x) { return x.id === id; });
    if (!c) return;
    var inUse = state.docs.filter(function (d) { return d.category === c.name; }).length;
    if (inUse > 0) {
      window.alert("\"" + c.name + "\" is still used by " + inUse + " activit" + (inUse === 1 ? "y" : "ies") + ". Reassign " + (inUse === 1 ? "it" : "them") + " to a different category on the Activities page first, then delete this category.");
      return;
    }
    if (!window.confirm("Delete the category \"" + c.name + "\"? This cannot be undone.")) return;
    deleteCategoryRemote(id).then(function () {
      state.categories = state.categories.filter(function (x) { return x.id !== id; });
      renderAll();
    }).catch(function (err) { window.alert("Delete failed: " + err.message); });
  }

  function wireCategoriesControls() {
    els.addCategoryBtn.addEventListener("click", function () { openCategoryModal(null); });
    els.categoriesTableBody.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("button[data-action]") : null;
      if (!btn) return;
      var id = btn.getAttribute("data-id"), action = btn.getAttribute("data-action");
      if (action === "edit-cat") {
        var c = state.categories.find(function (x) { return x.id === id; });
        if (c) openCategoryModal(c);
      } else if (action === "delete-cat") {
        deleteCategoryRow(id);
      }
    });
  }

  // =========================================================================
  // Activity Timeline — a continuous multi-year Gantt view (its own nav item
  // and #view-schedule section). One row per activity (no lane packing
  // needed), a two-tier header (Year row above a Month row) spanning every
  // month from the earliest to the latest date across all activities and
  // sub-activities, with the Activities column pinned via CSS sticky
  // positioning so it stays visible while scrolling both ways.
  //
  // Each activity row draws ONE of two things, never both:
  //   - If it has its own Sub-activities (named phases like Tender, Design,
  //     Construction, Reporting — added on the Add/Edit form and stored in
  //     the "SubActivities" Sheet tab), each phase gets its own full row
  //     with its own Planned/Actual/Status/Delay/Stuck bar, built and
  //     colored exactly like a Main Activity's own bar (see
  //     buildActivityBarSegments).
  //   - Otherwise, the original automatic Planned (blue) / In Progress
  //     actual-so-far (green) / Delay or Stuck (red/brown) strip, unchanged
  //     from before this feature existed — so any activity with no phases
  //     defined keeps behaving exactly as it always has.
  // =========================================================================
  // Fixed width (px) for every month column — all the same width regardless
  // of how many days that month actually has (narrower than the old
  // single-year view's 130px, since the timeline can now span many years at
  // once). A date's position WITHIN its month is still worked out from that
  // month's own real day count, so it's still exactly day-accurate — only
  // the column's on-screen width is fixed instead of proportional.
  var SCH_MONTH_PX = 70;
  // The bar color legend used by both a Main Activity's own bar and every
  // Sub-activity (phase) row's bar — see buildActivityBarSegments below.
  var SEG_COLOR_VAR = { planned: "--st-planned", progress: "--sch-progress", delay: "--st-delayed", stuck: "--st-stuck" };
  // ---------------------------------------------------------------------
  // Builds the up-to-three chronological bar segments — "progress" (green,
  // actual work so far), "planned" (blue, remaining/whole Planned span),
  // and "delay" (red, auto-calculated overdue) or "stuck" (brown, frozen)
  // — for ANY record that carries the same five fields a Main Activity
  // does: status, startDate/endDate (Planned Start/End), actualStart/
  // actualEnd, and delayEndDate. Used identically for a Main Activity (when
  // it has no phases) and for each of its Sub-activity phases (when it
  // does), so a phase gets exactly the same Planned/Actual/Delay/Stuck bar
  // behavior and coloring as a Main Activity — see the "color of bar should
  // keep as before" requirement: phases are no longer colored by name.
  // `today` is passed in (rather than read fresh here) so a single render
  // pass uses one consistent "now" for every row.
  function buildActivityBarSegments(rec, today) {
    var info = computeDelayInfo(rec);
    var pStart = parseDateLocal(rec.startDate), pEnd = parseDateLocal(rec.endDate) || pStart;
    var budgetDays = (pStart && pEnd) ? (diffDays(pEnd, pStart) + 1) : null;
    var budgetDaysLabel = budgetDays != null ? (budgetDays + (budgetDays === 1 ? " Day" : " Days")) : "—";
    var aStart = parseDateLocal(rec.actualStart), aEnd = parseDateLocal(rec.actualEnd);
    var delayEndPt = parseDateLocal(rec.delayEndDate);
    var isInProgress = rec.status === "In Progress";
    var isStuck = info.code === "stuck";
    var isTerminal = info.code === "completed" || info.code === "cancelled";
    var overdue = !!(pEnd && today.getTime() > pEnd.getTime());

    var segRanges = [];
    var greenEnd = null;
    if (isInProgress && aStart && pEnd) {
      var gEnd = aEnd || (today.getTime() < pEnd.getTime() ? today : pEnd);
      if (gEnd.getTime() < aStart.getTime()) gEnd = aStart;
      if (gEnd.getTime() > pEnd.getTime()) gEnd = pEnd;
      segRanges.push({ start: aStart, end: gEnd, cls: "progress" });
      greenEnd = gEnd;
    }
    if (pStart && pEnd) {
      var blueStart = greenEnd && greenEnd.getTime() > pStart.getTime() ? greenEnd : pStart;
      if (blueStart.getTime() < pEnd.getTime() || !greenEnd) {
        segRanges.push({ start: blueStart, end: pEnd, cls: "planned" });
      }
    }
    var overrunNote = "";
    if (pEnd) {
      if (isStuck) {
        var stuckEnd = delayEndPt || today;
        if (stuckEnd.getTime() < pEnd.getTime()) stuckEnd = pEnd;
        if (stuckEnd.getTime() > pEnd.getTime()) {
          segRanges.push({ start: pEnd, end: stuckEnd, cls: "stuck" });
        }
        overrunNote = "Stuck — frozen " + (delayEndPt ? "as of " + prettyDate(rec.delayEndDate) : "at today");
      } else if (overdue && !isTerminal) {
        segRanges.push({ start: pEnd, end: today, cls: "delay" });
        var overdueDays = diffDays(today, pEnd);
        overrunNote = "Auto delay: " + overdueDays + (overdueDays === 1 ? " day" : " days") + " past Planned End";
      }
    }
    return { info: info, pStart: pStart, pEnd: pEnd, budgetDays: budgetDays, budgetDaysLabel: budgetDaysLabel, segRanges: segRanges, overrunNote: overrunNote };
  }
  function getSubActivitiesFor(activityId) {
    return state.subActivities.filter(function (sa) { return sa.activityId === String(activityId); }).sort(function (a, b) {
      var sa = parseDateLocal(a.startDate), sb = parseDateLocal(b.startDate);
      if (sa && sb && sa.getTime() !== sb.getTime()) return sa.getTime() - sb.getTime();
      return (a.order || 0) - (b.order || 0);
    });
  }
  // Computes the continuous [minYear, maxYear] span to draw — from the
  // earliest to the latest date across every activity (planned, actual, and
  // delay-end dates) and every sub-activity, always including today's year
  // so the "current month" highlight is never drawn off the edge of the
  // grid. Recomputed on every render so adding/editing an activity or a
  // phase immediately grows (or shrinks) the visible range.
  function buildScheduleLayout() {
    var minYear = null, maxYear = null;
    function consider(dateStr) {
      var d = parseDateLocal(dateStr);
      if (!d) return;
      var y = d.getFullYear();
      if (minYear === null || y < minYear) minYear = y;
      if (maxYear === null || y > maxYear) maxYear = y;
    }
    state.docs.forEach(function (d) {
      consider(d.startDate); consider(d.endDate);
      consider(d.actualStart); consider(d.actualEnd); consider(d.delayEndDate);
    });
    state.subActivities.forEach(function (sa) { consider(sa.startDate); consider(sa.endDate); consider(sa.actualStart); consider(sa.actualEnd); consider(sa.delayEndDate); });
    var todayYear = todayLocal().getFullYear();
    if (minYear === null) { minYear = todayYear; maxYear = todayYear; }
    if (todayYear < minYear) minYear = todayYear;
    if (todayYear > maxYear) maxYear = todayYear;
    return { minYear: minYear, maxYear: maxYear, totalMonths: (maxYear - minYear + 1) * 12 };
  }
  // Measures how wide an Activity Timeline bar's label needs to be so it
  // never truncates ("5 Days" must never clip to "5 Da…"). Uses a canvas to
  // measure the exact rendered width of the text in the bar's real font;
  // falls back to a conservative per-character estimate if canvas text
  // measurement isn't available (e.g. some test/headless environments).
  var _schMeasureCtx;
  function schMeasureTextWidth(text) {
    if (_schMeasureCtx === undefined) {
      try {
        var c = document.createElement("canvas");
        _schMeasureCtx = c.getContext ? c.getContext("2d") : null;
        if (_schMeasureCtx) _schMeasureCtx.font = '500 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      } catch (e) { _schMeasureCtx = null; }
    }
    if (_schMeasureCtx && typeof _schMeasureCtx.measureText === "function") {
      var w = _schMeasureCtx.measureText(text).width;
      if (w > 0) return w;
    }
    return text.length * 6.4; // fallback estimate, tuned generously wide
  }
  // Minimum bar width (px) that fits the label + delay icon + the bar's own
  // padding/border without clipping, so a short (e.g. 1-2 day) activity's
  // bar never truncates its "N Days" text.
  function schBarMinWidth(label, hasIcon) {
    var textW = schMeasureTextWidth(label);
    var iconW = hasIcon ? 14 : 0; // icon glyph + flex gap
    var paddingW = 12; // .sch-bar padding:0 6px
    var borderBuffer = 6; // border, box-shadow, and a small safety margin
    return Math.ceil(textW + iconW + paddingW + borderBuffer);
  }
  // Position (in px) of a given real date within the continuous multi-year
  // grid. endInclusive:false -> the leading edge of that day (bar start);
  // endInclusive:true  -> the trailing edge of that day (bar end, so the
  // whole day is included in the bar's width). The date's fractional
  // position within its own month (day / that month's real day count) is
  // what's day-accurate; that fraction is then applied to the fixed
  // SCH_MONTH_PX column width, offset by how many whole months separate it
  // from January of layout.minYear.
  function schedulePx(layout, date, endInclusive) {
    var month = date.getMonth() + 1, day = date.getDate();
    var dim = daysInMonth(date.getFullYear(), month);
    var frac = (endInclusive ? day : day - 1) / dim;
    var monthOffset = (date.getFullYear() - layout.minYear) * 12 + (month - 1);
    return monthOffset * SCH_MONTH_PX + frac * SCH_MONTH_PX;
  }
  // Clamps a date onto the displayed [minYear, maxYear] grid (for a bar that
  // starts before or ends after the visible range) — returns an in-range Date.
  function scheduleClamp(date, layout, which) {
    var lo = new Date(layout.minYear, 0, 1), hi = new Date(layout.maxYear, 11, 31);
    if (!date) return which === "end" ? hi : lo;
    if (date.getTime() < lo.getTime()) return lo;
    if (date.getTime() > hi.getTime()) return hi;
    return date;
  }

  function populateScheduleFilterOptions() {
    var cats = uniqueSorted(state.docs, function (d) { return d.category; });
    var people = uniqueSorted(state.docs, function (d) { return d.responsiblePerson; });
    els.schCategory.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join("");
    els.schResponsible.innerHTML = '<option value="">All responsible people</option>' + people.map(function (p) { return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>'; }).join("");
    els.schStatus.innerHTML = '<option value="">All statuses</option>' + STATUS_LIST.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join("");
    els.schCategory.value = state.sch.category || "";
    els.schResponsible.value = state.sch.responsible || "";
    els.schStatus.value = state.sch.status || "";
    els.schMonth.value = state.sch.month || "";
    // schYear's own <option>s (the years actually spanned) are filled in by
    // renderScheduleTimeline, since that's where the layout range is known.
  }

  function getScheduleDocs() {
    var f = state.sch;
    return state.docs.filter(function (d) {
      if (f.month && String(d.month) !== String(f.month)) return false;
      if (f.category && d.category !== f.category) return false;
      if (f.responsible && d.responsiblePerson !== f.responsible) return false;
      if (f.status && d.status !== f.status) return false;
      return true;
    }).sort(function (a, b) {
      var sa = parseDateLocal(a.startDate), sb = parseDateLocal(b.startDate);
      if (sa && sb) return sa.getTime() - sb.getTime();
      return 0;
    });
  }
  // Scrolls the Activity Timeline horizontally so `year` starts right at the
  // left edge of the visible (unscrolled-under-the-sticky-column) area —
  // the "Jump to year" convenience that replaces the old single-year filter
  // now that the whole range is always shown at once.
  function scrollScheduleToYear(year) {
    var layout = state.sch._layout;
    if (!layout) return;
    var offset = (year - layout.minYear) * 12 * SCH_MONTH_PX;
    els.scheduleOuter.scrollLeft = Math.max(0, offset);
  }

  function renderScheduleTimeline() {
    var list = getScheduleDocs();
    var layout = buildScheduleLayout();
    state.sch._layout = layout;
    var today = todayLocal();
    var rangeLabel = layout.minYear === layout.maxYear ? String(layout.minYear) : (layout.minYear + "–" + layout.maxYear);
    var phaseCount = list.filter(function (d) { return getSubActivitiesFor(d.id).length > 0; }).length;
    els.scheduleHint.textContent = rangeLabel + " Gantt — " + list.length + " of " + state.docs.length + " activities shown" +
      (phaseCount ? " (" + phaseCount + " broken into phases)" : "") +
      ". Scroll sideways to see every year; the Activities column stays put. Click a bar for details.";

    // Jump-to-year convenience — repopulated every render so a newly added
    // activity's year is immediately selectable.
    var years = [];
    for (var yy = layout.minYear; yy <= layout.maxYear; yy++) years.push(yy);
    els.schYear.innerHTML = '<option value="">Jump to year…</option>' + years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join("");
    els.schYear.value = "";

    // Which absolute month-offset (0-based, from Jan of minYear) is "now" —
    // used to tint the current month's column wherever it falls in the range.
    var curOffset = (today.getFullYear() - layout.minYear) * 12 + today.getMonth();

    // Two header rows: a Year row (each year spanning its own 12 months)
    // above a Month row (Jan–Dec, repeated once per year in range).
    var yearHeaderHtml = "";
    var monthHeaderHtml = "";
    years.forEach(function (y) {
      var isCurYear = (y === today.getFullYear());
      yearHeaderHtml += '<th class="sch-year-h' + (isCurYear ? " sch-year-current" : "") + '" colspan="12" style="min-width:' + (12 * SCH_MONTH_PX) + 'px;">' + y + '</th>';
      for (var m = 1; m <= 12; m++) {
        var altCls = (m % 2 === 0) ? " sch-alt" : "";
        var curCls = (isCurYear && m === (today.getMonth() + 1)) ? " sch-month-current" : "";
        var yearEndCls = (m === 12) ? " sch-year-end" : "";
        monthHeaderHtml += '<th class="sch-month-h' + altCls + curCls + yearEndCls + '" style="width:' + SCH_MONTH_PX + 'px; min-width:' + SCH_MONTH_PX + 'px;">' + MONTH_ABBR[m - 1] + '</th>';
      }
    });
    var gridWidth = layout.totalMonths * SCH_MONTH_PX;
    // A vertical gridline every SCH_MONTH_PX — equal-width columns, so a
    // simple repeating background tile lines up with every month boundary.
    // When the current month falls within the visible range, a second
    // background layer tints just that one column so it's easy to spot.
    var trackBgImage = "repeating-linear-gradient(to right, var(--line) 0, var(--line) 1px, transparent 1px, transparent 100%)";
    var trackBgSize = SCH_MONTH_PX + "px 100%";
    if (curOffset >= 0 && curOffset < layout.totalMonths) {
      var curStart = curOffset * SCH_MONTH_PX, curEnd = (curOffset + 1) * SCH_MONTH_PX;
      trackBgImage = "linear-gradient(to right, transparent " + curStart + "px, var(--sch-current-bg) " + curStart + "px, var(--sch-current-bg) " + curEnd + "px, transparent " + curEnd + "px), " + trackBgImage;
      trackBgSize = gridWidth + "px 100%, " + trackBgSize;
    }

    // Renders one record's (Main Activity OR Sub-activity phase) segments
    // into the same `.sch-seg`/`.sch-seg-label` markup, using `tip` as every
    // segment's tooltip. Shared by the main row (when it has no phases) and
    // every phase sub-row, so both are colored and labeled identically.
    function renderBarSegmentsHtml(segRanges, recId, tip) {
      var boxesHtml = "", labelsHtml = "";
      segRanges.forEach(function (seg) {
        var scs = scheduleClamp(seg.start, layout, "start"), sce = scheduleClamp(seg.end, layout, "end");
        var sLeft = schedulePx(layout, scs, false);
        var sRight = schedulePx(layout, sce, true);
        var sWidth = Math.max(sRight - sLeft, 2.5); // always at least a visible/clickable sliver
        var segDays = diffDays(seg.end, seg.start) + 1;
        var segLabel = segDays + "d";
        var labelCenter = sLeft + sWidth / 2;
        var segColor = cssVar(SEG_COLOR_VAR[seg.cls]);
        boxesHtml += '<div class="sch-seg sch-seg-' + seg.cls + '" data-id="' + recId + '" tabindex="0" role="button" ' +
          'style="left:' + sLeft.toFixed(1) + 'px; width:' + sWidth.toFixed(1) + 'px; background-color:' + segColor + ';" title="' + tip + '"></div>';
        // data-seg-left/right record this segment's own box bounds (in the
        // same track-relative px as `left` above) so repositionScheduleLabels()
        // can re-clamp the label into whatever portion of the bar is
        // actually scrolled into view — see that function for why.
        labelsHtml += '<span class="sch-seg-label" data-seg-left="' + sLeft.toFixed(1) + '" data-seg-right="' + sRight.toFixed(1) + '" ' +
          'style="left:' + labelCenter.toFixed(1) + 'px; background-color:' + segColor + ';">' + segLabel + '</span>';
      });
      return boxesHtml + labelsHtml;
    }

    var rowsHtml = list.map(function (d, rowIdx) {
      var rowNo = rowIdx + 1;
      // ---------------------------------------------------------------
      // The Activity Timeline draws ONE continuous bar per activity (or
      // per phase — see subRowsHtml below), made of up to three adjoining,
      // chronologically-ordered segments — see buildActivityBarSegments:
      //   1. "progress" (green) — the portion already actually worked,
      //      only while Status is "In Progress" and Actual start is set.
      //   2. "planned" (blue) — the rest of the Planned Start/End span
      //      not already covered by the green segment (or the whole span,
      //      when there's no green segment at all).
      //   3. "delay" (red, auto-calculated) or "stuck" (brown, frozen) —
      //      only once today is past Planned End and it isn't
      //      Completed/Cancelled. Red grows every day the page is opened;
      //      it freezes and turns brown the moment Status is set to
      //      "Stuck", using Delay end date (defaulting to the day it was
      //      marked Stuck) as its fixed right edge.
      // Nothing here changes the Status field itself — same as the old
      // Planned/Actual/Delay-override bars, this is read-only display.
      // ---------------------------------------------------------------
      var bar = buildActivityBarSegments(d, today);
      var info = bar.info, delayText = info.label;
      // Delay override is a manually-typed number (from the "Delay override
      // (days, optional)" field on the Add/Edit form) — never computed from
      // dates. It's no longer drawn as its own bar (the auto-calculated
      // Delay/Stuck segment below supersedes it visually) but is still
      // saved and still surfaced in the tooltip if present.
      var delayOverride = (d.delayOverrideDays === 0 || d.delayOverrideDays) && String(d.delayOverrideDays).trim() !== "" ? Number(d.delayOverrideDays) : null;
      var hasDelayOverride = delayOverride != null && !isNaN(delayOverride) && delayOverride > 0;

      var tip = escapeHtml(d.activity) +
        "\nResponsible Person: " + escapeHtml(d.responsiblePerson || "—") +
        "\nCategory: " + escapeHtml(d.category || "—") +
        "\nPlanned: " + prettyDate(d.startDate) + " – " + prettyDate(d.endDate) + (bar.budgetDays != null ? " (" + bar.budgetDaysLabel + ")" : "") +
        "\nActual: " + (d.actualStart || d.actualEnd ? (prettyDate(d.actualStart) + " – " + prettyDate(d.actualEnd)) : "—") +
        (bar.overrunNote ? "\n" + bar.overrunNote : "") +
        (hasDelayOverride ? "\nDelay override (manual): " + delayOverride + (delayOverride === 1 ? " day" : " days") : "") +
        "\nStatus: " + escapeHtml(d.status);

      var subs = getSubActivitiesFor(d.id);
      // When this activity has phases, its own row's bar track stays empty
      // (no segments) — the grid lines and current-month tint still show,
      // but the actual bars are drawn one per phase, on their own rows,
      // right below (see subRowsHtml) — same layout as the reference
      // spreadsheet: a bold parent row ("1  Selection consulting firm…")
      // with nothing but the row label, followed by indented "1.1 Tender
      // Phase", "1.2 Design Phase", … rows, each carrying its own bar.
      var barHtml = subs.length ? "" : renderBarSegmentsHtml(bar.segRanges, d.id, tip);

      var mainRowHtml = '<tr>' +
        '<td class="sch-activity-cell' + (subs.length ? " sch-parent-cell" : "") + '">' +
          '<div class="sch-name" title="' + escapeHtml(d.activity) + '">' + (subs.length ? ('<span class="sch-row-no">' + rowNo + '.</span> ') : "") + escapeHtml(d.activity) + '</div>' +
          '<div class="sch-category" title="Budget category: ' + escapeHtml(d.category || "—") + '">' + escapeHtml(d.category || "—") + '</div>' +
          '<div class="sch-dates" title="Budget period: ' + escapeHtml(fmtRange(d.startDate, d.endDate)) + '">' + escapeHtml(fmtRange(d.startDate, d.endDate)) + '</div>' +
          '<div class="sch-chips">' +
            '<span class="delay-chip dc-' + info.code + '">' + escapeHtml(delayText) + '</span>' +
          '</div>' +
        '</td>' +
        '<td class="sch-bar-cell" colspan="' + layout.totalMonths + '">' +
          '<div class="sch-bar-track" style="width:' + gridWidth + 'px; background-image:' + trackBgImage + '; background-size:' + trackBgSize + ';">' + barHtml + '</div>' +
        '</td>' +
        '</tr>';

      var subRowsHtml = "";
      if (subs.length) {
        // Each Sub-activity (phase) gets its OWN full row, indented and
        // numbered "rowNo.phaseNo" under its Main Activity — and its own
        // Planned/Actual/Status/Delay/Stuck bar, built and colored by the
        // exact same buildActivityBarSegments()/renderBarSegmentsHtml() path
        // as the Main Activity's own bar (blue Planned, green In Progress,
        // red auto-Delay, brown Stuck) — no longer a single block colored by
        // phase name.
        subRowsHtml = subs.map(function (sa, si) {
          var subNo = rowNo + "." + (si + 1);
          var saBar = buildActivityBarSegments(sa, today);
          var saInfo = saBar.info;
          var phDays = saBar.budgetDays;
          var phTip = escapeHtml(d.activity) + " — " + escapeHtml(sa.name || ("Phase " + (si + 1))) +
            "\nPlanned: " + prettyDate(sa.startDate) + " – " + prettyDate(sa.endDate) + (phDays != null ? " (" + saBar.budgetDaysLabel + ")" : "") +
            "\nActual: " + (sa.actualStart || sa.actualEnd ? (prettyDate(sa.actualStart) + " – " + prettyDate(sa.actualEnd)) : "—") +
            (saBar.overrunNote ? "\n" + saBar.overrunNote : "") +
            "\nStatus: " + escapeHtml(sa.status);
          var segHtmlAndLabels = renderBarSegmentsHtml(saBar.segRanges, d.id, phTip);
          return '<tr class="sch-subrow' + (si === subs.length - 1 ? " sch-subrow-last" : "") + '">' +
            '<td class="sch-activity-cell sch-subrow-cell">' +
              '<div class="sch-subrow-label"><span class="sch-row-no">' + subNo + '</span> ' + escapeHtml(sa.name || ("Phase " + (si + 1))) + '</div>' +
              '<div class="sch-subrow-meta">' +
                '<span class="sch-subrow-dates">' + escapeHtml(fmtRange(sa.startDate, sa.endDate)) + '</span>' +
                '<span class="delay-chip dc-' + saInfo.code + '">' + escapeHtml(saInfo.label) + '</span>' +
              '</div>' +
            '</td>' +
            '<td class="sch-bar-cell sch-subrow-bar-cell" colspan="' + layout.totalMonths + '">' +
              '<div class="sch-bar-track" style="width:' + gridWidth + 'px; background-image:' + trackBgImage + '; background-size:' + trackBgSize + ';">' + segHtmlAndLabels + '</div>' +
            '</td>' +
            '</tr>';
        }).join("");
      }

      return mainRowHtml + subRowsHtml;
    }).join("");

    if (!list.length) {
      rowsHtml = '<tr><td class="sch-activity-cell" colspan="' + (layout.totalMonths + 1) + '" style="text-align:center; color:var(--muted); padding:20px;">No activities match the current filters.</td></tr>';
    }

    els.scheduleOuter.innerHTML =
      '<table class="sch-table">' +
        '<thead>' +
          '<tr><th class="sch-corner" rowspan="2">Activities</th>' + yearHeaderHtml + '</tr>' +
          '<tr>' + monthHeaderHtml + '</tr>' +
        '</thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>';

    els.scheduleOuter.querySelectorAll(".sch-seg").forEach(function (b) {
      b.addEventListener("click", function () { viewActivityRow(b.getAttribute("data-id")); });
      b.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); viewActivityRow(b.getAttribute("data-id")); } });
    });

    renderTimelineLegend(els.scheduleLegend);
    renderStatusSummary(list, els.scheduleStatusSummary, rangeLabel);
    repositionScheduleLabels();
  }

  // A day-count label ("90d") is centered on its segment's own full span by
  // default (see labelCenter above). For a long segment that starts well
  // before the currently scrolled-into-view months (e.g. a 90-day Planned
  // bar that started in January while the timeline is scrolled to show
  // March onward), that true center can land underneath — or right at the
  // edge of — the sticky Activities column on the left, since only the
  // segment's box position is fixed; scrolling doesn't move it back into
  // view. This keeps every visible label pinned within whatever portion of
  // its own bar is actually on-screen right now (never past its own
  // segment's edges, and never under the sticky column), the same "sticky
  // label" behavior seen in most Gantt/chart tools. Purely cosmetic — it
  // only ever adjusts a label's inline `left`/opacity, never the
  // underlying `.sch-seg` box, so click targets and tooltips are unaffected.
  function repositionScheduleLabels() {
    var outer = els.scheduleOuter;
    var stickyEl = outer.querySelector(".sch-activity-cell");
    var stickyW = stickyEl ? stickyEl.getBoundingClientRect().width : 0;
    var scrollLeft = outer.scrollLeft;
    // The sticky Activities column keeps a fixed screen position as the
    // table scrolls, but it still occupies its own (unscrolled) space in
    // the table's own coordinate system — the same one `outer.scrollLeft`
    // and every segment's data-seg-left/right (track-relative px) share.
    // In that shared coordinate space, a track position is hidden behind
    // the sticky column exactly when it's less than `scrollLeft` (no extra
    // offset needed — verified empirically, not just derived). The
    // viewport's far edge, however, DOES need `stickyW` subtracted: the
    // sticky column eats into the visible width available for the track
    // on screen, so the right-hand boundary sits `stickyW` short of
    // `scrollLeft + outer.clientWidth`.
    var viewportRight = scrollLeft + outer.clientWidth - stickyW;
    outer.querySelectorAll(".sch-seg-label").forEach(function (label) {
      var segLeft = parseFloat(label.getAttribute("data-seg-left"));
      var segRight = parseFloat(label.getAttribute("data-seg-right"));
      if (isNaN(segLeft) || isNaN(segRight)) return;
      var visibleLeft = Math.max(segLeft, scrollLeft);
      var visibleRight = Math.min(segRight, viewportRight);
      if (visibleRight - visibleLeft <= 4) {
        // Less than a sliver of this bar is actually on screen right now —
        // hide the label rather than let it crowd the sticky column's edge.
        label.style.opacity = "0";
        return;
      }
      var half = (label.offsetWidth || 20) / 2;
      var center = (visibleLeft + visibleRight) / 2;
      var minCenter = segLeft + half, maxCenter = segRight - half;
      center = minCenter <= maxCenter ? Math.max(minCenter, Math.min(maxCenter, center)) : (segLeft + segRight) / 2;
      label.style.left = center.toFixed(1) + "px";
      label.style.opacity = "1";
    });
  }

  function wireScheduleFilters() {
    for (var mm = 1; mm <= 12; mm++) {
      var o = document.createElement("option"); o.value = mm; o.textContent = MONTH_ABBR[mm - 1];
      els.schMonth.appendChild(o);
    }
    // schYear is a "Jump to year" convenience, not a filter — the timeline
    // now always shows its full continuous range at once (see Q&A that
    // shaped this feature). Its own <option>s are (re)populated inside
    // renderScheduleTimeline, since that's where the actual year range lives.
    els.schYear.addEventListener("change", function () {
      var y = parseInt(els.schYear.value, 10);
      if (y) scrollScheduleToYear(y);
    });
    ["schMonth", "schCategory", "schResponsible", "schStatus"].forEach(function (id) {
      els[id].addEventListener("change", function () {
        state.sch.month = els.schMonth.value;
        state.sch.category = els.schCategory.value;
        state.sch.responsible = els.schResponsible.value;
        state.sch.status = els.schStatus.value;
        renderScheduleTimeline();
      });
    });
    els.schReset.addEventListener("click", function () {
      state.sch.month = ""; state.sch.category = ""; state.sch.responsible = ""; state.sch.status = "";
      populateScheduleFilterOptions();
      renderScheduleTimeline();
    });
    // Keep each bar's day-count label pinned to whatever part of it is
    // currently scrolled into view (see repositionScheduleLabels) — wired
    // once here rather than in renderScheduleTimeline, which reruns on
    // every filter change and would otherwise pile up duplicate listeners.
    var scheduleScrollPending = false;
    els.scheduleOuter.addEventListener("scroll", function () {
      if (scheduleScrollPending) return;
      scheduleScrollPending = true;
      window.requestAnimationFrame(function () {
        scheduleScrollPending = false;
        repositionScheduleLabels();
      });
    });
  }

  // =========================================================================
  // Add / Edit / Duplicate form
  // =========================================================================
  function populateFormStaticOptions() {
    els.fStatus.innerHTML = STATUS_LIST.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join("");
  }
  // Category is a strict dropdown sourced from the Category management
  // table (state.categories) — no more free-typed categories. If the
  // activity being edited/duplicated carries a category no longer in that
  // table (renamed or deleted since), pass it as explicitCategory so it's
  // kept as a selectable option rather than silently dropped; otherwise
  // (no arg) the current selection is read off the field itself and
  // preserved across a rebuild, e.g. when setRoute("add") calls this again.
  function populateFormDatalists(explicitCategory) {
    var currentCat = (explicitCategory !== undefined) ? (explicitCategory || "") : (els.fCategory.value || "");
    var catNames = uniqueSorted(state.categories, function (c) { return c.name; });
    if (currentCat && catNames.indexOf(currentCat) === -1) catNames.push(currentCat);
    catNames.sort();
    els.fCategory.innerHTML = '<option value="">Select a category…</option>' +
      catNames.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join("");
    els.fCategory.value = currentCat;
    els.responsibleList.innerHTML = uniqueSorted(state.docs, function (d) { return d.responsiblePerson; }).map(function (p) { return '<option value="' + escapeHtml(p) + '">'; }).join("");
    els.supportingList.innerHTML = uniqueSorted(state.docs, function (d) { return d.supportingTeam; }).map(function (p) { return '<option value="' + escapeHtml(p) + '">'; }).join("");
  }
  function showFormMsg(text, kind) {
    els.formMsg.hidden = false;
    els.formMsg.className = "form-msg " + (kind || "");
    els.formMsg.textContent = text;
  }
  function resetForm() {
    els.activityForm.reset();
    els.idField.hidden = true;
    els.fId.value = "";
    els.fPriority.value = "Medium";
    els.formMsg.hidden = true;
    els.formSubmitBtn.textContent = "Save activity";
    els.formCancelBtn.hidden = true;
    els.addFormTitle.textContent = "Add activity";
    els.addFormHint.textContent = "Fields marked * are required. Year/month and week position are worked out automatically from the planned dates.";
    renderSubActivityRows([]);
    state.editingId = null;
    state.duplicating = false;
  }
  function fillForm(d) {
    els.fName.value = d.activity || "";
    els.fDescription.value = d.description || "";
    els.fCategory.value = d.category || "";
    els.fResponsible.value = d.responsiblePerson || "";
    els.fSupporting.value = d.supportingTeam || "";
    els.fPriority.value = d.priority || "Medium";
    els.fStatus.value = d.status || "Planned";
    els.fPlannedStart.value = d.startDate || "";
    els.fPlannedEnd.value = d.endDate || "";
    els.fActualStart.value = d.actualStart || "";
    els.fActualEnd.value = d.actualEnd || "";
    els.fDelayOverride.value = (d.delayOverrideDays === 0 || d.delayOverrideDays) ? d.delayOverrideDays : "";
    els.fDelayEndDate.value = d.delayEndDate || "";
    els.fRemarks.value = d.notes || "";
    renderSubActivityRows(getSubActivitiesFor(d.id).map(function (sa) {
      return { name: sa.name, startDate: sa.startDate, endDate: sa.endDate, actualStart: sa.actualStart, actualEnd: sa.actualEnd, status: sa.status, delayEndDate: sa.delayEndDate };
    }));
  }
  // ---- Sub-activities (phases) editor on the Add/Edit Activity form -------
  // Each phase row is a small card carrying the same fields as a Main
  // Activity: name, Status, Planned Start/End, Actual Start/End, and a
  // Delay end date (used only once a phase's own Status is set to Stuck —
  // see collectSubActivitiesFromForm's auto-default, same behavior as the
  // Main Activity's own "Delay end date" field).
  function renderSubActivityRows(list) {
    els.subActivityRows.innerHTML = "";
    (list || []).forEach(function (ph) { addSubActivityRow(ph); });
  }
  function addSubActivityRow(prefill) {
    prefill = prefill || {};
    var row = document.createElement("div");
    row.className = "subact-row";
    var statusOptions = STATUS_LIST.map(function (s) {
      return '<option value="' + s + '"' + ((prefill.status || "Planned") === s ? " selected" : "") + '>' + s + '</option>';
    }).join("");
    row.innerHTML =
      '<div class="subact-row-top">' +
        '<input type="text" class="sa-name" placeholder="Phase name (e.g. Tender)" value="' + escapeHtml(prefill.name || "") + '">' +
        '<select class="sa-status" title="Phase status">' + statusOptions + '</select>' +
        '<button type="button" class="subact-remove" title="Remove phase">✕</button>' +
      '</div>' +
      '<div class="subact-row-grid">' +
        '<label class="subact-minifield">Planned start<input type="date" class="sa-start" title="Phase planned start date" value="' + escapeHtml(prefill.startDate || "") + '"></label>' +
        '<label class="subact-minifield">Planned end<input type="date" class="sa-end" title="Phase planned end date" value="' + escapeHtml(prefill.endDate || "") + '"></label>' +
        '<label class="subact-minifield">Actual start<input type="date" class="sa-actual-start" title="Phase actual start date" value="' + escapeHtml(prefill.actualStart || "") + '"></label>' +
        '<label class="subact-minifield">Actual end<input type="date" class="sa-actual-end" title="Phase actual end date" value="' + escapeHtml(prefill.actualEnd || "") + '"></label>' +
        '<label class="subact-minifield">Delay end (if Stuck)<input type="date" class="sa-delay-end" title="When this phase Stuck bar freezes — defaults to today if left blank" value="' + escapeHtml(prefill.delayEndDate || "") + '"></label>' +
      '</div>';
    row.querySelector(".subact-remove").addEventListener("click", function () { row.remove(); });
    els.subActivityRows.appendChild(row);
  }
  // Reads the current phase rows off the form — rows left completely blank
  // (no name, no dates typed) are silently dropped rather than treated as an
  // error, since the empty state (no phases at all) is a perfectly valid,
  // very common choice (keep the automatic Planned/Actual bar instead).
  function collectSubActivitiesFromForm() {
    return Array.prototype.slice.call(els.subActivityRows.querySelectorAll(".subact-row")).map(function (row) {
      var status = row.querySelector(".sa-status").value;
      status = STATUS_LIST.indexOf(status) >= 0 ? status : "Planned";
      var delayTyped = dateOnly(row.querySelector(".sa-delay-end").value);
      return {
        name: row.querySelector(".sa-name").value.trim(),
        startDate: dateOnly(row.querySelector(".sa-start").value),
        endDate: dateOnly(row.querySelector(".sa-end").value),
        actualStart: dateOnly(row.querySelector(".sa-actual-start").value),
        actualEnd: dateOnly(row.querySelector(".sa-actual-end").value),
        status: status,
        // Same auto-default as the Main Activity's own Delay end date: left
        // blank while Status is Stuck, it defaults to today so the phase's
        // brown Stuck bar freezes at today's length instead of staying open.
        delayEndDate: delayTyped ? delayTyped : (status === "Stuck" ? toISODateLocal(todayLocal()) : "")
      };
    }).filter(function (ph) { return ph.name || ph.startDate || ph.endDate; });
  }
  function editActivityRow(id) {
    var d = state.docs.find(function (x) { return x.id === id; });
    if (!d) return;
    resetForm();
    state.editingId = id;
    els.idField.hidden = false;
    els.fId.value = d.id;
    fillForm(d);
    populateFormDatalists(d.category);
    els.addFormTitle.textContent = "Edit activity #" + d.id;
    els.addFormHint.textContent = "Editing an existing activity — changes save back to the Google Sheet.";
    els.formSubmitBtn.textContent = "Save changes";
    els.formCancelBtn.hidden = false;
    setRoute("add");
  }
  function duplicateActivityRow(id) {
    var d = state.docs.find(function (x) { return x.id === id; });
    if (!d) return;
    resetForm();
    state.duplicating = true;
    fillForm(Object.assign({}, d, { status: "Planned", actualStart: "", actualEnd: "", delayOverrideDays: "", delayEndDate: "" }));
    // fillForm's own sub-activity prefill just copied the original phases'
    // actual/status/delay fields as-is — override that here so a duplicated
    // activity's phases start fresh (Planned, no actuals) too, same as the
    // Main Activity fields just reset above.
    renderSubActivityRows(getSubActivitiesFor(d.id).map(function (sa) {
      return { name: sa.name, startDate: sa.startDate, endDate: sa.endDate, status: "Planned", actualStart: "", actualEnd: "", delayEndDate: "" };
    }));
    populateFormDatalists(d.category);
    els.fName.value = (d.activity || "") + " (copy)";
    els.addFormTitle.textContent = "Duplicate activity #" + d.id;
    els.addFormHint.textContent = "Review the details below, then save to create a new activity — the original is untouched.";
    setRoute("add");
  }
  function cancelEdit() { resetForm(); setRoute("activities"); }

  function handleFormSubmit(ev) {
    ev.preventDefault();
    var name = els.fName.value.trim();
    var category = els.fCategory.value.trim();
    if (!name || !category) { showFormMsg("Activity name and category are required.", "err"); return; }
    var psRaw = dateOnly(els.fPlannedStart.value), peRaw = dateOnly(els.fPlannedEnd.value);
    var ps = parseDateLocal(psRaw), pe = parseDateLocal(peRaw);
    if (!ps || !pe) { showFormMsg("Planned start and end dates are required.", "err"); return; }
    if (pe.getTime() < ps.getTime()) { showFormMsg("Planned end date must be on or after the planned start date.", "err"); return; }
    var asRaw = dateOnly(els.fActualStart.value), aeRaw = dateOnly(els.fActualEnd.value);
    if (asRaw && aeRaw) {
      var as_ = parseDateLocal(asRaw), ae_ = parseDateLocal(aeRaw);
      if (ae_.getTime() < as_.getTime()) { showFormMsg("Actual end date must be on or after the actual start date.", "err"); return; }
    }
    var subPhases = collectSubActivitiesFromForm();
    for (var spi = 0; spi < subPhases.length; spi++) {
      var ph = subPhases[spi];
      if (!ph.name) { showFormMsg("Each sub-activity phase needs a name (row " + (spi + 1) + ").", "err"); return; }
      if (!ph.startDate || !ph.endDate) { showFormMsg('Phase "' + ph.name + '" needs both a planned start and end date.', "err"); return; }
      if (parseDateLocal(ph.endDate).getTime() < parseDateLocal(ph.startDate).getTime()) { showFormMsg('Phase "' + ph.name + '" planned end date must be on or after its planned start date.', "err"); return; }
      if (ph.actualStart && ph.actualEnd && parseDateLocal(ph.actualEnd).getTime() < parseDateLocal(ph.actualStart).getTime()) { showFormMsg('Phase "' + ph.name + '" actual end date must be on or after its actual start date.', "err"); return; }
    }
    var year = ps.getFullYear(), month = ps.getMonth() + 1, monthName = MONTH_ABBR[ps.getMonth()];
    var startDay = ps.getDate();
    var sameMonth = pe.getFullYear() === year && (pe.getMonth() + 1) === month;
    var endDay = sameMonth ? pe.getDate() : daysInMonth(year, month);
    var crossMonthNote = sameMonth ? "" : " (Note: the timeline draws each activity within a single month, so the bar is shown through the end of its start month — the full planned end date is still saved and shown everywhere else.)";

    var fields = {
      activity: name,
      description: els.fDescription.value.trim(),
      category: category,
      // Prefer the group already set on this category in the Category table
      // (now that Category is a strict dropdown, it normally exists there);
      // fall back to the keyword heuristic only for a legacy/orphaned value.
      categoryGroup: (function () {
        var found = state.categories.find(function (c) { return c.name === category; });
        return (found && found.group) ? found.group : categorizeToGroup(category);
      })(),
      responsiblePerson: els.fResponsible.value.trim(),
      supportingTeam: els.fSupporting.value.trim(),
      priority: els.fPriority.value,
      status: els.fStatus.value,
      year: year, month: month, monthName: monthName,
      startDate: psRaw, endDate: peRaw, startDay: startDay, endDay: endDay,
      actualStart: asRaw, actualEnd: aeRaw,
      delayOverrideDays: els.fDelayOverride.value.trim() === "" ? "" : Number(els.fDelayOverride.value),
      // When an activity is marked Stuck and no delay end date was typed in,
      // default it to today — this is what "freezes" the Activity Timeline's
      // brown Stuck bar at today's length instead of leaving it open-ended.
      // Still fully editable afterwards, same as any other date field.
      delayEndDate: (function () {
        var typed = dateOnly(els.fDelayEndDate.value);
        if (typed) return typed;
        if (els.fStatus.value === "Stuck") return toISODateLocal(todayLocal());
        return "";
      })(),
      notes: els.fRemarks.value.trim()
    };

    els.formSubmitBtn.disabled = true;
    if (state.editingId) {
      var id = state.editingId;
      updateActivity(id, fields).then(function (updated) {
        var idx = state.docs.findIndex(function (d) { return d.id === id; });
        if (idx >= 0) state.docs[idx] = Object.assign({}, state.docs[idx], updated, { id: id });
        return replaceSubActivitiesFor(id, subPhases);
      }).then(function () {
        showFormMsg("Activity #" + id + " updated." + crossMonthNote, "ok");
        renderAll();
        setTimeout(function () { cancelEdit(); }, 700);
      }).catch(function (err) { showFormMsg("Couldn't save: " + err.message, "err"); }).finally(function () { els.formSubmitBtn.disabled = false; });
    } else {
      createActivity(fields).then(function (created) {
        state.docs.push(created);
        return replaceSubActivitiesFor(created.id, subPhases).then(function () { return created; });
      }).then(function (created) {
        showFormMsg("Activity #" + created.id + " added." + crossMonthNote, "ok");
        resetForm();
        renderAll();
      }).catch(function (err) { showFormMsg("Couldn't save: " + err.message, "err"); }).finally(function () { els.formSubmitBtn.disabled = false; });
    }
  }

  function deleteActivityRow(id) {
    if (!window.confirm("Delete this activity? This cannot be undone.")) return;
    deleteActivityRemote(id).then(function () {
      return replaceSubActivitiesFor(id, []); // also cleans up any phases that belonged to it
    }).then(function () {
      state.docs = state.docs.filter(function (d) { return d.id !== id; });
      renderAll();
    }).catch(function (err) { window.alert("Delete failed: " + err.message); });
  }

  // =========================================================================
  // View modal
  // =========================================================================
  function openModal(html) {
    els.modalBody.innerHTML = html;
    els.modalBackdrop.hidden = false;
  }
  function closeModal() { els.modalBackdrop.hidden = true; }
  function wireModal() {
    els.modalBackdrop.addEventListener("click", function (ev) { if (ev.target === els.modalBackdrop) closeModal(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !els.modalBackdrop.hidden) closeModal(); });
  }
  function viewActivityRow(id) {
    var d = state.docs.find(function (x) { return x.id === id; });
    if (!d) return;
    var rows = [
      ["Activity ID", escapeHtml(d.id)],
      ["Activity name", escapeHtml(d.activity)],
      ["Description", escapeHtml(d.description || "—")],
      ["Category", escapeHtml(d.category) + " (" + escapeHtml(d.categoryGroup) + ")"],
      ["Responsible", escapeHtml(d.responsiblePerson || "—")],
      ["Supporting team", escapeHtml(d.supportingTeam || "—")],
      ["Priority", escapeHtml(d.priority)],
      ["Planned period", escapeHtml(fmtRange(d.startDate, d.endDate))],
      ["Actual period", escapeHtml(d.actualStart || d.actualEnd ? fmtRange(d.actualStart, d.actualEnd) : "—")],
      ["Status", escapeHtml(d.status)],
      ["Remarks", escapeHtml(d.notes || "—")]
    ];
    openModal(
      '<button class="modal-close" id="modalCloseBtn" aria-label="Close">✕</button>' +
      '<h3>' + escapeHtml(d.activity) + '</h3>' +
      '<dl>' + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + '</dl>' +
      '<div class="form-actions"><button class="btn btn-primary" id="modalEditBtn">Edit</button><button class="btn" id="modalCloseBtn2">Close</button></div>'
    );
    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    document.getElementById("modalCloseBtn2").addEventListener("click", closeModal);
    document.getElementById("modalEditBtn").addEventListener("click", function () { closeModal(); editActivityRow(id); });
  }

  // =========================================================================
  // Settings
  // =========================================================================
  function applyTheme(choice) {
    var root = document.documentElement;
    if (choice === "light") root.setAttribute("data-theme", "light");
    else if (choice === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    try { localStorage.setItem("nqemt2-theme", choice); } catch (e) { /* ignore */ }
    els.themeToggle.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-theme-choice") === choice); });
  }
  function wireSettings() {
    els.themeToggle.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () { applyTheme(b.getAttribute("data-theme-choice")); });
    });
    var saved = "system";
    try { saved = localStorage.getItem("nqemt2-theme") || "system"; } catch (e) { /* ignore */ }
    applyTheme(saved);
    if (els.logoutBtn) {
      els.logoutBtn.addEventListener("click", function () {
        clearAuthed();
        window.location.reload();
      });
    }
  }
  function renderSettings() {
    els.settingsDataSource.textContent = usingLiveApi ? "Connected to your Google Sheet via Apps Script." : "Running in demo mode on a bundled sample — set API_URL in config.js to go live.";
    els.settingsCount.textContent = state.docs.length + " activities loaded.";
    if (typeof SHEET_URL === "string" && SHEET_URL.indexOf("http") === 0) els.openSheetBtn.href = SHEET_URL;
    else els.openSheetBtn.hidden = true;
    if (els.settingsAccount) {
      var u = authedUser();
      els.settingsAccount.textContent = u ? ("Logged in as " + u + ".") : "—";
    }
  }

  // =========================================================================
  // Boot
  // =========================================================================
  function renderAll() {
    renderActivitiesTable();
    renderCategoriesTable();
    populateScheduleFilterOptions();
    renderScheduleTimeline();
    populateFormDatalists();
    renderSettings();
    els.sidebarSync.textContent = usingLiveApi ? "🟢 Live (Google Sheet)" : "🟡 Demo mode";
  }

  function fetchLiveCategories() {
    var url = withAuth(API_URL) + "&sheet=categories";
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.unauthorized) { forceReLogin(); return []; }
        return (res && res.ok && Array.isArray(res.categories)) ? res.categories : [];
      })
      .catch(function () { return []; }); // best-effort — an older deployment or missing tab just starts with no categories
  }

  function fetchLiveSubActivities() {
    var url = withAuth(API_URL) + "&sheet=subactivities";
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.unauthorized) { forceReLogin(); return []; }
        return (res && res.ok && Array.isArray(res.subActivities)) ? res.subActivities : [];
      })
      .catch(function () { return []; }); // best-effort — an older deployment or missing tab just starts with no phases
  }

  // One-time UI wiring — guarded so it's safe to call again (see boot()
  // below) after a forced re-login without double-attaching every listener.
  var _wired = false;
  function wireAppOnce() {
    if (_wired) return;
    _wired = true;
    cacheEls();
    wireNav();
    setSidebarCollapsed(loadSidebarCollapsed());
    wireActivitiesControls();
    wireCategoriesControls();
    wireScheduleFilters();
    wireModal();
    wireSettings();
    populateFormStaticOptions();
    els.activityForm.addEventListener("submit", handleFormSubmit);
    els.formCancelBtn.addEventListener("click", cancelEdit);
    els.addSubActivityBtn.addEventListener("click", function () { addSubActivityRow(); });
  }

  function finishBoot(docs, cats, subActs) {
    state.docs = docs.map(normalizeDoc);
    state.categories = (cats || []).map(normalizeCategory);
    state.subActivities = (subActs || []).map(normalizeSubActivity);
    renderAll();
    setRoute(loadLastRoute() || "schedule");
    // The activities are in and the first view is rendered — the spinner
    // shown since the page opened (see the plain HTML/CSS at the top of
    // index.html) has done its job, whether that took a moment (demo mode)
    // or however long the live Apps Script fetch took.
    if (els.loadingOverlay) els.loadingOverlay.classList.add("hide");
  }

  // Loads the activities/categories (live or demo) and renders the first
  // view. Split out from wireAppOnce() so a forced re-login (see
  // forceReLogin, called when Code.gs rejects a stale session) can reload
  // data without re-wiring every control on the page a second time.
  function loadData() {
    if (!usingLiveApi) {
      els.syncBanner.hidden = false;
      els.syncBanner.textContent = "Running in demo mode on a bundled sample — edits won't be saved. Set API_URL in config.js to your deployed Apps Script URL to go live.";
      finishBoot(
        JSON.parse(JSON.stringify(SAMPLE_ACTIVITIES)),
        typeof SAMPLE_CATEGORIES !== "undefined" ? JSON.parse(JSON.stringify(SAMPLE_CATEGORIES)) : [],
        typeof SAMPLE_SUB_ACTIVITIES !== "undefined" ? JSON.parse(JSON.stringify(SAMPLE_SUB_ACTIVITIES)) : []
      );
      return;
    }
    fetch(withAuth(API_URL))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.unauthorized) { forceReLogin(); throw new Error("__unauthorized__"); }
        if (!res || !res.ok || !Array.isArray(res.activities)) throw new Error("bad response");
        els.syncBanner.hidden = true;
        return Promise.all([fetchLiveCategories(), fetchLiveSubActivities()]).then(function (results) {
          finishBoot(res.activities, results[0], results[1]);
        });
      })
      .catch(function (err) {
        // forceReLogin() already put the login screen back up for this case
        // — falling through to the "couldn't reach the API" banner and the
        // bundled sample underneath it would just be confusing noise.
        if (err && err.message === "__unauthorized__") return;
        els.syncBanner.hidden = false;
        els.syncBanner.textContent = "Couldn't reach the Apps Script API (" + err.message + "). Showing the bundled sample instead.";
        finishBoot(
          JSON.parse(JSON.stringify(SAMPLE_ACTIVITIES)),
          typeof SAMPLE_CATEGORIES !== "undefined" ? JSON.parse(JSON.stringify(SAMPLE_CATEGORIES)) : [],
          typeof SAMPLE_SUB_ACTIVITIES !== "undefined" ? JSON.parse(JSON.stringify(SAMPLE_SUB_ACTIVITIES)) : []
        );
      });
  }

  function boot() {
    wireAppOnce();
    loadData();
  }

  // =========================================================================
  // Login gate — the very first thing that runs. Nothing above this point
  // touches the DOM, so it's safe for boot() to stay unreached until a
  // valid username/password is entered (or a valid session already exists).
  // =========================================================================
  (function initLogin() {
    var loginScreen = document.getElementById("loginScreen");
    var loginForm = document.getElementById("loginForm");
    var loginUser = document.getElementById("loginUser");
    var loginPass = document.getElementById("loginPass");
    var loginMsg = document.getElementById("loginMsg");

    function enterApp() {
      if (loginScreen) loginScreen.classList.add("hide");
      boot(); // idempotent — wireAppOnce() no-ops if already wired
    }

    if (isAuthed()) { enterApp(); return; }
    if (!loginForm) { boot(); return; } // markup missing somehow — fail open rather than dead-end the page

    loginForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var u = loginUser.value.trim(), p = loginPass.value;
      if (checkCredentials(u, p)) {
        setAuthed(u, p);
        if (loginMsg) loginMsg.hidden = true;
        enterApp();
      } else {
        if (loginMsg) {
          loginMsg.hidden = false;
          loginMsg.className = "form-msg err";
          loginMsg.textContent = "Incorrect username or password.";
        }
        loginPass.value = "";
        loginPass.focus();
      }
    });
    loginUser.focus();
  })();
})();
