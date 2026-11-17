(function () {

    var form = document.getElementById("deye-config-form");
    var status = document.getElementById("deye-config-status");
    var discoveryInfoEl = document.getElementById("deye-discovery-info");
    var discoverButton = document.getElementById("deye-discover-button");
    var discoveryArea = document.getElementById("deye-discovery-area");
    var controlModeSelect = document.getElementById("deye-control-mode");
    var commModeSelect = document.getElementById("deye-comm-mode");
    var modbusSlaveInput = document.getElementById("deye-modbus-slave");
    var modeStatus = document.getElementById("deye-mode-status");
    var modeSaveButton = document.getElementById("deye-mode-save-button");

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    // =====================================================
    // DANE LOGOWANIA
    // =====================================================

    function credentialsComplete(cfg) {
        // te same pola sa wymagane przez /v1.0/account/token - patrz
        // drivers/deye_api.py::_login()
        return !!(cfg.EMAIL && cfg.APP_ID && cfg.APP_SECRET && cfg.PASSWORD_SHA256);
    }

    function loadCurrentSelection() {

        fetch("/deye/config")
            .then(function (r) { return r.json(); })
            .then(function (cfg) {

                var parts = [];

                if (cfg.PLANT_ID) { parts.push("Stacja: " + cfg.PLANT_ID); }
                if (cfg.INVERTER_SN) { parts.push("Falownik SN: " + cfg.INVERTER_SN); }
                if (cfg.STATION_NAME) { parts.push(cfg.STATION_NAME); }
                if (cfg.STATION_ADDRESS) { parts.push(cfg.STATION_ADDRESS); }

                discoveryInfoEl.textContent = parts.length
                    ? parts.join(" · ")
                    : "Nie pobrano jeszcze danych falownika - kliknij „Pobierz dane falownika”";

                if (credentialsComplete(cfg)) {
                    discoverButton.disabled = false;
                    discoverButton.title = "";
                } else {
                    discoverButton.disabled = true;
                    discoverButton.title = "Najpierw zapisz dane logowania (e-mail, hasło, App ID, App Secret)";
                }

                controlModeSelect.value = cfg.CONTROL_MODE || "ACTIVE";
                commModeSelect.value = cfg.COMM_MODE || "RS485";
                modbusSlaveInput.value = (cfg.MODBUS_SLAVE_ID != null) ? cfg.MODBUS_SLAVE_ID : 0;
            })
            .catch(function () {
                discoveryInfoEl.textContent = "Błąd odczytu.";
                discoverButton.disabled = true;
            });
    }

    modeSaveButton.addEventListener("click", function () {

        modeStatus.className = "settings-message";
        modeStatus.textContent = "Zapisywanie...";

        fetch("/deye/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                CONTROL_MODE: controlModeSelect.value,
                COMM_MODE: commModeSelect.value,
                MODBUS_SLAVE_ID: parseInt(modbusSlaveInput.value, 10) || 0
            })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                modeStatus.textContent = res.saved ? "Zapisano." : ("Błąd: " + (res.error || "nieznany"));
                modeStatus.className = "settings-message " + (res.saved ? "success" : "error");
            })
            .catch(function () {
                modeStatus.textContent = "Błąd zapisu.";
                modeStatus.className = "settings-message error";
            });
    });

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        var data = {};
        new FormData(form).forEach(function (value, key) {
            data[key] = value;
        });

        status.className = "settings-message";
        status.textContent = "Zapisywanie...";

        fetch("/deye/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                status.textContent = res.saved ? "Zapisano." : ("Błąd: " + (res.error || "nieznany"));
                status.className = "settings-message " + (res.saved ? "success" : "error");

                if (res.saved) {
                    discoveryArea.innerHTML = "";
                    loadCurrentSelection();
                }
            })
            .catch(function () {
                status.textContent = "Błąd zapisu.";
                status.className = "settings-message error";
            });
    });

    // =====================================================
    // WYBOR STACJI / URZADZENIA
    // =====================================================

    function renderMessage(text, isError) {
        discoveryArea.innerHTML = "<div class=\"settings-message " + (isError ? "error" : "") + "\" style=\"padding:12px 0\">" + escapeHtml(text) + "</div>";
    }

    function renderDevices(stationId, stationName, stationAddress, devices) {

        if (!devices.length) {
            renderMessage("Brak urządzeń w tej stacji.", true);
            return;
        }

        discoveryArea.innerHTML = "<div class=\"settings-panel-title\">Wybierz urządzenie</div>" +
            devices.map(function (d) {
                return "<div class=\"settings-row\">" +
                    "<div class=\"settings-row-text\"><label>" + escapeHtml(d.sn) + "</label>" +
                    "<div class=\"settings-hint\">" + escapeHtml(d.type || "?") + "</div></div>" +
                    "<button type=\"button\" data-device-sn=\"" + escapeHtml(d.sn) + "\" data-device-type=\"" + escapeHtml(d.type || "") + "\">Wybierz</button>" +
                    "</div>";
            }).join("");

        Array.prototype.forEach.call(discoveryArea.querySelectorAll("[data-device-sn]"), function (btn) {
            btn.addEventListener("click", function () {

                var deviceSn = btn.getAttribute("data-device-sn");
                var deviceType = btn.getAttribute("data-device-type");

                renderMessage("Zapisywanie…", false);

                fetch("/deye/discovery/select", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        stationId: parseInt(stationId, 10),
                        deviceSn: deviceSn,
                        stationName: stationName,
                        stationAddress: stationAddress,
                        deviceType: deviceType
                    })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (res) {

                        if (!res.ok) {
                            renderMessage("Błąd: " + (res.error || "nieznany"), true);
                            return;
                        }

                        discoveryArea.innerHTML = "";
                        loadCurrentSelection();
                    })
                    .catch(function () {
                        renderMessage("Błąd zapisu wyboru.", true);
                    });
            });
        });
    }

    function renderStations(stations) {

        if (!stations.length) {
            renderMessage("Brak stacji na tym koncie.", true);
            return;
        }

        discoveryArea.innerHTML = "<div class=\"settings-panel-title\">Wybierz stację</div>" +
            stations.map(function (s) {

                var hint = "ID " + s.id;
                if (s.capacity_kw) { hint += " · " + s.capacity_kw + " kWp"; }
                if (s.status) { hint += " · " + s.status; }
                if (s.address) { hint += " · " + s.address; }

                return "<div class=\"settings-row\">" +
                    "<div class=\"settings-row-text\"><label>" + escapeHtml(s.name) + "</label>" +
                    "<div class=\"settings-hint\">" + escapeHtml(hint) + "</div></div>" +
                    "<button type=\"button\" data-station-id=\"" + s.id + "\" data-station-name=\"" + escapeHtml(s.name) + "\" data-station-address=\"" + escapeHtml(s.address || "") + "\">Wybierz</button>" +
                    "</div>";
            }).join("");

        Array.prototype.forEach.call(discoveryArea.querySelectorAll("[data-station-id]"), function (btn) {
            btn.addEventListener("click", function () {

                var stationId = btn.getAttribute("data-station-id");
                var stationName = btn.getAttribute("data-station-name");
                var stationAddress = btn.getAttribute("data-station-address");

                renderMessage("Pobieranie urządzeń…", false);

                fetch("/deye/discovery/devices?stationId=" + stationId)
                    .then(function (r) { return r.json(); })
                    .then(function (res) {

                        if (!res.ok) {
                            renderMessage("Błąd: " + (res.error || "nieznany"), true);
                            return;
                        }

                        renderDevices(stationId, stationName, stationAddress, res.devices);
                    })
                    .catch(function () {
                        renderMessage("Błąd pobierania urządzeń.", true);
                    });
            });
        });
    }

    discoverButton.addEventListener("click", function () {

        renderMessage("Pobieranie stacji…", false);

        fetch("/deye/discovery/stations")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (!res.ok) {
                    renderMessage("Błąd: " + (res.error || "nieznany"), true);
                    return;
                }

                renderStations(res.stations);
            })
            .catch(function () {
                renderMessage("Błąd pobierania stacji.", true);
            });
    });

    loadCurrentSelection();
})();
