// Symulacja kosztow gazu (www/gas_report.py): dzis, okres rozliczeniowy i dni okresu - wyliczone z pracy kotla
// (GET /report/gas, ems/boiler_monitor.py) i porownanie z odczytami licznika z korekta. Ceny -
// Konfiguracja -> Taryfa gazowa, odczyty licznika - Odczyty liczników.
(function () {

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function num(v, digits) {
        if (v == null || isNaN(v)) { return "-"; }
        return Number(v).toFixed(digits).replace(".", ",");
    }

    function row(cells, strong) {
        return "<tr" + (strong ? " style=\"font-weight:600\"" : "") + ">" + cells.map(function (c, i) {
            return "<td" + (i ? " class=\"align-right\"" : "") + ">" + c + "</td>";
        }).join("") + "</tr>";
    }

    function summaryRows(s, fixed) {
        var html = row(["CO", num(s.ch_kwh, 2), num(s.ch_m3, 2), num(s.ch_pln, 2)]) +
            row(["CWU", num(s.dhw_kwh, 2), num(s.dhw_m3, 2), num(s.dhw_pln, 2)]) +
            row(["Razem (płomień " + num(s.flame_h, 1) + " h)", num(s.gas_kwh, 2), num(s.m3, 2), num(s.pln, 2)], !fixed);
        if (fixed) {
            html += row(["Opłaty stałe", "", "", num(s.fixed_pln, 2)]) +
                row(["Do zapłaty (szacunek)", "", "", num(s.total_pln, 2)], true);
        }
        return html;
    }

    function render(d) {
        var cfg = d.config;

        el("gas-today-date").textContent = d.today.date;
        el("gas-today-body").innerHTML = summaryRows(d.today, false);
        el("gas-period-label").textContent = d.period.label;
        el("gas-period-body").innerHTML = summaryRows(d.period, true);

        var sample = d.last_sample || {};
        el("gas-model-hint").textContent = (d.boiler.interface !== "diyless" ? "Kocioł nie jest podłączony przez DIYLESS - brak pomiaru. " : "") +
            "Moc kotła z modulacji: " + num(d.boiler.min_kw, 1) + " kW przy 0% do " + num(d.boiler.max_kw, 1) +
            " kW przy 100% (Parametry CO), gaz = ciepło / sprawność " + num(cfg.efficiency_pct, 0) + "% × korekta " +
            num(cfg.calibration, 3) + ", cena " + num(cfg.price_kwh, 4) + " zł/kWh brutto. Dane z " + d.history_days + " dni." +
            (sample.ts ? " Ostatni odczyt: płomień " + (sample.flame ? "WŁ, modulacja " + num(sample.mod, 0) + "%, " +
                num(sample.power_kw, 1) + " kW" + (sample.dhw ? " (CWU)" : " (CO)") : "WYŁ") : "") +
            (sample.error ? " Błąd odczytu: " + sample.error : "");

        el("gas-days-body").innerHTML = d.days.length ? d.days.slice().reverse().map(function (day) {
            return row([day.date, num(day.ch_m3, 2), num(day.dhw_m3, 2), num(day.m3, 2), num(day.pln, 2), num(day.flame_h, 1)]);
        }).join("") : "<tr><td colspan=\"6\" class=\"history-empty\">Brak danych w tym okresie</td></tr>";

        var cmp = d.comparison;
        el("gas-pairs-body").innerHTML = cmp.pairs.length ? cmp.pairs.map(function (p) {
            return row([esc(p.from), esc(p.to), num(p.actual_m3, 3), num(p.calc_m3, 3), num(p.calc_cal_m3, 3),
                p.ratio == null ? "-" : num(p.ratio, 3), p.days_with_data]);
        }).join("") : "<tr><td colspan=\"7\" class=\"history-empty\">Potrzebne co najmniej dwa odczyty licznika</td></tr>";

        var text = cmp.meter_estimate ? "Szacowany stan licznika teraz: " + num(cmp.meter_estimate.m3, 3) + " m³. " : "";
        text += "Korekta: " + num(cfg.calibration, 3) +
            (cmp.suggested_calibration != null ? ", sugerowana z odczytów: " + num(cmp.suggested_calibration, 3) + "." : ".");
        el("gas-calibration-text").textContent = text;
        el("gas-calibrate").hidden = cmp.suggested_calibration == null || cmp.suggested_calibration === cfg.calibration;
    }

    function load() {
        return fetch("/report/gas").then(function (r) { return r.json(); }).then(render).catch(function () {
            el("gas-today-body").innerHTML = "<tr><td colspan=\"4\" class=\"history-empty\">Błąd odczytu</td></tr>";
        });
    }

    el("gas-calibrate").addEventListener("click", function () {
        fetch("/report/gas/calibrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
            .then(function (r) { return r.json(); }).then(function (res) {
                if (res.error) { alert("Błąd: " + res.error); return; }
                load();
            });
    });

    load();
    setInterval(load, 60000);
})();
