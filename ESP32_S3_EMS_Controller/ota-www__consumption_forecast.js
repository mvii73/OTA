(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function fmtWh(wh) {
        return wh == null ? "-" : Math.round(wh) + " Wh";
    }

    function fmtKwh(wh) {
        return wh == null ? "-" : (wh / 1000.0).toFixed(2) + " kWh";
    }

    function fmtDev(pct) {
        if (pct == null) { return "-"; }
        var sign = pct > 0 ? "+" : "";
        return sign + pct.toFixed(1) + "%";
    }

    // roznica rzeczywiste - estymata, w jednostce wiersza (Wh/kWh) i w %
    function fmtDiff(estimate, actual, kwh) {
        if (estimate == null || actual == null) { return "-"; }
        var diff = actual - estimate;
        var sign = diff > 0 ? "+" : "";
        var text = kwh ? sign + (diff / 1000.0).toFixed(2) + " kWh" : sign + Math.round(diff) + " Wh";
        var pct = deviationPct(estimate, actual);
        return pct == null ? text : text + " (" + fmtDev(pct) + ")";
    }

    function devClass(pct) {
        if (pct == null) { return ""; }
        var abs = Math.abs(pct);
        if (abs >= 20) { return " deviation-high"; }
        if (abs >= 10) { return " deviation-warn"; }
        return "";
    }

    // odchylenie estymaty modelu/dnia wzgledem rzeczywistego zuzycia
    // dnia X - null, jesli brak jednej z wartosci (np. X jeszcze nie
    // ma danych dla tej godziny/w ogole)
    function deviationPct(estimate, actual) {
        if (estimate == null || actual == null || estimate === 0) { return null; }
        return (actual - estimate) / estimate * 100;
    }

    var WEEKDAY_LABELS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];

    var dateInput = el("forecast-date");
    var lookbackInput = el("forecast-lookback");
    var lookbackAvailableEl = el("forecast-lookback-available");
    var trimSelect = el("forecast-trim");
    var percentileSelect = el("forecast-percentile");
    var estimateSelect = el("forecast-estimate");
    var daysHint = el("forecast-days-hint");
    var weekdaysWrap = el("forecast-weekdays");
    var weekdayCheckboxes = weekdaysWrap.querySelectorAll("input[type=checkbox]");
    var workdaysButton = el("forecast-weekdays-workdays");
    var weekendButton = el("forecast-weekdays-weekend");
    var showButton = el("forecast-show");
    var statusEl = el("forecast-status");
    var modelsPanel = el("forecast-models-panel");
    var modelsContent = el("forecast-models-content");
    var daysPanel = el("forecast-days-panel");
    var daysContent = el("forecast-days-content");

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    function fmtDate(y, m, d) {
        return y + "-" + pad2(m) + "-" + pad2(d);
    }

    function todayParts() {
        var now = new Date();
        return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    }

    // JS Date.getDay(): 0=Niedziela..6=Sobota - przeliczenie na
    // konwencje backendu (0=Poniedzialek..6=Niedziela, patrz
    // ems/consumption_forecast.py::_weekday())
    function weekdayOf(dateStr) {
        var parts = dateStr.split("-").map(Number);
        var jsDay = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
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

    dateInput.addEventListener("change", function () {
        if (dateInput.value) {
            setWeekdayCheckboxes([weekdayOf(dateInput.value)]);
        }
    });

    workdaysButton.addEventListener("click", function () {
        setWeekdayCheckboxes([0, 1, 2, 3, 4]);
    });

    weekendButton.addEventListener("click", function () {
        setWeekdayCheckboxes([5, 6]);
    });

    // ==================================================
    // RENDEROWANIE - wspolny wzorzec "wiersz podsumowania + rozwijalna
    // tabela godzinowa" dla sekcji modeli i sekcji dni historycznych
    // (analogicznie do www/consumption_report.js/www/events_log.js)
    // ==================================================

    // opts.actualLabel - naglowek kolumny rzeczywistych, opts.diff -
    // odchylka jako roznica (Wh/kWh i %) zamiast samego %
    function renderHoursTable(hourly, xHourly, opts) {

        opts = opts || {};

        var rows = hourly.map(function (estimate, hour) {

            var actual = xHourly[hour];
            var dev = deviationPct(estimate, actual);

            return "<tr>" +
                "<td>" + hour + ":00</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(estimate) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(actual) + "</td>" +
                "<td class=\"measurement-energy" + devClass(dev) + "\">" + (opts.diff ? fmtDiff(estimate, actual, false) : fmtDev(dev)) + "</td>" +
                "</tr>";
        }).join("");

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Godzina</th><th class=\"align-right\">" + (opts.diff ? "Estymata" : "Wartość") + "</th><th class=\"align-right\">" + escapeHtml(opts.actualLabel || "X (rzeczywiste)") + "</th><th class=\"align-right\">Odchyłka</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
            "</table></div>";
    }

    function renderSummaryRow(key, label, totalWh, xTotalWh, hourly, xHourly, extraLabel, opts) {

        opts = opts || {};

        var dev = deviationPct(totalWh, xTotalWh);

        return "<tr data-forecast-toggle=\"" + key + "\" style=\"cursor:pointer\">" +
            "<td>" + escapeHtml(label) + (extraLabel ? " <span class=\"settings-hint\">" + escapeHtml(extraLabel) + "</span>" : "") + "</td>" +
            "<td class=\"measurement-energy\">" + fmtKwh(totalWh) + "</td>" +
            "<td class=\"measurement-energy\">" + fmtKwh(xTotalWh) + "</td>" +
            "<td class=\"measurement-energy" + devClass(dev) + "\">" + (opts.diff ? fmtDiff(totalWh, xTotalWh, true) : fmtDev(dev)) + "</td>" +
            "<td class=\"align-center\"><span class=\"settings-row-arrow\" data-forecast-arrow=\"" + key + "\">&#9662;</span></td>" +
            "</tr>" +
            "<tr hidden data-forecast-hours=\"" + key + "\"><td colspan=\"5\">" + renderHoursTable(hourly, xHourly, opts) + "</td></tr>";
    }

    function renderTable(rowsHtml, actualLabel) {
        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Opis</th><th class=\"align-right\">Estymata</th><th class=\"align-right\">" + escapeHtml(actualLabel || "X (rzeczywiste)") + "</th><th class=\"align-right\">Odchyłka</th><th></th></tr></thead>" +
            "<tbody>" + rowsHtml + "</tbody>" +
            "</table></div>";
    }

    function renderModels(report) {

        var x = report.x;
        var models = report.models;

        var rows = [
            renderSummaryRow("a", "Model A - średnia", models.a.total_wh, x.total_wh, models.a.hourly, x.hourly),
            renderSummaryRow("b", "Model B - trymowana średnia (" + report.trim_pct + "%)", models.b.total_wh, x.total_wh, models.b.hourly, x.hourly),
            renderSummaryRow(
                "c",
                "Model C - podobne dni tygodnia",
                models.c.total_wh, x.total_wh, models.c.hourly, x.hourly,
                "(" + report.weekdays.map(function (w) { return WEEKDAY_LABELS[w]; }).join(", ") + " - " + models.c.days_used + " dni)"
            ),
            renderSummaryRow("d", "Model D - " + report.percentile_pct + ". centyl", models.d.total_wh, x.total_wh, models.d.hourly, x.hourly),
        ].join("");

        modelsContent.innerHTML = renderTable(rows);
    }

    function estimateDescription(report) {
        var span = "z " + report.lookback_days + " dni przed danym dniem";
        switch (report.estimate_model) {
            case "A": return "Model A (średnia) " + span + ".";
            case "B": return "Model B (trymowana średnia " + report.trim_pct + "%) " + span + ".";
            case "C": return "Model C (średnia z dni tygodnia z formularza, jeśli obejmują dzień tygodnia danego dnia, w przeciwnym razie z jego dnia tygodnia) " + span + ".";
            case "D": return "Model D (" + report.percentile_pct + ". centyl) " + span + ".";
            default: return "prognoza, jaką system (Pulpit, algorytm EMS) wyznaczyłby dla tego dnia z 28 dni przed nim: średnia z tych samych dni tygodnia, a przy mniej niż 2 takich dniach - ze wszystkich.";
        }
    }

    function renderDays(report) {

        var days = report.days || [];

        daysHint.textContent = "Estymata - " + estimateDescription(report) +
            " Liczona tylko dla godzin z zapisanym zużyciem.";

        if (!days.length) {
            daysContent.innerHTML = "<div class=\"history-empty\">Brak dni historycznych z danymi w tym oknie.</div>";
            return;
        }

        // najnowsze pierwsze - estymata TEGO dnia (prognoza systemu, patrz
        // ems/consumption_forecast.py::_with_estimates()) vs jego rzeczywiste
        var rows = days.slice().reverse().map(function (day) {
            return renderSummaryRow(
                "day-" + day.date,
                day.date + " (" + WEEKDAY_LABELS[day.weekday] + ")",
                day.estimate_wh, day.total_wh, day.estimate_hourly, day.hourly,
                null, { diff: true, actualLabel: "Rzeczywiste" }
            );
        }).join("");

        daysContent.innerHTML = renderTable(rows, "Rzeczywiste");
    }

    function toggleHandler(e) {

        var toggle = e.target.closest("[data-forecast-toggle]");

        if (!toggle) { return; }

        var key = toggle.getAttribute("data-forecast-toggle");
        var container = toggle.closest("table").parentNode;
        var hoursEl = container.querySelector("[data-forecast-hours=\"" + key + "\"]");
        var arrowEl = container.querySelector("[data-forecast-arrow=\"" + key + "\"]");

        hoursEl.hidden = !hoursEl.hidden;
        arrowEl.innerHTML = hoursEl.hidden ? "&#9662;" : "&#9652;";
    }

    modelsContent.addEventListener("click", toggleHandler);
    daysContent.addEventListener("click", toggleHandler);

    function loadReport() {

        if (!dateInput.value) {
            statusEl.textContent = "Podaj dzień X.";
            statusEl.className = "settings-message error";
            return;
        }

        var weekdays = selectedWeekdays();

        if (!weekdays.length) {
            statusEl.textContent = "Zaznacz przynajmniej jeden dzień tygodnia dla Modelu C.";
            statusEl.className = "settings-message error";
            return;
        }

        statusEl.textContent = "Wczytywanie…";
        statusEl.className = "settings-message";
        modelsPanel.hidden = true;
        daysPanel.hidden = true;

        var url = "/report/energy/forecast?date=" + encodeURIComponent(dateInput.value) +
            "&trim=" + encodeURIComponent(trimSelect.value) +
            "&percentile=" + encodeURIComponent(percentileSelect.value) +
            "&estimate=" + encodeURIComponent(estimateSelect.value) +
            "&lookback=" + encodeURIComponent(lookbackInput.value || "60") +
            "&weekdays=" + encodeURIComponent(weekdays.join(","));

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (report) {

                if (report.error) {
                    statusEl.textContent = "Błąd: " + report.error;
                    statusEl.className = "settings-message error";
                    return;
                }

                statusEl.textContent = "";

                renderModels(report);
                renderDays(report);

                modelsPanel.hidden = false;
                daysPanel.hidden = false;
            })
            .catch(function () {
                statusEl.textContent = "Błąd wczytywania prognozy.";
                statusEl.className = "settings-message error";
            });
    }

    showButton.addEventListener("click", loadReport);

    // ==================================================
    // DOMYSLNE WARTOSCI - wczoraj (pewne pelne dane), dzien tygodnia
    // dopasowany automatycznie. Bez auto-fetch - dopiero po "Przelicz"
    // (ten sam wzorzec co /report/energy/view i inne raporty w apce).
    // ==================================================

    var today = todayParts();
    var yesterdayDate = new Date(today.y, today.m - 1, today.d - 1);

    var defaultDateStr = fmtDate(yesterdayDate.getFullYear(), yesterdayDate.getMonth() + 1, yesterdayDate.getDate());

    dateInput.value = defaultDateStr;
    dateInput.max = fmtDate(today.y, today.m, today.d);

    setWeekdayCheckboxes([weekdayOf(defaultDateStr)]);

    // "max" pola okna historycznego = faktyczna liczba dni z danymi w
    // consumption_log/ (patrz core/routes.py GET /report/energy/forecast/meta) -
    // bez sensu pozwalac wpisac wiecej, niz kontroler realnie zebral
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

            // dzien X wczesniej niz najstarszy dostepny dzien danych i
            // tak nie ma sensu (brak jakiegokolwiek zuzycia do
            // porownania) - "max" zostaje "dzisiaj" (X moze byc
            // biezacym dniem, patrz komentarz wyzej)
            if (meta.oldest_date) {
                dateInput.min = meta.oldest_date;
            }
        })
        .catch(function () { /* brak metadanych - zostaw domyslny max */ });
})();
