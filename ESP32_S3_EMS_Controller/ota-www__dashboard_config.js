(function () {

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

    // Etykiety kafli - MUSZA odpowiadac id-kom uzywanym w
    // www/dashboard.py (tile_html["mode"/"tariff"/"rce"/"battery"/"water"/"pv"/"load"/"schedule"])
    // i storage/dashboard_store.py::KNOWN_TILE_IDS.
    var TILE_LABELS = {
        mode: "Tryb pracy falownika (+ do kiedy trwa, następny stan)",
        tariff: "Aktualna strefa taryfowa + cena (+ bilans sprzedaży/zakupu)",
        rce: "Aktualna stawka RCE (+ min/max dziś)",
        battery: "Bateria (SOC, ładowanie/rozładowanie, prąd)",
        water: "Zasobnik CWU (temperatura, stan grzałki, zużycie dziś)",
        boiler: "Kocioł i dogrzewacz (źródło ciepła CO, tryb, temperatury, pompa)",
        pv: "Prognoza produkcji PV (do końca dnia, dziś, jutro)",
        load: "Prognoza zużycia (do końca dnia, dziś, jutro)",
        schedule: "Harmonogram pracy (tabela)"
    };

    var form = el("dashboard-config-form");
    var tilesList = el("dashboard-tiles-list");
    var statusEl = el("dashboard-config-status");

    var tiles = [];

    function renderTiles() {

        tilesList.innerHTML = tiles.map(function (tile, index) {
            return "<div class=\"settings-row\" data-index=\"" + index + "\">" +
                "<div class=\"settings-row-text\">" +
                "<label style=\"display:flex; align-items:center; gap:8px; font-weight:normal\">" +
                "<input type=\"checkbox\" class=\"dashboard-tile-visible\"" + (tile.visible ? " checked" : "") + "> " +
                escapeHtml(TILE_LABELS[tile.id] || tile.id) +
                "</label></div>" +
                "<div class=\"settings-row-buttons\">" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary\" data-move=\"up\"" + (index === 0 ? " disabled" : "") + ">↑</button>" +
                "<button type=\"button\" class=\"maintenance-button maintenance-button-secondary\" data-move=\"down\"" + (index === tiles.length - 1 ? " disabled" : "") + ">↓</button>" +
                "</div></div>";
        }).join("");
    }

    tilesList.addEventListener("click", function (e) {

        var move = e.target.getAttribute("data-move");

        if (!move) { return; }

        var row = e.target.closest("[data-index]");

        if (!row) { return; }

        var index = parseInt(row.getAttribute("data-index"), 10);

        if (move === "up" && index > 0) {
            var a = tiles[index - 1];
            tiles[index - 1] = tiles[index];
            tiles[index] = a;
            renderTiles();
        } else if (move === "down" && index < tiles.length - 1) {
            var b = tiles[index + 1];
            tiles[index + 1] = tiles[index];
            tiles[index] = b;
            renderTiles();
        }
    });

    tilesList.addEventListener("change", function (e) {

        if (!e.target.classList.contains("dashboard-tile-visible")) { return; }

        var row = e.target.closest("[data-index]");

        if (!row) { return; }

        tiles[parseInt(row.getAttribute("data-index"), 10)].visible = e.target.checked;
    });

    api("/dashboard/config").then(function (cfg) {

        tiles = ((cfg || {}).TILES || []).map(function (t) {
            return { id: t.id, visible: t.visible !== false };
        });
        renderTiles();
    }).catch(function () {
        statusEl.textContent = "Błąd wczytywania konfiguracji.";
        statusEl.className = "settings-message error";
    });

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        statusEl.className = "settings-message";
        statusEl.textContent = "Zapisywanie...";

        api("/dashboard/config", "POST", {
            TILES: tiles
        })
            .then(function (res) {

                if (res.error) {
                    statusEl.textContent = "Błąd: " + res.error;
                    statusEl.className = "settings-message error";
                    return;
                }

                statusEl.textContent = "Zapisano.";
                statusEl.className = "settings-message success";
            })
            .catch(function () {
                statusEl.textContent = "Błąd zapisu.";
                statusEl.className = "settings-message error";
            });
    });
})();
