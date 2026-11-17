(function () {
    // ==================================================
    // WSPOLNY EKRAN PRZEKAZNIKA - zna tylko wspolny slownik parametrow
    // (drivers/relay.py). Brak klucza w "capabilities" = wyszarzone.
    // Pomiary (napiecie, prad...) nie sa raportowane same - ekran
    // odpytuje przekaznik co 10 s, dopoki jest otwarty.
    // ==================================================

    var root = document.getElementById("relay-control");
    if (!root) {
        return;
    }

    var ieee = root.getAttribute("data-ieee");
    var base = "/zigbee/devices/" + ieee;
    var readingsEl = document.getElementById("relay-readings");
    var sectionsEl = document.getElementById("relay-sections");
    var titleEl = document.getElementById("relay-title");
    var statusEl = document.getElementById("relay-status");

    var ON_OFF = { "1": "włączone", "0": "wyłączone" };

    function num(unit, digits) {
        return function (v) { return v.toFixed(digits) + " " + unit; };
    }

    var READINGS = [
        { key: "state", label: "Stan", fmt: function (v) { return v ? "włączony" : "wyłączony"; } },
        { key: "power_w", label: "Moc", fmt: num("W", 1) },
        { key: "voltage_v", label: "Napięcie", fmt: num("V", 1) },
        { key: "current_a", label: "Prąd", fmt: num("A", 3) },
        { key: "frequency_hz", label: "Częstotliwość", fmt: num("Hz", 2) },
        { key: "energy_kwh", label: "Energia pobrana", fmt: num("kWh", 3) },
        { key: "energy_produced_kwh", label: "Energia oddana", fmt: num("kWh", 3) }
    ];

    // kind: onoff | action | number | select | bool
    var SECTIONS = [
        {
            title: "Sterowanie",
            items: [
                { key: "state", kind: "onoff", label: "Przekaźnik", hint: "Włącz lub wyłącz obwód" },
                { key: "identify", kind: "action", label: "Zidentyfikuj", hint: "Urządzenie miga diodą przez 10 s, żeby łatwo je znaleźć" }
            ]
        },
        {
            title: "Ustawienia",
            items: [
                { key: "power_on_behavior", kind: "select", label: "Stan po włączeniu zasilania", hint: "Co zrobić po powrocie napięcia" },
                { key: "delayed_power_on", kind: "bool", label: "Opóźnione włączenie", hint: "Po powrocie zasilania włącz z opóźnieniem" },
                { key: "delayed_power_on_time_s", kind: "number", label: "Czas opóźnienia", unit: "s", hint: "Opóźnienie włączenia po powrocie zasilania" },
                { key: "detach_relay", kind: "bool", label: "Odłączenie przekaźnika od przycisku", hint: "Przycisk tylko wysyła zdarzenie, nie przełącza obwodu" },
                { key: "external_trigger_mode", kind: "select", label: "Tryb przełącznika zewnętrznego", hint: "Dopasuj do typu podłączonego włącznika" },
                { key: "network_led", kind: "bool", label: "Dioda sieci", hint: "Wskaźnik połączenia z siecią Zigbee" },
                { key: "turbo_mode", kind: "bool", label: "Tryb turbo radia", hint: "Większa moc nadawania - lepszy zasięg" }
            ]
        }
    ];

    var _state = null;
    var _dirty = {};
    // wyslana zmiana czekajaca na raport urzadzenia: {key, value, at}
    var _pending = null;
    var CONFIRM_TIMEOUT_MS = 15000;

    function showStatus(text, isError) {
        statusEl.textContent = text;
        statusEl.className = "settings-message " + (isError ? "error" : "success");
    }

    function esc(text) {
        return String(text).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c];
        });
    }

    function agoText(seconds) {
        if (seconds < 60) {
            return seconds + " s temu";
        }
        if (seconds < 3600) {
            return Math.floor(seconds / 60) + " min temu";
        }
        return Math.floor(seconds / 3600) + " h temu";
    }

    function post(url, body) {
        return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        }).then(function (r) { return r.json(); });
    }

    // ---------- render ----------

    function rowClass(cap) {
        if (!cap) {
            return "settings-row trv-row-disabled";
        }
        return cap.write ? "settings-row" : "settings-row trv-row-readonly";
    }

    function controlHtml(item, cap) {
        var id = "relay-" + item.key;
        var dis = cap && cap.write ? "" : " disabled";
        var btn = function (label, attrs, primary) {
            return "<button type=\"button\" class=\"maintenance-button" + (primary ? " maintenance-button-primary" : "") +
                "\" " + attrs + dis + ">" + label + "</button>";
        };

        if (item.kind === "onoff") {
            return btn("Włącz", "data-set=\"state\" data-value=\"1\"", true) + " " +
                btn("Wyłącz", "data-set=\"state\" data-value=\"0\"", false);
        }
        if (item.kind === "action") {
            return btn("Zidentyfikuj", "data-action=\"" + item.key + "\"", false);
        }
        if (item.kind === "number") {
            var lim = cap && cap.min != null ?
                " min=\"" + cap.min + "\" max=\"" + cap.max + "\" step=\"" + cap.step + "\"" : "";
            return "<input type=\"number\" id=\"" + id + "\"" + lim + dis + "> " +
                "<span class=\"settings-hint\">" + esc(item.unit || "") + "</span> " +
                btn("Ustaw", "data-save=\"" + item.key + "\"", true);
        }
        if (item.kind === "select" || item.kind === "bool") {
            var options = item.kind === "bool" ? ON_OFF : (cap && cap.options) || {};
            var opts = Object.keys(options).map(function (k) {
                return "<option value=\"" + esc(k) + "\">" + esc(options[k]) + "</option>";
            }).join("");
            return "<select id=\"" + id + "\"" + dis + ">" + opts + "</select> " +
                btn("Ustaw", "data-save=\"" + item.key + "\"", true);
        }
        return "";
    }

    function renderSections(caps) {
        sectionsEl.innerHTML = SECTIONS.map(function (section) {
            var rows = section.items.map(function (item) {
                var cap = caps[item.key];
                return "<div class=\"" + rowClass(cap) + "\" data-key=\"" + item.key + "\">" +
                    "<div class=\"settings-row-text\"><label>" + esc(item.label) + "</label>" +
                    "<div class=\"settings-hint\">" + esc(item.hint) + "</div></div>" +
                    "<div class=\"settings-row-buttons\" style=\"align-items:center\">" +
                    controlHtml(item, cap) + "</div></div>";
            }).join("");
            return "<section class=\"settings-panel\"><div class=\"settings-panel-title\">" +
                esc(section.title) + "</div>" + rows + "</section>";
        }).join("");
    }

    function renderReadings(state) {
        var values = state.values;
        var caps = state.capabilities;

        var html = READINGS.map(function (r) {
            var has = r.key in values && values[r.key] !== null;
            var cls = "trv-reading" + (caps[r.key] ? "" : " trv-row-disabled");
            return "<div class=\"" + cls + "\"><div class=\"trv-reading-label\">" + esc(r.label) + "</div>" +
                "<div class=\"trv-value\">" + (has ? esc(r.fmt(values[r.key])) : "—") + "</div></div>";
        }).join("");

        var avail;
        if (!state.known_to_c6) {
            avail = "offline – C6 nie zna urządzenia";
        } else {
            avail = state.online ? "online" : "offline – brak odpowiedzi";
            if (state.last_seen_s != null) {
                avail += ", ostatni odczyt " + agoText(state.last_seen_s);
            }
        }
        html += "<div class=\"trv-reading\"><div class=\"trv-reading-label\">Połączenie</div>" +
            "<div class=\"trv-value\">" + esc(avail) + "</div></div>";

        readingsEl.innerHTML = html;
    }

    function fillControls(state) {
        SECTIONS.forEach(function (section) {
            section.items.forEach(function (item) {
                var v = state.values[item.key];
                var el = document.getElementById("relay-" + item.key);
                if (v === undefined || v === null || !el || _dirty[item.key] || document.activeElement === el) {
                    return;
                }
                if (item.kind === "number" || item.kind === "select") {
                    el.value = String(v);
                } else if (item.kind === "bool") {
                    el.value = v ? "1" : "0";
                }
            });
        });
    }

    // ---------- odczyt / zapis ----------

    function load() {
        fetch(base + "/relay")
            .then(function (r) { return r.json(); })
            .then(function (state) {
                if (state.error) {
                    readingsEl.textContent = "Błąd: " + state.error;
                    return;
                }
                var first = _state === null;
                _state = state;
                titleEl.textContent = (state.name ? state.name + " · " : "") + state.model + " · " + state.ieee;
                if (first) {
                    renderSections(state.capabilities);
                }
                renderReadings(state);
                fillControls(state);
                checkPending(state);
            })
            .catch(function () {
                showStatus("Błąd odczytu stanu przekaźnika", true);
            });
    }

    // potwierdzenie wyslanej zmiany: wartosc z raportu urzadzenia rowna wyslanej, albo
    // komunikat o braku potwierdzenia po CONFIRM_TIMEOUT_MS
    function checkPending(state) {
        if (!_pending) {
            return;
        }
        var v = state.values[_pending.key];
        // tylko raport odebrany PO wyslaniu - zapisana wczesniej wartosc moze byc przypadkiem rowna
        var reported = state.last_seen_s != null && state.last_seen_s * 1000 <= Date.now() - _pending.at;
        if (reported && v !== undefined && v !== null && (typeof _pending.value === "boolean" ? !!v === _pending.value : v === _pending.value)) {
            _pending = null;
            showStatus("Urządzenie potwierdziło zmianę", false);
        } else if (Date.now() - _pending.at > CONFIRM_TIMEOUT_MS) {
            _pending = null;
            showStatus("Brak potwierdzenia od urządzenia - zmiana mogła nie dotrzeć", true);
        }
    }

    // odczyt z urzadzenia (C6 czyta atrybuty ZCL), potem stan z S3
    function refresh() {
        return post(base + "/relayRefresh").then(function () {
            setTimeout(load, 2000);
        });
    }

    function send(param, value) {
        showStatus("Wysyłanie…", false);
        post(base + "/relay", { param: param, value: value })
            .then(function (res) {
                if (res.error) {
                    showStatus("Błąd: " + res.error + (res.detail ? " (" + res.detail + ")" : ""), true);
                    return;
                }
                delete _dirty[param];
                _pending = { key: param, value: value, at: Date.now() };
                showStatus("Wysłano - czekam na potwierdzenie urządzenia…", false);
                setTimeout(load, 2500);
                setTimeout(refresh, 6000);
                setTimeout(load, CONFIRM_TIMEOUT_MS + 1000);
            })
            .catch(function () {
                showStatus("Błąd wysyłania", true);
            });
    }

    function readValue(key) {
        var item = null;
        SECTIONS.forEach(function (s) {
            s.items.forEach(function (it) {
                if (it.key === key) {
                    item = it;
                }
            });
        });
        var el = document.getElementById("relay-" + key);
        if (item.kind === "number") {
            var n = parseFloat(el.value);
            if (isNaN(n)) {
                throw new Error("podaj liczbę");
            }
            return n;
        }
        if (item.kind === "select") {
            return parseInt(el.value, 10);
        }
        return el.value === "1";
    }

    sectionsEl.addEventListener("click", function (e) {
        var btn = e.target.closest("button");
        if (!btn || btn.disabled) {
            return;
        }
        if (btn.hasAttribute("data-set")) {
            send(btn.getAttribute("data-set"), btn.getAttribute("data-value") === "1");
        } else if (btn.hasAttribute("data-save")) {
            var key = btn.getAttribute("data-save");
            try {
                send(key, readValue(key));
            } catch (err) {
                showStatus(err.message, true);
            }
        } else if (btn.getAttribute("data-action") === "identify") {
            post(base + "/identify", { seconds: 10 }).then(function (res) {
                showStatus(res.error ? "Błąd: " + res.error : "Urządzenie powinno migać przez 10 s", !!res.error);
            });
        }
    });

    sectionsEl.addEventListener("input", function (e) {
        var row = e.target.closest("[data-key]");
        if (row) {
            _dirty[row.getAttribute("data-key")] = true;
        }
    });

    document.getElementById("relay-refresh").addEventListener("click", function () {
        showStatus("Odczyt z urządzenia…", false);
        var asked = Date.now();
        refresh().then(function () {
            // load() po 2 s - wtedy wiadomo, czy urzadzenie odpowiedzialo (swiezy "ostatni odczyt")
            setTimeout(function () {
                if (!_state || _pending) {
                    return;
                }
                var fresh = _state.last_seen_s != null && _state.last_seen_s * 1000 <= Date.now() - asked + 1000;
                showStatus(fresh ? "Odczytano stan z urządzenia" : "Urządzenie nie odpowiedziało na odczyt", !fresh);
            }, 3000);
        });
    });

    load();
    refresh();
    setInterval(refresh, 10000);
})();
