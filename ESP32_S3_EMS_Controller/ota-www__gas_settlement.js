// Rozliczenie gazu w ukladzie faktury Orlen (www/gas_settlement.py, GET /report/gas/settlement?period=).
(function () {

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function num(v, digits) {
        if (v == null || isNaN(v)) { return ""; }
        return Number(v).toFixed(digits).replace(".", ",");
    }

    // wskazanie licznika: liczba calkowita jak na fakturze (ulamek, gdy wpisany) + typ odczytu
    function reading(r) {
        if (!r) { return ""; }
        var v = Math.abs(r.m3 - Math.round(r.m3)) < 0.0005 ? num(r.m3, 0) : num(r.m3, 3);
        return v + " " + r.type;
    }

    // doba wykazu obliczen: "DD.MM.YYYY" (pelna doba) albo "DD.MM.YYYY HH:MM-HH:MM" (czesc doby)
    function dayText(from, to) {
        var date = from.slice(8, 10) + "." + from.slice(5, 7) + "." + from.slice(0, 4);
        var end = to.slice(0, 10) > from.slice(0, 10) ? "24:00" : to.slice(11, 16);
        return from.slice(11, 16) === "00:00" && end === "24:00" ? date : date + " " + from.slice(11, 16) + "–" + end;
    }

    function td(v, right, strong) {
        return "<td" + (right ? " class=\"align-right\"" : "") + (strong ? " style=\"font-weight:600\"" : "") + ">" + v + "</td>";
    }

    var LEGEND = "Typ wskazania: R - odczyt licznika wpisany na ekranie Odczyty liczników (na granicy okresu - odczyt o 00:00); " +
        "O - wskazanie z obliczonym zużyciem gazu w EMS: ostatni odczyt R + zużycie po nim (do), pierwszy odczyt R - zużycie przed nim (od). " +
        "Zużycie między odczytami R liczone z licznika, poza nimi - z obliczeń EMS.";

    function render(d) {
        var p = d.period;
        el("gs-label").textContent = p.label + (p.running ? " (okres trwa - stan na dziś)" : "");

        var select = el("gs-period");
        select.innerHTML = d.periods.map(function (o) {
            return "<option value=\"" + esc(o.start) + "\"" + (o.start === p.start ? " selected" : "") + ">" + esc(o.label) + "</option>";
        }).join("");

        el("gs-lines").innerHTML = d.lines.map(function (l) {
            var meter = !!l.read_from || !!l.read_to;
            return "<tr>" + td(esc(l.name)) + td(esc(l.meter)) + td(esc(l.group)) + td(l.from, true) + td(l.to, true) +
                td(meter ? reading(l.read_from) : "", true) + td(meter ? reading(l.read_to) : "", true) +
                td(l.m3 != null ? num(l.m3, l.m3 % 1 ? 3 : 0) + " m³" : "", true) + td(l.conv != null ? num(l.conv, 3) : "", true) +
                td(l.unit === "mc" ? num(l.qty, 4) : num(l.qty, 0), true) + td(esc(l.unit)) +
                td(num(l.price, 5), true) + td(num(l.vat_pct, 0), true) + td(num(l.net, 2), true) + "</tr>";
        }).join("") +
            "<tr><td colspan=\"13\"><b>Razem sprzedaż w okresie rozliczeniowym od " + p.from + " do " + p.to + "</b></td>" +
            td(num(d.net, 2), true, true) + "</tr>";

        el("gs-totals").innerHTML =
            "<tr>" + td("Sprzedaż VAT " + num(d.config.vat_pct, 0) + "%") + td(num(d.net, 2), true) + td(num(d.vat, 2), true) + td(num(d.gross, 2), true) + "</tr>" +
            "<tr>" + td("<b>Do zapłaty</b>") + "<td></td><td></td>" + td(num(d.gross, 2) + " zł", true, true) + "</tr>";

        var parts = d.segments.map(function (g) {
            return g.from + "-" + g.to + " " + (g.source === "meter" ? "z licznika" : "szacunek EMS") + " " + num(g.m3, 2) + " m³";
        }).join(", ");
        el("gs-legend").textContent = "Razem zużycie: " + num(d.m3, d.m3 % 1 ? 3 : 0) + " m³, " + d.kwh + " kWh (" + parts + "). " +
            (d.segments.some(function (g) { return g.source === "meter"; }) ? "" : "Brak odczytów R w okresie - całość z obliczeń EMS. ") + LEGEND;

        // obliczone zuzycie EMS - tylko gdy w rozliczeniu sa odcinki z obliczen (wskazanie "O" albo brak odczytow)
        var c = d.computed_total;
        el("gs-ems-panel").style.display = c ? "" : "none";
        if (c) {
            el("gs-ems").innerHTML = d.computed.map(function (e) {
                var hm = function (at) { return at.slice(11, 13) + at.slice(14, 16); };
                var to = e.to_at.slice(0, 10) > e.from_at.slice(0, 10) ? "2400" : hm(e.to_at);
                var attrs = " class=\"gs-day\" style=\"cursor:pointer\" data-date=\"" + e.from_at.slice(0, 10) +
                    "\" data-from=\"" + hm(e.from_at) + "\" data-to=\"" + to + "\"";
                return emsRow("<span class=\"gs-arrow\">▸</span> " + dayText(e.from_at, e.to_at), e, false, attrs);
            }).join("") + emsRow("<b>Razem</b>", c, true);
            el("gs-ems-hint").textContent = "Zużycie z pracy kotła doliczone do rozliczenia (wskazanie O). Kliknij dobę, " +
                "aby zobaczyć zużycie w poszczególnych godzinach. Płomień " + num(c.flame_h, 1) + " h, z korektą " +
                num(d.config.calibration, 3) + " (Symulacja kosztów gazu).";
        }
    }

    function emsRow(label, e, strong, attrs) {
        return "<tr" + (attrs || "") + ">" + td(label) + td(num(e.ch_m3, 2), true, strong) + td(num(e.ch_kwh, 1), true, strong) +
            td(num(e.dhw_m3, 2), true, strong) + td(num(e.dhw_kwh, 1), true, strong) +
            td(num(e.m3, 2), true, strong) + td(num(e.gas_kwh, 1), true, strong) + "</tr>";
    }

    // zuzycie godzinami w dobie - doczytywane po kliknieciu wiersza doby (GET /report/gas/settlement/hours)
    function toggleDay(tr) {
        var open = tr.dataset.open === "1";
        var next = tr.nextElementSibling;
        while (next && next.classList.contains("gs-run")) {
            var rm = next;
            next = next.nextElementSibling;
            rm.parentNode.removeChild(rm);
        }
        tr.dataset.open = open ? "" : "1";
        tr.querySelector(".gs-arrow").textContent = open ? "▸" : "▾";
        if (open) { return; }

        var wait = document.createElement("tr");
        wait.className = "gs-run";
        wait.innerHTML = "<td colspan=\"7\" class=\"history-empty\">Wczytywanie…</td>";
        tr.parentNode.insertBefore(wait, tr.nextSibling);

        fetch("/report/gas/settlement/hours?date=" + tr.dataset.date + "&from=" + tr.dataset.from + "&to=" + tr.dataset.to)
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var hours = res.hours || [];
                var html = hours.length ? hours.map(function (u) {
                    return emsRow("<span style=\"padding-left:22px\">" + u.from + "–" + u.to + " (płomień " + u.flame_min + " min)</span>", u)
                        .replace("<tr>", "<tr class=\"gs-run\" style=\"opacity:.7\">");
                }).join("") : "<tr class=\"gs-run\"><td colspan=\"7\" class=\"history-empty\">Brak pracy palnika</td></tr>";
                var tmp = document.createElement("tbody");
                tmp.innerHTML = html;
                if (!wait.parentNode) { return; }
                while (tmp.firstChild) { wait.parentNode.insertBefore(tmp.firstChild, wait); }
                wait.parentNode.removeChild(wait);
            })
            .catch(function () { wait.firstChild.textContent = "Błąd odczytu"; });
    }

    el("gs-ems").addEventListener("click", function (ev) {
        var tr = ev.target.closest("tr.gs-day");
        if (tr) { toggleDay(tr); }
    });

    function load(period) {
        return fetch("/report/gas/settlement" + (period ? "?period=" + encodeURIComponent(period) : ""))
            .then(function (r) { return r.json(); }).then(render).catch(function () {
                el("gs-lines").innerHTML = "<tr><td colspan=\"14\" class=\"history-empty\">Błąd odczytu</td></tr>";
            });
    }

    el("gs-period").addEventListener("change", function () { load(this.value); });

    load();
})();
