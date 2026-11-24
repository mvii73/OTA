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

    var activeSelect = el("active-tariff-select");
    var activeSaveButton = el("active-tariff-save");
    var activeStatusEl = el("active-tariff-status");
    var listEl = el("tariffs-list");

    var _activeId = null;

    function tariffSummary(t) {

        var zoneCount = (t.zones || []).length;
        var fixedCount = (t.fixed_monthly_costs || []).length;

        return zoneCount + " " + (zoneCount === 1 ? "strefa" : "strefy/stref") +
            " · " + fixedCount + " " + (fixedCount === 1 ? "opłata stała" : "opłat stałych");
    }

    function fmtPln(value, unit) {
        return Number(value).toFixed(4) + " " + unit;
    }

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    function formatHourRange(r) {
        if (r.from_hour === r.to_hour) { return "cała doba"; }
        return pad2(r.from_hour) + ":00 - " + pad2(r.to_hour) + ":00";
    }

    function zoneOtherCostsTotal(zone) {
        return (zone.other_costs || []).reduce(function (sum, c) { return sum + Number(c.value_pln_per_kwh); }, 0);
    }

    function renderZonesTable(zones) {

        if (!zones.length) {
            return "<div class=\"history-empty\">Brak zdefiniowanych stref</div>";
        }

        var rows = zones.map(function (zone) {

            var hours = (zone.hour_ranges || []).map(formatHourRange).join(", ");
            var otherTotal = zoneOtherCostsTotal(zone);
            var total = Number(zone.energy_price_pln_per_kwh) + otherTotal;

            return "<tr>" +
                "<td>" + escapeHtml(zone.name || "") + "<div class=\"settings-hint\">" + escapeHtml(hours) + "</div></td>" +
                "<td class=\"measurement-energy\">" + fmtPln(zone.energy_price_pln_per_kwh, "PLN/kWh") + "</td>" +
                "<td class=\"measurement-energy\">" + fmtPln(otherTotal, "PLN/kWh") + "</td>" +
                "<td class=\"measurement-energy\"><strong>" + fmtPln(total, "PLN/kWh") + "</strong></td>" +
                "</tr>";
        }).join("");

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Strefa</th><th class=\"align-right\">Energia</th><th class=\"align-right\">Opłaty zmienne</th><th class=\"align-right\">Razem</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
            "</table></div>";
    }

    function renderFixedCosts(costs) {

        if (!costs.length) {
            return "";
        }

        var rows = costs.map(function (c) {
            return "<tr><td>" + escapeHtml(c.name || "") + "</td>" +
                "<td class=\"measurement-energy\">" + Number(c.value_pln).toFixed(2) + " PLN/mies.</td></tr>";
        }).join("");

        return "<div class=\"settings-panel-title\">Opłaty stałe (miesięczne)</div>" +
            "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<tbody>" + rows + "</tbody>" +
            "</table></div>";
    }

    function renderTariffDetail(t) {
        return renderZonesTable(t.zones || []) + renderFixedCosts(t.fixed_monthly_costs || []);
    }

    function plDate(d) {
        return d ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : "";
    }

    function periodText(t) {
        if (!t.valid_from && !t.valid_to) { return ""; }
        if (t.valid_from && t.valid_to) { return plDate(t.valid_from) + " – " + plDate(t.valid_to); }
        if (t.valid_from) { return "od " + plDate(t.valid_from) + " (bezterminowo)"; }
        return "do " + plDate(t.valid_to);
    }

    // kolejnosc: taryfy z okresem chronologicznie, potem domyslna, potem pozostale (porownawcze)
    function sortedIds(tariffs) {
        function rank(id) {
            var t = tariffs[id];
            if (t.valid_from || t.valid_to) { return "0" + (t.valid_from || "0000"); }
            return id === _activeId ? "1" : "2" + (t.name || id);
        }
        return Object.keys(tariffs).sort(function (a, b) { return rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0; });
    }

    function render(data) {

        _activeId = data.active_id;

        var tariffs = data.tariffs || {};
        var ids = sortedIds(tariffs);
        var current = data.current_id && tariffs[data.current_id];

        el("tariffs-today").textContent = current
            ? "Dziś (" + plDate(data.today) + ") obowiązuje: " + (current.name || data.current_id) +
              (current.valid_from || current.valid_to ? ", " + periodText(current) : " (taryfa domyślna)") + "."
            : "";

        activeSelect.innerHTML = ids.map(function (id) {
            var selected = id === _activeId ? " selected" : "";
            var period = periodText(tariffs[id]);
            return "<option value=\"" + id + "\"" + selected + ">" + escapeHtml((tariffs[id].name || id) + (period ? " · " + period : "")) + "</option>";
        }).join("");

        if (!ids.length) {
            listEl.innerHTML = "<div class=\"history-empty\">Brak zdefiniowanych taryf</div>";
            return;
        }

        listEl.innerHTML = ids.map(function (id) {

            var t = tariffs[id];
            var name = t.name || id;
            var period = periodText(t);
            var badge = (id === data.current_id ? " <span class=\"state-badge state-1\">obowiązuje dziś</span>" : "") +
                (id === _activeId ? " <span class=\"state-badge\">domyślna</span>" : "") +
                (!period && id !== _activeId ? " <span class=\"state-badge\">tylko porównania</span>" : "");

            return "<div class=\"settings-row settings-row-collapsible\" data-tariff-toggle=\"" + id + "\" style=\"cursor:pointer\">" +
                "<div class=\"settings-row-text\"><label>" + escapeHtml(name) + badge + "</label>" +
                "<div class=\"settings-hint\">" + (period ? "<strong>" + escapeHtml(period) + "</strong> · " : "") + escapeHtml(tariffSummary(t)) + "</div></div>" +
                "<div class=\"settings-row-buttons\">" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-delete=\"" + id + "\" data-name=\"" + escapeHtml(name) + "\">Usuń</button>" +
                "<a href=\"/config/tariffs/form?copy=" + encodeURIComponent(id) + "\" class=\"maintenance-button maintenance-button-secondary\">Kopiuj na nowy okres</a>" +
                "<a href=\"/config/tariffs/form?id=" + encodeURIComponent(id) + "\" class=\"maintenance-button maintenance-button-secondary\">Edytuj</a>" +
                "</div>" +
                "<span class=\"settings-row-arrow\" data-tariff-arrow=\"" + id + "\">&#9662;</span>" +
                "</div>" +
                "<div hidden data-tariff-detail=\"" + id + "\">" + renderTariffDetail(t) + "</div>";
        }).join("");
    }

    function load() {
        return api("/tariffs").then(render);
    }

    activeSaveButton.addEventListener("click", function () {

        var id = activeSelect.value;

        if (!id) { return; }

        activeStatusEl.className = "settings-message";
        activeStatusEl.textContent = "Zapisywanie...";

        api("/tariffs/active", "POST", { id: id })
            .then(function (res) {
                activeStatusEl.textContent = res.saved ? "Zapisano." : ("Błąd: " + (res.error || "nieznany"));
                activeStatusEl.className = "settings-message " + (res.saved ? "success" : "error");
                if (res.saved) { load(); }
            })
            .catch(function () {
                activeStatusEl.textContent = "Błąd zapisu.";
                activeStatusEl.className = "settings-message error";
            });
    });

    listEl.addEventListener("click", function (e) {

        if (e.target.closest("a")) { return; }

        var deleteId = e.target.getAttribute("data-delete");

        if (deleteId) {

            if (!confirm("Usunąć taryfę \"" + e.target.getAttribute("data-name") + "\"?")) { return; }

            api("/tariffs/" + deleteId, "DELETE").then(load);
            return;
        }

        var toggle = e.target.closest("[data-tariff-toggle]");

        if (!toggle) { return; }

        var id = toggle.getAttribute("data-tariff-toggle");
        var detailEl = listEl.querySelector("[data-tariff-detail=\"" + id + "\"]");
        var arrowEl = listEl.querySelector("[data-tariff-arrow=\"" + id + "\"]");

        detailEl.hidden = !detailEl.hidden;
        arrowEl.innerHTML = detailEl.hidden ? "&#9662;" : "&#9652;";
        toggle.classList.toggle("expanded", !detailEl.hidden);
    });

    load();
})();
