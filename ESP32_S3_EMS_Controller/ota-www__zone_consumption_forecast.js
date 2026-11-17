(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function fmtKwh(wh) {
        return wh == null ? "-" : (wh / 1000.0).toFixed(2) + " kWh";
    }

    function devClass(pct) {
        if (pct == null) { return ""; }
        var abs = Math.abs(pct);
        if (abs >= 20) { return " deviation-high"; }
        if (abs >= 10) { return " deviation-warn"; }
        return "";
    }

    // odchylenie estymaty modelu wzgledem rzeczywistego zuzycia TEGO
    // SAMEGO dnia w danym okresie - null, jesli brak jednej z wartosci
    function deviationPct(estimate, actual) {
        if (estimate == null || actual == null || estimate === 0) { return null; }
        return (actual - estimate) / estimate * 100;
    }

    var WEEKDAY_LABELS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];

    var lookbackInput = el("zone-forecast-lookback");
    var lookbackAvailableEl = el("zone-forecast-lookback-available");
    var trimSelect = el("zone-forecast-trim");
    var percentileSelect = el("zone-forecast-percentile");
    var weekdaysWrap = el("zone-forecast-weekdays");
    var weekdayCheckboxes = weekdaysWrap.querySelectorAll("input[type=checkbox]");
    var workdaysButton = el("zone-forecast-weekdays-workdays");
    var weekendButton = el("zone-forecast-weekdays-weekend");
    var showButton = el("zone-forecast-show");
    var statusEl = el("zone-forecast-status");
    var zonePanel = el("zone-forecast-zone-panel");
    var zoneTitleEl = el("zone-forecast-zone-title");
    var periodsPanel = el("zone-forecast-periods-panel");
    var periodsContent = el("zone-forecast-periods-content");

    // JS Date.getDay(): 0=Niedziela..6=Sobota - przeliczenie na
    // konwencje backendu (0=Poniedzialek..6=Niedziela, patrz
    // ems/consumption_history.py::weekday())
    function todayWeekday() {
        var jsDay = new Date().getDay();
        return (jsDay + 6) % 7;
    }

    function setWeekdayCheckboxes(selected) {
        weekdayCheckboxes.forEach(function (cb) {
            cb.checked = selected.indexOf(parseInt(cb.value, 10)) !== -1;
        });
    }

    function selectedWeekdays() {
        var selected = [];
        weekdayCheckboxes.forEach(function (cb) {
            if (cb.checked) { selected.push(parseInt(cb.value, 10)); }
        });
        return selected;
    }

    workdaysButton.addEventListener("click", function () {
        setWeekdayCheckboxes([0, 1, 2, 3, 4]);
    });

    weekendButton.addEventListener("click", function () {
        setWeekdayCheckboxes([5, 6]);
    });

    // ==================================================
    // RENDEROWANIE - kazdy okres strefy wysokiej (np. rano/popoludnie
    // dla G12, cala doba dla G11) dostaje JEDNA tabele: kazdy wiersz to
    // dzien historyczny, z jego WLASNYM rzeczywistym zuzyciem w tym
    // okresie obok (STALYCH dla calego okresu) wartosci modeli A/B/D -
    // porownanie "model vs rzeczywistosc" wprost per dzien. Model C
    // (podobne dni tygodnia) pokazuje sie TYLKO w wierszach, ktorych
    // dzien tygodnia faktycznie nalezy do zaznaczonego zbioru - dla
    // pozostalych dni ta estymata jest nieadekwatna (liczona z innych
    // dni tygodnia), wiec zamiast myloncego porownania wychodzi "-".
    // ==================================================

    function renderPeriodTable(period, report) {

        var days = period.days || [];

        if (!days.length) {
            return "<div class=\"history-empty\">Brak dni historycznych z danymi w tym okresie.</div>";
        }

        var m = period.models;
        var weekdays = report.weekdays || [];

        // najnowsze pierwsze
        var rows = days.slice().reverse().map(function (day) {

            function cell(estimate) {
                var dev = deviationPct(estimate, day.total_wh);
                return "<td class=\"measurement-energy" + devClass(dev) + "\">" + fmtKwh(estimate) + "</td>";
            }

            var matchesWeekday = weekdays.indexOf(day.weekday) !== -1;

            return "<tr>" +
                "<td>" + day.date + " (" + WEEKDAY_LABELS[day.weekday] + ")</td>" +
                cell(m.a.total_wh) +
                cell(m.b.total_wh) +
                (matchesWeekday ? cell(m.c.total_wh) : "<td class=\"measurement-energy\">-</td>") +
                cell(m.d.total_wh) +
                "<td class=\"measurement-energy\">" + fmtKwh(day.total_wh) + "</td>" +
                "</tr>";
        }).join("");

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Dzień</th><th class=\"align-right\">Model A</th><th class=\"align-right\">Model B</th><th class=\"align-right\">Model C</th><th class=\"align-right\">Model D</th><th class=\"align-right\">Rzeczywiste</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
            "</table></div>";
    }

    function renderPeriodLegend(period, report) {

        return "<div class=\"settings-hint\">" +
            "Model A - średnia (" + period.days_used + " dni) · " +
            "Model B - trymowana średnia (" + report.trim_pct + "%) · " +
            "Model C - podobne dni tygodnia (" + report.weekdays.map(function (w) { return WEEKDAY_LABELS[w]; }).join(", ") + " - " + period.models.c.days_used + " dni, widoczny tylko w pasujących wierszach) · " +
            "Model D - " + report.percentile_pct + ". centyl" +
            "</div>";
    }

    function renderPeriod(period, report) {

        return "<div class=\"settings-panel-title\">Okres: " + escapeHtml(period.label) + "</div>" +
            renderPeriodLegend(period, report) +
            renderPeriodTable(period, report);
    }

    function renderReport(report) {

        zoneTitleEl.textContent = "Taryfa " + report.tariff_name + " - strefa \"" + report.zone_name + "\"";
        zonePanel.hidden = false;

        periodsContent.innerHTML = report.periods.map(function (period) {
            return renderPeriod(period, report);
        }).join("<hr>");

        periodsPanel.hidden = false;
    }

    var ERROR_MESSAGES = {
        "no_active_tariff": "Brak skonfigurowanej aktywnej taryfy - ustaw ją na /config/tariffs.",
        "tariff_without_zones": "Aktywna taryfa nie ma zdefiniowanej żadnej strefy.",
    };

    function loadReport() {

        var weekdays = selectedWeekdays();

        if (!weekdays.length) {
            statusEl.textContent = "Zaznacz przynajmniej jeden dzień tygodnia dla Modelu C.";
            statusEl.className = "settings-message error";
            return;
        }

        statusEl.textContent = "Wczytywanie…";
        statusEl.className = "settings-message";
        zonePanel.hidden = true;
        periodsPanel.hidden = true;

        var url = "/report/energy/forecast/zones?trim=" + encodeURIComponent(trimSelect.value) +
            "&percentile=" + encodeURIComponent(percentileSelect.value) +
            "&lookback=" + encodeURIComponent(lookbackInput.value || "60") +
            "&weekdays=" + encodeURIComponent(weekdays.join(","));

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (report) {

                if (report.error) {
                    statusEl.textContent = "Błąd: " + (ERROR_MESSAGES[report.error] || report.error);
                    statusEl.className = "settings-message error";
                    return;
                }

                statusEl.textContent = "";

                renderReport(report);
            })
            .catch(function () {
                statusEl.textContent = "Błąd wczytywania prognozy.";
                statusEl.className = "settings-message error";
            });
    }

    showButton.addEventListener("click", loadReport);

    // ==================================================
    // DOMYSLNE WARTOSCI - dzien tygodnia dopasowany do dzisiaj (okno
    // historyczne konczy sie i tak na wczoraj, patrz backend). Bez
    // auto-fetch - dopiero po "Przelicz" (ten sam wzorzec co
    // /report/energy/forecast/view).
    // ==================================================

    setWeekdayCheckboxes([todayWeekday()]);

    // "max" pola okna historycznego = faktyczna liczba dni z danymi w
    // consumption_log/ (patrz core/routes.py GET /report/energy/forecast/meta,
    // wspolne z prognoza godzinowa - nie zalezy od stref/taryfy)
    fetch("/report/energy/forecast/meta")
        .then(function (r) { return r.json(); })
        .then(function (meta) {

            var available = meta.available_days || 0;

            if (available > 0) {

                lookbackInput.max = String(available);

                if (parseInt(lookbackInput.value, 10) > available) {
                    lookbackInput.value = String(available);
                }

                lookbackAvailableEl.textContent = "Dostępnych dni z danymi: " + available +
                    (meta.oldest_date ? " (od " + meta.oldest_date + " do " + meta.newest_date + ")" : "") + ".";
            } else {
                lookbackAvailableEl.textContent = "Brak jeszcze zebranej historii zużycia.";
            }
        })
        .catch(function () { /* brak metadanych - zostaw domyslny max */ });
})();
