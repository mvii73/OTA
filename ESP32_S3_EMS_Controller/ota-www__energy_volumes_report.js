(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function fmtKwh(value) {
        return value == null ? "-" : value.toFixed(2);
    }

    var startInput = el("volumes-start");
    var endInput = el("volumes-end");
    var prevMonthButton = el("volumes-prev-month");
    var showButton = el("volumes-show");
    var statusEl = el("volumes-status");
    var body = el("volumes-body");

    var MAX_MONTHS_BACK = 12;

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    function fmtDate(y, m, d) {
        return y + "-" + pad2(m) + "-" + pad2(d);
    }

    function lastDayOfMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    function todayParts() {
        var now = new Date();
        return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    }

    function monthsBetween(y1, m1, y2, m2) {
        return (y2 - y1) * 12 + (m2 - m1);
    }

    prevMonthButton.addEventListener("click", function () {

        var startParts = startInput.value.split("-").map(Number);
        var year = startParts[0];
        var month = startParts[1] - 1;

        if (month < 1) { month = 12; year -= 1; }

        var today = todayParts();

        if (monthsBetween(year, month, today.y, today.m) >= MAX_MONTHS_BACK) {
            statusEl.textContent = "Można cofnąć się maksymalnie " + MAX_MONTHS_BACK + " miesięcy wstecz.";
            statusEl.className = "settings-message error";
            return;
        }

        startInput.value = fmtDate(year, month, 1);
        endInput.value = fmtDate(year, month, lastDayOfMonth(year, month));

        statusEl.textContent = "";
        loadReport();
    });

    function renderReport(report) {

        if (report.error) {
            body.innerHTML = "<tr><td colspan=\"4\" class=\"history-empty\">Błąd: " + escapeHtml(report.error) + "</td></tr>";
            return;
        }

        var months = report.months || [];

        if (!months.length) {
            body.innerHTML = "<tr><td colspan=\"4\" class=\"history-empty\">Brak miesięcy w tym okresie</td></tr>";
            return;
        }

        var rows = months.map(function (m) {
            return "<tr>" +
                "<td>" + escapeHtml(m.month_name) + "</td>" +
                "<td>" + escapeHtml(m.year) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh(m.import_kwh_total) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh(m.export_kwh_total) + "</td>" +
                "</tr>";
        }).join("");

        var totals = report.totals || {};

        var sumRow = "<tr class=\"settlement-sum-row\">" +
            "<td colspan=\"2\"><strong>Suma za wszystkie okresy</strong></td>" +
            "<td class=\"measurement-energy\"><strong>" + fmtKwh(totals.import_kwh_total) + "</strong></td>" +
            "<td class=\"measurement-energy\"><strong>" + fmtKwh(totals.export_kwh_total) + "</strong></td>" +
            "</tr>";

        body.innerHTML = rows + sumRow;

        var missingDates = report.missing_dates || [];

        if (missingDates.length && !backfillPollTimer) {
            showMissingDataPrompt(missingDates);
        }
    }

    function loadReport() {

        if (!startInput.value || !endInput.value) { return; }

        if (startInput.value > endInput.value) {
            statusEl.textContent = "Data \"Od\" musi być wcześniejsza niż \"Do\".";
            statusEl.className = "settings-message error";
            return;
        }

        statusEl.textContent = "";
        body.innerHTML = "<tr><td colspan=\"4\" class=\"history-empty\">Wczytywanie&hellip;</td></tr>";

        var url = "/report/energy/volumes?start=" + encodeURIComponent(startInput.value) + "&end=" + encodeURIComponent(endInput.value);

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(renderReport)
            .catch(function () {
                body.innerHTML = "<tr><td colspan=\"4\" class=\"history-empty\">Błąd wczytywania raportu.</td></tr>";
            });
    }

    showButton.addEventListener("click", loadReport);

    // =====================================================
    // OKNO "BRAKUJACE DANE" - jak w /report/energy/view, patrz
    // services/energy_archive_service.py::queue_backfill()
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
            " dni (" + range + "). Trzeba je doczytać z Deye Cloud / PSE, żeby zestawienie było kompletne. Uzupełnić teraz?";

        backfillModalConfirm.hidden = false;
        backfillModalConfirm.onclick = startBackfill;

        backfillModal.hidden = false;
    }

    var today = todayParts();
    startInput.value = fmtDate(today.y, today.m, 1);
    endInput.value = fmtDate(today.y, today.m, today.d);

    loadReport();
})();
