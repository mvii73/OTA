"use strict";


const GATE_COUNT = 9;
const CM_PER_GATE = 75;


function getElement(id) {
    return document.getElementById(id);
}


function sleep(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}


function gateRangeLabel(i) {
    const lo = (i * CM_PER_GATE / 100).toFixed(2);
    const hi = ((i + 1) * CM_PER_GATE / 100).toFixed(2);
    return i + " (" + lo + "–" + hi + " m)";
}


/* =========================================================
   NAWIGACJA MIEDZY KROKAMI
   ========================================================= */

function showStep(name) {

    getElement("calib-step-start").hidden = name !== "start";
    getElement("calib-step-progress").hidden = name !== "progress";
    getElement("calib-step-result").hidden = name !== "result";
}


/* =========================================================
   KROK 2: POMIAR W TOKU
   ========================================================= */

function renderProgressTable(live) {

    const body = getElement("calib-progress-body");
    if (!body) {
        return;
    }

    const motion = (live && live.motion) || [];
    const stat = (live && live.static) || [];

    let html = "";

    /*
     * Tryb inzynierski probkuje WSZYSTKIE bramki jednoczesnie w
     * kazdej ramce - nie ma juz pojedynczej "aktualnie mierzonej"
     * bramki do podswietlenia, wszystkie rosna razem.
     */

    for (let i = 0; i < GATE_COUNT; i++) {

        html += `
            <div class="gate-table-row">
                <span class="gate-label">${gateRangeLabel(i)}</span>
                <span class="gate-value">${Number(motion[i] || 0).toFixed(1)}</span>
                <span class="gate-value">${Number(stat[i] || 0).toFixed(1)}</span>
            </div>
        `;
    }

    body.innerHTML = html;
}


let pollTimer = null;


function stopPolling() {

    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}


async function pollStatus() {

    try {

        const response = await fetch(
            "/calibrate-status",
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const status = await response.json();

        getElement("calib-remaining").textContent =
            Math.ceil(Number(status.remaining_s) || 0);

        renderProgressTable(status.live);

        if (status.done) {

            stopPolling();
            await loadResult();
            return;
        }

        if (!status.active) {

            // Pomiar zostal anulowany/nie wystartowal - wracamy
            // do pierwszego kroku, zeby strona nie utknela.
            stopPolling();
            showStep("start");
            return;
        }

    } catch (error) {

        console.error("CALIB STATUS ERROR:", error);
    }

    pollTimer = setTimeout(pollStatus, 1000);
}


/* =========================================================
   KROK 1: START
   ========================================================= */

const startButton = getElement("calib-start-button");

if (startButton) {

    startButton.addEventListener("click", async function() {

        const message = getElement("calib-start-message");

        if (message) {
            message.textContent = "Uruchamianie…";
            message.classList.remove("error", "success");
        }

        startButton.disabled = true;

        try {

            const params = new URLSearchParams();

            params.set(
                "duration_s",
                getElement("calib_duration_s").value
            );

            const response = await fetch("/calibrate-start", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: params.toString()
            });

            const data = await response.json().catch(function() { return {}; });

            if (!response.ok || data.ok === false) {
                throw new Error(data.error || ("HTTP " + response.status));
            }

            if (message) {
                message.textContent = "";
            }

            showStep("progress");

            getElement("calib-progress-message").textContent = "";

            pollStatus();

        } catch (error) {

            console.error("CALIB START ERROR:", error);

            if (message) {
                message.textContent = "Błąd uruchamiania: " + error.message;
                message.classList.remove("success");
                message.classList.add("error");
            }

        } finally {

            startButton.disabled = false;
        }
    });
}


/* =========================================================
   ANULOWANIE POMIARU
   ========================================================= */

const cancelButton = getElement("calib-cancel-button");

if (cancelButton) {

    cancelButton.addEventListener("click", async function() {

        stopPolling();

        cancelButton.disabled = true;

        try {

            await fetch("/calibrate-cancel", { method: "POST" });

        } catch (error) {

            console.error("CALIB CANCEL ERROR:", error);

        } finally {

            cancelButton.disabled = false;
            showStep("start");
        }
    });
}


/* =========================================================
   KROK 3: WYNIK
   ========================================================= */

function buildResultTable(result) {

    const body = getElement("calib-result-body");
    if (!body) {
        return;
    }

    const observed = result.observed_noise || {};
    const proposed = result.proposed_sensitivity || {};
    const peakCounts = result.peak_counts || {};

    const observedMotion = observed.motion || [];
    const observedStatic = observed.static || [];

    const proposedMotion = proposed.motion || [];
    const proposedStatic = proposed.static || [];

    const peakCountMotion = peakCounts.motion || [];
    const peakCountStatic = peakCounts.static || [];

    let html = "";

    for (let i = 0; i < GATE_COUNT; i++) {

        html += `
            <div class="gate-table-row">

                <span class="gate-label">
                    ${gateRangeLabel(i)}
                </span>

                <span>
                    <input
                        type="number" name="motion_${i}" class="gate-motion-input"
                        min="0" max="100" value="${proposedMotion[i] ?? 0}"
                    >
                    <span class="gate-value-hint">
                        ${Number(observedMotion[i] || 0).toFixed(1)}&middot;${Number(peakCountMotion[i] || 0)}&times;
                    </span>
                </span>

                <span>
                    <input
                        type="number" name="static_${i}" class="gate-static-input"
                        min="0" max="100" value="${proposedStatic[i] ?? 0}"
                    >
                    <span class="gate-value-hint">
                        ${Number(observedStatic[i] || 0).toFixed(1)}&middot;${Number(peakCountStatic[i] || 0)}&times;
                    </span>
                </span>

            </div>
        `;
    }

    body.innerHTML = html;

    getElement("calib-margin").textContent = result.margin ?? "—";
}


async function loadResult() {

    try {

        const response = await fetch(
            "/calibrate-result",
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const result = await response.json();

        buildResultTable(result);

        showStep("result");

        const message = getElement("calib-result-message");

        if (message) {
            message.textContent = "";
            message.classList.remove("error", "success");
        }

        // Swiezy wynik - ukrywamy pytanie o historie z ewentualnego
        // poprzedniego cyklu (pomiar -> zapis -> powtorz pomiar).
        const prompt = getElement("calib-history-prompt");

        if (prompt) {
            prompt.hidden = true;
        }

    } catch (error) {

        console.error("CALIB RESULT ERROR:", error);

        const message = getElement("calib-progress-message");

        if (message) {
            message.textContent = "Błąd pobierania wyniku: " + error.message;
            message.classList.remove("success");
            message.classList.add("error");
        }
    }
}


const repeatButton = getElement("calib-repeat-button");

if (repeatButton) {

    repeatButton.addEventListener("click", function() {
        showStep("start");
    });
}


/* =========================================================
   ZAPIS WYNIKU (jako nowa czulosc bramek)
   ========================================================= */

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

            return data.ok !== false;

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

    return false;
}


const saveButton = getElement("calib-save-button");

if (saveButton) {

    saveButton.addEventListener("click", async function() {

        const message = getElement("calib-result-message");

        if (message) {
            message.textContent = "Zapisywanie…";
            message.classList.remove("error", "success");
        }

        saveButton.disabled = true;

        try {

            const params = new URLSearchParams();

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

            const response = await fetch("/calibrate-apply", {
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

            const applied = await pollApplyStatus(message);

            if (applied) {

                const prompt = getElement("calib-history-prompt");

                if (prompt) {
                    prompt.hidden = false;
                }
            }

        } catch (error) {

            console.error("CALIB SAVE ERROR:", error);

            if (message) {
                message.textContent = "Błąd zapisu: " + error.message;
                message.classList.remove("success");
                message.classList.add("error");
            }

        } finally {

            saveButton.disabled = false;
        }
    });
}


/* =========================================================
   PYTANIE O CZYSZCZENIE HISTORII (po udanym zapisie)
   ========================================================= */

const keepHistoryButton = getElement("calib-history-keep-button");

if (keepHistoryButton) {

    keepHistoryButton.addEventListener("click", function() {

        const prompt = getElement("calib-history-prompt");

        if (prompt) {
            prompt.hidden = true;
        }
    });
}


const clearHistoryButton = getElement("calib-history-clear-button");

if (clearHistoryButton) {

    clearHistoryButton.addEventListener("click", async function() {

        const message = getElement("calib-result-message");

        clearHistoryButton.disabled = true;

        try {

            const response = await fetch(
                "/history-clear",
                { method: "POST" }
            );

            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }

            const data = await response.json();

            if (data.ok === false) {
                throw new Error(data.error || "nieznany błąd");
            }

            if (message) {
                message.textContent = "Zapisano i zastosowano. Historia wyczyszczona.";
                message.classList.remove("error");
                message.classList.add("success");
            }

        } catch (error) {

            console.error("CALIB HISTORY CLEAR ERROR:", error);

            if (message) {
                message.textContent = "Błąd czyszczenia historii: " + error.message;
                message.classList.remove("success");
                message.classList.add("error");
            }

        } finally {

            clearHistoryButton.disabled = false;

            const prompt = getElement("calib-history-prompt");

            if (prompt) {
                prompt.hidden = true;
            }
        }
    });
}


/* =========================================================
   KROPKA W NAGLOWKU + STOPKA + BLOKADA KALIBRACJI (na podstawie
   /info) - kalibracja wymaga sprawnej komunikacji RX i TX (patrz
   tez guard po stronie serwera w /calibrate-start).
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
        const available = rx.connected === true && tx.connected === true;

        updateConnectionDot(rx.connected === true, tx.connected === true);

        const footer = getElement("app-footer");

        if (footer) {
            footer.textContent = formatFooterText(data.application);
        }

        if (startButton) {
            startButton.disabled = !available;
        }

        const message = getElement("calib-start-message");

        if (message) {
            message.textContent = available
                ? ""
                : "Kalibracja wymaga sprawnej komunikacji RX i TX z czujnikiem.";
            message.classList.toggle("error", !available);
            message.classList.remove("success");
        }

    } catch (error) {

        console.error("INFO ERROR:", error);

        updateConnectionDot(false, false);
    }
}


/* =========================================================
   START STRONY
   ========================================================= */

document.addEventListener("DOMContentLoaded", async function() {

    loadInfo();

    /*
     * Jesli pomiar juz trwa (np. przegladarka zostala odswiezona
     * w trakcie) albo wlasnie sie zakonczyl - wchodzimy od razu
     * we wlasciwy krok zamiast zawsze zaczynac od poczatku.
     */

    try {

        const response = await fetch(
            "/calibrate-status",
            { cache: "no-store" }
        );

        if (response.ok) {

            const status = await response.json();

            if (status.active) {
                showStep("progress");
                pollStatus();
                return;
            }

            if (status.done) {
                await loadResult();
                return;
            }
        }

    } catch (error) {

        console.error("CALIB INIT STATUS ERROR:", error);
    }

    showStep("start");
});
