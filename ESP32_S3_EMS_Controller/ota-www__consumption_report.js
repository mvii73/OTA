(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    // wartosci, ktore po zaokragleniu wychodza na 0 (0/0,0/0,00/0,000)
    // sa wyszarzane RAZEM z jednostka - latwiej wtedy okiem wylapac
    // sloty/urzadzenia, gdzie faktycznie cos sie zuzylo
    function wrapZero(text, isZero) {
        return isZero ? "<span class=\"measurement-zero\">" + text + "</span>" : text;
    }

    // kWh zaokraglone do "digits" miejsc, BEZ koncowych zer ("3.50" ->
    // "3.5") - podsumowanie dnia; tabele godzinowe (fmtKwh3) maja stale
    // 3 miejsca, zeby kolumny sie wyrownywaly
    function fmtKwhTrim(wh, digits) {
        if (wh == null) { return "-"; }
        var rounded = (wh / 1000.0).toFixed(digits);
        var text = rounded.indexOf(".") === -1 ? rounded : rounded.replace(/0+$/, "").replace(/\.$/, "");
        return wrapZero(text + " kWh", parseFloat(rounded) === 0);
    }

    function fmtKwh(wh) {
        return fmtKwhTrim(wh, 2);
    }

    function fmtKwh3(wh) {
        if (wh == null) { return "-"; }
        var rounded = (wh / 1000.0).toFixed(3);
        return wrapZero(rounded + " kWh", parseFloat(rounded) === 0);
    }

    var dateInputEl = el("consumption-date");
    var summaryContentEl = el("consumption-summary-content");
    var devicesContentEl = el("consumption-devices-content");
    var slotsContentEl = el("consumption-slots-content");

    function infoRow(label, valueHtml) {
        return "<div class=\"info-row\"><dt>" + escapeHtml(label) + "</dt><dd>" + valueHtml + "</dd></div>";
    }

    function renderDaySummary(day) {

        return "<div class=\"settings-panel-title\">Zasilanie</div>" +
            "<dl class=\"info-list\">" +
            infoRow("Produkcja PV", fmtKwh(day.pv_wh)) +
            infoRow("Rozładowanie baterii", fmtKwh(day.battery_wh)) +
            infoRow("Pobrano z sieci", fmtKwh(day.grid_wh)) +
            "</dl>" +
            "<div class=\"settings-panel-title\">Zużycie</div>" +
            "<dl class=\"info-list\">" +
            infoRow("Konsumpcja", fmtKwh(day.total_wh)) +
            infoRow("Ładowanie baterii", fmtKwh(day.charged_wh)) +
            infoRow("Sprzedaż do sieci", fmtKwh(day.sold_wh)) +
            "</dl>";
    }

    // "Bez pomiaru energii" - konsumpcja z falownika minus suma urzadzen z
    // pomiarem (odbiorniki bez wlasnego licznika). Bez konsumpcji (null)
    // - brak wiersza; ujemna roznica (niedokladnosc licznikow) -> 0.
    function unmeasuredRow(totalWh, measuredWh, fmt) {

        if (totalWh == null) { return ""; }

        return "<tr><td><em>Bez pomiaru energii</em></td>" +
            "<td class=\"measurement-energy\">" + fmt(Math.max(0, totalWh - measuredWh)) + "</td></tr>";
    }

    function renderDevicesTable(devices, totalWh) {

        if (!devices.length && totalWh == null) {
            return "<div class=\"history-empty\">Brak monitorowanych urządzeń w tym okresie</div>";
        }

        // Zaden z surowych licznikow urzadzen nie jest natywnie
        // "za jeden slot" - Tapo zwraca sume OD POCZATKU DNIA, Shelly
        // sume OD ZAWSZE, wiec pokazanie go wprost (jak wczesniej w
        // kolumnie "Licznik urzadzenia") mylilo z zuzyciem w tym
        // slocie. Jedyna wartosc majaca sens per-slot to delta liczona
        // w kontrolerze (biezacy odczyt minus poprzedni, patrz
        // ems/consumption_tracking.py::_delta()) - dlatego zostaje
        // TYLKO ta kolumna, jednolicie dla wszystkich rodzajow urzadzen.
        // Rodzaj/marka urzadzenia (Tapo/Shelly/...) celowo pominiety -
        // liczy sie tylko nazwa i zuzycie.
        var rows = devices.map(function (d) {
            return "<tr>" +
                "<td>" + escapeHtml(d.name || d.device_id) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh3(d.computed_wh) + "</td>" +
                "</tr>";
        }).join("");

        var measuredWh = devices.reduce(function (sum, d) { return sum + (d.computed_wh || 0); }, 0);

        rows += unmeasuredRow(totalWh, measuredWh, fmtKwh3);

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<tbody>" + rows + "</tbody>" +
            "</table>" +
            "</div>";
    }

    // ==================================================
    // ZUZYCIE WG URZADZEN - CALY DZIEN - suma computed_wh KAZDEGO
    // urzadzenia ze WSZYSTKICH slotow dnia (juz obecnych w odpowiedzi
    // /report/energy/consumption - bez dodatkowego zapytania). Brak
    // JAKIEGOKOLWIEK odczytu w calym dniu (urzadzenie bez pomiaru
    // energii albo nieosiagalne) daje "-" zamiast "0 kWh", tak samo
    // jak przy pojedynczym slocie.
    // ==================================================

    function aggregateDeviceTotals(day) {

        var totals = {}; // device_id -> {name, total_wh, has_data}

        (day.slots || []).forEach(function (slot) {
            (slot.devices || []).forEach(function (d) {

                var entry = totals[d.device_id];

                if (!entry) {
                    entry = { name: d.name || d.device_id, total_wh: 0, has_data: false };
                    totals[d.device_id] = entry;
                }

                if (d.computed_wh != null) {
                    entry.total_wh += d.computed_wh;
                    entry.has_data = true;
                }
            });
        });

        return Object.keys(totals)
            .map(function (id) { return totals[id]; })
            .sort(function (a, b) { return b.total_wh - a.total_wh; });
    }

    function renderDevicesSummary(day) {

        var totals = aggregateDeviceTotals(day);

        if (!totals.length && day.total_wh == null) {
            return "<div class=\"history-empty\">Brak monitorowanych urządzeń w tym okresie</div>";
        }

        var rows = totals.map(function (d) {
            return "<tr>" +
                "<td>" + escapeHtml(d.name) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtKwh(d.has_data ? d.total_wh : null) + "</td>" +
                "</tr>";
        }).join("");

        var measuredWh = totals.reduce(function (sum, d) { return sum + d.total_wh; }, 0);

        rows += unmeasuredRow(day.total_wh, measuredWh, fmtKwh);

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Urządzenie</th><th class=\"align-right\">Zużycie</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
            "</table>" +
            "</div>";
    }

    function renderSlot(day, slot) {

        var key = day.date + "|" + slot.label;

        // biezaca, niezakonczona godzina - liczniki na zywo (kursywa)
        var attrs = slot.current
            ? " style=\"cursor:pointer; font-style:italic\" title=\"Godzina w trakcie - odczyt na żywo, bez zapisu\""
            : " style=\"cursor:pointer\"";

        return "<tr data-slot-toggle=\"" + key + "\"" + attrs + ">" +
            "<td>" + escapeHtml(slot.range || slot.label) + (slot.current ? " (w trakcie)" : "") + "</td>" +
            "<td class=\"measurement-energy\">" + fmtKwh3(slot.grid_wh) + " / " + fmtKwh3(slot.sold_wh) + "</td>" +
            "<td class=\"measurement-energy\">" + fmtKwh3(slot.pv_wh) + "</td>" +
            "<td class=\"measurement-energy\">" + fmtKwh3(slot.charged_wh) + " / " + fmtKwh3(slot.battery_wh) + "</td>" +
            "<td class=\"measurement-energy\">" + fmtKwh3(slot.total_wh) + "</td>" +
            "<td class=\"align-center\"><span class=\"settings-row-arrow\" data-slot-arrow=\"" + key + "\">&#9662;</span></td>" +
            "</tr>" +
            "<tr hidden data-slot-devices=\"" + key + "\"><td colspan=\"6\">" + renderDevicesTable(slot.devices, slot.total_wh) + "</td></tr>";
    }

    function renderSlotsTable(day) {

        if (!day.slots.length) {
            return "<div class=\"history-empty\">Brak jeszcze danych tego dnia</div>";
        }

        var rows = day.slots.map(function (slot) {
            return renderSlot(day, slot);
        }).join("");

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Godzina</th><th class=\"align-right\">Pobrano z / oddano do sieci</th><th class=\"align-right\">Produkcja PV</th><th class=\"align-right\">Ładowanie / rozładowanie baterii</th><th class=\"align-right\">Zużycie</th><th class=\"align-center\"></th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
            "</table>" +
            "</div>";
    }

    // ==================================================
    // WYBOR DNIA - zwykly <input type="date"> (jak np.
    // www/energy_report_view.py "report-start"/"report-end") -
    // przegladarka sama daje ikone/popover kalendarza, wiec nie ma
    // potrzeby budowac wlasnego widgetu. Zakres min/max jest
    // ustawiany na podstawie dni, dla ktorych cokolwiek juz
    // zapisano (plus dzisiejszy dzien - jego total_wh jest liczone
    // NA ZYWO, patrz ems/consumption_tracking.py::_live_day_totals(),
    // nawet zanim powstanie dla niego jakikolwiek zapis w pliku).
    // ==================================================

    function pad2(n) { return n < 10 ? "0" + n : "" + n; }

    function todayDateStr() {
        var now = new Date();
        return now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
    }

    function renderDayContent(day) {
        summaryContentEl.innerHTML = renderDaySummary(day);
        devicesContentEl.innerHTML = renderDevicesSummary(day);
        slotsContentEl.innerHTML = renderSlotsTable(day);
    }

    function loadDay(ds) {

        summaryContentEl.innerHTML = "Ładowanie&hellip;";
        devicesContentEl.innerHTML = "Ładowanie&hellip;";
        slotsContentEl.innerHTML = "Ładowanie&hellip;";

        fetch("/report/energy/consumption?date=" + encodeURIComponent(ds))
            .then(function (r) { return r.json(); })
            .then(renderDayContent)
            .catch(function () {
                summaryContentEl.innerHTML = "<div class=\"history-empty\">Błąd wczytywania danych.</div>";
                devicesContentEl.innerHTML = "";
                slotsContentEl.innerHTML = "";
            });
    }

    // UZUPELNIENIE DNIA Z HISTORII DEYE CLOUD (POST /report/energy/
    // consumption/backfill, ems/consumption_tracking.py::
    // backfill_total_for_day()) - dokladniejsze wartosci godzinowe,
    // m.in. ladowanie baterii dla godzin zapisanych przed jego dodaniem
    var backfillButton = el("consumption-backfill-button");
    var backfillStatus = el("consumption-backfill-status");

    backfillButton.addEventListener("click", function () {

        var ds = dateInputEl.value;

        if (!ds) { return; }

        backfillButton.disabled = true;
        backfillStatus.className = "settings-message";
        backfillStatus.textContent = "Pobieranie historii…";

        fetch("/report/energy/consumption/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: ds })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var ok = res && res.ok;
                backfillStatus.textContent = ok ? "Uzupełniono." : ("Błąd: " + ((res && res.error) || "brak historii w Deye Cloud") +
                    (res && res.detail ? " (" + res.detail + ")" : ""));
                backfillStatus.className = "settings-message " + (ok ? "success" : "error");
                if (ok) { loadDay(ds); }
            })
            .catch(function () {
                backfillStatus.textContent = "Błąd połączenia.";
                backfillStatus.className = "settings-message error";
            })
            .then(function () { backfillButton.disabled = false; });
    });

    // UZUPELNIENIE ZAKRESU DAT - ten sam POST co wyzej, kolejno dzien po dniu
    // (jedno zapytanie do chmury na dzien, z przerwa; limit 31 dni)
    var rangeFromEl = el("consumption-range-from");
    var rangeToEl = el("consumption-range-to");
    var rangeButton = el("consumption-range-button");

    function isoDay(d) {
        return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }

    (function setDefaultRange() {
        var to = new Date();
        to.setDate(to.getDate() - 1);
        var from = new Date(to.getTime());
        from.setDate(from.getDate() - 6);
        rangeFromEl.value = isoDay(from);
        rangeToEl.value = isoDay(to);
    })();

    rangeButton.addEventListener("click", function () {

        var days = [];
        var d = new Date(rangeFromEl.value + "T12:00:00");
        var end = new Date(rangeToEl.value + "T12:00:00");

        if (isNaN(d) || isNaN(end) || d > end) {
            backfillStatus.textContent = "Niepoprawny zakres dat.";
            backfillStatus.className = "settings-message error";
            return;
        }

        while (d <= end && days.length <= 31) {
            days.push(isoDay(d));
            d.setDate(d.getDate() + 1);
        }

        if (days.length > 31) {
            backfillStatus.textContent = "Maksymalnie 31 dni naraz.";
            backfillStatus.className = "settings-message error";
            return;
        }

        rangeButton.disabled = true;
        backfillButton.disabled = true;
        var failed = [];

        function next(i) {

            if (i >= days.length) {
                backfillStatus.textContent = failed.length
                    ? "Uzupełniono " + (days.length - failed.length) + "/" + days.length + " dni. Błąd: " + failed.join(", ")
                    : "Uzupełniono " + days.length + " dni.";
                backfillStatus.className = "settings-message " + (failed.length ? "error" : "success");
                rangeButton.disabled = false;
                backfillButton.disabled = false;
                if (dateInputEl.value) { loadDay(dateInputEl.value); }
                return;
            }

            backfillStatus.className = "settings-message";
            backfillStatus.textContent = "Pobieranie historii " + days[i] + " (" + (i + 1) + "/" + days.length + ")…";

            fetch("/report/energy/consumption/backfill", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date: days[i] })
            })
                .then(function (r) { return r.json(); })
                .then(function (res) { if (!(res && res.ok)) { failed.push(days[i]); } })
                .catch(function () { failed.push(days[i]); })
                .then(function () { setTimeout(function () { next(i + 1); }, 1500); });
        }

        next(0);
    });

    dateInputEl.addEventListener("change", function () {
        if (dateInputEl.value) {
            loadDay(dateInputEl.value);
        }
    });

    slotsContentEl.addEventListener("click", function (e) {

        var slotToggle = e.target.closest("[data-slot-toggle]");

        if (!slotToggle) { return; }

        var key = slotToggle.getAttribute("data-slot-toggle");
        var devicesEl = slotsContentEl.querySelector("[data-slot-devices=\"" + key + "\"]");
        var slotArrowEl = slotsContentEl.querySelector("[data-slot-arrow=\"" + key + "\"]");

        devicesEl.hidden = !devicesEl.hidden;
        slotArrowEl.innerHTML = devicesEl.hidden ? "&#9662;" : "&#9652;";
    });

    var today = todayDateStr();

    fetch("/report/energy/consumption/days")
        .then(function (r) { return r.json(); })
        .then(function (res) {

            var availableDays = res.days || [];
            var initial = availableDays.length ? availableDays[availableDays.length - 1] : today;

            dateInputEl.min = availableDays.length ? availableDays[0] : today;
            dateInputEl.max = today;
            dateInputEl.value = initial;

            loadDay(initial);
        })
        .catch(function () {
            dateInputEl.value = today;
            loadDay(today);
        });
})();
