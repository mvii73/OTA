"use strict";


/*
 * Musi byc zgodne z GATE_COUNT/CM_PER_GATE w sensor_protocol.py
 * (i z kopia tych samych stalych w edit.js).
 */
const GATE_COUNT = 9;
const CM_PER_GATE = 75;

/* =========================================================
   HELPERS
   ========================================================= */

function getElement(id) {
    return document.getElementById(id);
}


function readValue(obj, path, fallback) {
    if (!obj || typeof obj !== "object") {
        return fallback;
    }

    const keys = path.split(".");
    let current = obj;

    for (const key of keys) {
        if (current === null || current === undefined) {
            return fallback;
        }
        current = current[key];
    }

    return current === undefined || current === null ? fallback : current;
}


function setText(id, value) {

    const element = getElement(id);

    if (!element) {
        return;
    }

    element.textContent = value;
}


function escapeHtml(value) {

    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function formatDuration(seconds) {

    seconds = Number(seconds) || 0;

    const totalSeconds = Math.max(0, Math.floor(Math.abs(seconds)));
    const days = Math.floor(totalSeconds / 86400);
    const remainderAfterDays = totalSeconds % 86400;
    const hours = Math.floor(remainderAfterDays / 3600);
    const remainderAfterHours = remainderAfterDays % 3600;
    const minutes = Math.floor(remainderAfterHours / 60);
    const secs = remainderAfterHours % 60;

    if (days > 0) {
        return `${days}:${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }

    if (minutes > 0) {
        return `${minutes}:${String(secs).padStart(2, "0")}`;
    }

    return String(secs);
}


function formatNumber(value, decimals) {

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "—";
    }

    return number.toFixed(decimals);
}


function formatOptionalNumber(value, decimals) {

    if (value === null || value === undefined) {
        return "—";
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "—";
    }

    return number.toFixed(decimals);
}


/* =========================================================
   STATE
   ========================================================= */

function stateLabel(state) {

    state = Number(state);

    switch (state) {

        case 0:
            return "BRAK";

        case 1:
            return "RUCH";

        case 2:
            return "STATYCZNY";

        case 3:
            return "RUCH + STAT.";

        default:
            return "UNKNOWN";
    }
}


function stateClass(state) {

    state = Number(state);

    if (
        state === 1 ||
        state === 2 ||
        state === 3
    ) {
        return "state-" + state;
    }

    return "";
}


/*
 * Kolor wg czasu trwania:
 *
 * <1min  - niebieski
 * <10min - zielony
 * <1h    - pomaranczowy
 * >=1h   - czerwony
 *
 * Uzywane tylko dla wpisow WYKRYTA OBECNOSC.
 */

function durationColor(seconds) {

    seconds = Number(seconds) || 0;

    if (seconds < 60) {
        return "var(--info)";
    }

    if (seconds < 600) {
        return "var(--signal)";
    }

    if (seconds < 3600) {
        return "var(--idle)";
    }

    return "var(--danger)";
}


/* =========================================================
   STATUS
   ========================================================= */

/*
 * Sygnatura ostatniego znanego stanu (wykryto/nie, znany/nieznany
 * stan) - do wykrycia MOMENTU zmiany, zeby wtedy dodatkowo
 * odswiezyc "Poprzednie stany" (wlasnie wtedy w historii pojawia
 * sie nowy, zamkniety wpis - patrz koniec updateStatus()).
 */
let lastCurrentSignature = null;


function updateStatus(data) {

    if (!data) {
        return;
    }


    const presence =
        data.presence || {};

    const filter =
        data.filter || {};

    const lastState =
        data.last_state || {};

    const motion =
        data.motion || {};

    const stationary =
        data.stationary || {};

    const minPresenceS =
        Number(filter.min_presence_s || 0);

    const filterIndicator =
        getElement("filter-indicator");

    if (filterIndicator) {
        if (minPresenceS > 0) {
            filterIndicator.textContent =
                "filtr: min. obecność " + formatDuration(minPresenceS);
            filterIndicator.hidden = false;
        } else {
            filterIndicator.hidden = true;
            filterIndicator.textContent = "";
        }
    }


    /*
     * PRESENCE
     *
     * BRAK KOMUNIKACJI i WYLACZONY uzywaja TEGO SAMEGO kafla co
     * WYKRYTO/BRAK OBECNOSCI (a nie tylko wpisu w "Poprzednich
     * stanach") - inaczej biezacy stan urzadzenia byl niewidoczny
     * na pierwszy rzut oka, dopoki nie zamknal sie w historii.
     */

    const detected =
        presence.detected === true;

    const commLost =
        presence.comm_lost === true;

    const poweredOff =
        presence.powered_off === true;


    const presenceElement =
        getElement("presence-status");


    if (presenceElement) {

        let statusText;
        let statusClass;

        if (commLost) {
            statusText = "BRAK KOMUNIKACJI";
            statusClass = "comm-lost";
        } else if (poweredOff) {
            statusText = "WYŁĄCZONY";
            statusClass = "powered-off";
        } else if (detected) {
            statusText = "WYKRYTA OBECNOŚĆ";
            statusClass = "detected";
        } else {
            statusText = "BRAK OBECNOŚCI";
            statusClass = "not-detected";
        }

        presenceElement.textContent = statusText;

        presenceElement.classList.remove(
            "detected",
            "not-detected",
            "comm-lost",
            "powered-off"
        );

        presenceElement.classList.add(statusClass);

        /*
         * Ten sam schemat kolorow co na liscie "Poprzednie stany"
         * (patrz durationColor() i updateHistory()) - dla WYKRYTA
         * OBECNOSC kolor skaluje sie z czasem trwania (niebieski ->
         * zielony -> pomaranczowy -> czerwony), dla pozostalych
         * stanow kolor jest staly (ustalany przez klase CSS powyzej).
         */
        presenceElement.style.color =
            statusClass === "detected"
                ? durationColor(presence.duration)
                : "";
    }


    /*
     * Ten sam schemat kolorow (rowniez lewa krawedz kafla) co na
     * liscie "Poprzednie stany" - patrz borderColor w updateHistory().
     */
    const heroElement =
        document.querySelector(".hero");

    if (heroElement) {

        heroElement.style.borderLeftColor =
            commLost
                ? "var(--danger)"
                : poweredOff
                    ? "var(--text-faint)"
                    : detected
                        ? durationColor(presence.duration)
                        : "var(--hairline)";
    }


    setText(
        "hero-sub",
        commLost
            ? "sprawdź połączenie z czujnikiem"
            : poweredOff
                ? "urządzenie było wyłączone"
                : minPresenceS > 0
                    ? "w polu widzenia czujnika · filtr aktywny"
                    : "w polu widzenia czujnika"
    );


    setText(
        "presence-duration",
        formatDuration(
            presence.duration
        )
    );


    /*
     * TYP OBECNOŚCI + POMIARY
     *
     * Widoczne tylko, gdy cos jest wykryte - w przeciwnym razie
     * ruch/obecnosc stacjonarna nie maja znaczenia.
     */

    const rawState =
        Number(lastState.state);

    const hasMotion =
        detected &&
        (rawState === 1 || rawState === 3);

    const hasStationary =
        detected &&
        (rawState === 2 || rawState === 3);


    const measurementsElement =
        getElement("hero-measurements");

    if (measurementsElement) {
        measurementsElement.hidden = !detected;
    }


    if (detected) {

        setText(
            "hero-type",
            hasMotion && hasStationary
                ? "RUCH + OBECNOŚĆ STACJONARNA"
                : hasMotion
                    ? "RUCH"
                    : hasStationary
                        ? "OBECNOŚĆ STACJONARNA"
                        : "—"
        );
    }


    setText(
        "hero-motion-distance",
        hasMotion
            ? formatOptionalNumber(motion.distance, 1)
            : "—"
    );

    setText(
        "hero-motion-energy",
        hasMotion
            ? formatOptionalNumber(motion.energy, 3)
            : "—"
    );

    setText(
        "hero-stationary-distance",
        hasStationary
            ? formatOptionalNumber(stationary.distance, 1)
            : "—"
    );

    setText(
        "hero-stationary-energy",
        hasStationary
            ? formatOptionalNumber(stationary.energy, 3)
            : "—"
    );


    updateHeroDetails(
        data,
        detected,
        commLost || poweredOff
    );


    /*
     * Wykrycie ZMIANY biezacego stanu (wykryto/nie, znany/nieznany
     * stan surowy) - dokladnie w tym momencie w historii powstaje
     * NOWY, zamkniety wpis (patrz update_period_tracking() i
     * update_connection_tracking() w state_tracking.py), wiec
     * dodatkowo odswiezamy "Poprzednie stany".
     */

    const currentSignature =
        (detected ? "1" : "0") +
        ":" +
        (commLost ? "1" : "0") +
        ":" +
        (poweredOff ? "1" : "0") +
        ":" +
        (lastState.state === "UNKNOWN" ? "unknown" : "known");

    if (
        lastCurrentSignature !== null &&
        currentSignature !== lastCurrentSignature
    ) {
        fetchHistory();
    }

    lastCurrentSignature = currentSignature;
}


/* =========================================================
   HERO DETAILS (rozwijane szczegóły bieżącego stanu)
   ========================================================= */

function updateHeroDetails(data, detected, hideDetails) {

    const details =
        getElement("hero-details");

    if (details) {
        details.hidden = hideDetails === true;
    }

    if (hideDetails) {
        return;
    }


    const container =
        getElement("hero-details-body");

    if (!container) {
        return;
    }


    const current =
        data.current || {};


    const startedAt =
        current.started_at_local &&
        current.started_at_local !== "brak czasu"
            ? current.started_at_local
            : "brak czasu";


    const duration =
        formatDuration(
            current.duration
        );


    const stateName =
        current.state_name ||
        "UNKNOWN";


    const stateRaw =
        current.state_raw;


    let html = `

        <div class="history-detail-section">

            <div class="history-detail-section-title">
                Informacje
            </div>

            <div class="history-detail-section-content">

                <div class="history-detail-row">
                    <div class="history-detail-label">Rozpoczęto</div>
                    <div class="history-detail-value">
                        ${escapeHtml(startedAt)}
                    </div>
                </div>

                <div class="history-detail-row">
                    <div class="history-detail-label">Czas trwania</div>
                    <div class="history-detail-value">
                        ${escapeHtml(duration)}
                    </div>
                </div>

                <div class="history-detail-row">
                    <div class="history-detail-label">Stan</div>
                    <div class="history-detail-value">

                        ${escapeHtml(stateName)}

                        ${
                            stateRaw !== null &&
                            stateRaw !== undefined
                                ? " (" + escapeHtml(stateRaw) + ")"
                                : ""
                        }

                    </div>
                </div>

            </div>

        </div>

    `;


    if (detected) {

        html += rangeDetailSections(
            current.details || {}
        );
    }


    container.innerHTML = html;
}


/* =========================================================
   INFO
   ========================================================= */

function updateInfo(data) {

    if (!data) {
        return;
    }


    /*
     * /info NIE aktualizuje:
     *
     * - state-name
     * - state-raw
     * - state-duration
     *
     * Aktualny stan pochodzi wyłącznie z /status.
     */


    const rx = data.rx || {};
    const tx = data.tx || {};

    const rxConnected = rx.connected === true;
    const txConnected = tx.connected === true;

    updateConnectionDot(rxConnected, txConnected);
    updateCalibrationAvailability(rxConnected, txConnected);
    updateFooter(data.application);
}


/*
 * Kropka w nagłówku: zielona (rx i tx sprawne), żółta (tylko rx),
 * czerwona (rx nie działa - wtedy tx nie ma znaczenia).
 */
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


/*
 * Kalibracja wymaga sprawnej komunikacji RX i TX - bez tego link
 * w menu jest zablokowany (patrz tez guard po stronie serwera w
 * /calibrate-start).
 */
function updateCalibrationAvailability(rxConnected, txConnected) {

    const link = getElement("menu-calibrate-link");

    if (!link) {
        return;
    }

    const available = rxConnected && txConnected;

    link.classList.toggle("disabled", !available);

    link.setAttribute(
        "aria-disabled",
        available ? "false" : "true"
    );

    link.title = available
        ? ""
        : "Wymaga sprawnej komunikacji RX i TX z czujnikiem";
}


/*
 * Stopka: wersja aplikacji + data wydania, albo data/godzina
 * wgrania (czas lokalny), jesli rozni sie od daty wydania.
 */
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
            String(installedAt)
                .replace(" UTC", "Z")
                .replace(" ", "T")
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


/* =========================================================
   CONNECTION
   ========================================================= */


/*
 * Timer monitorowania połączenia.
 */
let connectionMonitorTimer = null;


/*
 * Informacja, czy aktualnie wykonywane jest
 * sprawdzenie połączenia.
 */
let connectionCheckInProgress = false;


/*
 * Aktualny stan połączenia.
 */
let connectionLost = false;


/*
 * Maksymalny czas oczekiwania na /status.
 *
 * Jeżeli urządzenie nie odpowie przez 2,5 sekundy,
 * uznajemy tę JEDNĄ próbę za nieudaną.
 */
const CONNECTION_TIMEOUT = 2500;


/*
 * Ile NIEUDANYCH PRÓB Z RZĘDU jest potrzebne, zanim uznamy
 * połączenie za faktycznie utracone i pokażemy pełnoekranowy
 * komunikat błędu. Pojedyncza chwilowa nieudana próba (np.
 * krótki zanik WiFi, zajęty czujnik) NIE przełącza już ekranu -
 * dopiero tyle prób z rzędu.
 */
const CONNECTION_FAILURE_THRESHOLD = 3;


/*
 * Odstęp między kolejnymi próbami PO nieudanej próbie - wolniejszy
 * niż standardowe 3 s, żeby nie zasypywać urządzenia zapytaniami
 * w trakcie przejściowych problemów z połączeniem.
 */
const CONNECTION_RETRY_INTERVAL = 15000;


/*
 * Licznik nieudanych prób z rzędu (zerowany po każdej udanej
 * próbie i przy starcie monitora).
 */
let consecutiveConnectionFailures = 0;


/*
 * Aktualizacja wyglądu stanu połączenia.
 */
function updateConnection(ok) {

    const dot =
        getElement("connection-dot");


    const errorBox =
        getElement("connection-error");


    const normalContent =
        getElement("normal-content");


    /*
     * Kropka w nagłówku - tylko na CZERWONO przy calkowitej utracie
     * polaczenia ze strona (rx/tx sa wtedy i tak nieznane). Kolor
     * przy poprawnym polaczeniu ustala updateConnectionDot() na
     * podstawie /info (zielona/zolta/czerwona wg rx/tx czujnika).
     */

    if (!ok && dot) {

        dot.classList.remove(
            "online",
            "warning"
        );

        dot.classList.add(
            "offline"
        );
    }


    /*
     * Normalna zawartość strony.
     *
     * Przy poprawnym połączeniu pokazujemy panel.
     * Przy utracie połączenia ukrywamy go.
     */

    if (normalContent) {
        normalContent.hidden = !ok;
    }


    /*
     * Komunikat o utracie połączenia.
     */

    if (errorBox) {
        errorBox.hidden = ok;
    }


    connectionLost = !ok;
}


/*
 * Zatrzymanie monitora.
 */
function stopConnectionMonitor() {

    if (connectionMonitorTimer !== null) {

        clearTimeout(
            connectionMonitorTimer
        );

        connectionMonitorTimer = null;
    }
}


/*
 * Jedno sprawdzenie połączenia.
 *
 * WAŻNE:
 *
 * Funkcja ma timeout.
 *
 * Dzięki temu sytuacja:
 *
 * urządzenie OFF
 *       ↓
 * fetch czeka
 *       ↓
 * timeout
 *
 * nie będzie trwała w nieskończoność.
 */
async function checkConnection() {

    /*
     * Nie uruchamiamy dwóch sprawdzeń
     * jednocześnie.
     */

    if (connectionCheckInProgress) {

        return null;
    }


    connectionCheckInProgress = true;


    const controller =
        new AbortController();


    const timeout =
        setTimeout(
            function() {

                controller.abort();

            },
            CONNECTION_TIMEOUT
        );


    try {

        console.log(
            "Sprawdzanie połączenia..."
        );


        const response =
            await fetch(
                "/status",
                {
                    cache: "no-store",
                    signal: controller.signal
                }
            );


        /*
         * HTTP != 2xx
         */

        if (!response.ok) {

            throw new Error(
                "HTTP " +
                response.status
            );
        }


        /*
         * Odczyt JSON.
         */

        const data =
            await response.json();


        /*
         * Wszystko OK.
         */

        updateStatus(data);

        updateConnection(true);


        console.log(
            "Połączenie OK"
        );


        return true;

    } catch (error) {

        /*
         * Timeout.
         */

        if (error.name === "AbortError") {

            console.error(
                "CONNECTION ERROR: timeout po " +
                CONNECTION_TIMEOUT +
                " ms"
            );

        } else {

            console.error(
                "CONNECTION ERROR:",
                error
            );
        }


        /*
         * UWAGA: NIE pokazujemy tu jeszcze komunikatu o błędzie
         * i NIE zatrzymujemy monitora - to pojedyncza nieudana
         * próba, mogąca być chwilowym zanikiem połączenia. Decyzję,
         * czy uznać połączenie za faktycznie utracone (dopiero po
         * CONNECTION_FAILURE_THRESHOLD próbach z rzędu), podejmuje
         * monitorConnection().
         */

        return false;

    } finally {

        clearTimeout(
            timeout
        );

        connectionCheckInProgress = false;
    }
}


/*
 * Uruchomienie monitora połączenia.
 */
function startConnectionMonitor() {

    /*
     * Usuwamy ewentualny poprzedni timer.
     */

    stopConnectionMonitor();


    /*
     * Świeży start - zerujemy licznik nieudanych prób.
     */

    consecutiveConnectionFailures = 0;


    /*
     * Pierwsze sprawdzenie od razu.
     */

    monitorConnection();
}


/*
 * Wykonuje jedno sprawdzenie.
 *
 * Jeżeli jest OK, zeruje licznik nieudanych prób i planuje
 * następne sprawdzenie za 3 sekundy.
 *
 * Jeżeli jest błąd, liczy nieudane próby z rzędu - dopiero po
 * CONNECTION_FAILURE_THRESHOLD takich próbach pokazuje ekran
 * błędu i zatrzymuje monitor (patrz CONNECTION_FAILURE_THRESHOLD
 * i CONNECTION_RETRY_INTERVAL na górze pliku). Wcześniejsze
 * nieudane próby ponawia po prostu wolniej, bez przełączania UI.
 */
async function monitorConnection() {

    /*
     * Jeżeli połączenie jest już utracone,
     * niczego nie robimy.
     */

    if (connectionLost) {

        stopConnectionMonitor();

        return;
    }


    const connected =
        await checkConnection();


    if (connected === true) {

        consecutiveConnectionFailures = 0;

        connectionMonitorTimer =
            setTimeout(
                monitorConnection,
                3000
            );

        return;
    }


    /*
     * Nieudana próba.
     */

    consecutiveConnectionFailures++;

    if (consecutiveConnectionFailures >= CONNECTION_FAILURE_THRESHOLD) {

        /*
         * Dopiero teraz - po tylu próbach z rzędu - uznajemy
         * połączenie za faktycznie utracone.
         */

        updateConnection(false);

        stopConnectionMonitor();

        return;
    }


    /*
     * Jeszcze nie osiągnięto progu - próbujemy ponownie, ale
     * wolniej niż przy normalnym monitorowaniu.
     */

    connectionMonitorTimer =
        setTimeout(
            monitorConnection,
            CONNECTION_RETRY_INTERVAL
        );
}


function sleep(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}


/*
 * Pierwsze połączenie przy wejściu na stronę - te same zasady
 * co monitorConnection() (CONNECTION_FAILURE_THRESHOLD prób,
 * CONNECTION_RETRY_INTERVAL między nimi), ale jako pojedyncza
 * pętla z wynikiem, bo dalszy kod (fetchInfo/fetchHistory) czeka
 * na rozstrzygnięcie, zanim zacznie normalny monitoring.
 */
async function establishInitialConnection() {

    for (
        let attempt = 0;
        attempt < CONNECTION_FAILURE_THRESHOLD;
        attempt++
    ) {

        const connected =
            await checkConnection();

        if (connected === true) {
            return true;
        }

        if (attempt < CONNECTION_FAILURE_THRESHOLD - 1) {
            await sleep(CONNECTION_RETRY_INTERVAL);
        }
    }

    updateConnection(false);

    return false;
}


/*
 * Ręczna próba ponownego połączenia.
 *
 * WYWOŁYWANA TYLKO przez przycisk.
 */
async function retryConnection() {

    const retryButton =
        getElement("connection-retry");


    if (retryButton) {

        retryButton.disabled = true;

        retryButton.textContent =
            "Sprawdzanie połączenia…";
    }


    /*
     * Pozwalamy na wykonanie jednej próby.
     */

    connectionLost = false;


    const connected =
        await checkConnection();


    if (connected === true) {

        /*
         * Połączenie odzyskane.
         *
         * Pobieramy aktualne informacje.
         */

        await fetchInfo();


        /*
         * Odświeżamy historię.
         */

        await fetchHistory();


        /*
         * Ponownie uruchamiamy monitor.
         */

        startConnectionMonitor();

    } else {

        /*
         * Nadal brak połączenia.
         *
         * Komunikat pozostaje.
         */

        connectionLost = true;
    }


    if (retryButton) {

        retryButton.disabled = false;

        retryButton.textContent =
            "Spróbuj ponownie";
    }
}


/* =========================================================
   HISTORY - ZAKRESY ODLEGLOSCI

   Wpis historii niesie tylko min/max odleglosci ruchu i obecnosci
   statycznej z calego okresu (item.moving.distance /
   item.stationary.distance = {min, max} albo null). W TRYBIE DEBUG
   dodatkowo item.moving.by_channel / item.stationary.by_channel =
   {energy_min: [9], energy_max: [9]} - energia per bramka 0-8.
   Ten sam ksztalt ma "current.details" ze /status (biezacy wpis).
   ========================================================= */

const RANGE_CHANNELS = [
    { key: "moving", label: "Ruch" },
    { key: "stationary", label: "Obecność statyczna" },
];


function distanceRangeTable(item) {

    let body = "";
    let hasData = false;

    RANGE_CHANNELS.forEach(function(channel) {

        const range =
            readValue(item, channel.key + ".distance", null);

        if (range) {
            hasData = true;
        }

        body += `
            <tr>

                <td class="measurement-time">
                    ${escapeHtml(channel.label)}
                </td>

                <td class="measurement-distance">
                    ${range ? formatNumber(range.min, 0) : "&mdash;"}
                </td>

                <td class="measurement-distance">
                    ${range ? formatNumber(range.max, 0) : "&mdash;"}
                </td>

            </tr>
        `;
    });

    if (!hasData) {

        return `
            <div class="history-empty">
                Brak odczytów odległości.
            </div>
        `;
    }

    return `
        <div class="history-measurements-wrapper">

            <table class="history-measurements">

                <thead>
                    <tr>
                        <th>Kanał</th>
                        <th>Odległość min.</th>
                        <th>Odległość maks.</th>
                    </tr>
                </thead>

                <tbody>
                    ${body}
                </tbody>

            </table>

        </div>
    `;
}


/*
 * Tryb debug: min/max energii w kazdej z bramek 0-8 (ruch i obecnosc
 * statyczna). Zwraca "" gdy wpis nie ma danych debug.
 */
function channelEnergyTable(item) {

    const moving =
        readValue(item, "moving.by_channel", null);

    const stationary =
        readValue(item, "stationary.by_channel", null);

    if (!moving && !stationary) {
        return "";
    }

    function cell(source, field, gate) {

        const values = source && source[field];

        if (!Array.isArray(values) || values[gate] === undefined) {
            return "&mdash;";
        }

        return formatNumber(values[gate], 0);
    }

    let body = "";

    for (let gate = 0; gate < GATE_COUNT; gate++) {

        body += `
            <tr>

                <td class="measurement-number">${gate}</td>

                <td class="measurement-distance">
                    ${gate * CM_PER_GATE}&ndash;${(gate + 1) * CM_PER_GATE}
                </td>

                <td class="measurement-energy">
                    ${cell(moving, "energy_min", gate)}
                </td>

                <td class="measurement-energy">
                    ${cell(moving, "energy_max", gate)}
                </td>

                <td class="measurement-energy">
                    ${cell(stationary, "energy_min", gate)}
                </td>

                <td class="measurement-energy">
                    ${cell(stationary, "energy_max", gate)}
                </td>

            </tr>
        `;
    }

    return `
        <div class="history-measurements-wrapper">

            <table class="history-measurements">

                <thead>

                    <tr>
                        <th>Kanał</th>
                        <th>Zakres</th>
                        <th colspan="2">Ruch</th>
                        <th colspan="2">Obecność statyczna</th>
                    </tr>

                    <tr class="history-measurements-subhead">
                        <th></th>
                        <th></th>
                        <th>Min.</th>
                        <th>Maks.</th>
                        <th>Min.</th>
                        <th>Maks.</th>
                    </tr>

                </thead>

                <tbody>
                    ${body}
                </tbody>

            </table>

        </div>
    `;
}


/*
 * Sekcje szczegolow (zakresy odleglosci + ewentualnie energia per
 * kanal) - wspolne dla listy historii i dla biezacego wpisu.
 */
function rangeDetailSections(item) {

    let html = `

        <div class="history-detail-section">

            <div class="history-detail-section-title">
                Zakresy odległości
            </div>

            <div class="history-detail-section-content">
                ${distanceRangeTable(item)}
            </div>

        </div>

    `;

    const energyTable = channelEnergyTable(item);

    if (energyTable) {

        html += `

            <div class="history-detail-section">

                <div class="history-detail-section-title">
                    Energia per kanał (debug)
                </div>

                <div class="history-detail-section-content">
                    ${energyTable}
                </div>

            </div>

        `;
    }

    return html;
}


/* =========================================================
   HISTORY RENDER
   ========================================================= */

function buildPaginationControls(
    page,
    totalPages
) {

    if (!totalPages || totalPages <= 1) {
        return "";
    }


    const prevDisabled =
        page <= 1
            ? "disabled"
            : "";


    const nextDisabled =
        page >= totalPages
            ? "disabled"
            : "";


    return `
        <div class="history-pagination">

            <button
                type="button"
                class="history-page-prev"
                ${prevDisabled}
            >
                &larr; Poprzednia
            </button>

            <span class="history-page-info">
                Strona ${page} / ${totalPages}
            </span>

            <button
                type="button"
                class="history-page-next"
                ${nextDisabled}
            >
                Następna &rarr;
            </button>

        </div>
    `;
}


/*
 * Zajetosc puli historii ("Pula: 18 / 30 · 12 na liście") - pozwala
 * zauwazyc, ze pula jest pelna i stare wpisy wypadaja przed 24 h.
 */
function updateHistoryPool(data) {

    const element =
        getElement("history-pool");


    if (!element) {
        return;
    }


    if (
        !data ||
        typeof data.pool !== "number" ||
        typeof data.pool_max !== "number"
    ) {

        element.textContent = "";

        return;
    }


    element.textContent =
        "Pula: " +
        data.pool +
        " / " +
        data.pool_max +
        (
            typeof data.total === "number"
                ? " · " + data.total + " na liście"
                : ""
        );
}


function updateHistory(
    history,
    page,
    totalPages
) {

    const container =
        getElement("history");


    if (!container) {
        return;
    }


    if (
        !Array.isArray(history) ||
        history.length === 0
    ) {

        container.innerHTML = `
            <div class="history-empty">
                Brak poprzednich stanów.
            </div>
        `;

        return;
    }


    let html = "";


    /*
     * Backend wysyla juz najnowsze-pierwsze.
     */

    const items =
        history;


    items.forEach(function(item, index) {

        const detected =
            item.detected === true;

        const commLost =
            item.comm_lost === true;

        const poweredOff =
            item.powered_off === true;


        const statusClass =
            commLost
                ? "comm-lost"
                : poweredOff
                    ? "powered-off"
                    : detected
                        ? "detected"
                        : "not-detected";


        const statusText =
            commLost
                ? "BRAK KOMUNIKACJI"
                : poweredOff
                    ? "WYŁĄCZONY"
                    : detected
                        ? "WYKRYTA OBECNOŚĆ"
                        : "BRAK OBECNOŚCI";


        /*
         * Kolor wg czasu trwania tylko dla
         * wykrytej obecności.
         */

        const statusColorStyle =
            detected
                ? `style="color:${durationColor(
                    item.duration ?? item.duration_s
                )}"`
                : "";


        const borderColor =
            commLost
                ? "var(--danger)"
                : poweredOff
                    ? "var(--text-faint)"
                    : detected
                        ? durationColor(
                            item.duration ?? item.duration_s
                        )
                        : "var(--hairline)";


        const startedAt =
            item.started_at_local &&
            item.started_at_local !== "brak czasu"
                ? item.started_at_local
                : "brak czasu";


        const duration =
            formatDuration(
                item.duration ?? item.duration_s
            );


        /*
         * Rozwijane szczegoly (zakresy odleglosci) maja sens TYLKO
         * dla WYKRYTA OBECNOSC/BRAK OBECNOSCI - wpisy BRAK
         * KOMUNIKACJI/WYLACZONY nie maja zadnych zarejestrowanych
         * odczytow odleglosci, wiec rozwijanie pokazaloby tylko
         * pusty komunikat "brak danych". Takie wpisy renderujemy
         * wiec jako zwykly, nieklikalny wiersz - bez szewronu i
         * bez <details>/<summary>.
         */

        const expandable =
            !commLost &&
            !poweredOff;


        /*
         * "Pomijaj podobne" - tylko dla KROTKICH wpisow WYKRYTO
         * (ten sam prog co niebieski kolor w durationColor()) - to
         * one sa kandydatami na szum/falszywe wykrycia, ktore warto
         * masowo odfiltrowac (patrz openHistoryFilterModal()).
         */

        const showSkipButton =
            detected &&
            (Number(item.duration ?? item.duration_s) || 0) < 60;


        const summaryContent = `
            <div class="history-summary">

                <div class="
                    history-summary-status
                    ${statusClass}
                "
                ${statusColorStyle}>

                    ${statusText}

                </div>


                <div class="
                    history-summary-start
                ">
                    ${escapeHtml(
                        startedAt
                    )}
                </div>


                <div class="
                    history-summary-duration
                ">
                    ${escapeHtml(
                        duration
                    )}
                </div>

            </div>
        `;


        if (expandable) {

            html += `

                <details
                    class="history-item"
                    style="border-left-color:${borderColor}"
                >

                    <summary class="history-item-summary">
                        ${summaryContent}
                    </summary>


                    <div class="history-item-detail">

                        ${rangeDetailSections(item)}

                        ${
                            showSkipButton
                                ? `
                                    <button
                                        type="button"
                                        class="history-skip-button"
                                        data-item-index="${index}"
                                    >
                                        Pomijaj podobne
                                    </button>
                                `
                                : ""
                        }

                    </div>

                </details>

            `;

        } else {

            html += `

                <div
                    class="history-item"
                    style="border-left-color:${borderColor}"
                >

                    <div class="history-item-summary no-chevron">
                        ${summaryContent}
                    </div>

                </div>

            `;
        }
    });


    html +=
        buildPaginationControls(
            page,
            totalPages
        );


    container.innerHTML =
        html;


    const prevButton =
        container.querySelector(
            ".history-page-prev"
        );


    const nextButton =
        container.querySelector(
            ".history-page-next"
        );


    if (prevButton) {

        prevButton.addEventListener(
            "click",
            function() {

                fetchHistory(
                    page - 1
                );

            }
        );
    }


    if (nextButton) {

        nextButton.addEventListener(
            "click",
            function() {

                fetchHistory(
                    page + 1
                );

            }
        );
    }


    container.querySelectorAll(
        ".history-skip-button"
    ).forEach(function(button) {

        button.addEventListener(
            "click",
            function(event) {

                event.preventDefault();

                const itemIndex = Number(
                    button.dataset.itemIndex
                );

                openHistoryFilterModal(
                    items[itemIndex]
                );
            }
        );
    });
}


/* =========================================================
   MODAL: POMIJAJ PODOBNE ODCZYTY
   ========================================================= */

let historyFilterOptionsData = [];


/*
 * Znajduje bramke (gate) z NAJWYZSZYM zanotowanym poziomem energii
 * w tym wpisie, dla danego kanalu ("Ruch" albo "Obecność"). Dane
 * per bramka istnieja tylko we wpisach TRYBU DEBUG (by_channel) -
 * dla zwyklych wpisow zwraca null (wtedy modal oferuje tylko
 * filtr wg czasu trwania).
 */
function computePeakForChannel(item, channelLabel) {

    const key =
        channelLabel === "Ruch"
            ? "moving"
            : "stationary";

    const energies =
        readValue(item, key + ".by_channel.energy_max", null);

    if (!Array.isArray(energies)) {
        return null;
    }

    let best = null;

    energies.forEach(function(energy, gate) {

        energy = Number(energy) || 0;

        if (energy > 0 && (!best || energy > best.maxEnergy)) {

            best = {
                gate: gate,
                maxEnergy: energy,
            };
        }
    });

    return best;
}


async function openHistoryFilterModal(item) {

    const modal = getElement("history-filter-modal");
    const optionsContainer = getElement("history-filter-options");
    const message = getElement("history-filter-message");

    if (!modal || !optionsContainer) {
        return;
    }

    if (message) {
        message.textContent = "";
        message.classList.remove("error", "success");
    }

    optionsContainer.innerHTML = `
        <div class="history-empty">Wczytywanie…</div>
    `;

    modal.hidden = false;

    const durationSeconds = Math.max(
        1,
        Math.ceil(Number(item.duration ?? item.duration_s) || 0)
    );

    const motionPeak = computePeakForChannel(item, "Ruch");
    const stationaryPeak = computePeakForChannel(item, "Obecność");

    let motionCurrent = null;
    let stationaryCurrent = null;

    try {

        const response = await fetch(
            "/settings",
            { cache: "no-store" }
        );

        if (response.ok) {

            const data = await response.json();
            const sensitivities = data.sensitivities || {};

            if (motionPeak && Array.isArray(sensitivities.motion)) {
                motionCurrent = Number(
                    sensitivities.motion[motionPeak.gate]
                );
            }

            if (stationaryPeak && Array.isArray(sensitivities.static)) {
                stationaryCurrent = Number(
                    sensitivities.static[stationaryPeak.gate]
                );
            }
        }

    } catch (error) {
        console.error("SETTINGS FETCH ERROR:", error);
    }

    const options = [];

    options.push({
        value: "duration",
        label: `Odczyty z czasem ${durationSeconds} s lub krótszym`,
        data: { type: "duration", seconds: durationSeconds }
    });

    /*
     * Opcje poziomu energii pokazujemy TYLKO, gdy przekraczaja
     * aktualnie skonfigurowana czulosc danej bramki - w przeciwnym
     * razie ten odczyt juz powinien byc odfiltrowany dzisiejsza
     * konfiguracja, wiec podnoszenie progu nie mialoby sensu.
     */

    if (
        motionPeak &&
        Number.isFinite(motionCurrent) &&
        motionPeak.maxEnergy > motionCurrent
    ) {

        const level = Math.min(
            100,
            Math.ceil(motionPeak.maxEnergy)
        );

        options.push({
            value: "motion",
            label: `Odczyty z poziomem ${level} lub mniejszym dla ruchu (bramka ${motionPeak.gate})`,
            data: { type: "motion", gate: motionPeak.gate, level: level }
        });
    }

    if (
        stationaryPeak &&
        Number.isFinite(stationaryCurrent) &&
        stationaryPeak.maxEnergy > stationaryCurrent
    ) {

        const level = Math.min(
            100,
            Math.ceil(stationaryPeak.maxEnergy)
        );

        options.push({
            value: "stationary",
            label: `Odczyty z poziomem ${level} lub mniejszym dla obecności (bramka ${stationaryPeak.gate})`,
            data: { type: "stationary", gate: stationaryPeak.gate, level: level }
        });
    }

    historyFilterOptionsData = options;

    optionsContainer.innerHTML = options.map(function(option, index) {

        return `
            <label class="modal-option">
                <input
                    type="radio"
                    name="history-filter-option"
                    value="${option.value}"
                    ${index === 0 ? "checked" : ""}
                >
                <span>${escapeHtml(option.label)}</span>
            </label>
        `;
    }).join("");
}


function closeHistoryFilterModal() {

    const modal = getElement("history-filter-modal");

    if (modal) {
        modal.hidden = true;
    }
}


async function confirmHistoryFilter() {

    const selected = document.querySelector(
        'input[name="history-filter-option"]:checked'
    );

    if (!selected) {
        return;
    }

    const option = historyFilterOptionsData.find(function(candidate) {
        return candidate.value === selected.value;
    });

    if (!option) {
        return;
    }

    const message = getElement("history-filter-message");
    const confirmButton = getElement("history-filter-confirm");

    if (message) {
        message.textContent = "Zapisywanie…";
        message.classList.remove("error", "success");
    }

    if (confirmButton) {
        confirmButton.disabled = true;
    }

    const params = new URLSearchParams();

    if (option.data.type === "duration") {

        params.set("min_presence_s", option.data.seconds);

    } else if (option.data.type === "motion") {

        params.set("motion_" + option.data.gate, option.data.level);

    } else if (option.data.type === "stationary") {

        params.set("static_" + option.data.gate, option.data.level);
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
            message.textContent = "Zapisano.";
            message.classList.remove("error");
            message.classList.add("success");
        }

        setTimeout(function() {
            closeHistoryFilterModal();
            fetchHistory();
        }, 600);

    } catch (error) {

        console.error("HISTORY FILTER ERROR:", error);

        if (message) {
            message.textContent = "Błąd zapisu: " + error.message;
            message.classList.remove("success");
            message.classList.add("error");
        }

    } finally {

        if (confirmButton) {
            confirmButton.disabled = false;
        }
    }
}


const historyFilterModal =
    getElement("history-filter-modal");

const historyFilterCancelButton =
    getElement("history-filter-cancel");

const historyFilterConfirmButton =
    getElement("history-filter-confirm");


if (historyFilterCancelButton) {

    historyFilterCancelButton.addEventListener(
        "click",
        closeHistoryFilterModal
    );
}


if (historyFilterConfirmButton) {

    historyFilterConfirmButton.addEventListener(
        "click",
        confirmHistoryFilter
    );
}


if (historyFilterModal) {

    historyFilterModal.addEventListener(
        "click",
        function(event) {

            if (event.target === historyFilterModal) {
                closeHistoryFilterModal();
            }
        }
    );
}


document.addEventListener(
    "keydown",
    function(event) {

        if (
            event.key === "Escape" &&
            historyFilterModal &&
            !historyFilterModal.hidden
        ) {
            closeHistoryFilterModal();
        }
    }
);


/* =========================================================
   FETCH INFO
   ========================================================= */

async function fetchInfo() {

    try {

        const response =
            await fetch(
                "/info",
                {
                    cache: "no-store"
                }
            );


        if (!response.ok) {

            throw new Error(
                "HTTP " +
                response.status
            );
        }


        const data =
            await response.json();


        updateInfo(data);


        return data;

    } catch (error) {

        console.error(
            "INFO ERROR:",
            error
        );


        return null;
    }
}


/* =========================================================
   FETCH HISTORY
   ========================================================= */

async function fetchHistory(page) {

    page =
        page || 1;


    const container =
        getElement("history");

    const minPresenceS =
        Number(
            document.querySelector("#filter-indicator")?.textContent?.match(/\d+/)?.[0] || 0
        );

    try {

        const response =
            await fetch(
                "/history-data?page=" +
                page +
                "&min_presence_s=" +
                minPresenceS,
                {
                    cache: "no-store"
                }
            );


        if (!response.ok) {

            throw new Error(
                "HTTP " +
                response.status
            );
        }


        const data =
            await response.json();


        /*
         * Obsługujemy zarówno:
         *
         * [
         *     ...
         * ]
         *
         * jak i:
         *
         * {
         *     history: [...]
         * }
         */

        const history =
            Array.isArray(data)
                ? data
                : data.history;


        const currentPage =
            data.page ||
            page;


        const totalPages =
            data.total_pages ||
            1;


        updateHistoryPool(data);


        updateHistory(
            history,
            currentPage,
            totalPages
        );


        return history;

    } catch (error) {

        console.error(
            "HISTORY ERROR:",
            error
        );


        if (container) {

            container.innerHTML = `
                <div class="history-empty">
                    Nie udało się pobrać poprzednich stanów.
                </div>
            `;
        }


        return null;
    }
}


/* =========================================================
   REFRESH NOW
   ========================================================= */

async function refreshNow() {

    /*
     * Status + info równolegle.
     *
     * Historia osobno.
     */

    await Promise.all([
        checkConnection(),
        fetchInfo()
    ]);
}


/* =========================================================
   CONNECTION RETRY BUTTON
   ========================================================= */

const connectionRetryButton =
    getElement("connection-retry");


if (connectionRetryButton) {

    connectionRetryButton.addEventListener(
        "click",
        function() {

            retryConnection();

        }
    );
}


/* =========================================================
   START
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async function() {

        /*
         * NAJWAŻNIEJSZE:
         *
         * Najpierw sprawdzamy /status.
         *
         * Dopiero gdy urządzenie odpowie,
         * pobieramy /info i historię.
         *
         * Dzięki temu pierwsze wejście na stronę
         * nie pokazuje fałszywego ekranu błędu.
         */

        connectionLost = false;


        const connected =
            await establishInitialConnection();


        /*
         * Urządzenie nie odpowiada po
         * CONNECTION_FAILURE_THRESHOLD próbach.
         *
         * establishInitialConnection() już pokazało
         * ekran utraty połączenia.
         *
         * Nie próbujemy wtedy pobierać
         * /info ani historii.
         */

        if (connected !== true) {

            return;
        }


        /*
         * Połączenie jest poprawne.
         *
         * Teraz pobieramy informacje
         * i historię.
         */

        await Promise.all([
            fetchInfo(),
            fetchHistory()
        ]);

        checkForAppUpdate();


        /*
         * Uruchamiamy monitor.
         */

        startConnectionMonitor();

    }
);


/* =========================================================
   MENU
   ========================================================= */

const menuButton =
    getElement("menu-button");


const menuDropdown =
    getElement("menu-dropdown");


if (
    menuButton &&
    menuDropdown
) {

    menuButton.addEventListener(
        "click",
        function(event) {

            event.stopPropagation();


            const isOpen =
                !menuDropdown.hidden;


            menuDropdown.hidden =
                isOpen;


            menuButton.setAttribute(
                "aria-expanded",
                isOpen
                    ? "false"
                    : "true"
            );
        }
    );


    document.addEventListener(
        "click",
        function(event) {

            if (menuDropdown.hidden) {
                return;
            }


            if (
                !menuDropdown.contains(
                    event.target
                ) &&
                event.target !== menuButton
            ) {

                menuDropdown.hidden =
                    true;


                menuButton.setAttribute(
                    "aria-expanded",
                    "false"
                );
            }
        }
    );


    document.addEventListener(
        "keydown",
        function(event) {

            if (
                event.key === "Escape" &&
                !menuDropdown.hidden
            ) {

                menuDropdown.hidden =
                    true;


                menuButton.setAttribute(
                    "aria-expanded",
                    "false"
                );
            }
        }
    );
}
