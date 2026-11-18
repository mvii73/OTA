(function () {
    // ==================================================
    // WSPOLNY EKRAN GLOWICY - zna tylko wspolny slownik parametrow
    // termostatu (drivers/thermostat.py). Co glowica potrafi, mowi
    // "capabilities" z API: brak klucza = wyszarzone, write=false =
    // tylko odczyt. Dzieki temu ten sam ekran obsluguje kazda glowice.
    // ==================================================

    var root = document.getElementById("trv-control");
    if (!root) {
        return;
    }

    var ieee = root.getAttribute("data-ieee");
    var apiUrl = "/zigbee/devices/" + ieee + "/thermostat";
    var readingsEl = document.getElementById("trv-readings");
    var sectionsEl = document.getElementById("trv-sections");
    var titleEl = document.getElementById("trv-title");
    var statusEl = document.getElementById("trv-status");

    var ON_OFF = { "1": "włączone", "0": "wyłączone" };

    var READINGS = [
        { key: "local_temp_c", label: "Temperatura", fmt: function (v) { return v.toFixed(1) + " °C"; } },
        { key: "setpoint_c", label: "Zadana", fmt: function (v) { return v.toFixed(1) + " °C"; } },
        { key: "valve_pct", label: "Otwarcie zaworu", fmt: function (v) { return v + " %"; } },
        { key: "heating", label: "Stan grzania", fmt: function (v) { return v ? "grzeje" : "nie grzeje"; } },
        { key: "battery_pct", label: "Bateria", fmt: function (v) { return v + " %"; } },
        { key: "battery_low", label: "Stan baterii", fmt: function (v) { return v ? "niska!" : "OK"; } },
        { key: "window_open", label: "Okno", fmt: function (v) { return v ? "otwarte" : "zamknięte"; } }
    ];

    var WEEK_DAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

    // kind: number | select | bool | window | schedule | week
    var SECTIONS = [
        {
            title: "Sterowanie",
            items: [
                { key: "setpoint_c", kind: "number", label: "Temperatura zadana", unit: "°C", hint: "Docelowa temperatura w pomieszczeniu" },
                { key: "mode", kind: "select", label: "Tryb pracy", hint: "Harmonogram, ręczny, eco, komfort, boost... Nastawę z EMS głowica stosuje tylko w trybie ręcznym - gdy jest przypisana do pomieszczenia, EMS przełącza ją na ręczny (najwyżej co 5 min)." },
                { key: "force", kind: "select", label: "Wymuszenie zaworu", hint: "Na stałe otwarty/zamknięty zawór, niezależnie od temperatury" }
            ]
        },
        {
            title: "Temperatury trybów",
            items: [
                { key: "comfort_temp_c", kind: "number", label: "Temperatura komfort", unit: "°C", hint: "Używana w trybie komfort" },
                { key: "eco_temp_c", kind: "number", label: "Temperatura eco", unit: "°C", hint: "Używana w trybie eco" },
                { key: "away_temp_c", kind: "number", label: "Temperatura poza domem", unit: "°C", hint: "Używana w trybie poza domem" },
                { key: "away_days", kind: "number", label: "Dni poza domem", unit: "dni", hint: "Po tylu dniach głowica wraca do harmonogramu" },
                { key: "boost_time_s", kind: "number", label: "Czas boost", unit: "s", hint: "Jak długo zawór jest w pełni otwarty w trybie boost" }
            ]
        },
        {
            title: "Ustawienia głowicy",
            items: [
                { key: "min_temp_c", kind: "number", label: "Minimalna nastawa", unit: "°C", hint: "Najniższa temperatura do ustawienia na głowicy" },
                { key: "max_temp_c", kind: "number", label: "Maksymalna nastawa", unit: "°C", hint: "Najwyższa temperatura do ustawienia na głowicy" },
                { key: "calibration_c", kind: "number", label: "Kalibracja temperatury", unit: "°C", hint: "Korekta odczytu czujnika głowicy" },
                { key: "child_lock", kind: "bool", label: "Blokada przycisków", hint: "Blokada rodzicielska" },
                { key: "open_window", kind: "bool", label: "Wykrywanie otwartego okna", hint: "Głowica przestaje grzać po nagłym spadku temperatury" },
                { key: "temp_accuracy_c", kind: "number", label: "Dokładność regulacji", unit: "°C", hint: "O ile poniżej nastawy głowica zaczyna grzać (-1 … -0,2; mniej = częściej)" },
                { key: "frost_temp_c", kind: "number", label: "Ochrona przed zamarzaniem", unit: "°C", hint: "Poniżej tej temperatury głowica grzeje zawsze, nawet wyłączona" },
                { key: "valve_open_pct", kind: "number", label: "Otwarcie zaworu przy grzaniu", unit: "%", hint: "Do ilu procent głowica otwiera zawór, gdy grzeje (100 = całkowicie)" },
                { key: "valve_close_pct", kind: "number", label: "Otwarcie zaworu bez grzania", unit: "%", hint: "Na ilu procentach zostaje zawór, gdy głowica nie grzeje (0 = zamknięty)" },
                { key: "auto_lock", kind: "bool", label: "Automatyczna blokada", hint: "Blokada przycisków po chwili bezczynności" },
                { key: "valve_detection", kind: "bool", label: "Wykrywanie zaworu", hint: "Kontrola poprawnego montażu na zaworze" },
                { key: "window_detection", kind: "window", label: "Wykrywanie otwartego okna", hint: "Po nagłym spadku temperatury głowica zamyka zawór na zadany czas" },
                { key: "week", kind: "select", label: "Układ tygodnia", hint: "Które dni używają harmonogramu roboczego, a które wolnego" }
            ]
        },
        {
            title: "Harmonogram",
            items: [
                { key: "schedule_workdays", kind: "schedule", label: "Dni robocze", hint: "6 punktów: od podanej godziny obowiązuje podana temperatura" },
                { key: "schedule_holidays", kind: "schedule", label: "Dni wolne", hint: "6 punktów: od podanej godziny obowiązuje podana temperatura" },
                { key: "weekly_schedule", kind: "week", label: "Harmonogram tygodniowy", hint: "Dla każdego dnia 1–6 punktów GG:MM/temperatura, od 00:00, np. 00:00/17 06:00/21 08:00/17 16:00/21 22:00/17. Pusty dzień = bez zmian. Głowica stosuje go tylko w trybie auto." }
            ]
        }
    ];

    var _state = null;
    var _dirty = {};   // key -> true, gdy uzytkownik zmienil pole i nie zapisal
    // wyslana zmiana czekajaca na raport glowicy: {key, value, at}
    var _pending = null;
    var CONFIRM_TIMEOUT_MS = 60000;
    // czas klikniecia "Odswiez dane" (ms) - czekamy na jakikolwiek
    // odczyt od glowicy po tym momencie
    var _refreshAt = null;

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

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    // ---------- render ----------

    function rowClass(cap) {
        if (!cap) {
            return "settings-row trv-row-disabled";
        }
        return cap.write ? "settings-row" : "settings-row trv-row-readonly";
    }

    function disabledAttr(cap) {
        return cap && cap.write ? "" : " disabled";
    }

    function controlHtml(item, cap) {
        var id = "trv-" + item.key;
        var dis = disabledAttr(cap);
        var saveBtn = "<button type=\"button\" class=\"maintenance-button maintenance-button-primary\" data-save=\"" +
            item.key + "\"" + dis + ">Ustaw</button>";

        if (item.kind === "number") {
            var lim = cap && cap.min != null ?
                " min=\"" + cap.min + "\" max=\"" + cap.max + "\" step=\"" + cap.step + "\"" : "";
            return "<input type=\"number\" id=\"" + id + "\"" + lim + dis + "> " +
                "<span class=\"settings-hint\">" + esc(item.unit || "") + "</span> " + saveBtn;
        }

        if (item.kind === "select" || item.kind === "bool") {
            var options = item.kind === "bool" ? ON_OFF : (cap && cap.options) || {};
            var opts = Object.keys(options).map(function (k) {
                return "<option value=\"" + esc(k) + "\">" + esc(options[k]) + "</option>";
            }).join("");
            return "<select id=\"" + id + "\"" + dis + ">" + opts + "</select> " + saveBtn;
        }

        if (item.kind === "window") {
            return "<select id=\"" + id + "-on\"" + dis + "><option value=\"1\">włączone</option><option value=\"0\">wyłączone</option></select> " +
                "spadek do <input type=\"number\" id=\"" + id + "-temp\" min=\"5\" max=\"25\" step=\"1\" style=\"width:4.5em\"" + dis + "> °C, " +
                "na <input type=\"number\" id=\"" + id + "-min\" min=\"1\" max=\"30\" step=\"1\" style=\"width:4.5em\"" + dis + "> min " + saveBtn;
        }

        if (item.kind === "week") {
            var weekRows = WEEK_DAYS.map(function (day, i) {
                return "<tr><td>" + day + "</td><td><input type=\"text\" id=\"" + id + "-d" + i + "\"" +
                    " placeholder=\"00:00/17 06:00/21 22:00/17\" style=\"width:22em\"" + dis + "></td></tr>";
            }).join("");
            return "<table class=\"trv-schedule\">" + weekRows + "</table>" + saveBtn;
        }

        if (item.kind === "schedule") {
            var rows = "";
            for (var i = 0; i < 6; i++) {
                rows += "<tr id=\"" + id + "-r" + i + "\"><td>" + (i + 1) + ".</td>" +
                    "<td>od <input type=\"time\" id=\"" + id + "-t" + i + "\"" + dis + "></td>" +
                    "<td><input type=\"number\" id=\"" + id + "-c" + i + "\" min=\"5\" max=\"34\" step=\"1\"" + dis + "> °C</td></tr>";
            }
            return "<table class=\"trv-schedule\">" + rows + "</table>" + saveBtn;
        }

        return "";
    }

    function renderSections(caps) {
        sectionsEl.innerHTML = SECTIONS.map(function (section) {
            var rows = section.items.map(function (item) {
                var cap = caps[item.key];
                var wide = item.kind === "schedule" || item.kind === "week";
                return "<div class=\"" + rowClass(cap) + "\" data-key=\"" + item.key + "\"" +
                    (wide ? " style=\"flex-wrap:wrap\"" : "") + ">" +
                    "<div class=\"settings-row-text\"><label>" + esc(item.label) + "</label>" +
                    "<div class=\"settings-hint\">" + esc(item.hint) + "</div></div>" +
                    "<div class=\"settings-row-buttons\" style=\"align-items:center" + (wide ? "; flex-direction:column; align-items:flex-end" : "") + "\">" +
                    controlHtml(item, cap) + "</div></div>";
            }).join("");
            return "<section class=\"settings-panel\"><div class=\"settings-panel-title\">" +
                esc(section.title) + "</div>" + rows + "</section>";
        }).join("") + "<section class=\"settings-panel\" id=\"trv-unknown\" hidden>" +
            "<div class=\"settings-panel-title\">Inne dane z głowicy (nieopisane)</div>" +
            "<div class=\"trv-raw\" id=\"trv-unknown-list\"></div></section>";
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

    function setIfClean(key, id, value) {
        var el = document.getElementById(id);
        if (!el || _dirty[key] || document.activeElement === el) {
            return;
        }
        el.value = value;
    }

    function fillControls(state) {
        var values = state.values;

        SECTIONS.forEach(function (section) {
            section.items.forEach(function (item) {
                var v = values[item.key];
                var id = "trv-" + item.key;
                if (v === undefined || v === null) {
                    return;
                }
                if (item.kind === "number") {
                    setIfClean(item.key, id, v);
                } else if (item.kind === "select") {
                    setIfClean(item.key, id, String(v));
                } else if (item.kind === "bool") {
                    setIfClean(item.key, id, v ? "1" : "0");
                } else if (item.kind === "window") {
                    setIfClean(item.key, id + "-on", v.on ? "1" : "0");
                    setIfClean(item.key, id + "-temp", v.temp_c);
                    setIfClean(item.key, id + "-min", v.minutes);
                } else if (item.kind === "week") {
                    for (var d = 0; d < 7 && d < v.length; d++) {
                        if (v[d] !== null) {
                            setIfClean(item.key, id + "-d" + d, v[d]);
                        }
                    }
                } else if (item.kind === "schedule") {
                    for (var i = 0; i < 6 && i < v.length; i++) {
                        setIfClean(item.key, id + "-t" + i, pad2(v[i].hour) + ":" + pad2(v[i].minute));
                        setIfClean(item.key, id + "-c" + i, v[i].temp_c);
                        var row = document.getElementById(id + "-r" + i);
                        if (row) {
                            row.className = v[i].current ? "trv-current" : "";
                        }
                    }
                }
            });
        });

        var unknownPanel = document.getElementById("trv-unknown");
        if (state.unknown && state.unknown.length) {
            unknownPanel.hidden = false;
            document.getElementById("trv-unknown-list").innerHTML = state.unknown.map(function (u) {
                return "DP " + u.dp + " (typ " + u.type + "): " + esc(u.hex);
            }).join("<br>");
        } else {
            unknownPanel.hidden = true;
        }
    }

    // ---------- odczyt / zapis ----------

    // "00:00/17.0  06:00/21" -> "00:00/17 06:00/21" (jak zwraca S3)
    function normalizeDay(text) {
        return String(text || "").trim().split(/\s+/).filter(Boolean).map(function (token) {
            var parts = token.split("/");
            var t = parseFloat(String(parts[1]).replace(",", "."));
            return parts[0] + "/" + (isNaN(t) ? parts[1] : String(t));
        }).join(" ");
    }

    function sameValue(a, b) {
        if (Array.isArray(a) && Array.isArray(b) && a.length === 7 && b.length === 7) {
            // harmonogram tygodniowy - pusty dzien w wyslanym = bez zmian
            for (var i = 0; i < 7; i++) {
                if (b[i] && normalizeDay(a[i]) !== normalizeDay(b[i])) {
                    return false;
                }
            }
            return true;
        }
        if (typeof a === "number" && typeof b === "number") {
            return Math.abs(a - b) < 0.05;
        }
        if (typeof a === "boolean" || typeof b === "boolean") {
            return !!a === !!b;
        }
        return JSON.stringify(a) === JSON.stringify(b);
    }

    // po kazdym odczycie: czy glowica odezwala sie po "Odswiez dane"
    // (last_seen_s = sekundy od ostatniej telemetrii, patrz
    // drivers/uart_zigbee.py::availability())
    function checkRefresh(state) {
        if (_refreshAt === null) {
            return;
        }
        var elapsed = Math.floor((Date.now() - _refreshAt) / 1000);
        if (state.last_seen_s != null && state.last_seen_s < elapsed) {
            showStatus("Dane z głowicy odświeżone", false);
            _refreshAt = null;
            return;
        }
        if (elapsed * 1000 > CONFIRM_TIMEOUT_MS) {
            showStatus("Głowica nie odpowiedziała na prośbę o dane - może spać, spróbuj ponownie.", true);
            _refreshAt = null;
        }
    }

    // po kazdym odczycie: czy glowica zglosila wyslana wartosc
    function checkPending(values) {
        if (!_pending) {
            return;
        }
        var reported = values[_pending.key];
        if (reported !== undefined && reported !== null && sameValue(reported, _pending.value)) {
            showStatus("Głowica potwierdziła zmianę", false);
            _pending = null;
            return;
        }
        if (Date.now() - _pending.at > CONFIRM_TIMEOUT_MS) {
            showStatus("Brak potwierdzenia od głowicy" +
                (reported !== undefined && reported !== null ? " - zgłasza " + JSON.stringify(reported) : "") +
                ". Komenda mogła nie dotrzeć - spróbuj ponownie.", true);
            _pending = null;
        }
    }

    function load() {
        fetch(apiUrl)
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
                checkPending(state.values);
                checkRefresh(state);
            })
            .catch(function () {
                showStatus("Błąd odczytu stanu głowicy", true);
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
        var id = "trv-" + key;

        if (item.kind === "number") {
            var n = parseFloat(document.getElementById(id).value);
            if (isNaN(n)) {
                throw new Error("podaj liczbę");
            }
            return n;
        }
        if (item.kind === "select") {
            return parseInt(document.getElementById(id).value, 10);
        }
        if (item.kind === "bool") {
            return document.getElementById(id).value === "1";
        }
        if (item.kind === "window") {
            return {
                on: document.getElementById(id + "-on").value === "1",
                temp_c: parseInt(document.getElementById(id + "-temp").value, 10),
                minutes: parseInt(document.getElementById(id + "-min").value, 10)
            };
        }
        if (item.kind === "week") {
            return WEEK_DAYS.map(function (day, i) {
                return (document.getElementById(id + "-d" + i).value || "").trim();
            });
        }
        if (item.kind === "schedule") {
            var points = [];
            for (var i = 0; i < 6; i++) {
                var t = (document.getElementById(id + "-t" + i).value || "").split(":");
                if (t.length !== 2) {
                    throw new Error("uzupełnij godzinę w punkcie " + (i + 1));
                }
                points.push({
                    hour: parseInt(t[0], 10),
                    minute: parseInt(t[1], 10),
                    temp_c: parseInt(document.getElementById(id + "-c" + i).value, 10)
                });
            }
            return points;
        }
        return null;
    }

    function save(key) {
        var value;
        try {
            value = readValue(key);
        } catch (e) {
            showStatus(e.message, true);
            return;
        }

        showStatus("Wysyłanie…", false);

        fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ param: key, value: value })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res.error) {
                    showStatus("Błąd: " + res.error + (res.detail ? " (" + res.detail + ")" : ""), true);
                    return;
                }
                delete _dirty[key];
                // glowica potwierdza zmiane wlasnym raportem - odswiez
                // za chwile, zeby pokazac wartosc zgloszona przez nia
                _pending = { key: key, value: value, at: Date.now() };
                showStatus("Wysłano - czekam na potwierdzenie głowicy…", false);
                setTimeout(load, 3000);
            })
            .catch(function () {
                showStatus("Błąd wysyłania", true);
            });
    }

    sectionsEl.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-save]");
        if (btn && !btn.disabled) {
            save(btn.getAttribute("data-save"));
        }
    });

    sectionsEl.addEventListener("input", function (e) {
        var row = e.target.closest("[data-key]");
        if (row) {
            _dirty[row.getAttribute("data-key")] = true;
        }
    });

    document.getElementById("trv-refresh").addEventListener("click", function () {
        fetch("/zigbee/devices/" + ieee + "/thermostatRefresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res.error) {
                    showStatus("Błąd: " + res.error, true);
                    return;
                }
                _refreshAt = Date.now();
                showStatus("Poproszono głowicę o wszystkie dane…", false);
                setTimeout(load, 4000);
            });
    });

    load();
    setInterval(load, 10000);

    // przy wejsciu na ekran poproś glowice o komplet danych (surowe DP
    // sa po stronie S3 tylko w RAM - po jego restarcie ich nie ma)
    fetch("/zigbee/devices/" + ieee + "/thermostatRefresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
    }).then(function () { setTimeout(load, 4000); });
})();
