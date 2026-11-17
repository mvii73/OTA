(function () {
    var form = document.getElementById("ems-params-form");
    var status = document.getElementById("ems-params-status");
    var info = document.getElementById("ems-params-info");

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function num(v, digits) {
        return v == null ? "–" : Number(v).toFixed(digits).replace(".", ",");
    }

    function infoRow(label, value) {
        return "<div class=\"settings-row\"><div class=\"settings-row-text\"><label>" + escapeHtml(label) +
            "</label></div><div>" + escapeHtml(value) + "</div></div>";
    }

    function renderInfo(res) {
        var i = res.info || {};
        // czesci rezerwy wg strefy taryfy - kazda zwalniana powyzej swojego progu RCE
        var parts = (i.parts || []).map(function (p) {
            return infoRow("Rezerwa – " + (p.zone || "bez taryfy"),
                num(p.kwh, 1) + " kWh, sprzedaż przy RCE > " + num(p.threshold_pln, 2) + " zł/kWh netto");
        }).join("");
        info.innerHTML =
            infoRow("Start produkcji PV", i.pv_start || "poza horyzontem prognozy") +
            parts +
            infoRow("Zostaje w baterii przy zwykłej cenie", num(i.reserve_kwh, 1) + " kWh ponad minimalny SOC");
    }

    function load() {
        fetch("/ems/params")
            .then(function (r) { return r.json(); })
            .then(renderInfo)
            .catch(function () { info.innerHTML = "<div class=\"history-empty\">Błąd odczytu</div>"; });
    }

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        var data = {};
        new FormData(form).forEach(function (value, key) {
            data[key] = value;
        });

        status.className = "settings-message";
        status.textContent = "Zapisywanie...";

        fetch("/ems/params", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                status.textContent = res.saved ? "Zapisano." : ("Błąd: " + (res.error || "nieznany"));
                status.className = "settings-message " + (res.saved ? "success" : "error");
                if (res.saved) { renderInfo(res); }
            })
            .catch(function () {
                status.textContent = "Błąd zapisu.";
                status.className = "settings-message error";
            });
    });

    load();
})();
