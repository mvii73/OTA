"use strict";

const OTA_BASE_URL =
    "https://raw.githubusercontent.com/mvii73/OTA/ota/ESP32_C3_LD2410C";
const OTA_LATEST_URL =
    "https://api.github.com/repos/mvii73/OTA/contents/" +
    "ESP32_C3_LD2410C/latest.json?ref=ota";


function getOtaElement(id) {
    return document.getElementById(id);
}


function compareReleaseVersions(left, right) {

    function parse(value) {
        const match = String(value || "").match(
            /^v?(\d+(?:\.\d+)*)(?:-(\d+)-g[0-9a-f]+)?$/i
        );
        if (!match) {
            return null;
        }

        return {
            parts: match[1].split(".").map(Number),
            commitsAhead: Number(match[2] || 0),
        };
    }

    const a = parse(left);
    const b = parse(right);
    if (!a || !b) {
        return null;
    }

    const count = Math.max(a.parts.length, b.parts.length);
    for (let index = 0; index < count; index++) {
        const difference =
            (a.parts[index] || 0) - (b.parts[index] || 0);
        if (difference) {
            return difference;
        }
    }

    return a.commitsAhead - b.commitsAhead;
}


async function checkForAppUpdate(manualCheck) {

    const panel = getOtaElement("ota-update");
    const button = getOtaElement("ota-update-button");
    const message = getOtaElement("ota-update-message");
    const title = getOtaElement("ota-update-title");
    const checkButton = getOtaElement("check-app-updates");

    if (!panel || !button || !message) {
        return;
    }

    if (manualCheck) {
        checkButton.disabled = true;
        checkButton.textContent = "Sprawdzanie…";
        panel.hidden = false;
        title.textContent = "Sprawdzam dostępność aktualizacji";
        message.textContent = "Łączenie z serwerem wydań…";
        button.hidden = true;
    }

    try {
        const [deviceResponse, releaseResponse] = await Promise.all([
            fetch("/device-info", { cache: "no-store" }),
            fetch(OTA_LATEST_URL, { cache: "no-store" }),
        ]);

        if (!deviceResponse.ok) {
            throw new Error("Nie udało się odczytać wersji czujnika.");
        }
        if (!releaseResponse.ok) {
            throw new Error(
                releaseResponse.status === 404
                    ? "Nie znaleziono manifestu OTA. Sprawdź publikację pakietu."
                    : "Serwer aktualizacji zwrócił HTTP " + releaseResponse.status + "."
            );
        }

        const deviceInfo = await deviceResponse.json();
        const latestFile = await releaseResponse.json();
        if (
            latestFile.encoding !== "base64" ||
            typeof latestFile.content !== "string"
        ) {
            throw new Error("Odpowiedź GitHub API nie zawiera pliku latest.json.");
        }
        const latestContent = atob(latestFile.content.replace(/\s/g, ""));
        const latest = JSON.parse(latestContent);
        const installedVersion =
            deviceInfo.application && deviceInfo.application.github_version;
        const latestVersion = latest.version;

        if (!latestVersion) {
            throw new Error("Manifest najnowszej wersji jest nieprawidłowy.");
        }

        const comparison =
            compareReleaseVersions(latestVersion, installedVersion);
        if (
            latestVersion === installedVersion ||
            (comparison !== null && comparison <= 0)
        ) {
            if (manualCheck) {
                panel.hidden = false;
                title.textContent = "Brak nowszej wersji";
                message.textContent =
                    "Zainstalowana wersja: " + (installedVersion || "nieznana") + ".";
                button.hidden = true;
            } else {
                panel.hidden = true;
            }
            return;
        }

        if (latest.manifest !== "ota-manifest.json") {
            throw new Error("Manifest OTA wskazuje nieprawidłowy plik.");
        }

        const manifestResponse =
            await fetch(OTA_BASE_URL + "/" + latest.manifest, {
                cache: "no-store",
            });
        if (!manifestResponse.ok) {
            throw new Error("Nie udało się pobrać manifestu aktualizacji.");
        }

        const manifest = await manifestResponse.json();
        if (
            manifest.version !== latestVersion ||
            manifest.commit !== latest.commit ||
            !Array.isArray(manifest.files) ||
            !Array.isArray(manifest.remove) ||
            manifest.files.length + manifest.remove.length > 32 ||
            manifest.files.some(function(file) {
                return !file ||
                    typeof file.path !== "string" ||
                    typeof file.asset !== "string" ||
                    !/^[a-zA-Z0-9_.-]+$/.test(file.asset) ||
                    !/^[0-9a-f]{64}$/i.test(file.sha256 || "") ||
                    !Number.isInteger(file.size) ||
                    file.size < 1 ||
                    file.size > 65536;
            }) ||
            manifest.remove.some(function(path) {
                return typeof path !== "string" ||
                    !/^[a-zA-Z0-9_]+\.py$/.test(path) ||
                    ["main.py", "boot.py", "build_info.py", "config.py"].includes(path);
            })
        ) {
            throw new Error("Manifest aktualizacji jest nieprawidłowy.");
        }

        const deviceMpyVersion =
            deviceInfo.controller &&
            deviceInfo.controller.firmware &&
            deviceInfo.controller.firmware.mpy_version;
        const compatible =
            Array.isArray(deviceMpyVersion) &&
            Array.isArray(manifest.mpy_version) &&
            deviceMpyVersion.length === 2 &&
            manifest.mpy_version.length === 2 &&
            deviceMpyVersion[0] === manifest.mpy_version[0] &&
            deviceMpyVersion[1] === manifest.mpy_version[1];

        panel.hidden = false;
        if (!compatible) {
            title.textContent = "Aktualizacja wymaga instalacji przez USB";
            message.textContent =
                "Wersja wymaga innego formatu MicroPython .mpy.";
            button.hidden = true;
            return;
        }

        title.textContent = "Dostępna aktualizacja";
        message.textContent =
            "Wersja " + latestVersion + " jest dostępna (zainstalowana: " +
            (installedVersion || "nieznana") + ").";
        button.textContent = "Aktualizuj";
        button.hidden = false;
        button.onclick = function() {
            installAppUpdate(latestVersion, manifest);
        };
    } catch (error) {
        console.error("OTA update check failed:", error);
        if (manualCheck) {
            panel.hidden = false;
            title.textContent = "Nie udało się sprawdzić aktualizacji";
            message.textContent = error.message;
            button.hidden = true;
        }
    } finally {
        if (manualCheck) {
            checkButton.disabled = false;
            checkButton.textContent = "Sprawdź aktualizacje";
        }
    }
}


async function installAppUpdate(version, manifest) {

    const button = getOtaElement("ota-update-button");
    const message = getOtaElement("ota-update-message");

    if (!window.confirm(
        "Zainstalować wersję " + version +
        "? Ustawienia i historia czujnika pozostaną bez zmian."
    )) {
        return;
    }

    button.disabled = true;
    let installSubmitted = false;
    let installResponseReceived = false;

    try {
        const startResponse = await fetch("/ota-start", { method: "POST" });
        if (!startResponse.ok) {
            throw new Error("Nie można rozpocząć aktualizacji na urządzeniu.");
        }

        for (let fileIndex = 0; fileIndex < manifest.files.length; fileIndex++) {
            const file = manifest.files[fileIndex];
            if (
                typeof file.asset !== "string" ||
                !/^[a-zA-Z0-9_.-]+$/.test(file.asset) ||
                file.size > 65536
            ) {
                throw new Error("Brak pliku aktualizacji lub przekroczony limit.");
            }

            const response = await fetch(OTA_BASE_URL + "/" + file.asset, {
                cache: "no-store",
            });
            if (!response.ok) {
                throw new Error("Nie udało się pobrać " + file.asset + ".");
            }

            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length !== file.size) {
                throw new Error("Nieprawidłowy rozmiar pliku " + file.asset + ".");
            }

            if (window.crypto && window.crypto.subtle) {
                const hash = await window.crypto.subtle.digest("SHA-256", bytes);
                const actualHash = Array.from(new Uint8Array(hash))
                    .map(function(value) {
                        return value.toString(16).padStart(2, "0");
                    })
                    .join("");
                if (actualHash !== file.sha256) {
                    throw new Error("Nieprawidłowa suma kontrolna " + file.asset + ".");
                }
            }

            for (let offset = 0; offset < bytes.length; offset += 2048) {
                const end = Math.min(offset + 2048, bytes.length);
                const query = new URLSearchParams({
                    path: file.path,
                    offset: String(offset),
                    size: String(bytes.length),
                    sha256: file.sha256,
                    final: end === bytes.length ? "1" : "0",
                });
                const uploadResponse = await fetch(
                    "/ota-upload?" + query.toString(),
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/octet-stream" },
                        body: bytes.slice(offset, end),
                    }
                );
                if (!uploadResponse.ok) {
                    const detail = await uploadResponse.json();
                    throw new Error(
                        "Błąd wgrywania " + file.path + ": " +
                        (detail.error || uploadResponse.status)
                    );
                }
            }

            message.textContent =
                "Pobrano " + (fileIndex + 1) + " z " +
                manifest.files.length + " plików…";
        }

        installSubmitted = true;
        const installResponse = await fetch("/ota-install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(manifest),
        });
        installResponseReceived = true;
        const result = await installResponse.json();
        if (!installResponse.ok) {
            throw new Error(result.error || "Instalacja nie powiodła się.");
        }

        const title = getOtaElement("ota-update-title");
        button.hidden = true;
        title.textContent = "Aktualizacja zgłoszona";
        message.textContent =
            "Czujnik uruchamia się ponownie. Czekam na potwierdzenie wersji…";

        const installedVersion = await waitForInstalledVersion(version);
        if (installedVersion) {
            title.textContent = "Aktualizacja zakończona";
            message.textContent =
                "Czujnik działa już w wersji " + installedVersion + ".";
        } else {
            title.textContent = "Nie potwierdzono aktualizacji";
            message.textContent =
                "Nie udało się potwierdzić wersji " + version +
                " po ponownym uruchomieniu. Odśwież stronę i sprawdź wersję urządzenia.";
        }
    } catch (error) {
        console.error("OTA update failed:", error);
        if (!installSubmitted || installResponseReceived) {
            try {
                await fetch("/ota-abort", { method: "POST" });
            } catch (abortError) {
                console.warn("OTA staging cleanup failed:", abortError);
            }
        }


        message.textContent = installSubmitted && !installResponseReceived
            ? "Nie można potwierdzić wyniku. Sprawdź wersję po ponownym uruchomieniu."
            : "Aktualizacja nie powiodła się: " + error.message;
        button.disabled = false;
    }
}


async function waitForInstalledVersion(targetVersion) {
    const attempts = 30;

    for (let attempt = 0; attempt < attempts; attempt++) {
        await new Promise(function(resolve) {
            window.setTimeout(resolve, 2000);
        });

        try {
            const response = await fetch("/device-info", { cache: "no-store" });
            if (!response.ok) {
                continue;
            }

            const deviceInfo = await response.json();
            const installedVersion =
                deviceInfo.application && deviceInfo.application.github_version;
            const comparison =
                compareReleaseVersions(installedVersion, targetVersion);

            if (
                installedVersion === targetVersion ||
                (comparison !== null && comparison >= 0)
            ) {
                return installedVersion;
            }
        } catch (error) {
            // The device is temporarily unreachable while it reboots.
        }
    }

    return null;
}
