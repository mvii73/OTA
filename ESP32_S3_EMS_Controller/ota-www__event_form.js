(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
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
        var elm = el("event-form-status");
        elm.textContent = text;
        elm.className = "settings-message " + (isError ? "error" : "success");
    }

    var editId = new URLSearchParams(window.location.search).get("id");

    var typeSelect = el("event-type");
    var sensorSelect = el("event-sensor");
    var deviceSelect = el("event-device");

    // Z /device/schedule/events/options - czujniki pogrupowane wg typu
    // zdarzenia (patrz ems/events.py::sensor_matches_type())
    var sensorsByType = {};

    function fillSelect(select, entries, emptyLabel) {

        if (!entries.length) {
            select.innerHTML = "<option value=\"\">" + escapeHtml(emptyLabel) + "</option>";
            return;
        }

        select.innerHTML = entries.map(function (entry) {
            return "<option value=\"" + escapeHtml(entry.id) + "\">" + escapeHtml(entry.name || entry.id) + "</option>";
        }).join("");
    }

    function updateSensors() {
        var power = typeSelect.value === "POWER";
        el("event-power-fields").hidden = !power;
        el("event-sensor-row").hidden = power;
        if (!power) {
            fillSelect(sensorSelect, sensorsByType[typeSelect.value] || [], "(brak pasujących czujników)");
        }
    }

    typeSelect.addEventListener("change", updateSensors);

    function intOrNull(id) {
        var value = el(id).value.trim();
        return value === "" ? null : parseInt(value, 10);
    }

    api("/device/schedule/events/options").then(function (opts) {

        sensorsByType = opts.sensors || {};
        fillSelect(deviceSelect, opts.devices || [], "(brak urządzeń z obsługą wł./wył.)");
        fillSelect(el("event-power-device"), opts.power_devices || [], "(brak urządzeń z pomiarem mocy)");
        updateSensors();

        if (!editId) { return; }

        el("event-form-title").textContent = "Edytuj zdarzenie: " + editId;

        api("/device/schedule/events/" + encodeURIComponent(editId)).then(function (ev) {

            if (ev.error) {
                setStatus("Błąd: " + ev.error, true);
                return;
            }

            el("event-name").value = ev.name || "";
            el("event-enabled").checked = ev.enabled !== false;
            typeSelect.value = ev.type || "PRESENCE";
            updateSensors();
            sensorSelect.value = ev.sensor_id || "";
            el("event-action").value = ev.action || "ON";
            deviceSelect.value = ev.device || "";
            el("event-start-delay").value = ev.start_delay_s != null ? ev.start_delay_s : 0;
            el("event-stop-delay").value = ev.stop_delay_s != null ? ev.stop_delay_s : "";
            el("event-max-activations").value = ev.max_activations != null ? ev.max_activations : 0;
            el("event-period").value = ev.period_min != null ? ev.period_min : 0;
            if (ev.type === "POWER") {
                el("event-power-device").value = ev.power_device_id || "";
                el("event-power-window").value = ev.power_window_min != null ? ev.power_window_min : 5;
                el("event-power-operator").value = ev.power_operator || "MAX";
                el("event-power-w").value = ev.power_w != null ? ev.power_w : 5;
            }
        });
    });

    el("event-form").addEventListener("submit", function (e) {
        e.preventDefault();

        var data = {
            name: el("event-name").value,
            enabled: el("event-enabled").checked,
            type: typeSelect.value,
            sensor_id: sensorSelect.value,
            action: el("event-action").value,
            device: deviceSelect.value,
            start_delay_s: intOrNull("event-start-delay") || 0,
            stop_delay_s: intOrNull("event-stop-delay"),
            max_activations: intOrNull("event-max-activations") || 0,
            period_min: intOrNull("event-period") || 0
        };

        if (data.type === "POWER") {
            delete data.sensor_id;
            data.power_device_id = el("event-power-device").value;
            data.power_window_min = intOrNull("event-power-window");
            data.power_operator = el("event-power-operator").value;
            data.power_w = parseFloat(el("event-power-w").value);
        }

        setStatus("Zapisywanie...", false);

        var req = editId
            ? api("/device/schedule/events/" + encodeURIComponent(editId), "PUT", data)
            : api("/device/schedule/events", "POST", data);

        req.then(function (res) {

            if (res.error) {
                setStatus("Błąd: " + res.error, true);
                return;
            }

            window.location.href = "/config/devices/events";
        }).catch(function () {
            setStatus("Błąd zapisu.", true);
        });
    });
})();
