(function () {
    var listEl = document.getElementById("zigbee-devices-list");
    var statusEl = document.getElementById("zigbee-action-status");
    var permitButton = document.getElementById("permit-join-button");
    var permitSeconds = document.getElementById("permit-join-seconds");
    var networkBannerEl = document.getElementById("zigbee-network-open-banner");
    var networkTextEl = document.getElementById("zigbee-network-open-text");
    var reportChangeEl = document.getElementById("temp-report-change");
    var reportMaxEl = document.getElementById("temp-report-max");
    var reportSaveEl = document.getElementById("temp-report-save");
    var trvPollEl = document.getElementById("trv-poll-min");
    var reportStatusEl = document.getElementById("temp-report-status");

    function showStatus(text, isError) {
        statusEl.textContent = text;
        statusEl.className = "settings-message " + (isError ? "error" : "success");
    }

    function api(url, body) {
        return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        }).then(function (r) { return r.json(); });
    }

    // ==================================================
    // BANER "SIEC OTWARTA" - policzony do konkretnego momentu w czasie
    // (Date.now() + sekundy), a NIE po prostu odliczany co 1s od stalej
    // liczby - dzieki temu odswiezenie strony albo powrot z innej karty
    // (setInterval usypia w tle) nie psuje pozostalego czasu.
    // ==================================================

    var networkOpenUntilMs = 0;

    function tickNetworkBanner() {

        var remaining = Math.round((networkOpenUntilMs - Date.now()) / 1000);

        if (remaining <= 0) {
            networkBannerEl.hidden = true;
            return;
        }

        networkBannerEl.hidden = false;
        networkTextEl.textContent = "Pozostało jeszcze ok. " + remaining + " s - ustaw teraz nowe urządzenie Zigbee w tryb parowania.";
    }

    function setNetworkOpenSecondsLeft(secondsLeft) {
        networkOpenUntilMs = Date.now() + secondsLeft * 1000;
        tickNetworkBanner();
    }

    function loadStatus() {
        fetch("/zigbee/status")
            .then(function (r) { return r.json(); })
            .then(function (res) {
                setNetworkOpenSecondsLeft(res.network_open ? res.network_open_seconds_left : 0);
            });
    }

    function stateDot(dev) {

        var state = dev.state || {};

        if (state.ONOFF) {
            var isOn = state.ONOFF.state === 1;
            return {
                cls: isOn ? "online" : "",
                text: isOn ? "włączone" : "wyłączone"
            };
        }

        // Urzadzenia bez ONOFF (czujniki/TRV) sa zazwyczaj bateryjne -
        // usypiaja miedzy okresowymi raportami, zeby oszczedzac baterie
        // (to NORMALNE dzialanie, nie usterka). "dev.online" (na zywo
        // zmapowany local_id od ostatniego restartu C6 - patrz
        // drivers/uart_zigbee.py) mowi tylko, czy TA sesja S3 zdazyla
        // odswiezyc mapowanie, NIE czy urzadzenie faktycznie dziala -
        // dlatego zamiast tego pokazujemy, czy mamy OD NIEGO
        // jakiekolwiek dane (dowod, ze kiedykolwiek sie zglosilo).
        var hasState = Object.keys(state).length > 0;

        return {
            cls: hasState ? "online" : "",
            text: hasState ? "raportuje" : "brak jeszcze danych"
        };
    }

    // glowice termostatyczne - maja wspolny ekran sterowania
    // (www/trv_control.js); lista = drivers/thermostat.py::ADAPTERS
    var THERMOSTAT_TYPES = [4, 5];

    // przekazniki - wspolny ekran www/relay_control.js
    // (lista = drivers/relay.py::ADAPTERS)
    var RELAY_TYPES = [1, 2, 6];

    // urzadzenia z tabeli modeli C6 (typ 7): przekaznik, gdy maja On/Off
    // (bit 0 "caps" - patrz drivers/uart_zigbee.py::CAP_*)
    function isRelay(dev) {
        return RELAY_TYPES.indexOf(dev.device_type) >= 0 || (dev.device_type === 7 && (dev.caps & 1) === 1);
    }

    function controlLink(dev) {
        var page = THERMOSTAT_TYPES.indexOf(dev.device_type) >= 0 ? "thermostat" :
            (isRelay(dev) ? "relay" : null);
        if (!page) {
            return "";
        }
        return "<a class=\"maintenance-button maintenance-button-secondary\" href=\"/config/zigbee/" + page + "?ieee=" + dev.ieee + "\">Steruj</a> ";
    }

    var _devices = [];

    // ==================================================
    // RAPORTOWANIE TEMPERATURY - ustawienie dla wszystkich czujnikow
    // (drivers/uart_zigbee.py::_maybe_config_temp_report()); "wanted" -
    // ta sama wartosc w jednostkach ZCL do porownania z "temp_report"
    // potwierdzonym przez urzadzenie.
    // ==================================================

    var _reportWanted = null;

    function applyReportSettings(res) {
        if (!res || res.error) {
            return;
        }
        reportChangeEl.value = res.change_c;
        reportMaxEl.value = res.max_min;
        trvPollEl.value = res.trv_poll_min;
        _reportWanted = res.wanted;
    }

    function loadReportSettings() {
        fetch("/zigbee/reportSettings")
            .then(function (r) { return r.json(); })
            .then(applyReportSettings);
    }

    function isTempSensor(dev) {
        return dev.device_type === 3 || (dev.device_type === 7 && (dev.caps & 8) === 8);
    }

    function reportText(dev) {

        if (!isTempSensor(dev)) {
            return "";
        }

        var applied = dev.temp_report;

        if (applied && applied.status) {
            return " · raport temperatury: odrzucony przez czujnik (0x" + applied.status.toString(16) + ")";
        }

        if (applied && _reportWanted && applied.change === _reportWanted.change && applied.max === _reportWanted.max) {
            return " · raport temperatury: co " + (applied.change / 100).toFixed(2) + " °C / " + Math.round(applied.max / 60) + " min";
        }

        return " · raport temperatury: czeka na kolejny odczyt czujnika";
    }

    function deviceRowView(dev) {

        var dot = stateDot(dev);
        var title = dev.device_brand + " " + dev.device_model;
        var detail = (dev.device_category || "nieznany") + " · " + dev.ieee + reportText(dev);

        return "<tr>" +
            "<td><strong>" + title + "</strong>" +
            "<div class=\"settings-hint\">" + detail + "</div>" +
            "</td>" +
            "<td><span style=\"display:flex; align-items:center; gap:8px; white-space:nowrap\">" +
            "<span class=\"brand-dot " + dot.cls + "\"></span>" + dot.text +
            "</span></td>" +
            "<td class=\"align-right\" style=\"white-space:nowrap\">" +
            controlLink(dev) +
            "<button type=\"button\" class=\"maintenance-button\" data-action=\"test\" data-ieee=\"" + dev.ieee + "\">Testuj</button> " +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-action=\"remove\" data-ieee=\"" + dev.ieee + "\">Usuń</button>" +
            "</td>" +
            "</tr>";
    }

    function renderDevicesTable(devices) {
        var rows = devices.map(deviceRowView).join("");

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Urządzenie</th><th>Stan</th><th class=\"align-right\"></th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
            "</table>" +
            "</div>";
    }

    function renderDevices() {

        if (!_devices.length) {
            listEl.innerHTML = "<div class=\"history-empty\">Brak sparowanych urządzeń</div>";
            return;
        }

        listEl.innerHTML = renderDevicesTable(_devices);
    }

    function loadDevices() {

        fetch("/zigbee/devices")
            .then(function (r) { return r.json(); })
            .then(function (devices) {
                _devices = devices || [];
                renderDevices();
            })
            .catch(function () {
                listEl.innerHTML = "<div class=\"history-empty\">Błąd wczytywania listy</div>";
            });
    }

    // ==================================================
    // TESTUJ - odczyt OSTATNIEJ ZNANEJ telemetrii (patrz
    // drivers/uart_zigbee.py::test_device() - Zigbee jest
    // bezpolaczeniowe, wiec nie ma jak "na zadanie" odswiezyc
    // odczytu z urzadzenia). Ksztalt wyniku zalezy od kategorii
    // urzadzenia (przekaznik/termometr/TRV).
    // ==================================================

    function fmt1(value, unit) {
        return value == null ? "brak danych" : value.toFixed(1) + " " + unit;
    }

    function agoText(seconds) {
        if (seconds < 60) {
            return seconds + " s temu";
        }
        if (seconds < 3600) {
            return Math.floor(seconds / 60) + " min temu";
        }
        return Math.floor(seconds / 3600) + " h temu";
    }

    // patrz drivers/uart_zigbee.py::_availability()
    function availabilityText(res) {
        if (!res.known_to_c6) {
            return "offline – C6 nie zna urządzenia";
        }
        var text = res.online ? "online" : "offline – brak odpowiedzi";
        if (res.last_seen_s != null) {
            text += ", ostatni odczyt " + agoText(res.last_seen_s);
        }
        return text;
    }

    function formatTestResult(res) {

        var onlineText = availabilityText(res);

        if (res.category === "relay") {
            var stateText = res.state == null ? "brak danych" : (res.state ? "włączone" : "wyłączone");
            var powerText = res.has_power === false ? "" : " · Moc: " + fmt1(res.power_w, "W");
            return "Stan: " + stateText + powerText + " (" + onlineText + ")";
        }

        if (res.category === "sensor") {
            var sensorParts = [];
            if (res.temperature_c != null) {
                sensorParts.push("Temperatura: " + fmt1(res.temperature_c, "°C"));
            }
            if (res.humidity_pct != null) {
                sensorParts.push("Wilgotność: " + fmt1(res.humidity_pct, "%"));
            }
            if (res.occupied != null) {
                sensorParts.push(res.occupied ? "Ruch: wykryty" : "Ruch: brak");
            }
            if (res.alarm != null) {
                sensorParts.push(res.alarm ? "Alarm: aktywny" : "Alarm: brak");
            }
            if (res.tamper) {
                sensorParts.push("Sabotaż");
            }
            if (res.battery_pct != null) {
                sensorParts.push("Bateria: " + res.battery_pct + " %");
            }
            if (res.battery_low) {
                sensorParts.push("Bateria: niska");
            }
            return (sensorParts.length ? sensorParts.join(" · ") : "brak jeszcze danych") + " (" + onlineText + ")";
        }

        if (res.category === "thermometer") {
            return "Temperatura: " + fmt1(res.temperature_c, "°C") + " · Wilgotność: " + fmt1(res.humidity_pct, "%") + " (" + onlineText + ")";
        }

        if (res.category === "trv") {
            var parts = [
                "Temp. głowicy: " + fmt1(res.current_temp_c, "°C") +
                    (res.temp_age_s != null ? " (" + agoText(res.temp_age_s) + ")" : ""),
                "Zadana: " + fmt1(res.setpoint_c, "°C")
            ];
            if (res.external_state !== undefined || res.external_sensor) {
                var extText = {
                    external: "zewnętrzny (pomieszczenie)",
                    offline: "zewnętrzny nieaktualny – głowica wróciła do własnego",
                    internal: "własny"
                }[res.external_state] || "brak potwierdzenia z głowicy";
                if (res.external_temp_c != null && res.external_state !== "internal") {
                    extText += ", " + fmt1(res.external_temp_c, "°C");
                }
                if (res.external_sensor && res.external_state === "internal") {
                    extText += " – głowica nie przyjęła czujnika zewnętrznego";
                }
                parts.push("Czujnik regulacji: " + extText);
            }
            if (res.valve_pct != null) {
                parts.push("Zawór: " + res.valve_pct + " %");
            }
            if (res.mode != null) {
                parts.push("Tryb: " + res.mode);
            }
            if (res.battery_pct != null) {
                parts.push("Bateria: " + res.battery_pct + " %");
            }
            if (res.battery_low != null) {
                parts.push("Stan baterii: " + (res.battery_low ? "niska" : "OK"));
            }
            return parts.join(" · ") + " (" + onlineText + ")";
        }

        return "Brak obsługiwanego testu dla tego typu urządzenia.";
    }

    listEl.addEventListener("click", function (e) {

        var button = e.target.closest("button[data-action]");

        if (!button) {
            return;
        }

        var ieee = button.getAttribute("data-ieee");
        var action = button.getAttribute("data-action");

        if (action === "remove") {

            if (!confirm("Usunąć urządzenie z sieci Zigbee?")) {
                return;
            }

            api("/zigbee/devices/" + ieee + "/remove")
                .then(function () {
                    showStatus("Wysłano żądanie usunięcia.", false);
                    setTimeout(loadDevices, 500);
                });

        } else if (action === "test") {

            showStatus("Testowanie…", false);

            fetch("/zigbee/devices/" + ieee + "/test")
                .then(function (r) { return r.json(); })
                .then(function (res) {

                    if (res.error) {
                        showStatus("Błąd: " + res.error, true);
                        return;
                    }

                    showStatus(formatTestResult(res), false);
                })
                .catch(function () {
                    showStatus("Błąd testu urządzenia.", true);
                });
        }
    });

    permitButton.addEventListener("click", function () {

        var seconds = parseInt(permitSeconds.value, 10) || 180;

        api("/zigbee/permitJoin", { seconds: seconds })
            .then(function (res) {
                setNetworkOpenSecondsLeft(res.seconds);
            })
            .catch(function () {
                showStatus("Błąd wysyłania komendy.", true);
            });
    });

    reportSaveEl.addEventListener("click", function () {

        api("/zigbee/reportSettings", {
            change_c: reportChangeEl.value,
            max_min: reportMaxEl.value,
            trv_poll_min: trvPollEl.value
        })
            .then(function (res) {
                if (res.error) {
                    reportStatusEl.textContent = "Błąd: " + res.error;
                    reportStatusEl.className = "settings-message error";
                    return;
                }
                applyReportSettings(res);
                renderDevices();
                reportStatusEl.textContent = "Zapisano - czujniki dostaną ustawienie po swoim kolejnym odczycie.";
                reportStatusEl.className = "settings-message success";
            })
            .catch(function () {
                reportStatusEl.textContent = "Błąd zapisu.";
                reportStatusEl.className = "settings-message error";
            });
    });

    loadReportSettings();
    loadStatus();
    loadDevices();

    setInterval(tickNetworkBanner, 1000);
    setInterval(loadStatus, 5000);
    setInterval(loadDevices, 10000);
})();
