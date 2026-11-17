// Ustawienia dziennika zdarzen (www/events_settings.py): rodzaje wpisow pogrupowane wg kategorii,
// zaznaczone - zapisywane (GET/POST /report/events/settings, storage/event_log.py::TYPES).
(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    // jak filtr na ekranie Log zdarzen (www/events_log.py)
    var CATEGORY_LABELS = {
        boot: "Restarty", control_mode: "Tryb sterowania", work_mode: "Tryb pracy falownika",
        grid: "Tryb GRID (TOU)", sell_limit: "Limit sprzedaży", rule: "Reguły urządzeń",
        event: "Zdarzenia (webhooki)", rooms: "Ogrzewanie pomieszczeń", water_heater: "Ciepła woda użytkowa",
        heating: "Centralne ogrzewanie", forecast: "Prognoza PV", devices: "Urządzenia", boiler: "Kocioł"
    };

    var listEl = el("events-settings-list");
    var statusEl = el("events-settings-status");
    var saveBtn = el("events-settings-save");

    function setStatus(text, error) {
        statusEl.textContent = text;
        statusEl.className = "settings-message" + (error ? " error" : "");
    }

    function kb(bytes) {
        return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0).replace(".", ",") + " KB";
    }

    // ciezar rodzaju: ile wpisow na dobe i jaka czesc dziennika zajmuje (tyle krotszy bedzie
    // zapis dziennika na flash i o tyle dluzszy okres zmiesci sie w limicie wpisow)
    function weight(t, res) {
        if (!t.count) { return "brak wpisów w dzienniku"; }
        var days = res.span_s / 86400;
        var rate = days >= 0.04 ? t.count / days : null;
        var share = res.total_bytes ? t.bytes / res.total_bytes * 100 : 0;
        return (rate != null ? "ok. " + (rate < 10 ? rate.toFixed(1).replace(".", ",") : Math.round(rate)) + " wpisów na dobę · " : t.count + " wpisów · ") +
            Math.round(share) + "% dziennika (" + kb(t.bytes) + ")";
    }

    function render(res) {
        var types = res.types || [];
        var days = res.span_s / 86400;
        var html = "<div class=\"settings-hint\">Teraz w dzienniku: " + res.count + " wpisów, " + kb(res.total_bytes) +
            (days > 0 ? ", z ostatnich " + (days < 10 ? days.toFixed(1).replace(".", ",") : Math.round(days)) + " dni" : "") +
            ". Przy każdym rodzaju - ile wpisów dokłada i jaką część dziennika zajmuje.</div>";
        var group = null;

        types.forEach(function (t) {
            if (t.category !== group) {
                group = t.category;
                html += "<div class=\"settings-panel-title\" style=\"margin-top:14px; font-size:13px\">" +
                    escapeHtml(CATEGORY_LABELS[group] || group) + "</div>";
            }
            var id = "ev-type-" + t.key;
            html += "<div class=\"settings-row\"><div class=\"settings-row-text\"><label for=\"" + id + "\">" +
                escapeHtml(t.label) + "</label><div class=\"settings-hint\">" + escapeHtml(weight(t, res)) + "</div></div>" +
                "<input type=\"checkbox\" id=\"" + id + "\" data-type=\"" + t.key + "\"" + (t.enabled ? " checked" : "") + "></div>";
        });

        listEl.innerHTML = html;
    }

    function load() {
        fetch("/report/events/settings").then(function (r) { return r.json(); }).then(function (res) {
            render(res);
        }).catch(function () {
            listEl.innerHTML = "<div class=\"history-empty\">Błąd odczytu</div>";
        });
    }

    saveBtn.addEventListener("click", function () {
        var disabled = [];
        Array.prototype.forEach.call(listEl.querySelectorAll("[data-type]"), function (box) {
            if (!box.checked) { disabled.push(box.getAttribute("data-type")); }
        });

        saveBtn.disabled = true;
        setStatus("Zapisywanie…");

        fetch("/report/events/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ disabled: disabled })
        }).then(function (r) { return r.json(); }).then(function (res) {
            saveBtn.disabled = false;
            if (res.error) {
                setStatus(res.error === "busy" ? "Kontroler jest zajęty - spróbuj za chwilę." : "Błąd: " + res.error, true);
                return;
            }
            setStatus("Zapisano.");
        }).catch(function () {
            saveBtn.disabled = false;
            setStatus("Błąd zapisu.", true);
        });
    });

    load();
})();
