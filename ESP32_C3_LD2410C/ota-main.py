from machine import UART, Pin
import time
import gc
import ujson as json

import wifi_setup
import sensor_protocol

from config import (
    NTP_RETRY_INTERVAL_S,
    NTP_RETRY_MAX_ATTEMPTS,
    NTP_DAILY_RESYNC_HOUR_UTC,
    MEM_LOG_INTERVAL_S,
    WIFI_CHECK_INTERVAL_S,
    WIFI_RECONNECT_FAILURE_THRESHOLD,
    WIFI_RECONNECT_TIMEOUT_S,
)
# UWAGA: "import http_server", "import state_tracking" i
# "import calibration" CELOWO NIE sa tutaj, na samej gorze - patrz
# duzy komentarz przy "MODULY ODROCZONE" ponizej (po polaczeniu WiFi).
# Tutaj zostaje TYLKO to, co jest naprawde potrzebne PRZED
# wifi_connect(): sensor_protocol (do configure_sensor() ponizej),
# sam wifi_setup i garstka stalych z config (bez wagi dla RAM -
# to tylko literaly, config.py i tak jest juz importowany przez
# sensor_protocol/wifi_setup).


# ============================================================
# BLE MAC - JEDNA proba, W IZOLACJI, ZANIM WiFi w ogole zostanie
# wlaczone.
#
# UWAGA: poprzednia proba (PO polaczeniu WiFi, w trakcie obslugi
# requestu /device-info) konczyla sie twardym crashem firmware'u
# (Guru Meditation Error / Store access fault) - WiFi i BLE dziela
# na ESP32-C3 JEDNO radio 2.4GHz, a aktywacja BLE przy juz aktywnym
# WiFi najwyrazniej uszkadzala pamiec. Robimy wiec teraz odczyt
# TUTAJ - zanim jakikolwiek kod w ogole dotknie WiFi - zeby
# wyeliminowac wlasnie te kolizje.
#
# ZABEZPIECZENIE PRZED PETLA RESTARTOW: taki twardy crash to awaria
# na poziomie C, NIE wyjatek Pythona - zaden try/except go nie
# zlapie. Gdyby WIEC ta proba TEZ mialaby sie tak konczyc, zapisujemy
# "zamiar proby" do pliku ZANIM w ogole dotkniemy radia BLE (nie
# PO odczycie) - dzieki temu kolejny restart zobaczy juz istniejacy
# plik i NIGDY WIECEJ nie powtorzy proby, zamiast wpasc w
# nieskonczona petle restartow. Kosztem jest NAJWYZEJ jeden dodatkowy
# restart w calej historii urzadzenia (usun plik ble_info.json przez
# mpremote, jesli kiedys zechcesz spróbowac ponownie, np. po
# aktualizacji firmware MicroPython).
# ============================================================

BLE_INFO_FILE = "ble_info.json"


def _try_cache_ble_mac_once():

    try:
        with open(BLE_INFO_FILE):
            pass

        return  # juz probowane (udanie lub nie) - nie powtarzamy

    except Exception:
        pass

    try:
        with open(BLE_INFO_FILE, "w") as f:
            json.dump({"mac": None}, f)

    except Exception as exc:
        print("BLE MAC: zapis markera nieudany, pomijam probe:", exc)
        return

    try:
        import bluetooth

        ble = bluetooth.BLE()
        ble.active(True)

        try:
            _addr_type, addr_bytes = ble.config("mac")

            mac = ":".join(
                "{:02X}".format(value)
                for value in addr_bytes
            )

        finally:

            try:
                ble.active(False)
            except Exception:
                pass

        with open(BLE_INFO_FILE, "w") as f:
            json.dump({"mac": mac}, f)

        print("BLE MAC:", mac)

    except Exception as exc:
        print("BLE MAC: odczyt nieudany:", exc)


_try_cache_ble_mac_once()


# ============================================================
# PRZEKAZNIK BLE (BLE Hub) - BLE wlaczane PRZED WiFi, patrz
# komentarz powyzej i naglowek ble_relay.py. Domyslnie wylaczony
# (BLE_RELAY_ENABLED w config.py) - wtedy nie dotyka radia.
# ============================================================

import ble_relay

ble_relay.start_early()


# ============================================================
# UART LD2410C
# ============================================================

UART_RX = 4
UART_TX = 3
BAUD = 256000


uart = UART(
    1,
    baudrate=BAUD,
    bits=8,
    parity=None,
    stop=1,
    rx=Pin(UART_RX),
    tx=Pin(UART_TX),
    timeout=20,
    # Bufor alokowany z pamieci ESP-IDF (nie ze sterty MicroPythona) -
    # tej samej, z ktorej korzysta WiFi/lwIP, a jej brak gubi pakiety
    # sieciowe. 1024 B to ok. 1-2 s ramek czujnika przy zablokowanej petli
    # (przy przepelnieniu gubione sa najstarsze ramki, parser sie odnajduje).
    rxbuf=1024
)


# ============================================================
# KONFIGURACJA CZUJNIKA
#
# UWAGA: to wywolanie ZAGINELO w tej wersji main.py (bylo obecne
# w main_org.py) - bez niego czulosci bramek i no_one_duration
# z config.py NIGDY nie byly wysylane do fizycznego czujnika,
# ktory dzialal na swoich poprzednich/domyslnych ustawieniach.
# Musi byc PRZED polaczeniem WiFi (mniejsze zuzycie RAM w tym
# krytycznym momencie).
# ============================================================

sensor_protocol.configure_sensor(uart)


# ============================================================
# WIFI
# ============================================================

# Zbierany smieci TUZ PRZED wifi_connect() - odzyskuje pamiec po
# ewentualnych tymczasowych obiektach z configure_sensor() powyzej,
# zeby dac sterownikowi WiFi jak najwiecej wolnego, ciaglego RAM
# w tym krytycznym momencie (patrz duzy komentarz przy "MODULY
# ODROCZONE" ponizej).
gc.collect()

try:
    wlan = wifi_setup.wifi_connect()

except Exception as exc:
    # WiFi nie wstalo przy aktywnym BLE (np. "WiFi Out of Memory") -
    # wylacz przekaznik na stale i uruchom sie od nowa bez niego,
    # zamiast zostac w REPL bez sieci.
    if ble_relay.is_active():
        ble_relay.disable("WiFi nie wstalo przy aktywnym BLE: {}".format(exc))
        import machine
        machine.reset()
    raise


# ============================================================
# MODULY ODROCZONE
#
# UWAGA: importy http_server/state_tracking/calibration CELOWO NIE
# byly na samej gorze pliku razem z reszta - kazdy dodatkowy
# zaimportowany modul to trwaly koszt RAM (skompilowany bajtkod, bo
# pliki .py nie sa tu wstepnie kompilowane/"frozen"), a to WLASNIE w
# momencie wifi_connect() POWYZEJ ESP32-C3 najbardziej potrzebuje
# wolnej pamieci - sterownik WiFi/lwIP ma wtedy wlasna, oddzielna
# pule pamieci do zaalokowania i przy zbyt malo wolnego RAM konczy
# sie to "OSError: WiFi Out of Memory" (patrz tez uwaga przy
# configure_sensor() powyzej - to ten sam powod). Zaden z tych 3
# modulow nie jest potrzebny wczesniej niz TERAZ - dopiero ponizej,
# przy sync_ntp/record_downtime_gap, starcie serwera i w petli
# glownej.
# ============================================================

import http_server
import state_tracking
import calibration
import presence_webhook


_ntp_synced = False
_ntp_attempts = 0
_ntp_next_retry_ms = None

_last_mem_log_ms = time.ticks_ms()

_last_wifi_check_ms = time.ticks_ms()
_wifi_consecutive_failures = 0

_last_ntp_daily_resync_day = None

if wlan:
    _ntp_synced = wifi_setup.sync_ntp()

    # UWAGA: dopiero TERAZ (po probie NTP) znamy prawdziwy czas -
    # jesli wskazuje on, ze od ostatniego zapisu historii minelo
    # istotnie wiecej czasu niz wynikaloby z samego up-time'u tego
    # programu, dopisujemy osobny wpis WYLACZONY (patrz docstring
    # record_downtime_gap() w state_tracking.py).
    state_tracking.record_downtime_gap()

    if not _ntp_synced:

        _ntp_attempts = 1

        _ntp_next_retry_ms = time.ticks_add(
            time.ticks_ms(),
            NTP_RETRY_INTERVAL_S * 1000
        )

        print(
            "BLAD synchronizacji NTP przy starcie - "
            "ponawiam co {}s (pozostalo prob: {})".format(
                NTP_RETRY_INTERVAL_S,
                NTP_RETRY_MAX_ATTEMPTS - _ntp_attempts
            )
        )


# ============================================================
# HTTP SERVER
# ============================================================

gc.collect()

if wlan:

    # Przekazujemy UART do serwera HTTP.
    # Dzięki temu /info może pokazywać stan TX.
    http_server.set_uart(uart)

    # Uruchamiamy serwer.
    http_server.start_server()


# ============================================================
# GŁÓWNA PĘTLA
# ============================================================

while True:

    try:

        sensor_protocol.feed_watchdog()

        # ----------------------------------------------------
        # LD2410C
        #
        # UWAGA: podczas aktywnej kalibracji czujnik jest w TRYBIE
        # INZYNIERSKIM (patrz /calibrate, calibration.py) i wysyla
        # INNY, dluzszy format ramki (surowa energia wszystkich 9
        # bramek naraz) - stad osobna sciezka odczytu ponizej.
        # Normalne sledzenie stanu (agregacja + state_tracking) jest
        # w tym czasie CALKOWICIE pominiete - i tak nie ma sensu
        # dopoki sensor jest w trybie inzynierskim, a kalibracja
        # dostaje dane niezaleznie, bezposrednio z tych ramek.
        # ----------------------------------------------------

        if calibration.is_active():

            frame_data = sensor_protocol.try_read_engineering_frame(
                uart
            )

            if frame_data:

                frame_now = time.ticks_ms()

                sensor_protocol.mark_frame_received()

                calibration.feed_engineering_frame(
                    frame_data,
                    frame_now
                )

        else:

            # Tryb debug historii: czujnik jest w trybie inzynierskim
            # (patrz sensor_protocol.maintain_engineering_mode()), wiec
            # czytamy ramki inzynierskie - niosa te same dane celu co
            # zwykle (stan, dystanse, energie) PLUS energie per bramka,
            # ktore trafiaja do historii.
            if (
                sensor_protocol.current_history_debug_enabled
                and sensor_protocol.engineering_mode_on
            ):

                frame_data = (
                    sensor_protocol.try_read_engineering_frame(uart)
                )

                frame = None

                if frame_data:

                    frame = frame_data["raw"]

                    state_tracking.record_gate_energies(
                        frame_data["motion_energy"],
                        frame_data["static_energy"]
                    )

            else:

                frame = sensor_protocol.try_read_one_frame(uart)

            if frame:

                frame_now = time.ticks_ms()

                # Informujemy sensor_protocol,
                # że otrzymaliśmy poprawną ramkę.
                sensor_protocol.mark_frame_received()

                # Dodajemy ramkę do bufora agregacji.
                sensor_protocol.slot_frame_buffer.append(frame)

                # ------------------------------------------------
                # AGREGACJA OKNA
                # ------------------------------------------------

                if (
                    len(sensor_protocol.slot_frame_buffer)
                    >= sensor_protocol.current_slot_batch_frames
                ):

                    frames_to_process = (
                        sensor_protocol.slot_frame_buffer
                    )

                    # UWAGA: bufor czyścimy NATYCHMIAST, PRZED
                    # przetwarzaniem (nie po nim) - jeśli agregacja/
                    # sledzenie stanu ponizej rzuci wyjatek (np.
                    # chwilowy brak pamieci na rozfragmentowanym
                    # stercie), zewnetrzny except ponizej zloapie go
                    # i petla pojedzie dalej z PUSTYM buforem.
                    # Czyszczenie PO przetwarzaniu (jak bylo
                    # wczesniej) przy takim wyjatku zostawialoby
                    # bufor pelny na stale - kolejna iteracja
                    # probowalaby przetworzyc DOKLADNIE TE SAME (i
                    # tylko rosnace) dane w nieskonczonosc, co
                    # zamienia jedno przejsciowe niepowodzenie w
                    # trwaly zalew identycznych bledow "memory
                    # allocation failed" bez szans na samoistne
                    # wyjscie z petli.
                    sensor_protocol.slot_frame_buffer = []

                    agg = sensor_protocol.aggregate_frames(
                        frames_to_process
                    )

                    state_tracking.update_period_tracking(
                        agg,
                        frame_now,
                        frames_to_process
                    )

                    # Webhook EMS (start/stop) - tu tylko zapamietanie
                    # stanu, wysylka nizej, w presence_webhook.process().
                    presence_webhook.notify(
                        int(agg.get("state", 0)) != 0
                    )

                    gc.collect()

        # ----------------------------------------------------
        # SLEDZENIE KOMUNIKACJI Z CZUJNIKIEM
        #
        # W KAZDEJ iteracji (nie tylko, gdy przyszla ramka) -
        # inaczej utrata komunikacji nigdy nie zostalaby wykryta,
        # bo nic by jej nie zglaszalo. Patrz docstring
        # update_connection_tracking().
        # ----------------------------------------------------

        sensor_connected = sensor_protocol.is_sensor_connected(5)

        state_tracking.update_connection_tracking(
            sensor_connected
        )

        # Bez komunikacji obecnosc nie jest juz znana - zamykamy
        # ewentualna trwajaca obecnosc na serwerze EMS (stop), zamiast
        # zostawiac ja tam "wiszaca" w nieskonczonosc.
        if not sensor_connected:
            presence_webhook.notify(False)

        # ----------------------------------------------------
        # WEBHOOK EMS - wysylka zaleglej zmiany stanu (jesli jest).
        # Blokuje najwyzej na WEBHOOK_TIMEOUT_S, patrz config.py.
        # ----------------------------------------------------

        if wlan:
            presence_webhook.process(wlan.isconnected())

        # Przekaznik BLE - wysylka zebranych adresow do huba (co
        # BLE_RELAY_SEND_INTERVAL_MS, nieblokujaca wysylka UDP).
        ble_relay.process(bool(wlan) and wlan.isconnected())

        # ----------------------------------------------------
        # ODZYSKIWANIE POLACZENIA WiFi (jesli zerwie sie PO
        # starcie) - patrz WIFI_CHECK_INTERVAL_S/
        # WIFI_RECONNECT_FAILURE_THRESHOLD/WIFI_RECONNECT_TIMEOUT_S
        # w config.py. Samo sprawdzenie (isconnected()) jest tanie i
        # nieblokujace - dopiero PO kilku kolejnych nieudanych
        # sprawdzeniach z rzedu probujemy pelnego ponownego
        # polaczenia (co MOZE zablokowac petle na
        # WIFI_RECONNECT_TIMEOUT_S sekund - ale skoro siec i tak juz
        # nie dziala, to akceptowalny kompromis, identyczny w duchu
        # z ponawianiem NTP powyzej).
        # ----------------------------------------------------

        if (
            wlan
            and time.ticks_diff(
                time.ticks_ms(),
                _last_wifi_check_ms
            ) >= WIFI_CHECK_INTERVAL_S * 1000
        ):

            _last_wifi_check_ms = time.ticks_ms()

            if wlan.isconnected():

                _wifi_consecutive_failures = 0

            else:

                _wifi_consecutive_failures += 1

                print(
                    "WiFi: brak polaczenia "
                    "({}/{})".format(
                        _wifi_consecutive_failures,
                        WIFI_RECONNECT_FAILURE_THRESHOLD
                    )
                )

                if (
                    _wifi_consecutive_failures
                    >= WIFI_RECONNECT_FAILURE_THRESHOLD
                ):

                    _wifi_consecutive_failures = 0

                    cfg = wifi_setup.load_wifi_config()

                    if cfg.get("ssid"):

                        print(
                            "WiFi: probuje odzyskac "
                            "polaczenie z '{}'...".format(
                                cfg["ssid"]
                            )
                        )

                        reconnected = wifi_setup.try_connect_sta(
                            cfg["ssid"],
                            cfg.get("password", ""),
                            timeout_s=WIFI_RECONNECT_TIMEOUT_S
                        )

                        if reconnected:

                            wlan = reconnected

                            print(
                                "WiFi: polaczenie odzyskane, "
                                "IP = {}".format(
                                    wlan.ifconfig()[0]
                                )
                            )

                        else:

                            print(
                                "WiFi: nie udalo sie odzyskac "
                                "polaczenia - sprobuje ponownie "
                                "pozniej"
                            )

        # ----------------------------------------------------
        # OCZEKUJACA ZMIANA KONFIGURACJI CZUJNIKA (z /edit)
        #
        # Wysylana TU, poza cyklem zadanie/odpowiedz HTTP - patrz
        # duzy komentarz przy request_sensor_apply() w
        # sensor_protocol.py (dlaczego NIE robimy tego bezposrednio
        # w obsludze POST /edit).
        # ----------------------------------------------------

        sensor_protocol.process_pending_sensor_apply(uart)

        # Okresowy zapis zakresow min/max trwajacego wpisu historii.
        state_tracking.autosave_history_if_due()

        # ----------------------------------------------------
        # OCZEKUJACY RESTART POLACZENIA Z CZUJNIKIEM (z /reset)
        # ----------------------------------------------------

        sensor_protocol.process_pending_sensor_reset(uart)

        # ----------------------------------------------------
        # PONOWIENIE SYNCHRONIZACJI NTP (jesli proba przy starcie
        # sie nie powiodla) - patrz NTP_RETRY_INTERVAL_S/
        # NTP_RETRY_MAX_ATTEMPTS w config.py. sync_ntp() BLOKUJE
        # petle na maks. NTP_SYNC_TIMEOUT_S sekund, ale dzieje sie
        # to co najwyzej co kilka minut, wiec to akceptowalny
        # kompromis (ten sam koszt co pojedyncza proba przy
        # starcie programu).
        # ----------------------------------------------------

        if (
            wlan
            and not _ntp_synced
            and _ntp_attempts < NTP_RETRY_MAX_ATTEMPTS
            and time.ticks_diff(
                time.ticks_ms(),
                _ntp_next_retry_ms
            ) >= 0
        ):

            print(
                "Ponawiam synchronizacje NTP "
                "(proba {}/{})...".format(
                    _ntp_attempts + 1,
                    NTP_RETRY_MAX_ATTEMPTS
                )
            )

            _ntp_synced = wifi_setup.sync_ntp()
            _ntp_attempts += 1

            if _ntp_synced:

                state_tracking.record_downtime_gap()

            else:

                _ntp_next_retry_ms = time.ticks_add(
                    time.ticks_ms(),
                    NTP_RETRY_INTERVAL_S * 1000
                )

        # ----------------------------------------------------
        # CODZIENNA RESYNCHRONIZACJA NTP - zegar RTC ESP32 powoli
        # sie rozjezdza, a bez tego czas byl synchronizowany TYLKO
        # raz, przy starcie (powyzsze ponowienia dotycza WYLACZNIE
        # nieudanej proby przy starcie i nie powtarzaja sie juz po
        # pierwszym sukcesie). Odpalane raz na dzien, o godzinie
        # NTP_DAILY_RESYNC_HOUR_UTC (patrz config.py) - w UTC, zeby
        # nie zalezec od reguly czasu letniego/zimowego.
        # ----------------------------------------------------

        if (
            wlan
            and _ntp_synced
        ):

            try:
                now_tm = time.localtime(
                    time.time()
                )

                current_day = (
                    now_tm[0] * 372
                    + now_tm[1] * 31
                    + now_tm[2]
                )

                current_hour = now_tm[3]

            except Exception:

                current_day = None
                current_hour = None

            if (
                current_hour == NTP_DAILY_RESYNC_HOUR_UTC
                and current_day is not None
                and current_day != _last_ntp_daily_resync_day
            ):

                _last_ntp_daily_resync_day = current_day

                print(
                    "Codzienna resynchronizacja NTP "
                    "(godzina {} UTC)...".format(
                        NTP_DAILY_RESYNC_HOUR_UTC
                    )
                )

                wifi_setup.sync_ntp()

        # ----------------------------------------------------
        # DIAGNOSTYKA PAMIECI - okresowy wydruk wolnego RAM, zeby
        # dalo sie z czasem zauwazyc powolny wyciek pamieci na
        # konsoli/REPL, bez recznego odpytywania gc.mem_free().
        # Patrz MEM_LOG_INTERVAL_S w config.py.
        # ----------------------------------------------------

        if (
            time.ticks_diff(
                time.ticks_ms(),
                _last_mem_log_ms
            ) >= MEM_LOG_INTERVAL_S * 1000
        ):

            _last_mem_log_ms = time.ticks_ms()

            # wolne = przed GC (razem ze smieciami), po_gc = to, co
            # faktycznie trzymaja zywe obiekty - jesli po_gc spada z
            # czasem, to jest wyciek; jesli tylko wolne - to smieci.
            _mem_before_gc = gc.mem_free()
            gc.collect()

            try:
                _wifi_info = "{} rssi={}".format(
                    wlan.isconnected(),
                    wlan.status("rssi")
                ) if wlan else "brak"
            except Exception as exc:
                _wifi_info = "? ({})".format(exc)

            # Pamiec ESP-IDF (poza sterta MicroPythona) - z niej korzysta
            # WiFi/lwIP. Malo wolnego = lwIP po cichu gubi pakiety (w tym
            # ARP), mimo ze isconnected() zwraca True.
            # Format: wolne/najwiekszy_blok/minimum_od_startu.
            try:
                import esp32
                _heaps = esp32.idf_heap_info(esp32.HEAP_DATA)
                _idf_info = "{}/{}/{}".format(
                    sum(h[1] for h in _heaps),
                    max(h[2] for h in _heaps),
                    min(h[3] for h in _heaps)
                )
            except Exception as exc:
                _idf_info = "? ({})".format(exc)

            print(
                "MEM: wolne={} B, po_gc={} B, uptime={} s, "
                "uart_rx={} B, idf={}, wifi={}, ble_relay={}".format(
                    _mem_before_gc,
                    gc.mem_free(),
                    time.ticks_diff(
                        _last_mem_log_ms,
                        state_tracking.BOOT_TICKS_MS
                    ) // 1000,
                    sensor_protocol.uart_rx_bytes,
                    _idf_info,
                    _wifi_info,
                    ble_relay.status_text()
                )
            )

        # ----------------------------------------------------
        # OCZEKUJACA ZMIANA TRYBU INZYNIERSKIEGO (z /calibrate)
        # ----------------------------------------------------

        sensor_protocol.maintain_engineering_mode(
            calibration.is_active(),
            time.ticks_ms()
        )

        sensor_protocol.process_pending_engineering_mode(uart)

        # ----------------------------------------------------
        # HTTP
        # ----------------------------------------------------

        if wlan:
            http_server.poll_server()

    except Exception as e:

        print("MAIN ERROR:", e)

        # Siatka bezpieczenstwa: jesli wyjatek to byl brak pamieci
        # (np. "memory allocation failed" na rozfragmentowanym
        # stercie), wymuszamy zbiorke smieci od razu, zamiast
        # czekac na nastepna okazje (ktora - patrz wyzej - mogla
        # juz nigdy nie nadejsc, gdyby bufor zostal utkniety pelny).
        gc.collect()

    time.sleep_ms(10)