(function () {

    var latEl = document.getElementById("LATITUDE");
    var lonEl = document.getElementById("LONGITUDE");
    var pvEfficiencyEl = document.getElementById("PV_EFFICIENCY");
    var ratedPowerEl = document.getElementById("RATED_POWER_W");
    var batteryCapacityEl = document.getElementById("BATTERY_CAPACITY_AH");
    var listEl = document.getElementById("arrays-list");
    var addButton = document.getElementById("add-array-button");
    var saveButton = document.getElementById("meteo-config-save");
    var status = document.getElementById("meteo-config-status");
    var suggestionEl = document.getElementById("pv-efficiency-suggestion");
    var applySuggestionButton = document.getElementById("pv-efficiency-apply-button");

    function arrayRow(array) {

        var row = document.createElement("div");
        row.className = "array-table-row";

        row.innerHTML =
            "<input type=\"number\" step=\"any\" class=\"array-tilt\" title=\"Kąt nachylenia (°)\" value=\"" + (array.tilt != null ? array.tilt : 30) + "\">" +
            "<input type=\"number\" step=\"any\" class=\"array-azimuth\" title=\"Azymut (°)\" value=\"" + (array.azimuth != null ? array.azimuth : 0) + "\">" +
            "<input type=\"number\" step=\"any\" min=\"0\" class=\"array-panel-power\" title=\"Moc panelu (W)\" value=\"" + (array.panel_power_w != null ? array.panel_power_w : 400) + "\">" +
            "<input type=\"number\" step=\"1\" min=\"0\" class=\"array-panel-count\" title=\"Ilość paneli\" value=\"" + (array.panel_count != null ? array.panel_count : 1) + "\">" +
            "<input type=\"number\" step=\"1\" min=\"0\" max=\"100\" class=\"array-efficiency\" title=\"Sprawność (%)\" value=\"" + Math.round((array.efficiency != null ? array.efficiency : 1.0) * 100) + "\">" +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary maintenance-button-danger\" data-remove-row>Usuń</button>";

        row.querySelector("[data-remove-row]").addEventListener("click", function () {
            row.remove();
        });

        return row;
    }

    function loadConfig() {

        fetch("/meteo/config")
            .then(function (r) { return r.json(); })
            .then(function (cfg) {

                latEl.value = cfg.LATITUDE;
                lonEl.value = cfg.LONGITUDE;
                pvEfficiencyEl.value = Math.round((cfg.PV_EFFICIENCY != null ? cfg.PV_EFFICIENCY : 0.9) * 100);
                ratedPowerEl.value = cfg.RATED_POWER_W || 0;
                batteryCapacityEl.value = cfg.BATTERY_CAPACITY_AH || 0;

                listEl.innerHTML = "";

                (cfg.ARRAYS || []).forEach(function (array) {
                    listEl.appendChild(arrayRow(array));
                });
            })
            .catch(function () {
                status.textContent = "Błąd wczytywania konfiguracji.";
                status.className = "settings-message error";
            });
    }

    addButton.addEventListener("click", function () {
        listEl.appendChild(arrayRow({ tilt: 30, azimuth: 0, panel_power_w: 400, panel_count: 1, efficiency: 1.0 }));
    });

    saveButton.addEventListener("click", function () {

        var arrays = Array.prototype.map.call(listEl.children, function (row) {
            return {
                tilt: parseFloat(row.querySelector(".array-tilt").value) || 0,
                azimuth: parseFloat(row.querySelector(".array-azimuth").value) || 0,
                panel_power_w: parseFloat(row.querySelector(".array-panel-power").value) || 0,
                panel_count: parseFloat(row.querySelector(".array-panel-count").value) || 0,
                efficiency: (parseFloat(row.querySelector(".array-efficiency").value) || 0) / 100,
            };
        });

        if (!arrays.length) {
            status.textContent = "Dodaj co najmniej jeden zestaw paneli.";
            status.className = "settings-message error";
            return;
        }

        var data = {
            LATITUDE: parseFloat(latEl.value),
            LONGITUDE: parseFloat(lonEl.value),
            PV_EFFICIENCY: (parseFloat(pvEfficiencyEl.value) || 0) / 100,
            RATED_POWER_W: parseFloat(ratedPowerEl.value) || 0,
            BATTERY_CAPACITY_AH: parseFloat(batteryCapacityEl.value) || 0,
            ARRAYS: arrays,
        };

        status.className = "settings-message";
        status.textContent = "Zapisywanie...";

        fetch("/meteo/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                status.textContent = res.saved ? "Zapisano." : ("Błąd: " + (res.error || "nieznany"));
                status.className = "settings-message " + (res.saved ? "success" : "error");
            })
            .catch(function () {
                status.textContent = "Błąd zapisu.";
                status.className = "settings-message error";
            });
    });

    function loadSuggestion() {

        fetch("/meteo/calibration")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (res.suggested == null) {
                    suggestionEl.textContent = "Za mało danych jeszcze (" + res.hours_sampled + "h z ostatnich " + res.days_sampled + " dni) - potrzeba co najmniej 6h.";
                    applySuggestionButton.hidden = true;
                    return;
                }

                var currentPct = Math.round(res.current * 100);
                var suggestedPct = Math.round(res.suggested * 100);

                if (suggestedPct === currentPct) {
                    suggestionEl.textContent = "Obecna wartość (" + currentPct + "%) pasuje do ostatnich " + res.hours_sampled + "h danych.";
                    applySuggestionButton.hidden = true;
                    return;
                }

                suggestionEl.textContent = "Na bazie ostatnich " + res.hours_sampled + "h (" + res.days_sampled + " dni): sugerowana " + suggestedPct + "% (obecna " + currentPct + "%).";
                applySuggestionButton.hidden = false;
                applySuggestionButton.setAttribute("data-suggested", res.suggested);
            })
            .catch(function () {
                suggestionEl.textContent = "Błąd wczytywania kalibracji.";
                applySuggestionButton.hidden = true;
            });
    }

    applySuggestionButton.addEventListener("click", function () {

        var value = parseFloat(applySuggestionButton.getAttribute("data-suggested"));

        if (!confirm("Zastosować sugerowaną efektywność " + Math.round(value * 100) + "%?")) {
            return;
        }

        fetch("/meteo/calibration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: value })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (!res.saved) {
                    suggestionEl.textContent = "Błąd: " + (res.error || "nieznany");
                    return;
                }

                pvEfficiencyEl.value = Math.round(res.PV_EFFICIENCY * 100);
                loadSuggestion();
            })
            .catch(function () {
                suggestionEl.textContent = "Błąd zapisu kalibracji.";
            });
    });

    loadConfig();
    loadSuggestion();
})();
