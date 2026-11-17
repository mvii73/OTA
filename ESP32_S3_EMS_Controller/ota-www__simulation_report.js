(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    // te same kolory co www/dashboard.py::STATUS_META (Harmonogram na
    // pulpicie) - trzymane tu osobno, bo API nie zwraca kolorow.
    var MODE_COLORS = {
        IDLE: "#607d8b",
        WAIT: "#1d4ed8",
        CHARGE: "#16a34a",
        DISCHARGE: "#b91c1c",
        GRID: "#a855f7",
        STANDBY: "#0f766e"
    };

    var dateEl = el("sim-date");
    var hourEl = el("sim-hour");
    var socEl = el("sim-soc");
    var avgLoadEl = el("sim-avg-load");
    var loadProfileEl = el("sim-load-profile");

    // stala srednia tylko bez profilu historii
    var avgLoadRowEl = el("sim-avg-load-row");

    loadProfileEl.addEventListener("change", function () {
        avgLoadEl.disabled = loadProfileEl.checked;
        avgLoadRowEl.classList.toggle("is-disabled", loadProfileEl.checked);
    });
    var runEl = el("sim-run");
    var statusEl = el("sim-status");
    var resultPanelEl = el("sim-result-panel");
    var warningEl = el("sim-warning");
    var contentEl = el("sim-content");

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    function todayDateStr() {
        var now = new Date();
        return now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
    }

    function yesterdayDateStr() {
        var d = new Date();
        d.setDate(d.getDate() - 1);
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }

    // godziny z /ems/simulate (locale.format_dt) sa w formacie ISO
    // "YYYY-MM-DDTHH:MM:SS" - pokazujemy "HH:MM", ale gdy data rozni
    // sie od dnia symulacji ("baseDate"), dopisujemy "(+N)"/"(-N)" dni -
    // BEZ tego np. pelna doba "23:00 dzis -> 23:00 jutro" wygladala jak
    // zerowy zakres "23:00 -> 23:00" (ten sam wzorzec co core/locale.py::
    // hour() dla zywego Harmonogramu).
    function fmtTime(iso, baseDate) {

        if (!iso) { return "-"; }

        var datePart = iso.split("T")[0];
        var timePart = (iso.split("T")[1] || iso).slice(0, 5);

        if (!baseDate || datePart === baseDate) {
            return timePart;
        }

        var diffDays = Math.round((new Date(datePart + "T00:00:00") - new Date(baseDate + "T00:00:00")) / 86400000);

        return timePart + " (" + (diffDays > 0 ? "+" : "") + diffDays + ")";
    }

    function renderModeBadge(mode, touSoc, sellLimitKwh) {
        var color = MODE_COLORS[mode] || "#555";
        // GRID - docelowy SOC ladowania z sieci (TOU, ems/grid.py)
        var soc = (mode === "GRID" && touSoc != null) ? " → " + escapeHtml(touSoc) + "%" : "";
        // DISCHARGE po GRID - limit sprzedazy (PV od pierwszego GRID dnia minus zakup w kolejnych GRID, ems/sell_limit.py)
        if (mode === "DISCHARGE" && sellLimitKwh != null) {
            soc = " ≤ " + String(sellLimitKwh.toFixed(1)).replace(".", ",") + " kWh";
        }
        return "<span class=\"state-badge\" style=\"background:" + color + "1a; color:" + color + ";\">" +
            escapeHtml(mode) + "</span>" + soc;
    }

    function renderTable(rows, baseDate) {

        if (!rows.length) {
            return "<div class=\"history-empty\">Brak wyniku symulacji dla tego dnia</div>";
        }

        var body = rows.map(function (r) {
            return "<tr>" +
                "<td>" + fmtTime(r.start, baseDate) + "</td>" +
                "<td>" + fmtTime(r.end, baseDate) + "</td>" +
                "<td class=\"align-right\">" + escapeHtml(r.rce) + "</td>" +
                "<td class=\"align-right\">" + escapeHtml(r.pv) + "</td>" +
                "<td class=\"align-right\">" + escapeHtml(r.load) + "</td>" +
                "<td class=\"align-right\">" + (r.soc == null ? "-" : escapeHtml(Math.round(r.soc))) + "</td>" +
                "<td>" + renderModeBadge(r.mode, r.tou_soc, r.sell_limit_kwh) + "</td>" +
                "</tr>";
        }).join("");

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Start</th><th>Koniec</th><th class=\"align-right\">RCE (zł/kWh, brutto)</th><th class=\"align-right\">PV (kWh)</th><th class=\"align-right\">Zużycie (kWh)</th><th class=\"align-right\">SOC (%)</th><th>Tryb</th></tr></thead>" +
            "<tbody>" + body + "</tbody>" +
            "</table>" +
            "</div>";
    }

    function renderWarning(res) {

        var parts = [];

        var missing = res.missing_irradiance_hours || [];
        if (missing.length >= 20) {
            parts.push("Brak prognozy nasłonecznienia dla tego dnia (dane trzymane tylko ~14 dni wstecz) - CHARGE/DISCHARGE liczone przy irradiance=0, wynik może być niemiarodajny.");
        } else if (missing.length) {
            parts.push("Brak prognozy nasłonecznienia dla godzin: " + missing.join(", ") + " - te godziny liczone przy irradiance=0.");
        }

        parts.push(
            "SOC=" + res.soc + "%, napięcie baterii=" + res.battery_voltage +
            " V, pojemność znamionowa=" + res.battery_rated_capacity_ah +
            " Ah (aktualne, żywe wartości - nie historyczne), prognozowane zużycie dobowe=" +
            (res.load_profile_kwh != null
                ? res.load_profile_kwh + " kWh (profil godzinowy z historii)"
                : res.avg_load_day_kw + " kWh (równo na 24 h)") +
            ". \"Teraz\" symulacji: " + fmtTime(res.sim_now, res.date) + "."
        );

        return "<div class=\"settings-hint\">" + parts.map(escapeHtml).join("<br>") + "</div>";
    }

    // legenda trybow - plik statyczny (Cache-Control na dobe), raz na strone
    var legendEl = el("sim-legend");
    var legendLoaded = false;

    var legendParams = {};

    // wartosci Parametrow EMS w legendzie (<span data-ems-param="NAZWA">)
    function fillLegendParams() {
        if (!legendEl) { return; }
        Array.prototype.forEach.call(legendEl.querySelectorAll("[data-ems-param]"), function (span) {
            var value = legendParams[span.getAttribute("data-ems-param")];
            span.textContent = value == null ? "-" : String(value).replace(".", ",");
        });
    }

    function loadLegend(params) {
        legendParams = params || {};
        if (legendLoaded || !legendEl) { fillLegendParams(); return; }
        legendLoaded = true;
        fetch(legendEl.getAttribute("data-src"))
            .then(function (r) { return r.ok ? r.text() : ""; })
            .then(function (html) { legendEl.innerHTML = html; fillLegendParams(); })
            .catch(function () { legendLoaded = false; });
    }

    function runSimulation() {

        var date = dateEl.value;

        if (!date) {
            statusEl.className = "settings-message error";
            statusEl.textContent = "Wybierz dzień.";
            return;
        }

        statusEl.className = "settings-message";
        statusEl.textContent = "Liczenie…";
        runEl.disabled = true;

        var url = "/ems/simulate?date=" + encodeURIComponent(date) +
            "&hour=" + encodeURIComponent(hourEl.value) +
            "&soc=" + encodeURIComponent(socEl.value) +
            "&load_profile=" + (loadProfileEl.checked ? "1" : "0") +
            "&avg_load_day_kw=" + encodeURIComponent(avgLoadEl.value);

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (res) {

                runEl.disabled = false;

                if (res.error) {
                    statusEl.className = "settings-message error";
                    statusEl.textContent = res.error === "no_rce_data"
                        ? "Brak danych RCE dla tego dnia (PSE nie ma archiwum dla tej daty)."
                        : "Błąd: " + res.error;
                    resultPanelEl.hidden = true;
                    return;
                }

                statusEl.className = "settings-message";
                statusEl.textContent = "";

                resultPanelEl.hidden = false;
                loadLegend(res.params);
                warningEl.innerHTML = renderWarning(res);
                contentEl.innerHTML = renderTable(res.schedule || [], res.date);
            })
            .catch(function () {
                runEl.disabled = false;
                statusEl.className = "settings-message error";
                statusEl.textContent = "Błąd wczytywania - sprawdź połączenie z internetem (PSE) i spróbuj ponownie.";
                resultPanelEl.hidden = true;
            });
    }

    for (var h = 0; h < 24; h++) {
        var opt = document.createElement("option");
        opt.value = h;
        opt.textContent = pad2(h) + ":00";
        hourEl.appendChild(opt);
    }

    hourEl.value = 0;

    dateEl.max = todayDateStr();
    dateEl.value = yesterdayDateStr();

    runEl.addEventListener("click", runSimulation);

    // szybkie wypelnianie: dzis / biezaca godzina / SOC z falownika - przyciski
    // rownej szerokosci (najszerszego, "Aktualny")
    var fillButtons = ["sim-date-today", "sim-hour-now", "sim-soc-current"].map(el);
    var fillWidth = Math.max.apply(null, fillButtons.map(function (b) { return b.offsetWidth; }));
    fillButtons.forEach(function (b) { b.style.width = fillWidth + "px"; });

    el("sim-date-today").addEventListener("click", function () {
        dateEl.value = todayDateStr();
    });

    el("sim-hour-now").addEventListener("click", function () {
        hourEl.value = new Date().getHours();
    });

    var socButton = el("sim-soc-current");

    socButton.addEventListener("click", function () {
        socButton.disabled = true;
        fetch("/display/batteryWidget")
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var soc = parseFloat(res.soc);
                if (!isNaN(soc)) { socEl.value = Math.round(soc); }
            })
            .catch(function () {
                statusEl.className = "settings-message error";
                statusEl.textContent = "Nie udało się odczytać SOC.";
            })
            .then(function () { socButton.disabled = false; });
    });
})();
