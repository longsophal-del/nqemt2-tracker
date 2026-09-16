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
    timeline: "Calendar / Timeline",
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

  // =========================================================================
  // Auto-computed delay engine
  // =========================================================================
  // Returns {code, label, delayDays} — delayDays > 0 means late. `code` is
  // one of: ontime | delayed | completed | completed-delayed | rescheduled | cancelled.
  function computeDelayInfo(d, today) {
    if (d.status === "Cancelled") return { code: "cancelled", label: DELAY_INFO.cancelled.label, delayDays: 0 };

    // Manual override escape hatch — the only way delay days can be typed
    // directly, per spec ("do not allow users to manually type the delay
    // unless there is a specific override field").
    if (d.delayOverrideDays !== "" && d.delayOverrideDays != null && !isNaN(Number(d.delayOverrideDays))) {
      var ov = Number(d.delayOverrideDays);
      if (ov <= 0) {
        var doneOv = !!(d.actualEnd || d.status === "Completed");
        return { code: doneOv ? "completed" : "ontime", label: doneOv ? DELAY_INFO.completed.label : DELAY_INFO.ontime.label, delayDays: 0 };
      }
      var lateOv = !!(d.actualEnd || d.status === "Completed");
      return { code: lateOv ? "completed-delayed" : "delayed", label: lateOv ? DELAY_INFO["completed-delayed"].label : DELAY_INFO.delayed.label, delayDays: ov };
    }

    var pStart = parseDateLocal(d.startDate), pEnd = parseDateLocal(d.endDate);
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
      if (today.getTime() > pEnd.getTime()) return { code: "delayed", label: DELAY_INFO.delayed.label, delayDays: diffDays(today, pEnd) };
      return { code: "ontime", label: DELAY_INFO.ontime.label, delayDays: 0 };
    }
    if (d.status === "Completed") return { code: "completed", label: DELAY_INFO.completed.label, delayDays: 0 };
    if (today.getTime() > pEnd.getTime()) return { code: "delayed", label: DELAY_INFO.delayed.label, delayDays: diffDays(today, pEnd) };
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
    route: "dashboard",
    timelineYear: 2026,
    dash: { year: "", month: "", category: "", responsible: "", status: "" },
    act: { search: "", year: "", category: "", responsible: "", status: "", sortKey: "start", sortDir: "asc", page: 1, pageSize: 25 },
    editingId: null,
    duplicating: false
  };

  var els = {};
  function cacheEls() {
    [
      "sidebar", "sidebarBackdrop", "hamburgerBtn", "mainNav", "routeTitle", "exportBtn", "syncBanner", "sidebarSync",
      "dfYear", "dfMonth", "dfCategory", "dfResponsible", "dfStatus", "dfReset", "kpiGrid",
      "chartMonth", "chartMonthLegend", "chartStatus", "chartCategory", "chartPlannedActual", "chartPlannedActualLegend",
      "dashDelaySummary",
      "searchInput", "filterYear", "filterCategory", "filterResponsible", "filterStatus", "rowCount", "tableBody", "pagination",
      "yearToggle", "timelineHint", "timelineBody", "timelineLegend", "delaySummary",
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
    else if (route === "timeline") { renderYearToggleTimeline(); renderTimeline(); }
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

  function renderChartMonth(list) {
    var svg = els.chartMonth;
    if (!list.length) { emptyChart(svg, "No activities match the current filters.", "0 0 960 320"); els.chartMonthLegend.innerHTML = ""; return; }
    var counts = [];
    for (var m = 0; m < 12; m++) { counts.push({}); CATEGORY_GROUPS.forEach(function (g) { counts[m][g] = 0; }); }
    list.forEach(function (d) {
      var m2 = (d.month || 1) - 1;
      if (m2 < 0 || m2 > 11) return;
      var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
      counts[m2][g] = (counts[m2][g] || 0) + 1;
    });
    var totals = counts.map(function (c) { return CATEGORY_GROUPS.reduce(function (s, g) { return s + c[g]; }, 0); });
    var maxTotal = Math.max(1, Math.max.apply(null, totals));
    var W = 960, H = 320, padL = 34, padR = 10, padT = 14, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var colW = plotW / 12, barW = colW * 0.6;
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var val = Math.ceil(maxTotal * i / ticks);
      var y = padT + plotH - (plotH * i / ticks);
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: cssVar("--line"), "stroke-width": 1 }));
      var lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 10, fill: cssVar("--muted") });
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
      });
      if (totals[m3] > 0) {
        var totLbl = svgEl("text", { x: x + barW / 2, y: padT + plotH - Math.max(0, plotH * (totals[m3] / maxTotal)) - 6, "text-anchor": "middle", "font-size": 10, "font-weight": 600, fill: cssVar("--ink") });
        totLbl.textContent = totals[m3];
        svg.appendChild(totLbl);
      }
      var mLbl = svgEl("text", { x: x + barW / 2, y: H - 10, "text-anchor": "middle", "font-size": 11, fill: cssVar("--muted") });
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
    var entries = STATUS_LIST.map(function (s) {
      return { label: s, value: list.filter(function (d) { return d.status === s; }).length, color: cssVar("--st-" + statusClass(s).slice(3).toLowerCase()) || cssVar("--accent") };
    });
    // Fall back to accent color for any status whose CSS var name doesn't match exactly.
    var colorMap = { Planned: "--st-planned", "In Progress": "--st-progress", Completed: "--st-completed", Delayed: "--st-delayed", Rescheduled: "--cat-other", Cancelled: "--st-cancelled" };
    entries.forEach(function (e) { e.color = cssVar(colorMap[e.label] || "--accent"); });
    renderSingleSeriesBarChart(els.chartStatus, entries, 480, 280);
  }

  function renderChartCategory(list) {
    var cats = uniqueSorted(list, function (d) { return d.category; });
    var entries = cats.map(function (c) {
      var count = list.filter(function (d) { return d.category === c; }).length;
      var g = categorizeToGroup(c);
      var sample = list.find(function (d) { return d.category === c; });
      var group = (sample && CATEGORY_GROUPS.indexOf(sample.categoryGroup) >= 0) ? sample.categoryGroup : g;
      return { label: c, value: count, color: groupColor(group) };
    }).sort(function (a, b) { return b.value - a.value; });
    renderSingleSeriesBarChart(els.chartCategory, entries, 480, 280);
  }

  function renderChartPlannedActual(list) {
    var svg = els.chartPlannedActual;
    if (!list.length) { emptyChart(svg, "No data for the current filters.", "0 0 960 280"); els.chartPlannedActualLegend.innerHTML = ""; return; }
    var today = todayLocal();
    var planned = [], onTime = [];
    for (var m = 0; m < 12; m++) { planned.push(0); onTime.push(0); }
    list.forEach(function (d) {
      var m2 = (d.month || 1) - 1;
      if (m2 < 0 || m2 > 11) return;
      planned[m2]++;
      var info = computeDelayInfo(d, today);
      if (info.code === "ontime" || info.code === "completed") onTime[m2]++;
    });
    var W = 960, H = 280, padL = 34, padR = 10, padT = 14, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var colW = plotW / 12, barW = colW * 0.28, gap = colW * 0.06;
    var maxV = Math.max(1, Math.max.apply(null, planned));
    svg.innerHTML = "";
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    for (var i = 0; i <= 4; i++) {
      var val = Math.ceil(maxV * i / 4);
      var y = padT + plotH - (plotH * i / 4);
      svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: cssVar("--line"), "stroke-width": 1 }));
      var lbl = svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 10, fill: cssVar("--muted") });
      lbl.textContent = val; svg.appendChild(lbl);
    }
    for (var m3 = 0; m3 < 12; m3++) {
      var groupX = padL + m3 * colW + (colW - (barW * 2 + gap)) / 2;
      var hP = plotH * (planned[m3] / maxV), hA = plotH * (onTime[m3] / maxV);
      svg.appendChild(svgEl("rect", { x: groupX, y: padT + plotH - hP, width: barW, height: Math.max(hP, 0), fill: cssVar("--st-planned"), rx: 2 }));
      svg.appendChild(svgEl("rect", { x: groupX + barW + gap, y: padT + plotH - hA, width: barW, height: Math.max(hA, 0), fill: cssVar("--st-completed"), rx: 2 }));
      var mLbl = svgEl("text", { x: groupX + barW + gap / 2, y: H - 10, "text-anchor": "middle", "font-size": 11, fill: cssVar("--muted") });
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
    var onTime = infos.filter(function (i) { return i.code === "ontime"; }).length;
    var delayed = infos.filter(function (i) { return i.code === "delayed"; }).length;
    var rescheduled = infos.filter(function (i) { return i.code === "rescheduled"; }).length;
    var totalDelayDays = infos.reduce(function (sum, i) { return sum + (i.delayDays > 0 ? i.delayDays : 0); }, 0);
    var totalDelayWeeks = Math.round((totalDelayDays / 7) * 10) / 10;
    var cards = [
      ["Total activities", total, ""],
      ["Completed", completed, "completed"],
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
    var html = "";
    for (var m = 1; m <= 12; m++) {
      var dim = daysInMonth(state.timelineYear, m);
      var monthDocs = yearDocs.filter(function (d) { return d.month === m; });

      var bars = monthDocs.map(function (d) {
        var sd = Math.min(d.startDay || 1, dim), ed = Math.min(d.endDay || sd, dim);
        var left = ((sd - 1) / dim * 100).toFixed(2), width = Math.max(((ed - sd + 1) / dim * 100), 2.2).toFixed(2);
        var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
        var info = computeDelayInfo(d, today);
        var icon = info.code === "delayed" ? "⚠" : info.code === "rescheduled" ? "↺" : info.code === "completed-delayed" ? "⚑" : "";
        var iconHtml = icon ? '<span class="dly-ico" aria-hidden="true">' + icon + '</span> ' : "";

        var tip = escapeHtml(d.activity) +
          "\nCategory: " + escapeHtml(d.category) +
          "\nResponsible: " + escapeHtml(d.responsiblePerson || "—") +
          "\nPlanned: " + prettyDate(d.startDate) + " – " + prettyDate(d.endDate) +
          "\nActual: " + (d.actualStart || d.actualEnd ? prettyDate(d.actualStart) + " – " + prettyDate(d.actualEnd) : "—") +
          "\nStatus: " + escapeHtml(d.status) + " (" + info.label + ")" +
          (info.delayDays > 0 ? "\nDelay: " + info.delayDays + " day" + (info.delayDays === 1 ? "" : "s") + " (~" + Math.ceil(info.delayDays / 7) + " wk)" : "");

        var plannedBar = '<div class="bar ' + statusClass(d.status) + ' code-' + info.code + '" data-row="row-' + d.id + '" tabindex="0" role="button" ' +
          'style="left:' + left + '%; width:' + width + '%; background-color:' + groupColor(g) + ';" ' +
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
              'style="left:' + aLeft + '%; width:' + aWidth + '%; background-color:' + groupColor(g) + ';" title="' + tip + '"></div>';
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
        '<div class="tl-month"><div class="lbl">' + MONTH_ABBR[m - 1] + '</div><div class="tl-track">' + (bars || "") + '</div></div>' +
        '<div class="tl-weekrow"><div class="lbl"></div><div class="tl-weekscale">' + weeks + '</div></div>' +
        '</div>';
    }
    els.timelineBody.innerHTML = html;
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
  // Add / Edit / Duplicate form
  // =========================================================================
  function populateFormStaticOptions() {
    els.fStatus.innerHTML = STATUS_LIST.map(function (s) { return '<option value="' + s + '">' + s + '</option>'; }).join("");
  }
  function populateFormDatalists() {
    els.categoryList.innerHTML = uniqueSorted(state.docs, function (d) { return d.category; }).map(function (c) { return '<option value="' + escapeHtml(c) + '">'; }).join("");
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
    renderYearToggleTimeline();
    renderTimeline();
    populateFormDatalists();
    renderSettings();
    els.sidebarSync.textContent = usingLiveApi ? "🟢 Live (Google Sheet)" : "🟡 Demo mode";
  }

  function boot() {
    cacheEls();
    wireNav();
    wireDashFilters();
    wireActivitiesControls();
    wireModal();
    wireSettings();
    populateFormStaticOptions();
    els.activityForm.addEventListener("submit", handleFormSubmit);
    els.formCancelBtn.addEventListener("click", cancelEdit);

    function finishBoot(docs) {
      state.docs = docs.map(normalizeDoc);
      var years = uniqueSorted(state.docs, function (d) { return d.year; });
      if (years.length) { state.timelineYear = years[years.length - 1]; state.dash.year = String(state.timelineYear); }
      renderAll();
      setRoute("dashboard");
    }

    if (!usingLiveApi) {
      els.syncBanner.hidden = false;
      els.syncBanner.textContent = "Running in demo mode on a bundled sample — edits won't be saved. Set API_URL in config.js to your deployed Apps Script URL to go live.";
      finishBoot(JSON.parse(JSON.stringify(SAMPLE_ACTIVITIES)));
      return;
    }
    fetch(API_URL)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || !Array.isArray(res.activities)) throw new Error("bad response");
        els.syncBanner.hidden = true;
        finishBoot(res.activities);
      })
      .catch(function (err) {
        els.syncBanner.hidden = false;
        els.syncBanner.textContent = "Couldn't reach the Apps Script API (" + err.message + "). Showing the bundled sample instead.";
        finishBoot(JSON.parse(JSON.stringify(SAMPLE_ACTIVITIES)));
      });
  }

  boot();
})();
