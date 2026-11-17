(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    var CATEGORY_LABELS = {
        boot: "Restart",
        control_mode: "Tryb sterowania",
        work_mode: "Tryb pracy falownika",
        rule: "Reguła",
        event: "Zdarzenie",
        grid: "GRID (TOU)",
        sell_limit: "Limit sprzedaży",
        rooms: "Ogrzewanie",
        water_heater: "Ciepła woda",
        heating: "Centralne ogrzewanie",
        forecast: "Prognoza PV", devices: "Urządzenia", boiler: "Kocioł"
    };

    function categoryLabel(category) {
        return CATEGORY_LABELS[category] || category;
    }

    var PAGE_SIZE = 30;

    var contentEl = el("events-log-content");
    var filterEl = el("events-category-filter");
    var loadMoreWrapEl = el("events-load-more-wrap");
    var loadMoreButton = el("events-load-more");

    // loadedEvents - chronologicznie rosnaco (najstarszy pierwszy) -
    // kolejne strony ("Pokaz wczesniejsze", zawsze STARSZE niz juz
    // zaladowane) sa doklejane na POCZATEK, caly zbior jest odwracany
    // dopiero przy renderowaniu (najnowsze na gorze tabeli)
    var loadedEvents = [];
    var exhausted = false;
    var loading = false;

    function renderRow(event, key) {

        var hasData = event.data != null;

        return "<tr" + (hasData ? " data-event-toggle=\"" + key + "\" style=\"cursor:pointer\"" : "") + ">" +
            "<td>" + escapeHtml(event.at) + "</td>" +
            "<td>" + escapeHtml(categoryLabel(event.category)) + "</td>" +
            "<td>" + escapeHtml(event.message) +
            (hasData ? " <span class=\"settings-row-arrow\" data-event-arrow=\"" + key + "\">&#9662;</span>" : "") +
            "</td>" +
            "</tr>" +
            (hasData
                ? "<tr hidden data-event-details=\"" + key + "\"><td colspan=\"3\"><pre class=\"event-details\">" + escapeHtml(JSON.stringify(event.data, null, 2)) + "</pre></td></tr>"
                : "");
    }

    function renderEvents() {

        if (!loadedEvents.length) {
            contentEl.innerHTML = "<div class=\"history-empty\">Brak zdarzeń</div>";
            return;
        }

        // najnowsze pierwsze w tabeli - loadedEvents jest chronologicznie rosnaco
        var rows = loadedEvents.slice().reverse().map(function (event, idx) {
            return renderRow(event, String(idx));
        }).join("");

        contentEl.innerHTML = "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr><th>Czas</th><th>Kategoria</th><th>Zdarzenie</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
            "</table>" +
            "</div>";
    }

    function buildUrl(beforeTs) {

        var url = "/report/events?limit=" + PAGE_SIZE;

        if (filterEl.value) {
            url += "&category=" + encodeURIComponent(filterEl.value);
        }

        if (beforeTs != null) {
            url += "&before=" + beforeTs;
        }

        return url;
    }

    function updateLoadMoreVisibility() {
        loadMoreWrapEl.hidden = exhausted || !loadedEvents.length;
    }

    function loadInitial() {

        loadedEvents = [];
        exhausted = false;
        loading = true;

        contentEl.innerHTML = "Ładowanie&hellip;";
        loadMoreWrapEl.hidden = true;

        fetch(buildUrl(null))
            .then(function (r) { return r.json(); })
            .then(function (res) {
                loadedEvents = res.events || [];
                exhausted = loadedEvents.length < PAGE_SIZE;
                loading = false;
                renderEvents();
                updateLoadMoreVisibility();
            })
            .catch(function () {
                loading = false;
                contentEl.innerHTML = "<div class=\"history-empty\">Błąd wczytywania logu zdarzeń.</div>";
            });
    }

    function loadMore() {

        if (loading || exhausted || !loadedEvents.length) { return; }

        loading = true;
        loadMoreButton.disabled = true;

        var oldestTs = loadedEvents[0].ts;

        fetch(buildUrl(oldestTs))
            .then(function (r) { return r.json(); })
            .then(function (res) {

                var olderEvents = res.events || [];

                loadedEvents = olderEvents.concat(loadedEvents);
                exhausted = olderEvents.length < PAGE_SIZE;
                loading = false;
                loadMoreButton.disabled = false;

                renderEvents();
                updateLoadMoreVisibility();
            })
            .catch(function () {
                loading = false;
                loadMoreButton.disabled = false;
            });
    }

    filterEl.addEventListener("change", loadInitial);
    loadMoreButton.addEventListener("click", loadMore);

    contentEl.addEventListener("click", function (e) {

        var toggle = e.target.closest("[data-event-toggle]");

        if (!toggle) { return; }

        var key = toggle.getAttribute("data-event-toggle");
        var detailsEl = contentEl.querySelector("[data-event-details=\"" + key + "\"]");
        var arrowEl = contentEl.querySelector("[data-event-arrow=\"" + key + "\"]");

        detailsEl.hidden = !detailsEl.hidden;
        arrowEl.innerHTML = detailsEl.hidden ? "&#9662;" : "&#9652;";
    });

    // ==================================================
    // CZYSZCZENIE LOGU - usuwa TRWALE wpisy (opcjonalnie tylko
    // wybranego typu) starsze niz podana data+godzina (domyslnie
    // biezaca - patrz storage/event_log.py::clear())
    // ==================================================

    var clearCategoryEl = el("events-clear-category");
    var clearDateEl = el("events-clear-date");
    var clearTimeEl = el("events-clear-time");
    var clearButton = el("events-clear-button");
    var clearStatusEl = el("events-clear-status");

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    (function initClearDefaults() {
        var now = new Date();
        clearDateEl.value = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
        clearTimeEl.value = pad2(now.getHours()) + ":" + pad2(now.getMinutes());
    })();

    clearButton.addEventListener("click", function () {

        if (!clearDateEl.value) {
            clearStatusEl.textContent = "Podaj datę.";
            clearStatusEl.className = "settings-message error";
            return;
        }

        var category = clearCategoryEl.value;
        var before = clearDateEl.value + " " + (clearTimeEl.value || "23:59");
        var categoryLabelText = category ? categoryLabel(category) : "wszystkich typów";

        if (!window.confirm("Usunąć trwale wpisy (" + categoryLabelText + ") wcześniejsze niż " + before + "?")) {
            return;
        }

        clearButton.disabled = true;
        clearStatusEl.textContent = "Czyszczenie…";
        clearStatusEl.className = "settings-message";

        fetch("/report/events/clear", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: category || null, before: before })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {

                clearButton.disabled = false;

                if (res.error) {
                    clearStatusEl.textContent = "Błąd: " + res.error;
                    clearStatusEl.className = "settings-message error";
                    return;
                }

                clearStatusEl.textContent = "Usunięto wpisów: " + res.removed + ".";
                clearStatusEl.className = "settings-message";

                loadInitial();
            })
            .catch(function () {
                clearButton.disabled = false;
                clearStatusEl.textContent = "Błąd czyszczenia logu.";
                clearStatusEl.className = "settings-message error";
            });
    });

    loadInitial();
})();
