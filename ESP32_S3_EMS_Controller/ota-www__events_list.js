(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function api(url, method) {
        return fetch(url, { method: method || "GET" }).then(function (r) { return r.json(); });
    }

    var TYPE_LABELS = { PRESENCE: "Obecność", TEMPERATURE: "Temperatura", POWER: "Pobór mocy" };
    var ACTION_LABELS = { ON: "włącz", OFF: "wyłącz" };

    function nameOf(collection, id) {
        return (collection[id] && collection[id].name) || id;
    }

    function stateText(st) {

        if (!st) { return ""; }

        // zdarzenie "Pobor mocy" - ostatni odczyt mocy
        var power = st.power_w != null ? "moc " + String(Math.round(st.power_w * 10) / 10).replace(".", ",") + " W" : "";

        if (st.pending) {
            return (power ? power + " · " : "") + "oczekuje: " + st.pending.toUpperCase() + " za " + st.pending_in_s + " s";
        }

        var state = st.active ? "aktywne (po START)" : "";

        return power && state ? power + " · " + state : (power || state);
    }

    function renderEvents(events, sensors, devices, status) {

        var list = el("events-list");
        var ids = Object.keys(events);

        if (!ids.length) {
            list.innerHTML = "<div class=\"history-empty\">Brak zdarzeń</div>";
            return;
        }

        list.innerHTML = ids.map(function (id) {
            var ev = events[id];
            var limit = ev.max_activations > 0
                ? ev.max_activations + "× / " + ev.period_min + " min"
                : "bez limitu";
            var stop = ev.stop_delay_s == null ? "STOP: brak reakcji" : "STOP +" + ev.stop_delay_s + " s";
            var source = ev.type === "POWER"
                ? nameOf(devices, ev.power_device_id) + " " + (ev.power_operator === "MIN" ? "min" : "max") + " " +
                  String(ev.power_w).replace(".", ",") + " W przez " + ev.power_window_min + " min"
                : nameOf(sensors, ev.sensor_id);
            var detail = (TYPE_LABELS[ev.type] || ev.type) + " · " + source +
                " → " + (ACTION_LABELS[ev.action] || ev.action) + " " + nameOf(devices, ev.device) +
                " · START +" + ev.start_delay_s + " s · " + stop + " · " + limit;
            var state = stateText(status[id]);

            return "<div class=\"settings-row\">" +
                "<div class=\"settings-row-text\"><label>" + escapeHtml(ev.name || id) +
                (ev.enabled === false ? " (wyłączone)" : "") + "</label>" +
                "<div class=\"settings-hint\">" + escapeHtml(detail) + "</div>" +
                (state ? "<div class=\"settings-hint\">" + escapeHtml(state) + "</div>" : "") +
                "</div>" +
                "<div class=\"settings-row-buttons\">" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-delete-event=\"" + escapeHtml(id) + "\">Usuń</button>" +
                "<a href=\"/config/devices/event?id=" + encodeURIComponent(id) + "\" class=\"maintenance-button maintenance-button-secondary\">Edytuj</a>" +
                "</div></div>";
        }).join("");
    }

    function loadEvents() {
        return Promise.all([
            api("/device/schedule/events"),
            api("/device/schedule/sensors"),
            api("/device/schedule/devices"),
            api("/device/schedule/events/status")
        ]).then(function (res) {
            renderEvents(res[0] || {}, res[1] || {}, res[2] || {}, res[3] || {});
        });
    }

    el("events-list").addEventListener("click", function (e) {

        var deleteId = e.target.getAttribute("data-delete-event");

        if (deleteId && confirm("Usunąć zdarzenie \"" + deleteId + "\"?")) {
            api("/device/schedule/events/" + encodeURIComponent(deleteId), "DELETE").then(loadEvents);
        }
    });

    loadEvents();
})();
