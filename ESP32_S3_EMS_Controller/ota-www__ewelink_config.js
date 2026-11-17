(function () {
    var form = document.getElementById("ewelink-config-form");
    var status = document.getElementById("ewelink-config-status");

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        var data = {};
        new FormData(form).forEach(function (value, key) {
            data[key] = value;
        });

        status.className = "settings-message";
        status.textContent = "Zapisywanie...";

        fetch("/ewelink/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                status.textContent = res.saved ? "Zapisano." : ("Błąd: " + (res.error || "nieznany"));
                status.className = "settings-message " + (res.saved ? "success" : "error");

                // pola sekretne - API zwraca tylko bool (czy ustawione)
                ["PASSWORD", "APP_SECRET"].forEach(function (key) {
                    if (res.saved && res.config && res.config[key]) {
                        form[key].value = "";
                        form[key].placeholder = "(zostaw puste, aby nie zmieniać)";
                    }
                });
            })
            .catch(function () {
                status.textContent = "Błąd zapisu.";
                status.className = "settings-message error";
            });
    });
})();
