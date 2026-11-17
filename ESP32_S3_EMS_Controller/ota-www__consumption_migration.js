(function () {
    function el(id) { return document.getElementById(id); }

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function fmtWh(value) {
        if (value == null) { return "—"; }
        return (value / 1000).toFixed(3) + " kWh";
    }

    var sourceEl = el("migration-source");
    var targetEl = el("migration-target");
    var modeEl = el("migration-mode");
    var untilEl = el("migration-until");
    var fromEl = el("migration-from");
    var toEl = el("migration-to");
    var dayEl = el("migration-day");
    var statusEl = el("migration-status");
    var resultsEl = el("migration-results");
    var tableEl = el("migration-table");
    var transferEl = el("migration-transfer");
    var availableDays = [];
    var currentRows = [];
    var selectedByDay = {};

    function status(message, isError) {
        statusEl.textContent = message;
        statusEl.className = "settings-message" + (isError ? " error" : "");
    }

    function errorText(code) {
        var messages = {
            invalid_date: "Nieprawidłowa data.",
            invalid_device_id: "Nieprawidłowy identyfikator urządzenia.",
            source_device_not_found: "Nie znaleziono urządzenia dawcy.",
            target_device_not_found: "Nie znaleziono urządzenia biorcy.",
            source_and_target_must_differ: "Dawca i biorca muszą być różnymi urządzeniami.",
            history_day_not_found: "Brak zapisanej historii dla wybranego dnia.",
            no_slots_selected: "Zaznacz co najmniej jeden slot.",
            one_day_per_transfer: "Zapis jest ograniczony do jednego dnia naraz."
        };
        return messages[code] || code || "Wystąpił nieznany błąd.";
    }

    function selectedSlots() {
        var slots = [];
        Object.keys(selectedByDay).forEach(function (day) {
            Object.keys(selectedByDay[day]).forEach(function (label) {
                if (selectedByDay[day][label]) {
                    slots.push({ date: day, slot: label });
                }
            });
        });
        return slots;
    }

    function updateTransferButton() {
        transferEl.disabled = selectedSlots().length === 0;
        transferEl.textContent = "Przenieś zaznaczone (" + selectedSlots().length + ")";
    }

    function rememberVisibleSelection() {
        if (!dayEl.value) { return; }
        var day = dayEl.value;
        selectedByDay[day] = selectedByDay[day] || {};
        tableEl.querySelectorAll("input[data-slot]").forEach(function (input) {
            var row = currentRows[Number(input.value)];
            if (row) {
                if (input.checked) { selectedByDay[day][row.slot] = true; }
                else { delete selectedByDay[day][row.slot]; }
            }
        });
        if (!Object.keys(selectedByDay[day]).length) { delete selectedByDay[day]; }
    }

    function renderRows(rows) {
        currentRows = rows;
        var selected = selectedByDay[dayEl.value] || {};
        var eligibleSlots = {};
        rows.forEach(function (row) {
            if (row.eligible) { eligibleSlots[row.slot] = true; }
        });
        Object.keys(selected).forEach(function (slot) {
            if (!eligibleSlots[slot]) { delete selected[slot]; }
        });
        if (!Object.keys(selected).length) { delete selectedByDay[dayEl.value]; }
        if (!rows.length) {
            tableEl.innerHTML = "<div class=\"history-empty\">Brak zapisanych slotów tego dnia.</div>";
            updateTransferButton();
            return;
        }

        var body = rows.map(function (row, index) {
            var checkbox = row.eligible
                ? "<input type=\"checkbox\" data-slot value=\"" + index + "\"" +
                    (selected[row.slot] ? " checked" : "") + ">"
                : "";
            return "<tr>" +
                "<td class=\"align-center\">" + checkbox + "</td>" +
                "<td>" + escapeHtml(row.slot) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(row.source_wh) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtWh(row.target_wh) + "</td>" +
                "<td>" + escapeHtml(row.status) + "</td>" +
                "</tr>";
        }).join("");

        tableEl.innerHTML = "<table class=\"history-measurements\"><thead><tr>" +
            "<th></th><th>Godzina</th><th>Dawca</th><th>Biorca</th><th>Uwagi</th>" +
            "</tr></thead><tbody>" + body + "</tbody></table>";
        tableEl.querySelectorAll("input[data-slot]").forEach(function (input) {
            input.addEventListener("change", function () {
                rememberVisibleSelection();
                updateTransferButton();
            });
        });
        updateTransferButton();
    }

    function filteredDays() {
        var mode = modeEl.value;
        if (mode === "until") {
            if (!untilEl.value) { return []; }
            return availableDays.filter(function (day) { return day <= untilEl.value; });
        }
        if (mode === "range") {
            if (!fromEl.value || !toEl.value || fromEl.value > toEl.value) { return []; }
            return availableDays.filter(function (day) {
                return day >= fromEl.value && day <= toEl.value;
            });
        }
        return availableDays.slice();
    }

    function updateScopeControls() {
        el("migration-until-wrap").hidden = modeEl.value !== "until";
        el("migration-range-wrap").hidden = modeEl.value !== "range";
        updateDayOptions(true);
    }

    function updateDayOptions(selectLatest) {
        var days = filteredDays();
        var previous = dayEl.value;
        var allowedDays = {};
        days.forEach(function (day) { allowedDays[day] = true; });
        Object.keys(selectedByDay).forEach(function (day) {
            if (!allowedDays[day]) { delete selectedByDay[day]; }
        });
        dayEl.innerHTML = days.map(function (day) {
            return "<option value=\"" + day + "\">" + day + "</option>";
        }).join("");
        if (!days.length) {
            invalidatePreview("Brak zapisanych dni w wybranym zakresie.");
            return;
        }
        if (days.indexOf(previous) !== -1 && !selectLatest) {
            dayEl.value = previous;
        } else {
            dayEl.value = days[days.length - 1];
        }
        invalidatePreview("Wybierz dzień i pokaż jego sloty.");
    }

    function loadOptions() {
        status("Ładowanie urządzeń i dostępnych dat…");
        fetch("/report/energy/consumption/migration/options")
            .then(function (response) {
                if (!response.ok) { throw new Error("Błąd odczytu konfiguracji"); }
                return response.json();
            })
            .then(function (data) {
                var options = data.devices.map(function (device) {
                    return "<option value=\"" + escapeHtml(device.id) + "\">" +
                        escapeHtml(device.name) + " (" + escapeHtml(device.id) + ")</option>";
                }).join("");
                sourceEl.innerHTML = options;
                targetEl.innerHTML = options;
                availableDays = data.days || [];
                if (availableDays.length) {
                    [untilEl, fromEl, toEl].forEach(function (input) {
                        input.min = availableDays[0];
                        input.max = availableDays[availableDays.length - 1];
                    });
                    untilEl.value = availableDays[availableDays.length - 1];
                    fromEl.value = availableDays[0];
                    toEl.value = availableDays[availableDays.length - 1];
                }
                if (data.devices.length > 1) { targetEl.selectedIndex = 1; }
                updateScopeControls();
                status(availableDays.length
                    ? "Wybierz zakres historii i dzień do przeglądu."
                    : "Brak zapisanych dni historii.");
            })
            .catch(function (error) { status(error.message, true); });
    }

    function loadPreview(afterLoad) {
        if (!dayEl.value) {
            status("Wybierz dzień z dostępną historią.", true);
            return;
        }
        if (sourceEl.value === targetEl.value) {
            status("Dawca i biorca muszą być różnymi urządzeniami.", true);
            return;
        }
        rememberVisibleSelection();
        currentRows = [];
        transferEl.disabled = true;
        tableEl.innerHTML = "<div class=\"history-empty\">Wczytywanie slotów…</div>";
        status("Wczytywanie slotów…");
        resultsEl.hidden = false;
        var query = "?date=" + encodeURIComponent(dayEl.value) +
            "&source=" + encodeURIComponent(sourceEl.value) +
            "&target=" + encodeURIComponent(targetEl.value);
        fetch("/report/energy/consumption/migration/preview" + query)
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (data.error) { throw new Error(errorText(data.error)); }
                renderRows(data.slots || []);
                var eligible = (data.slots || []).filter(function (row) { return row.eligible; }).length;
                status("Urządzenie: " + data.source_name + " → " + data.target_name +
                    ". " + dayEl.value + ": slotów z pomiarem " + data.slots.length +
                    ", możliwych do przeniesienia " + eligible +
                    ". Zaznaczono łącznie: " + selectedSlots().length + ".");
                if (afterLoad) { afterLoad(); }
            })
            .catch(function (error) { status(error.message, true); });
    }

    function invalidatePreview(message, clearSelections) {
        if (clearSelections) { selectedByDay = {}; }
        currentRows = [];
        tableEl.innerHTML = "";
        transferEl.disabled = true;
        resultsEl.hidden = true;
        status(message);
    }

    function setAllVisible(checked) {
        tableEl.querySelectorAll("input[data-slot]").forEach(function (input) {
            input.checked = checked;
        });
        rememberVisibleSelection();
        updateTransferButton();
    }

    function transfer() {
        var slots = selectedSlots();
        if (!slots.length) { return; }
        if (!window.confirm("Przenieść " + slots.length +
                " zaznaczonych slotów? W biorcy zostaną zmienione tylko brakujące lub zerowe wartości. " +
                "Wartości dawcy zostaną wyczyszczone wyłącznie po udanym przeniesieniu.")) {
            return;
        }

        var groups = {};
        slots.forEach(function (slot) {
            groups[slot.date] = groups[slot.date] || [];
            groups[slot.date].push(slot);
        });
        var days = Object.keys(groups).sort();
        var moved = 0;
        var skipped = 0;
        var errors = [];
        transferEl.disabled = true;

        function transferNextDay(index) {
            if (index >= days.length) {
                var message = "Przeniesiono: " + moved + ", pominięto: " + skipped + ".";
                if (errors.length) {
                    message += " Błędy zapisu dla dat: " + errors.join(", ") + ".";
                }
                loadPreview(function () { status(message, errors.length > 0); });
                return;
            }

            var day = days[index];
            status("Zapisywanie dnia " + day + " (" + (index + 1) + "/" + days.length + ")…");
            fetch("/report/energy/consumption/migration/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    source_id: sourceEl.value,
                    target_id: targetEl.value,
                    slots: groups[day].map(function (slot) { return { date: slot.date, slot: slot.slot }; })
                })
            })
                .then(function (response) { return response.json(); })
                .then(function (data) {
                    if (data.error) { throw new Error(errorText(data.error)); }
                    moved += data.moved.length;
                    skipped += data.skipped.length;
                    if (data.errors.length) {
                        data.errors.forEach(function (item) {
                            errors.push(day + " (" + item.error + ")");
                        });
                    }
                    data.moved.concat(data.skipped).forEach(function (entry) {
                        if (selectedByDay[day]) { delete selectedByDay[day][entry.slot]; }
                    });
                    if (selectedByDay[day] && !Object.keys(selectedByDay[day]).length) {
                        delete selectedByDay[day];
                    }
                    transferNextDay(index + 1);
                })
                .catch(function (error) {
                    errors.push(day + " (" + error.message + ")");
                    transferNextDay(index + 1);
                });
        }

        transferNextDay(0);
    }

    el("migration-preview").addEventListener("click", function () { loadPreview(); });
    modeEl.addEventListener("change", function () { updateScopeControls(); });
    untilEl.addEventListener("change", function () { updateDayOptions(true); });
    [fromEl, toEl].forEach(function (input) {
        input.addEventListener("change", function () { updateDayOptions(true); });
    });
    dayEl.addEventListener("change", function () {
        invalidatePreview("Zmieniono dzień — pokaż jego sloty.");
    });
    [sourceEl, targetEl].forEach(function (input) {
        input.addEventListener("change", function () {
            invalidatePreview("Zmieniono urządzenia — ponownie pokaż sloty.", true);
        });
    });
    el("migration-select-eligible").addEventListener("click", function () { setAllVisible(true); });
    el("migration-select-none").addEventListener("click", function () { setAllVisible(false); });
    transferEl.addEventListener("click", transfer);

    loadOptions();
}());
