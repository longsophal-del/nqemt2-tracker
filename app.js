(function () {
  "use strict";

  var CATEGORY_GROUPS = ["Training & Workshops", "QIWG", "Coaching", "Meetings & Partners", "Assessment", "Other"];
  var GROUP_COLOR_VAR = {
    "Training & Workshops": "--cat-training",
    "QIWG": "--cat-qiwg",
    "Coaching": "--cat-coaching",
    "Meetings & Partners": "--cat-meetings",
    "Assessment": "--cat-assessment",
    "Other": "--cat-other"
  };
  var STATUS_LIST = ["Planned", "In Progress", "Completed", "Delayed", "Cancelled"];
  var MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  var usingLiveApi = typeof API_URL === "string" && API_URL.indexOf("http") === 0;

  var state = {
    docs: [],
    year: 2026,
    sortKey: "start",
    sortDir: "asc",
    filters: { search: "", year: "", category: "", status: "" }
  };

  var els = {
    syncBanner: document.getElementById("syncBanner"),
    statTotal: document.getElementById("statTotal"),
    statCompleted: document.getElementById("statCompleted"),
    statProgress: document.getElementById("statProgress"),
    statPlanned: document.getElementById("statPlanned"),
    statRate: document.getElementById("statRate"),
    yearToggle: document.getElementById("yearToggle"),
    chartSvg: document.getElementById("chartSvg"),
    chartLegend: document.getElementById("chartLegend"),
    timelineBody: document.getElementById("timelineBody"),
    timelineHint: document.getElementById("timelineHint"),
    tableBody: document.getElementById("tableBody"),
    rowCount: document.getElementById("rowCount"),
    searchInput: document.getElementById("searchInput"),
    filterYear: document.getElementById("filterYear"),
    filterCategory: document.getElementById("filterCategory"),
    filterStatus: document.getElementById("filterStatus"),
    exportBtn: document.getElementById("exportBtn")
  };

  STATUS_LIST.forEach(function (s) {
    var o = document.createElement("option"); o.value = s; o.textContent = s;
    els.filterStatus.appendChild(o);
  });

  function rebuildDynamicFilterOptions() {
    var years = Array.from(new Set(state.docs.map(function (d) { return d.year; }))).sort();
    var cats = Array.from(new Set(state.docs.map(function (d) { return d.category; }))).sort();
    var curY = els.filterYear.value, curC = els.filterCategory.value;
    els.filterYear.innerHTML = '<option value="">All years</option>' + years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join("");
    els.filterCategory.innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join("");
    els.filterYear.value = curY; els.filterCategory.value = curC;
  }

  function renderStats() {
    var total = state.docs.length;
    var completed = state.docs.filter(function (d) { return d.status === "Completed"; }).length;
    var progress = state.docs.filter(function (d) { return d.status === "In Progress"; }).length;
    var planned = state.docs.filter(function (d) { return d.status === "Planned"; }).length;
    els.statTotal.textContent = total;
    els.statCompleted.textContent = completed;
    els.statProgress.textContent = progress;
    els.statPlanned.textContent = planned;
    els.statRate.textContent = total ? Math.round(100 * completed / total) + "%" : "—";
  }

  function renderYearToggle() {
    var years = Array.from(new Set(state.docs.map(function (d) { return d.year; }))).sort();
    els.yearToggle.innerHTML = "";
    years.forEach(function (y) {
      var b = document.createElement("button");
      b.textContent = y;
      b.className = (y === state.year) ? "active" : "";
      b.addEventListener("click", function () { state.year = y; renderYearToggle(); renderChart(); renderTimeline(); });
      els.yearToggle.appendChild(b);
    });
  }

  function renderChart() {
    var yearDocs = state.docs.filter(function (d) { return d.year === state.year; });
    var svg = els.chartSvg;
    svg.innerHTML = "";
    if (!yearDocs.length) {
      svg.setAttribute("viewBox", "0 0 960 60");
      var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", 480); t.setAttribute("y", 34); t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", cssVar("--muted")); t.textContent = "No activities for " + state.year + " yet.";
      svg.appendChild(t);
      els.chartLegend.innerHTML = "";
      return;
    }
    var counts = [];
    for (var m = 0; m < 12; m++) { counts.push({}); CATEGORY_GROUPS.forEach(function (g) { counts[m][g] = 0; }); }
    yearDocs.forEach(function (d) {
      var m = (d.month || 1) - 1;
      var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
      counts[m][g] = (counts[m][g] || 0) + 1;
    });
    var totals = counts.map(function (c) { return CATEGORY_GROUPS.reduce(function (s, g) { return s + c[g]; }, 0); });
    var maxTotal = Math.max(1, Math.max.apply(null, totals));
    var W = 960, H = 320, padL = 34, padR = 10, padT = 14, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var colW = plotW / 12, barW = colW * 0.6;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);

    var ns = "http://www.w3.org/2000/svg";
    function el(tag, attrs) {
      var e = document.createElementNS(ns, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var val = Math.ceil(maxTotal * i / ticks);
      var y = padT + plotH - (plotH * i / ticks);
      svg.appendChild(el("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: cssVar("--line"), "stroke-width": 1 }));
      var lbl = el("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 10, fill: cssVar("--muted") });
      lbl.textContent = val;
      svg.appendChild(lbl);
    }
    for (var m2 = 0; m2 < 12; m2++) {
      var x = padL + m2 * colW + (colW - barW) / 2;
      var yCursor = padT + plotH;
      CATEGORY_GROUPS.forEach(function (g) {
        var v = counts[m2][g];
        if (!v) return;
        var h = plotH * (v / maxTotal);
        yCursor -= h;
        var rect = el("rect", { x: x, y: yCursor, width: barW, height: Math.max(h, 0), fill: groupColor(g), rx: 2 });
        var titleEl = document.createElementNS(ns, "title");
        titleEl.textContent = MONTH_ABBR[m2] + " " + state.year + " — " + g + ": " + v;
        rect.appendChild(titleEl);
        svg.appendChild(rect);
      });
      if (totals[m2] > 0) {
        var totLbl = el("text", { x: x + barW / 2, y: padT + plotH - Math.max(0, plotH * (totals[m2] / maxTotal)) - 6, "text-anchor": "middle", "font-size": 10, "font-weight": 600, fill: cssVar("--ink") });
        totLbl.textContent = totals[m2];
        svg.appendChild(totLbl);
      }
      var mLbl = el("text", { x: x + barW / 2, y: H - 10, "text-anchor": "middle", "font-size": 11, fill: cssVar("--muted") });
      mLbl.textContent = MONTH_ABBR[m2];
      svg.appendChild(mLbl);
    }
    svg.appendChild(el("line", { x1: padL, x2: padL, y1: padT, y2: padT + plotH, stroke: cssVar("--line"), "stroke-width": 1 }));

    els.chartLegend.innerHTML = CATEGORY_GROUPS.map(function (g) {
      return '<span class="sw"><span class="dot" style="background:' + groupColor(g) + '"></span>' + g + '</span>';
    }).join("");
  }

  function renderTimeline() {
    var yearDocs = state.docs.filter(function (d) { return d.year === state.year; });
    els.timelineHint.textContent = "Day-by-day view for " + state.year + " — click a bar to jump to it in the table below.";
    if (!yearDocs.length) {
      els.timelineBody.innerHTML = '<div class="tl-empty">No activities for ' + state.year + ' yet.</div>';
      return;
    }
    var html = "";
    for (var m = 1; m <= 12; m++) {
      var dim = daysInMonth(state.year, m);
      var monthDocs = yearDocs.filter(function (d) { return d.month === m; });
      var bars = monthDocs.map(function (d) {
        var sd = Math.min(d.startDay || 1, dim), ed = Math.min(d.endDay || sd, dim);
        var left = ((sd - 1) / dim * 100).toFixed(2), width = Math.max(((ed - sd + 1) / dim * 100), 2.2).toFixed(2);
        var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
        return '<div class="bar ' + statusClass(d.status) + '" data-row="row-' + d.id + '" tabindex="0" role="button" ' +
          'style="left:' + left + '%; width:' + width + '%; background-color:' + groupColor(g) + ';" ' +
          'title="' + escapeHtml(d.activity) + ' — ' + escapeHtml(d.status) + ' (' + escapeHtml(d.startDate) + ' to ' + escapeHtml(d.endDate) + ')">' +
          escapeHtml(d.activity) + '</div>';
      }).join("");
      html += '<div class="tl-month"><div class="lbl">' + MONTH_ABBR[m - 1] + '</div><div class="tl-track">' + bars + '</div></div>';
    }
    els.timelineBody.innerHTML = html;
    els.timelineBody.querySelectorAll(".bar").forEach(function (b) {
      b.addEventListener("click", function () { jumpToRow(b.getAttribute("data-row")); });
      b.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); jumpToRow(b.getAttribute("data-row")); } });
    });
  }

  function jumpToRow(rowId) {
    var row = document.getElementById(rowId);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("hi");
    setTimeout(function () { row.classList.remove("hi"); }, 1600);
  }

  function filteredSortedDocs() {
    var f = state.filters;
    var list = state.docs.filter(function (d) {
      if (f.year && String(d.year) !== f.year) return false;
      if (f.category && d.category !== f.category) return false;
      if (f.status && d.status !== f.status) return false;
      if (f.search) {
        var hay = ((d.activity || "") + " " + (d.notes || "")).toLowerCase();
        if (hay.indexOf(f.search.toLowerCase()) === -1) return false;
      }
      return true;
    });
    var key = state.sortKey, dir = state.sortDir === "asc" ? 1 : -1;
    list.sort(function (a, b) {
      var av, bv;
      if (key === "start") { av = a.startDate; bv = b.startDate; }
      else if (key === "end") { av = a.endDate; bv = b.endDate; }
      else if (key === "activity") { av = a.activity || ""; bv = b.activity || ""; }
      else if (key === "category") { av = a.category || ""; bv = b.category || ""; }
      else if (key === "status") { av = a.status || ""; bv = b.status || ""; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return list;
  }

  function renderTable() {
    var list = filteredSortedDocs();
    els.rowCount.textContent = list.length + " of " + state.docs.length + " activities";
    els.tableBody.innerHTML = list.map(function (d) {
      var g = CATEGORY_GROUPS.indexOf(d.categoryGroup) >= 0 ? d.categoryGroup : "Other";
      var statusOpts = STATUS_LIST.map(function (s) {
        return '<option value="' + s + '"' + (s === d.status ? " selected" : "") + '>' + s + '</option>';
      }).join("");
      return '<tr id="row-' + d.id + '">' +
        '<td class="date-cell">' + escapeHtml(d.startDate) + '</td>' +
        '<td class="date-cell">' + escapeHtml(d.endDate) + '</td>' +
        '<td class="activity-name">' + escapeHtml(d.activity) + '</td>' +
        '<td><span class="cat-chip"><span class="dot" style="background:' + groupColor(g) + '"></span>' + escapeHtml(d.category) + '</span></td>' +
        '<td><select class="status-select ' + statusClass(d.status) + '" data-id="' + d.id + '" data-field="status">' + statusOpts + '</select></td>' +
        '<td><input class="notes-input" type="text" data-id="' + d.id + '" data-field="notes" value="' + escapeHtml(d.notes) + '" placeholder="—"></td>' +
        '<td><input class="date-input" type="date" data-id="' + d.id + '" data-field="actualDate" value="' + escapeHtml(d.actualDate) + '"><span class="save-flag">saved</span></td>' +
        '</tr>';
    }).join("");

    els.tableBody.querySelectorAll("select.status-select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        sel.className = "status-select " + statusClass(sel.value);
        saveField(sel.getAttribute("data-id"), "status", sel.value, sel);
      });
    });
    els.tableBody.querySelectorAll("input.notes-input").forEach(function (inp) {
      inp.addEventListener("change", function () { saveField(inp.getAttribute("data-id"), "notes", inp.value, inp); });
    });
    els.tableBody.querySelectorAll("input.date-input").forEach(function (inp) {
      inp.addEventListener("change", function () { saveField(inp.getAttribute("data-id"), "actualDate", inp.value, inp); });
    });
  }

  function saveField(id, field, value, el) {
    var doc = state.docs.find(function (d) { return d.id === id; });
    if (doc) doc[field] = value;
    renderStats(); renderChart(); renderTimeline();

    if (!usingLiveApi) { flashSaved(el, false, "demo mode — not saved"); return; }

    fetch(API_URL, {
      method: "POST",
      // text/plain avoids a CORS preflight; Apps Script parses the body as JSON itself.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ id: id, field: field, value: value })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) flashSaved(el, true, "saved");
        else flashSaved(el, false, (res && res.error) || "not saved");
      })
      .catch(function () { flashSaved(el, false, "network error"); });
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

  document.querySelectorAll("thead th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-sort");
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = key; state.sortDir = "asc"; }
      renderTable();
    });
  });

  els.searchInput.addEventListener("input", function () { state.filters.search = els.searchInput.value; renderTable(); });
  els.filterYear.addEventListener("change", function () { state.filters.year = els.filterYear.value; renderTable(); });
  els.filterCategory.addEventListener("change", function () { state.filters.category = els.filterCategory.value; renderTable(); });
  els.filterStatus.addEventListener("change", function () { state.filters.status = els.filterStatus.value; renderTable(); });

  els.exportBtn.addEventListener("click", function () {
    var list = filteredSortedDocs();
    var header = ["Start Date", "End Date", "Activity", "Category", "Status", "Notes", "Actual Date"];
    var rows = list.map(function (d) {
      return [d.startDate, d.endDate, d.activity, d.category, d.status, d.notes || "", d.actualDate || ""].map(csvEscape).join(",");
    });
    var csv = header.join(",") + "\n" + rows.join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "nqemt2_activities.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  });

  function renderAll() {
    rebuildDynamicFilterOptions();
    renderStats();
    renderYearToggle();
    renderChart();
    renderTimeline();
    renderTable();
  }

  function boot() {
    if (!usingLiveApi) {
      els.syncBanner.hidden = false;
      els.syncBanner.textContent = "Running in demo mode on a bundled sample — edits won't be saved. Set API_URL in config.js to your deployed Apps Script URL to go live.";
      state.docs = JSON.parse(JSON.stringify(SAMPLE_ACTIVITIES));
      renderAll();
      return;
    }
    fetch(API_URL)
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok || !Array.isArray(res.activities)) throw new Error("bad response");
        state.docs = res.activities.map(function (d) { return Object.assign({}, d, { id: String(d.id) }); });
        els.syncBanner.hidden = true;
        renderAll();
      })
      .catch(function (err) {
        els.syncBanner.hidden = false;
        els.syncBanner.textContent = "Couldn't reach the Apps Script API (" + err.message + "). Showing the bundled sample instead.";
        state.docs = JSON.parse(JSON.stringify(SAMPLE_ACTIVITIES));
        renderAll();
      });
  }

  boot();
})();
