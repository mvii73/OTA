(function () {

    // ==================================================
    // CENTRALNE OGRZEWANIE - model sterowania, urzadzenia i czujniki:
    // GET/PUT /heating/config (storage/heating_store.py). Decyzje
    // (ems/heating_sim.py, GET /heating/sim) - panel, ekran Heating.
    // ==================================================

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
        var elm = el("hs-form-status");
        elm.textContent = text;
        elm.className = "settings-message " + (isError ? "error" : "success");
    }

    // czujniki bez odczytu temperatury (patrz ems/schedule.py)
    var NO_TEMPERATURE_KINDS = ["ld2410c"];

    // ---------- stan ----------

    function fillSelect(select, entries, emptyLabel) {
        select.innerHTML = "<option value=\"\">" + escapeHtml(emptyLabel) + "</option>" +
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

    function paramInputs() {
        return Array.prototype.slice.call(document.querySelectorAll("[data-param]"));
    }

    function updateOutdoorSensor() {
        el("hs-outdoor-sensor").disabled = el("hs-outdoor-source").value !== "sensor";
    }

    // tylko ustawienia wybranego interfejsu do kotla (bramka albo DIYLESS)
    function updateInterface() {
        var diyless = el("hs-boiler-interface").value === "diyless";
        el("hs-gateway-block").hidden = diyless;
        el("hs-diyless-block").hidden = !diyless;
    }

    el("hs-boiler-interface").addEventListener("change", updateInterface);

    function fillForm(cfg) {
        el("hs-boiler-interface").value = cfg.boiler_interface || "gateway";
        setSelectValue(el("hs-heater-device"), cfg.heater_device_id);
        setSelectValue(el("hs-heater-pump"), cfg.heater_pump_device_id);
        setSelectValue(el("hs-heater-supply-sensor"), cfg.heater_supply_sensor_id);
        setSelectValue(el("hs-heater-return-sensor"), cfg.heater_return_sensor_id);
        setSelectValue(el("hs-supply-sensor"), cfg.supply_sensor_id);
        setSelectValue(el("hs-return-sensor"), cfg.return_sensor_id);
        setSelectValue(el("hs-outdoor-sensor"), cfg.outdoor_sensor_id);
        el("hs-gateway-ip").value = cfg.gateway_ip || "";
        el("hs-diyless-ip").value = cfg.diyless_ip || "";
        el("hs-diyless-control").checked = !!cfg.diyless_control;
        el("hs-heater-water-interlock").checked = !!cfg.heater_water_interlock;
        el("hs-heater-control").checked = !!cfg.heater_control;
        el("hs-strategy").value = cfg.strategy || "heater_support";
        el("hs-load-source").value = cfg.load_source || "kw";
        el("hs-outdoor-source").value = cfg.outdoor_source || "meteo";
        paramInputs().forEach(function (input) {
            var v = cfg[input.getAttribute("data-param")];
            input.value = v == null ? "" : v;
        });
        updateOutdoorSensor();
        updateInterface();
    }

    el("hs-outdoor-source").addEventListener("change", updateOutdoorSensor);

    // model sterowania - zapis od razu (tylko to pole)
    el("hs-strategy").addEventListener("change", function () {
        api("/heating/config", "PUT", { strategy: el("hs-strategy").value }).then(function (res) {
            if (res.error) {
                setStatus(errorText(res.error), true);
                return;
            }
            setStatus("Zapisano model sterowania.", false);
        });
    });

    Promise.all([
        api("/device/schedule/devices"),
        api("/device/schedule/sensors"),
        api("/heating/config"),
    ]).then(function (res) {

        var devices = res[0] || {};
        var sensors = res[1] || {};

        fillSelect(el("hs-heater-pump"), Object.keys(devices).map(function (id) {
            return { id: id, name: devices[id].name };
        }), "– brak –");

        fillSelect(el("hs-heater-device"), Object.keys(devices).map(function (id) {
            return { id: id, name: devices[id].name };
        }), "– brak –");

        var tempSensors = Object.keys(sensors).filter(function (id) {
            return NO_TEMPERATURE_KINDS.indexOf(sensors[id].kind) === -1;
        }).map(function (id) { return { id: id, name: sensors[id].name }; });

        ["hs-heater-supply-sensor", "hs-heater-return-sensor", "hs-supply-sensor", "hs-return-sensor", "hs-outdoor-sensor"].forEach(function (id) {
            fillSelect(el(id), tempSensors, "– brak –");
        });

        fillForm(res[2] || {});

    }).catch(function () {
        setStatus("Błąd wczytywania konfiguracji.", true);
    });

    var ERRORS = {
        "outdoor_sensor_required": "Wybierz czujnik temperatury zewnętrznej albo przełącz na prognozę meteo.",
        "boiler_min_above_max": "Moc minimalna kotła nie może być wyższa niż maksymalna.",
        "supply_min_not_below_max": "Zasilanie minimalne musi być niższe niż maksymalne.",
        "return_limit_not_below_max": "Próg ograniczania powrotu musi być niższy niż temperatura wyłączenia.",
        "diyless_min_above_max": "Błąd przy minimalnej modulacji nie może być większy niż przy maksymalnej.",
        "invalid_boiler_interface": "Niepoprawny interfejs do kotła.",
        "diyless_ip_required": "Sterowanie przez sterownik DIYLESS wymaga podania jego adresu IP.",
        "design_outdoor_not_below_indoor": "Temperatura zewnętrzna obliczeniowa musi być niższa niż wewnętrzna."
    };

    function errorText(code) {
        if (ERRORS[code]) { return ERRORS[code]; }
        var m = /^(invalid_value|out_of_range):(.+)$/.exec(code || "");
        if (m) {
            var input = document.querySelector("[data-param=\"" + m[2] + "\"]");
            var label = input ? document.querySelector("label[for=\"" + input.id + "\"]").textContent : m[2];
            return (m[1] === "out_of_range" ? "Poza zakresem: " : "Niepoprawna wartość: ") + label;
        }
        return "Błąd: " + code;
    }

    el("hs-save").addEventListener("click", function () {

        var data = {
            heater_device_id: el("hs-heater-device").value || null,
            heater_pump_device_id: el("hs-heater-pump").value || null,
            heater_supply_sensor_id: el("hs-heater-supply-sensor").value || null,
            heater_return_sensor_id: el("hs-heater-return-sensor").value || null,
            supply_sensor_id: el("hs-supply-sensor").value || null,
            return_sensor_id: el("hs-return-sensor").value || null,
            outdoor_source: el("hs-outdoor-source").value,
            outdoor_sensor_id: el("hs-outdoor-sensor").value || null,
            boiler_interface: el("hs-boiler-interface").value,
            gateway_ip: el("hs-gateway-ip").value.trim() || null,
            diyless_ip: el("hs-diyless-ip").value.trim() || null,
            diyless_control: el("hs-diyless-control").checked,
            heater_water_interlock: el("hs-heater-water-interlock").checked,
            heater_control: el("hs-heater-control").checked,
            strategy: el("hs-strategy").value,
            load_source: el("hs-load-source").value
        };

        paramInputs().forEach(function (input) {
            data[input.getAttribute("data-param")] = input.value;
        });

        setStatus("Zapisywanie...", false);

        api("/heating/config", "PUT", data).then(function (res) {
            if (res.error) {
                setStatus(errorText(res.error), true);
                return;
            }
            setStatus("Zapisano.", false);
            fillForm(res.config);
        }).catch(function () {
            setStatus("Błąd zapisu.", true);
        });
    });

})();
