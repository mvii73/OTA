(function () {

    // ==================================================
    // OGRZEWANIE MIESZKANIA - zakladki odpowiadajace zakladkom Heater i
    // Hot water panelu (ESP32_S3_EMS_Display_Panel) oraz Wykresy: schemat instalacji CO
    // z GET /display/heating oraz zbiornik, pompa cyrkulacyjna, dogrzewacz i
    // plan dnia z GET /display/waterHeater. Te same dane i te same akcje co na
    // panelu, tylko rysowane w SVG skalowanym do szerokosci ekranu.
    // Model widoku (heatingModel / waterModel) jest czysty - bez DOM.
    // ==================================================

    var REFRESH_MS = 30000;
    var GAS_WAIT_REFRESH_MS = 5000;

    var COLOR = {
        hot: "#ea580c", cold: "#2563eb", off: "#cbd5e1", warm: "#c2410c", humidity: "#0284c7",
        green: "#16a34a", yellow: "#b45309", red: "#dc2626", blue: "#1d4ed8",
        text: "#1f242b", muted: "#6b7785", card: "#ffffff", border: "#e3e7eb", inactive: "#e5e9ee"
    };

    var MODES = {
        heater_first: ["Najpierw dogrzewacz", "Do mocy dogrzewacza tylko dogrzewacz, powyżej tylko kocioł. Kocioł nie zastępuje zablokowanego dogrzewacza."],
        boiler_takeover: ["Kocioł przejmuje", "Gdy potrzeba więcej niż moc dogrzewacza, kocioł przejmuje całość."],
        boiler_only: ["Tylko kocioł", "Dogrzewacz nie jest używany."],
        heater_only: ["Tylko dogrzewacz", "Kocioł nie jest używany."]
    };

    function el(id) { return document.getElementById(id); }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function fmt(v, digits, unit) {
        if (v == null || isNaN(v)) { return "--"; }
        return Number(v).toFixed(digits).replace(".", ",") + (unit || "");
    }

    // kontroler w czasie czekania na Deye Cloud odpowiada na zmiany (POST) 503 {"error": "busy"}
    // (core/server.py::serve_readonly()) - zmiana ponawiana co BUSY_RETRY_MS, najwyzej BUSY_RETRIES razy
    var BUSY_RETRY_MS = 2000, BUSY_RETRIES = 15;

    function api(url, method, body, attempt) {
        var opts = { method: method || "GET" };
        if (body !== undefined) {
            opts.headers = { "Content-Type": "application/json" };
            opts.body = JSON.stringify(body);
        }
        return fetch(url, opts).then(function (r) {
            attempt = attempt || 0;
            if (r.status === 503 && opts.method !== "GET" && attempt < BUSY_RETRIES) {
                return new Promise(function (ok) { setTimeout(ok, BUSY_RETRY_MS); })
                    .then(function () { return api(url, method, body, attempt + 1); });
            }
            return r.json();
        });
    }

    // ---------- model: centralne ogrzewanie ----------

    function sourceState(src, override) {
        if (override && override.mode === "force") { return { key: "forced", label: "Wymuszony do " + override.until, color: COLOR.yellow }; }
        if (override && override.mode === "pause") { return { key: "paused", label: "Wstrzymany do " + override.until, color: COLOR.yellow }; }
        return src.on ? { key: "on", label: "Włączony", color: COLOR.green } : { key: "off", label: "Wyłączony", color: COLOR.muted };
    }

    function valveBars(room) {
        if (room.valve != null) { return Math.max(0, Math.min(5, Math.floor((room.valve * 5 + 99) / 100))); }
        return room.heating ? 5 : 0;
    }

    // obecnosc uzyta przy wyborze pozycji harmonogramu (pole "presence" z /display/heating);
    // bez ikony, gdy obecnosc nie wplynela na wybor (same godziny) albo brak czujnika
    var PRESENCE = {
        present: { color: COLOR.green, title: "Wykryto obecność - działa pozycja harmonogramu z obecnością" },
        absent: { color: COLOR.off, title: "Nikogo nie było - wybrana inna pozycja harmonogramu" },
        error: { color: COLOR.red, title: "Błąd odczytu obecności - pozycja harmonogramu z obecnością działa bez odczytu" }
    };

    // ikony stanu pomieszczenia - czcionka Google Material Symbols Rounded (wypelnione),
    // wczytywana w www/heating_home.py (tylko te trzy ikony); {title, color, name} albo null

    function presenceIcon(p) {
        if (!p) { return null; }
        return { title: p.title, color: p.color, name: "man", cls: "hh-icon-man" };
    }

    // indywidualna (reczna) nastawa; tooltip - nastawa i koniec
    function manualIcon(r) {
        if (!r.manual) { return null; }
        return {
            title: "Indywidualna nastawa " + fmt(r.setpoint, 1, " °C") + (r.manualUntil ? " do " + r.manualUntil : ""),
            color: COLOR.hot, name: "hand_gesture"
        };
    }

    // wilgotnosc wymusila grzanie (zadana podniesiona do max_temp); tooltip - wilgotnosc i prog
    function humidIcon(r) {
        if (!r.humid) { return null; }
        return {
            title: "Wymuszone grzanie - wysoka wilgotność" + (r.humidity ? " " + r.humidity : "") +
                (r.raw.humidity_max != null ? " (próg " + fmt(r.raw.humidity_max, 0, "%") + ")" : ""),
            color: COLOR.humidity, name: "humidity_high"
        };
    }

    // niska bateria urzadzenia pomieszczenia (ems/device_alerts.py::room_battery()): prawie pusta
    // (do 20%) - zolta, pusta (do 5%) - czerwona; tooltip - urzadzenie i poziom
    function batteryIcon(b) {
        if (!b) { return null; }
        var empty = b.level === "empty";
        return {
            title: (empty ? "Bateria do wymiany" : "Słaba bateria") + ": " + b.name + " " + fmt(b.pct, 0, "%"),
            color: empty ? COLOR.red : COLOR.yellow, name: empty ? "battery_0_bar" : "battery_1_bar"
        };
    }

    // ikony stanu w jednej grupie (to samo miejsce w kaflu), kazda z wlasnym tooltipem
    function roomIcons(r) {
        var icons = [presenceIcon(r.presence), manualIcon(r), humidIcon(r), batteryIcon(r.raw.battery)].filter(Boolean);
        if (!icons.length) { return ""; }
        return "<span class=\"hh-room-icons\">" + icons.map(function (i) {
            return "<span class=\"material-symbols-rounded hh-icon" + (i.cls ? " " + i.cls : "") + "\" role=\"img\" style=\"color:" + i.color + "\" title=\"" +
                esc(i.title) + "\" aria-label=\"" + esc(i.title) + "\">" + i.name + "</span>";
        }).join("") + "</span>";
    }

    // opis pod temperatura: "temperatura zadana: 20,0 °C (-0,5)" (w nawiasie temperatura minus zadana)
    function targetLine(r) {
        var d = r.temp == null || r.target == null ? null : Math.round((r.temp - r.target) * 10) / 10;
        return "temperatura zadana: " + fmt(r.target, 1, " °C") + (d == null ? "" : " (" + (d > 0 ? "+" : "") + fmt(d, 1) + ")");
    }

    // drugi pomiar temperatury (glowny jest w wierszu temperatury): przy temperaturze z czujnika
    // pomieszczenia "czujnik głowicy: 20,3 °C", przy temperaturze z glowicy "czujnik zewnętrzny:
    // 22,4 °C"; w nawiasie wiek odczytu, offline - wartosc przekreslona. HTML albo null -
    // pomieszczenie nie ma drugiego urzadzenia (bez wiersza)
    function ageText(s) {
        if (s == null) { return ""; }
        if (s < 60) { return " (< 1 min.)"; }
        if (s < 3600) { return " (" + Math.floor(s / 60) + " min.)"; }
        if (s < 86400) { return " (" + Math.floor(s / 3600) + " godz.)"; }
        return " (" + Math.floor(s / 86400) + " dn.)";
    }

    function sensorLine(r) {
        function line(label, v, info) {
            var value = esc(v == null ? "brak odczytu" : fmt(v, 1, " °C"));
            if (info && !info.online) { value = "<s title=\"offline\">" + value + "</s>"; }
            return esc(label) + ": " + value + esc(ageText(info && info.age_s));
        }
        var lines = [];
        if (r.has_sensor) { lines.push(line("czujnik zewnętrzny", r.sensor_temp, r.sensor_info)); }
        if (r.has_trv) { lines.push(line("czujnik głowicy", r.trv_temp && r.trv_temp.temp, r.trv_temp)); }
        return lines.length ? lines.join("<br>") : null;
    }

    function roomState(room) {
        if (room.heating == null) { return { label: "Brak głowicy", color: COLOR.muted }; }
        if (room.heating) { return { label: "Grzanie", color: COLOR.warm }; }
        // przestalo grzac, ale liczy sie do mocy i zasilania (minimalny czas zapotrzebowania)
        if (room.hold_until) { return { label: "Podtrzymanie do " + room.hold_until, color: COLOR.warm }; }
        return { label: "Oczekiwanie", color: COLOR.muted };
    }

    function powerText(w) {
        if (w == null) { return "--"; }
        return w >= 1000 ? fmt(w / 1000, 2, " kW") : fmt(w, 0, " W");
    }

    // etykiety badge: pierwsza litera duza, reszta mala ("ZABLOKOWANY" -> "Zablokowany", "heat" -> "Heat")
    function capital(text) {
        text = String(text == null ? "" : text);
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    }

    // wysylka temperatury pomieszczenia (REST roomTemp): kiedy ostatnio udana albo blad
    function sendText(sensor) {
        if (!sensor) { return null; }
        if (sensor.send_error) { return { text: "błąd wysyłki: " + sensor.send_error, ok: false, error: true }; }
        if (sensor.sent_age_s == null) { return { text: "brak", ok: false }; }
        return { text: Math.max(0, Math.floor(sensor.sent_age_s / 60)) + " min temu", ok: true };
    }

    // czujnik pomieszczenia bramki jednym wierszem: stan wg bramki (sensorState) i wysylka roomTemp
    // z EMS - "OK · N min temu", przy problemie tylko to, co nie dziala; w trybie Manual bez wiersza
    // (bramka steruje wtedy zasilaniem, nie temperatura pomieszczenia)
    function gatewaySensor(g) {
        var s = g.sensor;
        if (!s || g.mode === "manual") { return null; }
        var send = sendText(s);
        var stateOk = !s.state || String(s.state).toUpperCase() === "OK";
        if (stateOk && send.ok) { return { text: (s.state ? "OK · " : "") + send.text, ok: true }; }
        var bad = [];
        if (!stateOk) { bad.push(capital(s.state) + (s.error ? " (" + s.error + ")" : "")); }
        if (!send.ok) { bad.push(send.error ? send.text : "wysyłka: " + send.text); }
        return { text: bad.join(" · "), ok: false };
    }

    // stan CO / CWU wg sterownika DIYLESS (c_action / w_action z WebSocketu) albo null (brak danych)
    function actionState(a) {
        if (a == null || a === "") { return null; }
        var key = String(a).toLowerCase();
        if (key === "heating") { return { text: "Grzanie", color: COLOR.warm }; }
        if (key === "idle") { return { text: "Czuwanie", color: COLOR.muted }; }
        if (key === "off") { return { text: "Wyłączone", color: COLOR.muted }; }
        return { text: capital(a), color: COLOR.text };
    }

    function gatewayModel(g) {
        if (!g) { return null; }
        // badge: Offline - bramka nie odpowiada przez REST; Brak danych - REST dziala, ale
        // WebSocket milczy (nie wiadomo, w jakim trybie pracuje)
        var state = { key: "na", label: "Brak danych", color: COLOR.yellow };
        if (!g.online) { state = { key: "offline", label: "Offline", color: COLOR.red }; }
        else if (g.mode === "heat" || g.mode === "manual") { state = { key: "on", label: capital(g.mode), color: COLOR.green }; }
        else if (g.mode === "off") { state = { key: "off", label: "Off", color: COLOR.muted }; }
        var sp = g.setpoint;
        return {
            online: !!g.online,
            state: state,
            setpointLabel: sp ? (sp.kind === "supply" ? "Zasilanie" : "Wirtualna temperatura") : null,
            setpoint: sp ? fmt(sp.c, 1, " °C") : null,
            model: g.model || "brak danych",
            ch: actionState(g.ch_action),
            dhw: actionState(g.dhw_action),
            range: g.ch_min_c != null && g.ch_max_c != null ? fmt(g.ch_min_c, 0) + "–" + fmt(g.ch_max_c, 0) + " °C" : null,
            sensor: gatewaySensor(g)
        };
    }

    function heatingModel(d) {
        d = d || {};
        var boiler = d.boiler || {};
        var heater = d.heater || {};
        var pump = heater.pump || {};
        // tylko pomieszczenia z glowica (bez glowicy: heating == null)
        var rooms = (d.rooms || []).filter(function (r) { return r.heating != null; });
        // najpierw grzejace, potem wg nazwy
        rooms.sort(function (a, b) {
            return (b.heating ? 1 : 0) - (a.heating ? 1 : 0) || String(a.name || "").localeCompare(String(b.name || ""), "pl");
        });

        var b = sourceState(boiler, boiler.override);
        var h = sourceState(heater, heater.override);
        // blokada liczy sie tylko, gdy sterownik chce wlaczyc dogrzewacz (grzeje albo powinien -
        // "blocked_wanted"): badge "Zablokowany" i lewa krawedz na zolto, powod pod spodem; blokada
        // dogrzewacza, ktory i tak nie ma grzac, nic nie mowi - zwykle "Wyłączony"
        var blockActive = !!heater.blocked;
        var blocked = blockActive && (!!heater.on || !!heater.blocked_wanted);
        if (blocked) { h = { key: "blocked", label: "Zablokowany", color: COLOR.yellow }; }

        var flameTxt = boiler.flame == null ? "--" : (boiler.flame ? "WŁ" : "WYŁ");
        var mod = boiler.modulation_read_pct != null ? boiler.modulation_read_pct : boiler.modulation_pct;

        var pumpState = { key: "off", label: "Wyłączona", color: COLOR.muted }, pumpNote = null;
        if (!pump.configured) { pumpState = { key: "na", label: "Niedostępna", color: COLOR.yellow }; pumpNote = "Pompa nie jest skonfigurowana"; }
        else if (pump.online === false) { pumpState = { key: "na", label: "Niedostępna", color: COLOR.yellow }; pumpNote = "Pompa jest offline"; }
        else if (pump.on == null) { pumpState = { key: "na", label: "Niedostępna", color: COLOR.yellow }; pumpNote = "Brak danych o stanie pompy"; }
        else if (pump.on) { pumpState = { key: "on", label: "Włączona", color: COLOR.green }; }

        return {
            gateway: gatewayModel(d.gateway),
            hasBoiler: !!d.gas_configured,
            hasHeater: !!d.heater_configured,
            hot: !!boiler.on || !!heater.on,
            boiler: {
                state: b, flame: flameTxt, mod: fmt(mod, 0, "%"), pressure: fmt(d.pressure_bar, 1, " bar"),
                // temperatury z kotla (OpenTherm) - wspolne czujniki sa na rurach obok pomieszczen
                supply: fmt(boiler.supply_c, 1, " °C"),
                ret: fmt(boiler.return_c, 1, " °C"), diyless: boiler.interface === "diyless", override: boiler.override || null,
                wait: boiler.wait || null
            },
            heater: {
                name: "Dogrzewacz elektryczny", state: h, blocked: blocked, blockActive: blockActive,
                line1: blocked ? (heater.block_reasons || []).join(", ") : "Moc " + fmt(heater.power_kw, 1, " kW"),
                draw: powerText(heater.power_w),
                supply: fmt(heater.supply_c, 1, " °C"), ret: fmt(heater.return_c, 1, " °C"),
                override: heater.override || null, blockReasons: heater.block_reasons || []
            },
            pump: { state: pumpState, note: pumpNote, on: pumpState.key === "on", configured: !!pump.configured, draw: powerText(pump.power_w) },
            supply: fmt(d.supply_c, 1, " °C"),
            ret: fmt(d.return_c, 1, " °C"),
            control: d.control || null,
            strategy: d.strategy,
            modes: d.strategy_modes || [],
            rooms: rooms.map(function (r) {
                return {
                    id: r.id, name: r.name, temp: fmt(r.temp, 1, " °C"), heating: !!r.heating,
                    targetLine: targetLine(r), sensorLine: sensorLine(r),
                    manual: !!r.manual_until, manualUntil: r.manual_until, humid: !!r.humidity_boost,
                    state: roomState(r), humidity: r.humidity == null ? null : fmt(r.humidity, 0, "%"),
                    bars: valveBars(r), setpoint: r.target, max: r.max_temp, raw: r,
                    presence: PRESENCE[r.presence] || null
                };
            }),
            // pod dogrzewaczem i pompa (na telefonie miedzy zrodlami a pomieszczeniami)
            tiles: [
                ["Zapotrzebowanie", fmt(d.demand_kw, 1, " kW")],
                ["Zasilanie zadane", fmt(d.supply_target_c, 1, " °C")],
                ["Temperatura zewn.", fmt(d.outdoor_c, 1, " °C")],
                ["Wilgotność zewn.", fmt(d.outdoor_humidity, 0, "%")]
            ]
        };
    }

    // ---------- model: ciepla woda ----------

    function tankColor(t) { return t == null ? COLOR.off : (t < 38 ? "#3B82F6" : (t < 45 ? "#F59E0B" : "#EF4444")); }

    function minutes(hhmm) { var p = String(hhmm).split(":"); return Number(p[0]) * 60 + Number(p[1]); }

    function targetText(t) {
        if (!t || t.temp == null) { return "Wył."; }
        var s = fmt(t.temp, 0, " °C");
        if (t.until) { s += t.until === "24:00" || t.until === "00:00" ? " do północy" : " do " + t.until; }
        if (t.tomorrow) { s += " (jutro)"; }
        return s;
    }

    function pumpState(c) {
        if (!c || c.error) { return { text: "Brak danych", color: COLOR.muted, canToggle: false }; }
        if (!c.enabled) { return { text: "Wyłączona w EMS", color: COLOR.muted, canToggle: false }; }
        if (c.pump_on == null) { return { text: "Nieznany", color: COLOR.muted, canToggle: true }; }
        if (c.pump_on) {
            var rem = c.remaining_s != null ? " (jeszcze " + Math.ceil(c.remaining_s / 60) + " min)" : "";
            return { text: "WŁ" + rem, color: COLOR.green, canToggle: true, running: true };
        }
        return { text: "WYŁ", color: COLOR.muted, canToggle: true };
    }

    // "Ostatnio uruchomiona": nazwa pomieszczenia (z listy cyrkulacji, nie id) i sama godzina HH:MM:SS
    function lastStarted(c) {
        if (!c || !c.last) { return "--"; }
        var at = String(c.last.at || "");
        var time = (/(\d{2}:\d{2}:\d{2})/.exec(at) || [])[1] || at;
        var name = c.last.room;
        (c.rooms || []).forEach(function (r) { if (r.id === c.last.room) { name = r.name || r.id; } });
        return name ? name + ", " + time : time;
    }

    // zakladka CWU: grzanie gazem wlaczone, kociol jeszcze nie grzeje wody (odswiezanie co GAS_WAIT_REFRESH_MS)
    function gasWaiting() {
        var g = state.tab === "cwu" && state.water && state.water.gas;
        return !!(g && g.active && g.w_action !== "heating");
    }

    // kociol gazowy - grzanie zasobnika tylko na zadanie (ems/gas_dhw.py, GET /display/waterHeater -> gas)
    function gasModel(g) {
        g = g || {};
        if (!g.available) { return { available: false }; }
        var mode = String(g.w_mode || "").toLowerCase();
        var st = !g.online ? { text: "Brak danych", color: COLOR.muted }
            : mode !== "water" ? { text: "Wył.", color: COLOR.muted }
            : g.w_action === "heating" ? { text: "Grzeje", color: COLOR.warm } : { text: "Czeka", color: COLOR.muted };
        return {
            available: true,
            active: !!g.active,
            state: st,
            current: fmt(g.w_current, 1, " °C"),
            target: mode === "water" ? fmt(g.w_target, 0, " °C") : "--",
            error: g.error || null,
            end: g.end === "temp" ? "temp" : "time", temp: g.temp != null ? g.temp : 50, minutes: g.minutes || 30,
            maxTemp: g.max_temp != null ? g.max_temp : 60,
            label: !g.active ? "Grzej gazem" : g.to_temp && g.target_temp != null ? "Zatrzymaj grzanie do " + fmt(g.target_temp, 0, " °C")
                : g.until ? "Zatrzymaj grzanie do " + g.until : "Zatrzymaj grzanie"
        };
    }

    function waterModel(w, c) {
        w = w || {};
        if (!w.configured) { return { configured: false }; }
        var heaterState = w.heater_online === false ? "Offline" : (w.heater_online == null ? "Nieznany" : (w.heating ? "WŁ" : "WYŁ"));
        var boost = w.boost || {};
        var plan = w.plan || [];
        var segs = plan.map(function (s) {
            return {
                from: s.from, to: s.to, temp: s.temp, now: !!s.now, source: s.source,
                skippable: !!s.skippable, skipped: !!s.skipped,
                x: minutes(s.from) / 1440, w: Math.max(0, ((s.to === "00:00" ? 1440 : minutes(s.to)) - minutes(s.from)) / 1440),
                color: s.temp == null || s.skipped ? COLOR.off : tankColor(s.temp)
            };
        });
        var fill = w.temp_c == null ? 0 : Math.max(0, Math.min(1, (w.temp_c - 15) / 50));
        return {
            configured: true,
            sensor: w.sensor_name || "Zbiornik",
            temp: fmt(w.temp_c, 1, " °C"), tempColor: tankColor(w.temp_c), fill: fill,
            target: w.control_enabled === false ? "EMS nie steruje" : targetText(w.target),
            heating: !!w.heating,
            heater: { name: w.heater_name || "Grzałka", state: heaterState, energy: fmt(w.energy_today_kwh, 2, " kWh"), control: w.control_enabled ? "włączone" : "wyłączone" },
            // "Grzej": okno z wyborem czasu/temperatury (domyslne z konfiguracji); wlaczone - przycisk
            // podswietlony, klikniecie przywraca harmonogram
            boost: { active: !!boost.active, enabled: !!w.control_enabled,
                     end: boost.end === "temp" ? "temp" : "time", temp: boost.temp != null ? boost.temp : 50, minutes: boost.minutes || 30,
                     label: !boost.active ? "Włącz grzanie" : boost.to_temp && boost.target_temp != null ? "Zatrzymaj grzanie do " + fmt(boost.target_temp, 0, " °C")
                         : boost.until ? "Zatrzymaj grzanie do " + boost.until : "Zatrzymaj grzanie" },
            gas: gasModel(w.gas),
            pump: Object.assign({
                energy: fmt(c && c.energy_today_kwh, 2, " kWh"),
                last: lastStarted(c)
            }, pumpState(c)),
            plan: segs,
            reason: w.reason || null
        };
    }

    // ---------- centralne ogrzewanie: uklad kafli ----------

    function badge(st) { return "<span class=\"hh-badge\" style=\"color:" + st.color + ";border-color:" + st.color + "\">" + esc(capital(st.label)) + "</span>"; }
    function kv(k, v, color) { return "<div class=\"hh-kv\"><span>" + esc(k) + "</span><b" + (color ? " style=\"color:" + color + "\"" : "") + ">" + esc(v) + "</b></div>"; }

    function foot(txt, color) { return "<div class=\"hh-foot\" style=\"color:" + color + "\">" + esc(txt) + "</div>"; }

    function accent(st) { return st.key === "off" ? COLOR.off : st.color; }

    // kafel zrodla ciepla (kociol, bramka, dogrzewacz, pompa) - wspolny uklad: naglowek z badzem,
    // dwie kolumny (wiersze klucz-wartosc u gory, obrazek na srodku swojej kolumny), stopka z komunikatem
    function sourceTile(o) {
        return "<div class=\"hh-source " + o.cls + "\" style=\"border-left-color:" + o.accent + "\"" + (o.attrs || "") + ">" +
            "<div class=\"hh-source-head\"><span class=\"hh-source-title\">" + esc(o.title) + "</span>" + o.badge + "</div>" +
            "<div class=\"hh-source-body\"><div class=\"hh-source-rows\">" + o.rows + "</div>" +
            (o.img ? "<div class=\"hh-source-img\">" + o.img + "</div>" : "") + "</div>" +
            (o.foot || "") + "</div>";
    }

    function sourceImg(src, cls, on, w, h) {
        return "<img class=\"hh-boiler-img" + (cls ? " " + cls : "") + (on ? "" : " hh-boiler-idle") + "\" src=\"" + src +
            "\" alt=\"\" width=\"" + w + "\" height=\"" + h + "\" loading=\"lazy\">";
    }

    // kafel wartosci: [etykieta, wartosc, opis?]
    function tileHtml(t) {
        return "<div class=\"hh-tile\"><div class=\"hh-tile-label\">" + esc(t[0]) + "</div><div class=\"hh-tile-value\">" + esc(t[1]) + "</div>" +
            (t[2] ? "<div class=\"hh-tile-note\">" + esc(t[2]) + "</div>" : "") + "</div>";
    }

    function heatingHtml(m) {
        var boilerOn = m.boiler.state.key === "on" || m.boiler.state.key === "forced";
        var heaterOn = m.heater.state.key === "on" || m.heater.state.key === "forced";
        var html = "<div class=\"hh-diagram\"><div class=\"hh-left\">";

        html += sourceTile({
            cls: "hh-boiler hh-click", accent: accent(m.boiler.state), attrs: " data-source=\"boiler\"",
            title: "Kocioł gazowy", badge: badge(m.boiler.state),
            rows: kv("Płomień", m.boiler.flame) + kv("Modulacja", m.boiler.mod) + kv("Ciśnienie", m.boiler.pressure) +
                // DIYLESS podaje z OT tylko temperature wody kotla (bez powrotu) - jeden wiersz
                (m.boiler.diyless ? kv("Temperatura", m.boiler.supply) : kv("Zasilanie", m.boiler.supply) + kv("Powrót", m.boiler.ret)),
            img: sourceImg("/img/boiler.png", "", boilerOn, 72, 110),
            // za male zapotrzebowanie, zeby kociol przejal grzanie za zablokowany dogrzewacz
            foot: m.boiler.wait ? foot("Nie startuje: " + m.boiler.wait, COLOR.yellow) : ""
        });

        if (m.gateway) {
            var g = m.gateway;
            html += sourceTile({
                cls: "hh-gateway", accent: accent(g.state), title: "Bramka OpenTherm", badge: badge(g.state),
                rows: (g.setpointLabel ? kv(g.setpointLabel, g.setpoint) : "") +
                    kv("Model pracy", g.model) +
                    (g.ch ? kv("Status CO", g.ch.text, g.ch.color) : "") +
                    (g.dhw ? kv("Status CWU", g.dhw.text, g.dhw.color) : "") +
                    (g.range ? kv("Zakres zasilania", g.range) : "") +
                    (g.sensor ? kv("Czujnik", g.sensor.text, g.sensor.ok ? COLOR.green : COLOR.red) : "")
            });
        }

        html += sourceTile({
            cls: "hh-heater hh-click" + (m.heater.blocked ? " hh-source-blocked" : ""), accent: accent(m.heater.state),
            attrs: " data-source=\"heater\"", title: m.heater.name, badge: badge(m.heater.state),
            rows: kv("Energia", m.heater.draw) + kv("Zasilanie", m.heater.supply) + kv("Powrót", m.heater.ret),
            img: sourceImg("/img/heater.png", "hh-heater-img", heaterOn, 43, 110),
            foot: m.heater.blocked ? foot(m.heater.line1, COLOR.yellow) : ""
        });
        html += sourceTile({
            cls: "hh-pump-tile", accent: accent(m.pump.state), title: "Pompa dogrzewacza", badge: badge(m.pump.state),
            rows: kv("Energia", m.pump.draw),
            img: sourceImg("/img/pump.png", "hh-pump-img", m.pump.on, 63, 72),
            foot: m.pump.note ? foot(m.pump.note, COLOR.yellow) : ""
        });

        html += "<div class=\"hh-flow hh-flow-hot hh-supply" + (m.gateway ? "" : " hh-supply-wide") + (m.hot ? "" : " hh-flow-off") + "\"><span class=\"hh-line-h\"></span><div class=\"hh-flow-box\"><small>Zasilanie</small><b>" + esc(m.supply) + "</b></div><span class=\"hh-line-h\"></span></div>" +
            "<div class=\"hh-flow hh-flow-cold hh-return" + (m.hot ? "" : " hh-flow-off") + "\"><span class=\"hh-line-h\"></span><div class=\"hh-flow-box\"><small>Powrót</small><b>" + esc(m.ret) + "</b></div><span class=\"hh-line-h\"></span></div>";

        html += "<div class=\"hh-tiles hh-tiles-left\">" + m.tiles.map(tileHtml).join("") + "</div>";

        html += "</div><div class=\"hh-rooms\">" + m.rooms.map(function (r) {
            var bars = "";
            for (var b = 0; b < 5; b++) { bars += "<i style=\"background:" + (b < r.bars ? COLOR.hot : COLOR.inactive) + "\"></i>"; }
            return "<div class=\"hh-room hh-click" + (r.heating ? " hh-room-on" : "") + "\" data-room=\"" + esc(r.id) + "\">" +
                "<div class=\"hh-room-head\"><b>" + esc(r.name) + "</b>" + badge(r.state) + "</div>" +
                "<div class=\"hh-room-temp\"><span style=\"color:" + (r.heating ? COLOR.warm : COLOR.text) + "\">" + esc(r.temp) + "</span>" +
                roomIcons(r) +
                "<span class=\"hh-room-right\">" +
                (r.humidity ? "<span class=\"hh-room-hum\" style=\"color:" + COLOR.humidity + "\">" + esc(r.humidity) + "</span>" : "") +
                "<span class=\"hh-bars\" title=\"otwarcie zaworu\">" + bars + "</span></span></div>" +
                "<div class=\"hh-room-foot\"><span style=\"color:" + (r.manual ? COLOR.blue : COLOR.muted) + "\">" +
                esc(r.targetLine) + (r.sensorLine ? "<br>" + r.sensorLine : "") + "</span>" +
                "<a class=\"hh-btn hh-btn-small hh-room-schedule\" href=\"/config/rooms/schedule?id=" + encodeURIComponent(r.id) + "\">Harmonogram</a></div></div>";
        }).join("") + "</div></div>";

        return html;
    }

    // ---------- SVG: zbiornik i plan dnia ----------

    // ---------- SVG: zbiornik ----------

    function tankSvg(m) {
        var h = 200, top = 40, fillH = Math.round(h * m.fill);
        return "<svg class=\"hh-svg hh-tank\" viewBox=\"0 0 120 260\" role=\"img\" aria-label=\"Zbiornik ciepłej wody\">" +
            "<rect x=\"20\" y=\"" + top + "\" width=\"80\" height=\"" + h + "\" rx=\"24\" fill=\"" + COLOR.inactive + "\" stroke=\"" + COLOR.border + "\" stroke-width=\"3\"/>" +
            "<clipPath id=\"hh-tank-clip\"><rect x=\"20\" y=\"" + top + "\" width=\"80\" height=\"" + h + "\" rx=\"24\"/></clipPath>" +
            "<rect x=\"20\" y=\"" + (top + h - fillH) + "\" width=\"80\" height=\"" + fillH + "\" fill=\"" + m.tempColor + "\" clip-path=\"url(#hh-tank-clip)\"/>" +
            "</svg>";
    }

    // Plan na dziś jako lista (jak na ekranie /config/water-heater): godziny, temperatura, źródło;
    // przedział bieżący pogrubiony ze znacznikiem, przedziały z regułą - Pomiń / Przywróć
    function planTable(plan) {
        if (!plan.length) { return "<div class=\"hh-empty\">Brak danych</div>"; }

        var rows = plan.map(function (p, i) {
            var action = "";
            if (p.skippable || p.skipped) {
                action = "<button type=\"button\" class=\"hh-btn hh-btn-small\" data-act=\"skip\" data-skip=\"" + i + "\">" + (p.skipped ? "Przywróć" : "Pomiń") + "</button>";
            }
            return "<tr" + (p.now ? " class=\"hh-plan-now\"" : "") + "><td>" + esc(p.from + " – " + p.to) + (p.now ? " ◀" : "") + "</td>" +
                "<td class=\"align-right\">" + (p.temp == null ? "wyłączona" : fmt(p.temp, 1, " °C")) + "</td>" +
                "<td>" + esc(p.source || "–") + (p.skipped ? " (pominięta)" : "") + "</td>" +
                "<td class=\"align-right\">" + action + "</td></tr>";
        }).join("");

        return "<div class=\"history-measurements-wrapper\"><table class=\"history-measurements\"><thead><tr>" +
            "<th>Godziny</th><th class=\"align-right\">Temperatura</th><th>Źródło</th><th></th></tr></thead><tbody>" + rows + "</tbody></table></div>";
    }

    // ---------- widok ----------

    // tab: "co" | "cwu" | "charts"; chart: historia dla chart.hours pobrana o chart.at
    // boostBusy / pumpBusy: napis przycisku grzania wody / pompy cyrkulacyjnej w czasie wysylania
    // (odswiezanie go nie nadpisuje)
    var state = { heating: null, water: null, circulation: null, popup: null, tab: "co", chart: null, boostBusy: null, pumpBusy: null, gasBusy: null };

    function sectionHeader(title, note) {
        return "<div class=\"hh-head\"><span class=\"hh-title\">" + esc(title) + "</span>" + (note ? "<span class=\"hh-note\">" + esc(note) + "</span>" : "") + "</div>";
    }

    function renderHeating() {
        var host = el("hh-heating");
        if (!host) { return; }
        var d = state.heating;
        if (!d || d.error) { host.innerHTML = "<div class=\"hh-empty\">" + (d ? "Błąd: " + esc(d.error) : "Wczytywanie…") + "</div>"; return; }
        var m = heatingModel(d);
        el("hh-mode").innerHTML = "<span class=\"hh-mode-label\">Tryb pracy: <b>" + esc((MODES[m.strategy] || [m.strategy || "--"])[0]) + "</b></span>" +
            "<button type=\"button\" class=\"hh-btn hh-btn-mode\" data-act=\"mode\">Zmień tryb</button>";
        host.innerHTML = "<div class=\"hh-scene\">" + heatingHtml(m) + "</div>";
    }

    function renderWater() {
        var host = el("hh-water");
        if (!host) { return; }
        var m = waterModel(state.water, state.circulation);
        if (!state.water) { host.innerHTML = "<div class=\"hh-empty\">Wczytywanie…</div>"; return; }
        if (!m.configured) { host.innerHTML = "<div class=\"hh-empty\">Ciepła woda nie jest skonfigurowana (menu: Ciepła woda użytkowa).</div>"; return; }

        var html = "<div class=\"hh-water-grid" + (m.gas.available ? " hh-water-grid-4" : "") + "\">";
        html += "<div class=\"hh-card hh-tank-card\">" + tankSvg(m) + "<div><div class=\"hh-muted\">" + esc(m.sensor) + "</div>" +
            "<div class=\"hh-big\" style=\"color:" + m.tempColor + "\">" + esc(m.temp) + "</div>" +
            "<div class=\"hh-muted\">Zadana</div><div class=\"hh-mid\">" + esc(m.target) + "</div>" +
            "<div class=\"hh-state\" style=\"color:" + (m.heating ? COLOR.warm : COLOR.muted) + "\">● " + (m.heating ? "Grzeje" : "Czeka") + "</div></div></div>";

        html += "<div class=\"hh-card\"><div class=\"hh-card-title\">" + esc(m.heater.name) + "</div>" +
            "<div class=\"hh-line\"><span>Stan</span><b>" + esc(m.heater.state) + "</b></div>" +
            "<div class=\"hh-line\"><span>Sterowanie EMS</span><b>" + esc(m.gas.active ? "wyłączona - grzanie gazem" : m.heater.control) + "</b></div>" +
            "<div class=\"hh-line\"><span>Energia dziś</span><b>" + esc(m.heater.energy) + "</b></div>" +
            "<button type=\"button\" class=\"hh-btn " + (m.boost.active ? "hh-btn-orange" : "hh-btn-orange-outline") + "\" data-act=\"boost\"" +
            (m.boost.active ? " title=\"Kliknij, żeby wrócić do harmonogramu\"" : "") + (m.boost.enabled && !state.boostBusy ? "" : " disabled") + ">" +
            esc(state.boostBusy || m.boost.label) + "</button></div>";
        if (m.gas.available) {
            html += "<div class=\"hh-card\"><div class=\"hh-card-title\">Kocioł gazowy</div>" +
                "<div class=\"hh-line\"><span>Stan</span><b style=\"color:" + m.gas.state.color + "\">" + esc(m.gas.state.text) + "</b></div>" +
                "<div class=\"hh-line\"><span>Zasobnik wg kotła</span><b>" + esc(m.gas.current) + "</b></div>" +
                "<div class=\"hh-line\"><span>Zadana kotła</span><b>" + esc(m.gas.target) + "</b></div>" +
                (m.gas.error ? "<div class=\"hh-line\"><span>Błąd</span><b>" + esc(m.gas.error) + "</b></div>" : "") +
                "<button type=\"button\" class=\"hh-btn " + (m.gas.active ? "hh-btn-orange" : "hh-btn-orange-outline") + "\" data-act=\"gas\"" +
                (m.gas.active ? " title=\"Kliknij, żeby zatrzymać grzanie gazem\"" : "") + (state.gasBusy ? " disabled" : "") + ">" +
                esc(state.gasBusy || m.gas.label) + "</button></div>";
        }
        html += "<div class=\"hh-card\"><div class=\"hh-card-title\">Pompa cyrkulacyjna</div>" +
            "<div class=\"hh-line\"><span>Stan</span><b style=\"color:" + m.pump.color + "\">" + esc(m.pump.text) + "</b></div>" +
            "<div class=\"hh-line\"><span>Ostatnio uruchomiona</span><b>" + esc(m.pump.last) + "</b></div>" +
            "<div class=\"hh-line\"><span>Energia dziś</span><b>" + esc(m.pump.energy) + "</b></div>" +
            "<button type=\"button\" class=\"hh-btn " + (m.pump.running ? "hh-btn-green" : "hh-btn-green-outline") + "\" data-act=\"pump\"" +
            (m.pump.canToggle && !state.pumpBusy ? "" : " disabled") + ">" +
            esc(state.pumpBusy || (m.pump.running ? "Zatrzymaj pompę" : "Uruchom pompę")) + "</button></div>";

        html += "</div>";

        html += "<div class=\"hh-card hh-plan\"><div class=\"hh-card-title\">Plan na dziś</div>" + planTable(m.plan) + "</div>";
        host.innerHTML = html;
    }

    // ---------- okna ----------

    function openPopup(html) { state.popup = html; var p = el("hh-popup"); p.innerHTML = "<div class=\"hh-modal\">" + html + "</div>"; p.hidden = false; }
    function closePopup() { state.popup = null; var p = el("hh-popup"); p.hidden = true; p.innerHTML = ""; }

    function roomPopup(room) {
        var max = room.max != null ? room.max : 30, set = room.setpoint != null ? room.setpoint : 20;
        openPopup("<h3>" + esc(room.name) + "</h3><div class=\"hh-stepper\"><button type=\"button\" class=\"hh-btn\" data-step=\"-0.5\">−</button>" +
            "<span id=\"hh-set\" data-v=\"" + set + "\" data-min=\"5\" data-max=\"" + max + "\">" + fmt(set, 1, " °C") + "</span>" +
            "<button type=\"button\" class=\"hh-btn\" data-step=\"0.5\">+</button></div>" +
            "<div class=\"hh-modal-actions\"><button type=\"button\" class=\"hh-btn hh-btn-green\" data-act=\"room-set\" data-room=\"" + esc(room.id) + "\">Ustaw</button>" +
            (room.manual ? "<button type=\"button\" class=\"hh-btn\" data-act=\"room-cancel\" data-room=\"" + esc(room.id) + "\">Wróć do harmonogramu</button>" : "") +
            "<button type=\"button\" class=\"hh-btn\" data-act=\"close\">Zamknij</button></div>");
    }

    function sourcePopup(source, m) {
        var s = m[source], name = source === "boiler" ? "Kocioł gazowy" : s.name;
        var info = source === "heater" && s.blockActive ? "<p class=\"hh-warn\">Zablokowany: " + esc(s.blockReasons.join(", ")) + ". Blokada wygrywa z wymuszeniem.</p>" : "";
        openPopup("<h3>" + esc(name) + "</h3>" + info +
            "<div class=\"hh-stepper\"><button type=\"button\" class=\"hh-btn\" data-step=\"-0.5\">−</button><span id=\"hh-set\" data-v=\"2\" data-min=\"0.5\" data-max=\"12\" data-unit=\" h\">2,0 h</span>" +
            "<button type=\"button\" class=\"hh-btn\" data-step=\"0.5\">+</button></div>" +
            "<div class=\"hh-modal-actions\"><button type=\"button\" class=\"hh-btn\" data-act=\"src\" data-source=\"" + source + "\" data-action=\"cancel\">Auto (EMS)</button>" +
            "<button type=\"button\" class=\"hh-btn\" data-act=\"src\" data-source=\"" + source + "\" data-action=\"pause\">Wstrzymaj</button>" +
            "<button type=\"button\" class=\"hh-btn hh-btn-orange\" data-act=\"src\" data-source=\"" + source + "\" data-action=\"force\">Wymuś</button>" +
            "<button type=\"button\" class=\"hh-btn\" data-act=\"close\">Zamknij</button></div>");
    }

    // wymuszone grzanie wody: koniec po czasie (co 15 min) albo po osiagnieciu temperatury (co 5 °C)
    // kind "gas": kociol gazowy - zadana od 30 °C do temperatury maksymalnej z konfiguracji
    // zasobnika; na czas kociol grzeje do temperatury maksymalnej i trzyma ja do konca czasu
    var BOOST_STEP = { time: { step: 15, min: 15, max: 240, unit: " min", dec: 0 }, temp: { step: 5, min: 5, max: 85, unit: " °C", dec: 0 } };

    function boostPopup(end, b, kind) {
        var gas = kind === "gas";
        var s = gas && end === "temp" ? { step: 5, min: 30, max: b.maxTemp, unit: " °C", dec: 0 } : BOOST_STEP[end];
        var v = end === "temp" ? b.temp : b.minutes;
        v = Math.max(s.min, Math.min(s.max, v));
        function seg(k, name) {
            return "<button type=\"button\" class=\"hh-seg" + (k === end ? " hh-seg-on" : "") + "\" data-act=\"boost-end\" data-end=\"" + k + "\"" +
                (gas ? " data-kind=\"gas\"" : "") + ">" + name + "</button>";
        }
        openPopup("<h3>" + (gas ? "Grzanie wody kotłem gazowym" : "Grzanie wody") + "</h3><div class=\"hh-segs\">" + seg("time", "Czas") + seg("temp", "Temperatura") + "</div>" +
            (gas ? "<p class=\"hh-muted\">" + (end === "time"
                ? "Kocioł grzeje zasobnik do " + fmt(b.maxTemp, 0, " °C") + " (maksymalna) i utrzymuje ją do końca czasu."
                : "Kocioł grzeje zasobnik do wybranej temperatury (najwyżej " + fmt(b.maxTemp, 0, " °C") + ", najdłużej 3 h).") +
                " Grzałka jest w tym czasie wyłączona.</p>" : "") +
            "<div class=\"hh-stepper\"><button type=\"button\" class=\"hh-btn\" data-step=\"-" + s.step + "\">−</button>" +
            "<span id=\"hh-set\" data-v=\"" + v + "\" data-min=\"" + s.min + "\" data-max=\"" + s.max + "\" data-unit=\"" + s.unit +
            "\" data-dec=\"" + s.dec + "\" data-snap=\"1\" data-end=\"" + end + "\">" + fmt(v, s.dec, s.unit) + "</span>" +
            "<button type=\"button\" class=\"hh-btn\" data-step=\"" + s.step + "\">+</button></div>" +
            "<div class=\"hh-modal-actions hh-modal-actions-center\"><button type=\"button\" class=\"hh-btn hh-btn-orange\" data-act=\"boost-start\"" + (gas ? " data-kind=\"gas\"" : "") + ">Grzej</button>" +
            "<button type=\"button\" class=\"hh-btn\" data-act=\"close\">Zamknij</button></div>");
    }

    function modePopup(m) {
        openPopup("<h3>Model sterowania</h3><div class=\"hh-modes\">" + Object.keys(MODES).map(function (k) {
            var avail = m.modes.indexOf(k) >= 0;
            return "<button type=\"button\" class=\"hh-mode" + (k === m.strategy ? " hh-mode-on" : "") + "\" data-act=\"mode-set\" data-mode=\"" + k + "\"" + (avail ? "" : " disabled") + ">" +
                "<b>" + esc(MODES[k][0]) + "</b><span>" + esc(MODES[k][1]) + "</span></button>";
        }).join("") + "</div><div class=\"hh-modal-actions\"><button type=\"button\" class=\"hh-btn\" data-act=\"close\">Zamknij</button></div>");
    }

    // ---------- akcje ----------

    function after(p) { return p.then(function () { closePopup(); return load(); }).catch(function () { closePopup(); }); }

    // nastawa pomieszczenia: nowa decyzja (stan grzania, ikony) powstaje w cyklu sterowania
    // obudzonym przez POST /rooms/<id>/manual - kafel wczytywany jeszcze raz po chwili
    function afterRoom(p) {
        return after(p).then(function () { [4000, 10000].forEach(function (ms) { setTimeout(load, ms); }); });
    }

    // wymuszone grzanie: okno znika od razu, przycisk pokazuje postep do odpowiedzi (kontroler od razu
    // przelicza grzalke; zajety - ponawianie w api(), w tym czasie odswiezanie zakladki rysuje przycisk
    // z napisem postepu), potem zakladka wczytywana od nowa
    function boostSend(body, busy) {
        closePopup();
        waterSend("boostBusy", "/water-heater/boost", body, busy);
    }

    // przycisk zakladki CWU: "key" - pole state z napisem postepu (boostBusy / pumpBusy)
    function waterSend(key, url, body, busy) {
        state[key] = busy;
        renderWater();
        api(url, "POST", body)
            .then(function (res) {
                if (res && (res.ok === false || res.error)) {
                    var texts = {
                        busy: "Kontroler jest zajęty - spróbuj za chwilę.",
                        gas_active: "Trwa grzanie wody kotłem gazowym - grzałka jest wtedy wyłączona. Najpierw zatrzymaj grzanie gazem.",
                        gas_dhw_unavailable: "Kocioł nie jest sterowany przez DIYLESS - grzanie wody gazem niedostępne.",
                        control_disabled: "Sterowanie grzałką przez EMS jest wyłączone."
                    };
                    window.alert(texts[res.error] || "Nie udało się: " + (res.error || "błąd"));
                }
            })
            .catch(function () { window.alert("Brak odpowiedzi kontrolera."); })
            .then(function () { state[key] = null; return load(); });
    }

    function onClick(e) {
        var t = e.target;
        var stepBtn = t.closest && t.closest("[data-step]");

        if (stepBtn) {
            var v = el("hh-set"), step = Number(stepBtn.dataset.step), cur = Number(v.dataset.v);
            // data-snap: na pelne wielokrotnosci kroku (48 °C + 5 -> 50 °C)
            var next = v.dataset.snap ? (step > 0 ? Math.floor(cur / step) * step + step : Math.ceil(cur / -step) * -step + step) : cur + step;
            var nv = Math.max(Number(v.dataset.min), Math.min(Number(v.dataset.max), next));
            v.dataset.v = nv;
            v.textContent = fmt(nv, v.dataset.dec != null ? Number(v.dataset.dec) : 1, v.dataset.unit || " °C");
            return;
        }


        // odnosnik w kaflu (przycisk "Harmonogram") - przejscie, bez okna nastawy
        if (t.closest && t.closest("a[href]")) { return; }

        var roomEl = t.closest && t.closest("[data-room]:not([data-act])");
        if (roomEl && state.heating) {
            var m = heatingModel(state.heating);
            var rm = m.rooms.filter(function (r) { return r.id === roomEl.dataset.room; })[0];
            if (rm) { roomPopup(rm); }
            return;
        }

        var srcEl = t.closest && t.closest("[data-source]:not([data-act])");
        if (srcEl && state.heating) { sourcePopup(srcEl.dataset.source, heatingModel(state.heating)); return; }

        var actEl = t.closest && t.closest("[data-act]");
        if (!actEl) { return; }
        var act = actEl.dataset.act;

        if (act === "close") { closePopup(); }
        else if (act === "mode") { modePopup(heatingModel(state.heating)); }
        else if (act === "mode-set") { after(api("/heating/config", "POST", { strategy: actEl.dataset.mode })); }
        else if (act === "room-set") { afterRoom(api("/rooms/" + encodeURIComponent(actEl.dataset.room) + "/manual", "POST", { setpoint: Number(el("hh-set").dataset.v) })); }
        else if (act === "room-cancel") { afterRoom(api("/rooms/" + encodeURIComponent(actEl.dataset.room) + "/manual", "POST", { action: "cancel" })); }
        else if (act === "src") {
            after(api("/heating/override", "POST", { source: actEl.dataset.source, action: actEl.dataset.action, hours: Number(el("hh-set").dataset.v) }));
        }
        else if (act === "pump") {
            var pumpOn = !!(state.circulation && state.circulation.pump_on);
            waterSend("pumpBusy", "/water-heater/circulation", { action: pumpOn ? "stop" : "start" }, pumpOn ? "Zatrzymywanie…" : "Uruchamianie…");
        }
        else if (act === "boost") {
            var wb = waterModel(state.water, state.circulation).boost;
            if (wb.active) { boostSend({ action: "cancel" }, "Zatrzymywanie…"); }
            else { boostPopup(wb.end, wb); }
        }
        else if (act === "gas") {
            var gm = waterModel(state.water, state.circulation).gas;
            if (gm.active) { closePopup(); waterSend("gasBusy", "/water-heater/gas", { action: "cancel" }, "Zatrzymywanie…"); }
            else { boostPopup(gm.end, gm, "gas"); }
        }
        else if (act === "boost-end") {
            var wm = waterModel(state.water, state.circulation);
            boostPopup(actEl.dataset.end, actEl.dataset.kind === "gas" ? wm.gas : wm.boost, actEl.dataset.kind);
        }
        else if (act === "boost-start") {
            var bs = el("hh-set"), body = { action: "start", end: bs.dataset.end };
            body[bs.dataset.end === "temp" ? "temp" : "minutes"] = Number(bs.dataset.v);
            if (actEl.dataset.kind === "gas") {
                // na czas - zadana kotla = temperatura maksymalna (ustala kontroler)
                closePopup();
                waterSend("gasBusy", "/water-heater/gas", body, "Uruchamianie…");
            } else {
                boostSend(body, "Uruchamianie…");
            }
        }
        else if (act === "skip") {
            var s = waterModel(state.water, state.circulation).plan[Number(actEl.dataset.skip)];
            if (s) { api("/water-heater/skip", "POST", { action: s.skipped ? "unskip" : "skip", from: s.from, to: s.to }).then(load); }
        }
    }

    // ---------- ladowanie ----------

    var CHART_REFRESH_MS = 300000;   // historia zbiera sie co 5 min
    var TAB_KEY = "heating.tab", HOURS_KEY = "heating.chartHours";
    var CHARTS_KEY = "heating.charts";   // lista zapisana tylko w tej przegladarce

    function stored(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
    function store(key, v) { try { window.localStorage.setItem(key, v); return true; } catch (e) { return false; } }
    function unstore(key) { try { window.localStorage.removeItem(key); } catch (e) { /* brak dostepu */ } }

    function chartHours() { return Number(el("hh-chart-hours").value) || 6; }

    // ---------- lista wykresow ----------
    // Wykresy uzytkownika: [{id, title, keys: [klucze www/heating_chart.js::catalog()]}]. Zmiany nie
    // zapisuja sie same - "Zapisz" pyta, gdzie: tylko w tej przegladarce (CHARTS_KEY) albo na
    // kontrolerze (GET/POST /heating/charts, storage/heating_charts_store.py) - wspolne dla wszystkich.
    // Przy wejsciu: lista z tej przegladarki, gdy jest, inaczej z kontrolera, a bez niej -
    // www/heating_chart.js::defaultCharts().
    // source: "local" | "controller" | "default" - skad pochodzi zapisana lista; dirty - niezapisane
    // zmiany; choosing - pytanie "gdzie zapisac" na ekranie; chartsLoaded - lista wczytana (nieudany
    // odczyt z kontrolera - ponowna proba przy kolejnym odswiezeniu).
    // editing - id wykresu z otwarta edycja (zaznaczenie od razu przerysowuje wykres).

    var charts = null, editing = null, chartsLoaded = false;
    var chartSave = { source: "default", dirty: false, choosing: false, error: "" };

    function setCharts(list) {
        if (!Array.isArray(list)) { list = window.__heatingChart ? window.__heatingChart.defaultCharts() : []; }
        charts = list.filter(function (c) { return c && Array.isArray(c.keys); }).map(function (c, i) {
            return { id: i + 1, title: String(c.title || "Wykres"), keys: c.keys.map(String) };
        });
    }

    function chartList() { return charts.map(function (c) { return { title: c.title, keys: c.keys }; }); }

    function localCharts() {
        try { var list = JSON.parse(stored(CHARTS_KEY) || "null"); return Array.isArray(list) ? list : null; } catch (e) { return null; }
    }

    var SOURCE_TEXT = {
        local: "Zapisane tylko na tym komputerze",
        controller: "Zapisane na kontrolerze (wspólne)",
        "default": "Wykresy domyślne"
    };

    function saveBarHtml() {
        function btn(act, text, cls) {
            return "<button type=\"button\" class=\"maintenance-button" + (cls ? " " + cls : "") + "\" data-cact=\"" + act + "\">" + text + "</button>";
        }
        var s = chartSave;
        if (s.choosing) {
            return "<span>Zapisać wykresy:</span>" + btn("save-local", "Tylko na tym komputerze") +
                btn("save-all", "Na wszystkich urządzeniach", "maintenance-button-dark") + btn("save-cancel", "Anuluj", "maintenance-button-secondary");
        }
        return "<span class=\"hh-chart-source\">" + SOURCE_TEXT[s.source] + (s.dirty ? " · <b>niezapisane zmiany</b>" : "") + "</span>" +
            (s.error ? "<span class=\"hh-chart-status\">" + esc(s.error) + "</span>" : "") +
            (s.dirty ? btn("save", "Zapisz", "maintenance-button-dark") : "") +
            (s.source === "local" ? btn("use-shared", "Użyj wspólnych", "maintenance-button-secondary") : "");
    }

    function renderSaveBar() {
        var bar = el("hh-chart-save");
        if (bar) { bar.innerHTML = saveBarHtml(); }
    }

    function markDirty() {
        chartSave.dirty = true;
        chartSave.error = "";
        renderSaveBar();
    }

    // lista z tej przegladarki, a bez niej z kontrolera (raz)
    function fetchCharts() {
        if (chartsLoaded) { return Promise.resolve(); }
        var local = localCharts();
        if (local) {
            setCharts(local);
            chartsLoaded = true;
            chartSave.source = "local";
            return Promise.resolve();
        }
        return api("/heating/charts").then(function (res) {
            var list = res && res.charts;
            setCharts(Array.isArray(list) ? list : null);
            chartsLoaded = true;
            chartSave.source = Array.isArray(list) ? "controller" : "default";
            chartSave.error = "";
        }).catch(function () {
            if (!charts) { setCharts(null); }
            chartSave.error = "Nie wczytano wykresów z kontrolera";
        });
    }

    function saveLocal() {
        if (!store(CHARTS_KEY, JSON.stringify(chartList()))) {
            chartSave.error = "Przeglądarka nie pozwala zapisać (tryb prywatny?)";
            chartSave.choosing = false;
            renderSaveBar();
            return;
        }
        chartSave.source = "local";
        chartSave.dirty = chartSave.choosing = false;
        chartSave.error = "";
        renderSaveBar();
    }

    // na kontrolerze - lista z tej przegladarki usuwana, zeby wspolna byla widoczna takze tutaj
    function saveShared() {
        chartSave.choosing = false;
        chartSave.error = "Zapisywanie…";
        renderSaveBar();
        api("/heating/charts", "POST", { charts: chartList() }).then(function (res) {
            if (!res || res.error) { throw new Error(res && res.error); }
            unstore(CHARTS_KEY);
            chartSave.source = "controller";
            chartSave.dirty = false;
            chartSave.error = "";
        }).catch(function () {
            chartSave.error = "Nie zapisano na kontrolerze - spróbuj ponownie";
        }).then(renderSaveBar);
    }

    // porzuca liste z tej przegladarki i wczytuje wspolna z kontrolera
    function useShared() {
        if (chartSave.dirty && !confirm("Porzucić niezapisane zmiany i użyć wykresów zapisanych na kontrolerze?")) { return; }
        unstore(CHARTS_KEY);
        chartsLoaded = false;
        chartSave.dirty = false;
        editing = null;
        fetchCharts().then(renderChart);
    }

    function chartById(id) { return charts.filter(function (c) { return c.id === id; })[0]; }

    function plotHtml(c) {
        var data = state.chart && state.chart.data, range = data && window.__heatingChart.timeRange(data, state.chart.hours);
        if (!state.chart) { return "<div class=\"hero-chart-note\">Ładowanie...</div>"; }
        if (!range) { return "<div class=\"hero-chart-note\">Za mało danych - historia zbiera się co 5 minut.</div>"; }
        if (!c.keys.length) { return "<div class=\"hero-chart-note\">Wybierz wartości przyciskiem „Edytuj”.</div>"; }
        return window.__heatingChart.chartHtml(data, range.t0, range.t1, c.keys, c.title) ||
            "<div class=\"hero-chart-note\">Brak danych wybranych wartości w tym zakresie.</div>";
    }

    function editorHtml(c) {
        var groups = window.__heatingChart.catalog(state.chart && state.chart.data);
        return "<div class=\"hh-chart-edit\">" +
            "<label class=\"hh-chart-name-edit\">Nazwa <input type=\"text\" maxlength=\"60\" data-cname=\"" + c.id + "\" value=\"" + esc(c.title) + "\"></label>" +
            groups.map(function (g) {
                return "<fieldset><legend>" + esc(g.title) + "</legend>" + g.items.map(function (item) {
                    return "<label><input type=\"checkbox\" data-ckey=\"" + esc(item[0]) + "\" data-cid=\"" + c.id + "\"" +
                        (c.keys.indexOf(item[0]) >= 0 ? " checked" : "") + "> " + esc(item[1]) + "</label>";
                }).join("") + "</fieldset>";
            }).join("") +
            "<div class=\"hh-chart-edit-foot\"><button type=\"button\" class=\"maintenance-button\" data-cact=\"done\" data-cid=\"" + c.id + "\">Gotowe</button></div></div>";
    }

    function cardHtml(c, i) {
        function btn(act, text, title, disabled) {
            return "<button type=\"button\" class=\"maintenance-button" + (act === "del" ? " maintenance-button-danger" : "") + "\" data-cact=\"" + act +
                "\" data-cid=\"" + c.id + "\"" + (title ? " title=\"" + title + "\"" : "") + (disabled ? " disabled" : "") + ">" + text + "</button>";
        }
        return "<div class=\"hh-chart-card\" data-chart=\"" + c.id + "\">" +
            "<div class=\"hh-chart-head\"><span class=\"hero-chart-title hh-chart-title\" data-cact=\"edit\" data-cid=\"" + c.id +
            "\" title=\"Nazwa i wartości wykresu\">" + esc(c.title) + "</span><span class=\"hh-chart-actions\">" +
            btn("edit", editing === c.id ? "Zamknij" : "Edytuj", "Nazwa i wartości wykresu") + btn("up", "↑", "Wyżej", i === 0) + btn("down", "↓", "Niżej", i === charts.length - 1) +
            btn("del", "Usuń") + "</span></div>" +
            (editing === c.id ? editorHtml(c) : "") +
            "<div class=\"hh-chart-plot\">" + plotHtml(c) + "</div></div>";
    }

    function renderChart() {
        var body = el("hh-chart");
        if (!body || !window.__heatingChart) { return; }
        if (!charts) { setCharts(null); }
        var range = state.chart && window.__heatingChart.timeRange(state.chart.data, state.chart.hours);
        renderSaveBar();
        body.innerHTML = (charts.length ? charts.map(cardHtml).join("") : "<div class=\"hero-chart-note\">Brak wykresów - dodaj wykres przyciskiem „+ Dodaj wykres”.</div>") +
            (range && range.note ? "<div class=\"hero-chart-note\">" + esc(range.note) + "</div>" : "");
    }

    // nowe dane przy otwartej liscie wartosci - tylko same wykresy (bez utraty pola nazwy w trakcie pisania)
    function refreshPlots() {
        if (editing === null) { renderChart(); return; }
        charts.forEach(function (c) {
            var plot = document.querySelector("[data-chart=\"" + c.id + "\"] .hh-chart-plot");
            if (plot) { plot.innerHTML = plotHtml(c); }
        });
    }

    function redrawPlot(c) {
        var plot = document.querySelector("[data-chart=\"" + c.id + "\"] .hh-chart-plot");
        if (plot) { plot.innerHTML = plotHtml(c); }
    }

    function onChartClick(e) {
        var b = e.target.closest && e.target.closest("[data-cact]");
        if (!b) { return; }
        var act = b.getAttribute("data-cact"), id = Number(b.getAttribute("data-cid")), c = chartById(id);
        if (act === "save") { chartSave.choosing = true; renderSaveBar(); return; }
        if (act === "save-cancel") { chartSave.choosing = false; renderSaveBar(); return; }
        if (act === "save-local") { saveLocal(); return; }
        if (act === "save-all") { saveShared(); return; }
        if (act === "use-shared") { useShared(); return; }
        if (act === "add") {
            var next = charts.reduce(function (m, x) { return Math.max(m, x.id); }, 0) + 1;
            charts.push({ id: next, title: "Wykres " + (charts.length + 1), keys: [] });
            editing = next;
            markDirty();
            renderChart();
            var card = document.querySelector("[data-chart=\"" + next + "\"]");
            if (card && card.scrollIntoView) { card.scrollIntoView({ block: "nearest" }); }
            return;
        }
        if (act === "defaults") {
            if (!confirm("Wstawić wykresy domyślne w miejsce obecnych? Zostaną zachowane dopiero po zapisaniu.")) { return; }
            editing = null;
            setCharts(null);
            markDirty();
            renderChart();
            return;
        }
        if (!c) { return; }
        var i = charts.indexOf(c);
        if (act === "edit") { editing = editing === id ? null : id; }
        else if (act === "done") { editing = null; }
        else if (act === "del") {
            if (!confirm("Usunąć wykres „" + c.title + "”?")) { return; }
            charts.splice(i, 1);
            if (editing === id) { editing = null; }
            markDirty();
        }
        else if (act === "up" && i > 0) { charts.splice(i - 1, 0, charts.splice(i, 1)[0]); markDirty(); }
        else if (act === "down" && i < charts.length - 1) { charts.splice(i + 1, 0, charts.splice(i, 1)[0]); markDirty(); }
        renderChart();
    }

    function onChartChange(e) {
        var t = e.target, key = t.getAttribute("data-ckey"), nameId = t.getAttribute("data-cname");
        if (key !== null) {
            var c = chartById(Number(t.getAttribute("data-cid")));
            if (!c) { return; }
            var at = c.keys.indexOf(key);
            if (t.checked && at < 0) { c.keys.push(key); }
            if (!t.checked && at >= 0) { c.keys.splice(at, 1); }
            markDirty();
            redrawPlot(c);
        } else if (nameId !== null) {
            var nc = chartById(Number(nameId));
            if (!nc) { return; }
            nc.title = t.value.trim() || "Wykres";
            markDirty();
            var title = document.querySelector("[data-chart=\"" + nc.id + "\"] .hh-chart-head .hero-chart-title");
            if (title) { title.textContent = nc.title; }
        }
    }

    // historia pobierana ponownie po zmianie zakresu albo gdy starsza niz CHART_REFRESH_MS
    function loadChart() {
        var body = el("hh-chart"), hours = chartHours();
        if (!body || !window.__heatingChart) { return Promise.resolve(); }
        var c = state.chart;
        if (chartsLoaded && c && c.hours === hours && Date.now() - c.at < CHART_REFRESH_MS) { return Promise.resolve(); }
        if (!c) { renderChart(); }
        // po kolei: lista wykresow, potem historia (serwer obsluguje jedno zadanie naraz)
        var first = !chartsLoaded;
        return fetchCharts()
            .then(function () { if (first) { renderChart(); } })
            .then(function () { return c && c.hours === hours && Date.now() - c.at < CHART_REFRESH_MS ? null : window.__heatingChart.fetchHistory(hours); })
            .then(function (data) {
                if (!data) { return; }
                if (hours !== chartHours()) { return; }   // w miedzyczasie wybrano inny zakres
                var firstData = !state.chart || !state.chart.data;
                state.chart = { hours: hours, at: Date.now(), data: data };
                // pierwsze dane - pelny widok (lista wartosci z pomieszczeniami z historii)
                if (firstData) { renderChart(); } else { refreshPlots(); }
            })
            .catch(function () { body.textContent = "Nie udało się pobrać historii."; });
    }

    // tylko widoczna zakladka; po kolei, nie rownolegle - serwer na ESP32 obsluguje jedno zadanie naraz
    function load() {
        if (state.tab === "charts") { return loadChart(); }
        if (state.tab === "cwu") {
            return api("/display/waterHeater").then(function (d) { state.water = d; renderWater(); })
                .catch(function () {})
                .then(function () { return api("/water-heater/circulation").then(function (d) { state.circulation = d; renderWater(); }); })
                .catch(function () {});
        }
        return api("/display/heating").then(function (d) { state.heating = d; renderHeating(); }).catch(function () {});
    }

    function showTab(tab) {
        if (["co", "cwu", "charts"].indexOf(tab) < 0) { tab = "co"; }
        state.tab = tab;
        Array.prototype.forEach.call(document.querySelectorAll("#hh-tabs .dev-tab"), function (btn) {
            var active = btn.getAttribute("data-tab") === tab;
            btn.classList.toggle("dev-tab-active", active);
            btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        Array.prototype.forEach.call(document.querySelectorAll(".hh-pane"), function (pane) {
            pane.hidden = pane.getAttribute("data-tab") !== tab;
        });
    }

    function hasOption(sel, v) {
        return Array.prototype.some.call(sel.options, function (o) { return o.value === v; });
    }

    function initChartControls() {
        var hoursSel = el("hh-chart-hours");
        var hours = stored(HOURS_KEY);
        if (hours && hasOption(hoursSel, hours)) { hoursSel.value = hours; }
        hoursSel.addEventListener("change", function () { store(HOURS_KEY, hoursSel.value); loadChart(); });
        el("hh-chart-pane").addEventListener("click", onChartClick);
        el("hh-chart").addEventListener("change", onChartChange);
        // nazwa wykresu na biezaco (zdarzenie "change" dopiero po wyjsciu z pola)
        el("hh-chart").addEventListener("input", function (e) {
            var id = e.target.getAttribute("data-cname");
            var title = id !== null && document.querySelector("[data-chart=\"" + id + "\"] .hh-chart-head .hero-chart-title");
            if (title) { title.textContent = e.target.value.trim() || "Wykres"; }
            if (id !== null && !chartSave.dirty) { markDirty(); }
        });
        window.addEventListener("beforeunload", function (e) {
            if (chartSave.dirty) { e.preventDefault(); e.returnValue = ""; }
        });
    }

    function init() {
        if (!el("hh-heating")) { return; }
        document.addEventListener("click", onClick);
        initChartControls();
        el("hh-tabs").addEventListener("click", function (e) {
            var btn = e.target.closest && e.target.closest(".dev-tab");
            if (!btn || btn.getAttribute("data-tab") === state.tab) { return; }
            showTab(btn.getAttribute("data-tab"));
            store(TAB_KEY, state.tab);
            load();
        });
        showTab(stored(TAB_KEY));
        load();
        setInterval(function () { if (!state.popup && !document.hidden) { load(); } }, REFRESH_MS);
        // grzanie wody gazem wlaczone, a kociol jeszcze nie grzeje (start zajmuje kociolowi
        // od kilkunastu sekund do kilku minut) - zakladka CWU czesciej, zeby "Grzeje" bylo widac od razu
        setInterval(function () { if (!state.popup && !document.hidden && gasWaiting()) { load(); } }, GAS_WAIT_REFRESH_MS);
    }

    window.__heatingHome = { heatingModel: heatingModel, waterModel: waterModel, heatingHtml: heatingHtml, planTable: planTable, valveBars: valveBars, pumpState: pumpState, targetText: targetText };

    if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); } else { init(); }
})();
