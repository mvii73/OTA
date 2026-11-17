// Pulpit (www/dashboard.py) - przycisk "Odswiez" nad kaflami:
// przeladowuje strone i blokuje sie na LOCK_MS po kazdym odswiezeniu.
// Czas klikniecia idzie w adresie (?refreshed=<ms>) - przetrwa samo
// przeladowanie bez zadnego magazynu przegladarki (core/routes.py
// ignoruje nieznane parametry "/").
(function () {

    var LOCK_MS = 15000;

    var button = document.getElementById("dashboard-refresh-button");

    if (!button) {
        return;
    }

    var label = button.textContent;
    var refreshedAt = parseInt(new URLSearchParams(window.location.search).get("refreshed"), 10) || 0;

    function update() {

        var remainingMs = refreshedAt + LOCK_MS - Date.now();

        if (remainingMs > 0) {
            button.disabled = true;
            button.textContent = label + " (" + Math.ceil(remainingMs / 1000) + " s)";
            setTimeout(update, Math.min(1000, remainingMs));
            return;
        }

        button.disabled = false;
        button.textContent = label;
    }

    button.addEventListener("click", function () {

        if (button.disabled) {
            return;
        }

        button.disabled = true;
        button.textContent = "Odświeżanie...";
        window.location.href = window.location.pathname + "?refreshed=" + Date.now();
    });

    update();
})();

// Alerty-notyfikacje (#notifications, www/dashboard.py::notifications_html() -
// wpisy dziennika zdarzen z flaga notyfikacji, renderowane z reszta strony): "×"
// zamyka alert (POST /notifications/dismiss - czas zamkniecia we wpisie, wiecej sie
// nie pokazuje); odpowiedz niesie nowa zawartosc - ukryty starszy alert wskakuje
// na zwolnione miejsce (limit NOTIFY_MAX_VISIBLE z Parametrow EMS). Otwarta strona
// sprawdza alerty co POLL_MS (GET /notifications) - nowe pojawiaja sie bez
// przeladowania; nie przy ukrytej karcie ani w trakcie zamykania.
(function () {

    var POLL_MS = 60000;

    var box = document.getElementById("notifications");
    var closing = false;

    if (!box) {
        return;
    }

    function show(html) {
        if (box.innerHTML !== html) {
            box.innerHTML = html;
        }
    }

    setInterval(function () {

        if (document.hidden || closing) {
            return;
        }

        fetch("/notifications")
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!closing && typeof res.html === "string") {
                    show(res.html);
                }
            })
            .catch(function () {});
    }, POLL_MS);

    box.addEventListener("click", function (e) {

        var button = e.target.closest("[data-notification-close]");

        if (!button || button.disabled) {
            return;
        }

        button.disabled = true;
        closing = true;

        fetch("/notifications/dismiss", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nid: Number(button.getAttribute("data-notification-close")) })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                closing = false;
                if (typeof res.html !== "string") {
                    throw new Error("brak html");
                }
                show(res.html);
            })
            .catch(function () {
                closing = false;
                button.disabled = false;
            });
    });
})();

// Tresc kafli (www/dashboard.py::main() wysyla tylko szkielety
// [data-tile-ghost]): dociagana z GET /dashboard/tiles grupami, po JEDNEJ
// grupie naraz (serwer jest jednowatkowy) - od najtanszych do najdrozszych,
// zeby szybkie kafle pojawialy sie pierwsze. Blad grupy/kafla nie blokuje reszty.
// Kazdy kafel dostaje ikone odswiezenia: pobiera tylko ten kafel. Wszystkie
// zapytania ida jedno po drugim (kolejka), takze odswiezenia z ikon.
(function () {

    var GROUPS = [
        ["mode", "tariff", "rce", "battery"],
        ["water", "boiler"],
        ["pv"],
        ["load"],
        ["schedule"]
    ];

    var ERROR_HTML = '<section class="hero"><div class="hero-main"><div class="hero-text">' +
        '<div class="hero-status">Kafel niedostępny</div>' +
        '<div class="hero-sub">Nie udało się pobrać danych - spróbuj ikoną odświeżenia.</div></div></div></section>';

    var queue = Promise.resolve();

    function enqueue(task) {
        queue = queue.then(task, task);
        return queue;
    }

    function tileElements(id) {
        return Array.prototype.slice.call(document.querySelectorAll(
            '[data-tile="' + id + '"],[data-tile-ghost="' + id + '"]'));
    }

    function refreshButton(id) {

        var button = document.createElement("button");

        button.type = "button";
        button.className = "tile-refresh";
        button.title = "Odśwież kafel";
        button.setAttribute("data-tile-refresh", id);
        button.innerHTML = '<span class="material-symbols-outlined">refresh</span>';

        return button;
    }

    // podmienia szkielet / poprzednia tresc kafla na nowa (pierwszy element dostaje ikone)
    function mount(id, html) {

        var old = tileElements(id);

        if (!old.length) {
            return;
        }

        var box = document.createElement("div");
        box.innerHTML = html || "";

        // zwijane sekcje (details[data-collapsible]) zostaja rozwiniete po odswiezeniu kafla
        var wasOpen = old.some(function (el) { return el.open === true; });

        var mounted = [];

        Array.prototype.slice.call(box.children).forEach(function (node, i) {

            node.setAttribute("data-tile", id);

            if (wasOpen && node.hasAttribute && node.hasAttribute("data-collapsible")) {
                node.open = true;
            }

            if (i === 0) {
                // w zwijanej sekcji ikona idzie do <summary>, bo reszta details jest ukryta
                var host = (node.hasAttribute && node.hasAttribute("data-collapsible") && node.querySelector("summary")) || node;
                host.appendChild(refreshButton(id));
            }

            old[0].parentNode.insertBefore(node, old[0]);
            mounted.push(node);
        });

        old.forEach(function (el) { el.parentNode.removeChild(el); });

        // zaczepy kafli z trescia dociaganą osobno (np. wykres ogrzewania) - dostaja
        // wstawiony element i kolejke zapytan
        (window.__dashboardTileHooks || []).forEach(function (hook) {
            mounted.forEach(function (node) { hook(node, enqueue); });
        });
    }

    function load(ids) {

        return fetch("/dashboard/tiles?ids=" + ids.join(","))
            .then(function (r) { return r.json(); })
            .then(function (res) {
                ids.forEach(function (id) {
                    mount(id, (res.tiles || {})[id] === undefined ? ERROR_HTML : res.tiles[id]);
                });
            })
            .catch(function () {
                ids.forEach(function (id) { mount(id, ERROR_HTML); });
            });
    }

    function pending() {
        return GROUPS.map(function (group) {
            return group.filter(function (id) {
                return document.querySelector('[data-tile-ghost="' + id + '"]');
            });
        }).filter(function (ids) { return ids.length; });
    }

    pending().forEach(function (ids) {
        enqueue(function () { return load(ids); });
    });

    document.addEventListener("click", function (e) {

        var button = e.target.closest("[data-tile-refresh]");

        if (!button) {
            return;
        }

        // ikona w <summary> nie moze zwijac/rozwijac sekcji
        e.preventDefault();

        if (button.classList.contains("is-spinning")) {
            return;
        }

        button.classList.add("is-spinning");

        var id = button.getAttribute("data-tile-refresh");

        enqueue(function () { return load([id]); });
    });

    // odswiezenie jednego kafla z zewnatrz (przyciski akcji nizej) - jak ikona odswiezenia
    window.__dashboardRefreshTile = function (id) {

        tileElements(id).forEach(function (el) {
            var icon = el.querySelector("[data-tile-refresh]");
            if (icon) { icon.classList.add("is-spinning"); }
        });

        return enqueue(function () { return load([id]); });
    };
})();

// Przyciski akcji w kaflach (www/dashboard.py::_mode_switch_html()/
// _device_toggle_html()) - po udanej akcji przeladowanie strony, zeby
// kafle pokazaly nowy stan; wlacz/wylacz urzadzenia - odswiezenie tylko
// jego kafla (zmiana nie dotyczy innych kafli).
(function () {

    function post(url, body) {
        return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }).then(function (r) { return r.json(); });
    }

    function run(button, request, reloadDelayMs, tileOnly) {

        var label = button.textContent;

        button.disabled = true;
        button.textContent = "...";

        request.then(function (res) {

            if (res && (res.error || res.ok === false)) {
                throw new Error(res.error || "not_confirmed");
            }

            // urzadzenia Zigbee potwierdzaja zmiane stanu asynchronicznie
            // (C6 -> UART -> raport), wiec natychmiastowe odswiezenie
            // pokazaloby jeszcze stary stan - patrz www/relay_control.js
            var tile = tileOnly && button.closest("[data-tile]");

            setTimeout(function () {
                if (tile && window.__dashboardRefreshTile) {
                    window.__dashboardRefreshTile(tile.getAttribute("data-tile"));
                } else {
                    window.location.href = window.location.pathname;
                }
            }, reloadDelayMs || 0);

        }).catch(function (e) {
            button.disabled = false;
            button.textContent = label;
            alert("Nie udało się: " + e.message);
        });
    }

    function closeMenus(except) {
        Array.prototype.forEach.call(document.querySelectorAll(".hero-menu"), function (menu) {
            if (menu !== except) {
                menu.hidden = true;
            }
        });
    }

    document.addEventListener("click", function (e) {

        var toggle = e.target.closest("[data-menu-toggle]");

        if (toggle) {
            var menu = toggle.parentNode.querySelector(".hero-menu");
            closeMenus(menu);
            menu.hidden = !menu.hidden;
            return;
        }

        var modeItem = e.target.closest("[data-work-mode]");

        if (modeItem && !modeItem.disabled) {
            run(modeItem, post("/ems/manualMode", { mode: modeItem.getAttribute("data-work-mode") }));
            return;
        }

        // ogrzewanie na zadanie (kafel "Ogrzewanie", www/dashboard.py::_on_demand_button_html()):
        // start pyta o liczbe godzin, po ktorych wraca sterowanie standardowe
        var onDemand = e.target.closest("[data-on-demand]");

        if (onDemand && !onDemand.disabled) {

            if (onDemand.getAttribute("data-on-demand") === "cancel") {
                run(onDemand, post("/heating/on-demand", { cancel: true }), 300);
                return;
            }

            var answer = window.prompt("Na ile godzin włączyć ogrzewanie? Po tym czasie wróci sterowanie standardowe.", "2");

            if (answer === null) {
                return;
            }

            var hours = parseFloat(String(answer).replace(",", "."));

            if (!(hours >= 0.25 && hours <= 24)) {
                alert("Podaj liczbę godzin od 0,25 do 24.");
                return;
            }

            // model sterowania: data-modes = "klucz=etykieta|klucz=etykieta" (te same modele co w
            // konfiguracji, tylko mozliwe do uzycia), data-default = biezacy model; przy jednym
            // mozliwym nie pytamy
            var modes = (onDemand.getAttribute("data-modes") || "").split("|").filter(Boolean).map(function (item) {
                var parts = item.split("=");
                return { key: parts[0], label: parts.slice(1).join("=") };
            });

            var mode = modes.length ? modes[0].key : undefined;

            if (modes.length > 1) {

                var defaultIndex = 0;

                modes.forEach(function (m, i) {
                    if (m.key === onDemand.getAttribute("data-default")) { defaultIndex = i; }
                });

                var choice = window.prompt("Wg którego modelu sterowania ogrzewać?\n" + modes.map(function (m, i) {
                    return (i + 1) + " - " + m.label;
                }).join("\n"), String(defaultIndex + 1));

                if (choice === null) {
                    return;
                }

                var index = parseInt(choice, 10) - 1;

                if (!(index >= 0 && index < modes.length)) {
                    alert("Wybierz numer z listy (1-" + modes.length + ").");
                    return;
                }

                mode = modes[index].key;
            }

            run(onDemand, post("/heating/on-demand", { hours: hours, mode: mode }), 300);
            return;
        }

        var deviceButton = e.target.closest("[data-device-toggle]");

        if (deviceButton && !deviceButton.disabled) {
            run(deviceButton, post(
                "/device/schedule/devices/" + encodeURIComponent(deviceButton.getAttribute("data-device-toggle")) + "/onOff",
                { state: deviceButton.getAttribute("data-state") === "1" }
            ), 2500, true);
            return;
        }

        if (!e.target.closest(".hero-menu")) {
            closeMenus(null);
        }
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            closeMenus(null);
        }
    });
})();
