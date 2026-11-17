// Wykresy parametrow ogrzewania na zakladce Wykresy ekranu Ogrzewanie mieszkania
// (www/heating_home.py): GET /heating/history (ems/heating_history.py) i wykresy SVG z wybranych
// wartosci. Kazdy wykres to lista kluczy z katalogu (catalog()) - temperatury, pomieszczenia, kociol,
// dogrzewacz, zasobnik CWU; linie o tej samej jednostce na wspolnej osi, kazda jednostka na osobnym
// panelu, stany 0/1 (plomien, pompy...) jako paski pod ostatnim. Liste wykresow, zakres (6/12/24 h) i
// wybor wartosci trzyma www/heating_home.js.
(function () {

    var W = 600, PAD_L = 38, PAD_R = 8;
    var HOURS = 6;               // domyslny zakres (GET /heating/history przyjmuje 0,25-24 h)

    // kolory wyraznie rozne (czerwony, fioletowy, pomaranczowy, morski, niebieski, brazowy); "zasilanie
    // zadane" w kolorze tekstu i JAKO JEDYNE przerywane (ostatni element: przerywana?)
    var TEMPS = [
        ["supply_target_c", "zasilanie zadane", "currentColor", true],
        ["boiler_supply_c", "zasilanie z kotła (odczyt)", "#dc2626", false],
        ["boiler_return_c", "powrót z kotła (odczyt)", "#7c3aed", false],
        ["heater_supply_c", "zasilanie z dogrzewacza (czujnik)", "#f97316", false],
        ["heater_return_c", "powrót do dogrzewacza (czujnik)", "#0d9488", false],
        ["common_supply_c", "zasilanie wspólne (czujnik)", "#2563eb", false],
        ["common_return_c", "powrót wspólny (czujnik)", "#92400e", false]
    ];

    // kolory linii bez wlasnego (pomieszczenia) i zastepcze, gdy kolor juz zajety na tym wykresie;
    // po ostatnim od poczatku, wtedy przerywane
    var PALETTE = ["#dc2626", "#2563eb", "#16a34a", "#f97316", "#7c3aed", "#0d9488", "#92400e", "#db2777", "#ca8a04", "#475569"];

    // jednostki osi: c - autoskala jak temperatury, pct - 0-100, kw/n - od zera do szczytu
    var UNITS = { c: "°C", pct: "%", kw: "kW", n: "" };

    // katalog wartosci (grupy listy wyboru): [klucz serii z historii, nazwa, kolor, przerywana?, jednostka
    // | "state", krotka etykieta paska stanu (miesci sie w PAD_L)]
    var GROUPS = [
        { title: "Temperatury ogrzewania", items: TEMPS.map(function (s) { return [s[0], s[1], s[2], s[3], "c"]; }) },
        { title: "Kocioł gazowy", items: [
            ["boiler_mod_pct", "modulacja palnika (0-100%)", "#dc2626", false, "pct"],
            ["flame", "płomień kotła", "#dc2626", false, "state", "płomień"]
        ] },
        { title: "Dogrzewacz elektryczny", items: [
            ["demand_kw", "zapotrzebowanie na moc (kW)", "#0f766e", false, "kw"],
            ["heater_on", "dogrzewacz włączony", "#16a34a", false, "state", "dogrz."],
            ["pump_on", "pompa obiegowa włączona", "#2563eb", false, "state", "pompa"]
        ] },
        { title: "Zasobnik CWU", items: [
            ["tank_target_c", "temperatura zadana zasobnika", "currentColor", true, "c"],
            ["tank_temp_c", "temperatura wody w zasobniku", "#ea580c", false, "c"],
            ["tank_heater_on", "grzałka zasobnika włączona", "#ea580c", false, "state", "grzałka"],
            ["circ_pump_on", "pompa cyrkulacyjna pracowała", "#16a34a", false, "state", "cyrk."]
        ] },
        { title: "Inne", items: [
            ["outdoor_c", "temperatura zewnętrzna", "#0891b2", false, "c"],
            ["room_temp_c", "średnia temperatura pomieszczeń", "#16a34a", false, "c"],
            ["rooms_calling", "liczba grzejących pomieszczeń", "#475569", false, "n"]
        ] }
    ];

    var ITEMS = {};
    GROUPS.forEach(function (g) { g.items.forEach(function (item) { ITEMS[item[0]] = item; }); });

    // pomieszczenia: "rooms" - wszystkie (temperatura sterujaca), "room:<id>:<czesc>" - jedna linia
    var ROOM_PREFIX = "room:", ALL_ROOMS = "rooms";
    var ROOM_PARTS = [["control", "sterująca"], ["sensor", "czujnik"], ["trv", "głowica"]];

    // poczatkowe wykresy (dawny widok "Wszystkie"), dopoki uzytkownik nie zmieni listy
    function defaultCharts() {
        return [
            { title: "Temperatury", keys: TEMPS.map(function (s) { return s[0]; }) },
            { title: "Temperatury pomieszczeń", keys: [ALL_ROOMS] },
            { title: "Kocioł gazowy", keys: ["boiler_mod_pct", "flame"] },
            { title: "Dogrzewacz elektryczny", keys: ["demand_kw", "heater_on", "pump_on"] },
            { title: "Zasobnik CWU", keys: ["tank_target_c", "tank_temp_c", "tank_heater_on", "circ_pump_on"] }
        ];
    }

    function hasData(values) {
        return (values || []).some(function (v) { return v !== null && v !== undefined; });
    }

    // znaczniki z ESP32 licza sekundy od 2000-01-01 (MicroPython), Date - od 1970. Bez przesuniecia
    // data wypadala 30 lat wczesniej, w innym ukladzie niedziel, i przegladarka stosowala zla zmiane
    // czasu (pazdziernik 2026: godzina za duzo do 27.10, jak w 1996)
    var EPOCH_OFFSET = 946684800;

    function pad2(n) { return (n < 10 ? "0" : "") + n; }

    function toDate(ts) {
        return new Date((ts + EPOCH_OFFSET) * 1000);
    }

    function hhmm(ts) {
        var d = toDate(ts);
        return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }

    // sciezka z przerwami w miejscach braku odczytu
    function path(t, values, xOf, yOf) {

        var d = "", pen = false;

        for (var i = 0; i < t.length; i++) {

            if (values[i] === null || values[i] === undefined) {
                pen = false;
                continue;
            }

            d += (pen ? "L" : "M") + xOf(t[i]).toFixed(1) + " " + yOf(values[i]).toFixed(1);
            pen = true;
        }

        return d;
    }

    function scale(lists, fallbackMin, fallbackMax) {

        var low = Infinity, high = -Infinity;

        lists.forEach(function (values) {
            (values || []).forEach(function (v) {
                if (v !== null && v !== undefined) {
                    low = Math.min(low, v);
                    high = Math.max(high, v);
                }
            });
        });

        if (low === Infinity) {
            return [fallbackMin, fallbackMax];
        }

        if (high - low < 4) {
            var mid = (high + low) / 2;
            low = mid - 2;
            high = mid + 2;
        }

        var margin = (high - low) * 0.08;

        // zakres podzielny przez 4 - podzialka (4 odcinki) w pelnych stopniach
        low = Math.floor(low - margin);

        return [low, low + Math.ceil((Math.ceil(high + margin) - low) / 4) * 4];
    }

    // os od zera do szczytu: 4 odcinki po wielokrotnosci "step" (kW - 0,5, liczba - 1)
    function peakRange(lists, step) {
        var peak = 0;
        lists.forEach(function (values) {
            values.forEach(function (v) { if (v !== null && v !== undefined && v > peak) { peak = v; } });
        });
        return [0, Math.ceil(Math.max(peak, step * 2) / 4 / step) * step * 4];
    }

    function grid(top, bottom, low, high, unit, yOf) {

        var svg = "";

        for (var i = 0; i <= 4; i++) {
            var v = low + (high - low) * i / 4;
            svg += '<line x1="' + PAD_L + '" x2="' + (W - PAD_R) + '" y1="' + yOf(v).toFixed(1) + '" y2="' + yOf(v).toFixed(1) +
                '" stroke="currentColor" stroke-opacity="0.12"/>' +
                '<text x="' + (PAD_L - 4) + '" y="' + (yOf(v) + 3).toFixed(1) + '" font-size="10" text-anchor="end" fill="currentColor" fill-opacity="0.7">' +
                String(Math.round(v * 10) / 10).replace(".", ",") + '</text>';
        }

        return svg + '<text x="2" y="' + (top - 4) + '" font-size="10" fill="currentColor" fill-opacity="0.7">' + unit + '</text>';
    }

    // podzialka na pelnych godzinach (granice godzin w czasie polskim i UTC sa wspolne); skrajne
    // etykiety wyrownane do krawedzi, zeby nie byly uciete
    function timeAxis(t0, t1, y, xOf) {

        // co ile godzin etykieta czasu - przy 24 h co godzine nachodzilyby na siebie
        var tickS = Math.max(1, Math.ceil((t1 - t0) / 3600 / 8)) * 3600;
        var svg = "";

        for (var ts = Math.ceil(t0 / tickS) * tickS; ts <= t1; ts += tickS) {
            var x = xOf(ts);
            var anchor = x < PAD_L + 15 ? "start" : (x > W - PAD_R - 15 ? "end" : "middle");
            svg += '<text x="' + x.toFixed(1) + '" y="' + y + '" font-size="10" text-anchor="' + anchor + '" fill="currentColor" fill-opacity="0.7">' + hhmm(ts) + '</text>';
        }

        return svg;
    }

    function legend(items) {
        return '<div class="hero-chart-legend">' + items.map(function (item) {
            var swatch = item.dashed
                ? '<i class="dashed" style="border-top-color:' + item.color + ';"></i>'
                : '<i style="background:' + item.color + ';"></i>';
            return '<span>' + swatch + item.label + '</span>';
        }).join("") + '</div>';
    }

    function rooms(data) { return (data && data.rooms) || []; }

    // temperatura sterujaca pracy glowicy ("control": glowica albo czujnik w pomieszczeniu);
    // pomieszczenie bez glowicy - czujnik
    function controlTemps(room) {
        return room.control === "trv" ? room.trv : room.sensor;
    }

    // klucze wykresu -> linie {key, values, label, color, dashed, unit, short}; tylko z danymi,
    // kazda raz (np. "rooms" i jedno pomieszczenie z osobna)
    function resolve(data, keys) {

        var out = [], seen = {};

        function add(line) {
            if (seen[line.key] || !hasData(line.values)) { return; }
            seen[line.key] = true;
            out.push(line);
        }

        function roomLine(room, part, label) {
            var values = part === "control" ? controlTemps(room) : room[part];
            add({ key: ROOM_PREFIX + room.id + ":" + part, values: values, label: label, unit: "c" });
        }

        keys.forEach(function (key) {

            if (key === ALL_ROOMS) {
                rooms(data).forEach(function (r) { roomLine(r, "control", r.name); });
                return;
            }

            if (key.indexOf(ROOM_PREFIX) === 0) {
                var cut = key.lastIndexOf(":"), id = key.slice(ROOM_PREFIX.length, cut), part = key.slice(cut + 1);
                var room = rooms(data).filter(function (r) { return r.id === id; })[0];
                var partName = ROOM_PARTS.filter(function (p) { return p[0] === part; })[0];
                if (room && partName) { roomLine(room, part, room.name + " – " + partName[1] + (part !== "control" && room.control === part ? " (steruje)" : "")); }
                return;
            }

            var item = ITEMS[key];
            if (item) {
                add({ key: key, values: data.series[key], label: item[1], color: item[2], dashed: item[3], unit: item[4], short: item[5] });
            }
        });

        // kolor wlasny, gdy jeszcze wolny na tym wykresie; pozostale - kolejne wolne z palety (po
        // wszystkie zajete - powtorzony, przerywany); "currentColor" (zadane) zawsze wlasny
        var used = {}, next = 0;

        out.forEach(function (l) {
            if (l.color && l.color !== "currentColor" && used[l.color]) { l.color = null; }
            if (l.color) { used[l.color] = true; }
        });

        out.forEach(function (l) {
            if (l.color) { return; }
            var tries = 0;
            while (used[PALETTE[next % PALETTE.length]] && tries < PALETTE.length) { next++; tries++; }
            if (tries >= PALETTE.length) { l.dashed = true; }
            l.color = PALETTE[next % PALETTE.length];
            used[l.color] = true;
            next++;
        });

        return out;
    }

    // jeden panel SVG: linie jednej jednostki (moga byc puste) i paski stanu (tylko w ostatnim)
    function panel(data, t0, t1, unit, lines, states, aria) {

        function xOf(ts) { return PAD_L + (ts - t0) / (t1 - t0) * (W - PAD_L - PAD_R); }

        var top = lines.length ? 14 : 0;
        var bottom = !lines.length ? 0 : (unit === "c" ? 178 : 100);
        var H = bottom + 22 + states.length * 14;
        var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + aria + '">';

        if (lines.length) {

            var lists = lines.map(function (l) { return l.values; });
            var range = unit === "c" ? scale(lists, 0, 60) : unit === "pct" ? [0, 100] : peakRange(lists, unit === "kw" ? 0.5 : 1);

            var yOf = function (v) { return bottom - (v - range[0]) / (range[1] - range[0]) * (bottom - top); };

            svg += grid(top, bottom, range[0], range[1], UNITS[unit], yOf);

            // pierwsza linia rysowana na koncu (na wierzchu); linie cienkie (1,1 px), przerywane 1,3 px
            lines.slice().reverse().forEach(function (l) {
                svg += '<path d="' + path(data.t, l.values, xOf, yOf) + '" fill="none" stroke="' + l.color +
                    '" stroke-width="' + (l.dashed ? 1.3 : 1.1) + '"' + (l.dashed ? ' stroke-dasharray="5 4"' : "") + '/>';
            });
        }

        svg += timeAxis(t0, t1, bottom + 14, xOf);

        states.forEach(function (s, row) {

            var y = bottom + 22 + row * 14;

            svg += '<text x="' + (PAD_L - 4) + '" y="' + (y + 8) + '" font-size="9" text-anchor="end" fill="currentColor" fill-opacity="0.7">' +
                s.short + '</text>';

            for (var i = 0; i < data.t.length; i++) {
                if (s.values[i] === 1) {
                    var x0 = xOf(data.t[i]);
                    var x1 = i + 1 < data.t.length ? xOf(data.t[i + 1]) : x0 + (W - PAD_L - PAD_R) * data.step_s / (t1 - t0);
                    svg += '<rect x="' + x0.toFixed(1) + '" y="' + y + '" width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="10" fill="' + s.color + '"/>';
                }
            }
        });

        return svg + "</svg>";
    }

    // wykres z kluczy "keys": panel na kazda jednostke (w kolejnosci wyboru), paski stanu pod ostatnim,
    // jedna legenda; bez danych - ""
    function chartHtml(data, t0, t1, keys, title) {

        var all = resolve(data, keys);
        var states = all.filter(function (l) { return l.unit === "state"; });
        var units = [], byUnit = {};

        all.forEach(function (l) {
            if (l.unit === "state") { return; }
            if (!byUnit[l.unit]) { byUnit[l.unit] = []; units.push(l.unit); }
            byUnit[l.unit].push(l);
        });

        if (!all.length) { return ""; }
        if (!units.length) { units.push(null); }

        var aria = String(title || "Wykres").replace(/"/g, "");
        var html = units.map(function (unit, i) {
            return panel(data, t0, t1, unit, unit ? byUnit[unit] : [], i === units.length - 1 ? states : [], aria);
        }).join("");

        return html + legend(units.reduce(function (acc, u) { return acc.concat(u ? byUnit[u] : []); }, []).concat(states));
    }

    // grupy listy wyboru wartosci: [{title, items: [[klucz, nazwa]]}] - pomieszczenia z historii (data)
    function catalog(data) {

        var groups = GROUPS.map(function (g) {
            return { title: g.title, items: g.items.map(function (item) { return [item[0], item[1]]; }) };
        });

        var roomItems = [[ALL_ROOMS, "wszystkie pomieszczenia (temperatura sterująca)"]];

        rooms(data).forEach(function (r) {
            ROOM_PARTS.forEach(function (p) { roomItems.push([ROOM_PREFIX + r.id + ":" + p[0], r.name + " – " + p[1]]); });
        });

        groups.splice(1, 0, { title: "Pomieszczenia", items: roomItems });

        return groups;
    }

    // [t0, t1] zakresu "hours" i podpis o krotszej historii; null - za malo danych
    function timeRange(data, hours) {

        if (!data || !data.t || data.t.length < 2) { return null; }

        var t1 = Math.max(data.now || 0, data.t[data.t.length - 1]);
        var t0 = t1 - (hours || HOURS) * 3600;

        // historia zbiera sie od uruchomienia sterowania - gdy nie siega HOURS wstecz, lewa
        // czesc osi jest pusta i mowi o tym podpis
        var note = data.t[0] > t0 + 2 * (data.step_s || 300)
            ? "Historia od " + hhmm(data.t[0]) + " (zbierana co " + Math.round((data.step_s || 300) / 60) + " min od uruchomienia sterowania)"
            : "";

        return { t0: t0, t1: t1, note: note };
    }

    // historia z ostatnich "hours" godzin (dane do chartHtml)
    function fetchHistory(hours) {
        return fetch("/heating/history?hours=" + (hours || HOURS)).then(function (r) { return r.json(); });
    }

    window.__heatingChart = { chartHtml: chartHtml, catalog: catalog, defaultCharts: defaultCharts, timeRange: timeRange, fetchHistory: fetchHistory };
})();
