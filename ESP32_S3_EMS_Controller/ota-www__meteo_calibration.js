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

    function fmtWh(wh) {
        return wh == null ? "-" : Math.round(wh) + " Wh";
    }

    function fmtDev(pct) {
        if (pct == null) { return "-"; }
        var sign = pct > 0 ? "+" : "";
        return sign + pct.toFixed(1) + "%";
    }

    function devClass(pct) {
        if (pct == null) { return ""; }
        var abs = Math.abs(pct);
        if (abs >= 10) { return " deviation-high"; }
        if (abs >= 5) { return " deviation-warn"; }
        return "";
    }

    function devSpan(pct) {
        return "<span class=\"" + devClass(pct).trim() + "\">" + fmtDev(pct) + "</span>";
    }

    var daysEl = el("calibration-days");
    var currentEl = el("cal-current");
    var suggestedEl = el("cal-suggested");
    var valueInput = el("cal-value");
    var statusEl = el("cal-status");
    var saveButton = el("cal-save-button");

    function renderDay(day) {

        var hoursRows = day.hours.map(function (h) {
            return "<tr>" +
                "<td>" + h.time_label + "</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(h.forecast_wh) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(h.actual_wh) + "</td>" +
                "<td class=\"measurement-energy" + devClass(h.deviation_pct) + "\">" + fmtDev(h.deviation_pct) + "</td>" +
                "</tr>";
        }).join("");

        var actualText = day.actual_wh == null ? "- (jutro)" : fmtKwh(day.actual_wh);

        return "<div class=\"settings-panel\">" +
            "<div class=\"settings-row settings-row-collapsible\" data-day-toggle=\"" + day.date + "\" style=\"cursor:pointer\">" +
            "<div class=\"settings-row-text\">" +
            "<label>" + escapeHtml(day.date) + "</label>" +
            "<div class=\"settings-hint\">Prognoza: " + fmtKwh(day.forecast_wh) + " · Rzeczywista: " + actualText +
            (day.deviation_pct != null ? " · Odchyłka: " + devSpan(day.deviation_pct) : "") + "</div>" +
            "</div>" +
            "<span class=\"settings-row-arrow\" data-day-arrow=\"" + day.date + "\">&#9662;</span>" +
            "</div>" +
            "<div class=\"history-measurements-wrapper\" hidden data-day-hours=\"" + day.date + "\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Czas</th><th class=\"align-right\">Prognoza</th><th class=\"align-right\">Rzeczywista</th><th class=\"align-right\">Odchyłka</th></tr></thead>" +
            "<tbody>" + hoursRows + "</tbody>" +
            "</table>" +
            "</div>" +
            "</div>";
    }

    function loadReport(updateInputField) {

        // updateInputField=false po zapisie (patrz saveButton nizej) -
        // odswieza "Obecna efektywnosc"/"Sugerowana efektywnosc"/liste
        // dni, ale NIE nadpisuje pola "Nowa wartosc" - inaczej
        // wlasnie zapisana (niekoniecznie rowna sugestii) wartosc
        // zostawalaby natychmiast zastapiona sugestia, co wygladalo
        // jak "zapis sie nie udal"
        if (updateInputField == null) { updateInputField = true; }

        fetch("/meteo/calibration/report")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                var days = res.days || [];

                daysEl.innerHTML = days.length
                    ? days.slice().reverse().map(renderDay).join("")
                    : "<div class=\"history-empty\">Brak jeszcze danych</div>";

                var currentPct = Math.round(res.current * 100);
                currentEl.textContent = currentPct + "%";

                if (res.suggested == null) {
                    suggestedEl.textContent = "Za mało danych (" + res.hours_sampled + "h z ostatnich " + res.days_sampled + " dni) - potrzeba co najmniej 6h.";
                    if (updateInputField) { valueInput.value = currentPct; }
                    return;
                }

                var suggestedPct = Math.round(res.suggested * 100);

                suggestedEl.textContent = suggestedPct + "% (na bazie ostatnich " + res.hours_sampled + "h, " + res.days_sampled + " dni)";
                if (updateInputField) { valueInput.value = suggestedPct; }
            })
            .catch(function () {
                daysEl.innerHTML = "<div class=\"history-empty\">Błąd wczytywania danych.</div>";
                suggestedEl.textContent = "Błąd wczytywania.";
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

    saveButton.addEventListener("click", function () {

        var pct = parseFloat(valueInput.value);

        if (isNaN(pct) || pct < 30 || pct > 100) {
            statusEl.textContent = "Podaj wartość 30-100.";
            statusEl.className = "settings-message error";
            return;
        }

        statusEl.textContent = "Zapisywanie...";
        statusEl.className = "settings-message";

        fetch("/meteo/calibration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: pct / 100.0 })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (!res.saved) {
                    statusEl.textContent = "Błąd: " + (res.error || "nieznany");
                    statusEl.className = "settings-message error";
                    return;
                }

                statusEl.textContent = "Zapisano.";
                statusEl.className = "settings-message success";
                loadReport(false);
            })
            .catch(function () {
                statusEl.textContent = "Błąd zapisu.";
                statusEl.className = "settings-message error";
            });
    });

    loadReport();
})();
