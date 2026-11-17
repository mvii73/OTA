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
        var elm = el("rule-form-status");
        elm.textContent = text;
        elm.className = "settings-message " + (isError ? "error" : "success");
    }

    var editId = getQueryParam("id");

    var deviceSelect = el("rule-device");
    var sensorSelect = el("rule-sensor-id");
    var thermostatSensorSelect = el("rule-thermostat-sensor-id");
    var actionSelect = el("rule-action");
    var conditionSelect = el("rule-condition");

    function updateActionFields() {
        el("rule-value-row").hidden = actionSelect.value !== "SET_TEMP" || conditionSelect.value === "THERMOSTAT";
    }

    function updateConditionFields() {
        var condition = conditionSelect.value;
        var isThermostat = condition === "THERMOSTAT";

        // Akcja jest wyliczana dynamicznie dla termostatu (patrz
        // ems/schedule.py::_evaluate_condition()) - pole "Akcja" z
        // formularza jest wtedy bez znaczenia, wiec je ukrywamy.
        el("rule-action-row").hidden = isThermostat;
        el("rule-sensor-fields").hidden = condition !== "SENSOR";
        el("rule-thermostat-fields").hidden = !isThermostat;
        el("rule-modes-fields").hidden = condition !== "MODE";
        el("rule-threshold-fields").hidden = condition === "ALWAYS" || condition === "MODE" || isThermostat;
        el("rule-time-from-hint").hidden = !isThermostat;

        updateActionFields();
    }

    function getModeCheckboxes() {
        return Array.prototype.slice.call(document.querySelectorAll(".rule-mode-checkbox"));
    }

    function setSelectedModes(modes) {
        modes = modes || [];
        getModeCheckboxes().forEach(function (cb) {
            cb.checked = modes.indexOf(cb.value) !== -1;
        });
    }

    function getSelectedModes() {
        return getModeCheckboxes().filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
    }

    actionSelect.addEventListener("change", updateActionFields);
    conditionSelect.addEventListener("change", updateConditionFields);

    function fillSelect(select, entries) {
        select.innerHTML = entries.map(function (entry) {
            return "<option value=\"" + entry.id + "\">" + (entry.name || entry.id) + "</option>";
        }).join("");
    }

    function loadOptionsAndData() {

        var devicesPromise = api("/device/schedule/devices").then(function (devices) {
            devices = devices || {};
            fillSelect(deviceSelect, Object.keys(devices).map(function (id) {
                return { id: id, name: devices[id].name };
            }));
        });

        var sensorsPromise = api("/device/schedule/sensors").then(function (sensors) {
            sensors = sensors || {};
            var entries = Object.keys(sensors).map(function (id) {
                return { id: id, name: sensors[id].name };
            });
            fillSelect(sensorSelect, entries);
            fillSelect(thermostatSensorSelect, entries);
        });

        Promise.all([devicesPromise, sensorsPromise]).then(function () {

            if (!editId) {
                updateActionFields();
                updateConditionFields();
                return;
            }

            el("rule-form-title").textContent = "Edytuj regułę: " + editId;

            api("/device/schedule/rules/" + editId).then(function (r) {

                if (r.error) {
                    setStatus("Błąd: " + r.error, true);
                    return;
                }

                deviceSelect.value = r.device || "";
                actionSelect.value = r.action || "ON";
                el("rule-value").value = r.value != null ? r.value : "";
                el("rule-time-from").value = r.time_from || "";
                el("rule-time-to").value = r.time_to || "";
                conditionSelect.value = r.condition || "ALWAYS";
                sensorSelect.value = r.sensor_id || "";
                thermostatSensorSelect.value = r.sensor_id || "";
                el("rule-metric").value = r.metric || "";
                el("rule-operator").value = r.operator || "MIN";
                el("rule-threshold").value = r.threshold || "";
                el("rule-min-temp").value = r.min_temp != null ? r.min_temp : "";
                el("rule-max-temp").value = r.max_temp != null ? r.max_temp : "";
                setSelectedModes(r.modes);

                updateActionFields();
                updateConditionFields();
            });
        });
    }

    loadOptionsAndData();

    el("rule-form").addEventListener("submit", function (e) {
        e.preventDefault();

        var data = {
            device: deviceSelect.value,
            action: actionSelect.value,
            time_from: el("rule-time-from").value,
            time_to: el("rule-time-to").value || undefined,
            condition: conditionSelect.value,
        };

        if (actionSelect.value === "SET_TEMP") {
            data.value = parseFloat(el("rule-value").value);
        }

        if (conditionSelect.value === "SENSOR") {
            data.sensor_id = sensorSelect.value;
            data.metric = el("rule-metric").value;
        }

        if (conditionSelect.value === "MODE") {
            data.modes = getSelectedModes();
        }

        if (conditionSelect.value === "THERMOSTAT") {
            data.sensor_id = thermostatSensorSelect.value;
            if (el("rule-min-temp").value !== "") { data.min_temp = parseFloat(el("rule-min-temp").value); }
            if (el("rule-max-temp").value !== "") { data.max_temp = parseFloat(el("rule-max-temp").value); }
        }

        if (["SENSOR", "RCE", "SOC"].indexOf(conditionSelect.value) !== -1) {
            data.operator = el("rule-operator").value;
            data.threshold = el("rule-threshold").value;
        }

        setStatus("Zapisywanie...", false);

        var req = editId
            ? api("/device/schedule/rules/" + editId, "PUT", data)
            : api("/device/schedule/rules", "POST", data);

        req.then(function (res) {

            if (res.error) {
                setStatus("Błąd: " + res.error, true);
                return;
            }

            window.location.href = "/config/devices/rules";
        });
    });
})();
