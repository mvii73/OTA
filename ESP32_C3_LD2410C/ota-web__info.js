"use strict";

function getElement(id) {
    return document.getElementById(id);
}

function displayValue(value) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderSection(id, fields) {
    const element = getElement(id);
    if (!element) {
        return;
    }

    let html = "";
    for (const field of fields) {
        html += "<div class=\"info-row\"><dt>" + field[0] +
            "</dt><dd>" + displayValue(field[1]) + "</dd></div>";
    }
    element.innerHTML = html;
}

function renderInfo(data) {
    const application = data.application || {};
    const controller = data.controller || {};
    const firmware = controller.firmware || {};
    const sensor = data.sensor || {};
    const ble = data.ble || {};
    const network = data.network || {};
    const rx = sensor.rx || {};
    const tx = sensor.tx || {};

    renderSection("application-info", [
        ["Nazwa", application.name], ["Wersja", application.version],
        ["Data wydania", application.release_date], ["Build", application.build],
        ["Wersja GitHub", application.github_version],
        ["Commit Git", application.git_commit],
        ["Stan kodu przy instalacji", application.git_dirty === null || application.git_dirty === undefined ? null : (application.git_dirty ? "lokalne zmiany" : "zgodny z repozytorium")],
        ["Wgrano", application.installed_at]
    ]);
    renderSection("controller-info", [
        ["Urządzenie", controller.esp_model],
        ["MicroPython", firmware.micropython],
        ["Platforma", firmware.platform],
        ["Wydanie", firmware.release], ["Data kompilacji", firmware.build_date],
        ["Wolna pamięć RAM", controller.ram_free],
        ["Przydzielona pamięć RAM", controller.ram_allocated],
        ["Pamięć flash", controller.flash_size],
        ["Wolna pamięć flash", controller.flash_free]
    ]);
    renderSection("sensor-info", [
        ["Model skonfigurowany", sensor.configured_model],
        ["Typ protokołu", sensor.protocol_type],
        ["Firmware czujnika", sensor.firmware],
        ["Status", sensor.status],
        ["Ostatnia ramka", sensor.last_frame_age_s === null || sensor.last_frame_age_s === undefined ? null : sensor.last_frame_age_s],
        ["RX", rx.details || (rx.connected ? "OK" : null)],
        ["TX", tx.details || (tx.connected ? "OK" : null)]
    ]);
    renderSection("ble-info", [
        ["Adres MAC", ble.mac]
    ]);
    renderSection("network-info", [
        ["Tryb", network.mode], ["Nazwa sieci (SSID)", network.ssid],
        ["Adres IP", network.ip], ["Maska podsieci", network.netmask],
        ["Brama", network.gateway], ["DNS", network.dns], ["MAC", network.mac],
        ["Siła sygnału", network.rssi_dbm === null || network.rssi_dbm === undefined ? null : network.rssi_dbm]
    ]);

    const dot = getElement("connection-dot");
    if (dot) {
        dot.classList.remove("online", "warning", "offline");
        dot.classList.add(
            rx.connected && tx.connected
                ? "online"
                : rx.connected
                    ? "warning"
                    : "offline"
        );
    }

    updateFooter(application);
}


function updateFooter(application) {
    const footer = getElement("app-footer");
    if (!footer) {
        return;
    }

    footer.textContent = formatFooterText(application);
}


function formatFooterText(application) {
    application = application || {};

    const version = application.version;
    const releaseDate = application.release_date;
    const installedAt = application.installed_at;

    if (!version) {
        return "ESP32_C3_LD2410C";
    }

    let installedDatePart = null;
    let installedLocal = null;

    if (installedAt) {
        const parsed = new Date(
            String(installedAt).replace(" UTC", "Z").replace(" ", "T")
        );

        if (!isNaN(parsed.getTime())) {
            installedDatePart = String(installedAt).slice(0, 10);
            installedLocal = parsed.toLocaleString();
        }
    }

    if (installedDatePart && installedDatePart !== releaseDate) {
        return "wersja " + version + " · wgrano " + installedLocal;
    }

    return "wersja " + version + (releaseDate ? " · " + releaseDate : "");
}

async function loadInfo() {
    const message = getElement("info-message");
    const button = getElement("refresh-info");
    if (message) {
        message.textContent = "Wczytywanie danych…";
        message.classList.remove("error", "success");
    }
    if (button) {
        button.disabled = true;
    }

    try {
        const response = await fetch("/device-info", { cache: "no-store" });
        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }
        renderInfo(await response.json());
        if (message) {
            message.textContent = "";
            message.classList.remove("error", "success");
        }
    } catch (error) {
        if (message) {
            message.textContent = "Nie udało się pobrać danych: " + error.message;
            message.classList.add("error");
        }
        const dot = getElement("connection-dot");
        if (dot) {
            dot.classList.remove("online", "warning");
            dot.classList.add("offline");
        }
    } finally {
        if (button) {
            button.disabled = false;
        }
    }
}

document.addEventListener("DOMContentLoaded", function() {
    const button = getElement("refresh-info");
    if (button) {
        button.addEventListener("click", loadInfo);
    }

    const updateButton = getElement("check-app-updates");
    if (updateButton) {
        updateButton.addEventListener("click", function() {
            checkForAppUpdate(true);
        });
    }

    const firstGroup = document.querySelector(".info-group");
    if (firstGroup && !firstGroup.open) {
        firstGroup.open = true;
    }

    document.querySelectorAll(".info-group").forEach(function(details) {
        if (details !== firstGroup && details.open) {
            details.open = false;
        }
    });

    loadInfo();

    // Akordeon: rozwiniecie jednej belki zwija pozostale.
    document.querySelectorAll(".info-group").forEach(function(details) {
        details.addEventListener("toggle", function() {
            if (!details.open) {
                return;
            }
            document.querySelectorAll(".info-group").forEach(function(other) {
                if (other !== details) {
                    other.open = false;
                }
            });
        });
    });
});
