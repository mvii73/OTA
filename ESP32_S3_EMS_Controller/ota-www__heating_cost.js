// Koszt ogrzewania (www/heating_cost.py, GET /report/heating/cost?from=YYYY-MM-DD&to=YYYY-MM-DD).
(function () {

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function num(v, digits) {
        if (v == null || isNaN(v)) { return "–"; }
        return Number(v).toFixed(digits).replace(".", ",");
    }

    function td(v, right, strong) {
        return "<td" + (right ? " class=\"align-right\"" : "") + (strong ? " style=\"font-weight:600\"" : "") + ">" + v + "</td>";
    }

    function th(v, right, attrs) {
        return "<th" + (right ? " class=\"align-right\"" : "") + (attrs || "") + ">" + v + "</th>";
    }

    function pad2(n) { return n < 10 ? "0" + n : String(n); }
    function iso(y, m, d) { return y + "-" + pad2(m) + "-" + pad2(d); }
    function lastDay(y, m) { return new Date(y, m, 0).getDate(); }

    function setMonth(y, m) {
        var now = new Date();
        var last = lastDay(y, m);
        if (y === now.getFullYear() && m === now.getMonth() + 1) { last = now.getDate(); }
        el("hc-from").value = iso(y, m, 1);
        el("hc-to").value = iso(y, m, last);
    }

    function shownMonth() {
        var v = el("hc-from").value || iso(new Date().getFullYear(), new Date().getMonth() + 1, 1);
        return [Number(v.slice(0, 4)), Number(v.slice(5, 7))];
    }

    function shiftMonth(delta) {
        var ym = shownMonth();
        var m = ym[1] + delta, y = ym[0];
        if (m < 1) { m = 12; y -= 1; }
        if (m > 12) { m = 1; y += 1; }
        setMonth(y, m);
        load();
    }

    function dayLabel(date) {
        var d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
        return date.slice(8, 10) + "." + date.slice(5, 7) + " " + ["nd", "pn", "wt", "śr", "cz", "pt", "sb"][d.getDay()];
    }

    // srednia temperatura okresu - z dni z odczytem
    function avgTemp(days) {
        var known = days.filter(function (r) { return r.outdoor_c != null; });
        return known.length ? known.reduce(function (a, r) { return a + r.outdoor_c; }, 0) / known.length : null;
    }

    // legenda tabeli: [[pozycja, opis]] - pozycja z pustym opisem to naglowek grupy
    function legend(items) {
        return items.map(function (it) {
            return it[1] ? "<div style=\"padding:2px 0\"><b>" + it[0] + "</b> - " + it[1] + "</div>"
                : "<div style=\"padding:6px 0 2px; text-transform:uppercase; letter-spacing:.04em\">" + it[0] + "</div>";
        }).join("");
    }

    function cells(r, zoneCount, strong) {
        var html = td(num(r.gas_ch_kwh, 2), true, strong) + td(num(r.gas_dhw_kwh, 2), true, strong) +
            td(num(r.gas_m3, 2), true, strong) +
            td(num(r.el_heater_kwh, 2), true, strong) + td(num(r.el_pump_kwh, 2), true, strong) +
            td(num(r.el_dhw_kwh, 2), true, strong) +
            td(num(r.pv_kwh, 2), true, strong) + td(num(r.bat_kwh, 2), true, strong);
        for (var i = 0; i < zoneCount; i++) { html += td(num(r.zones_kwh[i], 2), true, strong); }
        return html + td(num(r.cost, 2), true, true) + td(num(r.cost_all_gas, 2), true, strong) +
            td(num(r.cost_all_cheap, 2), true, strong);
    }

    function render(d) {
        var zones = d.zones || [];
        var zn = zones.length;
        var center = " style=\"text-align:center\"";

        el("hc-head").innerHTML =
            "<tr>" + th("", false, " rowspan=\"2\"") +
            th("Gaz (kWh)", false, " colspan=\"2\"" + center) + th("Gaz", true) +
            th("Prąd CO (kWh)", false, " colspan=\"2\"" + center) + th("Prąd CWU (kWh)", true) +
            th("Źródło prądu (kWh)", false, " colspan=\"" + (2 + zn) + "\"" + center) +
            th("Koszt rzeczywisty (zł)", true, " rowspan=\"2\"") + th("Koszt hipotetyczny (zł)", false, " colspan=\"2\"" + center) + th("RCE max", true) + th("Temp. zewn.", true) + "</tr>" +
            "<tr>" + th("CO", true) + th("CWU", true) + th("m³", true) +
            th("dogrzewacz", true) + th("pompa", true) + th("zasobnik", true) +
            th("PV", true) + th("bateria", true) +
            zones.map(function (z) { return th("sieć " + esc(z.name), true); }).join("") +
            th("całość gaz", true) + th("całość " + esc(d.cheapest_zone || "tania strefa"), true) +
            th("PLN/kWh", true) + th("śr. dobowa °C", true) + "</tr>";

        var anyNoSplit = false, anyNoRce = false;
        el("hc-days").innerHTML = d.days.map(function (r) {
            anyNoSplit = anyNoSplit || r.no_split;
            anyNoRce = anyNoRce || !r.rce_known;
            return "<tr>" + td(dayLabel(r.date) + (r.today ? " (dziś)" : "") + (r.no_split ? " *" : "")) + cells(r, zn) +
                td(num(r.rce_max / 1000, 4) + (r.rce_known ? "" : " **"), true) + td(num(r.outdoor_c, 1) + (r.outdoor_src === "meteo" ? " m" : ""), true) + "</tr>";
        }).join("") + "<tr>" + td("<b>Razem</b>") + cells(d.total, zn, true) + "<td></td>" + td(num(avgTemp(d.days), 1), true, true) + "</tr>";

        var missing = [];
        if (!d.devices.heater) { missing.push("dogrzewacza (Ogrzewanie)"); }
        if (!d.devices.pump) { missing.push("pompy obiegowej (Ogrzewanie)"); }
        if (!d.devices.dhw) { missing.push("grzałki zasobnika (Podgrzewacz wody)"); }
        el("hc-days-hint").textContent = "Gaz z pracy kotła (po korekcie). Prąd z pomiarów urządzeń; źródło w blokach strefy " +
            "taryfy " + (d.tariff_name || "") + ": dom ma pierwszeństwo do PV i baterii, ogrzewanie dostaje ich resztę, " +
            "pozostałe z sieci. Koszt hipotetyczny: całe ciepło (gaz × sprawność " + num(d.efficiency_pct, 0) +
            "% + prąd dogrzewacza i grzałki) z gazu albo z sieci w strefie " + (d.cheapest_zone || "-") +
            "; pompa obiegowa w obu wariantach po koszcie rzeczywistym. Ceny brutto, bez opłat stałych." +
            (anyNoSplit ? " * - brak rozbicia zużycia z Deye Cloud (dzień jeszcze nieuzupełniony) - prąd liczony jak z sieci." : "") +
            " PV i ładowanie baterii z PV nie generują kosztu (0,00). RCE max - najwyższa cena RCE doby (EMS sprzedaje w najdroższej godzinie) - " +
            "z niej informacyjna wartość depozytu za PV zużyte na grzanie." +
            (anyNoRce ? " ** - brak RCE dnia w pamięci cen PSE - użyte RCE max poprzedniego znanego dnia." : "") +
            " Temp. zewn. - średnia dobowa z próbek kontrolera co 5 min (czujnik albo Open-Meteo wg ustawień ogrzewania); " +
            "m - dzień bez pełnych próbek, średnia dobowa z historii Open-Meteo. W wierszu Razem - średnia dni z odczytem." +
            (missing.length ? " Brak przypisanego urządzenia: " + missing.join(", ") + "." : "");

        // ceny i zrodla
        el("hc-prices").innerHTML = d.sources.map(function (s) {
            var mark = s.info ? " (informacyjnie)" : s.cheapest ? " (najtańsze)" : s.most_expensive ? " (najdroższe)" : "";
            return "<tr>" + td(esc(s.name) + mark) + td(num(s.price_kwh, 4), true) +
                td(s.price_full != null ? num(s.price_full, 4) : "", true) + td(num(s.heat_price, 4), true) +
                td(num(s.heat_kwh, 2), true) + td(num(s.cost, 2), true) + "</tr>";
        }).join("");

        var t = d.total;
        el("hc-costs").innerHTML =
            "<tr>" + td("Gaz") + td(num(t.cost_gas, 2), true) + "</tr>" +
            "<tr>" + td("Prąd (dogrzewacz, pompa, grzałka)") + td(num(t.cost_el, 2), true) + "</tr>" +
            "<tr>" + td("<b>Koszt rzeczywisty</b>") + td(num(t.cost, 2) + " zł", true, true) + "</tr>" +
            "<tr>" + td("Gdyby całość z gazu") + td(num(t.cost_all_gas, 2), true) + "</tr>" +
            "<tr>" + td("Gdyby całość z sieci w strefie " + esc(d.cheapest_zone || "-")) + td(num(t.cost_all_cheap, 2), true) + "</tr>";

        el("hc-gains").innerHTML = d.sources.filter(function (s) { return !s.info; }).map(function (s) {
            return "<tr>" + td(esc(s.name)) + td(s.loss == null ? "" : num(s.loss, 2), true) +
                td(s.benefit == null ? "" : num(s.benefit, 2), true) +
                td(s.vs_gas == null ? "" : num(s.vs_gas, 2), true) + "</tr>";
        }).join("") + "<tr>" + td("<b>Razem</b>") + td(num(d.loss, 2), true, true) + td(num(d.benefit, 2), true, true) +
            td(num(d.vs_gas, 2), true, true) + "</tr>";

        var dep = num(d.deposit_value_pct, 0) + "%";
        var eff = num(d.efficiency_pct, 0) + "%";
        var cheap = esc(d.cheapest_zone || "-");

        el("hc-prices-legend").innerHTML = legend([
            ["Kolumny", ""],
            ["PLN / kWh (z depozytem)", "realny koszt 1 kWh energii ze źródła, brutto, bez opłat stałych (abonamentów). " +
                "Dla baterii - średnia z okresu ważona zużyciem."],
            ["Pełna cena PLN / kWh", "cena strefy z taryfy (energia + opłaty zmienne, brutto) - tyle, gdyby nie było depozytu."],
            ["PLN / kWh ciepła", "koszt 1 kWh ciepła oddanego do instalacji. Gaz: cena gazu / sprawność kotła (" + eff +
                "). Prąd: równa cenie kWh (grzałka zamienia prąd w ciepło 1:1). Na tej kolumnie porównywane są źródła."],
            ["Ciepło w okresie", "ile ciepła dało źródło: gaz - zużycie gazu × sprawność, prąd - kWh dogrzewacza i grzałki " +
                "(bez pompy obiegowej)."],
            ["Koszt ciepła", "ciepło × cena kWh ciepła, czyli ile kosztowało ciepło z tego źródła."],
            ["Wiersze", ""],
            ["Gaz", "paliwo gazowe + dystrybucja zmienna z VAT (Taryfa gazowa)."],
            ["Prąd - PV sprzedaż depozytu", "tylko informacyjnie, nie wchodzi do kosztów ani do porównania źródeł: ile depozytu " +
                "dałaby energia PV zużyta na grzanie, gdyby poszła do sieci - najwyższe RCE doby (EMS sprzedaje w najdroższej " +
                "godzinie) × 1,23 × wartość depozytu " + dep + " (wykup)."],
            ["Prąd - PV", "nadwyżka PV ponad zużycie domu w bloku strefy, zużyta na grzanie - koszt 0,00 (własna produkcja). " +
                "Poza oznaczeniem najtańsze / najdroższe."],
            ["Prąd - bateria", "energia z baterii, której nie potrzebował dom. Koszt = średni koszt energii zgromadzonej " +
                "w baterii / sprawność cyklu. Ładowanie w strefie " + cheap + " - z sieci, po cenie sieci w tej strefie; " +
                "w pozostałych strefach - z nadwyżki PV, po 0,00. Sprawność cyklu " + num(d.battery_eff_pct, 0) + "%. " +
                "Poza oznaczeniem najtańsze / najdroższe."],
            ["Prąd z sieci - strefa", "reszta prądu grzania, pobrana z sieci w danej strefie. Energia pokryta z depozytu - " +
                (d.grid_energy_pct ? "płatne opłaty zmienne + " + num(d.grid_energy_pct, 0) + "% ceny energii."
                    : "płatne tylko opłaty zmienne (dystrybucja).")],
            ["(najtańsze) / (najdroższe)", "źródło o najniższej / najwyższej cenie kWh ciepła w okresie (bez PV i baterii)."],
        ]);

        el("hc-costs-legend").innerHTML = legend([
            ["Gaz / Prąd", "rzeczywisty koszt gazu i prądu (dogrzewacz, pompa, grzałka) w okresie, po cenach z tabeli wyżej."],
            ["Koszt rzeczywisty", "suma gazu i prądu - tyle faktycznie kosztowało ogrzewanie i CWU."],
            ["Gdyby całość z gazu", "całe ciepło (z gazu i z prądu) wytworzone w kotle gazowym, po cenie kWh ciepła z gazu."],
            ["Gdyby całość z sieci w strefie " + cheap, "całe ciepło z prądu z sieci w najtańszej strefie."],
            ["Pompa obiegowa", "w obu wariantach hipotetycznych po koszcie rzeczywistym (" + num(d.pump_cost, 2) +
                " zł) - nie daje ciepła, pracuje z dogrzewaczem."],
        ]);

        el("hc-gains-legend").innerHTML = legend([
            ["Strata wobec najtańszego źródła", "ile przepłacono, grzejąc tym źródłem zamiast najtańszym: " +
                "ciepło × (cena kWh ciepła źródła − cena najtańszego). Dla najtańszego - 0. PV i bateria - poza porównaniem (puste)."],
            ["Korzyść wobec najdroższego źródła", "ile zaoszczędzono, grzejąc tym źródłem zamiast najdroższym: " +
                "ciepło × (cena najdroższego − cena źródła). Dla najdroższego - 0."],
            ["Korzyść wobec gazu", "ile zaoszczędzono, grzejąc prądem z tego źródła zamiast gazem: ciepło × (cena kWh ciepła " +
                "z gazu − cena źródła). Ujemna - prąd z tego źródła był droższy od gazu. PV - z kosztem 0,00, czyli całe " +
                "ciepło × cena kWh ciepła z gazu."],
            ["Razem - strata", "ile przepłacono w okresie względem grzania całego ciepła najtańszym źródłem - tyle można by jeszcze " +
                "zaoszczędzić, przesuwając grzanie na tańsze źródło (gaz albo strefę sieci; bez PV i baterii)."],
            ["Razem - korzyść wobec najdroższego", "ile w okresie zaoszczędzono względem grzania całego ciepła najdroższym " +
                "źródłem (gaz albo strefa sieci; bez PV i baterii)."],
            ["Razem - korzyść wobec gazu", "ile w okresie zaoszczędziło grzanie prądem zamiast gazem; ujemna - prąd wyszedł " +
                "w sumie drożej."],
        ]);

        el("hc-days-panel").hidden = false;
        el("hc-summary-panel").hidden = false;
    }

    function load() {
        var from = el("hc-from").value, to = el("hc-to").value;
        if (!from || !to) { return; }
        el("hc-status").textContent = "Liczenie…";
        fetch("/report/heating/cost?from=" + from + "&to=" + to)
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.error) {
                    el("hc-status").textContent = d.error === "range_too_long" ? "Za długi okres (najwyżej " + d.max_days + " dni)" : "Błędny okres";
                    return;
                }
                el("hc-status").textContent = "";
                render(d);
            })
            .catch(function () { el("hc-status").textContent = "Błąd odczytu"; });
    }

    el("hc-prev-month").addEventListener("click", function () { shiftMonth(-1); });
    el("hc-next-month").addEventListener("click", function () { shiftMonth(1); });
    el("hc-current-month").addEventListener("click", function () {
        var now = new Date();
        setMonth(now.getFullYear(), now.getMonth() + 1);
        load();
    });
    el("hc-show").addEventListener("click", load);

    var now = new Date();
    setMonth(now.getFullYear(), now.getMonth() + 1);
    load();
})();
