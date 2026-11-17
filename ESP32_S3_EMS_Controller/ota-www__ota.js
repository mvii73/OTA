"use strict";

// Aktualizacja aplikacji OTA (jak w ESP32_C3_LD2410C) - strona /config/software,
// urzadzenie: core/ota.py, paczka: tools/build_ota.py (GitHub Actions, tag v*).

(function () {

    var OTA_PROJECT = "ESP32_S3_EMS_Controller";
    var OTA_BASE_URL = "https://raw.githubusercontent.com/mvii73/OTA/ota/" + OTA_PROJECT;
    // latest.json przez API (raw.githubusercontent.com cache'uje do 5 min)
    var OTA_LATEST_URL = "https://api.github.com/repos/mvii73/OTA/contents/" +
        OTA_PROJECT + "/latest.json?ref=ota";

    var CHUNK_BYTES = 3072;      // base64 ~4 KB - limit body serwera 8 KB (core/server.py)
    var HASH_BATCH = 30;         // core/ota.py::MAX_HASH_PATHS = 40
    var MAX_FILE_BYTES = 262144;

    function el(id) { return document.getElementById(id); }

    var checkButton = el("ota-check-button");
    var updateButton = el("ota-update-button");
    var title = el("ota-update-title");
    var message = el("ota-update-message");
    var progress = el("ota-progress");

    var deviceInfo = null;

    function compareVersions(left, right) {

        function parse(value) {
            var match = String(value || "").match(/^v?(\d+(?:\.\d+)*)(?:-(\d+)-g[0-9a-f]+)?$/i);
            if (!match) {
                return null;
            }
            return { parts: match[1].split(".").map(Number), ahead: Number(match[2] || 0) };
        }

        var a = parse(left);
        var b = parse(right);
        if (!a || !b) {
            return null;
        }

        var count = Math.max(a.parts.length, b.parts.length);
        for (var i = 0; i < count; i++) {
            var diff = (a.parts[i] || 0) - (b.parts[i] || 0);
            if (diff) {
                return diff;
            }
        }
        return a.ahead - b.ahead;
    }

    function postJson(url, data) {
        return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data || {})
        }).then(function (r) {
            if (!r.ok) {
                throw new Error(url + ": HTTP " + r.status);
            }
            return r.json();
        }).then(function (res) {
            if (res && res.error) {
                var err = new Error(res.error + (res.path ? " (" + res.path + ")" : ""));
                err.code = res.error;
                throw err;
            }
            return res;
        });
    }

    function toBase64(bytes) {
        var text = "";
        for (var i = 0; i < bytes.length; i += 1024) {
            text += String.fromCharCode.apply(null, bytes.subarray(i, i + 1024));
        }
        return btoa(text);
    }

    function setProgress(value) {
        progress.hidden = value === null;
        if (value !== null) {
            progress.value = value;
        }
    }

    function loadDeviceInfo() {
        return fetch("/ota/info", { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (info) {
                deviceInfo = info;
                el("ota-installed-version").textContent =
                    (info.version || "nieznana (brak build_info.py)") + (info.dirty ? " (zmiany lokalne)" : "");
                el("ota-installed-build").textContent =
                    (info.commit || "—") + (info.created_at ? " · " + info.created_at : "");
                el("ota-firmware").textContent = (info.micropython || "?") +
                    (info.mpy_version ? " · .mpy v" + info.mpy_version.join(".") : "");
                el("ota-free").textContent = info.free_bytes !== null && info.free_bytes !== undefined
                    ? Math.round(info.free_bytes / 1024) + " KB" : "—";
                return info;
            });
    }

    function validManifest(manifest, latest) {
        var pathRe = /^[A-Za-z0-9_.\/-]+$/;
        return manifest.version === latest.version &&
            manifest.commit === latest.commit &&
            Array.isArray(manifest.files) && manifest.files.length > 0 &&
            Array.isArray(manifest.remove) &&
            manifest.files.length + manifest.remove.length <= 400 &&
            manifest.files.every(function (f) {
                return f && typeof f.path === "string" && pathRe.test(f.path) &&
                    f.path.indexOf("..") < 0 && f.path !== "config.py" &&
                    typeof f.asset === "string" && /^[A-Za-z0-9_.-]+$/.test(f.asset) &&
                    /^[0-9a-f]{64}$/i.test(f.sha256 || "") &&
                    Number.isInteger(f.size) && f.size > 0 && f.size <= MAX_FILE_BYTES;
            }) &&
            manifest.remove.every(function (p) {
                return typeof p === "string" && pathRe.test(p) && /\.py$/.test(p) && p.indexOf("/") > 0;
            });
    }

    function check() {

        checkButton.disabled = true;
        checkButton.textContent = "Sprawdzanie…";
        updateButton.hidden = true;
        title.textContent = "Sprawdzam dostępność aktualizacji";
        message.textContent = "Łączenie z serwerem wydań…";

        var latest = null;

        Promise.all([
            loadDeviceInfo(),
            fetch(OTA_LATEST_URL, { cache: "no-store" })
        ]).then(function (results) {
            var response = results[1];
            if (!response.ok) {
                throw new Error(response.status === 404
                    ? "Nie znaleziono opublikowanego wydania (latest.json)."
                    : "Serwer wydań zwrócił HTTP " + response.status + ".");
            }
            return response.json();
        }).then(function (file) {
            if (file.encoding !== "base64" || typeof file.content !== "string") {
                throw new Error("Odpowiedź GitHub API nie zawiera latest.json.");
            }
            latest = JSON.parse(atob(file.content.replace(/\s/g, "")));

            if (!latest.version || latest.manifest !== "ota-manifest.json" ||
                !/^[0-9a-f]{64}$/i.test(latest.manifest_sha256 || "")) {
                throw new Error("Plik latest.json jest nieprawidłowy.");
            }

            var installed = deviceInfo.version;
            var cmp = compareVersions(latest.version, installed);

            if (latest.version === installed || (cmp !== null && cmp <= 0)) {
                title.textContent = "Brak nowszej wersji";
                message.textContent = "Najnowsze wydanie: " + latest.version +
                    " · zainstalowana: " + (installed || "nieznana") + ".";
                return null;
            }

            return fetch(OTA_BASE_URL + "/" + latest.manifest + "?v=" + latest.commit, { cache: "no-store" })
                .then(function (r) {
                    if (!r.ok) {
                        throw new Error("Nie udało się pobrać manifestu aktualizacji.");
                    }
                    return r.arrayBuffer();
                })
                .then(function (buffer) {
                    var bytes = new Uint8Array(buffer);
                    var manifest = JSON.parse(new TextDecoder().decode(bytes));

                    if (!validManifest(manifest, latest)) {
                        throw new Error("Manifest aktualizacji jest nieprawidłowy.");
                    }

                    var dm = deviceInfo.mpy_version;
                    var pm = manifest.mpy_version;
                    if (!dm || !pm || dm[0] !== pm[0] || dm[1] !== pm[1]) {
                        title.textContent = "Aktualizacja wymaga instalacji przez USB";
                        message.textContent = "Wydanie " + latest.version + " ma format .mpy v" +
                            (pm || []).join(".") + ", a MicroPython na sterowniku przyjmuje v" +
                            (dm || []).join(".") + ".";
                        return;
                    }

                    title.textContent = "Dostępna aktualizacja";
                    message.textContent = "Nowa wersja: " + latest.version +
                        " · zainstalowana: " + (installed || "nieznana") + ".";
                    updateButton.hidden = false;
                    updateButton.onclick = function () {
                        install(latest, manifest, bytes);
                    };
                });
        }).catch(function (error) {
            console.error("OTA check:", error);
            title.textContent = "Nie udało się sprawdzić aktualizacji";
            message.textContent = error.message;
        }).then(function () {
            checkButton.disabled = false;
            checkButton.textContent = "Sprawdź aktualizacje";
        });
    }

    function uploadBytes(path, bytes, sha256, onChunk) {

        var offset = 0;

        function next() {
            if (offset >= bytes.length) {
                return Promise.resolve();
            }
            var end = Math.min(offset + CHUNK_BYTES, bytes.length);
            return postJson("/ota/upload", {
                path: path,
                offset: offset,
                size: bytes.length,
                sha256: sha256,
                final: end === bytes.length,
                data: toBase64(bytes.subarray(offset, end))
            }).then(function () {
                if (onChunk) {
                    onChunk(end - offset);
                }
                offset = end;
                return next();
            });
        }

        return next();
    }

    async function changedFiles(manifest) {

        var changed = [];

        for (var i = 0; i < manifest.files.length; i += HASH_BATCH) {
            var batch = manifest.files.slice(i, i + HASH_BATCH);
            var res = await postJson("/ota/hashes", {
                paths: batch.map(function (f) { return f.path; })
            });
            batch.forEach(function (f) {
                if ((res.hashes[f.path] || "") !== f.sha256.toLowerCase()) {
                    changed.push(f);
                }
            });
            message.textContent = "Porównywanie plików… " +
                Math.min(i + HASH_BATCH, manifest.files.length) + "/" + manifest.files.length;
        }

        return changed;
    }

    async function install(latest, manifest, manifestBytes) {

        if (!window.confirm("Zainstalować wersję " + latest.version +
            "? Sterownik uruchomi się ponownie. Ustawienia i historia pozostaną bez zmian.")) {
            return;
        }

        updateButton.disabled = true;
        checkButton.disabled = true;
        var installSent = false;

        try {
            await postJson("/ota/start");

            var changed = await changedFiles(manifest);
            var total = changed.reduce(function (sum, f) { return sum + f.size; }, 0) || 1;
            var sent = 0;

            title.textContent = "Wgrywanie " + latest.version;
            setProgress(0);

            for (var i = 0; i < changed.length; i++) {
                var file = changed[i];
                message.textContent = "Plik " + (i + 1) + "/" + changed.length + ": " + file.path;

                var response = await fetch(OTA_BASE_URL + "/" + file.asset + "?v=" + latest.commit,
                    { cache: "no-store" });
                if (!response.ok) {
                    throw new Error("Nie udało się pobrać " + file.asset + ".");
                }
                var bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.length !== file.size) {
                    throw new Error("Nieprawidłowy rozmiar " + file.asset + ".");
                }

                await uploadBytes(file.path, bytes, file.sha256, function (n) {
                    sent += n;
                    setProgress(Math.round(sent * 100 / total));
                });
            }

            message.textContent = "Wgrywanie manifestu…";
            await uploadBytes("ota-manifest.json", manifestBytes, latest.manifest_sha256.toLowerCase());

            title.textContent = "Instalowanie " + latest.version;
            message.textContent = "Sprawdzanie plików i podmiana (kilka sekund)…";
            setProgress(null);

            installSent = true;
            var result = await postJson("/ota/install", { manifest_sha256: latest.manifest_sha256 });

            title.textContent = "Zainstalowano " + result.version;
            message.textContent = "Sterownik uruchamia się ponownie. Czekam na potwierdzenie wersji…";
            updateButton.hidden = true;

            var confirmed = await waitForVersion(latest.version);
            title.textContent = confirmed ? "Uruchomiono prawidłowo" : "Nie potwierdzono aktualizacji";
            message.textContent = confirmed
                ? "Sterownik działa w wersji " + confirmed + "."
                : "Nie udało się potwierdzić wersji " + latest.version +
                  " po restarcie. Odśwież stronę za chwilę i sprawdź wersję.";
            loadDeviceInfo().catch(function () {});

        } catch (error) {
            console.error("OTA install:", error);
            setProgress(null);
            if (!installSent) {
                try { await postJson("/ota/abort"); } catch (e) { /* bez znaczenia */ }
            }
            title.textContent = "Aktualizacja nie powiodła się";
            message.textContent = error.message;
            updateButton.disabled = false;
        } finally {
            checkButton.disabled = false;
        }
    }

    async function waitForVersion(target) {

        for (var attempt = 0; attempt < 45; attempt++) {
            await new Promise(function (resolve) { setTimeout(resolve, 4000); });
            try {
                var r = await fetch("/ota/info", { cache: "no-store" });
                if (!r.ok) {
                    continue;
                }
                var info = await r.json();
                if (info.version === target && !info.restart_pending) {
                    return info.version;
                }
            } catch (e) {
                // sterownik sie restartuje
            }
        }
        return null;
    }

    checkButton.addEventListener("click", check);
    loadDeviceInfo().catch(function () {
        el("ota-installed-version").textContent = "błąd odczytu";
    });
})();
