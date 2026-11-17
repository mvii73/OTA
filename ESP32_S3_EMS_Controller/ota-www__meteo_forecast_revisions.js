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

    function fmtChange(pct) {
        if (pct == null) { return "-"; }
        var sign = pct > 0 ? "+" : "";
        return sign + pct.toFixed(1) + "%";
    }

    function changeClass(pct) {
        if (pct == null) { return ""; }
        var abs = Math.abs(pct);
        if (abs >= 10) { return " deviation-high"; }
        if (abs >= 5) { return " deviation-warn"; }
        return "";
    }

    var daysEl = el("revisions-days");

    function renderSnapshot(snap, isFirst) {

        if (!snap.changes.length) {
            return "";
        }

        var rows = snap.changes.map(function (c) {
            return "<tr>" +
                "<td>" + c.time_label + "</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(c.initial_wh) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(c.from_wh) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(c.to_wh) + "</td>" +
                "<td class=\"measurement-energy" + changeClass(c.change_vs_initial_pct) + "\">" + fmtChange(c.change_vs_initial_pct) + "</td>" +
                "<td class=\"measurement-energy" + changeClass(c.change_vs_prev_pct) + "\">" + fmtChange(c.change_vs_prev_pct) + "</td>" +
                "</tr>";
        }).join("");

        var title = isFirst
            ? "Pierwsza prognoza dnia (" + snap.time + ") - " + snap.changes.length + " slotów"
            : "Zmiana o " + snap.time + " - " + snap.changes.length + " slotów";

        return "<div class=\"settings-row-text\" style=\"padding-top:12px\"><label>" + escapeHtml(title) + "</label></div>" +
            "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Czas</th><th class=\"align-right\">Początkowo</th><th class=\"align-right\">Poprzednio</th><th class=\"align-right\">Teraz</th><th class=\"align-right\">Zmiana vs początkowa</th><th class=\"align-right\">Zmiana vs poprzednia</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
            "</table>" +
            "</div>";
    }

    function renderDay(day) {

        var snapshotsHtml = day.snapshots.map(function (snap, idx) {
            return renderSnapshot(snap, idx === 0);
        }).join("");

        var changeCount = day.snapshots.reduce(function (sum, s, idx) {
            return sum + (idx === 0 ? 0 : s.changes.length);
        }, 0);

        var summary = day.snapshots.length
            ? day.snapshots.length + " zrzut(ów) prognozy, " + changeCount + " zmian(a) godzinowych po pierwszym zrzucie"
            : "brak jeszcze zrzutów";

        return "<div class=\"settings-panel\">" +
            "<div class=\"settings-row settings-row-collapsible\" data-day-toggle=\"" + day.date + "\" style=\"cursor:pointer\">" +
            "<div class=\"settings-row-text\">" +
            "<label>" + escapeHtml(day.date) + "</label>" +
            "<div class=\"settings-hint\">" + summary + "</div>" +
            "</div>" +
            "<span class=\"settings-row-arrow\" data-day-arrow=\"" + day.date + "\">&#9662;</span>" +
            "</div>" +
            "<div hidden data-day-hours=\"" + day.date + "\">" + snapshotsHtml + "</div>" +
            "</div>";
    }

    function loadReport() {

        fetch("/meteo/calibration/revisions")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                var days = (res.days || []).filter(function (d) { return d.snapshots.length; });

                daysEl.innerHTML = days.length
                    ? days.slice().reverse().map(renderDay).join("")
                    : "<div class=\"history-empty\">Brak jeszcze danych - zrzut jest robiony po każdym odświeżeniu prognozy pogodowej (co godzinę), o ile coś się zmieniło.</div>";
            })
            .catch(function () {
                daysEl.innerHTML = "<div class=\"history-empty\">Błąd wczytywania danych.</div>";
            });
    }

    daysEl.addEventListener("click", function (e) {

        var toggle = e.target.closest("[data-day-toggle]");

        if (!toggle) { return; }

        var date = toggle.getAttribute("data-day-toggle");
        var hoursEl = daysEl.querySelector("[data-day-hours=\"" + date + "\"]");
        var arrowEl = daysEl.querySelector("[data-day-arrow=\"" + date + "\"]");

        hoursEl.hidden = !hoursEl.hidden;
        arrowEl.innerHTML = hoursEl.hidden ? "&#9662;" : "&#9652;";
        toggle.classList.toggle("expanded", !hoursEl.hidden);
    });

    loadReport();
})();
