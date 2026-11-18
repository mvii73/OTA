(function () {

    function el(id) { return document.getElementById(id); }

    function api(url, method, body) {
        var opts = { method: method || "GET" };

        if (body !== undefined) {
            opts.headers = { "Content-Type": "application/json" };
            opts.body = JSON.stringify(body);
        }

        return fetch(url, opts).then(function (r) { return r.json(); });
    }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function setStatus(text, isError) {
        var elm = el("wh-form-status");
        elm.textContent = text;
        elm.className = "settings-message " + (isError ? "error" : "success");
    }

    function num(v, digits) {
        return v == null ? "–" : Number(v).toFixed(digits).replace(".", ",");
    }

    // kolumny - jak SCHEDULE_COLS/CONDITION_COLS w www/water_heater.py
    var SCHEDULE_COLS = "minmax(300px, 1fr) 96px 96px 72px 76px";
    var CONDITION_COLS = "130px minmax(300px, 1fr) 72px 76px";
    var BLOCK_COLS = "130px minmax(300px, 1fr) 76px";

    var DAY_NAMES = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
    var MODES = ["CHARGE", "WAIT", "IDLE", "DISCHARGE", "GRID", "STANDBY"];

    // czujniki bez odczytu temperatury (patrz ems/schedule.py)
    var NO_TEMPERATURE_KINDS = ["ld2410c"];

    var circEnabled = el("wh-circ-enabled");
    var circDevice = el("wh-circ-device");
    var circRooms = el("wh-circ-rooms");
    var circDeviceWarning = el("wh-circ-device-warning");
    var circMinutes = el("wh-circ-minutes");
    var roomDefs = {};

    var enabledInput = el("wh-enabled");
    var deviceSelect = el("wh-device");
    var sensorSelect = el("wh-sensor");
    var scheduleList = el("wh-schedule-list");
    var conditionsList = el("wh-conditions-list");
    var blocksList = el("wh-blocks-list");
    var defaultTemp = el("wh-default-temp");
    var boostTemp = el("wh-boost-temp");
    var boostMinutes = el("wh-boost-minutes");
    var boostEnd = el("wh-boost-end");
    var gasMaxTemp = el("wh-gas-max-temp");
    var bathTemp = el("wh-bath-temp");

    function fillSelect(select, entries) {
        select.innerHTML = "<option value=\"\">– wybierz –</option>" +
            entries.map(function (entry) {
                return "<option value=\"" + escapeHtml(entry.id) + "\">" + escapeHtml(entry.name || entry.id) + "</option>";
            }).join("");
    }

    function setSelectValue(select, value) {

        if (value && !select.querySelector("option[value=\"" + value + "\"]")) {
            var option = document.createElement("option");
            option.value = value;
            option.textContent = value + " (brak)";
            select.appendChild(option);
        }

        select.value = value || "";
    }

    function tempInput(cls, value) {
        return "<input type=\"number\" step=\"0.5\" min=\"5\" max=\"85\" class=\"" + cls + "\" style=\"padding:8px 6px\" value=\"" +
            (value != null ? value : "") + "\">";
    }

    function removeButton() {
        return "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary maintenance-button-danger\" data-remove>Usuń</button>";
    }

    // =====================================================
    // HARMONOGRAM
    // =====================================================

    function rangeRow(range) {

        var row = document.createElement("div");
        row.className = "edit-table-row";
        row.style.gridTemplateColumns = SCHEDULE_COLS;

        var days = range.days || [];

        var daysHtml = DAY_NAMES.map(function (label, i) {
            var checked = days.indexOf(i) !== -1 ? " checked" : "";
            return "<label style=\"display:inline-flex; align-items:center; gap:2px; font-weight:normal; margin-right:3px\">" +
                "<input type=\"checkbox\" class=\"range-day\" value=\"" + i + "\"" + checked + ">" + label + "</label>";
        }).join("");

        row.innerHTML =
            "<div style=\"white-space:nowrap\">" + daysHtml + "</div>" +
            "<input type=\"time\" class=\"range-from\" value=\"" + escapeHtml(range.from || "06:00") + "\">" +
            "<input type=\"time\" class=\"range-to\" value=\"" + escapeHtml(range.to || "08:00") + "\">" +
            tempInput("range-temp", range.temp != null ? range.temp : 40) +
            removeButton();

        row.querySelector("[data-remove]").addEventListener("click", function () {
            row.remove();
        });

        return row;
    }

    el("wh-add-range").addEventListener("click", function () {
        scheduleList.appendChild(rangeRow({ days: [0, 1, 2, 3, 4, 5, 6] }));
    });

    // =====================================================
    // WARUNKI DODATKOWE
    // =====================================================

    function conditionValueHtml(c) {

        if (c.type === "RCE") {
            return "<div style=\"display:flex; align-items:center; gap:6px; white-space:nowrap\">" +
                "<select class=\"cond-operator\">" +
                "<option value=\"LT\"" + (c.operator !== "GT" ? " selected" : "") + ">&lt; niższa niż</option>" +
                "<option value=\"GT\"" + (c.operator === "GT" ? " selected" : "") + ">&gt; wyższa niż</option>" +
                "</select>" +
                "<input type=\"number\" step=\"0.01\" class=\"cond-threshold\" style=\"width:80px; padding:8px 6px\" value=\"" +
                (c.threshold_pln != null ? c.threshold_pln : 0.2) + "\"> zł/kWh</div>";
        }

        var modes = c.modes || [];

        return "<div style=\"white-space:nowrap\">" + MODES.map(function (m) {
            var checked = modes.indexOf(m) !== -1 ? " checked" : "";
            return "<label style=\"display:inline-flex; align-items:center; gap:2px; font-weight:normal; margin-right:6px\">" +
                "<input type=\"checkbox\" class=\"cond-mode\" value=\"" + m + "\"" + checked + ">" + m + "</label>";
        }).join("") + "</div>";
    }

    // withTemps = false - wiersz wstrzymania grzania (bez temperatury)
    function conditionRow(c, withTemps) {

        if (withTemps === undefined) { withTemps = true; }

        var row = document.createElement("div");
        row.className = "edit-table-row";
        row.style.gridTemplateColumns = withTemps ? CONDITION_COLS : BLOCK_COLS;

        row.innerHTML =
            "<select class=\"cond-type\">" +
            "<option value=\"MODE\"" + (c.type !== "RCE" ? " selected" : "") + ">Tryb pracy</option>" +
            "<option value=\"RCE\"" + (c.type === "RCE" ? " selected" : "") + ">Cena RCE</option>" +
            "</select>" +
            "<div class=\"cond-value\">" + conditionValueHtml(c) + "</div>" +
            (withTemps
                ? tempInput("range-temp", c.temp != null ? c.temp : 50)
                : "") +
            removeButton();

        row.querySelector(".cond-type").addEventListener("change", function (e) {
            row.querySelector(".cond-value").innerHTML = conditionValueHtml({ type: e.target.value });
        });

        row.querySelector("[data-remove]").addEventListener("click", function () {
            row.remove();
        });

        return row;
    }

    el("wh-add-condition").addEventListener("click", function () {
        conditionsList.appendChild(conditionRow({ type: "MODE", modes: ["CHARGE"] }));
    });

    el("wh-add-block").addEventListener("click", function () {
        blocksList.appendChild(conditionRow({ type: "MODE", modes: ["DISCHARGE"] }, false));
    });

    // =====================================================
    // STAN I PLAN
    // =====================================================

    function tempRange(item) {
        if (item.temp == null) { return "wyłączona"; }
        return num(item.temp, 1) + " °C";
    }

    function renderStatus(s) {

        var box = el("wh-status");

        if (!s || !s.enabled) {
            box.textContent = "Sterowanie wyłączone.";
            return;
        }

        if (!s.checked_at) {
            box.textContent = "Czeka na pierwsze sprawdzenie.";
            return;
        }

        box.textContent = "Woda " + num(s.temp, 1) + " °C · zadana " + (s.target ? tempRange(s.target) : "wyłączona") +
            " (" + s.source + ") · grzałka " + (s.heating ? "WŁ." : "WYŁ.") + " · " + s.checked_at.slice(11, 16) +
            (s.boost && s.boost.active ? " · wymuszone grzanie do " + (s.boost.limit || s.boost.until) : "") +
            (s.waiting ? " · czeka: " + s.waiting + " (grzałka ma priorytet nad dogrzewaczem)" : "");
    }

    function renderPlan(items) {

        var box = el("wh-plan");

        if (!items || !items.length) {
            box.innerHTML = "<div class=\"history-empty\">Brak danych</div>";
            return;
        }

        var rows = items.map(function (p) {

            var rce = p.rce_min == null ? "–" :
                (p.rce_min === p.rce_max ? num(p.rce_min, 2) : num(p.rce_min, 2) + " – " + num(p.rce_max, 2));

            return "<tr" + (p.now ? " style=\"font-weight:600\"" : "") + ">" +
                "<td>" + escapeHtml(p.from + " – " + p.to) + (p.now ? " ◀" : "") + "</td>" +
                "<td class=\"measurement-energy\">" + tempRange(p) + "</td>" +
                "<td>" + escapeHtml(p.source) + "</td>" +
                "<td>" + escapeHtml(p.modes.join(", ") || "–") + "</td>" +
                "<td class=\"measurement-energy\">" + rce + "</td></tr>";
        }).join("");

        box.innerHTML = "<div class=\"history-measurements-wrapper\"><table class=\"history-measurements\">" +
            "<thead><tr><th>Godziny</th><th class=\"align-right\">Temperatura</th><th>Źródło</th><th>Tryb EMS</th><th class=\"align-right\">RCE (zł/kWh)</th></tr></thead>" +
            "<tbody>" + rows + "</tbody></table></div>";
    }

    function loadPlan() {
        return Promise.all([api("/water-heater/plan"), api("/water-heater/status")]).then(function (res) {
            renderPlan(res[0]);
            renderStatus(res[1]);
        });
    }

    // =====================================================
    // POMPA CYRKULACYJNA
    // =====================================================

    function renderCircRooms(selected) {

        selected = selected || [];

        var ids = Object.keys(roomDefs);

        // zapisane, ale nieistniejace juz pomieszczenie zostaje widoczne jako "(brak)"
        selected.forEach(function (id) {
            if (ids.indexOf(id) === -1) { ids.push(id); }
        });

        circRooms.innerHTML = ids.map(function (id) {
            var def = roomDefs[id];
            var name = def ? (def.name || id) : id + " (brak)";
            var checked = selected.indexOf(id) !== -1 ? " checked" : "";
            // bez czujnika obecnosci nic nie wyzwoli pompy - nie da sie zaznaczyc
            var noSensor = def && !def.presence_sensor_id;
            return "<label style=\"display:block; font-weight:normal\"><input type=\"checkbox\" class=\"circ-room\" value=\"" +
                escapeHtml(id) + "\"" + checked + (noSensor && !checked ? " disabled" : "") + "> " + escapeHtml(name) +
                (noSensor ? " <span class=\"settings-hint\">(brak czujnika obecności)</span>" : "") + "</label>";
        }).join("") || "<span class=\"settings-hint\">Brak pomieszczeń - dodaj je w ekranie Pomieszczenia.</span>";
    }

    function circName(id) {
        return roomDefs[id] ? (roomDefs[id].name || id) : id;
    }

    function renderCirc(s) {

        var box = el("wh-circ-status");

        if (!s || s.error) {
            box.textContent = "Brak danych.";
            return;
        }

        if (!s.enabled) {
            box.textContent = "Sterowanie wyłączone.";
            return;
        }

        var pump = s.pump_on === true
            ? "<b>WŁ.</b> (jeszcze " + Math.floor(s.remaining_s / 60) + ":" + ("0" + (s.remaining_s % 60)).slice(-2) + ")"
            : (s.pump_on === false ? "wyłączona" : "stan nieznany");

        var rooms = (s.rooms || []).map(function (r) {
            return escapeHtml(r.name) + ": " + (r.present === true ? "ruch" : (r.last ? "ostatnio " + escapeHtml(r.last.slice(11, 19)) : "–"));
        }).join(" · ");

        box.innerHTML = "Pompa " + pump + (rooms ? " · " + rooms : "") +
            (s.last ? " · ostatnie uruchomienie: " + escapeHtml(circName(s.last.room)) + " o " + escapeHtml(s.last.at.slice(11, 19)) : "") +
            (s.error ? " · <span style=\"color:var(--danger, #c0392b)\">błąd: " + escapeHtml(s.error) + "</span>" : "");
    }

    var circLoading = false;

    function loadCirculation() {

        if (circLoading) { return; }

        circLoading = true;

        api("/water-heater/circulation").then(renderCirc).catch(function () {
            el("wh-circ-status").textContent = "Błąd odczytu stanu.";
        }).then(function () { circLoading = false; });
    }

    function circAction(action) {
        api("/water-heater/circulation", "POST", { action: action }).then(renderCirc).catch(function () {
            setStatus("Błąd polecenia dla pompy.", true);
        });
    }

    // ostrzezenie przy wyborze przelacznika: czy steruja nim juz zdarzenia/reguly
    // (zapis i tak blokuje serwer - patrz storage/water_heater_store.py::device_controllers())
    function checkCircDevice() {

        var id = circDevice.value;

        if (!id) {
            circDeviceWarning.hidden = true;
            return;
        }

        api("/water-heater/device-check?device=" + encodeURIComponent(id)).then(function (res) {
            var list = (res && res.controllers) || [];

            if (circDevice.value !== id) { return; }   // wybor zmienil sie w trakcie zapytania

            circDeviceWarning.hidden = !list.length;
            circDeviceWarning.textContent = list.length
                ? "To urządzenie jest już sterowane przez: " + list.join(", ") + ". Wyłącz lub usuń je w Urządzeniach i integracjach - bez tego nie da się zapisać."
                : "";
        }).catch(function () {
            circDeviceWarning.hidden = true;
        });
    }

    circDevice.addEventListener("change", checkCircDevice);

    el("wh-circ-start").addEventListener("click", function () { circAction("start"); });
    el("wh-circ-stop").addEventListener("click", function () { circAction("stop"); });

    // =====================================================
    // LOAD / SAVE
    // =====================================================

    function fillForm(cfg) {
        var circ = cfg.circulation || {};
        circEnabled.checked = !!circ.enabled;
        setSelectValue(circDevice, circ.device_id);
        circMinutes.value = circ.run_minutes != null ? circ.run_minutes : 3;
        renderCircRooms(circ.room_ids);
        checkCircDevice();
        enabledInput.checked = !!cfg.enabled;
        setSelectValue(deviceSelect, cfg.heater_device_id);
        setSelectValue(sensorSelect, cfg.temp_sensor_id);
        defaultTemp.value = cfg["default"] ? cfg["default"].temp : "";
        boostTemp.value = cfg.boost_temp != null ? cfg.boost_temp : 50;
        boostMinutes.value = cfg.boost_minutes != null ? cfg.boost_minutes : 30;
        boostEnd.value = cfg.boost_end === "temp" ? "temp" : "time";
        gasMaxTemp.value = cfg.gas_max_temp != null ? cfg.gas_max_temp : 60;
        bathTemp.value = cfg.bath_temp != null ? cfg.bath_temp : 40;
        scheduleList.innerHTML = "";
        (cfg.schedule || []).forEach(function (r) { scheduleList.appendChild(rangeRow(r)); });
        conditionsList.innerHTML = "";
        (cfg.conditions || []).forEach(function (c) { conditionsList.appendChild(conditionRow(c)); });
        blocksList.innerHTML = "";
        (cfg.blocks || []).forEach(function (b) { blocksList.appendChild(conditionRow(b, false)); });
    }

    Promise.all([
        api("/device/schedule/devices"),
        api("/device/schedule/sensors"),
        api("/water-heater"),
        api("/rooms"),
    ]).then(function (res) {

        var devices = res[0] || {};
        var sensors = res[1] || {};
        var cfg = res[2] || {};

        var deviceEntries = Object.keys(devices).map(function (id) {
            return { id: id, name: devices[id].name };
        });

        fillSelect(deviceSelect, deviceEntries);
        fillSelect(circDevice, deviceEntries);

        roomDefs = res[3] || {};

        fillSelect(sensorSelect, Object.keys(sensors).filter(function (id) {
            return NO_TEMPERATURE_KINDS.indexOf(sensors[id].kind) === -1;
        }).map(function (id) { return { id: id, name: sensors[id].name }; }));

        fillForm(cfg);

    }).catch(function () {
        setStatus("Błąd wczytywania danych.", true);
    });

    loadPlan();
    loadCirculation();

    // stan pompy odswiezany co 5 s (jedno zapytanie naraz, bez ukrytej karty)
    setInterval(function () {
        if (!document.hidden) { loadCirculation(); }
    }, 5000);

    var ERRORS = {
        "circulation_minutes_out_of_range": "Czas pracy pompy musi być w przedziale 1–60 min.",
        "circulation_device_and_room_required": "Do włączenia pompy wybierz przełącznik i co najmniej jedno pomieszczenie.",
        "circulation_unknown_room": "Zaznaczone pomieszczenie już nie istnieje - odznacz je.",
        "circulation_room_without_sensor": "Zaznaczone pomieszczenie nie ma przypisanego czujnika obecności (ekran Pomieszczenia).",
        "circulation_device_is_heater": "Przełącznik pompy nie może być tym samym urządzeniem co grzałka.",
        "invalid_days": "Każdy zakres musi mieć zaznaczony co najmniej jeden dzień.",
        "empty_range": "Godzina \"od\" i \"do\" zakresu nie mogą być takie same.",
        "temp_out_of_range": "Temperatura musi być w przedziale 5–85 °C.",
        "invalid_modes": "Warunek trybu pracy musi mieć zaznaczony co najmniej jeden tryb.",
        "device_and_sensor_required": "Do włączenia sterowania wybierz grzałkę i czujnik temperatury.",
        "boost_minutes_out_of_range": "Czas wymuszonego grzania musi być w przedziale 5–240 min.",
        "invalid_boost_end": "Wybierz, kiedy kończy się wymuszone grzanie.",
        "gas_max_temp_out_of_range": "Temperatura maksymalna grzania gazem musi być w przedziale 30–80 °C.",
    };

    function readTemps(row) {
        return { temp: parseFloat(row.querySelector(".range-temp").value) };
    }

    el("wh-save").addEventListener("click", function () {

        var dTemp = defaultTemp.value.trim();

        var schedule = Array.prototype.map.call(scheduleList.children, function (row) {
            var r = readTemps(row);
            r.days = Array.prototype.filter.call(row.querySelectorAll(".range-day"), function (cb) {
                return cb.checked;
            }).map(function (cb) { return parseInt(cb.value, 10); });
            r.from = row.querySelector(".range-from").value;
            r.to = row.querySelector(".range-to").value;
            return r;
        });

        function readTrigger(row, c) {
            c.type = row.querySelector(".cond-type").value;
            if (c.type === "RCE") {
                c.operator = row.querySelector(".cond-operator").value;
                c.threshold_pln = parseFloat(row.querySelector(".cond-threshold").value) || 0;
            } else {
                c.modes = Array.prototype.filter.call(row.querySelectorAll(".cond-mode"), function (cb) {
                    return cb.checked;
                }).map(function (cb) { return cb.value; });
            }
            return c;
        }

        var conditions = Array.prototype.map.call(conditionsList.children, function (row) {
            return readTrigger(row, readTemps(row));
        });

        var blocks = Array.prototype.map.call(blocksList.children, function (row) {
            return readTrigger(row, {});
        });

        var data = {
            enabled: enabledInput.checked,
            heater_device_id: deviceSelect.value || null,
            temp_sensor_id: sensorSelect.value || null,
            "default": dTemp === "" ? null : { temp: parseFloat(dTemp) },
            schedule: schedule,
            conditions: conditions,
            blocks: blocks,
            boost_temp: parseFloat(boostTemp.value),
            boost_minutes: parseInt(boostMinutes.value, 10),
            boost_end: boostEnd.value,
            gas_max_temp: parseInt(gasMaxTemp.value, 10),
            bath_temp: parseFloat(bathTemp.value),
            circulation: {
                enabled: circEnabled.checked,
                device_id: circDevice.value || null,
                room_ids: Array.prototype.filter.call(circRooms.querySelectorAll(".circ-room"), function (cb) {
                    return cb.checked;
                }).map(function (cb) { return cb.value; }),
                run_minutes: parseInt(circMinutes.value, 10),
            },
        };

        setStatus("Zapisywanie...", false);

        api("/water-heater", "PUT", data).then(function (res) {

            if (res.error) {
                var prefix = "circulation_device_in_use:";

                if (res.error.indexOf(prefix) === 0) {
                    setStatus("Przełącznik pompy jest już sterowany przez: " +
                        res.error.slice(prefix.length).split("|").join(", ") +
                        ". Wyłącz lub usuń je w Urządzeniach i integracjach.", true);
                    return;
                }

                setStatus(ERRORS[res.error] || ("Błąd: " + res.error), true);
                return;
            }

            setStatus("Zapisano.", false);
            fillForm(res.config);
            renderPlan(res.plan);

        }).catch(function () {
            setStatus("Błąd zapisu.", true);
        });
    });
})();
