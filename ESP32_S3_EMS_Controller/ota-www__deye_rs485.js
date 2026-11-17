(function () {

    var rs485RegisterInput = document.getElementById("deye-rs485-register");
    var rs485Status = document.getElementById("deye-rs485-status");
    var rs485TestButton = document.getElementById("deye-rs485-test-button");
    var rs485WriteRegisterInput = document.getElementById("deye-rs485-write-register");
    var rs485WriteValueInput = document.getElementById("deye-rs485-write-value");
    var rs485WriteStatus = document.getElementById("deye-rs485-write-status");
    var rs485WriteButton = document.getElementById("deye-rs485-write-button");
    var rs485ScanButton = document.getElementById("deye-rs485-scan-button");
    var rs485TimingTestButton = document.getElementById("deye-rs485-timing-test-button");
    var compareButton = document.getElementById("deye-compare-button");
    var compareResult = document.getElementById("deye-compare-result");

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    // =====================================================
    // WYBOR KONWERTERA (GET/POST /deye/rs485/converter)
    // =====================================================

    var converterSelect = document.getElementById("deye-rs485-converter");
    var converterStatus = document.getElementById("deye-rs485-converter-status");

    function converterLabel(c) {
        return c.name + " - TX GPIO" + c.tx + ", RX GPIO" + c.rx + ", EN GPIO" + c.en;
    }

    function renderConverters(res) {
        converterSelect.innerHTML = res.converters.map(function (c) {
            return "<option value=\"" + escapeHtml(c.id) + "\">" + escapeHtml(c.id + ": " + converterLabel(c)) + "</option>";
        }).join("");
        converterSelect.value = res.active || res.selected;
    }

    fetch("/deye/rs485/converter")
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.ok) {
                renderConverters(res);
            }
        });

    converterSelect.addEventListener("change", function () {

        converterStatus.className = "settings-message";
        converterStatus.textContent = "Przełączanie...";

        fetch("/deye/rs485/converter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ converter: converterSelect.value })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.ok) {
                    converterStatus.textContent = "Błąd: " + (res.error || "nieznany");
                    converterStatus.className = "settings-message error";
                    return;
                }
                renderConverters(res);
                converterStatus.textContent = "Aktywny konwerter " + res.active + " - uruchom test odczytu.";
                converterStatus.className = "settings-message success";
            })
            .catch(function () {
                converterStatus.textContent = "Błąd połączenia";
                converterStatus.className = "settings-message error";
            });
    });

    // =====================================================
    // POROWNAJ (CLOUD VS RS485)
    // =====================================================

    function formatMetricValue(v) {
        if (v === null || v === undefined) { return "—"; }
        if (typeof v === "number") { return (Math.round(v * 100) / 100).toString(); }
        return String(v);
    }

    // "ok" (zielony) - praktycznie identyczne (odchylenie <=0.5%, min.
    // 1 jednostka). "warn" (żółty) - w granicach 2% - liczniki dobowe z
    // Deye Cloud i RS485 moga sie odczytac w rozne sekundy, wiec drobna
    // roznica przy zywej telemetrii to NIE blad mapowania rejestru,
    // tylko naturalny "jitter". "bad" (czerwony) - poza tym zakresem,
    // realna rozbieznosc (zly adres/skala rejestru). null - brakuje
    // ktorejs z wartosci (nie da sie porownac).
    function matchStatus(a, b) {
        if (a === null || a === undefined || b === null || b === undefined) { return null; }

        if (typeof a === "number" && typeof b === "number") {

            var base = Math.max(Math.abs(a), Math.abs(b), 1);
            var diff = Math.abs(a - b);

            if (diff <= base * 0.005) { return "ok"; }
            if (diff <= base * 0.02) { return "warn"; }
            return "bad";
        }

        return a === b ? "ok" : "bad";
    }

    // =====================================================
    // TEST POLACZENIA RS485
    // =====================================================

    rs485TestButton.addEventListener("click", function () {

        rs485Status.className = "settings-message";
        rs485Status.textContent = "Odpytywanie...";

        fetch("/deye/rs485/test_read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ register: rs485RegisterInput.value })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (res.ok) {
                    rs485Status.textContent = "OK - " + res.register + " = " + res.value;
                    rs485Status.className = "settings-message success";
                } else {
                    rs485Status.textContent = "Błąd: " + (res.error || "nieznany") +
                        (res.slave !== undefined ? " (slave " + res.slave + ")" : "");
                    rs485Status.className = "settings-message error";
                }
            })
            .catch(function () {
                rs485Status.textContent = "Błąd zapytania.";
                rs485Status.className = "settings-message error";
            });
    });

    rs485WriteButton.addEventListener("click", function () {

        var register = rs485WriteRegisterInput.value;
        var value = rs485WriteValueInput.value;

        if (!register || !value) {
            rs485WriteStatus.textContent = "Podaj rejestr i wartość.";
            rs485WriteStatus.className = "settings-message error";
            return;
        }

        if (!window.confirm("To NAPRAWDĘ zapisze wartość " + value + " do rejestru " + register + " na falowniku. Kontynuować?")) {
            return;
        }

        rs485WriteStatus.className = "settings-message";
        rs485WriteStatus.textContent = "Zapisywanie...";

        fetch("/deye/rs485/test_write", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ register: register, value: value })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (res.ok) {
                    rs485WriteStatus.textContent = "Zapisano " + res.register + " = " + res.written +
                        " · odczyt zwrotny: " + res.read_back + (res.verified ? " (OK)" : " (NIEZGODNY!)");
                    rs485WriteStatus.className = "settings-message " + (res.verified ? "success" : "error");
                } else {
                    rs485WriteStatus.textContent = "Błąd: " + (res.error || "nieznany");
                    rs485WriteStatus.className = "settings-message error";
                }
            })
            .catch(function () {
                rs485WriteStatus.textContent = "Błąd zapytania.";
                rs485WriteStatus.className = "settings-message error";
            });
    });

    // =====================================================
    // SKAN ADRESOW / TEST EN - kazdy z wlasnym polem wyniku pod
    // przyciskiem i wlasnym "Kopiuj log"
    // =====================================================

    function copyText(text, button) {

        var originalLabel = button.textContent;

        function showCopied() {
            button.textContent = "Skopiowano!";
            setTimeout(function () { button.textContent = originalLabel; }, 1500);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(showCopied).catch(function () {
                button.textContent = "Błąd kopiowania.";
            });
            return;
        }

        // fallback dla starszych WebView bez Clipboard API
        var helper = document.createElement("textarea");
        helper.value = text;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();

        try {
            document.execCommand("copy");
            showCopied();
        } catch (e) {
            button.textContent = "Błąd kopiowania.";
        }

        document.body.removeChild(helper);
    }

    function logTest(button, url, logId, copyId, pendingText) {

        var log = document.getElementById(logId);
        var copyButton = document.getElementById(copyId);

        copyButton.addEventListener("click", function () {
            copyText(log.textContent || "", copyButton);
        });

        button.addEventListener("click", function () {

            button.disabled = true;
            log.style.display = "block";
            log.textContent = pendingText;
            copyButton.style.display = "none";

            fetch(url, { method: "POST" })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    log.textContent = res.log || "Brak wyniku.";
                    copyButton.style.display = "inline-block";
                })
                .catch(function () {
                    log.textContent = "Błąd zapytania.";
                })
                .then(function () {
                    button.disabled = false;
                });
        });
    }

    logTest(rs485ScanButton, "/deye/rs485/scan_slaves", "deye-rs485-scan-log",
        "deye-rs485-scan-copy-button", "Skanowanie adresów slave (0-10)...");

    logTest(rs485TimingTestButton, "/deye/rs485/en_timing_test", "deye-rs485-timing-log",
        "deye-rs485-timing-copy-button", "Test w toku...");

    compareButton.addEventListener("click", function () {

        compareButton.disabled = true;
        compareResult.innerHTML = "<div class=\"settings-hint\">Porównywanie...</div>";

        fetch("/deye/compare")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (!res.ok) {
                    compareResult.innerHTML = "<div class=\"settings-message error\">Błąd: " + escapeHtml(res.error || "nieznany") + "</div>";
                    return;
                }

                var STATUS_META = {
                    ok: { label: "OK", color: "#16a34a" },
                    warn: { label: "ROZBIEŻNOŚĆ (w tolerancji)", color: "#eab308" },
                    bad: { label: "ROZBIEŻNOŚĆ", color: "#b91c1c" }
                };

                var rows = res.items.map(function (item) {

                    var meta;

                    if (item.register === null) {
                        meta = { label: "brak rejestru", color: "#888" };
                    } else if (item.cloud === null || item.cloud === undefined) {
                        // Rejestr bez znanego odpowiednika w Deye Cloud - tylko
                        // podglad zdekodowanej wartosci RS485, bez porownania.
                        meta = { label: "tylko RS485", color: "#2563eb" };
                    } else if (item.rs485 === null || item.rs485 === undefined) {
                        meta = { label: "brak odczytu RS485", color: "#888" };
                    } else {
                        meta = STATUS_META[matchStatus(item.cloud, item.rs485)];
                    }

                    return "<tr>" +
                        "<td>" + escapeHtml(item.key) + "</td>" +
                        "<td>" + escapeHtml(item.register || "—") + "</td>" +
                        "<td>" + escapeHtml(formatMetricValue(item.cloud)) + "</td>" +
                        "<td>" + escapeHtml(formatMetricValue(item.rs485)) + "</td>" +
                        "<td style=\"color:" + meta.color + "\">" + escapeHtml(meta.label) + "</td>" +
                        "</tr>";
                }).join("");

                compareResult.innerHTML =
                    "<div class=\"history-measurements-wrapper\">" +
                    "<table class=\"history-measurements\">" +
                    "<thead><tr><th>Metryka</th><th>Rejestr</th><th>Cloud</th><th>RS485</th><th>Status</th></tr></thead>" +
                    "<tbody>" + rows + "</tbody>" +
                    "</table></div>";
            })
            .catch(function () {
                compareResult.innerHTML = "<div class=\"settings-message error\">Błąd zapytania.</div>";
            })
            .then(function () {
                compareButton.disabled = false;
            });
    });
})();
