(function () {
    var form = document.getElementById("tapo-config-form");
    var status = document.getElementById("tapo-config-status");

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        var data = {};
        new FormData(form).forEach(function (value, key) {
            data[key] = value;
        });

        status.className = "settings-message";
        status.textContent = "Zapisywanie...";

        fetch("/tapo/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                status.textContent = res.saved ? "Zapisano." : ("Błąd: " + (res.error || "nieznany"));
                status.className = "settings-message " + (res.saved ? "success" : "error");
            })
            .catch(function () {
                status.textContent = "Błąd zapisu.";
                status.className = "settings-message error";
            });
    });
})();
