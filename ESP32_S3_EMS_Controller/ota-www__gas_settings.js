// Taryfa gazowa (www/gas_settings.py): pola [data-cfg] z GET /report/gas ("config"), zapis
// POST /report/gas/config (storage/gas_store.py::save_config()).
(function () {

    function el(id) { return document.getElementById(id); }

    function fields() { return document.querySelectorAll("[data-cfg]"); }

    function fill(cfg) {
        Array.prototype.forEach.call(fields(), function (input) {
            input.value = cfg[input.getAttribute("data-cfg")];
        });
    }

    fetch("/report/gas").then(function (r) { return r.json(); }).then(function (d) { fill(d.config); }).catch(function () {
        el("gas-config-status").textContent = "Błąd odczytu ustawień.";
    });

    el("gas-config-save").addEventListener("click", function () {
        var data = {};
        Array.prototype.forEach.call(fields(), function (input) {
            data[input.getAttribute("data-cfg")] = input.getAttribute("data-text") ? input.value : Number(input.value);
        });
        el("gas-config-status").textContent = "Zapisywanie…";
        fetch("/report/gas/config", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
        }).then(function (r) { return r.json(); }).then(function (res) {
            el("gas-config-status").textContent = res.error ? "Błąd: " + res.error : "Zapisano.";
            if (!res.error) { fill(res.config); }
        }).catch(function () { el("gas-config-status").textContent = "Błąd zapisu."; });
    });
})();
