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

    var listEl = el("rooms-list");

    function nameOf(collection, id) {
        return (collection[id] && collection[id].name) || (id + " (brak)");
    }

    // udzial kubatury jak w obliczeniach zapotrzebowania (ems/heating_sim.py): tylko pomieszczenia
    // z termostatem, bez podanej kubatury - srednia z pozostalych, bez zadnej - po rowno
    function volumeShares(rooms) {
        var ids = Object.keys(rooms).filter(function (id) { return rooms[id].thermostat_device_id; });
        var known = ids.filter(function (id) { return rooms[id].volume_m3; });
        var avg = known.length ? known.reduce(function (s, id) { return s + rooms[id].volume_m3; }, 0) / known.length : 1;
        var used = {}, total = 0;

        ids.forEach(function (id) { used[id] = rooms[id].volume_m3 || avg; total += used[id]; });

        var shares = {};
        ids.forEach(function (id) { shares[id] = { pct: total > 0 ? used[id] / total * 100 : 0, m3: used[id], total: total, known: !!rooms[id].volume_m3, any: known.length > 0 }; });
        return shares;
    }

    function num(v) {
        return Number(v).toFixed(0).replace(".", ",");
    }

    // ikona wyposazenia: kolorowa, gdy jest (nazwa urzadzenia w podpowiedzi), wyszarzona, gdy brak
    function icon(name, label, id, collection) {
        var title = label + ": " + (id ? nameOf(collection, id) : "brak");
        return "<span class=\"room-icon" + (id ? "" : " room-icon-off") + "\" title=\"" + escapeHtml(title) + "\">" +
            "<span class=\"material-symbols-outlined\">" + name + "</span></span>";
    }

    // niska bateria (GET /rooms/batteries, ems/device_alerts.py): prawie pusta - do 20%, pusta - do 5%
    function batteryIcon(b) {
        if (!b) { return ""; }
        var empty = b.level === "empty";
        var title = (empty ? "Bateria do wymiany" : "Słaba bateria") + ": " + b.name + " " + num(b.pct) + "%";
        return "<span class=\"room-icon room-battery-" + (empty ? "empty" : "low") + "\" title=\"" + escapeHtml(title) + "\">" +
            "<span class=\"material-symbols-outlined\">" + (empty ? "battery_0_bar" : "battery_1_bar") + "</span></span>";
    }

    function icons(room, share, sensors, devices, battery) {
        var html = icon("thermostat", "Termostat", room.thermostat_device_id, devices) +
            icon("device_thermostat", "Czujnik temperatury", room.temp_sensor_id, sensors) +
            icon("humidity_percentage", "Czujnik wilgotności", room.humidity_sensor_id, sensors) +
            icon("sensor_occupied", "Czujnik obecności", room.presence_sensor_id, sensors);

        var title = !share ? "Bez termostatu - nie wchodzi do zapotrzebowania kotła"
            : "Udział kubatury: " + (share.known ? num(share.m3) + " m³" : share.any ? "średnia " + num(share.m3) + " m³" : "kubatura nie podana - po równo") +
              (share.any ? " z " + num(share.total) + " m³" : "");
        html += "<span class=\"room-share" + (share ? "" : " room-icon-off") + "\" title=\"" + escapeHtml(title) + "\">" +
            "<span class=\"material-symbols-outlined\">view_in_ar</span>" +
            (share ? num(share.pct) + "%" + (share.known ? "" : "*") : "–") + "</span>" + batteryIcon(battery);

        return "<div class=\"room-icons\">" + html + "</div>";
    }

    function render(rooms, sensors, devices, batteries) {

        var ids = Object.keys(rooms);

        // urzadzenie grzewcze bez termostatu i czujnika - nie bedzie sterowane
        var blind = ids.filter(function (id) {
            var r = rooms[id];
            return r.heater_device_id && !r.thermostat_device_id && !r.temp_sensor_id;
        }).map(function (id) { return rooms[id].name || id; });

        el("rooms-heater-alert-names").textContent = blind.join(", ");
        el("rooms-heater-alert").hidden = !blind.length;

        if (!ids.length) {
            listEl.innerHTML = "<div class=\"history-empty\">Brak zdefiniowanych pomieszczeń</div>";
            return;
        }

        ids.sort(function (a, b) { return (rooms[a].name || a).localeCompare(rooms[b].name || b); });
        var shares = volumeShares(rooms);

        listEl.innerHTML = ids.map(function (id) {

            var room = rooms[id];

            // nazwa | ikony (stale miejsca - kolumna rowna we wszystkich wierszach) | przyciski
            return "<div class=\"settings-row rooms-row\">" +
                "<div class=\"settings-row-text\"><label>" + escapeHtml(room.name) + "</label></div>" +
                icons(room, shares[id], sensors, devices, batteries[id]) +
                "<div class=\"settings-row-buttons\">" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-delete=\"" + id + "\" data-name=\"" + escapeHtml(room.name) + "\">Usuń</button>" +
                "<a href=\"/config/rooms/form?id=" + encodeURIComponent(id) + "\" class=\"maintenance-button maintenance-button-secondary\">Edytuj</a>" +
                "</div>" +
                "</div>";
        }).join("");
    }

    function load() {
        return Promise.all([
            api("/rooms"),
            api("/device/schedule/sensors"),
            api("/device/schedule/devices"),
            api("/rooms/batteries").catch(function () { return {}; }),
        ]).then(function (res) {
            render(res[0] || {}, res[1] || {}, res[2] || {}, res[3] || {});
        }).catch(function () {
            listEl.innerHTML = "<div class=\"history-empty\">Błąd odczytu</div>";
        });
    }

    listEl.addEventListener("click", function (e) {

        var deleteId = e.target.getAttribute("data-delete");

        if (deleteId) {

            if (!confirm("Usunąć pomieszczenie \"" + e.target.getAttribute("data-name") + "\"?")) { return; }

            api("/rooms/" + deleteId, "DELETE").then(load);
        }
    });

    load();
})();
