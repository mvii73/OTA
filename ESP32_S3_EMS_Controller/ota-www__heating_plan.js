// Harmonogram ogrzewania (www/heating_plan.py): GET /heating/plan - zapotrzebowanie domu na moc
// w najblizszych 24 h co 15 min (ems/heating_plan.py), wykres SVG (warstwy pomieszczen, temperatura
// zewnetrzna, moc dogrzewacza, tlo - kociol) i okresy obecnosci pomieszczen; kazda zmiana okresow
// -> POST /heating/plan {"presence": {id: okresy}} (po chwili, zeby nie liczyc przy kazdym klawiszu)
(function () {

    var W = 760, H = 260, PAD_L = 40, PAD_R = 40, PAD_T = 10, PAD_B = 24;
    var PALETTE = ["#2563eb", "#16a34a", "#f97316", "#7c3aed", "#0d9488", "#db2777", "#ca8a04", "#92400e", "#475569", "#dc2626"];
    var OUTDOOR = "#0891b2";

    var data = null;
    var timer = null;
    var pending = {};

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
        });
    }

    function fmt(v, d) { return v == null ? "--" : Number(v).toFixed(d).replace(".", ","); }

    function message(text, error) {
        var m = el("hp-message");
        m.textContent = text || "";
        m.style.color = error ? "var(--danger)" : "";
    }

    function load(method, body) {
        var opts = { method: method || "GET" };
        if (body) { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(body); }
        return fetch("/heating/plan", opts).then(function (r) { return r.json(); });
    }

    // ---------- wykres ----------

    function niceMax(v) {
        if (v <= 0) { return 1; }
        var step = v <= 2 ? 0.5 : v <= 5 ? 1 : v <= 10 ? 2 : 5;
        return Math.ceil(v * 1.1 / step) * step;
    }

    function renderChart(d) {
        var n = d.times.length;
        if (!n) { el("hp-chart").innerHTML = "<div class=\"history-empty\">Brak danych</div>"; return; }

        var pw = W - PAD_L - PAD_R, ph = H - PAD_T - PAD_B;
        var maxKw = niceMax(Math.max(Math.max.apply(null, d.demand_kw), d.heater_power_kw + d.margin_kw));
        var temps = d.outdoor.filter(function (v) { return v != null; });
        var tMin = temps.length ? Math.floor(Math.min.apply(null, temps) - 1) : 0;
        var tMax = temps.length ? Math.ceil(Math.max.apply(null, temps) + 1) : 10;
        if (tMax - tMin < 4) { tMax = tMin + 4; }

        function x(i) { return PAD_L + pw * i / n; }
        function yk(v) { return PAD_T + ph * (1 - v / maxKw); }
        function yt(v) { return PAD_T + ph * (1 - (v - tMin) / (tMax - tMin)); }

        var svg = "<svg viewBox=\"0 0 " + W + " " + H + "\" width=\"100%\" style=\"display:block; color:var(--text)\" " +
            "font-size=\"10\" font-family=\"var(--font-sans)\">";

        // tlo: kociol grzeje
        for (var i = 0; i < n; i++) {
            if (d.source[i] === "boiler") {
                var j = i;
                while (j < n && d.source[j] === "boiler") { j++; }
                svg += "<rect x=\"" + x(i) + "\" y=\"" + PAD_T + "\" width=\"" + (x(j) - x(i)) + "\" height=\"" + ph +
                    "\" fill=\"#dc2626\" fill-opacity=\"0.08\"><title>kocioł " + d.times[i] + "-" + (d.times[j] || "") + "</title></rect>";
                i = j - 1;
            }
        }

        // siatka i osie
        for (var k = 0; k <= 4; k++) {
            var v = maxKw * k / 4, yy = yk(v);
            svg += "<line x1=\"" + PAD_L + "\" x2=\"" + (W - PAD_R) + "\" y1=\"" + yy + "\" y2=\"" + yy +
                "\" stroke=\"currentColor\" stroke-opacity=\"0.12\"/>";
            svg += "<text x=\"" + (PAD_L - 4) + "\" y=\"" + (yy + 3) + "\" text-anchor=\"end\" fill=\"currentColor\" fill-opacity=\"0.7\">" + fmt(v, maxKw < 4 ? 1 : 0) + "</text>";
            var tv = tMin + (tMax - tMin) * k / 4;
            svg += "<text x=\"" + (W - PAD_R + 4) + "\" y=\"" + (yt(tv) + 3) + "\" fill=\"" + OUTDOOR + "\">" + fmt(tv, 0) + "°</text>";
        }
        for (i = 0; i < n; i++) {
            if (d.times[i].slice(3) === "00" && parseInt(d.times[i], 10) % 3 === 0) {
                svg += "<line x1=\"" + x(i) + "\" x2=\"" + x(i) + "\" y1=\"" + PAD_T + "\" y2=\"" + (PAD_T + ph) +
                    "\" stroke=\"currentColor\" stroke-opacity=\"0.08\"/>";
                svg += "<text x=\"" + x(i) + "\" y=\"" + (H - 8) + "\" text-anchor=\"middle\" fill=\"currentColor\" fill-opacity=\"0.7\">" + d.times[i] + "</text>";
            }
        }

        // warstwy pomieszczen (schodkowo - wartosc stala w kroku 15 min)
        var base = d.times.map(function () { return 0; });
        d.rooms.forEach(function (room, r) {
            var top = base.map(function (b, i) { return b + d.rooms_kw[i][r]; });
            if (Math.max.apply(null, top.map(function (t, i) { return t - base[i]; })) <= 0) { base = top; return; }
            var pts = [];
            for (var i = 0; i < n; i++) { pts.push(x(i) + "," + yk(top[i]), x(i + 1) + "," + yk(top[i])); }
            for (i = n - 1; i >= 0; i--) { pts.push(x(i + 1) + "," + yk(base[i]), x(i) + "," + yk(base[i])); }
            svg += "<polygon points=\"" + pts.join(" ") + "\" fill=\"" + PALETTE[r % PALETTE.length] + "\" fill-opacity=\"0.55\"><title>" + esc(room.name) + "</title></polygon>";
            base = top;
        });

        // moc dogrzewacza (prog kotla)
        if (d.heater_power_kw > 0) {
            var yh = yk(d.heater_power_kw);
            svg += "<line x1=\"" + PAD_L + "\" x2=\"" + (W - PAD_R) + "\" y1=\"" + yh + "\" y2=\"" + yh +
                "\" stroke=\"currentColor\" stroke-dasharray=\"5 4\" stroke-width=\"1.2\"/>";
        }

        // temperatura zewnetrzna
        var line = [];
        for (i = 0; i < n; i++) {
            if (d.outdoor[i] != null) { line.push(x(i + 0.5) + "," + yt(d.outdoor[i])); }
        }
        if (line.length) {
            svg += "<polyline points=\"" + line.join(" ") + "\" fill=\"none\" stroke=\"" + OUTDOOR + "\" stroke-width=\"1.6\"/>";
        }

        // podpowiedz - pas na kazdy krok
        for (i = 0; i < n; i++) {
            var src = d.source[i] === "boiler" ? "kocioł" : d.source[i] === "heater" ? "dogrzewacz" : "bez grzania";
            svg += "<rect x=\"" + x(i) + "\" y=\"" + PAD_T + "\" width=\"" + (pw / n) + "\" height=\"" + ph + "\" fill=\"transparent\"><title>" +
                d.times[i] + "  " + fmt(d.demand_kw[i], 2) + " kW (" + src + "), na zewnątrz " + fmt(d.outdoor[i], 1) + " °C</title></rect>";
        }

        svg += "</svg>";
        el("hp-chart").innerHTML = svg;

        var legend = d.rooms.map(function (room, r) {
            return "<span style=\"white-space:nowrap; margin-right:12px\"><span style=\"display:inline-block; width:10px; height:10px; " +
                "background:" + PALETTE[r % PALETTE.length] + "; opacity:0.7; margin-right:4px\"></span>" + esc(room.name) + "</span>";
        });
        legend.push("<span style=\"white-space:nowrap; margin-right:12px\"><span style=\"display:inline-block; width:14px; border-top:2px solid " +
            OUTDOOR + "; margin-right:4px; vertical-align:middle\"></span>temperatura zewnętrzna (oś prawa)</span>");
        if (d.heater_power_kw > 0) {
            legend.push("<span style=\"white-space:nowrap; margin-right:12px\"><span style=\"display:inline-block; width:14px; border-top:2px dashed currentColor; " +
                "margin-right:4px; vertical-align:middle\"></span>moc dogrzewacza " + fmt(d.heater_power_kw, 1) + " kW</span>");
            legend.push("<span style=\"white-space:nowrap\"><span style=\"display:inline-block; width:10px; height:10px; background:#dc2626; " +
                "opacity:0.2; margin-right:4px\"></span>grzeje kocioł</span>");
        }
        el("hp-legend").innerHTML = legend.join("");
    }

    function renderTotals(d) {
        var t = d.totals;
        var rows = [
            ["Energia (24 h)", fmt(t.kwh, 1) + " kWh"],
            ["Szczyt mocy", fmt(t.peak_kw, 2) + " kW"]
        ];
        if (d.strategy !== "boiler_only") { rows.push(["Dogrzewacz", fmt(t.heater_kwh, 1) + " kWh"]); }
        if (d.strategy !== "heater_only") {
            rows.push(["Kocioł", fmt(t.boiler_kwh, 1) + " kWh"]);
            rows.push(["Starty kotła", String(t.boiler_starts)]);
        }
        if (t.unmet_kwh > 0) { rows.push(["Brak mocy dogrzewacza", fmt(t.unmet_kwh, 1) + " kWh"]); }
        el("hp-totals").innerHTML = "<div style=\"display:flex; flex-wrap:wrap; gap:8px 24px\">" + rows.map(function (r) {
            return "<div><div class=\"settings-hint\">" + esc(r[0]) + "</div><b>" + esc(r[1]) + "</b></div>";
        }).join("") + "</div>";
        el("hp-info").textContent = "Od " + d.times[0] + ", co " + d.step_min + " min. Temperatura zewnętrzna: " + d.outdoor_source +
            ". Model sterowania: " + d.strategy_label + ".";
    }

    // ---------- obecnosc ----------

    function periodRow(p, i) {
        return "<div class=\"hp-period\" data-i=\"" + i + "\" style=\"display:flex; align-items:center; gap:6px; margin:4px 0\">" +
            "<input type=\"time\" class=\"hp-from\" value=\"" + esc(p[0]) + "\" step=\"900\"> – " +
            "<input type=\"time\" class=\"hp-to\" value=\"" + esc(p[1]) + "\" step=\"900\">" +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary hp-del\" title=\"Usuń okres\">✕</button></div>";
    }

    function renderRooms(d) {
        var rooms = d.rooms.filter(function (r) { return r.presence; });
        if (!rooms.length) {
            el("hp-rooms").innerHTML = "<div class=\"history-empty\">Żadne pomieszczenie z głowicą nie ma zakresu harmonogramu " +
                "z kontrolą obecności (i czujnika obecności).</div>";
            return;
        }
        el("hp-rooms").innerHTML = rooms.map(function (r) {
            return "<div class=\"hp-room\" data-room=\"" + esc(r.id) + "\" style=\"display:flex; flex-wrap:wrap; align-items:flex-start; gap:8px 16px; " +
                "padding:8px 0; border-top:1px solid var(--hairline)\">" +
                "<div style=\"min-width:140px; padding-top:6px\"><b>" + esc(r.name) + "</b></div>" +
                "<div class=\"hp-periods\" style=\"flex:1\">" +
                (r.periods.length ? r.periods.map(periodRow).join("") : "<div class=\"settings-hint\" style=\"padding:6px 0\">nikogo nie ma</div>") +
                "</div><div style=\"display:flex; gap:6px\">" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary hp-add\">+ Okres</button>" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary hp-reset\" title=\"20:00-08:00\">Domyślne</button>" +
                "</div></div>";
        }).join("");
    }

    function roomPeriods(roomEl) {
        var out = [];
        roomEl.querySelectorAll(".hp-period").forEach(function (row) {
            var a = row.querySelector(".hp-from").value, b = row.querySelector(".hp-to").value;
            if (a && b) { out.push([a, b]); }
        });
        return out;
    }

    function render(d) {
        if (d.error) { message("Błąd: " + d.error, true); return; }
        data = d;
        renderChart(d);
        renderTotals(d);
    }

    function send() {
        timer = null;
        var body = { presence: pending };
        pending = {};
        message("Przeliczanie…");
        load("POST", body).then(function (d) {
            render(d);
            if (!d.error) { message(""); }
        }).catch(function () { message("Nie udało się przeliczyć", true); });
    }

    function changed(roomEl, periods) {
        pending[roomEl.dataset.room] = periods;
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(send, 500);
    }

    el("hp-rooms").addEventListener("change", function (e) {
        var roomEl = e.target.closest(".hp-room");
        if (roomEl && e.target.type === "time") { changed(roomEl, roomPeriods(roomEl)); }
    });

    el("hp-rooms").addEventListener("click", function (e) {
        var btn = e.target.closest("button");
        var roomEl = btn && btn.closest(".hp-room");
        if (!roomEl) { return; }
        var periods = roomPeriods(roomEl);
        if (btn.classList.contains("hp-del")) {
            periods.splice(Number(btn.closest(".hp-period").dataset.i), 1);
        } else if (btn.classList.contains("hp-add")) {
            if (periods.length >= 6) { message("Najwyżej 6 okresów", true); return; }
            periods.push(["08:00", "16:00"]);
        } else if (btn.classList.contains("hp-reset")) {
            periods = null;
        } else {
            return;
        }
        var shown = periods || data.default_periods;
        roomEl.querySelector(".hp-periods").innerHTML = shown.length ? shown.map(periodRow).join("") :
            "<div class=\"settings-hint\" style=\"padding:6px 0\">nikogo nie ma</div>";
        changed(roomEl, periods);
    });

    load().then(function (d) {
        render(d);
        if (!d.error) { renderRooms(d); }
    }).catch(function () { el("hp-info").textContent = "Nie udało się wczytać danych"; });
})();
