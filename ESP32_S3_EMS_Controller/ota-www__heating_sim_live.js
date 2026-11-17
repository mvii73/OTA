(function () {

    // ==================================================
    // SYMULACJA OGRZEWANIA - stan z GET /heating/sim co 5 s
    // (ems/heating_sim.py). Nic nie jest wysylane do kotla/dogrzewacza;
    // konfiguracja - ekran Centralne ogrzewanie (www/heating_sim.js).
    // ==================================================

    function el(id) { return document.getElementById(id); }

    function api(url, method, body) {
        var opts = { method: method || "GET" };

        if (body !== undefined) {
            opts.headers = { "Content-Type": "application/json" };
            opts.body = JSON.stringify(body);
        }

        return fetch(url, opts).then(function (r) { return r.json(); });
    }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function num(v, digits) {
        return v == null ? "–" : Number(v).toFixed(digits).replace(".", ",");
    }

    // ---------- stan ----------

    function row(label, value) {
        return "<tr><td>" + escapeHtml(label) + "</td><td class=\"measurement-energy\">" + value + "</td></tr>";
    }

    function renderSummary(s) {

        var b = s.boiler;
        var boilerText = b.on
            ? "<b>PRACUJE</b> · " + num(b.power_kw, 1) + " kW · modulacja " + b.modulation_pct + " %"
            : "<b>WYŁĄCZONY</b>";
        if (b.note) { boilerText += " · " + escapeHtml(b.note); }
        if (b.protection) { boilerText += "<br><span style=\"color:var(--danger, #c0392b)\">" + escapeHtml(b.protection) + "</span>"; }

        var heaterText = s.heater.on ? "<b>WŁĄCZONY</b> · " + num(s.heater.power_kw, 1) + " kW" : "<b>WYŁĄCZONY</b>";
        if (s.heater.name) { heaterText += " (" + escapeHtml(s.heater.name) + ")"; }

        var balance = s.balance_kw > 0.05 ? "nadwyżka " + num(s.balance_kw, 2) + " kW"
            : (s.balance_kw < -0.05 ? "brak " + num(-s.balance_kw, 2) + " kW" : "zbilansowane");

        el("hs-summary").innerHTML = "<div class=\"history-measurements-wrapper\"><table class=\"history-measurements\"><tbody>" +
            row("Model sterowania", s.strategy === "heater_only" ? "tylko dogrzewacz elektryczny (bez kotła gazowego)"
                : (s.strategy === "boiler_only" ? "tylko kocioł (bez dogrzewacza)"
                : (s.strategy === "boiler_takeover"
                    ? "powyżej mocy dogrzewacza tylko kocioł" : "dogrzewacz + kocioł dokładający resztę"))) +
            row("Temperatura zewnętrzna", num(s.outdoor_c, 1) + " °C <span class=\"settings-hint\">(" + escapeHtml(s.outdoor_source) + ")</span>") +
            row("Straty obliczeniowe budynku", num(s.design_load_kw, 2) + " kW <span class=\"settings-hint\">(" + escapeHtml(s.design_load_source) + ")</span>") +
            row("Zapotrzebowanie na moc", "<b>" + num(s.demand_kw, 2) + " kW</b> <span class=\"settings-hint\">(straty " +
                num(s.base_kw, 2) + " + dopalanie " + num(s.boost_kw, 2) + "; H = " + num(s.loss_kw_per_k, 3) + " kW/K)</span>") +
            row("Zasilanie zadane", s.supply_target_c == null ? "– (nic nie grzeje)" : "<b>" + num(s.supply_target_c, 1) + " °C</b>") +
            row("Zasilanie / powrót zmierzone", num(s.supply_c, 1) + " / " + num(s.return_c, 1) + " °C") +
            row("Kocioł gazowy", boilerText) +
            row("Dogrzewacz elektryczny", heaterText) +
            row("Moc dostarczana", num(s.delivered_kw, 2) + " kW · " + balance) +
            row("Histereza CO", "±" + num(s.hysteresis_c, 1) + " °C") +
            row("Obliczono", escapeHtml(s.checked_at.slice(11, 19))) +
            "</tbody></table></div>";

        // tylko panel wybranego interfejsu do kotla (konfiguracja: Centralne ogrzewanie)
        var diylessSelected = s.boiler_interface === "diyless";
        el("hs-gateway-panel").hidden = diylessSelected;

        if (!diylessSelected) {
            renderGateway(s.gateway, s.ot_command);
        }

        renderDiyless(s.diyless, diylessSelected);

        if (!s.rooms.length) {
            el("hs-rooms").innerHTML = "<div class=\"history-empty\">Brak pomieszczeń z przypisanym termostatem Zigbee albo urządzeniem grzewczym.</div>";
            return;
        }

        var rows = s.rooms.map(function (r) {
            var temp = r.temp == null ? "brak odczytu" : num(r.temp, 1) + " °C";
            return "<tr>" +
                "<td>" + escapeHtml(r.name) + (r.trv && r.weight != null
                    ? " <span class=\"settings-hint\">(" + (r.volume_m3 ? num(r.volume_m3, 0) + " m³, " : "") + num(r.weight * 100, 0) + "%)</span>" : "") + "</td>" +
                "<td>" + escapeHtml(r.source) + "</td>" +
                "<td class=\"measurement-energy\">" + num(r.target_temp, 1) + " °C</td>" +
                "<td class=\"measurement-energy\">" + temp + "</td>" +
                "<td>" + (r.calling ? "<b>grzeje</b>" : "nie") + "</td>" +
                "<td class=\"measurement-energy\">" + num(r.deficit, 1) + " °C</td>" +
                "<td class=\"measurement-energy\">" + num(r.loss_kw + r.boost_kw, 2) + " kW</td>" +
                "<td class=\"measurement-energy\">" + (r.trv_setpoint == null ? "–" : num(r.trv_setpoint, 1) + " °C") + "</td>" +
                "<td>" + (r.heater_name ? escapeHtml(r.heater_name) + ": " + (r.heater_on ? "<b>WŁ.</b>" : "wył.") : "–") + "</td></tr>";
        }).join("");

        el("hs-rooms").innerHTML = "<div class=\"history-measurements-wrapper\"><table class=\"history-measurements\">" +
            "<thead><tr><th>Pomieszczenie</th><th>Źródło zadanej</th><th class=\"align-right\">Zadana</th>" +
            "<th class=\"align-right\">Temperatura</th><th>Grzanie</th><th class=\"align-right\">Niedogrzanie</th>" +
            "<th class=\"align-right\">Moc</th><th class=\"align-right\">Nastawa głowicy</th><th>Urządzenie grzewcze</th></tr></thead>" +
            "<tbody>" + rows + "</tbody></table></div>";
    }

    function yesNo(v) {
        return v == null ? "–" : (v ? "tak" : "nie");
    }

    function renderDiyless(d, selected) {

        var panel = el("hs-diyless-panel");
        panel.hidden = !selected;

        if (!selected) { return; }

        if (!d) {
            el("hs-diyless").innerHTML = "<div class=\"history-empty\">Sterownik nie skonfigurowany (adres IP na ekranie Centralne ogrzewanie).</div>";
            return;
        }

        var c = d.command;

        // tryb manual: EMS ustawia temperature zasilania wprost (c_target), nie wirtualna temperature pokoju
        var rows = c.manual
            ? row(c.control ? "Wysyłane do sterownika (zasilanie)" : "Zostałoby wysłane (zasilanie, sterowanie wyłączone)",
                c.c_mode === "off"
                    ? "<b>c_mode=off</b> · kocioł ma nie grzać, sterownik wyłączony"
                    : (c.control ? "<b>c_mode=manual</b> · kocioł ma grzać · c_target <b>" : "tryb manual · kocioł ma grzać · zasilanie <b>") + num(c.supply_c, 1) + " °C</b>")
            : row(c.control ? "Wysyłane do sterownika" : "Zostałoby wysłane (sterowanie wyłączone)",
            (c.heat ? "kocioł ma grzać" : "bez grzania") + " · roomTemp <b>" + num(c.room_temp_c, 1) + " °C</b>" +
            " <span class=\"settings-hint\">(zadana sterownika " + num(c.target_c, 1) + " °C, " +
            (c.target_source === "sterownik" ? "odczytana ze sterownika" : "ręczna z konfiguracji") + ")</span>");

        if (c.override_until_text) {
            rows += row("Ręczne wymuszenie trybu", "do <b>" + escapeHtml(c.override_until_text) +
                "</b> <span class=\"settings-hint\">- EMS nie zmienia trybu ani nastawy sterownika (wznowienie: kafel Kocioł na Pulpicie)</span>");
        }

        var ctl = d.controller;

        if (ctl) {
            var hold = ctl.hold && ctl.hold !== "off";

            // tryb manual: c_target to temperatura ZASILANIA kotla ustawiona w sterowniku,
            // a nie zadana pomieszczenia - wirtualna temperatura EMS jest wtedy ignorowana
            if (ctl.manual) {
                rows += row("Tryb sterownika", "<b>manual</b> <span class=\"settings-hint\">- " +
                    (c.control ? "EMS ustawia temperaturę zasilania wprost (nastawa " : "sterowanie wyłączone, zasilanie ustawia się w sterowniku (nastawa ") +
                    escapeHtml(String(ctl.target_c)) + " °C, kocioł " + escapeHtml(String(ctl.current_c)) + " °C)</span>");
            }

            rows += row("Nastawy sterownika (WebSocket)",
                (ctl.manual ? "zasilanie zadane" : "zadana CO") + " <b>" + escapeHtml(String(ctl.target_c)) + " °C</b> · tryb " + escapeHtml(String(ctl.mode)) +
                " · hold: " + (hold ? "<b>" + escapeHtml(String(ctl.hold)) + "</b>" : "wyłączony") +
                " · CWU " + escapeHtml(String(ctl.dhw_target_c)) + " °C" +
                " <span class=\"settings-hint\">(" + ctl.age_s + " s temu)</span>");
        } else {
            rows += row("Nastawy sterownika (WebSocket)",
                "<span class=\"settings-hint\">brak danych - używana ręczna zadana (" + num(c.manual_target_c, 1) + " °C)" +
                (d.ws_error ? " · błąd: " + escapeHtml(d.ws_error) : " · jeszcze nie odebrano wiadomości") + "</span>");
        }

        if (c.control) {
            var s = d.sent;
            var sentText;

            if (!s) {
                sentText = "jeszcze nie wysłano";
            } else if (s.kind === "override") {
                sentText = "ręczne wymuszenie trybu" + (s.until_text ? " do " + escapeHtml(s.until_text) : "") + " - EMS nic nie wysyła";
            } else {
                var status = s.ok ? "OK" : "<span style=\"color:var(--danger, #c0392b)\">błąd" + (s.error ? " (" + escapeHtml(s.error) + ")" : "") + "</span>";
                var what = s.kind === "supply"
                    ? " · " + (s.c_mode === "off" ? "c_mode=off" : "c_mode=manual, zasilanie " + num(s.supply_c, 1) + " °C")
                    : " · roomTemp " + num(s.room_temp_c, 1) + " °C";
                var actions = s.actions && s.actions.length ? " (wysłano: " + escapeHtml(s.actions.join(", ")) + ")" : (s.unchanged ? " (już ustawione w sterowniku)" : "");
                sentText = status + what + actions + " · " + s.age_s + " s temu";
            }

            rows += row("Ostatnia wysyłka", sentText);
        }

        var st = d.status;

        if (!st) {
            rows += row("Sterownik " + escapeHtml(d.ip), "<span style=\"color:var(--danger, #c0392b)\">brak odpowiedzi</span>" +
                (d.error ? " <span class=\"settings-hint\">(" + escapeHtml(d.error) + ")</span>" : ""));
        } else {
            var ot = st.otStatus === "No connection" ? "<span style=\"color:var(--danger, #c0392b)\">brak połączenia z kotłem</span>" : escapeHtml(st.otStatus);
            rows +=
                row("Łączność OpenTherm", ot) +
                row("Płomień / modulacja", yesNo(st.flameOn) + " / " + num(st.relModLevel, 0) + " %") +
                row("Temperatura kotła maks.", num(st.boilerMax, 0) + " °C") +
                row("Ciśnienie CO", st.chWaterPressure ? num(st.chWaterPressure, 2) + " bar" : "–") +
                row("Awaria", st.faultCode ? "kod " + st.faultCode + (st.faultFlags ? " (" + escapeHtml(st.faultFlags) + ")" : "") : "brak") +
                (st.uiError ? row("Komunikat sterownika", escapeHtml(st.uiError)) : "") +
                row("Czujnik pomieszczenia", escapeHtml(st.sensorType) + " · " + escapeHtml(st.sensorState)) +
                row("Wi-Fi / firmware", st.wifiRssi + " dBm · " + escapeHtml(st.fwVersion)) +
                row("Odczyt sterownika", d.age_s + " s temu");
        }

        el("hs-diyless").innerHTML = "<div class=\"history-measurements-wrapper\"><table class=\"history-measurements\"><tbody>" + rows + "</tbody></table></div>";
    }

    function renderGateway(g, cmd) {

        var box = el("hs-gateway");

        var command = cmd.ch_enable
            ? "grzanie CO <b>WŁ.</b> · zasilanie " + num(cmd.setpoint_c, 1) + " °C · limit modulacji " + cmd.max_modulation_pct + " %"
            : "grzanie CO wył.";

        var rows = row("Zostałoby wysłane (symulacja)", command);

        if (!g) {
            box.innerHTML = "<div class=\"history-measurements-wrapper\"><table class=\"history-measurements\"><tbody>" + rows +
                row("Bramka", "nie skonfigurowana (adres IP w sekcji Urządzenia i czujniki)") + "</tbody></table></div>";
            return;
        }

        var st = g.status;

        if (!st) {
            rows += row("Bramka " + escapeHtml(g.ip), "<span style=\"color:var(--danger, #c0392b)\">brak odpowiedzi</span>" +
                (g.error ? " <span class=\"settings-hint\">(" + escapeHtml(g.error) + ")</span>" : ""));
        } else {
            var b = st.boiler || {};
            var t = st.targets || {};
            var who = st.control === "ems" ? "<b>EMS</b> (przez bramkę)"
                : (st.control === "gateway" ? "<b>bramka</b> (regulacja awaryjna)" : "<b>termostat rezerwowy</b>");
            var link = b.connected ? (b.link_ok ? "OK" : "brak odpowiedzi kotła") : "adapter odłączony (rezerwa)";
            var supported = st.supported || {};
            var noMod = supported.max_modulation_14 === "no" ? " <span class=\"settings-hint\">(kocioł nie obsługuje limitu modulacji)</span>" : "";

            rows +=
                row("Kotłem steruje", who + " <span class=\"settings-hint\">(" + escapeHtml(st.control_reason) + ")</span>") +
                row("Ostatnie polecenie EMS", st.ems.last_command_s == null ? "brak" : st.ems.last_command_s + " s temu") +
                row("Zadane w bramce", "CO " + yesNo(t.ch_enable) + " · zasilanie " + num(t.setpoint_c, 1) + " °C · limit " + num(t.max_modulation_pct, 0) + " %" + noMod) +
                row("Łączność z kotłem", link) +
                row("Płomień / CO / CWU", yesNo(b.flame) + " / " + yesNo(b.ch_active) + " / " + yesNo(b.dhw_active)) +
                row("Zasilanie / powrót (kocioł)", num(b.supply_c, 1) + " / " + num(b.return_c, 1) + " °C") +
                row("Modulacja / ciśnienie", num(b.modulation_pct, 0) + " % / " + num(b.pressure_bar, 2) + " bar") +
                row("Awaria", yesNo(b.fault) + (b.oem_fault ? " (kod " + b.oem_fault + ")" : "")) +
                row("Odczyt bramki", g.age_s + " s temu") +
                (st.adapter ? row("Adapter", escapeHtml(st.adapter.name) + " (IN " + st.adapter.in_pin + ", OUT " + st.adapter.out_pin + ")") : "") +
                (st.fallback ? row("Tryb awaryjny bramki", st.fallback.mode === "gateway"
                    ? "termostat bramki: " + num(st.fallback.room_setpoint_c, 1) + " °C, pokój " +
                      (st.fallback.ds18b20_pin < 0 ? "brak czujnika" : num(st.fallback.room_c, 1) + " °C") +
                      ", zasilanie " + num(st.fallback.supply_c, 0) + " °C"
                    : "termostat rezerwowy") : "");
        }

        box.innerHTML = "<div class=\"history-measurements-wrapper\"><table class=\"history-measurements\"><tbody>" + rows + "</tbody></table></div>";
    }

    // temperatura zewnetrzna: domyslnie z prognozy/czujnika (pole wypelniane
    // wartoscia z symulacji); po zmianie przez uzytkownika symulacja liczy
    // dla wpisanej, "Z prognozy" wraca do zrodla z konfiguracji
    var outdoorEl = el("hs-outdoor");
    var outdoorResetEl = el("hs-outdoor-reset");
    var outdoorManual = false;

    outdoorEl.addEventListener("change", function () {
        outdoorManual = outdoorEl.value !== "";
        outdoorResetEl.hidden = !outdoorManual;
        loadState();
    });

    outdoorResetEl.addEventListener("click", function () {
        outdoorManual = false;
        outdoorResetEl.hidden = true;
        loadState();
    });

    // jedno zapytanie naraz (symulacja liczy sie ~1 s, a sterownik ma jeden
    // watek HTTP) i bez odpytywania, gdy karta jest ukryta
    var loading = false;
    var pending = false;

    function loadState() {

        if (loading) {
            pending = true;   // po zakonczeniu biezacego zapytania odswiez jeszcze raz
            return;
        }

        loading = true;

        var url = "/heating/sim" + (outdoorManual ? "?outdoor=" + encodeURIComponent(outdoorEl.value) : "");
        api(url).then(function (s) {
            if (s.error) {
                el("hs-summary").innerHTML = "<div class=\"history-empty\">Błąd: " + escapeHtml(s.error) + "</div>";
                return;
            }
            // nie nadpisujemy wartosci, ktora uzytkownik wlasnie wpisuje
            if (!outdoorManual && document.activeElement !== outdoorEl) {
                outdoorEl.value = s.outdoor_c;
            }
            renderSummary(s);
        }).catch(function () {
            el("hs-summary").innerHTML = "<div class=\"history-empty\">Błąd odczytu stanu.</div>";
        }).then(function () {
            loading = false;

            if (pending) {
                pending = false;
                loadState();
            }
        });
    }

    loadState();

    setInterval(function () {
        if (!document.hidden) {
            loadState();
        }
    }, 5000);

    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
            loadState();
        }
    });
})();
