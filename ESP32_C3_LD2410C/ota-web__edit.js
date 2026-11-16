"use strict";


const GATE_COUNT = 9;
const CM_PER_GATE = 75;


function getElement(id) {
    return document.getElementById(id);
}


function formatSlotSeconds(frames) {
    const seconds = (Number(frames) || 0) * 0.1;
    return seconds.toFixed(1);
}


/* =========================================================
   TABELA CZUŁOŚCI BRAMEK
   ========================================================= */

function buildGateTable(motionList, staticList) {

    const body = getElement("gate-table-body");
    if (!body) {
        return;
    }

    let html = "";

    for (let i = 0; i < GATE_COUNT; i++) {

        const lo = (i * CM_PER_GATE / 100).toFixed(2);
        const hi = ((i + 1) * CM_PER_GATE / 100).toFixed(2);

        const motion = motionList && motionList[i] !== undefined
            ? motionList[i]
            : 50;

        const stat = staticList && staticList[i] !== undefined
            ? staticList[i]
            : 50;

        html += `
            <div class="gate-table-row">
                <span class="gate-label">${i} (${lo}&ndash;${hi} m)</span>
                <input
                    type="number" name="motion_${i}" class="gate-motion-input"
                    min="0" max="100" value="${motion}"
                >
                <input
                    type="number" name="static_${i}" class="gate-static-input"
                    min="0" max="100" value="${stat}"
                >
            </div>
        `;
    }

    body.innerHTML = html;
}


/* =========================================================
   PRESETY CZUŁOŚCI

   Kazdy preset nadpisuje CALA tabele bramek jednolita wartoscia -
   "Domyslne" odpowiada wartosciom fabrycznym z config.py, "Cichy
   pokoj" obniza czulosc (mniej falszywych wykryc od drobnego ruchu
   otoczenia - wentylatory, firany), "Wyzsza czulosc" ja podnosi
   (wykrywanie subtelniejszej, bardziej nieruchomej obecnosci).
   ========================================================= */

const SENSITIVITY_PRESETS = {
    default: {
        motion: Array(GATE_COUNT).fill(50),
        static: Array(GATE_COUNT).fill(80),
    },
    quiet: {
        motion: Array(GATE_COUNT).fill(30),
        static: Array(GATE_COUNT).fill(60),
    },
    sensitive: {
        motion: Array(GATE_COUNT).fill(70),
        static: Array(GATE_COUNT).fill(90),
    },
};

document.querySelectorAll("[data-sensitivity-preset]").forEach(function(button) {

    button.addEventListener("click", function() {

        const preset = SENSITIVITY_PRESETS[button.dataset.sensitivityPreset];

        if (!preset) {
            return;
        }

        buildGateTable(preset.motion, preset.static);

        const message = getElement("settings-message");

        if (message) {
            message.textContent = "Preset zastosowany - kliknij „Zapisz zmiany”, aby go zachowac.";
            message.classList.remove("error", "success");
        }
    });
});


/* =========================================================
   ZAŁADOWANIE BIEŻĄCYCH USTAWIEŃ
   ========================================================= */

async function loadSettings() {

    try {

        const response = await fetch("/settings", { cache: "no-store" });

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const data = await response.json();
        const runtime = data.runtime || {};
        const sensitivities = data.sensitivities || {};

        buildGateTable(
            sensitivities.motion,
            sensitivities.static
        );

        getElement("max_active_gate").value =
            runtime.max_active_gate ?? 8;

        getElement("slot_batch_frames").value =
            runtime.slot_batch_frames ?? 20;

        getElement("min_presence_s").value =
            runtime.min_presence_s ?? 0;

        getElement("history_max_entries").value =
            runtime.history_max_entries ?? 300;

        getElement("history_page_size").value =
            runtime.history_page_size ?? 10;

        getElement("history_debug_enabled").checked =
            runtime.history_debug_enabled === true;

        getElement("history_debug_hours").value =
            runtime.history_debug_hours ?? 6;

        getElement("webhook_enabled").checked =
            runtime.webhook_enabled !== false;

        getElement("webhook_host").value =
            runtime.webhook_host ?? "";

        getElement("webhook_port").value =
            runtime.webhook_port ?? 80;

        getElement("webhook_retry_pause_s").value =
            runtime.webhook_retry_pause_s ?? 180;

        getElement("slot_batch_seconds").textContent =
            formatSlotSeconds(runtime.slot_batch_frames ?? 20);

        renderWebhookNotice(data.webhook || {});

    } catch (error) {

        console.error("SETTINGS LOAD ERROR:", error);

        const message = getElement("settings-message");
        if (message) {
            message.textContent = "Nie udało się wczytać bieżących ustawień.";
            message.classList.add("error");
        }
    }
}


/* =========================================================
   NA ŻYWO: aktualizacja podglądu sekund/slot przy wpisywaniu
   ========================================================= */

const slotInput = getElement("slot_batch_frames");

if (slotInput) {
    slotInput.addEventListener("input", function() {
        getElement("slot_batch_seconds").textContent =
            formatSlotSeconds(slotInput.value);
    });
}


/* =========================================================
   ZAPIS
   ========================================================= */

const form = getElement("settings-form");

if (form) {

    form.addEventListener("submit", async function(event) {

        event.preventDefault();

        const message = getElement("settings-message");
        const submitButton = getElement("settings-submit");

        if (message) {
            message.textContent = "Zapisywanie…";
            message.classList.remove("error", "success");
        }

        if (submitButton) {
            submitButton.disabled = true;
        }

        const params = new URLSearchParams();

        params.set(
            "max_active_gate",
            getElement("max_active_gate").value
        );

        params.set(
            "slot_batch_frames",
            getElement("slot_batch_frames").value
        );

        params.set(
            "min_presence_s",
            getElement("min_presence_s").value
        );

        params.set(
            "history_max_entries",
            getElement("history_max_entries").value
        );

        params.set(
            "history_page_size",
            getElement("history_page_size").value
        );

        params.set(
            "history_debug_enabled",
            getElement("history_debug_enabled").checked ? "1" : "0"
        );

        params.set(
            "history_debug_hours",
            getElement("history_debug_hours").value
        );

        // Serwer nie dekoduje %XX w formularzu - obcinamy tu to, co
        // ludzie czesto wklejaja razem z adresem ("http://", "/").
        params.set(
            "webhook_enabled",
            getElement("webhook_enabled").checked ? "1" : "0"
        );

        params.set(
            "webhook_host",
            getElement("webhook_host").value
                .trim()
                .replace(/^https?:\/\//i, "")
                .replace(/\/+$/, "")
        );

        params.set(
            "webhook_port",
            getElement("webhook_port").value
        );

        params.set(
            "webhook_retry_pause_s",
            getElement("webhook_retry_pause_s").value
        );

        for (let i = 0; i < GATE_COUNT; i++) {

            const motionInput = document.querySelector(
                `input[name="motion_${i}"]`
            );

            const staticInput = document.querySelector(
                `input[name="static_${i}"]`
            );

            if (motionInput) {
                params.set("motion_" + i, motionInput.value);
            }

            if (staticInput) {
                params.set("static_" + i, staticInput.value);
            }
        }

        try {

            const response = await fetch("/edit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: params.toString()
            });

            const data = await response.json();

            if (!response.ok || data.ok === false) {
                throw new Error(data.error || ("HTTP " + response.status));
            }

            if (message) {
                message.textContent = "Zapisano. Wysyłanie do czujnika…";
                message.classList.remove("error", "success");
            }

            await pollApplyStatus(message);

        } catch (error) {

            console.error("SETTINGS SAVE ERROR:", error);

            if (message) {
                message.textContent = "Błąd zapisu: " + error.message;
                message.classList.remove("success");
                message.classList.add("error");
            }

        } finally {

            if (submitButton) {
                submitButton.disabled = false;
            }
        }
    });
}


/* =========================================================
   ODPYTYWANIE WYNIKU WYSYLKI DO CZUJNIKA
   ========================================================= */

function renderWebhookNotice(webhook) {
    const notice = getElement("webhook-notice");
    const retryButton = getElement("webhook-retry-button");

    if (!notice || !retryButton) {
        return;
    }

    const enabled = webhook.enabled !== false;
    const suspended = Boolean(webhook.suspended);
    const state = webhook.state || "active";

    if (!enabled || state === "disabled") {
        notice.style.display = "none";
        retryButton.style.display = "none";
        return;
    }

    if (suspended) {
        notice.textContent = webhook.message || "Webhook wstrzymany. Kliknij „Ponów”, aby wznowić próbę.";
        notice.classList.add("error");
        notice.classList.remove("success");
        notice.style.display = "block";
        retryButton.style.display = "inline-block";
        return;
    }

    if (state === "retrying") {
        notice.textContent = webhook.message || "Webhook ponawia próbę za kilka sekund.";
        notice.classList.remove("error");
        notice.classList.add("success");
        notice.style.display = "block";
        retryButton.style.display = "none";
        return;
    }

    notice.style.display = "none";
    retryButton.style.display = "none";
}

if (document.getElementById("webhook-retry-button")) {
    document.getElementById("webhook-retry-button").addEventListener("click", async function() {
        try {
            const response = await fetch("/webhook/retry", { method: "POST" });
            const data = await response.json();

            if (!response.ok || data.ok === false) {
                throw new Error(data.error || ("HTTP " + response.status));
            }

            renderWebhookNotice(data.webhook || {});
        } catch (error) {
            console.error("WEBHOOK RETRY ERROR:", error);
        }
    });
}

function sleep(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

async function pollApplyStatus(message, maxAttempts) {

    maxAttempts = maxAttempts || 12;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {

        await sleep(300);

        try {

            const response = await fetch(
                "/apply-status",
                { cache: "no-store" }
            );

            if (!response.ok) {
                continue;
            }

            const data = await response.json();

            if (data.pending) {
                continue;
            }

            if (message) {

                if (data.ok === false) {

                    message.textContent =
                        "Zapisano, ale czujnik nie odpowiedział - " +
                        "ustawienia zostaną zastosowane, gdy połączenie wróci.";

                    message.classList.remove("success");
                    message.classList.add("error");

                } else {

                    message.textContent = "Zapisano i zastosowano.";
                    message.classList.remove("error");
                    message.classList.add("success");
                }
            }

            return;

        } catch (error) {

            console.error("APPLY STATUS ERROR:", error);
        }
    }

    if (message) {

        message.textContent =
            "Zapisano. Nie udało się potwierdzić zastosowania na czujniku.";

        message.classList.remove("success");
        message.classList.add("error");
    }
}


/* =========================================================
   RESTART POLACZENIA Z CZUJNIKIEM (/reset)
   ========================================================= */

async function pollResetStatus(message, maxAttempts) {

    maxAttempts = maxAttempts || 12;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {

        await sleep(300);

        try {

            const response = await fetch(
                "/reset-status",
                { cache: "no-store" }
            );

            if (!response.ok) {
                continue;
            }

            const data = await response.json();

            if (data.pending) {
                continue;
            }

            if (message) {

                if (data.ok === false) {

                    message.textContent =
                        "Czujnik nie odpowiedział na restart połączenia.";

                    message.classList.remove("success");
                    message.classList.add("error");

                } else {

                    message.textContent = "Połączenie z czujnikiem zrestartowane.";
                    message.classList.remove("error");
                    message.classList.add("success");
                }
            }

            return;

        } catch (error) {

            console.error("RESET STATUS ERROR:", error);
        }
    }

    if (message) {

        message.textContent =
            "Nie udało się potwierdzić restartu połączenia.";

        message.classList.remove("success");
        message.classList.add("error");
    }
}


const resetButton = getElement("reset-sensor-button");

if (resetButton) {

    resetButton.addEventListener("click", async function() {

        const message = getElement("maintenance-message");

        if (message) {
            message.textContent = "Restartowanie połączenia z czujnikiem…";
            message.classList.remove("error", "success");
        }

        resetButton.disabled = true;

        try {

            const response = await fetch("/reset", { method: "POST" });

            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }

            await pollResetStatus(message);

        } catch (error) {

            console.error("SENSOR RESET ERROR:", error);

            if (message) {
                message.textContent = "Błąd restartu: " + error.message;
                message.classList.remove("success");
                message.classList.add("error");
            }

        } finally {

            resetButton.disabled = false;
        }
    });
}


/* =========================================================
   CZYSZCZENIE HISTORII (/history-clear)
   ========================================================= */

const clearHistoryButton = getElement("clear-history-button");

if (clearHistoryButton) {

    /*
     * UWAGA: CELOWO bez window.confirm() - w niektorych przegladarkach
     * / webview (np. na urzadzeniach wbudowanych) natywne dialogi JS
     * (confirm/alert) sa zablokowane i confirm() cicho zwraca false,
     * przez co klikniecie przycisku wygladalo jak calkowity brak
     * reakcji (zero komunikatow). Zamiast tego - potwierdzenie DWOMA
     * kliknieciami w samej stronie.
     */

    const defaultLabel =
        clearHistoryButton.textContent;

    let awaitingConfirm = false;
    let confirmTimeout = null;

    function resetClearHistoryButton() {

        awaitingConfirm = false;

        clearHistoryButton.textContent = defaultLabel;
        clearHistoryButton.classList.remove("confirming");

        if (confirmTimeout) {
            clearTimeout(confirmTimeout);
            confirmTimeout = null;
        }
    }

    clearHistoryButton.addEventListener("click", async function() {

        const message = getElement("maintenance-message");

        if (!awaitingConfirm) {

            awaitingConfirm = true;

            clearHistoryButton.textContent = "Na pewno? Kliknij ponownie";
            clearHistoryButton.classList.add("confirming");

            if (message) {
                message.textContent =
                    "Kliknij ponownie w ciągu 5 s, aby potwierdzić usunięcie historii.";
                message.classList.remove("error", "success");
            }

            confirmTimeout = setTimeout(resetClearHistoryButton, 5000);

            return;
        }

        resetClearHistoryButton();

        if (message) {
            message.textContent = "Czyszczenie historii…";
            message.classList.remove("error", "success");
        }

        clearHistoryButton.disabled = true;

        try {

            const response = await fetch("/history-clear", { method: "POST" });

            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }

            const data = await response.json();

            if (data.ok === false) {
                throw new Error(data.error || "nieznany błąd");
            }

            if (message) {
                message.textContent = "Historia wyczyszczona.";
                message.classList.remove("error");
                message.classList.add("success");
            }

        } catch (error) {

            console.error("HISTORY CLEAR ERROR:", error);

            if (message) {
                message.textContent = "Błąd czyszczenia historii: " + error.message;
                message.classList.remove("success");
                message.classList.add("error");
            }

        } finally {

            clearHistoryButton.disabled = false;
        }
    });
}


/* =========================================================
   KROPKA W NAGLOWKU + STOPKA (na podstawie /info)
   ========================================================= */

function updateConnectionDot(rxConnected, txConnected) {

    const dot = getElement("connection-dot");

    if (!dot) {
        return;
    }

    dot.classList.remove("online", "warning", "offline");

    if (rxConnected && txConnected) {
        dot.classList.add("online");
    } else if (rxConnected) {
        dot.classList.add("warning");
    } else {
        dot.classList.add("offline");
    }
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

    try {

        const response = await fetch("/info", { cache: "no-store" });

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const data = await response.json();

        const rx = data.rx || {};
        const tx = data.tx || {};

        updateConnectionDot(rx.connected === true, tx.connected === true);

        const footer = getElement("app-footer");

        if (footer) {
            footer.textContent = formatFooterText(data.application);
        }

    } catch (error) {

        console.error("INFO ERROR:", error);

        updateConnectionDot(false, false);
    }
}


/* =========================================================
   START
   ========================================================= */

document.addEventListener("DOMContentLoaded", function() {
    loadSettings();
    loadInfo();
});
