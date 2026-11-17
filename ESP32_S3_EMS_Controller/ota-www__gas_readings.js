// Odczyty licznikow (www/gas_readings.py): dwie listy w tym samym ukladzie - tabela z przyciskami
// Edytuj / Usun w wierszu, pod nia przycisk dodawania; wartosci (nowy wpis i edycja) w oknie popup:
//  - stany licznika gazu (GET /report/gas - "comparison.readings", POST /report/gas/readings),
//  - salda depozytu prosumenckiego na koniec miesiaca (GET/POST /report/energy/settlement/deposit).
(function () {

    function el(id) { return document.getElementById(id); }

    function esc(s) {
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

    function num(v, digits) {
        if (v == null || isNaN(v)) { return "-"; }
        return Number(v).toFixed(digits).replace(".", ",");
    }

    function localNow() {
        var d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
    }

    function prevMonth() {
        var d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1);
    }

    function setMessage(node, text, isError) {
        node.textContent = text || "";
        node.className = "settings-message" + (text ? (isError ? " error" : " success") : "");
    }

    // lista: prefix (gas / dep), wiersze, okno popup, zapis
    function list(cfg) {

        var items = [];
        var editing = null;     // edytowany wpis (null - nowy)
        var body = el(cfg.p + "-body");
        var modal = el(cfg.p + "-modal");
        var modalStatus = el(cfg.p + "-modal-status");
        var status = el(cfg.p + "-status");

        function render() {
            body.innerHTML = items.length ? items.map(function (item, i) {
                return "<tr><td>" + esc(cfg.label(item)) + "</td>" +
                    "<td class=\"align-right\">" + cfg.value(item) + "</td>" +
                    "<td class=\"align-right\" style=\"white-space:nowrap\">" +
                    "<button type=\"button\" class=\"maintenance-button\" data-edit=\"" + i + "\">Edytuj</button> " +
                    "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-delete=\"" + i + "\">Usuń</button>" +
                    "</td></tr>";
            }).join("") : "<tr><td colspan=\"3\" class=\"history-empty\">" + cfg.empty + "</td></tr>";
        }

        function load() {
            return cfg.load().then(function (list) {
                items = list || [];
                render();
            }).catch(function () {
                body.innerHTML = "<tr><td colspan=\"3\" class=\"history-empty\">Błąd odczytu</td></tr>";
            });
        }

        function open(item) {
            editing = item;
            el(cfg.p + "-modal-title").textContent = item ? cfg.editTitle : cfg.addTitle;
            cfg.fill(item);
            setMessage(modalStatus, "");
            setMessage(status, "");
            modal.hidden = false;
            cfg.focus().focus();
        }

        function close() {
            modal.hidden = true;
            editing = null;
        }

        function save() {
            var data = cfg.read();
            if (!data) { setMessage(modalStatus, cfg.missing, true); return; }

            cfg.save(data, editing).then(function (res) {
                if (!res || res.error) {
                    setMessage(modalStatus, "Błąd: " + ((res && res.error) || "zapis"), true);
                    return;
                }
                setMessage(status, editing ? "Zapisano zmianę" : cfg.saved, false);
                close();
                load();
            }).catch(function () { setMessage(modalStatus, "Błąd zapisu", true); });
        }

        el(cfg.p + "-add").addEventListener("click", function () { open(null); });
        el(cfg.p + "-cancel").addEventListener("click", close);
        el(cfg.p + "-save").addEventListener("click", save);

        // klik poza oknem / Esc - zamkniecie, Enter - zapis
        modal.addEventListener("click", function (e) { if (e.target === modal) { close(); } });
        modal.addEventListener("keydown", function (e) {
            if (e.key === "Escape") { close(); }
            if (e.key === "Enter") { e.preventDefault(); save(); }
        });

        body.addEventListener("click", function (e) {
            var t = e.target;

            if (t.hasAttribute("data-edit")) {
                open(items[Number(t.getAttribute("data-edit"))]);
                return;
            }

            if (t.hasAttribute("data-delete")) {
                var item = items[Number(t.getAttribute("data-delete"))];
                if (!confirm(cfg.confirmDelete(item))) { return; }
                cfg.remove(item).then(function (res) {
                    if (!res || res.error) { setMessage(status, "Błąd: " + ((res && res.error) || "usuwanie"), true); return; }
                    setMessage(status, "Usunięto", false);
                    load();
                });
            }
        });

        load();
    }

    // ---------------------------------------------------------------- gaz

    list({
        p: "gas",
        empty: "Brak odczytów",
        addTitle: "Nowy odczyt licznika gazu",
        editTitle: "Edycja odczytu licznika gazu",
        missing: "Podaj datę i stan licznika.",
        saved: "Dodano odczyt",
        load: function () {
            return api("/report/gas").then(function (d) { return d.comparison.readings.slice().reverse(); });
        },
        label: function (r) { return r.at; },
        value: function (r) { return num(r.m3, 3); },
        fill: function (r) {
            el("gas-at").value = r ? r.at.replace(" ", "T") : localNow();
            el("gas-m3").value = r ? r.m3 : "";
        },
        focus: function () { return el("gas-m3"); },
        read: function () {
            var at = el("gas-at").value, m3 = el("gas-m3").value;
            return at && m3 !== "" ? { at: at.replace("T", " "), m3: Number(m3) } : null;
        },
        save: function (data, old) {
            if (old) { data.edit = old.at; }
            return api("/report/gas/readings", "POST", data);
        },
        remove: function (r) { return api("/report/gas/readings", "POST", { "delete": r.at }); },
        confirmDelete: function (r) { return "Usunąć odczyt z " + r.at + "?"; }
    });

    // ---------------------------------------------------------------- depozyt

    list({
        p: "dep",
        empty: "Brak zapisanych sald - depozyt liczony od 0 zł",
        addTitle: "Nowe saldo depozytu",
        editTitle: "Edycja salda depozytu",
        missing: "Podaj miesiąc i kwotę.",
        saved: "Zapisano - kolejne miesiące kontroler przeliczy w ciągu kilku minut",
        load: function () {
            return api("/report/energy/settlement/deposit").then(function (d) { return d.list || []; });
        },
        label: function (r) { return r.end_month; },
        value: function (r) { return num(r.value, 2); },
        fill: function (r) {
            el("dep-month").value = r ? r.end_month : prevMonth();
            el("dep-value").value = r ? r.value.toFixed(2) : "";
        },
        focus: function () { return el("dep-value"); },
        read: function () {
            var m = el("dep-month").value, v = el("dep-value").value;
            return m && v !== "" ? { end_month: m, value: v } : null;
        },
        save: function (data, old) {
            if (old) { data.replace_end = old.end_month; }
            return api("/report/energy/settlement/deposit", "POST", data);
        },
        remove: function (r) { return api("/report/energy/settlement/deposit", "POST", { delete_end: r.end_month }); },
        confirmDelete: function (r) { return "Usunąć saldo na koniec " + r.end_month + "?"; }
    });
})();
