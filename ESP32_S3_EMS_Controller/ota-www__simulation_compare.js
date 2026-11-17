(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    // te same kolory co www/simulation_report.js / Pulpit
    var MODE_COLORS = {
        IDLE: "#607d8b",
        WAIT: "#1d4ed8",
        CHARGE: "#16a34a",
        DISCHARGE: "#b91c1c",
        GRID: "#a855f7",
        STANDBY: "#0f766e"
    };

    var PV_COLOR = "#f59e0b";
    var LOAD_COLOR = "#3b82f6";
    var SOC_COLOR = "#16a34a";
    var NEED_COLOR = "#a855f7";

    var dateEl = el("sim-date");
    var hourEl = el("sim-hour");
    var socEl = el("sim-soc");
    var endSocEl = el("sim-end-soc");
    var avgLoadEl = el("sim-avg-load");
    var loadProfileEl = el("sim-load-profile");
    var avgLoadRowEl = el("sim-avg-load-row");
    var runEl = el("sim-run");
    var statusEl = el("sim-status");

    loadProfileEl.addEventListener("change", function () {
        avgLoadEl.disabled = loadProfileEl.checked;
        avgLoadRowEl.classList.toggle("is-disabled", loadProfileEl.checked);
    });

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    function dateStr(d) {
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }

    function todayDateStr() { return dateStr(new Date()); }

    function yesterdayDateStr() {
        var d = new Date();
        d.setDate(d.getDate() - 1);
        return dateStr(d);
    }

    function fmtTime(iso, baseDate) {

        if (!iso) { return "-"; }

        var datePart = iso.split("T")[0];
        var timePart = (iso.split("T")[1] || iso).slice(0, 5);

        if (!baseDate || datePart === baseDate) {
            return timePart;
        }

        var diffDays = Math.round((new Date(datePart + "T00:00:00") - new Date(baseDate + "T00:00:00")) / 86400000);

        return timePart + " (" + (diffDays > 0 ? "+" : "") + diffDays + ")";
    }

    function fmt1(v) {
        return v == null ? "-" : String(Math.round(v * 10) / 10).replace(".", ",");
    }

    // ------------------------------------------------------------------
    // tabela (jak w www/simulation_report.js)
    // ------------------------------------------------------------------

    function renderModeBadge(mode, touSoc, sellLimitKwh) {
        var color = MODE_COLORS[mode] || "#555";
        var soc = (mode === "GRID" && touSoc != null) ? " → " + escapeHtml(touSoc) + "%" : "";
        if (mode === "DISCHARGE" && sellLimitKwh != null) {
            soc = " ≤ " + String(sellLimitKwh.toFixed(1)).replace(".", ",") + " kWh";
        }
        return "<span class=\"state-badge\" style=\"background:" + color + "1a; color:" + color + ";\">" +
            escapeHtml(mode) + "</span>" + soc;
    }

    function renderTable(rows, baseDate) {

        if (!rows.length) {
            return "<div class=\"history-empty\">Brak wyniku symulacji dla tego dnia</div>";
        }

        var body = rows.map(function (r) {
            return "<tr>" +
                "<td>" + fmtTime(r.start, baseDate) + "</td>" +
                "<td>" + fmtTime(r.end, baseDate) + "</td>" +
                "<td class=\"align-right\">" + escapeHtml(r.rce) + "</td>" +
                "<td class=\"align-right\">" + escapeHtml(r.pv) + "</td>" +
                "<td class=\"align-right\">" + escapeHtml(r.load) + "</td>" +
                "<td class=\"align-right\">" + (r.soc == null ? "-" : escapeHtml(Math.round(r.soc))) + "</td>" +
                "<td>" + renderModeBadge(r.mode, r.tou_soc, r.sell_limit_kwh) + "</td>" +
                "</tr>";
        }).join("");

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Start</th><th>Koniec</th><th class=\"align-right\">RCE (zł/kWh, brutto)</th><th class=\"align-right\">PV (kWh)</th><th class=\"align-right\">Zużycie (kWh)</th><th class=\"align-right\">SOC (%)</th><th>Tryb</th></tr></thead>" +
            "<tbody>" + body + "</tbody></table></div>";
    }

    // ------------------------------------------------------------------
    // wykresy SVG (os X = sloty osi czasu, wspolna dla obu wariantow)
    // ------------------------------------------------------------------

    var W = 960;
    var PAD_L = 40;
    var PAD_R = 10;
    var PLOT_W = W - PAD_L - PAD_R;

    function xAt(i, n) { return PAD_L + (i / n) * PLOT_W; }

    // znaczniki godzin co 3 h; etykieta "HH:00" (z "+1" po dobie)
    function timeAxis(tl, n, top, bottom) {

        var startIso = tl.start || "";
        var hh = parseInt((startIso.split("T")[1] || "00:00").slice(0, 2), 10) || 0;
        var mm = parseInt((startIso.split("T")[1] || "00:00").slice(3, 5), 10) || 0;
        var startMin = hh * 60 + mm;
        var stepMin = tl.step_s / 60;
        var out = "";

        for (var i = 0; i <= n; i++) {

            var minutes = startMin + i * stepMin;

            if (minutes % 180 !== 0) { continue; }

            var x = xAt(i, n);
            var label = pad2(Math.floor(minutes / 60) % 24) + ":00" + (minutes >= 1440 ? " (+" + Math.floor(minutes / 1440) + ")" : "");

            out += "<line x1=\"" + x + "\" x2=\"" + x + "\" y1=\"" + top + "\" y2=\"" + bottom + "\" stroke=\"currentColor\" stroke-opacity=\"0.12\"/>" +
                "<text x=\"" + x + "\" y=\"" + (bottom + 14) + "\" font-size=\"11\" text-anchor=\"middle\" fill=\"currentColor\" fill-opacity=\"0.7\">" + label + "</text>";
        }

        return out;
    }

    // linia z przerwami na null; "mid" - wartosc na srodku slotu (PV/zuzycie), inaczej na koncu (SOC)
    function linePath(values, n, yOf, mid) {

        var d = "";
        var pen = false;

        for (var i = 0; i < values.length; i++) {

            if (values[i] == null) { pen = false; continue; }

            var x = xAt(i + (mid ? 0.5 : 1), n);
            d += (pen ? "L" : "M") + x.toFixed(1) + " " + yOf(values[i]).toFixed(1);
            pen = true;
        }

        return d;
    }

    function modeStrip(modes, n, y, h) {

        return modes.map(function (mode, i) {

            if (!mode) { return ""; }

            return "<rect x=\"" + xAt(i, n).toFixed(1) + "\" y=\"" + y + "\" width=\"" + (PLOT_W / n + 0.5).toFixed(1) +
                "\" height=\"" + h + "\" fill=\"" + (MODE_COLORS[mode] || "#555") + "\"/>";
        }).join("");
    }

    function firstIndex(values) {
        for (var i = 0; i < values.length; i++) {
            if (values[i] != null) { return i; }
        }
        return -1;
    }

    function legendItem(color, label, dashed) {
        return "<span style=\"display:inline-flex;align-items:center;margin-right:14px;\">" +
            "<svg width=\"22\" height=\"8\" aria-hidden=\"true\"><line x1=\"0\" x2=\"22\" y1=\"4\" y2=\"4\" stroke=\"" + color + "\" stroke-width=\"2.5\"" +
            (dashed ? " stroke-dasharray=\"4 3\"" : "") + "/></svg>&nbsp;" + escapeHtml(label) + "</span>";
    }

    function modeLegend(modes) {
        var seen = {};
        modes.forEach(function (m) { if (m) { seen[m] = true; } });
        return Object.keys(seen).map(function (m) {
            return "<span style=\"display:inline-flex;align-items:center;margin-right:10px;\"><span style=\"width:10px;height:10px;background:" +
                (MODE_COLORS[m] || "#555") + ";display:inline-block;margin-right:4px;\"></span>" + escapeHtml(m) + "</span>";
        }).join("");
    }

    function socChart(tl, withCorridor) {

        var n = tl.soc.length;
        var top = 8;
        var bottom = 200;
        var yOf = function (v) { return bottom - (v / 100) * (bottom - top); };

        var svg = "<svg viewBox=\"0 0 " + W + " 270\" width=\"100%\" role=\"img\" aria-label=\"SOC planowany i rzeczywisty\" style=\"max-width:100%;height:auto;\">";

        // siatka i os Y
        [0, 25, 50, 75, 100].forEach(function (v) {
            svg += "<line x1=\"" + PAD_L + "\" x2=\"" + (W - PAD_R) + "\" y1=\"" + yOf(v) + "\" y2=\"" + yOf(v) + "\" stroke=\"currentColor\" stroke-opacity=\"0.12\"/>" +
                "<text x=\"" + (PAD_L - 6) + "\" y=\"" + (yOf(v) + 4) + "\" font-size=\"11\" text-anchor=\"end\" fill=\"currentColor\" fill-opacity=\"0.7\">" + v + "%</text>";
        });

        svg += timeAxis(tl, n, top, bottom);

        // korytarz [need, limit] - tylko wariant B
        if (withCorridor) {

            var pts = [];
            var back = [];

            for (var i = 0; i < n; i++) {
                if (tl.need[i] != null && tl.limit[i] != null) {
                    var x = xAt(i + 1, n);
                    pts.push(x.toFixed(1) + "," + yOf(tl.limit[i]).toFixed(1));
                    back.push(x.toFixed(1) + "," + yOf(tl.need[i]).toFixed(1));
                }
            }

            if (pts.length) {
                svg += "<polygon points=\"" + pts.join(" ") + " " + back.reverse().join(" ") + "\" fill=\"" + NEED_COLOR + "\" fill-opacity=\"0.13\"/>";
                svg += "<path d=\"" + linePath(tl.need, n, yOf, false) + "\" fill=\"none\" stroke=\"" + NEED_COLOR + "\" stroke-width=\"1.5\"/>";
                svg += "<path d=\"" + linePath(tl.limit, n, yOf, false) + "\" fill=\"none\" stroke=\"" + NEED_COLOR + "\" stroke-width=\"1.5\" stroke-dasharray=\"4 3\"/>";
            }
        }

        // moment "wykonania" - pierwszy slot z planowanym SOC
        var nowIdx = firstIndex(tl.soc);
        if (nowIdx > 0) {
            var nx = xAt(nowIdx, n);
            svg += "<line x1=\"" + nx + "\" x2=\"" + nx + "\" y1=\"" + top + "\" y2=\"" + bottom + "\" stroke=\"currentColor\" stroke-opacity=\"0.45\" stroke-dasharray=\"2 3\"/>";
        }

        svg += "<path d=\"" + linePath(tl.soc, n, yOf, false) + "\" fill=\"none\" stroke=\"" + SOC_COLOR + "\" stroke-width=\"2.5\"/>";
        svg += "<path d=\"" + linePath(tl.soc_actual, n, yOf, false) + "\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-dasharray=\"5 3\"/>";

        // paski trybow: plan i rzeczywistosc
        svg += "<text x=\"" + (PAD_L - 6) + "\" y=\"232\" font-size=\"10\" text-anchor=\"end\" fill=\"currentColor\" fill-opacity=\"0.7\">plan</text>" + modeStrip(tl.mode, n, 224, 12);
        svg += "<text x=\"" + (PAD_L - 6) + "\" y=\"250\" font-size=\"10\" text-anchor=\"end\" fill=\"currentColor\" fill-opacity=\"0.7\">fakt</text>" + modeStrip(tl.mode_actual, n, 242, 12);

        svg += "</svg>";

        var hasActual = tl.soc_actual.some(function (v) { return v != null; });

        var legend = "<div class=\"settings-hint\">" +
            legendItem(SOC_COLOR, "SOC planowany (koniec slotu)", false) +
            (hasActual ? legendItem("currentColor", "SOC rzeczywisty", true) : "<span>Brak rzeczywistego SOC w historii tego dnia. </span>") +
            (withCorridor ? legendItem(NEED_COLOR, "korytarz: potrzebny (ciągła) – limit (przerywana)", false) : "") +
            "<br>Paski trybów: " + modeLegend(tl.mode.concat(tl.mode_actual)) +
            "</div>";

        return svg + legend;
    }

    function energyChart(tl) {

        var n = tl.pv.length;
        var top = 8;
        var bottom = 170;
        var maxV = 0.1;

        [tl.pv, tl.load, tl.pv_actual, tl.load_actual].forEach(function (arr) {
            arr.forEach(function (v) { if (v != null && v > maxV) { maxV = v; } });
        });

        var yOf = function (v) { return bottom - (v / maxV) * (bottom - top); };

        var svg = "<svg viewBox=\"0 0 " + W + " 190\" width=\"100%\" role=\"img\" aria-label=\"PV i zuzycie\" style=\"max-width:100%;height:auto;\">";

        [0, 0.5, 1].forEach(function (f) {
            var v = maxV * f;
            svg += "<line x1=\"" + PAD_L + "\" x2=\"" + (W - PAD_R) + "\" y1=\"" + yOf(v) + "\" y2=\"" + yOf(v) + "\" stroke=\"currentColor\" stroke-opacity=\"0.12\"/>" +
                "<text x=\"" + (PAD_L - 6) + "\" y=\"" + (yOf(v) + 4) + "\" font-size=\"11\" text-anchor=\"end\" fill=\"currentColor\" fill-opacity=\"0.7\">" +
                (Math.round(v * 100) / 100) + "</text>";
        });

        svg += timeAxis(tl, n, top, bottom);

        svg += "<path d=\"" + linePath(tl.pv, n, yOf, true) + "\" fill=\"none\" stroke=\"" + PV_COLOR + "\" stroke-width=\"2\" stroke-dasharray=\"5 3\"/>";
        svg += "<path d=\"" + linePath(tl.pv_actual, n, yOf, true) + "\" fill=\"none\" stroke=\"" + PV_COLOR + "\" stroke-width=\"2.5\"/>";
        svg += "<path d=\"" + linePath(tl.load, n, yOf, true) + "\" fill=\"none\" stroke=\"" + LOAD_COLOR + "\" stroke-width=\"2\" stroke-dasharray=\"5 3\"/>";
        svg += "<path d=\"" + linePath(tl.load_actual, n, yOf, true) + "\" fill=\"none\" stroke=\"" + LOAD_COLOR + "\" stroke-width=\"2.5\"/>";
        svg += "</svg>";

        var legend = "<div class=\"settings-hint\">" +
            legendItem(PV_COLOR, "PV prognoza", true) + legendItem(PV_COLOR, "PV rzeczywista", false) +
            legendItem(LOAD_COLOR, "zużycie prognoza", true) + legendItem(LOAD_COLOR, "zużycie rzeczywiste", false) +
            " (kWh na slot)</div>";

        return svg + legend;
    }

    function sum(arr) {
        return arr.reduce(function (a, v) { return a + (v == null ? 0 : v); }, 0);
    }

    function sumWhere(arr, other) {
        // suma "arr" tylko tam, gdzie jest rzeczywista wartosc "other" - porownanie na tym samym zakresie
        var total = 0;
        for (var i = 0; i < arr.length; i++) {
            if (other[i] != null && arr[i] != null) { total += arr[i]; }
        }
        return total;
    }

    function energySummary(tl) {

        var pvAct = sum(tl.pv_actual);
        var loadAct = sum(tl.load_actual);

        if (!pvAct && !loadAct) {
            return "Brak danych rzeczywistych (produkcja/zużycie) dla tego dnia w logach kontrolera.";
        }

        return "Na slotach z danymi rzeczywistymi: PV prognoza " + fmt1(sumWhere(tl.pv, tl.pv_actual)) + " kWh, rzeczywista " + fmt1(pvAct) +
            " kWh; zużycie prognoza " + fmt1(sumWhere(tl.load, tl.load_actual)) + " kWh, rzeczywiste " + fmt1(loadAct) + " kWh.";
    }

    function variantSummary(res) {

        var tl = res.timeline;
        var slotH = tl.step_s / 3600;
        var socs = tl.soc.filter(function (v) { return v != null; });
        var grid = tl.mode.filter(function (m) { return m === "GRID"; }).length * slotH;
        var discharge = tl.mode.filter(function (m) { return m === "DISCHARGE"; }).length * slotH;
        var charge = tl.mode.filter(function (m) { return m === "CHARGE"; }).length * slotH;

        var gridTargets = (res.schedule || []).filter(function (r) { return r.mode === "GRID" && r.tou_soc != null; })
            .map(function (r) { return fmtTime(r.start, res.date) + "–" + fmtTime(r.end, res.date) + " → " + r.tou_soc + "%"; });

        var parts = [
            "Planowany SOC: min " + (socs.length ? Math.round(Math.min.apply(null, socs)) : "-") + "%, max " + (socs.length ? Math.round(Math.max.apply(null, socs)) : "-") +
                "%, na końcu " + (socs.length ? Math.round(socs[socs.length - 1]) : "-") + "%.",
            "Godziny trybów: GRID " + fmt1(grid) + " h, CHARGE " + fmt1(charge) + " h, DISCHARGE " + fmt1(discharge) + " h.",
            gridTargets.length ? "GRID: " + gridTargets.join("; ") + "." : "Bez doładowania z sieci."
        ];

        return "<div class=\"settings-hint\">" + parts.map(escapeHtml).join("<br>") + "</div>";
    }

    function renderWarning(res) {

        var parts = [];
        var missing = res.missing_irradiance_hours || [];

        if (missing.length >= 20) {
            parts.push("Brak prognozy nasłonecznienia dla tego dnia (dane trzymane tylko ~14 dni wstecz) - wynik może być niemiarodajny.");
        } else if (missing.length) {
            parts.push("Brak prognozy nasłonecznienia dla godzin: " + missing.join(", ") + " - te godziny liczone przy irradiance=0.");
        }

        parts.push(
            "SOC startowy=" + res.soc + "%, napięcie baterii=" + res.battery_voltage + " V, pojemność znamionowa=" +
            res.battery_rated_capacity_ah + " Ah (aktualne wartości), \"teraz\" symulacji: " + fmtTime(res.sim_now, res.date) + ".",
            energySummary(res.timeline)
        );

        return "<div class=\"settings-hint\">" + parts.map(escapeHtml).join("<br>") + "</div>";
    }

    function showVariant(prefix, res, withCorridor) {

        el("sim-" + prefix + "-panel").hidden = false;
        el("sim-" + prefix + "-summary").innerHTML = variantSummary(res);
        el("sim-" + prefix + "-chart").innerHTML = socChart(res.timeline, withCorridor);
        el("sim-" + prefix + "-table").innerHTML = renderTable(res.schedule || [], res.date);
    }

    function fail(message) {
        runEl.disabled = false;
        statusEl.className = "settings-message error";
        statusEl.textContent = message;
    }

    function baseUrl() {
        return "/ems/simulate?date=" + encodeURIComponent(dateEl.value) +
            "&hour=" + encodeURIComponent(hourEl.value) +
            "&soc=" + encodeURIComponent(socEl.value) +
            "&load_profile=" + (loadProfileEl.checked ? "1" : "0") +
            "&avg_load_day_kw=" + encodeURIComponent(avgLoadEl.value);
    }

    function errorText(res) {
        return res.error === "no_rce_data"
            ? "Brak danych RCE dla tego dnia (PSE nie ma archiwum dla tej daty)."
            : "Błąd: " + res.error;
    }

    function run() {

        if (!dateEl.value) {
            fail("Wybierz dzień.");
            return;
        }

        statusEl.className = "settings-message";
        statusEl.textContent = "Liczenie wariantu A…";
        runEl.disabled = true;

        ["sim-result-panel", "sim-a-panel", "sim-b-panel"].forEach(function (id) { el(id).hidden = true; });

        // kolejno, nie rownolegle - kontroler liczy jedna symulacje naraz (pamiec)
        fetch(baseUrl())
            .then(function (r) { return r.json(); })
            .then(function (a) {

                if (a.error) { fail(errorText(a)); return null; }

                el("sim-result-panel").hidden = false;
                el("sim-warning").innerHTML = renderWarning(a);
                el("sim-energy-chart").innerHTML = energyChart(a.timeline);
                showVariant("a", a, false);

                statusEl.textContent = "Liczenie wariantu B…";

                return fetch(baseUrl() + "&backward_end_soc=" + encodeURIComponent(endSocEl.value))
                    .then(function (r) { return r.json(); });
            })
            .then(function (b) {

                if (!b) { return; }

                if (b.error) { fail(errorText(b)); return; }

                showVariant("b", b, true);
                runEl.disabled = false;
                statusEl.textContent = "";
            })
            .catch(function () {
                fail("Błąd wczytywania - sprawdź połączenie z internetem (PSE) i spróbuj ponownie.");
            });
    }

    for (var h = 0; h < 24; h++) {
        var opt = document.createElement("option");
        opt.value = h;
        opt.textContent = pad2(h) + ":00";
        hourEl.appendChild(opt);
    }

    hourEl.value = 0;
    dateEl.max = todayDateStr();
    dateEl.value = yesterdayDateStr();

    runEl.addEventListener("click", run);

    el("sim-date-today").addEventListener("click", function () { dateEl.value = todayDateStr(); });
    el("sim-hour-now").addEventListener("click", function () { hourEl.value = new Date().getHours(); });

    var socButton = el("sim-soc-current");

    socButton.addEventListener("click", function () {
        socButton.disabled = true;
        fetch("/display/batteryWidget")
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var soc = parseFloat(res.soc);
                if (!isNaN(soc)) { socEl.value = Math.round(soc); }
            })
            .catch(function () {
                statusEl.className = "settings-message error";
                statusEl.textContent = "Nie udało się odczytać SOC.";
            })
            .then(function () { socButton.disabled = false; });
    });

    // ==================================================
    // MODEL HARMONOGRAMU NA ZYWO (przelacznik A / B) - parametry
    // PLANNER_MODEL_B / PLANNER_B_END_SOC (GET/PUT /ems/params,
    // storage/ems_params_store.py; ems/control.py::_backward_end_soc())
    // ==================================================

    var liveModelEl = el("live-model");
    var liveEndSocEl = el("live-end-soc");
    var liveSaveEl = el("live-model-save");
    var liveMessageEl = el("live-model-message");
    var liveStatusEl = el("live-model-status");

    function showLiveModel(params) {
        liveModelEl.value = params.PLANNER_MODEL_B >= 1 ? "1" : "0";
        liveEndSocEl.value = Math.round(params.PLANNER_B_END_SOC);
        liveStatusEl.textContent = "Aktualnie na żywo: wariant " + (params.PLANNER_MODEL_B >= 1 ? "B (projekcja odwrotna)" : "A (obecny algorytm)") + ".";
    }

    function liveMessage(text, isError) {
        liveMessageEl.className = "settings-message " + (isError ? "error" : "success");
        liveMessageEl.textContent = text;
    }

    fetch("/ems/params")
        .then(function (r) { return r.json(); })
        .then(function (res) { showLiveModel(res.params || {}); })
        .catch(function () { liveStatusEl.textContent = "Nie udało się odczytać bieżącego modelu."; });

    liveSaveEl.addEventListener("click", function () {

        liveSaveEl.disabled = true;
        liveMessage("Zapisywanie i przeliczanie harmonogramu…", false);

        fetch("/ems/params", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                PLANNER_MODEL_B: liveModelEl.value,
                PLANNER_B_END_SOC: liveEndSocEl.value
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res.error) {
                    liveMessage("Błąd: " + res.error, true);
                    return;
                }
                showLiveModel(res.params);
                liveMessage("Zapisano - harmonogram przeliczony.", false);
            })
            .catch(function () { liveMessage("Błąd zapisu.", true); })
            .then(function () { liveSaveEl.disabled = false; });
    });
})();
