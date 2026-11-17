(function () {
    var ssidEl = document.getElementById("wifi-current-ssid");
    var ipEl = document.getElementById("wifi-current-ip");
    var form = document.getElementById("wifi-config-form");
    var status = document.getElementById("wifi-config-status");

    function loadStatus() {
        fetch("/wifi/status")
            .then(function (r) { return r.json(); })
            .then(function (res) {
                ssidEl.textContent = res.ssid
                    ? (res.ssid + (res.connected ? " (połączono)" : " (rozłączono)"))
                    : "brak zapisanej sieci";
                ipEl.textContent = res.ip || "—";
            })
            .catch(function () {
                ssidEl.textContent = "błąd odczytu";
            });
    }

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        var data = {};
        new FormData(form).forEach(function (value, key) {
            data[key] = value;
        });

        status.className = "settings-message";
        status.textContent = "Łączenie... (może potrwać kilkanaście sekund)";

        fetch("/wifi/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res.saved) {
                    status.textContent = "Połączono i zapisano. Nowy adres IP: " + res.ip;
                    status.className = "settings-message success";
                    loadStatus();
                } else {
                    status.textContent = "Błąd: " + (res.error || "nieznany");
                    status.className = "settings-message error";
                }
            })
            .catch(function () {
                status.textContent = "Błąd połączenia z urządzeniem (być może właśnie zmieniło sieć).";
                status.className = "settings-message error";
            });
    });

    loadStatus();
})();
