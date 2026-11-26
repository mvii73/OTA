"use strict";

// Firmware huba Zigbee (ESP32-C6) na /config/zigbee: wersja (GET /zigbee/hub/firmware) i
// aktualizacja OTA przez sterownik - obraz z repo wydan (mvii73/OTA, katalog
// ESP32_C6_EMS_Zigbee/, budowany w GitHub Actions repo huba po tagu v*) albo plik .bin
// wybrany z dysku. Przegladarka wysyla obraz kawalkami (POST /zigbee/hub/ota/*), sterownik
// przekazuje go do huba przez UART (drivers/uart_zigbee.py::hub_ota_*()).
(function () {

    var OTA_PROJECT = "ESP32_C6_EMS_Zigbee";
    var OTA_BASE_URL = "https://raw.githubusercontent.com/mvii73/OTA/ota/" + OTA_PROJECT;
    var OTA_LATEST_URL = "https://api.github.com/repos/mvii73/OTA/contents/" + OTA_PROJECT + "/latest.json?ref=ota";
    var CHUNK_BYTES = 3072;           // base64 ~4 KB - limit body serwera 8 KB (core/server.py)
    var MAX_IMAGE_BYTES = 0x200000;

    function el(id) { return document.getElementById(id); }

    var infoEl = el("hub-fw-info");
    var messageEl = el("hub-fw-message");
    var progressEl = el("hub-fw-progress");
    var checkBtn = el("hub-fw-check");
    var updateBtn = el("hub-fw-update");
    var fileInput = el("hub-fw-file");
    var fileBtn = el("hub-fw-file-button");

    if (!infoEl) { return; }

    var hub = null;        // ostatnia odpowiedz GET /zigbee/hub/firmware
    var latest = null;     // {version, commit, manifest} + manifest
    var busy = false;

    function message(text, error) {
        messageEl.textContent = text || "";
        messageEl.className = "settings-message " + (error ? "error" : "success");
    }

    function postJson(url, data) {
        return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data || {})
        }).then(function (r) { return r.json(); });
    }

    function compareVersions(left, right) {
        function parse(value) {
            var match = String(value || "").match(/^v(\d+(?:\.\d+)*)(?:-(\d+)-g[0-9a-f]+)?(?:-dirty)?$/i);
            return match ? { parts: match[1].split(".").map(Number), ahead: Number(match[2] || 0) } : null;
        }
        var a = parse(left), b = parse(right);
        if (!a || !b) { return null; }
        for (var i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
            var diff = (a.parts[i] || 0) - (b.parts[i] || 0);
            if (diff) { return diff; }
        }
        return a.ahead - b.ahead;
    }

    function otaSupported() {
        return !!(hub && hub.firmware && hub.firmware.ota_slot_size > 0);
    }

    function renderInfo() {
        if (!hub) { infoEl.textContent = "Wczytywanie…"; return; }
        var fw = hub.firmware;
        if (!fw) {
            infoEl.textContent = hub.hub_ready ?
                "Hub nie podaje wersji - stary firmware bez aktualizacji OTA. Wgraj nowy przez USB (build_win.ps1 -Action flash)." :
                "Brak połączenia z hubem.";
        } else {
            infoEl.textContent = "Wersja " + (fw.version || "?") + " · slot " + (fw.partition || "?") +
                " · zbudowano " + (fw.build_date || "") + " " + (fw.build_time || "") +
                (fw.ota_slot_size > 0 ? "" : " · bez drugiego slotu - aktualizacja OTA niedostępna, wgraj firmware przez USB");
        }
        fileBtn.disabled = busy || !otaSupported();
        checkBtn.disabled = busy;
    }

    function loadHub(retries) {
        return fetch("/zigbee/hub/firmware", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (res) {
            hub = res;
            renderInfo();
            // pierwsze zapytanie wysyla do huba CMD_GET_HUB_INFO - odpowiedz za chwile
            if (!res.firmware && res.hub_ready && retries > 0) {
                return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(function () { return loadHub(retries - 1); });
            }
            return res;
        });
    }

    function checkLatest() {
        if (busy) { return; }
        updateBtn.hidden = true;
        message("Sprawdzam wydania huba…");
        fetch(OTA_LATEST_URL, { cache: "no-store" }).then(function (r) {
            if (!r.ok) { throw new Error(r.status === 404 ? "Brak opublikowanego wydania huba (latest.json)." : "Serwer wydań zwrócił HTTP " + r.status + "."); }
            return r.json();
        }).then(function (file) {
            var info = JSON.parse(atob(String(file.content || "").replace(/\s/g, "")));
            return fetch(OTA_BASE_URL + "/" + info.manifest + "?v=" + info.commit, { cache: "no-store" }).then(function (r) {
                if (!r.ok) { throw new Error("Nie udało się pobrać manifestu wydania."); }
                return r.json();
            }).then(function (manifest) {
                if (!manifest.firmware || !/^[0-9a-f]{64}$/i.test(manifest.firmware.sha256 || "") || manifest.chip !== "esp32c6") {
                    throw new Error("Manifest wydania huba jest nieprawidłowy.");
                }
                latest = { version: info.version, commit: info.commit, manifest: manifest };
                var installed = hub && hub.firmware ? hub.firmware.version : null;
                var cmp = compareVersions(latest.version, installed);
                if (installed && (latest.version === installed || (cmp !== null && cmp <= 0))) {
                    message("Brak nowszej wersji (najnowsza: " + latest.version + ").");
                    return;
                }
                message("Dostępna wersja " + latest.version + (installed ? " (zainstalowana: " + installed + ")" : "") + ".");
                updateBtn.textContent = "Aktualizuj do " + latest.version;
                updateBtn.hidden = !otaSupported();
            });
        }).catch(function (e) { message(e.message || String(e), true); });
    }

    function toBase64(bytes) {
        var s = "";
        for (var i = 0; i < bytes.length; i++) { s += String.fromCharCode(bytes[i]); }
        return btoa(s);
    }

    function waitForHub(version, deadline) {
        return new Promise(function (resolve) { setTimeout(resolve, 3000); }).then(function () {
            return fetch("/zigbee/hub/firmware", { cache: "no-store" }).then(function (r) { return r.json(); });
        }).then(function (res) {
            hub = res;
            if (res.firmware && (!version || res.firmware.version === version)) { return res; }
            if (Date.now() > deadline) { return res; }
            return waitForHub(version, deadline);
        }, function () {
            return Date.now() > deadline ? null : waitForHub(version, deadline);
        });
    }

    async function install(bytes, sha256, version) {
        busy = true;
        updateBtn.hidden = true;
        renderInfo();
        progressEl.hidden = false;
        progressEl.value = 0;
        try {
            if (bytes.length < 1024 || bytes[0] !== 0xE9) { throw new Error("To nie jest obraz aplikacji ESP (brak nagłówka 0xE9)."); }
            if (bytes.length > MAX_IMAGE_BYTES) { throw new Error("Plik jest za duży."); }
            var res = await postJson("/zigbee/hub/ota/begin", { size: bytes.length, sha256: sha256 || null });
            if (res.error) { throw new Error(res.error); }
            for (var offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
                var part = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length));
                res = await postJson("/zigbee/hub/ota/data", { offset: offset, data: toBase64(part) });
                if (res.error) { throw new Error(res.error); }
                progressEl.value = Math.round(100 * (offset + part.length) / bytes.length);
                message("Przesyłanie do huba: " + progressEl.value + "% (" + Math.round((offset + part.length) / 1024) + " z " + Math.round(bytes.length / 1024) + " KB)");
            }
            message("Hub sprawdza obraz…");
            res = await postJson("/zigbee/hub/ota/end", {});
            if (res.error) { throw new Error(res.error); }
            message("Hub uruchamia się ponownie z nowym firmware…");
            var after = await waitForHub(version, Date.now() + 90000);
            if (after && after.firmware) {
                message("Gotowe - hub działa w wersji " + after.firmware.version + " (slot " + after.firmware.partition + ").");
            } else {
                message("Hub jeszcze nie odpowiedział po restarcie - odśwież stronę za chwilę.", true);
            }
        } catch (e) {
            message("Aktualizacja przerwana: " + (e.message || e), true);
            postJson("/zigbee/hub/ota/abort", {}).catch(function () {});
        } finally {
            busy = false;
            progressEl.hidden = true;
            renderInfo();
        }
    }

    checkBtn.addEventListener("click", checkLatest);

    updateBtn.addEventListener("click", function () {
        if (!latest || busy) { return; }
        if (!confirm("Zaktualizować firmware huba Zigbee do " + latest.version + "? Na czas restartu (ok. 1 min) sieć Zigbee będzie niedostępna.")) { return; }
        var fw = latest.manifest.firmware;
        message("Pobieranie " + latest.version + "…");
        fetch(OTA_BASE_URL + "/" + fw.asset + "?v=" + latest.commit, { cache: "no-store" }).then(function (r) {
            if (!r.ok) { throw new Error("Nie udało się pobrać obrazu firmware."); }
            return r.arrayBuffer();
        }).then(function (buffer) {
            var bytes = new Uint8Array(buffer);
            if (bytes.length !== fw.size) { throw new Error("Pobrany obraz ma inny rozmiar niż w manifeście."); }
            return install(bytes, fw.sha256.toLowerCase(), latest.version);
        }).catch(function (e) { message(e.message || String(e), true); });
    });

    fileBtn.addEventListener("click", function () { if (!busy) { fileInput.click(); } });

    fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (!file) { return; }
        if (!confirm("Wgrać do huba plik " + file.name + " (" + Math.round(file.size / 1024) + " KB)? Na czas restartu sieć Zigbee będzie niedostępna.")) { return; }
        file.arrayBuffer().then(function (buffer) {
            return install(new Uint8Array(buffer), null, null);
        });
    });

    loadHub(3).then(function () { checkLatest(); }).catch(function () { infoEl.textContent = "Nie udało się odczytać stanu huba."; });
})();
