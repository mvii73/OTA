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

    function renderRules(rules, devices) {

        var list = el("rules-list");
        var ids = Object.keys(rules);

        if (!ids.length) {
            list.innerHTML = "<div class=\"history-empty\">Brak reguł</div>";
            return;
        }

        list.innerHTML = ids.map(function (id) {
            var r = rules[id];
            var deviceName = (devices[r.device] && devices[r.device].name) || r.device;
            var isThermostat = r.condition === "THERMOSTAT";
            var window_ = isThermostat && !r.time_from
                ? "cała doba"
                : (r.time_from || "?") + (r.time_to ? (" – " + r.time_to) : "");
            var conditionText = r.condition === "MODE"
                ? "Tryb pracy: " + (r.modes || []).join(", ")
                : isThermostat
                    ? "termostat: wł. ≤" + (r.min_temp != null ? r.min_temp : "–") + "°C / wył. ≥" + (r.max_temp != null ? r.max_temp : "–") + "°C"
                    : (r.condition && r.condition !== "ALWAYS" ? "gdy " + r.condition : "");
            var detail = window_ + " · " + deviceName +
                (isThermostat ? "" : (" · " + r.action)) +
                (conditionText ? (" · " + conditionText) : "");

            return "<div class=\"settings-row\">" +
                "<div class=\"settings-row-text\"><label>" + escapeHtml(id) + "</label>" +
                "<div class=\"settings-hint\">" + escapeHtml(detail) + "</div></div>" +
                "<div class=\"settings-row-buttons\">" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-delete-rule=\"" + id + "\">Usuń</button>" +
                "<a href=\"/config/devices/rule?id=" + encodeURIComponent(id) + "\" class=\"maintenance-button maintenance-button-secondary\">Edytuj</a>" +
                "</div></div>";
        }).join("");
    }

    function loadRules() {
        return Promise.all([
            api("/device/schedule/rules"),
            api("/device/schedule/devices")
        ]).then(function (res) {
            renderRules(res[0] || {}, res[1] || {});
        });
    }

    el("rules-list").addEventListener("click", function (e) {

        var deleteId = e.target.getAttribute("data-delete-rule");

        if (deleteId && confirm("Usunąć regułę \"" + deleteId + "\"?")) {
            api("/device/schedule/rules/" + deleteId, "DELETE").then(loadRules);
        }
    });

    loadRules();
})();
