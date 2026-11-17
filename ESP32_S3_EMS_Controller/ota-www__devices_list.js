(function () {

    // ==================================================
    // URZADZENIA I INTEGRACJE (/config/devices, www/devices_config.py):
    // parowanie Zigbee + czujniki/urzadzenia z rejestru podzielone na grupy:
    //   czujniki temperatury i wilgotnosci, czujniki obecnosci, termostaty,
    //   urzadzenia grzewcze, przelaczniki z licznikami energii, pozostale.
    // ==================================================

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

    // =====================================================
    // PAROWANIE ZIGBEE
    // =====================================================

    var statusEl = el("zigbee-action-status");
    var permitButton = el("permit-join-button");
    var permitSeconds = el("permit-join-seconds");
    var networkBannerEl = el("zigbee-network-open-banner");
    var networkTextEl = el("zigbee-network-open-text");

    function showStatus(text, isError) {
        statusEl.textContent = text;
        statusEl.className = "settings-message " + (isError ? "error" : "success");
    }

    // baner policzony do konkretnego momentu (Date.now() + sekundy), nie
    // odliczany co 1 s - odswiezenie strony/powrot z karty go nie psuje
    var networkOpenUntilMs = 0;

    function tickNetworkBanner() {

        var remaining = Math.round((networkOpenUntilMs - Date.now()) / 1000);

        if (remaining <= 0) {
            networkBannerEl.hidden = true;
            return;
        }

        networkBannerEl.hidden = false;
        networkTextEl.textContent = "Pozostało jeszcze ok. " + remaining + " s - ustaw teraz nowe urządzenie Zigbee w tryb parowania.";
    }

    function setNetworkOpenSecondsLeft(secondsLeft) {
        networkOpenUntilMs = Date.now() + secondsLeft * 1000;
        tickNetworkBanner();
    }

    // C6 potwierdza otwarcie sieci zdarzeniem (NETWORK_OPEN) chwile po
    // POST /zigbee/permitJoin - do tego czasu /zigbee/status mowi "zamknieta";
    // przez OPEN_CONFIRM_MS od kliknięcia "Paruj" taka odpowiedz nie chowa banera
    var OPEN_CONFIRM_MS = 15000;
    var openRequestedMs = 0;

    function loadZigbeeStatus() {
        api("/zigbee/status")
            .then(function (res) {
                if (!res.network_open && Date.now() - openRequestedMs < OPEN_CONFIRM_MS) { return; }
                setNetworkOpenSecondsLeft(res.network_open ? res.network_open_seconds_left : 0);
            })
            .catch(function () {});
    }

    permitButton.addEventListener("click", function () {

        var seconds = parseInt(permitSeconds.value, 10) || 180;

        permitButton.disabled = true;
        showStatus("Otwieranie sieci…", false);

        api("/zigbee/permitJoin", "POST", { seconds: seconds })
            .then(function (res) {
                if (res.error) {
                    showStatus("Błąd: " + res.error, true);
                    return;
                }
                // baner z odliczaniem od razu (od wyslanego czasu), potem
                // korekta wg potwierdzenia z C6 (interwal nizej)
                statusEl.textContent = "";
                statusEl.className = "settings-message";
                openRequestedMs = Date.now();
                setNetworkOpenSecondsLeft(seconds);
            })
            .catch(function () { showStatus("Błąd połączenia.", true); })
            .then(function () { permitButton.disabled = false; });
    });

    setInterval(tickNetworkBanner, 1000);
    loadZigbeeStatus();

    // =====================================================
    // WSPOLNE: test, link do panelu urzadzenia
    // =====================================================

    // Sonoff - skad pochodzi stan (services/sonoff_service.py)
    var SOURCE_LABELS = { "local": "lokalnie", "cloud": "chmura", "local+cloud": "lokalnie + moc z chmury" };

    function formatTestResult(res) {

        if (!res.online) {
            return "Błąd: " + (res.error || "brak odpowiedzi");
        }

        var parts = ["OK - odpowiada"];

        if (res.power != null) { parts.push("moc: " + res.power + " W"); }
        if (res.enabled != null) { parts.push("stan: " + (res.enabled ? "włączone" : "wyłączone")); }
        if (res.data && res.data.temperature_c !== undefined) { parts.push("temperatura: " + res.data.temperature_c + " °C"); }
        if (res.source) { parts.push("źródło: " + SOURCE_LABELS[res.source]); }

        return parts.join(", ");
    }

    function runTest(url, payload, resultEl) {
        resultEl.textContent = "Testowanie…";

        api(url, "POST", payload)
            .then(function (res) {
                resultEl.textContent = formatTestResult(res);
            })
            .catch(function () {
                resultEl.textContent = "Błąd testu połączenia.";
            });
    }

    // Link do wlasnego panelu WWW urzadzenia (http://<ip>/) - tylko tam,
    // gdzie taki panel jest: Shelly i czujniki WiFi (huby ESP). Tapo i
    // Sonoff lokalnie wystawiaja samo API, bez strony do obejrzenia.
    function panelLink(ip) {
        if (!ip) { return ""; }
        return "<a href=\"http://" + escapeHtml(ip) + "/\" target=\"_blank\" rel=\"noopener\" class=\"maintenance-button\">Panel</a>";
    }

    // =====================================================
    // KLASYFIKACJA
    // =====================================================

    // typy Zigbee (drivers/uart_zigbee.py::DEVICE_TYPES) i bity "caps"
    var THERMOSTAT_TYPES = [4, 5];
    var RELAY_TYPES = [1, 2, 6];
    var CAP_ONOFF = 1, CAP_TEMP = 8, CAP_HUM = 16, CAP_OCC = 64;

    var _sensors = {};
    var _devices = {};
    var _zigbee = {};        // ieee -> urzadzenie z /zigbee/devices
    var _heatingRoles = {};  // id urzadzenia z rejestru -> ["Pomieszczenie: ...", ...]
    var _models = {};        // id urzadzenia z rejestru -> model (Tapo, Shelly; z /config/devices/data)
    var _states = {};        // id z rejestru -> {online, on} (cache sterownika, nie-Zigbee)
    var _busy = {};          // id -> napis przycisku w czasie polecenia Wl./Wyl. (do potwierdzenia odczytem)

    function zigbeeOf(item) {
        return item && item.ieee ? _zigbee[item.ieee] : null;
    }

    function sensorGroup(s) {

        var kind = s.kind || "wifi";

        if (kind === "ld2410c") { return "presence"; }

        if (kind === "zigbee") {
            var dev = zigbeeOf(s);
            if (dev && dev.device_type === 7 && (dev.caps & CAP_OCC)) { return "presence"; }
        }

        return "temp";
    }

    function deviceGroup(id, d) {

        if (_heatingRoles[id]) { return "heating"; }

        var kind = d.kind || "tapo";

        if (kind === "zigbee") {

            var dev = zigbeeOf(d);

            if (dev && THERMOSTAT_TYPES.indexOf(dev.device_type) !== -1) { return "thermostat"; }
            if (dev && (RELAY_TYPES.indexOf(dev.device_type) !== -1 || (dev.device_type === 7 && (dev.caps & CAP_ONOFF)))) { return "switch"; }

            return "other";
        }

        return "switch";
    }

    // =====================================================
    // WIERSZE
    // =====================================================

    function sensorDetail(s) {

        var kind = s.kind || "wifi";

        // typ i protokol pokazuja ikony/etykiety w kolumnach - tu tylko adres
        // Zigbee: model z huba; reszta - adres
        if (kind === "zigbee") { var zbs = zigbeeOf(s); return (zbs && zbs.device_model) || s.ieee; }
        if (kind === "ld2410c") { return s.ip; }
        if (kind === "ds18b20") { return s.ip + " · ROM " + s.rom; }
        if (kind === "local_ds18b20") { return "ROM " + (s.rom || "pierwszy na magistrali"); }

        return s.ip + "/" + (s.path || "status");
    }

    // ---- urzadzenia Zigbee: stan, Steruj, Testuj (jak dawny ekran Integracje/Zigbee) ----

    function stateDot(dev) {

        var state = dev.state || {};

        // nie odpowiada (OFFLINE_AFTER_* w drivers/uart_zigbee.py) - zapamietany stan ON/OFF jest nieaktualny
        if (dev.online === false) { return { cls: "offline", text: "offline – brak odpowiedzi" }; }

        // po starcie kontrolera jeszcze sie nie odezwalo (online tylko z karencji)
        if (dev.last_seen_s == null) { return { cls: "", text: "brak danych od startu kontrolera" }; }

        if (state.ONOFF) {
            var isOn = state.ONOFF.state === 1;
            return { cls: isOn ? "online" : "", text: isOn ? "włączone" : "wyłączone" };
        }

        // urzadzenia bez ONOFF (czujniki/TRV) sa bateryjne i spia miedzy raportami
        var hasState = Object.keys(state).length > 0;

        return { cls: hasState ? "online" : "", text: hasState ? "raportuje" : "brak jeszcze danych" };
    }

    // kolorowe kolko stanu (z przodu wiersza): Zigbee wg ostatnich raportow, reszta wg cache
    // sterownika - zielone = wlaczone/dziala, szare = wylaczone/brak danych, zolte = ostatni odczyt
    // nieudany, dane starsze niz waznosc odczytu (do 10 min), czerwone = offline
    function stateDotHtml(id, zb) {

        var dot;

        if (zb) {
            dot = stateDot(zb);
        } else if (_busy[id]) {
            // polecenie w toku - ani stary, ani nowy stan, dopoki odczyt go nie potwierdzi
            dot = { cls: "", text: "czeka na potwierdzenie stanu" };
        } else {
            var st = _states[id];

            if (!st) { dot = { cls: "", text: "brak danych" }; }
            else if (!st.online) { dot = { cls: "offline", text: "offline" }; }
            else if (st.stale) {
                dot = { cls: "warning", text: "ostatni odczyt nieudany - dane sprzed " +
                    Math.round((st.last_ok_age_s || 0) / 60) + " min" };
            }
            else if (st.on === true) { dot = { cls: "online", text: "włączone" }; }
            else if (st.on === false) { dot = { cls: "", text: "wyłączone" }; }
            else { dot = { cls: "online", text: "online" }; }
        }

        return "<span class=\"brand-dot " + dot.cls + "\" title=\"" + escapeHtml(dot.text) + "\"></span>";
    }

    function controlLink(dev) {

        var page = THERMOSTAT_TYPES.indexOf(dev.device_type) !== -1 ? "thermostat"
            : ((RELAY_TYPES.indexOf(dev.device_type) !== -1 || (dev.device_type === 7 && (dev.caps & CAP_ONOFF))) ? "relay" : null);

        if (!page) { return ""; }

        return "<a class=\"maintenance-button maintenance-button-secondary\" href=\"/config/zigbee/" + page + "?ieee=" + encodeURIComponent(dev.ieee) + "\">Steruj</a>";
    }

    function fmt1(value, unit) { return value == null ? "brak danych" : value.toFixed(1) + " " + unit; }

    function agoText(seconds) {
        if (seconds < 60) { return seconds + " s temu"; }
        if (seconds < 3600) { return Math.floor(seconds / 60) + " min temu"; }
        return Math.floor(seconds / 3600) + " h temu";
    }

    function availabilityText(res) {
        if (!res.known_to_c6) { return "offline – C6 nie zna urządzenia"; }
        var text = res.online ? "online" : "offline – brak odpowiedzi";
        if (res.last_seen_s != null) { text += ", ostatni odczyt " + agoText(res.last_seen_s); }
        return text;
    }

    // wynik GET /zigbee/devices/<ieee>/test (ostatnia znana telemetria)
    function formatZigbeeTest(res) {

        var online = availabilityText(res);

        if (res.category === "relay") {
            var stateText = res.state == null ? "brak danych" : (res.state ? "włączone" : "wyłączone");
            return "Stan: " + stateText + (res.has_power === false ? "" : " · Moc: " + fmt1(res.power_w, "W")) + " (" + online + ")";
        }

        if (res.category === "sensor") {
            var parts = [];
            if (res.temperature_c != null) { parts.push("Temperatura: " + fmt1(res.temperature_c, "°C")); }
            if (res.humidity_pct != null) { parts.push("Wilgotność: " + fmt1(res.humidity_pct, "%")); }
            if (res.occupied != null) { parts.push(res.occupied ? "Ruch: wykryty" : "Ruch: brak"); }
            if (res.alarm != null) { parts.push(res.alarm ? "Alarm: aktywny" : "Alarm: brak"); }
            if (res.tamper) { parts.push("Sabotaż"); }
            if (res.battery_pct != null) { parts.push("Bateria: " + res.battery_pct + " %"); }
            if (res.battery_low) { parts.push("Bateria: niska"); }
            return (parts.length ? parts.join(" · ") : "brak jeszcze danych") + " (" + online + ")";
        }

        if (res.category === "thermometer") {
            return "Temperatura: " + fmt1(res.temperature_c, "°C") + " · Wilgotność: " + fmt1(res.humidity_pct, "%") + " (" + online + ")";
        }

        if (res.category === "trv") {
            var trv = [
                "Temp. głowicy: " + fmt1(res.current_temp_c, "°C") +
                    (res.temp_age_s != null ? " (" + agoText(res.temp_age_s) + ")" : ""),
                "Zadana: " + fmt1(res.setpoint_c, "°C")
            ];
            // czujnik zewnetrzny (SONOFF TRVZB) - stan odczytany z glowicy
            if (res.external_state !== undefined || res.external_sensor) {
                var extText = {
                    external: "zewnętrzny (pomieszczenie)",
                    offline: "zewnętrzny nieaktualny – głowica wróciła do własnego",
                    internal: "własny"
                }[res.external_state] || "brak potwierdzenia z głowicy";
                if (res.external_temp_c != null && res.external_state !== "internal") {
                    extText += ", " + fmt1(res.external_temp_c, "°C");
                }
                if (res.external_sensor && res.external_state === "internal") {
                    extText += " – głowica nie przyjęła czujnika zewnętrznego";
                }
                trv.push("Czujnik regulacji: " + extText);
            }
            if (res.valve_pct != null) { trv.push("Zawór: " + res.valve_pct + " %"); }
            if (res.mode != null) { trv.push("Tryb: " + res.mode); }
            if (res.battery_pct != null) { trv.push("Bateria: " + res.battery_pct + " %"); }
            if (res.battery_low != null) { trv.push("Stan baterii: " + (res.battery_low ? "niska" : "OK")); }
            return trv.join(" · ") + " (" + online + ")";
        }

        return "Brak obsługiwanego testu dla tego typu urządzenia.";
    }

    // przyciski Zigbee: Steruj, Testuj (GET /zigbee/devices/<ieee>/test), Usun (z sieci i z listy)
    function zigbeeButtons(dev, resultKey, name) {
        return [
            controlLink(dev),
            "<button type=\"button\" class=\"maintenance-button\" data-zb-test=\"" + dev.ieee + "\" data-zb-result=\"" + resultKey + "\">Testuj</button>",
            "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-zb-remove=\"" + dev.ieee + "\" data-name=\"" + escapeHtml(name) + "\">Usuń</button>"
        ];
    }

    // ---- uklad wiersza: [producent] [nazwa + szczegoly] [protokol] [przyciski] ----

    var LOGO_STYLE = "height:15px; width:auto; background:#fff; padding:2px 6px; border-radius:4px; vertical-align:middle";
    var CHIP_STYLE = "display:inline-block; font-size:12px; font-weight:600; background:#fff; color:#222; padding:2px 8px; border-radius:4px";
    var BRAND_LOGOS = { zigbee: "zigbee.svg", tapo: "tapo.svg", sonoff: "sonoff.svg", shelly: "shelly.svg", tuya: "tuya.svg" };

    // logo producenta (1. kolumna) jest o 50% wieksze od logo protokolu (3. kolumna)
    // logo producenta mieści się w kolumnie (max 100% szerokosci, proporcje zachowane), wysokosc do ~22 px + ramka
    var LOGO_STYLE_MAKER = "max-height:28px; max-width:100%; width:auto; height:auto; box-sizing:border-box; background:#fff; padding:3px 6px; border-radius:5px; vertical-align:middle";
    var CHIP_STYLE_MAKER = "display:inline-block; font-size:12px; font-weight:600; background:#fff; color:#222; padding:3px 8px; border-radius:5px; box-sizing:border-box; max-width:100%; overflow:hidden; white-space:nowrap";

    function logoImg(kind, maker) {
        return "<img src=\"/img/" + BRAND_LOGOS[kind] + "\" alt=\"" + kind + "\" style=\"" + (maker ? LOGO_STYLE_MAKER : LOGO_STYLE) + "\">";
    }

    function chip(text, maker) {
        return "<span style=\"" + (maker ? CHIP_STYLE_MAKER : CHIP_STYLE) + "\">" + escapeHtml(text) + "</span>";
    }

    // 1. kolumna - producent: logo (www/img/) albo nazwa na plakietce
    function makerCell(kind, dev) {

        if (kind === "zigbee") {

            var brand = String((dev && dev.device_brand) || "").trim();

            if (BRAND_LOGOS[brand.toLowerCase()]) { return logoImg(brand.toLowerCase(), true); }

            return brand && brand !== "?" ? chip(brand, true) : "";
        }

        if (kind === "ld2410c") { return chip("LD2410C", true); }
        if (kind === "ds18b20" || kind === "local_ds18b20") { return chip("DS18B20", true); }

        return BRAND_LOGOS[kind] && kind !== "zigbee" ? logoImg(kind, true) : "";
    }

    // 3. kolumna - protokol: Zigbee (logo), Matter, WiFi (urzadzenia z wlasnym API)
    var WIFI_LOGO = "<img src=\"/img/wifi.webp\" alt=\"WiFi\" title=\"WiFi - urządzenie z własnym API\" style=\"height:24px; width:auto; vertical-align:middle\">";

    function protocolCell(kind) {

        if (kind === "zigbee") { return logoImg("zigbee"); }
        if (kind === "matter") { return chip("Matter"); }
        if (kind === "local_ds18b20") { return "<span style=\"white-space:nowrap\">1-Wire</span>"; }

        // Tapo, Shelly, Sonoff, czujniki WiFi, LD2410C, DS18B20 przez hub - urzadzenia z wlasnym API po WiFi
        return WIFI_LOGO;
    }

    // Przyciski: do 4 widocznych; gdy jest wiecej, pierwszy to "⋯" z menu
    // kontekstowym (akcje, ktore sie nie mieszcza), a 3 ostatnie sa widoczne.
    function actionsHtml(actions) {

        actions = actions.filter(Boolean);

        if (actions.length <= 4) { return actions.join(""); }

        var overflow = actions.slice(0, actions.length - 3);
        var visible = actions.slice(actions.length - 3);

        return "<div class=\"dev-more\">" +
            "<button type=\"button\" class=\"maintenance-button\" data-more-toggle title=\"Więcej akcji\" aria-label=\"Więcej akcji\">&#8943;</button>" +
            "<div class=\"dev-more-menu\" hidden>" + overflow.join("") + "</div></div>" + visible.join("");
    }

    function rowHtml(kind, dev, nameHtml, detail, resultAttr, actions, dotHtml) {
        return "<div class=\"settings-row device-row\">" +
            "<div class=\"dev-state\">" + (dotHtml || "") + "</div>" +
            "<div class=\"dev-brand\">" + makerCell(kind, dev) + "</div>" +
            "<div class=\"settings-row-text\"><label>" + nameHtml + "</label>" +
            "<div class=\"settings-hint\">" + escapeHtml(detail) + "</div>" +
            "<div class=\"settings-hint\" " + resultAttr + "></div></div>" +
            "<div class=\"dev-proto\">" + protocolCell(kind) + "</div>" +
            "<div class=\"settings-row-buttons\">" + actionsHtml(actions) + "</div></div>";
    }

    function sensorRow(id, s) {

        var name = s.name || id;
        var kind = s.kind || "wifi";
        var zb = kind === "zigbee" ? zigbeeOf(s) : null;
        var edit = "<a href=\"/config/devices/sensor?id=" + encodeURIComponent(id) + "\" class=\"maintenance-button maintenance-button-secondary\">Edytuj</a>";

        if (zb) {
            return rowHtml(kind, zb, escapeHtml(name), sensorDetail(s),
                "data-test-result-sensor=\"" + id + "\"", zigbeeButtons(zb, "sensor:" + id, name).concat([edit]), stateDotHtml(id, zb));
        }

        return rowHtml(kind, null, escapeHtml(name), sensorDetail(s), "data-test-result-sensor=\"" + id + "\"", [
            panelLink(s.ip),
            "<button type=\"button\" class=\"maintenance-button\" data-test-sensor=\"" + id + "\">Testuj</button>",
            "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-delete-sensor=\"" + id + "\" data-name=\"" + escapeHtml(name) + "\">Usuń</button>",
            edit
        ], stateDotHtml(id, null));
    }

    var CONTROLLABLE_KINDS = ["tapo", "shelly", "sonoff"];

    // pod nazwa: model (Zigbee z huba, Tapo i Shelly odczytane przez sterownik), a gdy
    // go nie ma (Sonoff, jeszcze nieodczytane) - adres
    function deviceDetail(d, id) {

        var kind = d.kind || "tapo";

        if (kind === "zigbee") { var zbd = zigbeeOf(d); return (zbd && zbd.device_model) || d.ieee; }

        if (_models[id]) { return _models[id]; }

        if (kind === "sonoff") { return d.control === "cloud" ? "chmura" : d.ip; }

        return d.ip;
    }

    function deviceRow(id, d) {

        var name = d.name || id;
        var kind = d.kind || "tapo";
        var controllable = CONTROLLABLE_KINDS.indexOf(kind) !== -1;
        var roles = _heatingRoles[id] ? " · " + _heatingRoles[id].join(", ") : "";
        var zb = kind === "zigbee" ? zigbeeOf(d) : null;
        var edit = "<a href=\"/config/devices/device?id=" + encodeURIComponent(id) + "\" class=\"maintenance-button maintenance-button-secondary\">Edytuj</a>";

        if (zb) {
            return rowHtml(kind, zb, escapeHtml(name), deviceDetail(d, id) + roles,
                "data-test-result-device=\"" + id + "\"", zigbeeButtons(zb, "device:" + id, name).concat([edit]), stateDotHtml(id, zb));
        }

        // w czasie polecenia - jeden zablokowany przycisk z napisem postepu (do potwierdzenia odczytem)
        var onOff = !controllable ? [] : _busy[id] ? [
            "<button type=\"button\" disabled>" + escapeHtml(_busy[id]) + "</button>"
        ] : [
            "<button type=\"button\" data-onoff-device=\"" + id + "\" data-state=\"on\">Wł.</button>",
            "<button type=\"button\" data-onoff-device=\"" + id + "\" data-state=\"off\">Wył.</button>"
        ];

        return rowHtml(kind, null, escapeHtml(name), deviceDetail(d, id) + roles, "data-test-result-device=\"" + id + "\"", onOff.concat([
            kind === "shelly" ? panelLink(d.ip) : "",
            "<button type=\"button\" class=\"maintenance-button\" data-test-device=\"" + id + "\">Testuj</button>",
            "<button type=\"button\" class=\"maintenance-button maintenance-button-danger\" data-delete-device=\"" + id + "\" data-name=\"" + escapeHtml(name) + "\">Usuń</button>",
            edit
        ]), stateDotHtml(id, null));
    }

    function byName(items) {
        return items.sort(function (a, b) {
            return String(a.name || a.id).toLowerCase().localeCompare(String(b.name || b.id).toLowerCase(), "pl");
        });
    }

    var EMPTY_TEXT = {
        temp: "Brak czujników temperatury i wilgotności",
        presence: "Brak czujników obecności",
        thermostat: "Brak termostatów",
        heating: "Brak urządzeń grzewczych",
        "switch": "Brak przełączników",
        other: ""
    };

    function render() {

        var groups = { temp: [], presence: [], thermostat: [], heating: [], "switch": [], other: [] };

        Object.keys(_sensors).forEach(function (id) {
            groups[sensorGroup(_sensors[id])].push({ id: id, name: _sensors[id].name, html: sensorRow(id, _sensors[id]) });
        });

        Object.keys(_devices).forEach(function (id) {
            groups[deviceGroup(id, _devices[id])].push({ id: id, name: _devices[id].name, html: deviceRow(id, _devices[id]) });
        });

        Object.keys(groups).forEach(function (group) {

            var items = byName(groups[group]);
            var box = el("grp-" + group);

            box.innerHTML = items.length
                ? items.map(function (item) { return item.html; }).join("")
                : (EMPTY_TEXT[group] ? "<div class=\"history-empty\">" + EMPTY_TEXT[group] + "</div>" : "");

            el("cnt-" + group).textContent = items.length;
            // "Pozostale" tylko, gdy cos w nich jest
            if (group === "other") { el("tab-other").hidden = !items.length; }
        });

        showTab(_tab);
    }

    // =====================================================
    // ZAKLADKI GRUP - wybrana zapamietana w przegladarce (localStorage)
    // =====================================================

    var TAB_KEY = "devices.tab";
    var _tab = null;

    try { _tab = window.localStorage.getItem(TAB_KEY); } catch (e) { _tab = null; }

    function showTab(group) {
        var tab = group && el("tab-" + group);
        if (!tab || tab.hidden) { group = "temp"; }
        _tab = group;

        Array.prototype.forEach.call(document.querySelectorAll(".dev-tab"), function (btn) {
            var active = btn.getAttribute("data-tab") === group;
            btn.classList.toggle("dev-tab-active", active);
            btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        Array.prototype.forEach.call(document.querySelectorAll(".dev-tab-pane"), function (pane) {
            pane.hidden = pane.getAttribute("data-tab") !== group;
        });
    }

    el("device-tabs").addEventListener("click", function (e) {
        var btn = e.target.closest && e.target.closest(".dev-tab");
        if (!btn) { return; }
        showTab(btn.getAttribute("data-tab"));
        try { window.localStorage.setItem(TAB_KEY, _tab); } catch (err) { /* bez zapamietania */ }
    });

    showTab(_tab);

    // =====================================================
    // ZDARZENIA (usuwanie, test, wl./wyl.)
    // =====================================================

    function closeMoreMenus(except) {
        Array.prototype.forEach.call(document.querySelectorAll(".dev-more-menu"), function (menu) {
            if (menu !== except) { menu.hidden = true; }
        });
    }

    // klik poza menu zamyka je
    document.addEventListener("click", function (e) {
        if (!e.target.closest || !e.target.closest(".dev-more")) { closeMoreMenus(); }
    });

    el("device-groups").addEventListener("click", function (e) {

        var target = e.target;

        var moreToggle = target.closest("[data-more-toggle]");

        if (moreToggle) {
            var menu = moreToggle.parentNode.querySelector(".dev-more-menu");
            closeMoreMenus(menu);
            menu.hidden = !menu.hidden;
            return;
        }

        // akcja z menu zamyka je (sama akcja wykonuje sie nizej)
        closeMoreMenus();

        var zbTestIeee = target.getAttribute("data-zb-test");

        if (zbTestIeee) {
            var parts = target.getAttribute("data-zb-result").split(":");
            var zbResultEl = document.querySelector("[data-test-result-" + parts[0] + "=\"" + parts[1] + "\"]");

            zbResultEl.textContent = "Testowanie…";

            api("/zigbee/devices/" + zbTestIeee + "/test")
                .then(function (res) { zbResultEl.textContent = res.error ? "Błąd: " + res.error : formatZigbeeTest(res); })
                .catch(function () { zbResultEl.textContent = "Błąd testu urządzenia."; });
            return;
        }

        var zbRemoveIeee = target.getAttribute("data-zb-remove");

        if (zbRemoveIeee) {

            if (!confirm("Usunąć urządzenie \"" + target.getAttribute("data-name") + "\" z sieci Zigbee i z listy?")) { return; }

            // najpierw z huba, dopiero potem wpisy rejestru tego ieee (czujnik i/lub urzadzenie) -
            // gdy hub odmowi, wpis zostaje (inaczej wrocilby przy odswiezeniu jako nowe urzadzenie)
            api("/zigbee/devices/" + zbRemoveIeee + "/remove", "POST", {}).then(function (res) {

                if (res.error) {
                    alert("Nie udało się usunąć z sieci Zigbee: " + res.error + ". Spróbuj ponownie za chwilę.");
                    return;
                }

                var removals = [];

                Object.keys(_sensors).forEach(function (sid) {
                    if (_sensors[sid].ieee === zbRemoveIeee) { removals.push(api("/device/schedule/sensors/" + sid, "DELETE")); }
                });
                Object.keys(_devices).forEach(function (did) {
                    if (_devices[did].ieee === zbRemoveIeee) { removals.push(api("/device/schedule/devices/" + did, "DELETE")); }
                });

                return Promise.all(removals).then(function () { setTimeout(loadAll, 600); });
            });
            return;
        }

        var deleteSensorId = target.getAttribute("data-delete-sensor");

        if (deleteSensorId && confirm("Usunąć czujnik \"" + target.getAttribute("data-name") + "\"?")) {
            api("/device/schedule/sensors/" + deleteSensorId, "DELETE").then(loadAll);
            return;
        }

        var testSensorId = target.getAttribute("data-test-sensor");

        if (testSensorId) {
            var sensorResultEl = document.querySelector("[data-test-result-sensor=\"" + testSensorId + "\"]");
            runTest("/sensor/test", _sensors[testSensorId] || {}, sensorResultEl);
            return;
        }

        var deleteDeviceId = target.getAttribute("data-delete-device");

        if (deleteDeviceId && confirm("Usunąć urządzenie \"" + target.getAttribute("data-name") + "\"?")) {
            api("/device/schedule/devices/" + deleteDeviceId, "DELETE").then(loadAll);
            return;
        }

        var testDeviceId = target.getAttribute("data-test-device");

        if (testDeviceId) {
            var deviceResultEl = document.querySelector("[data-test-result-device=\"" + testDeviceId + "\"]");
            runTest("/device/test", _devices[testDeviceId] || {}, deviceResultEl);
            return;
        }

        var onOffId = target.getAttribute("data-onoff-device");

        if (onOffId) {
            var state = target.getAttribute("data-state") === "on";

            // do potwierdzenia ODCZYTEM stanu (kontroler czyta urzadzenie zaraz po poleceniu): przycisk
            // z napisem postepu, kolko bez stanu - ani stary, ani nowy stan wczesniej
            _busy[onOffId] = state ? "Włączanie…" : "Wyłączanie…";
            render();

            var finish = function (text, res) {
                delete _busy[onOffId];
                if (res && res.ok) {
                    _states[onOffId] = { online: res.online !== false && res.enabled != null, on: res.enabled };
                }
                render();
                var resultEl = document.querySelector("[data-test-result-device=\"" + onOffId + "\"]");
                if (resultEl) { resultEl.textContent = text; }
            };

            api("/device/schedule/devices/" + onOffId + "/onOff", "POST", { state: state })
                .then(function (res) {
                    if (!res.ok) { finish("Błąd: " + (res.error || "nieznany"), null); return; }
                    var read = res.enabled === true ? "włączone" : res.enabled === false ? "wyłączone" : null;
                    finish(read === null ? "Brak odczytu stanu - urządzenie nie potwierdziło"
                        : res.enabled === state ? "Potwierdzone: " + read : "Nie przełączyło się - odczyt: " + read, res);
                })
                .catch(function () { finish("Błąd wysyłania komendy.", null); });
        }
    });

    // =====================================================
    // NOWE URZADZENIE ZIGBEE: okno z nazwa
    // =====================================================

    // Nowe urzadzenie (wpis rejestru z "name_pending", ustawianym przez
    // ems/display_devices.py::adopt_zigbee()) trafia do kolejki; okno
    // pokazuje je po jednym. Okno moze byc otwarte tu i na wyswietlaczu
    // naraz; te same POST /display/devices/setup i /skip zdejmuja znacznik,
    // wiec gdy nazwe nadano na wyswietlaczu, okno tu sie juz nie pojawi,
    // a otwarte zamyka sie przy nastepnym odswiezeniu.
    // Pole wypelnione nazwa domyslna (z huba/model, ems/display_devices.py::_name()).
    // Zapisz - wpisana nazwa, Pomin - zostaje nazwa domyslna; przy pustym
    // polu oba przyciski tylko pokazuja komunikat (okno zostaje otwarte).
    // Po zamknieciu zawsze odswiezenie listy.

    var GROUP_LABELS = {
        temp: "Czujnik temperatury i wilgotności",
        presence: "Czujnik obecności",
        thermostat: "Termostat",
        heating: "Urządzenie grzewcze",
        "switch": "Przełącznik z licznikiem energii",
        other: "Inne urządzenie"
    };

    var newModal = el("zb-new-modal");
    var newForm = el("zb-new-form");
    var newInfoEl = el("zb-new-info");
    var newNameEl = el("zb-new-name");
    var newHintEl = el("zb-new-hint");
    var newStatusEl = el("zb-new-status");
    var newSaveButton = el("zb-new-save");
    var newSkipButton = el("zb-new-skip");

    var _prompted = {};      // ieee, dla ktorych okno juz bylo (albo czeka w kolejce)
    var _newQueue = [];      // ieee czekajace na okno
    var _newCurrent = null;  // {ieee, name} - urzadzenie w otwartym oknie

    // wpis rejestru kind "zigbee" dla ieee: {group, item}
    function registryEntryOf(ieee) {

        var id;

        for (id in _devices) {
            if (_devices[id].kind === "zigbee" && _devices[id].ieee === ieee) {
                return { group: deviceGroup(id, _devices[id]), item: _devices[id] };
            }
        }

        for (id in _sensors) {
            if (_sensors[id].kind === "zigbee" && _sensors[id].ieee === ieee) {
                return { group: sensorGroup(_sensors[id]), item: _sensors[id] };
            }
        }

        return null;
    }

    // ieee urzadzen czekajacych na okno nazwy ("name_popup" z /config/devices/data)
    var _namePopup = [];

    function pendingIeees() {

        var pending = {};

        _namePopup.forEach(function (ieee) { pending[ieee] = true; });

        return pending;
    }

    function hideNew() {
        newModal.hidden = true;
        _newCurrent = null;
    }

    function handledElsewhere() {
        if (_newCurrent) { showStatus("Urządzenie „" + _newCurrent.name + "” obsłużono już na wyświetlaczu.", false); }
    }

    function collectNew() {

        var pending = pendingIeees();

        // nazwe nadano juz na wyswietlaczu - okno tu niepotrzebne (nie w trakcie
        // wlasnego zapisu - wtedy znacznik zdjal ten panel)
        if (_newCurrent && !newSaveButton.disabled && !pending[_newCurrent.ieee]) {
            handledElsewhere();
            hideNew();
        }

        _newQueue = _newQueue.filter(function (ieee) { return pending[ieee]; });

        Object.keys(_prompted).forEach(function (ieee) {
            if (!pending[ieee]) { delete _prompted[ieee]; }
        });

        Object.keys(pending).forEach(function (ieee) {
            if (!_prompted[ieee]) {
                _prompted[ieee] = true;
                _newQueue.push(ieee);
            }
        });

        showNextNew();
    }

    function infoLine(label, value) {
        return value ? "<div>" + label + ": <b>" + escapeHtml(value) + "</b></div>" : "";
    }

    function showNextNew() {

        while (!_newCurrent && _newQueue.length) {

            var ieee = _newQueue.shift();
            var entry = registryEntryOf(ieee);
            var zb = _zigbee[ieee];

            // urzadzenie juz usunieto - bez okna
            if (!entry || !zb) { continue; }

            var brand = String(zb.device_brand || "").trim();
            var model = ((brand && brand !== "?" ? brand + " " : "") + (zb.device_model || "")).trim();
            var defaultName = entry.item.name || zb.name || zb.device_model || ieee;

            _newCurrent = { ieee: ieee, name: defaultName };

            newInfoEl.innerHTML =
                infoLine("Rodzaj", GROUP_LABELS[entry.group]) +
                infoLine("Kategoria", zb.device_category) +
                infoLine("Model", model) +
                infoLine("Nazwa z huba", zb.name || zb.device_model) +
                infoLine("IEEE", ieee);

            newNameEl.value = defaultName;
            newNameEl.placeholder = "";
            newHintEl.textContent = "Wpisz własną nazwę i „Zapisz” albo „Pomiń” - zostaje nazwa „" + defaultName + "”.";
            newStatusEl.textContent = "";
            newStatusEl.className = "settings-message";
            newSaveButton.disabled = false;
            newSkipButton.disabled = false;

            newModal.hidden = false;
            newNameEl.focus();
            newNameEl.select();
        }
    }

    // puste pole blokuje i Zapisz, i Pomin - najpierw trzeba wpisac nazwe
    function nameMissing() {

        if (newNameEl.value.trim()) { return false; }

        newStatusEl.textContent = "Wpisz nazwę urządzenia.";
        newStatusEl.className = "settings-message error";
        newNameEl.focus();
        return true;
    }

    function setNewBusy(busy, text, isError) {
        newSaveButton.disabled = busy;
        newSkipButton.disabled = busy;
        newStatusEl.textContent = text;
        newStatusEl.className = "settings-message " + (isError ? "error" : "success");
    }

    // POST setup (nazwa) albo skip (Pomin); po sukcesie zamkniecie okna i
    // odswiezenie listy - nastepne okno z kolejki (collectNew()) juz na swiezych danych
    function finishNew(url, body) {

        setNewBusy(true, "Zapisywanie…", false);

        api(url, "POST", body)
            .then(function (res) {

                if (res.error === "already_named") {
                    handledElsewhere();
                } else if (!res.ok) {
                    setNewBusy(false, "Błąd: " + (res.error || "nieznany"), true);
                    return;
                }

                hideNew();
                loadAll();
            })
            .catch(function () { setNewBusy(false, "Błąd połączenia.", true); });
    }

    function skipNew() {
        if (_newCurrent && !newSkipButton.disabled && !nameMissing()) {
            finishNew("/display/devices/skip", { ieee: _newCurrent.ieee });
        }
    }

    newForm.addEventListener("submit", function (e) {

        e.preventDefault();

        if (!_newCurrent || newSaveButton.disabled || nameMissing()) { return; }

        var name = newNameEl.value.trim();

        if (name === _newCurrent.name) {
            skipNew();
            return;
        }

        // ten sam zapis co na wyswietlaczu (nazwa w hubie i w rejestrze), bez pomieszczenia
        finishNew("/display/devices/setup", { ieee: _newCurrent.ieee, name: name, room_id: null });
    });

    newSkipButton.addEventListener("click", skipNew);

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { skipNew(); }
    });

    // =====================================================
    // WCZYTANIE
    // =====================================================

    function safe(promise, fallback) {
        return promise.catch(function () { return fallback; });
    }

    function loadAll() {

        // JEDNO zapytanie (rejestracja nowych urzadzen Zigbee + wszystkie dane
        // ekranu) - kontroler obsluguje zapytania po kolei, a kazde moze
        // utknac w sieci na ~3 s, wiec 7 osobnych zapytan wczytywalo liste minutami
        return safe(api("/config/devices/data"), {}).then(function (res) {

            _sensors = res.sensors || {};
            _devices = res.devices || {};
            _models = res.models || {};
            _states = res.states || {};

            _zigbee = {};
            (Array.isArray(res.zigbee) ? res.zigbee : []).forEach(function (dev) { _zigbee[dev.ieee] = dev; });

            // urzadzenia grzewcze: grzejnik pomieszczenia, dogrzewacz CO, grzalka zasobnika
            _heatingRoles = {};

            function addRole(id, text) {
                if (!id) { return; }
                (_heatingRoles[id] = _heatingRoles[id] || []).push(text);
            }

            var rooms = res.rooms || {};
            Object.keys(rooms).forEach(function (roomId) {
                addRole(rooms[roomId].heater_device_id, "grzejnik: " + (rooms[roomId].name || roomId));
            });

            addRole(res.heating_heater_id, "dogrzewacz centralnego ogrzewania");
            addRole(res.water_heater_id, "grzałka zasobnika CWU");

            render();

            // bez odpowiedzi (blad sieci) kolejka okien bez zmian
            if (Array.isArray(res.zigbee)) {
                _namePopup = Array.isArray(res.name_popup) ? res.name_popup : [];
                collectNew();
            }
        });
    }

    // podczas otwartej sieci nowe urzadzenia pojawiaja sie same (rejestracja + odswiezenie listy);
    // przy otwartym oknie nowego urzadzenia co 10 s - zamyka sie, gdy obsluzono je na wyswietlaczu
    var pollTick = 0;

    setInterval(function () {

        pollTick++;

        if (networkOpenUntilMs > Date.now()) {
            loadZigbeeStatus();
            loadAll();
        } else if (_newCurrent && !newSaveButton.disabled && pollTick % 2 === 0) {
            loadAll();
        }
    }, 5000);

    loadAll();
})();
