(function () {

    var refreshButton = document.getElementById("deye-registers-refresh-button");
    var status = document.getElementById("deye-registers-status");
    var groupsEl = document.getElementById("deye-registers-groups");

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function formatLabel(name) {
        return name.replace(/_/g, " ");
    }

    function formatValue(item) {

        if (item.value === null || item.value === undefined) {
            return "—";
        }

        var value = item.value;

        if (typeof value === "number") {
            value = (Math.round(value * 100) / 100).toString();
        }

        return escapeHtml(value) + (item.unit ? " " + escapeHtml(item.unit) : "");
    }

    function renderGroups(groups) {

        groupsEl.innerHTML = groups.map(function (group) {

            var rows = group.items.map(function (item) {
                return "<div class=\"info-row\">" +
                    "<dt>" + escapeHtml(formatLabel(item.name)) + "<br><small>" + escapeHtml(item.register) + "</small></dt>" +
                    "<dd>" + formatValue(item) + "</dd>" +
                    "</div>";
            }).join("");

            return "<section class=\"log-section\">" +
                "<div class=\"log-header\"><h2>" + escapeHtml(group.title) + "</h2></div>" +
                "<dl class=\"info-list\">" + rows + "</dl>" +
                "</section>";
        }).join("");
    }

    function refresh() {

        refreshButton.disabled = true;
        status.className = "settings-message";
        status.textContent = "Odczyt rejestrów...";

        fetch("/deye/registers")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (!res.ok) {
                    status.textContent = "Błąd: " + (res.error || "nieznany");
                    status.className = "settings-message error";
                    return;
                }

                renderGroups(res.groups);
                status.textContent = "Odczytano " + new Date().toLocaleTimeString();
                status.className = "settings-message success";
            })
            .catch(function () {
                status.textContent = "Błąd zapytania.";
                status.className = "settings-message error";
            })
            .then(function () {
                refreshButton.disabled = false;
            });
    }

    refreshButton.addEventListener("click", refresh);

    refresh();
})();
