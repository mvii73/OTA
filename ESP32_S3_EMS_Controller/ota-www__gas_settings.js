// Taryfa gazowa (www/gas_settings.py): pola [data-cfg] - cennik domyslny i ustawienia z
// GET /report/gas/config ("config"), zapis POST /report/gas/config (storage/gas_store.py::save_config()).
// Cenniki w okresach: lista z GET /report/gas/config ("tariffs"), zapis / usuniecie
// POST /report/gas/tariffs (storage/gas_store.py::save_tariff() / delete_tariff()).
(function () {

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function fields() { return document.querySelectorAll("[data-cfg]"); }

    function gtFields() { return document.querySelectorAll("[data-gt]"); }

    function fill(cfg) {
        Array.prototype.forEach.call(fields(), function (input) {
            input.value = cfg[input.getAttribute("data-cfg")];
        });
    }

    function plDate(d) {
        return d ? d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) : "";
    }

    function periodText(t) {
        if (t.valid_from && t.valid_to) { return plDate(t.valid_from) + " – " + plDate(t.valid_to); }
        if (t.valid_from) { return "od " + plDate(t.valid_from) + " (bezterminowo)"; }
        return "do " + plDate(t.valid_to);
    }

    function nextDay(d) {
        var t = new Date(d + "T12:00:00");
        t.setDate(t.getDate() + 1);
        return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
    }

    function num(v, digits) {
        return v == null ? "" : Number(v).toFixed(digits).replace(".", ",");
    }

    var state = { config: null, tariffs: [], editId: null };

    function render(d) {
        state.config = d.config;
        state.tariffs = d.tariffs || [];

        var current = null;
        state.tariffs.forEach(function (t) { if (t.id === d.current_id) { current = t; } });
        el("gas-tariffs-today").textContent = current
            ? "Dziś obowiązuje cennik " + periodText(current) + " (" + current.tariff_group + ")."
            : "Dziś obowiązuje cennik domyślny (" + d.config.tariff_group + ").";

        el("gas-tariffs").innerHTML = state.tariffs.length ? state.tariffs.map(function (t) {
            var badge = t.id === d.current_id ? " <span class=\"state-badge state-1\">dziś</span>" : "";
            return "<tr><td>" + esc(periodText(t)) + badge + "</td><td>" + esc(t.tariff_group) + "</td>" +
                "<td class=\"align-right\">" + num(t.subscription_month, 2) + "</td>" +
                "<td class=\"align-right\">" + num(t.fuel_kwh, 5) + "</td>" +
                "<td class=\"align-right\">" + num(t.dist_fixed_month, 2) + "</td>" +
                "<td class=\"align-right\">" + num(t.dist_var_kwh, 5) + "</td>" +
                "<td class=\"align-right\">" + num(t.vat_pct, 0) + "%</td>" +
                "<td class=\"align-right\" style=\"white-space:nowrap\">" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary\" data-copy=\"" + esc(t.id) + "\">Kopiuj na nowy okres</button> " +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary\" data-edit=\"" + esc(t.id) + "\">Edytuj</button> " +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-delete=\"" + esc(t.id) + "\">Usuń</button>" +
                "</td></tr>";
        }).join("") : "<tr><td colspan=\"8\" class=\"history-empty\">Brak cenników w okresach - wszystkie dni liczone wg cennika domyślnego.</td></tr>";
    }

    function load() {
        return fetch("/report/gas/config").then(function (r) { return r.json(); }).then(function (d) {
            fill(d.config);
            render(d);
        }).catch(function () {
            el("gas-config-status").textContent = "Błąd odczytu ustawień.";
        });
    }

    function findTariff(id) {
        var found = null;
        state.tariffs.forEach(function (t) { if (t.id === id) { found = t; } });
        return found;
    }

    // formularz cennika: edycja (id) albo nowy na podstawie zrodla (kopia - okres pusty / od dnia po koncu zrodla)
    function openForm(source, editId, title) {
        state.editId = editId;
        Array.prototype.forEach.call(gtFields(), function (input) {
            input.value = source[input.getAttribute("data-gt")];
        });
        el("gt-valid_from").value = editId ? (source.valid_from || "") : (source.valid_to ? nextDay(source.valid_to) : "");
        el("gt-valid_to").value = editId ? (source.valid_to || "") : "";
        el("gas-tariff-form-title").textContent = title;
        el("gas-tariff-status").textContent = "";
        el("gas-tariff-form").hidden = false;
        el("gt-valid_from").focus();
    }

    el("gas-tariff-copy-default").addEventListener("click", function () {
        if (state.config) {
            openForm(state.config, null, "Nowy cennik na podstawie cennika domyślnego - podaj okres i nowe ceny");
        }
    });

    el("gas-tariffs").addEventListener("click", function (e) {
        var id = e.target.getAttribute("data-copy");
        if (id) {
            openForm(findTariff(id), null, "Nowy cennik na podstawie " + periodText(findTariff(id)) + " - podaj okres i nowe ceny");
            return;
        }
        id = e.target.getAttribute("data-edit");
        if (id) {
            openForm(findTariff(id), id, "Edycja cennika " + periodText(findTariff(id)));
            return;
        }
        id = e.target.getAttribute("data-delete");
        if (id && confirm("Usunąć cennik " + periodText(findTariff(id)) + "?")) {
            fetch("/report/gas/tariffs", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "delete": id })
            }).then(function (r) { return r.json(); }).then(load);
        }
    });

    el("gas-tariff-cancel").addEventListener("click", function () {
        el("gas-tariff-form").hidden = true;
    });

    el("gas-tariff-save").addEventListener("click", function () {
        var data = { valid_from: el("gt-valid_from").value || null, valid_to: el("gt-valid_to").value || null };
        if (state.editId) { data.id = state.editId; }
        Array.prototype.forEach.call(gtFields(), function (input) {
            data[input.getAttribute("data-gt")] = input.getAttribute("data-text") ? input.value : Number(input.value);
        });
        if (!data.valid_from) {
            el("gas-tariff-status").textContent = "Podaj początek okresu.";
            return;
        }
        el("gas-tariff-status").textContent = "Zapisywanie…";
        fetch("/report/gas/tariffs", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
        }).then(function (r) { return r.json(); }).then(function (res) {
            if (res.error) {
                el("gas-tariff-status").textContent = "Błąd: " + res.error;
                return;
            }
            el("gas-tariff-form").hidden = true;
            load();
        }).catch(function () { el("gas-tariff-status").textContent = "Błąd zapisu."; });
    });

    el("gas-config-save").addEventListener("click", function () {
        var data = {};
        Array.prototype.forEach.call(fields(), function (input) {
            data[input.getAttribute("data-cfg")] = input.getAttribute("data-text") ? input.value : Number(input.value);
        });
        el("gas-config-status").textContent = "Zapisywanie…";
        fetch("/report/gas/config", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
        }).then(function (r) { return r.json(); }).then(function (res) {
            el("gas-config-status").textContent = res.error ? "Błąd: " + res.error : "Zapisano.";
            if (!res.error) { load(); }
        }).catch(function () { el("gas-config-status").textContent = "Błąd zapisu."; });
    });

    load();
})();
