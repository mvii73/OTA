(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function fmtPln(value) {
        return value == null ? "-" : value.toFixed(2) + " PLN";
    }

    function fmtKwh(value) {
        return value == null ? "-" : value.toFixed(2) + " kWh";
    }

    var tariffSelect = el("report-tariff");

    function loadTariffOptions() {
        fetch("/tariffs")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                var tariffs = res.tariffs || {};
                var activeId = res.active_id;

                var options = "<option value=\"\">(aktywna" + (activeId && tariffs[activeId] ? " - " + escapeHtml(tariffs[activeId].name) : "") + ")</option>";

                options += Object.keys(tariffs).map(function (id) {
                    return "<option value=\"" + id + "\">" + escapeHtml(tariffs[id].name || id) + "</option>";
                }).join("");

                tariffSelect.innerHTML = options;
            })
            .catch(function () {
                tariffSelect.innerHTML = "<option value=\"\">(aktywna)</option>";
            });
    }

    tariffSelect.addEventListener("change", loadReport);

    var startInput = el("report-start");
    var endInput = el("report-end");
    var prevMonthButton = el("report-prev-month");
    var currentMonthButton = el("report-current-month");
    var currentDayButton = el("report-current-day");
    var nextMonthButton = el("report-next-month");
    var showButton = el("report-show");
    var rangeStatusEl = el("report-range-status");
    var summaryPanel = el("report-summary-panel");
    var importSummaryEl = el("report-import-summary");
    var exportSummaryEl = el("report-export-summary");
    var fixedSummaryEl = el("report-fixed-summary");
    var netSummaryEl = el("report-net-summary");
    var monthsPanel = el("report-months-panel");
    var monthsBody = el("report-months-body");
    var zonesPanel = el("report-zones-panel");
    var zonesBody = el("report-zones-body");
    var daysBody = el("report-days-body");

    var MAX_MONTHS_BACK = 12;

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    function fmtDate(y, m, d) {
        return y + "-" + pad2(m) + "-" + pad2(d);
    }

    function lastDayOfMonth(year, month) {
        // dzien 0 nastepnego miesiaca = ostatni dzien tego miesiaca
        return new Date(year, month, 0).getDate();
    }

    function todayParts() {
        var now = new Date();
        return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    }

    function monthsBetween(y1, m1, y2, m2) {
        return (y2 - y1) * 12 + (m2 - m1);
    }

    // Wszystkie przyciski nawigacji korygują TYLKO pola "od"/"do" -
    // pobranie danych nastepuje wylacznie po kliknieciu "Pokaż"
    // (patrz showButton nizej).

    prevMonthButton.addEventListener("click", function () {

        var startParts = startInput.value.split("-").map(Number);
        var year = startParts[0];
        var month = startParts[1] - 1;

        if (month < 1) { month = 12; year -= 1; }

        var today = todayParts();

        if (monthsBetween(year, month, today.y, today.m) >= MAX_MONTHS_BACK) {
            rangeStatusEl.textContent = "Można cofnąć się maksymalnie " + MAX_MONTHS_BACK + " miesięcy wstecz.";
            rangeStatusEl.className = "settings-message error";
            return;
        }

        startInput.value = fmtDate(year, month, 1);
        endInput.value = fmtDate(year, month, lastDayOfMonth(year, month));

        rangeStatusEl.textContent = "";
    });

    nextMonthButton.addEventListener("click", function () {

        var startParts = startInput.value.split("-").map(Number);
        var year = startParts[0];
        var month = startParts[1] + 1;

        if (month > 12) { month = 1; year += 1; }

        var today = todayParts();

        if (monthsBetween(year, month, today.y, today.m) < 0) {
            rangeStatusEl.textContent = "Nie można wybrać miesiąca w przyszłości.";
            rangeStatusEl.className = "settings-message error";
            return;
        }

        var isCurrentMonth = year === today.y && month === today.m;

        startInput.value = fmtDate(year, month, 1);
        endInput.value = isCurrentMonth ? fmtDate(year, month, today.d) : fmtDate(year, month, lastDayOfMonth(year, month));

        rangeStatusEl.textContent = "";
    });

    currentMonthButton.addEventListener("click", function () {

        var today = todayParts();

        startInput.value = fmtDate(today.y, today.m, 1);
        endInput.value = fmtDate(today.y, today.m, today.d);

        rangeStatusEl.textContent = "";
    });

    currentDayButton.addEventListener("click", function () {

        var today = todayParts();

        startInput.value = fmtDate(today.y, today.m, today.d);
        endInput.value = fmtDate(today.y, today.m, today.d);

        rangeStatusEl.textContent = "";
    });

    function renderReport(report) {

        if (report.error) {
            summaryPanel.hidden = true;
            monthsPanel.hidden = true;
            zonesPanel.hidden = true;
            daysBody.innerHTML = "<tr><td colspan=\"6\" class=\"history-empty\">Błąd: " + escapeHtml(report.error) + "</td></tr>";
            return;
        }

        var totals = report.totals || {};

        summaryPanel.hidden = false;
        importSummaryEl.textContent = fmtKwh(totals.import_kwh_total) + " · " + fmtPln(totals.import_cost_total_pln);
        exportSummaryEl.textContent = fmtKwh(totals.export_kwh_total) + " · " + fmtPln(totals.export_revenue_total_pln);
        fixedSummaryEl.textContent = fmtPln(totals.fixed_monthly_cost_pln);
        netSummaryEl.textContent = fmtPln(totals.net_pln);

        var months = report.months || [];

        monthsPanel.hidden = !months.length;

        monthsBody.innerHTML = months.map(function (m) {

            var t = m.totals || {};

            return "<tr>" +
                "<td>" + escapeHtml(m.month) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh(t.import_kwh_total) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(t.import_cost_total_pln) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh(t.export_kwh_total) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(t.export_revenue_total_pln) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(t.net_pln) + "</td>" +
                "</tr>";
        }).join("");

        var zoneRows = [];

        months.forEach(function (m) {
            (m.zones || []).forEach(function (z) {
                zoneRows.push({ month: m.month, zone: z });
            });
        });

        zonesPanel.hidden = !zoneRows.length;

        zonesBody.innerHTML = zoneRows.map(function (item) {

            var z = item.zone;

            return "<tr>" +
                "<td>" + escapeHtml(item.month) + "</td>" +
                "<td>" + escapeHtml(z.zone) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh(z.import_kwh) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(z.energy_cost_pln) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(z.other_costs_pln) + "</td>" +
                "</tr>";
        }).join("");

        var days = report.days || [];

        if (!days.length) {
            daysBody.innerHTML = "<tr><td colspan=\"6\" class=\"history-empty\">Brak dni w tym okresie</td></tr>";
            return;
        }

        daysBody.innerHTML = days.map(function (day) {

            if (day.no_data) {
                return "<tr><td>" + escapeHtml(day.date) + "</td>" +
                    "<td colspan=\"5\" class=\"history-empty\">brak danych</td></tr>";
            }

            var t = day.totals || {};

            return "<tr>" +
                "<td>" + escapeHtml(day.date) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh(t.import_kwh_total) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(t.import_cost_total_pln) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh(t.export_kwh_total) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(t.export_revenue_total_pln) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(t.net_pln) + "</td>" +
                "</tr>";
        }).join("");

        var missingDates = days.filter(function (d) { return d.no_data; }).map(function (d) { return d.date; });

        if (missingDates.length && !backfillPollTimer) {
            showMissingDataPrompt(missingDates);
        }
    }

    function loadReport() {

        if (!startInput.value || !endInput.value) { return; }

        if (startInput.value > endInput.value) {
            rangeStatusEl.textContent = "Data \"Od\" musi być wcześniejsza niż \"Do\".";
            rangeStatusEl.className = "settings-message error";
            return;
        }

        rangeStatusEl.textContent = "";
        daysBody.innerHTML = "<tr><td colspan=\"6\" class=\"history-empty\">Wczytywanie&hellip;</td></tr>";
        summaryPanel.hidden = true;
        monthsPanel.hidden = true;
        zonesPanel.hidden = true;

        var url = "/report/energy/range?start=" + encodeURIComponent(startInput.value) + "&end=" + encodeURIComponent(endInput.value);

        if (tariffSelect.value) {
            url += "&tariff_id=" + encodeURIComponent(tariffSelect.value);
        }

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(renderReport)
            .catch(function () {
                daysBody.innerHTML = "<tr><td colspan=\"6\" class=\"history-empty\">Błąd wczytywania raportu.</td></tr>";
            });
    }

    showButton.addEventListener("click", loadReport);

    // =====================================================
    // OKNO "BRAKUJACE DANE" - pojawia sie automatycznie za kazdym
    // razem, gdy w wyswietlonym raporcie sa dni bez danych. Po
    // akceptacji zleca uzupelnienie w tle (patrz
    // services/energy_archive_service.py::queue_backfill()) i
    // pokazuje postep w tym samym oknie - okno mozna zamknac w
    // dowolnym momencie, uzupelnianie i tak dzieje sie po stronie
    // kontrolera, niezaleznie od tego, czy okno jest otwarte.
    // =====================================================

    var backfillModal = el("backfill-modal");
    var backfillModalTitle = el("backfill-modal-title");
    var backfillModalMessage = el("backfill-modal-message");
    var backfillModalClose = el("backfill-modal-close");
    var backfillModalConfirm = el("backfill-modal-confirm");
    var backfillPollTimer = null;

    function closeBackfillModal() {
        backfillModal.hidden = true;
    }

    backfillModalClose.addEventListener("click", closeBackfillModal);

    function pollBackfillStatus() {

        fetch("/report/energy/archive/backfill")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (res.pending > 0) {
                    backfillModalMessage.textContent = "Uzupełnianie w tle… pozostało dni: " + res.pending + ". Można zamknąć to okno - wczytywanie będzie kontynuowane.";
                    return;
                }

                clearInterval(backfillPollTimer);
                backfillPollTimer = null;

                backfillModalMessage.textContent = "Uzupełnianie zakończone.";
                loadReport();
            })
            .catch(function () {
                clearInterval(backfillPollTimer);
                backfillPollTimer = null;
                backfillModalMessage.textContent = "Błąd sprawdzania postępu uzupełniania.";
            });
    }

    function startBackfill() {

        backfillModalConfirm.hidden = true;
        backfillModalTitle.textContent = "Uzupełnianie danych";
        backfillModalMessage.textContent = "Zlecanie uzupełnienia…";

        fetch("/report/energy/archive/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start: startInput.value, end: endInput.value })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (!res.status || res.status.pending === 0) {
                    backfillModalMessage.textContent = "Brak brakujących dni do uzupełnienia w tym okresie.";
                    return;
                }

                backfillModalMessage.textContent = "Zlecono uzupełnienie " + res.queued + " dni - przetwarzane w tle (jeden dzień na ok. 20s). Można zamknąć to okno - wczytywanie będzie kontynuowane.";

                if (backfillPollTimer) { clearInterval(backfillPollTimer); }
                backfillPollTimer = setInterval(pollBackfillStatus, 5000);
            })
            .catch(function () {
                backfillModalMessage.textContent = "Błąd zlecania uzupełnienia.";
            });
    }

    function showMissingDataPrompt(missingDates) {

        backfillModalTitle.textContent = "Brakujące dane";

        var range = missingDates.length > 1
            ? (missingDates[0] + " – " + missingDates[missingDates.length - 1])
            : missingDates[0];

        backfillModalMessage.textContent = "W wybranym okresie brakuje danych dla " + missingDates.length +
            " dni (" + range + "). Trzeba je doczytać z Deye Cloud / PSE, żeby raport był kompletny. Uzupełnić teraz?";

        backfillModalConfirm.hidden = false;
        backfillModalConfirm.onclick = startBackfill;

        backfillModal.hidden = false;
    }

    var today = todayParts();
    startInput.value = fmtDate(today.y, today.m, 1);
    endInput.value = fmtDate(today.y, today.m, today.d);

    loadTariffOptions();
})();
