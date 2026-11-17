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
        var elm = el("tariff-form-status");
        elm.textContent = text;
        elm.className = "settings-message " + (isError ? "error" : "success");
    }

    function escapeAttr(s) {
        return String(s == null ? "" : s).replace(/"/g, "&quot;");
    }

    var editId = getQueryParam("id");
    var nameInput = el("tariff-name");
    var zonesList = el("zones-list");
    var fixedCostsList = el("fixed-costs-list");

    // =====================================================
    // ZAKRESY GODZINOWE (wewnatrz strefy)
    // =====================================================

    function hourRangeRow(range) {

        var row = document.createElement("div");
        row.className = "edit-table-row";
        row.style.gridTemplateColumns = "90px 90px 76px";

        row.innerHTML =
            "<input type=\"number\" step=\"1\" min=\"0\" max=\"23\" class=\"range-from\" value=\"" + (range.from_hour != null ? range.from_hour : 0) + "\">" +
            "<input type=\"number\" step=\"1\" min=\"0\" max=\"23\" class=\"range-to\" value=\"" + (range.to_hour != null ? range.to_hour : 0) + "\">" +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary maintenance-button-danger\" data-remove>Usuń</button>";

        row.querySelector("[data-remove]").addEventListener("click", function () {
            row.remove();
        });

        return row;
    }

    // =====================================================
    // DODATKOWE OPLATY ZA kWh (wewnatrz strefy)
    // =====================================================

    function zoneCostRow(cost) {

        var row = document.createElement("div");
        row.className = "edit-table-row";
        row.style.gridTemplateColumns = "1fr 140px 76px";

        row.innerHTML =
            "<input type=\"text\" class=\"zone-cost-name\" placeholder=\"np. dystrybucja\" value=\"" + escapeAttr(cost.name) + "\">" +
            "<input type=\"number\" step=\"0.0001\" min=\"0\" class=\"zone-cost-value\" value=\"" + (cost.value_pln_per_kwh != null ? cost.value_pln_per_kwh : 0) + "\">" +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary maintenance-button-danger\" data-remove>Usuń</button>";

        row.querySelector("[data-remove]").addEventListener("click", function () {
            row.remove();
        });

        return row;
    }

    // =====================================================
    // STREFA (nazwa + cena energii + zakresy + dodatkowe oplaty)
    // =====================================================

    function zoneEl(zone) {

        var section = document.createElement("section");
        section.className = "settings-panel";

        section.innerHTML =
            "<div class=\"settings-row\">" +
            "<div class=\"settings-row-text\"><label>Nazwa strefy</label></div>" +
            "<input type=\"text\" class=\"zone-name\" placeholder=\"np. Niska\" value=\"" + escapeAttr(zone.name) + "\">" +
            "</div>" +
            "<div class=\"settings-row\">" +
            "<div class=\"settings-row-text\"><label>Cena energii (PLN/kWh)</label></div>" +
            "<input type=\"number\" step=\"0.0001\" min=\"0\" class=\"zone-energy-price\" value=\"" + (zone.energy_price_pln_per_kwh != null ? zone.energy_price_pln_per_kwh : 0) + "\">" +
            "</div>" +
            "<div class=\"settings-panel-title\">Zakresy godzinowe</div>" +
            "<div class=\"edit-table-wrapper\"><div class=\"edit-table\">" +
            "<div class=\"edit-table-head\" style=\"grid-template-columns: 90px 90px 76px;\">" +
            "<span>Od (godz.)</span><span>Do (godz.)</span><span></span>" +
            "</div>" +
            "<div class=\"hour-ranges-list\"></div>" +
            "</div></div>" +
            "<div class=\"settings-actions\">" +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary add-hour-range-button\">+ Dodaj zakres</button>" +
            "</div>" +
            "<div class=\"settings-panel-title\">Dodatkowe opłaty za kWh (ta strefa)</div>" +
            "<div class=\"edit-table-wrapper\"><div class=\"edit-table\">" +
            "<div class=\"edit-table-head\" style=\"grid-template-columns: 1fr 140px 76px;\">" +
            "<span>Nazwa</span><span>Wartość (PLN/kWh)</span><span></span>" +
            "</div>" +
            "<div class=\"zone-costs-list\"></div>" +
            "</div></div>" +
            "<div class=\"settings-actions\">" +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary add-zone-cost-button\">+ Dodaj opłatę</button>" +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary maintenance-button-danger remove-zone-button\">Usuń strefę</button>" +
            "</div>";

        var hourRangesList = section.querySelector(".hour-ranges-list");
        var zoneCostsList = section.querySelector(".zone-costs-list");

        (zone.hour_ranges && zone.hour_ranges.length ? zone.hour_ranges : [{ from_hour: 0, to_hour: 0 }]).forEach(function (range) {
            hourRangesList.appendChild(hourRangeRow(range));
        });

        (zone.other_costs || []).forEach(function (cost) {
            zoneCostsList.appendChild(zoneCostRow(cost));
        });

        section.querySelector(".add-hour-range-button").addEventListener("click", function () {
            hourRangesList.appendChild(hourRangeRow({ from_hour: 0, to_hour: 0 }));
        });

        section.querySelector(".add-zone-cost-button").addEventListener("click", function () {
            zoneCostsList.appendChild(zoneCostRow({ name: "", value_pln_per_kwh: 0 }));
        });

        section.querySelector(".remove-zone-button").addEventListener("click", function () {
            section.remove();
        });

        return section;
    }

    el("add-zone-button").addEventListener("click", function () {
        zonesList.appendChild(zoneEl({ name: "", energy_price_pln_per_kwh: 0, hour_ranges: [{ from_hour: 0, to_hour: 0 }], other_costs: [] }));
    });

    // =====================================================
    // OPLATY STALE (miesieczne, poziom taryfy)
    // =====================================================

    function fixedCostRow(cost) {

        var row = document.createElement("div");
        row.className = "edit-table-row";
        row.style.gridTemplateColumns = "1fr 140px 76px";

        row.innerHTML =
            "<input type=\"text\" class=\"fixed-cost-name\" placeholder=\"np. abonament\" value=\"" + escapeAttr(cost.name) + "\">" +
            "<input type=\"number\" step=\"0.01\" min=\"0\" class=\"fixed-cost-value\" value=\"" + (cost.value_pln != null ? cost.value_pln : 0) + "\">" +
            "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary maintenance-button-danger\" data-remove>Usuń</button>";

        row.querySelector("[data-remove]").addEventListener("click", function () {
            row.remove();
        });

        return row;
    }

    el("add-fixed-cost-button").addEventListener("click", function () {
        fixedCostsList.appendChild(fixedCostRow({ name: "", value_pln: 0 }));
    });

    // =====================================================
    // LOAD / SAVE
    // =====================================================

    if (editId) {

        el("tariff-form-title").textContent = "Edytuj taryfę";

        api("/tariffs/" + editId).then(function (t) {

            if (t.error) {
                setStatus("Błąd: " + t.error, true);
                return;
            }

            nameInput.value = t.name || "";

            (t.zones || []).forEach(function (zone) {
                zonesList.appendChild(zoneEl(zone));
            });

            (t.fixed_monthly_costs || []).forEach(function (cost) {
                fixedCostsList.appendChild(fixedCostRow(cost));
            });
        });

    } else {
        zonesList.appendChild(zoneEl({
            name: "Cała doba",
            energy_price_pln_per_kwh: 0.6,
            hour_ranges: [{ from_hour: 0, to_hour: 0 }],
            other_costs: [],
        }));
    }

    el("tariff-form-save").addEventListener("click", function () {

        var name = nameInput.value.trim();

        if (!name) {
            setStatus("Podaj nazwę taryfy.", true);
            return;
        }

        var zones = Array.prototype.map.call(zonesList.children, function (section) {

            var hourRanges = Array.prototype.map.call(section.querySelectorAll(".hour-ranges-list > .edit-table-row"), function (row) {
                return {
                    from_hour: parseInt(row.querySelector(".range-from").value, 10) || 0,
                    to_hour: parseInt(row.querySelector(".range-to").value, 10) || 0,
                };
            });

            var otherCosts = Array.prototype.map.call(section.querySelectorAll(".zone-costs-list > .edit-table-row"), function (row) {
                return {
                    name: row.querySelector(".zone-cost-name").value.trim(),
                    value_pln_per_kwh: parseFloat(row.querySelector(".zone-cost-value").value) || 0,
                };
            });

            return {
                name: section.querySelector(".zone-name").value.trim(),
                energy_price_pln_per_kwh: parseFloat(section.querySelector(".zone-energy-price").value) || 0,
                hour_ranges: hourRanges,
                other_costs: otherCosts,
            };
        });

        if (!zones.length) {
            setStatus("Dodaj co najmniej jedną strefę.", true);
            return;
        }

        for (var i = 0; i < zones.length; i++) {
            if (!zones[i].hour_ranges.length) {
                setStatus("Każda strefa musi mieć co najmniej jeden zakres godzinowy.", true);
                return;
            }
        }

        var fixedCosts = Array.prototype.map.call(fixedCostsList.children, function (row) {
            return {
                name: row.querySelector(".fixed-cost-name").value.trim(),
                value_pln: parseFloat(row.querySelector(".fixed-cost-value").value) || 0,
            };
        });

        var data = { name: name, zones: zones, fixed_monthly_costs: fixedCosts };

        setStatus("Zapisywanie...", false);

        var req = editId
            ? api("/tariffs/" + editId, "PUT", data)
            : api("/tariffs", "POST", data);

        req.then(function (res) {

            if (res.error) {
                setStatus("Błąd: " + res.error, true);
                return;
            }

            window.location.href = "/config/tariffs";
        });
    });
})();
