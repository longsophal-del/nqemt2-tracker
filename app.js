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
  // "Delayed" is kept as a manual status option per spec, alongside the
  // auto-computed on-time/delayed/rescheduled read-out shown on the timeline
  // and in the Delay column (see computeDelayInfo).
  var STATUS_LIST = ["Planned", "In Progress", "Completed", "Delayed", "Rescheduled", "Cancelled"];
  var PRIORITY_LIST = ["High", "Medium", "Low"];
  var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAY_MS = 86400000;
  var DELAY_INFO = {
    upcoming: { label: "Upcoming", swatch: "--st-upcoming" },
    ontime: { label: "On Time", swatch: "--st-planned" },
    delayed: { label: "Delayed", swatch: "--st-delayed" },
    completed: { label: "Completed", swatch: "--st-completed" },
    "completed-delayed": { label: "Completed (delayed)", swatch: "--st-progress" },
    rescheduled: { label: "Rescheduled", swatch: "--cat-other" },
    cancelled: { label: "Cancelled", swatch: "--st-cancelled" }
  };
  var ROUTE_TITLES = {
    dashboard: "Dashboard",
    activities: "Activities",
    categories: "Category",
    timeline: "Calendar / Timeline",
    schedule: "Schedule Timeline",
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
    d.status = d.status || "Planned";
    d.priority = PRIORITY_LIST.indexOf(d.priority) >= 0 ? d.priority : "Medium";
    d.notes = d.notes || "";
    d.description = d.description || "";
    d.responsiblePerson = d.responsiblePerson || "";
    d.supportingTeam = d.supportingTeam || "";
    d.delayOverrideDays = (d.delayOverrideDays === 0 || d.delayOverrideDays) ? d.delayOverrideDays : "";
    return d;
  }
  function normalizeCategory(raw) {
    return {
      id: String(raw.id != null ? raw.id : ""),
      name: raw.name || "",
      group: CATEGORY_GROUPS.indexOf(raw.group) >= 0 ? raw.group : "Other"
    };
  }

  // =========================================================================
  // Auto-computed delay engine
  // =========================================================================
  // Returns {code, label, delayDays} — delayDays > 0 means late. `code` is
  // one of: upcoming | ontime | delayed | completed | completed-delayed | rescheduled | cancelled.
  // "Upcoming" = the planned start date hasn't arrived yet (nothing underway
  // yet). "On Time" = the planned period has started, the planned end date
  // hasn't passed, and nothing about it looks late yet — i.e. it's currently
  // underway and still tracking on schedule.
  function computeDelayInfo(d, today) {
    if (d.status === "Cancelled") return { code: "cancelled", label: DELAY_INFO.cancelled.label, delayDays: 0 };

    var pStart = parseDateLocal(d.startDate), pEnd = parseDateLocal(d.endDate);

    // Manual override escape hatch — the only way delay days can be typed
    // directly, per spec ("do not allow users to manually type the delay
    // unless there is a specific override field").
    if (d.delayOverrideDays !== "" && d.delayOverrideDays != null && !isNaN(Number(d.delayOverrideDays))) {
      var ov = Number(d.delayOverrideDays);
      if (ov <= 0) {
        var doneOv = !!(d.actualEnd || d.status === "Completed");
        if (doneOv) return { code: "completed", label: DELAY_INFO.completed.label, delayDays: 0 };
        var upcomingOv = !!(pStart && today.getTime() < pStart.getTime());
        return { code: upcomingOv ? "upcoming" : "ontime", label: upcomingOv ? DELAY_INFO.upcoming.label : DELAY_INFO.ontime.label, delayDays: 0 };
      }
      var lateOv = !!(d.actualEnd || d.status === "Completed");
      return { code: lateOv ? "completed-delayed" : "delayed", label: lateOv ? DELAY_INFO["completed-delayed"].label : DELAY_INFO.delayed.label, delayDays: ov };
    }

    if (!pStart || !pEnd) return { code: "ontime", label: DELAY_INFO.ontime.label, delayDays: 0 };

    var aStart = parseDateLocal(d.actualStart), aEnd = parseDateLocal(d.actualEnd);
    if (aStart || aEnd) {
      var effStart = aStart || aEnd, effEnd = aEnd || aStart;
      var overlaps = effStart.getTime() <= pEnd.getTime() && effEnd.getTime() >= pStart.getTime();
      var delta = diffDays(effEnd, pEnd);
      if (!overlaps) return { code: "rescheduled", label: DELAY_INFO.rescheduled.label, delayDays: delta };
      if (aEnd) {
        if (delta > 0) return { code: "completed-delayed", label: DELAY_INFO["completed-delayed"].label, delayDays: delta };
        return { code: "completed", label: DELAY_INFO.completed.label, delayDays: delta < 0 ? delta : 0 };
      }
      // Actual start recorded but not yet an actual end — it has genuinely
      // started, so this is "on time" (or delayed), never "upcoming".
      if (today.getTime() > pEnd.getTime()) return { code: "delayed", label: DELAY_INFO.delayed.label, delayDays: diffDays(today, pEnd) };
      return { code: "ontime", label: DELAY_INFO.ontime.label, delayDays: 0 };
    }
    if (d.status === "Completed") return { code: "completed", label: DELAY_INFO.completed.label, delayDays: 0 };
    if (today.getTime() > pEnd.getTime()) return { code: "delayed", label: DELAY_INFO.delayed.label, delayDays: diffDays(today, pEnd) };
    if (today.getTime() < pStart.getTime()) return { code: "upcoming", label: DELAY_INFO.upcoming.label, delayDays: 0 };
    return { code: "ontime", label: DELAY_INFO.ontime.label, delayDays: 0 };
  }

  function weekSegmentsForMonth(year, month, dim) {
    var jan1 = new Date(year, 0, 1);
    var segs = [];
    for (var day = 1; day <= dim;) {
      var end = Math.min(day + 6, dim);
      var startDate = new Date(year, month - 1, day);
      var weekNum = Math.ceil((diffDays(startDate, jan1) + 1) / 7);
      segs.push({ startDay: day, endDay: end, weekNum: weekNum });
      day = end + 1;
    }
    return segs;
  }

  // Greedy lane allocation so overlapping activities never share a row.
  // Two activities overlap when A.start <= B.end AND A.end >= B.start, so an
  // item can only reuse a lane once its start is strictly after that lane's
  // last-placed end. Input must already be sorted by start, then end.
  // Mutates each item with `.lane` (0-based) and returns the lane count used.
  function assignLanes(items) {
    var laneEnds = []; // laneEnds[i] = end day of the last item placed in lane i
    items.forEach(function (item) {
      var placed = false;
      for (var i = 0; i < laneEnds.length; i++) {
        if (item.start > laneEnds[i]) {
          laneEnds[i] = item.end;
          item.lane = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        laneEnds.push(item.end);
        item.lane = laneEnds.length - 1;
      }
    });
    return Math.max(laneEnds.length, 1);
  }

  // =========================================================================
  // Network / persistence
  // =========================================================================
  var usingLiveApi = typeof API_URL === "string" && API_URL.indexOf("http") === 0;

  function apiPost(payload) {
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (res) {
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
    route: "dashboard",
    timelineYear: 2026,
    dash: { year: "", month: "", category: "", responsible: "", status: "" },
    sch: { year: null, month: "", category: "", responsible: "", status: "" },
    act: { search: "", year: "", category: "", responsible: "", status: "", sortKey: "start", sortDir: "asc", page: 1, pageSize: 25 },
    editingId: null,
    duplicating: false
  };

  var els = {};
  function cacheEls() {
    [
      "sidebar", "sidebarBackdrop", "hamburgerBtn", "mainNav", "routeTitle", "exportBtn", "syncBanner", "sidebarSync",
      "dfYear", "dfMonth", "dfCategory", "dfResponsible", "dfStatus", "dfReset", "exportAllChartsBtn", "kpiGrid",
      "chartMonth", "chartMonthLegend", "chartStatus", "chartCategory", "chartPlannedActual", "chartPlannedActualLegend",
      "dashDelaySummary",
      "searchInput", "filterYear", "filterCategory", "filterResponsible", "filterStatus", "rowCount", "tableBody", "pagination",
      "categoriesTableBody", "categoryCount", "addCategoryBtn",
      "yearToggle", "timelineHint", "timelineBody", "timelineLegend", "delaySummary",
      "schYear", "schMonth", "schCategory", "schResponsible", "schStatus", "schReset",
      "scheduleHint", "scheduleOuter", "scheduleLegend", "scheduleDelaySummary",
      "addFormTitle", "addFormHint", "activityForm", "idField", "fId", "fName", "fDescription", "fCategory", "categoryList",
      "fResponsible", "responsibleList", "fSupporting", "supportingList", "fPriority", "fStatus",
      "fPlannedStart", "fPlannedEnd", "fActualStart", "fActualEnd", "fDelayOverride", "fRemarks",
      "formMsg", "formSubmitBtn", "formCancelBtn",
      "themeToggle", "settingsDataSource", "openSheetBtn", "settingsCount",
      "modalBackdrop", "modalBody"
    ].forEach(function (id) { els[id] = document.getElementById(id); });
  }

  // =========================================================================
  // Router
  // =========================================================================
  function setRoute(route) {
    state.route = route;
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = (v.id !== "view-" + route); });
    document.querySelectorAll(".nav-item").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-route") === route); });
    els.routeTitle.textContent = ROUTE_TITLES[route] || route;
    els.exportBtn.hidden = route !== "activities";
    els.sidebar.classList.remove("open");
    els.sidebarBackdrop.classList.remove("show");
    if (route === "dashboard") renderDashboard();
    else if (route === "activities") renderActivitiesTable();
    else if (route === "categories") renderCategoriesTable();
    else if (route === "timeline") { renderYearToggleTimeline(); renderTimeline(); }
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
    els.hamburgerBtn.addEventListener("click", function () {
      els.sidebar.classList.toggle("open");
      els.sidebarBackdrop.classList.toggle("show");
    });
    els.sidebarBackdrop.addEventListener("click", function () {
      els.sidebar.classList.remove("open");
      els.sidebarBackdrop.classList.remove("show");
    });
  }

  // =========================================================================
  // Dashboard
  // =========================================================================
  function populateDashFilterOptions() {
    var years = uniqueSorted(state.docs, function (d) { return d.year; });
    var cats = uniqueSorted(state.docs, function (d) { return d.category; });
    var people = uniqueSorted(state.docs, function (d) { return d.responsiblePerson; });
    var curY = els.dfYear.value || state.dash.year, curC = els.dfCategory.value, curP = els.dfResponsible.value, curS = els.dfStatus.value;
    els.dfYear.innerHTML = '<option value="">All years</option>' + years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join("");
    els.dfCategory.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join("");
    els.dfResponsible.innerHTML = '<option value="">All responsible people</option>' + people.map(function (p) { return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>'; }).join("");
    els.dfStatus.innerHTML = '<option value="">All statuses</option>' + STATUS_LIST.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join("");
    els.dfYear.value = curY || "";
    els.dfCategory.value = curC || "";
    els.dfResponsible.value = curP || "";
    els.dfStatus.value = curS || "";
    state.dash.year = els.dfYear.value;
  }

  function getDashDocs() {
    var f = state.dash;
    return state.docs.filter(function (d) {
      if (f.year && String(d.year) !== String(f.year)) return false;
      if (f.month && String(d.month) !== String(f.month)) return false;
      if (f.category && d.category !== f.category) return false;
      if (f.responsible && d.responsiblePerson !== f.responsible) return false;
      if (f.status && d.status !== f.status) return false;
      return true;
    });
  }

  function renderKPIs(list) {
    var today = todayLocal();
    var infos = list.map(function (d) { return computeDelayInfo(d, today); });
    var total = list.length;
    var completed = infos.filter(function (i) { return i.code === "completed" || i.code === "completed-delayed"; }).length;
    var inProgress = list.filter(function (d) { return d.status === "In Progress"; }).length;
    var upcoming = list.filter(function (d) {
      var ps = parseDateLocal(d.startDate);
      return d.status === "Planned" && ps && ps.getTime() > today.getTime();
    }).length;
    var delayed = infos.filter(function (i) { return i.code === "completed-delayed"; }).length;
    var overdue = infos.filter(function (i) { return i.code === "delayed"; }).length;

    var cards = [
      ["Total activities", total, ""],
      ["Completed", completed, "completed"],
      ["In progress", inProgress, "progress"],
      ["Upcoming", upcoming, "upcoming"],
      ["Delayed", delayed, "delayed"],
      ["Overdue", overdue, "overdue"]
    ];
    els.kpiGrid.innerHTML = cards.map(function (c) {
      return '<div class="kpi' + (c[2] ? " kpi-" + c[2] : "") + '"><div class="n">' + c[1] + '</div><div class="l">' + c[0] + '</div></div>';
    }).join("");
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function emptyChart(svg, msg, vb) {
    svg.innerHTML = "";
    svg.setAttribute("viewBox", vb || "0 0 480 100");
    var t = svgEl("text", { x: 10, y: 40, "font-size": 12, fill: cssVar("--muted") });
    t.textContent = msg;
    svg.appendChild(t);
  }

  // Pure data helpers — shared by chart rendering and the CSV export buttons,
  // so both always agree on exactly what a chart is showing.
  function computeMonthCategoryCounts(list) {
    var counts = [];
    for (var m = 0; m < 12; m++) { counts.push({}); CATEGORY_GROUPS.forEach(function (g) { counts[m][g] = 0; }); }
    list.forEach(function (d) {
      var m2 = (d.month || 1) - 1;
      if (m2 < 0 || m2 > 11) return;
      var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
      counts[m2][g] = (counts[m2][g] || 0) + 1;
    });
    var totals = counts.map(function (c) { return CATEGORY_GROUPS.reduce(function (s, g) { return s + c[g]; }, 0); });
    return { counts: counts, totals: totals };
  }
  function getStatusEntries(list) {
    return STATUS_LIST.map(function (s) { return { label: s, value: list.filter(function (d) { return d.status === s; }).length }; });
  }
  function getCategoryEntries(list) {
    var cats = uniqueSorted(list, function (d) { return d.category; });
    return cats.map(function (c) {
      var count = list.filter(function (d) { return d.category === c; }).length;
      var g = categorizeToGroup(c);
      var sample = list.find(function (d) { return d.category === c; });
      var group = (sample && CATEGORY_GROUPS.indexOf(sample.categoryGroup) >= 0) ? sample.categoryGroup : g;
      return { label: c, value: count, group: group };
    }).sort(function (a, b) { return b.value - a.value; });
  }
  function computePlannedActualCounts(list) {
    var today = todayLocal();
    var planned = [], onTime = [];
    for (var m = 0; m < 12; m++) { planned.push(0); onTime.push(0); }
    list.forEach(function (d) {
      var m2 = (d.month || 1) - 1;
      if (m2 < 0 || m2 > 11) return;
      planned[m2]++;
      var info = computeDelayInfo(d, today);
      if (info.code === "ontime" || info.code === "upcoming" || info.code === "completed") onTime[m2]++;
    });
    return { planned: planned, onTime: onTime };
  }

  function renderChartMonth(list) {
    var svg = els.chartMonth;
    if (!list.length) { emptyChart(svg, "No activities match the current filters.", "0 0 480 320"); els.chartMonthLegend.innerHTML = ""; return; }
    var data = computeMonthCategoryCounts(list);
    var counts = data.counts, totals = data.totals;
    var maxTotal = Math.max(1, Math.max.apply(null, totals));
    var W = 480, H = 320, padL = 34, padR = 10, padT = 14, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var colW = plotW / 12, barW = colW * 0.6;
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var val = Math.ceil(maxTotal * i / ticks);
      var y = padT + plotH - (plotH * i / ticks);
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: cssVar("--line"), "stroke-width": 1 }));
      var lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: cssVar("--muted") });
      lbl.textContent = val;
      svg.appendChild(lbl);
    }
    for (var m3 = 0; m3 < 12; m3++) {
      var x = padL + m3 * colW + (colW - barW) / 2;
      var yCursor = padT + plotH;
      CATEGORY_GROUPS.forEach(function (g) {
        var v = counts[m3][g];
        if (!v) return;
        var h = plotH * (v / maxTotal);
        yCursor -= h;
        var rect = svgEl("rect", { x: x, y: yCursor, width: barW, height: Math.max(h, 0), fill: groupColor(g), rx: 2 });
        var titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
        titleEl.textContent = MONTH_ABBR[m3] + " — " + g + ": " + v;
        rect.appendChild(titleEl);
        svg.appendChild(rect);
        // Only label a segment tall enough for a legible number — an
        // unlabeled sliver still has the tooltip above for its exact value.
        if (h >= 11) {
          var segLbl = svgEl("text", {
            x: x + barW / 2, y: yCursor + h / 2 + 3, "text-anchor": "middle", "font-size": 9, "font-weight": 600,
            fill: "#fff", stroke: "rgba(0,0,0,0.35)", "stroke-width": 2, "paint-order": "stroke"
          });
          segLbl.textContent = v;
          svg.appendChild(segLbl);
        }
      });
      if (totals[m3] > 0) {
        var totLbl = svgEl("text", { x: x + barW / 2, y: padT + plotH - Math.max(0, plotH * (totals[m3] / maxTotal)) - 6, "text-anchor": "middle", "font-size": 11, "font-weight": 600, fill: cssVar("--ink") });
        totLbl.textContent = totals[m3];
        svg.appendChild(totLbl);
      }
      var mLbl = svgEl("text", { x: x + barW / 2, y: H - 10, "text-anchor": "middle", "font-size": 12, fill: cssVar("--muted") });
      mLbl.textContent = MONTH_ABBR[m3];
      svg.appendChild(mLbl);
    }
    svg.appendChild(svgEl("line", { x1: padL, x2: padL, y1: padT, y2: padT + plotH, stroke: cssVar("--line"), "stroke-width": 1 }));
    els.chartMonthLegend.innerHTML = CATEGORY_GROUPS.map(function (g) {
      return '<span class="sw"><span class="dot" style="background:' + groupColor(g) + '"></span>' + g + '</span>';
    }).join("");
  }

  function renderSingleSeriesBarChart(svg, entries, vbW, vbH) {
    if (!entries.length) { emptyChart(svg, "No data for the current filters.", "0 0 " + vbW + " " + vbH); return; }
    var W = vbW, H = vbH, padL = 34, padR = 10, padT = 14, padB = 56;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var n = entries.length, colW = plotW / n, barW = Math.min(colW * 0.55, 60);
    var maxV = Math.max(1, Math.max.apply(null, entries.map(function (e) { return e.value; })));
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var val = Math.ceil(maxV * i / ticks);
      var y = padT + plotH - (plotH * i / ticks);
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: cssVar("--line"), "stroke-width": 1 }));
      var lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 10, fill: cssVar("--muted") });
      lbl.textContent = val;
      svg.appendChild(lbl);
    }
    entries.forEach(function (e, idx) {
      var x = padL + idx * colW + (colW - barW) / 2;
      var h = plotH * (e.value / maxV);
      var y = padT + plotH - h;
      var rect = svgEl("rect", { x: x, y: y, width: barW, height: Math.max(h, 0), fill: e.color, rx: 3 });
      var t = document.createElementNS("http://www.w3.org/2000/svg", "title");
      t.textContent = e.label + ": " + e.value;
      rect.appendChild(t);
      svg.appendChild(rect);
      if (e.value > 0) {
        var vLbl = svgEl("text", { x: x + barW / 2, y: y - 6, "text-anchor": "middle", "font-size": 10, "font-weight": 600, fill: cssVar("--ink") });
        vLbl.textContent = e.value;
        svg.appendChild(vLbl);
      }
      var label = svgEl("text", {
        x: x + barW / 2, y: padT + plotH + 14, "text-anchor": "end", "font-size": 10, fill: cssVar("--muted"),
        transform: "rotate(-30 " + (x + barW / 2) + " " + (padT + plotH + 14) + ")"
      });
      label.textContent = e.label.length > 16 ? e.label.slice(0, 15) + "…" : e.label;
      svg.appendChild(label);
    });
    svg.appendChild(svgEl("line", { x1: padL, x2: padL, y1: padT, y2: padT + plotH, stroke: cssVar("--line"), "stroke-width": 1 }));
  }

  function renderChartStatus(list) {
    // Fall back to accent color for any status whose CSS var name doesn't match exactly.
    var colorMap = { Planned: "--st-planned", "In Progress": "--st-progress", Completed: "--st-completed", Delayed: "--st-delayed", Rescheduled: "--cat-other", Cancelled: "--st-cancelled" };
    var entries = getStatusEntries(list).map(function (e) {
      return { label: e.label, value: e.value, color: cssVar(colorMap[e.label] || "--accent") };
    });
    renderSingleSeriesBarChart(els.chartStatus, entries, 480, 280);
  }

  function renderChartCategory(list) {
    var entries = getCategoryEntries(list).map(function (e) {
      return { label: e.label, value: e.value, color: groupColor(e.group) };
    });
    renderSingleSeriesBarChart(els.chartCategory, entries, 480, 280);
  }

  function renderChartPlannedActual(list) {
    var svg = els.chartPlannedActual;
    if (!list.length) { emptyChart(svg, "No data for the current filters.", "0 0 480 280"); els.chartPlannedActualLegend.innerHTML = ""; return; }
    var pa = computePlannedActualCounts(list);
    var planned = pa.planned, onTime = pa.onTime;
    var W = 480, H = 280, padL = 34, padR = 10, padT = 14, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var colW = plotW / 12, barW = colW * 0.28, gap = colW * 0.06;
    var maxV = Math.max(1, Math.max.apply(null, planned));
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    for (var i = 0; i <= 4; i++) {
      var val = Math.ceil(maxV * i / 4);
      var y = padT + plotH - (plotH * i / 4);
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: cssVar("--line"), "stroke-width": 1 }));
      var lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: cssVar("--muted") });
      lbl.textContent = val; svg.appendChild(lbl);
    }
    for (var m3 = 0; m3 < 12; m3++) {
      var groupX = padL + m3 * colW + (colW - (barW * 2 + gap)) / 2;
      var hP = plotH * (planned[m3] / maxV), hA = plotH * (onTime[m3] / maxV);
      var yP = padT + plotH - hP, yA = padT + plotH - hA;
      var rectP = svgEl("rect", { x: groupX, y: yP, width: barW, height: Math.max(hP, 0), fill: cssVar("--st-planned"), rx: 2 });
      var titleP = document.createElementNS("http://www.w3.org/2000/svg", "title");
      titleP.textContent = MONTH_ABBR[m3] + " — Planned: " + planned[m3];
      rectP.appendChild(titleP);
      svg.appendChild(rectP);
      var rectA = svgEl("rect", { x: groupX + barW + gap, y: yA, width: barW, height: Math.max(hA, 0), fill: cssVar("--st-completed"), rx: 2 });
      var titleA = document.createElementNS("http://www.w3.org/2000/svg", "title");
      titleA.textContent = MONTH_ABBR[m3] + " — On time / completed: " + onTime[m3];
      rectA.appendChild(titleA);
      svg.appendChild(rectA);
      if (planned[m3] > 0) {
        var vLblP = svgEl("text", { x: groupX + barW / 2, y: Math.max(yP - 4, padT + 8), "text-anchor": "middle", "font-size": 10, "font-weight": 600, fill: cssVar("--ink") });
        vLblP.textContent = planned[m3];
        svg.appendChild(vLblP);
      }
      if (onTime[m3] > 0) {
        var vLblA = svgEl("text", { x: groupX + barW + gap + barW / 2, y: Math.max(yA - 4, padT + 8), "text-anchor": "middle", "font-size": 10, "font-weight": 600, fill: cssVar("--ink") });
        vLblA.textContent = onTime[m3];
        svg.appendChild(vLblA);
      }
      var mLbl = svgEl("text", { x: groupX + barW + gap / 2, y: H - 10, "text-anchor": "middle", "font-size": 12, fill: cssVar("--muted") });
      mLbl.textContent = MONTH_ABBR[m3]; svg.appendChild(mLbl);
    }
    svg.appendChild(svgEl("line", { x1: padL, x2: padL, y1: padT, y2: padT + plotH, stroke: cssVar("--line"), "stroke-width": 1 }));
    els.chartPlannedActualLegend.innerHTML =
      '<span class="sw"><span class="dot" style="background:' + cssVar("--st-planned") + '"></span>Planned</span>' +
      '<span class="sw"><span class="dot" style="background:' + cssVar("--st-completed") + '"></span>On time / completed</span>';
  }

  function renderDashboard() {
    populateDashFilterOptions();
    var list = getDashDocs();
    renderKPIs(list);
    renderChartMonth(list);
    renderChartStatus(list);
    renderChartCategory(list);
    renderChartPlannedActual(list);
    renderDelaySummary(list, els.dashDelaySummary, state.dash.year || "all years");
  }

  // =========================================================================
  // Dashboard chart export — copy as image, per-chart CSV, all-charts PDF
  // =========================================================================
  function downloadCSV(filename, header, rows) {
    var csv = header.map(csvEscape).join(",") + "\n" + rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function exportChartCSV(svgId) {
    var list = getDashDocs();
    if (svgId === "chartMonth") {
      var md = computeMonthCategoryCounts(list);
      var header = ["Month"].concat(CATEGORY_GROUPS, ["Total"]);
      var rows = MONTH_ABBR.map(function (m, i) {
        return [m].concat(CATEGORY_GROUPS.map(function (g) { return md.counts[i][g] || 0; }), [md.totals[i]]);
      });
      downloadCSV("nqemt2_activities_by_month.csv", header, rows);
    } else if (svgId === "chartStatus") {
      var rows2 = getStatusEntries(list).map(function (e) { return [e.label, e.value]; });
      downloadCSV("nqemt2_activities_by_status.csv", ["Status", "Count"], rows2);
    } else if (svgId === "chartCategory") {
      var rows3 = getCategoryEntries(list).map(function (e) { return [e.label, e.group, e.value]; });
      downloadCSV("nqemt2_activities_by_category.csv", ["Category", "Group", "Count"], rows3);
    } else if (svgId === "chartPlannedActual") {
      var pa = computePlannedActualCounts(list);
      var rows4 = MONTH_ABBR.map(function (m, i) { return [m, pa.planned[i], pa.onTime[i]]; });
      downloadCSV("nqemt2_planned_vs_actual.csv", ["Month", "Planned", "On time / completed"], rows4);
    }
  }

  // Rasterizes an inline chart <svg> to a <canvas> (solid background so a
  // copy/paste or PDF page never shows a transparent hole), at `scale`x
  // resolution for a crisp result. Colors in the SVG are already resolved to
  // literal values by cssVar() at render time, so no external CSS is needed.
  function svgToCanvas(svg, scale) {
    scale = scale || 2;
    return new Promise(function (resolve, reject) {
      var vb = (svg.getAttribute("viewBox") || "0 0 480 280").split(/\s+/).map(Number);
      var w = vb[2] || 480, h = vb[3] || 280;
      var clone = svg.cloneNode(true);
      clone.setAttribute("width", w);
      clone.setAttribute("height", h);
      if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      var xml = new XMLSerializer().serializeToString(clone);
      var svg64 = window.btoa(unescape(encodeURIComponent(xml)));
      var settled = false;
      function settleResolve(v) { if (!settled) { settled = true; clearTimeout(guard); resolve(v); } }
      function settleReject(e) { if (!settled) { settled = true; clearTimeout(guard); reject(e); } }
      // Belt-and-suspenders: a data-URI image should decode almost instantly,
      // but if some browser quirk leaves it hanging, don't leave the caller's
      // button spinning forever with no feedback.
      var guard = setTimeout(function () { settleReject(new Error("timed out rendering the chart")); }, 8000);
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          var ctx = canvas.getContext("2d");
          if (!ctx) { settleReject(new Error("this browser can't draw to a canvas")); return; }
          ctx.fillStyle = cssVar("--surface") || "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, w, h);
          settleResolve(canvas);
        } catch (err) {
          settleReject(err);
        }
      };
      img.onerror = function () { settleReject(new Error("couldn't rasterize the chart")); };
      img.src = "data:image/svg+xml;base64," + svg64;
    });
  }

  function flashChartBtn(btn, text, isErr) {
    if (!btn) return;
    var original = btn.getAttribute("data-original-label");
    if (original == null) { original = btn.textContent; btn.setAttribute("data-original-label", original); }
    btn.textContent = text;
    btn.style.color = isErr ? cssVar("--st-delayed") : cssVar("--st-completed");
    setTimeout(function () { btn.textContent = original; btn.style.color = ""; }, 1600);
  }

  function copyChartAsImage(svg, btn) {
    svgToCanvas(svg, 2).then(function (canvas) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error("couldn't render the image")); return; }
          if (navigator.clipboard && window.ClipboardItem) {
            navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]).then(resolve).catch(reject);
          } else {
            reject(new Error("clipboard image copy isn't supported in this browser"));
          }
        }, "image/png");
      });
    }).then(function () {
      flashChartBtn(btn, "✓", false);
    }).catch(function (err) {
      flashChartBtn(btn, "✕", true);
      window.alert("Couldn't copy the chart as an image (" + err.message + "). Your browser or connection may not support clipboard image copy — this needs a modern browser over HTTPS (GitHub Pages serves over HTTPS, so this should work on the live site).");
    });
  }

  function exportAllChartsPDF(btn) {
    var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) {
      window.alert("The PDF library hasn't finished loading — check your internet connection and try again in a moment.");
      return;
    }
    var charts = [
      { svg: els.chartMonth, title: "Activities by Month" },
      { svg: els.chartStatus, title: "Activities by Status" },
      { svg: els.chartCategory, title: "Activities by Category" },
      { svg: els.chartPlannedActual, title: "Planned vs. Actual" }
    ];
    Promise.all(charts.map(function (c) {
      return svgToCanvas(c.svg, 2).then(function (canvas) { return { title: c.title, canvas: canvas }; });
    })).then(function (results) {
      var doc = new jsPDFCtor({ orientation: "landscape", unit: "pt", format: "a4" });
      var pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
      var margin = 36;
      results.forEach(function (r, i) {
        if (i > 0) doc.addPage();
        doc.setFontSize(16);
        doc.text(r.title, margin, margin);
        var imgData = r.canvas.toDataURL("image/png");
        var maxW = pageW - margin * 2, maxH = pageH - margin * 2 - 24;
        var ratio = Math.min(maxW / r.canvas.width, maxH / r.canvas.height, 1);
        var w = r.canvas.width * ratio, h = r.canvas.height * ratio;
        doc.addImage(imgData, "PNG", margin, margin + 16, w, h);
      });
      doc.save("nqemt2_dashboard_charts.pdf");
      if (btn) flashChartBtn(btn, "✓ Saved", false);
    }).catch(function (err) {
      if (btn) flashChartBtn(btn, "✕ Failed", true);
      window.alert("Couldn't generate the PDF: " + err.message);
    });
  }

  function wireChartActions() {
    document.querySelectorAll("button[data-chart-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var svg = document.getElementById(btn.getAttribute("data-chart"));
        var action = btn.getAttribute("data-chart-action");
        if (!svg) return;
        if (action === "copy") copyChartAsImage(svg, btn);
        else if (action === "csv") exportChartCSV(svg.id);
      });
    });
    if (els.exportAllChartsBtn) {
      els.exportAllChartsBtn.addEventListener("click", function () { exportAllChartsPDF(els.exportAllChartsBtn); });
    }
  }

  function wireDashFilters() {
    ["dfYear", "dfMonth", "dfCategory", "dfResponsible", "dfStatus"].forEach(function (id) {
      els[id].addEventListener("change", function () {
        state.dash.year = els.dfYear.value;
        state.dash.month = els.dfMonth.value;
        state.dash.category = els.dfCategory.value;
        state.dash.responsible = els.dfResponsible.value;
        state.dash.status = els.dfStatus.value;
        renderDashboard();
      });
    });
    els.dfReset.addEventListener("click", function () {
      state.dash = { year: "", month: "", category: "", responsible: "", status: "" };
      renderDashboard();
    });
    for (var mm = 1; mm <= 12; mm++) {
      var o = document.createElement("option"); o.value = mm; o.textContent = MONTH_ABBR[mm - 1];
      els.dfMonth.appendChild(o);
    }
  }

  // =========================================================================
  // Shared: delay summary + timeline legend (used by Dashboard and Timeline)
  // =========================================================================
  function renderDelaySummary(list, targetEl, yearLabel) {
    if (!targetEl) return;
    var today = todayLocal();
    var infos = list.map(function (d) { return computeDelayInfo(d, today); });
    var total = list.length;
    var completed = infos.filter(function (i) { return i.code === "completed" || i.code === "completed-delayed"; }).length;
    var upcoming = infos.filter(function (i) { return i.code === "upcoming"; }).length;
    var onTime = infos.filter(function (i) { return i.code === "ontime"; }).length;
    var delayed = infos.filter(function (i) { return i.code === "delayed"; }).length;
    var rescheduled = infos.filter(function (i) { return i.code === "rescheduled"; }).length;
    var totalDelayDays = infos.reduce(function (sum, i) { return sum + (i.delayDays > 0 ? i.delayDays : 0); }, 0);
    var totalDelayWeeks = Math.round((totalDelayDays / 7) * 10) / 10;
    var cards = [
      ["Total activities", total, ""],
      ["Completed", completed, "completed"],
      ["Upcoming", upcoming, "upcoming"],
      ["On time", onTime, "planned"],
      ["Delayed", delayed, "delayed"],
      ["Rescheduled", rescheduled, "other"],
      ["Total delay", total ? (totalDelayDays + "d (~" + totalDelayWeeks + " wk)") : "—", "delayed"]
    ];
    targetEl.innerHTML = '<div class="ds-title">Delay summary' + (yearLabel ? " — " + escapeHtml(String(yearLabel)) : "") + '</div><div class="ds-grid">' +
      cards.map(function (c) {
        return '<div class="ds-card' + (c[2] ? " ds-" + c[2] : "") + '"><div class="ds-n">' + c[1] + '</div><div class="ds-l">' + c[0] + '</div></div>';
      }).join("") + '</div>';
  }

  function renderTimelineLegend(targetEl) {
    if (!targetEl) return;
    var items = [
      ["Planned period", "solid"],
      ["Actual period (when different)", "actual"],
      ["Upcoming", "--st-upcoming"],
      ["Delayed ⚠", "--st-delayed"],
      ["Completed ✓", "--st-completed"],
      ["Rescheduled ↺", "--cat-other"]
    ];
    targetEl.innerHTML = items.map(function (it) {
      if (it[1] === "solid") return '<span class="sw"><span class="dot tl-swatch"></span>' + it[0] + '</span>';
      if (it[1] === "actual") return '<span class="sw"><span class="dot tl-swatch tl-swatch-actual"></span>' + it[0] + '</span>';
      return '<span class="sw"><span class="dot" style="background:' + cssVar(it[1]) + '"></span>' + it[0] + '</span>';
    }).join("");
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
    var today = todayLocal();
    var pageSize = state.act.pageSize;
    var totalPages = Math.max(1, Math.ceil(full.length / pageSize));
    if (state.act.page > totalPages) state.act.page = totalPages;
    if (state.act.page < 1) state.act.page = 1;
    var startIdx = (state.act.page - 1) * pageSize;
    var pageItems = full.slice(startIdx, startIdx + pageSize);

    els.rowCount.textContent = full.length + " of " + state.docs.length + " activities";
    els.tableBody.innerHTML = pageItems.map(function (d) {
      var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
      var info = computeDelayInfo(d, today);
      var delayText = info.label + (info.delayDays > 0 ? " (" + info.delayDays + "d)" : (info.delayDays < 0 ? " (" + Math.abs(info.delayDays) + "d early)" : ""));
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
      var today = todayLocal();
      var list = getFilteredSortedActivities();
      var header = ["Activity ID", "Activity", "Category", "Responsible Person", "Supporting Team", "Priority", "Planned Start", "Planned End", "Actual Start", "Actual End", "Status", "Delay Status", "Delay (days)", "Remarks"];
      var rows = list.map(function (d) {
        var info = computeDelayInfo(d, today);
        return [d.id, d.activity, d.category, d.responsiblePerson || "", d.supportingTeam || "", d.priority, d.startDate, d.endDate, d.actualStart || "", d.actualEnd || "", d.status, info.label, info.delayDays, d.notes || ""].map(csvEscape).join(",");
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
  // Timeline (year toggle + Gantt-style bars + week scale)
  // =========================================================================
  function renderYearToggleTimeline() {
    var years = uniqueSorted(state.docs, function (d) { return d.year; });
    if (years.indexOf(state.timelineYear) === -1 && years.length) state.timelineYear = years[years.length - 1];
    els.yearToggle.innerHTML = "";
    years.forEach(function (y) {
      var b = document.createElement("button");
      b.textContent = y;
      b.className = (y === state.timelineYear) ? "active" : "";
      b.addEventListener("click", function () { state.timelineYear = y; renderYearToggleTimeline(); renderTimeline(); });
      els.yearToggle.appendChild(b);
    });
  }

  function renderTimeline() {
    var yearDocs = state.docs.filter(function (d) { return d.year === state.timelineYear; });
    els.timelineHint.textContent = "Day-by-day view for " + state.timelineYear + " — click a bar to jump to it in the Activities table. Week rows show the calendar week each activity falls in.";
    if (!yearDocs.length) {
      els.timelineBody.innerHTML = '<div class="tl-empty">No activities for ' + state.timelineYear + ' yet.</div>';
      renderTimelineLegend(els.timelineLegend);
      renderDelaySummary(yearDocs, els.delaySummary, state.timelineYear);
      return;
    }
    var today = todayLocal();
    var LANE_H = 34; // px per lane row — matches the old single-lane track height, so a month with only one activity at a time looks unchanged.
    var html = "";
    for (var m = 1; m <= 12; m++) {
      var dim = daysInMonth(state.timelineYear, m);
      var monthDocs = yearDocs.filter(function (d) { return d.month === m; });

      // Sort by planned start day, then planned end day, and greedily pack
      // overlapping activities into separate lanes so bars never cover
      // each other — non-overlapping activities still share a lane.
      var items = monthDocs.map(function (d) {
        var sd = Math.min(d.startDay || 1, dim), ed = Math.min(d.endDay || sd, dim);
        if (ed < sd) ed = sd;
        return { doc: d, start: sd, end: ed };
      }).sort(function (a, b) { return (a.start - b.start) || (a.end - b.end); });
      var laneCount = assignLanes(items);
      var trackHeight = laneCount * LANE_H;

      var bars = items.map(function (it) {
        var d = it.doc, sd = it.start, ed = it.end;
        var top = it.lane * LANE_H;
        var left = ((sd - 1) / dim * 100).toFixed(2), width = Math.max(((ed - sd + 1) / dim * 100), 2.2).toFixed(2);
        var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
        var info = computeDelayInfo(d, today);
        var icon = info.code === "delayed" ? "⚠" : info.code === "rescheduled" ? "↺" : info.code === "completed-delayed" ? "⚑" : "";
        var iconHtml = icon ? '<span class="dly-ico" aria-hidden="true">' + icon + '</span> ' : "";

        var tip = escapeHtml(d.activity) +
          "\nResponsible Person: " + escapeHtml(d.responsiblePerson || "—") +
          "\nPlanned Start: " + prettyDate(d.startDate) +
          "\nPlanned End: " + prettyDate(d.endDate) +
          "\nActual Start: " + (d.actualStart ? prettyDate(d.actualStart) : "—") +
          "\nActual End: " + (d.actualEnd ? prettyDate(d.actualEnd) : "—") +
          "\nStatus: " + escapeHtml(d.status) + " (" + info.label + ")" +
          "\nDelay Days: " + (info.delayDays > 0 ? info.delayDays : 0);

        var plannedBar = '<div class="bar ' + statusClass(d.status) + ' code-' + info.code + '" data-row="row-' + d.id + '" tabindex="0" role="button" ' +
          'style="left:' + left + '%; width:' + width + '%; top:' + (top + 2) + 'px; background-color:' + groupColor(g) + ';" ' +
          'title="' + tip + '">' + iconHtml + escapeHtml(d.activity) + '</div>';

        var actualBar = "";
        if (info.code === "completed-delayed" || info.code === "rescheduled") {
          var aStartDate = parseDateLocal(d.actualStart), aEndDate = parseDateLocal(d.actualEnd);
          var asdDate = aStartDate || aEndDate, aedDate = aEndDate || aStartDate;
          if (asdDate && asdDate.getFullYear() === state.timelineYear && (asdDate.getMonth() + 1) === m) {
            var asd = asdDate.getDate();
            var aed = (aedDate.getFullYear() === state.timelineYear && (aedDate.getMonth() + 1) === m) ? Math.min(aedDate.getDate(), dim) : dim;
            var aLeft = ((asd - 1) / dim * 100).toFixed(2), aWidth = Math.max(((aed - asd + 1) / dim * 100), 2.2).toFixed(2);
            actualBar = '<div class="bar-actual code-' + info.code + '" data-row="row-' + d.id + '" ' +
              'style="left:' + aLeft + '%; width:' + aWidth + '%; top:' + (top + 20) + 'px; background-color:' + cssVar("--tl-actual") + ';" title="' + tip + '"></div>';
          }
        }
        return plannedBar + actualBar;
      }).join("");

      var weeks = weekSegmentsForMonth(state.timelineYear, m, dim).map(function (w) {
        var left = ((w.startDay - 1) / dim * 100).toFixed(2), width = ((w.endDay - w.startDay + 1) / dim * 100).toFixed(2);
        var range = MONTH_ABBR[m - 1] + " " + w.startDay + "–" + w.endDay;
        return '<div class="tl-wk" style="left:' + left + '%; width:' + width + '%;" title="Week ' + w.weekNum + ": " + range + ", " + state.timelineYear + '">W' + w.weekNum + '</div>';
      }).join("");

      html += '<div class="tl-group">' +
        '<div class="tl-month"><div class="lbl">' + MONTH_ABBR[m - 1] + '</div><div class="tl-track" style="height:' + trackHeight + 'px;">' + (bars || "") + '</div></div>' +
        '<div class="tl-weekrow"><div class="lbl"></div><div class="tl-weekscale">' + weeks + '</div></div>' +
        '</div>';
    }
    els.timelineBody.innerHTML = '<div class="tl-scroll">' + html + '</div>';
    els.timelineBody.querySelectorAll(".bar, .bar-actual").forEach(function (b) {
      b.addEventListener("click", function () { jumpToActivity(b.getAttribute("data-row")); });
      b.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); jumpToActivity(b.getAttribute("data-row")); } });
    });
    renderTimelineLegend(els.timelineLegend);
    renderDelaySummary(yearDocs, els.delaySummary, state.timelineYear);
  }

  function jumpToActivity(rowId) {
    var id = String(rowId || "").replace(/^row-/, "");
    if (!id) return;
    setRoute("activities");
    // Jump to the page containing this id, then flash & scroll to the row.
    var idx = getFilteredSortedActivities().findIndex(function (d) { return d.id === id; });
    if (idx >= 0) { state.act.page = Math.floor(idx / state.act.pageSize) + 1; renderActivitiesTable(); }
    setTimeout(function () {
      var row = document.getElementById("row-" + id);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("hi");
      setTimeout(function () { row.classList.remove("hi"); }, 1600);
    }, 30);
  }

  // =========================================================================
  // Schedule Timeline — a separate, full-year Gantt view (its own nav item
  // and #view-schedule section). This is intentionally independent of the
  // Calendar/Timeline page above: it doesn't call, share render state with,
  // or modify anything in that section. One row per activity (no lane
  // packing needed), Jan–Dec across the top with the whole year on screen
  // via horizontal scroll, and the Activities column pinned via CSS sticky
  // positioning so it stays visible while scrolling.
  // =========================================================================
  var SCH_COL_PX = 110; // fixed px width per week column in the Gantt grid
  // Week columns are REAL Sunday–Saturday calendar weeks (the same weeks
  // you'd see on any calendar) — not an artificial even split of each
  // month's day count. Each month's week-columns are built independently and
  // CLIPPED to that month's own days: if the month doesn't start on a Sunday
  // or end on a Saturday, its first and/or last column is a partial week
  // (fewer than 7 real days). This guarantees a date always renders under
  // its own real month's header — never under the neighboring month, the
  // way a "majority of the week" rule could. Internal (non-boundary) weeks
  // within a month are still full, real 7-day calendar weeks (e.g. Jan
  // 11–17 stays one whole-week column), matching a normal wall calendar.
  // The pixel-per-day rate is always SCH_COL_PX / 7, even inside a partial
  // boundary segment, so "2 Days" always spans the same width regardless of
  // which segment it falls in.
  function scheduleMonthWeekSegments(year, month) {
    var dim = daysInMonth(year, month);
    var firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun..6=Sat
    var segs = [], day = 1;
    var firstLen = Math.min(7 - firstDow, dim);
    segs.push({ startDay: day, endDay: day + firstLen - 1 });
    day += firstLen;
    while (day <= dim) {
      var len = Math.min(7, dim - day + 1);
      segs.push({ startDay: day, endDay: day + len - 1 });
      day += len;
    }
    return segs;
  }
  function buildScheduleLayout(year) {
    var monthStartCol = [], segsByMonth = [], col = 0;
    for (var m = 1; m <= 12; m++) {
      var segs = scheduleMonthWeekSegments(year, m);
      monthStartCol[m] = col;
      segsByMonth[m] = segs;
      col += segs.length;
    }
    return { totalCols: col, monthStartCol: monthStartCol, segsByMonth: segsByMonth };
  }
  // Measures how wide a Schedule Timeline bar's label needs to be so it
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
  // Position (in px) of a given real date within the full-year grid.
  // endInclusive:false -> the leading edge of that day (bar start);
  // endInclusive:true  -> the trailing edge of that day (bar end, so the
  // whole day is included in the bar's width). The pixel-per-day rate is
  // always SCH_COL_PX / 7 (using the date's real day-of-week, 0=Sun..6=Sat)
  // even when the date falls in a partial (boundary) week-segment — only
  // the segment's own column width on screen is narrower; the date-to-px
  // rate itself never changes.
  function schedulePx(layout, date, endInclusive) {
    var month = date.getMonth() + 1, day = date.getDate();
    var segs = layout.segsByMonth[month];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (day >= s.startDay && day <= s.endDay) {
        var dow = date.getDay(); // 0 (Sun) .. 6 (Sat) — position within the real week
        var offset = endInclusive ? dow + 1 : dow;
        return (layout.monthStartCol[month] + i + offset / 7) * SCH_COL_PX;
      }
    }
    // Shouldn't occur once clamped to the displayed year, but fail safe to
    // the end of that month's columns.
    return (layout.monthStartCol[month] + segs.length) * SCH_COL_PX;
  }
  // Clamps a date onto the displayed year's grid (for activities that start
  // before or end after the year shown) — returns an in-range Date.
  function scheduleClamp(date, year, which) {
    if (!date) return which === "end" ? new Date(year, 11, 31) : new Date(year, 0, 1);
    var y = date.getFullYear();
    if (y < year) return new Date(year, 0, 1);
    if (y > year) return new Date(year, 11, 31);
    return date;
  }
  function scheduleDocOverlapsYear(d, year) {
    var s = parseDateLocal(d.startDate), e = parseDateLocal(d.endDate) || s;
    if (!s) return d.year === year;
    var endY = e ? e.getFullYear() : s.getFullYear();
    return s.getFullYear() <= year && endY >= year;
  }

  function populateScheduleFilterOptions() {
    var years = uniqueSorted(state.docs, function (d) { return d.year; });
    if (!state.sch.year || years.indexOf(state.sch.year) === -1) {
      state.sch.year = years.length ? years[years.length - 1] : new Date().getFullYear();
    }
    var cats = uniqueSorted(state.docs, function (d) { return d.category; });
    var people = uniqueSorted(state.docs, function (d) { return d.responsiblePerson; });
    els.schYear.innerHTML = years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join("");
    els.schYear.value = state.sch.year;
    els.schCategory.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join("");
    els.schResponsible.innerHTML = '<option value="">All responsible people</option>' + people.map(function (p) { return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>'; }).join("");
    els.schStatus.innerHTML = '<option value="">All statuses</option>' + STATUS_LIST.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join("");
    els.schCategory.value = state.sch.category || "";
    els.schResponsible.value = state.sch.responsible || "";
    els.schStatus.value = state.sch.status || "";
    els.schMonth.value = state.sch.month || "";
  }

  function getScheduleDocs() {
    var f = state.sch, year = state.sch.year;
    return state.docs.filter(function (d) {
      if (!scheduleDocOverlapsYear(d, year)) return false;
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

  function renderScheduleTimeline() {
    var year = state.sch.year;
    var list = getScheduleDocs();
    els.scheduleHint.textContent = "Full-year Gantt for " + year + " — " + list.length + " of " + state.docs.length +
      " activities shown. Scroll sideways to see the whole year; the Activities column stays put. Click a bar for details.";
    var layout = buildScheduleLayout(year);
    var today = todayLocal();

    var monthHeaderHtml = "", weekHeaderHtml = "";
    for (var m = 1; m <= 12; m++) {
      var weeks = layout.segsByMonth[m];
      var altCls = (m % 2 === 0) ? " sch-alt" : "";
      monthHeaderHtml += '<th class="sch-month-h' + altCls + '" colspan="' + weeks.length + '">' + MONTH_ABBR[m - 1] + '</th>';
      weeks.forEach(function (w, i) {
        weekHeaderHtml += '<th class="sch-week-h' + altCls + '" style="width:' + SCH_COL_PX + 'px; min-width:' + SCH_COL_PX + 'px;">W' + (i + 1) + '</th>';
      });
    }
    var gridWidth = layout.totalCols * SCH_COL_PX;

    var rowsHtml = list.map(function (d) {
      var info = computeDelayInfo(d, today);
      var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
      var pStart = parseDateLocal(d.startDate), pEnd = parseDateLocal(d.endDate) || pStart;
      var cs = scheduleClamp(pStart, year, "start"), ce = scheduleClamp(pEnd, year, "end");
      var left = schedulePx(layout, cs, false);
      var right = schedulePx(layout, ce, true);

      var icon = info.code === "delayed" ? "⚠" : info.code === "rescheduled" ? "↺" :
        info.code === "completed-delayed" ? "⚑" : info.code === "completed" ? "✓" :
        info.code === "cancelled" ? "🚫" : "";
      var delayText = info.label + (info.delayDays > 0 ? " (" + info.delayDays + "d)" : (info.delayDays < 0 ? " (" + Math.abs(info.delayDays) + "d early)" : ""));
      // Budget days = the full length of the planned (budget) period, Planned
      // Start through Planned End inclusive — independent of the current
      // year's clamped bar position, so it's correct even when the bar is
      // cut off at the edge of the visible year.
      var budgetDays = (pStart && pEnd) ? (diffDays(pEnd, pStart) + 1) : null;
      var budgetDaysLabel = budgetDays != null ? (budgetDays + (budgetDays === 1 ? " Day" : " Days")) : "—";
      // The bar's LEFT edge always sits exactly at the Planned Start date —
      // that never moves. Its width is the real date span whenever that's
      // already enough to hold the label; only when the true duration is too
      // narrow to fit "N Days" does the right edge extend slightly further,
      // just enough for the text (never across whole extra weeks) — so a
      // short activity's bar still starts and reads at the correct place on
      // the grid, it's simply not clipped to unreadable width.
      var trueWidth = right - left;
      var minTextWidth = schBarMinWidth(budgetDaysLabel, !!icon);
      var width = Math.max(trueWidth, minTextWidth);
      var tip = escapeHtml(d.activity) +
        "\nResponsible Person: " + escapeHtml(d.responsiblePerson || "—") +
        "\nCategory: " + escapeHtml(d.category || "—") +
        "\nPlanned: " + prettyDate(d.startDate) + " – " + prettyDate(d.endDate) + (budgetDays != null ? " (" + budgetDaysLabel + ")" : "") +
        "\nActual: " + (d.actualStart || d.actualEnd ? (prettyDate(d.actualStart) + " – " + prettyDate(d.actualEnd)) : "—") +
        "\nStatus: " + escapeHtml(d.status) +
        "\nDelay Days: " + (info.delayDays > 0 ? info.delayDays : 0);

      var plannedBar = '<div class="sch-bar code-' + info.code + '" data-id="' + d.id + '" tabindex="0" role="button" ' +
        'style="left:' + left.toFixed(1) + 'px; width:' + width.toFixed(1) + 'px; background-color:' + groupColor(g) + ';" title="' + tip + '">' +
        (icon ? '<span class="dly-ico">' + icon + '</span> ' : '') + escapeHtml(budgetDaysLabel) + '</div>';

      var actualBar = "";
      var aStart = parseDateLocal(d.actualStart), aEnd = parseDateLocal(d.actualEnd);
      if (aStart || aEnd) {
        var as = aStart || aEnd, ae = aEnd || aStart;
        var acs = scheduleClamp(as, year, "start"), ace = scheduleClamp(ae, year, "end");
        var aLeft = schedulePx(layout, acs, false);
        var aRight = schedulePx(layout, ace, true);
        var aWidth = Math.max(aRight - aLeft, 6);
        actualBar = '<div class="sch-bar-actual code-' + info.code + '" data-id="' + d.id + '" tabindex="0" role="button" ' +
          'style="left:' + aLeft.toFixed(1) + 'px; width:' + aWidth.toFixed(1) + 'px; background-color:' + cssVar("--tl-actual") + ';" title="' + tip + '"></div>';
      }

      return '<tr>' +
        '<td class="sch-activity-cell">' +
          '<div class="sch-name" title="' + escapeHtml(d.activity) + '">' + escapeHtml(d.activity) + '</div>' +
          '<div class="sch-category" title="Budget category: ' + escapeHtml(d.category || "—") + '">' + escapeHtml(d.category || "—") + '</div>' +
          '<div class="sch-dates" title="Budget period: ' + escapeHtml(fmtRange(d.startDate, d.endDate)) + '">' + escapeHtml(fmtRange(d.startDate, d.endDate)) + '</div>' +
          '<div class="sch-chips">' +
            '<span class="cat-chip">' + escapeHtml(d.status) + '</span>' +
            '<span class="delay-chip dc-' + info.code + '">' + escapeHtml(delayText) + '</span>' +
          '</div>' +
        '</td>' +
        '<td class="sch-bar-cell" colspan="' + layout.totalCols + '">' +
          '<div class="sch-bar-track" style="width:' + gridWidth + 'px; background-size:' + SCH_COL_PX + 'px 100%;">' + plannedBar + actualBar + '</div>' +
        '</td>' +
        '</tr>';
    }).join("");

    if (!list.length) {
      rowsHtml = '<tr><td class="sch-activity-cell" colspan="' + (layout.totalCols + 1) + '" style="text-align:center; color:var(--muted); padding:20px;">No activities match the current filters for ' + year + '.</td></tr>';
    }

    els.scheduleOuter.innerHTML =
      '<table class="sch-table">' +
        '<thead>' +
          '<tr><th class="sch-corner" rowspan="2">Activities</th>' + monthHeaderHtml + '</tr>' +
          '<tr>' + weekHeaderHtml + '</tr>' +
        '</thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>';

    els.scheduleOuter.querySelectorAll(".sch-bar, .sch-bar-actual").forEach(function (b) {
      b.addEventListener("click", function () { viewActivityRow(b.getAttribute("data-id")); });
      b.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); viewActivityRow(b.getAttribute("data-id")); } });
    });

    renderTimelineLegend(els.scheduleLegend);
    renderDelaySummary(list, els.scheduleDelaySummary, String(year));
  }

  function wireScheduleFilters() {
    for (var mm = 1; mm <= 12; mm++) {
      var o = document.createElement("option"); o.value = mm; o.textContent = MONTH_ABBR[mm - 1];
      els.schMonth.appendChild(o);
    }
    ["schYear", "schMonth", "schCategory", "schResponsible", "schStatus"].forEach(function (id) {
      els[id].addEventListener("change", function () {
        state.sch.year = parseInt(els.schYear.value, 10) || state.sch.year;
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
  }

  // =========================================================================
  // Add / Edit / Duplicate form
  // =========================================================================
  function populateFormStaticOptions() {
    els.fStatus.innerHTML = STATUS_LIST.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join("");
  }
  function populateFormDatalists() {
    var catNames = uniqueSorted(state.categories, function (c) { return c.name; });
    uniqueSorted(state.docs, function (d) { return d.category; }).forEach(function (c) { if (catNames.indexOf(c) === -1) catNames.push(c); });
    catNames.sort();
    els.categoryList.innerHTML = catNames.map(function (c) { return '<option value="' + escapeHtml(c) + '">'; }).join("");
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
    els.fDelayOverride.value = d.delayOverrideDays === "" || d.delayOverrideDays == null ? "" : d.delayOverrideDays;
    els.fRemarks.value = d.notes || "";
  }
  function editActivityRow(id) {
    var d = state.docs.find(function (x) { return x.id === id; });
    if (!d) return;
    resetForm();
    state.editingId = id;
    els.idField.hidden = false;
    els.fId.value = d.id;
    fillForm(d);
    els.addFormTitle.textContent = "Edit activity #" + d.id;
    els.addFormHint.textContent = "Editing an existing activity — changes save back to the Google Sheet.";
    els.formSubmitBtn.textContent = "Save changes";
    els.formCancelBtn.hidden = false;
    populateFormDatalists();
    setRoute("add");
  }
  function duplicateActivityRow(id) {
    var d = state.docs.find(function (x) { return x.id === id; });
    if (!d) return;
    resetForm();
    state.duplicating = true;
    fillForm(Object.assign({}, d, { status: "Planned", actualStart: "", actualEnd: "", delayOverrideDays: "" }));
    els.fName.value = (d.activity || "") + " (copy)";
    els.addFormTitle.textContent = "Duplicate activity #" + d.id;
    els.addFormHint.textContent = "Review the details below, then save to create a new activity — the original is untouched.";
    populateFormDatalists();
    setRoute("add");
  }
  function cancelEdit() { resetForm(); setRoute(state.docs.length ? "activities" : "dashboard"); }

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
    var year = ps.getFullYear(), month = ps.getMonth() + 1, monthName = MONTH_ABBR[ps.getMonth()];
    var startDay = ps.getDate();
    var sameMonth = pe.getFullYear() === year && (pe.getMonth() + 1) === month;
    var endDay = sameMonth ? pe.getDate() : daysInMonth(year, month);
    var crossMonthNote = sameMonth ? "" : " (Note: the timeline draws each activity within a single month, so the bar is shown through the end of its start month — the full planned end date is still saved and shown everywhere else.)";

    var fields = {
      activity: name,
      description: els.fDescription.value.trim(),
      category: category,
      categoryGroup: categorizeToGroup(category),
      responsiblePerson: els.fResponsible.value.trim(),
      supportingTeam: els.fSupporting.value.trim(),
      priority: els.fPriority.value,
      status: els.fStatus.value,
      year: year, month: month, monthName: monthName,
      startDate: psRaw, endDate: peRaw, startDay: startDay, endDay: endDay,
      actualStart: asRaw, actualEnd: aeRaw,
      delayOverrideDays: els.fDelayOverride.value === "" ? "" : Number(els.fDelayOverride.value),
      notes: els.fRemarks.value.trim()
    };

    els.formSubmitBtn.disabled = true;
    if (state.editingId) {
      var id = state.editingId;
      updateActivity(id, fields).then(function (updated) {
        var idx = state.docs.findIndex(function (d) { return d.id === id; });
        if (idx >= 0) state.docs[idx] = Object.assign({}, state.docs[idx], updated, { id: id });
        showFormMsg("Activity #" + id + " updated." + crossMonthNote, "ok");
        renderAll();
        setTimeout(function () { cancelEdit(); }, 700);
      }).catch(function (err) { showFormMsg("Couldn't save: " + err.message, "err"); }).finally(function () { els.formSubmitBtn.disabled = false; });
    } else {
      createActivity(fields).then(function (created) {
        state.docs.push(created);
        showFormMsg("Activity #" + created.id + " added." + crossMonthNote, "ok");
        resetForm();
        renderAll();
      }).catch(function (err) { showFormMsg("Couldn't save: " + err.message, "err"); }).finally(function () { els.formSubmitBtn.disabled = false; });
    }
  }

  function deleteActivityRow(id) {
    if (!window.confirm("Delete this activity? This cannot be undone.")) return;
    deleteActivityRemote(id).then(function () {
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
    var info = computeDelayInfo(d, todayLocal());
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
      ["Delay", escapeHtml(info.label) + (info.delayDays > 0 ? " (" + info.delayDays + "d)" : "")],
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
  }
  function renderSettings() {
    els.settingsDataSource.textContent = usingLiveApi ? "Connected to your Google Sheet via Apps Script." : "Running in demo mode on a bundled sample — set API_URL in config.js to go live.";
    els.settingsCount.textContent = state.docs.length + " activities loaded.";
    if (typeof SHEET_URL === "string" && SHEET_URL.indexOf("http") === 0) els.openSheetBtn.href = SHEET_URL;
    else els.openSheetBtn.hidden = true;
  }

  // =========================================================================
  // Boot
  // =========================================================================
  function renderAll() {
    renderDashboard();
    renderActivitiesTable();
    renderCategoriesTable();
    renderYearToggleTimeline();
    renderTimeline();
    populateScheduleFilterOptions();
    renderScheduleTimeline();
    populateFormDatalists();
    renderSettings();
    els.sidebarSync.textContent = usingLiveApi ? "🟢 Live (Google Sheet)" : "🟡 Demo mode";
  }

  function fetchLiveCategories() {
    var url = API_URL + (API_URL.indexOf("?") === -1 ? "?" : "&") + "sheet=categories";
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (res) { return (res && res.ok && Array.isArray(res.categories)) ? res.categories : []; })
      .catch(function () { return []; }); // best-effort — an older deployment or missing tab just starts with no categories
  }

  function boot() {
    cacheEls();
    wireNav();
    wireDashFilters();
    wireChartActions();
    wireActivitiesControls();
    wireCategoriesControls();
    wireScheduleFilters();
    wireModal();
    wireSettings();
    populateFormStaticOptions();
    els.activityForm.addEventListener("submit", handleFormSubmit);
    els.formCancelBtn.addEventListener("click", cancelEdit);

    function finishBoot(docs, cats) {
      state.docs = docs.map(normalizeDoc);
      state.categories = (cats || []).map(normalizeCategory);
      var years = uniqueSorted(state.docs, function (d) { return d.year; });
      if (years.length) { state.timelineYear = years[years.length - 1]; state.dash.year = String(state.timelineYear); state.sch.year = state.timelineYear; }
      renderAll();
      setRoute("dashboard");
    }

    if (!usingLiveApi) {
      els.syncBanner.hidden = false;
      els.syncBanner.textContent = "Running in demo mode on a bundled sample — edits won't be saved. Set API_URL in config.js to your deployed Apps Script URL to go live.";
      finishBoot(JSON.parse(JSON.stringify(SAMPLE_ACTIVITIES)), typeof SAMPLE_CATEGORIES !== "undefined" ? JSON.parse(JSON.stringify(SAMPLE_CATEGORIES)) : []);
      return;
    }
    fetch(API_URL)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || !Array.isArray(res.activities)) throw new Error("bad response");
        els.syncBanner.hidden = true;
        return fetchLiveCategories().then(function (cats) { finishBoot(res.activities, cats); });
      })
      .catch(function (err) {
        els.syncBanner.hidden = false;
        els.syncBanner.textContent = "Couldn't reach the Apps Script API (" + err.message + "). Showing the bundled sample instead.";
        finishBoot(JSON.parse(JSON.stringify(SAMPLE_ACTIVITIES)), typeof SAMPLE_CATEGORIES !== "undefined" ? JSON.parse(JSON.stringify(SAMPLE_CATEGORIES)) : []);
      });
  }

  boot();
})();
