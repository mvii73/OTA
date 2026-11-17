// Dwa ekrany pomieszczenia (www/room_form.py) z jednym skryptem:
// Konfiguracja pomieszczenia (/config/rooms/form) i Harmonogram ogrzewania
// pomieszczenia (/config/rooms/schedule, jest #schedule-list). Kazdy zapisuje
// TYLKO swoje pola - reszta pomieszczenia z odczytu GET /rooms/<id>
// (PUT przyjmuje cale pomieszczenie, storage/rooms_store.py).
(function () {

    function el(id) { return document.getElementById(id); }

    function getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function api(url, method, body) {
        var opts = { method: method || "GET" };

        if (body !== undefined) {
            opts.headers = { "Content-Type": "application/json" };
            opts.body = JSON.stringify(body);
        }

        return fetch(url, opts).then(function (r) { return r.json(); });
    }

    function setStatus(text, isError) {
        var elm = el("room-form-status");
        elm.textContent = text;
        elm.className = "settings-message " + (isError ? "error" : "success");
    }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    var DAY_NAMES = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];

    // typy glowic Zigbee - jak THERMOSTAT_TYPES w www/zigbee_config.js
    // (drivers/thermostat.py::ADAPTERS)
    var THERMOSTAT_TYPES = [4, 5];

    // czujniki bez odczytu temperatury / bez obecnosci (patrz ems/schedule.py)
    var NO_TEMPERATURE_KINDS = ["ld2410c"];
    var NO_PRESENCE_KINDS = ["ds18b20", "local_ds18b20"];
    var NO_HUMIDITY_KINDS = ["ld2410c", "ds18b20", "local_ds18b20"];

    var editId = getQueryParam("id");
    var isSchedule = !!el("schedule-list");

    // pomieszczenie z odczytu - pola drugiego ekranu zapisywane bez zmian
    var loaded = null;

    var ERRORS = {
        "missing_field:name": "Podaj nazwę pomieszczenia.",
        "invalid_days": "Każdy zakres musi mieć zaznaczony co najmniej jeden dzień.",
        "empty_range": "Godzina \"od\" i \"do\" zakresu nie mogą być takie same.",
        "temp_out_of_range": "Temperatura musi być w przedziale 5–30 °C.",
        "invalid_presence_min": "Obecność: podaj liczbę minut 0–8640.",
        "presence_sensor_required": "Zakres harmonogramu z kontrolą obecności wymaga czujnika obecności (Konfiguracja pomieszczenia) - wybierz czujnik albo ustaw obecność 0 w harmonogramie.",
        "invalid_manual_hold": "Tryb ręczny: podaj liczbę minut 0–1440.",
        "invalid_humidity": "Wilgotność maksymalna: podaj wartość 30–95 % (wymagane przy włączonej redukcji).",
        "invalid_humidity_hysteresis": "Histereza wilgotności: podaj wartość 0–30 %.",
        "humidity_sensor_required": "Kontrola wilgotności wymaga wybrania czujnika wilgotności.",
        "invalid_volume": "Kubatura: podaj wartość większą od 0 i nie większą niż 2000 m³ (albo zostaw puste).",
    };

    // =====================================================
    // EKRAN: HARMONOGRAM OGRZEWANIA
    // =====================================================

    function scheduleScreen() {

        var scheduleList = el("schedule-list");
        var defaultTemp = el("room-default-temp");

        // kolumna "Obec. (min)" tylko przy czujniku obecnosci (Konfiguracja pomieszczenia)
        function hasPresenceSensor() {
            return !!(loaded && loaded.presence_sensor_id);
        }

        function gridColumns() {
            return hasPresenceSensor()
                ? "minmax(300px, 1fr) 96px 96px 72px 64px 76px"
                : "minmax(300px, 1fr) 96px 96px 72px 76px";
        }

        function updatePresenceColumn() {

            var visible = hasPresenceSensor();
            var columns = gridColumns();

            el("schedule-head").style.gridTemplateColumns = columns;
            el("default-row").style.gridTemplateColumns = columns;
            el("presence-head").hidden = !visible;
            el("default-presence-cell").hidden = !visible;

            Array.prototype.forEach.call(scheduleList.children, function (row) {
                row.style.gridTemplateColumns = columns;
                row.querySelector(".range-presence").hidden = !visible;
            });
        }

        function rangeRow(range) {

            var row = document.createElement("div");
            row.className = "edit-table-row";
            row.style.gridTemplateColumns = gridColumns();

            var days = range.days || [];

            var daysHtml = DAY_NAMES.map(function (label, i) {
                var checked = days.indexOf(i) !== -1 ? " checked" : "";
                return "<label style=\"display:inline-flex; align-items:center; gap:2px; font-weight:normal; margin-right:3px\">" +
                    "<input type=\"checkbox\" class=\"range-day\" value=\"" + i + "\"" + checked + ">" + label + "</label>";
            }).join("");

            row.innerHTML =
                "<div style=\"white-space:nowrap\">" + daysHtml + "</div>" +
                "<input type=\"time\" class=\"range-from\" value=\"" + escapeHtml(range.from || "06:00") + "\">" +
                "<input type=\"time\" class=\"range-to\" value=\"" + escapeHtml(range.to || "22:00") + "\">" +
                "<input type=\"number\" step=\"0.5\" min=\"5\" max=\"30\" class=\"range-temp\" style=\"padding:8px 6px\" value=\"" + (range.temp != null ? range.temp : 21) + "\">" +
                "<input type=\"number\" step=\"1\" min=\"0\" max=\"8640\" class=\"range-presence\" style=\"padding:8px 6px\" title=\"0 = bez kontroli obecności\" value=\"" + (range.presence_min || 0) + "\">" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary maintenance-button-danger\" data-remove>Usuń</button>";

            row.querySelector("[data-remove]").addEventListener("click", function () {
                row.remove();
            });

            row.querySelector(".range-presence").hidden = !hasPresenceSensor();

            return row;
        }

        el("add-range-button").addEventListener("click", function () {
            scheduleList.appendChild(rangeRow({ days: [0, 1, 2, 3, 4, 5, 6] }));
            updatePresenceColumn();
        });

        function fill(room) {
            defaultTemp.value = room["default"].temp;
            scheduleList.innerHTML = "";
            (room.schedule || []).forEach(function (r) {
                scheduleList.appendChild(rangeRow(r));
            });
            updatePresenceColumn();
        }

        function collect() {
            return {
                "default": { temp: parseFloat(defaultTemp.value) },
                schedule: Array.prototype.map.call(scheduleList.children, function (row) {
                    return {
                        days: Array.prototype.filter.call(row.querySelectorAll(".range-day"), function (cb) {
                            return cb.checked;
                        }).map(function (cb) { return parseInt(cb.value, 10); }),
                        from: row.querySelector(".range-from").value,
                        to: row.querySelector(".range-to").value,
                        temp: parseFloat(row.querySelector(".range-temp").value),
                        presence_min: parseInt(row.querySelector(".range-presence").value, 10) || 0,
                    };
                }),
            };
        }

        if (!editId) {
            setStatus("Brak pomieszczenia - zapisz najpierw konfigurację pomieszczenia.", true);
            el("room-form-save").disabled = true;
            return null;
        }

        api("/rooms/" + editId).then(function (room) {
            if (room.error) {
                setStatus("Błąd: " + room.error, true);
                return;
            }
            loaded = room;
            fill(room);
        }).catch(function () {
            setStatus("Błąd wczytywania danych.", true);
        });

        return collect;
    }

    // =====================================================
    // EKRAN: KONFIGURACJA POMIESZCZENIA
    // =====================================================

    function configScreen() {

        var nameInput = el("room-name");
        var tempSelect = el("room-temp-sensor");
        var presenceSelect = el("room-presence-sensor");
        var thermostatSelect = el("room-thermostat");
        var heaterSelect = el("room-heater");
        var manualHoldInput = el("room-manual-hold");
        var volumeInput = el("room-volume");
        var humidityEnabled = el("room-humidity-enabled");
        var humiditySelect = el("room-humidity-sensor");
        var maxTempInput = el("room-max-temp");
        var humidityMaxInput = el("room-humidity-max");
        var humidityHystInput = el("room-humidity-hyst");

        function fillSelect(select, entries, emptyLabel) {
            select.innerHTML = "<option value=\"\">" + escapeHtml(emptyLabel) + "</option>" +
                entries.map(function (entry) {
                    return "<option value=\"" + escapeHtml(entry.id) + "\">" + escapeHtml(entry.name || entry.id) + "</option>";
                }).join("");
        }

        function setSelectValue(select, value) {

            if (value && !select.querySelector("option[value=\"" + value + "\"]")) {
                // przypisany wczesniej, a dzis juz niedostepny - zostaje widoczny
                var option = document.createElement("option");
                option.value = value;
                option.textContent = value + " (brak)";
                select.appendChild(option);
            }

            select.value = value || "";
        }

        function loadOptions() {

            return Promise.all([
                api("/device/schedule/sensors"),
                api("/device/schedule/devices"),
                api("/zigbee/devices"),
            ]).then(function (res) {

                var sensors = res[0] || {};
                var devices = res[1] || {};
                var zigbeeTypes = {};

                (res[2] || []).forEach(function (dev) {
                    zigbeeTypes[dev.ieee] = dev.device_type;
                });

                var sensorIds = Object.keys(sensors);

                fillSelect(tempSelect, sensorIds.filter(function (id) {
                    return NO_TEMPERATURE_KINDS.indexOf(sensors[id].kind) === -1;
                }).map(function (id) { return { id: id, name: sensors[id].name }; }), "– brak –");

                fillSelect(humiditySelect, sensorIds.filter(function (id) {
                    return NO_HUMIDITY_KINDS.indexOf(sensors[id].kind) === -1;
                }).map(function (id) { return { id: id, name: sensors[id].name }; }), "– brak –");

                fillSelect(presenceSelect, sensorIds.filter(function (id) {
                    return NO_PRESENCE_KINDS.indexOf(sensors[id].kind) === -1;
                }).map(function (id) { return { id: id, name: sensors[id].name }; }), "– brak –");

                fillSelect(thermostatSelect, Object.keys(devices).filter(function (id) {
                    var d = devices[id];
                    return d.kind === "zigbee" && THERMOSTAT_TYPES.indexOf(zigbeeTypes[d.ieee]) !== -1;
                }).map(function (id) { return { id: id, name: devices[id].name }; }), "– brak –");

                // urzadzenie grzewcze - dowolne ON/OFF, bez glowic termostatycznych
                fillSelect(heaterSelect, Object.keys(devices).filter(function (id) {
                    var d = devices[id];
                    return !(d.kind === "zigbee" && THERMOSTAT_TYPES.indexOf(zigbeeTypes[d.ieee]) !== -1);
                }).map(function (id) { return { id: id, name: devices[id].name }; }), "– brak –");
            });
        }

        // urzadzenie grzewcze bez termostatu i czujnika temperatury - brak
        // odczytu, EMS trzyma je wylaczone (ems/rooms_heating.py) - ostrzezenie,
        // zapis dozwolony
        var heaterAlert = el("room-heater-alert");

        function updateHeaterAlert() {
            heaterAlert.hidden = !(heaterSelect.value && !thermostatSelect.value && !tempSelect.value);
        }

        [heaterSelect, thermostatSelect, tempSelect].forEach(function (select) {
            select.addEventListener("change", updateHeaterAlert);
        });

        // "Temperatura sterująca termostatem": wybor tylko z czujnikiem temperatury i termostatem -
        // inaczej glowica zawsze wg wlasnego czujnika (pokazane, ale wyszarzone);
        // zapamietany wybor wraca po ponownym wybraniu czujnika
        var trvSourceSelect = el("room-trv-temp-source");
        var trvSource = "sensor";

        function updateTrvSource() {
            var choice = !!(tempSelect.value && thermostatSelect.value);
            trvSourceSelect.disabled = !choice;
            trvSourceSelect.value = choice ? trvSource : "internal";
        }

        trvSourceSelect.addEventListener("change", function () { trvSource = trvSourceSelect.value; });
        [thermostatSelect, tempSelect].forEach(function (select) {
            select.addEventListener("change", updateTrvSource);
        });

        // redukcja wilgotnosci wylaczona - pola progu i histerezy wyszarzone
        // (czujnik zostaje aktywny, bo sluzy tez do odczytow)
        function updateHumidityFields() {
            humidityMaxInput.disabled = humidityHystInput.disabled = !humidityEnabled.checked;
        }

        humidityEnabled.addEventListener("change", updateHumidityFields);

        function fill(room) {
            nameInput.value = room.name || "";
            setSelectValue(tempSelect, room.temp_sensor_id);
            setSelectValue(presenceSelect, room.presence_sensor_id);
            setSelectValue(thermostatSelect, room.thermostat_device_id);
            setSelectValue(heaterSelect, room.heater_device_id);
            manualHoldInput.value = room.manual_hold_min != null ? room.manual_hold_min : 120;
            volumeInput.value = room.volume_m3 != null ? room.volume_m3 : "";
            humidityEnabled.checked = room.humidity_enabled != null ? !!room.humidity_enabled : room.humidity_max != null;
            setSelectValue(humiditySelect, room.humidity_sensor_id);
            maxTempInput.value = room.max_temp != null ? room.max_temp : "";
            humidityMaxInput.value = room.humidity_max != null ? room.humidity_max : "";
            humidityHystInput.value = room.humidity_hysteresis != null ? room.humidity_hysteresis : 5;
            trvSource = room.trv_temp_source === "internal" ? "internal" : "sensor";
            updateHumidityFields();
            updateHeaterAlert();
            updateTrvSource();
        }

        function collect() {

            var name = nameInput.value.trim();

            if (!name) {
                setStatus(ERRORS["missing_field:name"], true);
                return null;
            }

            return {
                name: name,
                temp_sensor_id: tempSelect.value || null,
                trv_temp_source: trvSource,
                presence_sensor_id: presenceSelect.value || null,
                thermostat_device_id: thermostatSelect.value || null,
                heater_device_id: heaterSelect.value || null,
                manual_hold_min: manualHoldInput.value === "" ? 120 : parseInt(manualHoldInput.value, 10),
                volume_m3: volumeInput.value === "" ? null : parseFloat(volumeInput.value),
                humidity_enabled: humidityEnabled.checked,
                humidity_sensor_id: humiditySelect.value || null,
                max_temp: maxTempInput.value === "" ? null : parseFloat(maxTempInput.value),
                humidity_max: humidityMaxInput.value === "" ? null : parseFloat(humidityMaxInput.value),
                humidity_hysteresis: humidityHystInput.value === "" ? null : parseFloat(humidityHystInput.value),
            };
        }

        loadOptions().then(function () {

            if (!editId) {
                // nowe pomieszczenie - harmonogram domyslny (zmiana na ekranie
                // Harmonogram ogrzewania po zapisie)
                loaded = {
                    name: "",
                    "default": { temp: 18 },
                    schedule: [
                        { days: [0, 1, 2, 3, 4], from: "06:00", to: "08:00", temp: 21 },
                        { days: [0, 1, 2, 3, 4, 5, 6], from: "16:00", to: "22:00", temp: 21 },
                    ],
                };
                fill(loaded);
                return;
            }

            el("room-form-title").textContent = "Edytuj pomieszczenie";

            return api("/rooms/" + editId).then(function (room) {

                if (room.error) {
                    setStatus("Błąd: " + room.error, true);
                    return;
                }

                loaded = room;
                fill(room);
            });

        }).catch(function () {
            setStatus("Błąd wczytywania danych.", true);
        });

        return collect;
    }

    // =====================================================
    // ZAPIS
    // =====================================================

    var collect = isSchedule ? scheduleScreen() : configScreen();

    el("room-form-save").addEventListener("click", function () {

        if (!collect || !loaded) {
            return;
        }

        var part = collect();

        if (!part) {
            return;
        }

        var data = Object.assign({}, loaded, part);

        setStatus("Zapisywanie...", false);

        var req = editId
            ? api("/rooms/" + editId, "PUT", data)
            : api("/rooms", "POST", data);

        req.then(function (res) {

            if (res.error) {
                setStatus(ERRORS[res.error] || ("Błąd: " + res.error), true);
                return;
            }

            window.location.href = "/config/rooms";
        }).catch(function () {
            setStatus("Błąd zapisu.", true);
        });
    });
})();
