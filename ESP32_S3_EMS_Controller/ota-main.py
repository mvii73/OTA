import time
import gc
import machine

import config
import core.locale as locale
import core.wifi as wifi
import core.server as server
import core.ota as ota
import core.watchdog as watchdog
import ems.ems_service as ems
import storage.ems_data as ems_storage
import ems.control as alg
import ems.schedule as device_schedule
import ems.events as device_events
import ems.forecast_tracking as forecast_tracking
import ems.timing as timing
import ems.loop_stats as loop_stats
import ems.consumption_tracking as consumption_tracking
import ems.rooms_heating as rooms_heating
import ems.water_heater as water_heater
import ems.circulation as circulation
import services.energy_archive_service as energy_archive_service
import services.pse_service as pse
import services.energy_summary as energy_summary
import services.settlement_summary as settlement_summary
import storage.schedule_store as schedule_store
import drivers.uart_zigbee as zigbee
import drivers.deye_rs485 as deye_rs485
import drivers.local_ds18b20 as local_ds18b20
import drivers.oled_status as oled_status
import drivers.deye_service as deye_service
import storage.deye_register_dump as deye_register_dump

last_telemetry = 0
last_mode_check = 0
last_inverter_verify = 0
last_meteo = 0
last_deye_dump_flush = 0
last_zigbee_flush = 0
last_rooms_heating = 0
last_water_heater = 0
last_circulation = 0
last_outdoor_temp = 0
last_energy_summary = 0
last_settlement_summary = 0
last_gateway_poll = 0
last_gas_sample = 0
last_weather_cache = 0
last_backfill_batch = 0
last_registry_refresh = 0
last_current_slot_refresh = 0
last_battery_widget = 0
last_power_poll = 0
last_local_ds18b20 = 0
last_init_day = -1
last_init_retry = 0
last_revision_day = -1        # dzien ostatniego zrzutu prognozy calodobowej (forecast_tracking)
last_tomorrow_init_day = -1   # dzien, w ktorym init() dolaczyl do harmonogramu tabele RCE na jutro
last_tomorrow_check = 0
# zadania po DAILY INIT (historia Deye Cloud za wczoraj) - KAZDE w osobnym obrocie petli
# (main.py::_daily_followup_step()); razem z init() blokowaly petle na 100+ s
# (2026-11-17: czujniki bez odczytu > 30 s -> blokada dogrzewacza, martwy pulpit)
daily_followups = []
last_followup_day = -1
last_init = -1

# True po kazdym przeliczeniu harmonogramu (sekcja ODSWIEZENIA w tick()) -
# sekcja OBLICZENIA w KOLEJNYM obrocie petli od razu stosuje nowy
# harmonogram (ems.check_mode()), bez czekania na jej 60s interwal
schedule_dirty = False
# odczyt telemetrii zrobiony, przeliczenie harmonogramu w nastepnym kroku petli (main.py::tick())
recalc_pending = False

# Ile zadan HTTP maksymalnie obsluzyc pod rzad (server.handle()) przed
# tick() - przegladarka ma pierwszenstwo, ale limit nie pozwala
# zaglodzic sterowania przy ciaglym ruchu
SERVER_MAX_REQUESTS_PER_LOOP = 4


def _rows_lack_tomorrow(now):
    """Czy wiersze harmonogramu (storage/ems_data.py, budowane przez ems.init()) koncza sie
    przed koncem dzisiejszego dnia, czyli nie ma w nich "jutra"."""

    rows = ems_storage.get_data() or []

    return not rows or max(r["end"] for r in rows) <= locale.sod(now) + 86400


def _rows_lack_today(now):
    """Zaden wiersz harmonogramu nie obejmuje biezacej chwili (np. init() nie pobral dzisiejszej
    tabeli RCE - blad sieci/PSE albo niesparsowana odpowiedz) - harmonogram jest pusty."""

    rows = ems_storage.get_data() or []

    return not any(r["start"] <= now < r["end"] for r in rows)


def _tomorrow_ready(now, hour, minute, day):
    """Tabela RCE na jutro jest juz w lokalnym cache (poll_tomorrow() pobral ja pozniej niz okno
    DAILY INIT 13:45-14:59 albo kontroler wstal po nim), a harmonogram jej nie zawiera - wtedy
    harmonogram konczylby sie o polnocy do nastepnego dnia. Sprawdzane najwyzej raz na minute
    (czytanie cache z flash) i tylko dopoki init() nie dolaczyl "jutra" w danym dniu - bez
    zapytan sieciowych: init() po cache'u."""

    global last_tomorrow_check

    if last_tomorrow_init_day == day:
        return False

    if (hour, minute) < (pse.POLL_START_HOUR, pse.POLL_START_MINUTE):
        return False

    if now - last_tomorrow_check < 60:
        return False

    last_tomorrow_check = now

    return _rows_lack_tomorrow(now) and pse.tomorrow_cached()


def _init_due(now, hour, minute, day):
    """Czy pora na DAILY INIT (po 00:00 i po publikacji jutrzejszej
    tabeli RCE).

    "hour"/"minute"/"day" to godzina/minuta/dzien LOKALNY (PL,
    DST-swiadomy przez locale.tz_offset()) - wczesniej byla to godzina
    UTC, wiec okno realnie wypadalo 1-2h pozniej czasu polskiego.

    Dolna granica = pse.POLL_START_HOUR:POLL_START_MINUTE (13:45) - TA
    SAMA godzina, od ktorej services/pse_service.py::fetch_day() w ogole
    zaczyna probowac sieci dla "jutra" (patrz _not_yet_published() tam)
    - przed nia kazde wywolanie ems.init() i tak dostalo by dla "jutra"
    pusta liste bez zadnego zapytania sieciowego, wiec retry co 5 min
    miedzy 12:00 a 13:45 byl czystym marnowaniem cyklu bez szans na inny
    wynik."""

    return (
        day != last_init_day  # "!=" nie ">": 1. dzien miesiaca < 31.
        or (
            (hour, minute) >= (pse.POLL_START_HOUR, pse.POLL_START_MINUTE)
            and hour <= 14
            and now >= last_init_retry
        )
        # tabela na jutro pojawila sie PO oknie wyzej (albo restart po nim) - dolacz ja do harmonogramu
        or (now >= last_init_retry and _tomorrow_ready(now, hour, minute, day))
        # init() nie zbudowal wierszy na dzis (pusty harmonogram): ponawiaj co 5 min, nie czekaj do 13:45
        or (now >= last_init_retry and _rows_lack_today(now))
    )


def _daily_followup_step():
    """Jedno zadanie z kolejki daily_followups (archiwum energii, backfill prognozy PV,
    backfill zuzycia - kazde moze pobierac historie dnia z Deye Cloud, 15-30 s). Wszystkie trzy
    czytaja ten sam cache dnia (drivers/deye_service.py::fetch_day_history()), wiec realnie
    do chmury idzie tylko pierwsze."""

    name = daily_followups.pop(0)
    t0 = time.ticks_ms()

    try:
        if name == "archive":
            energy_archive_service.archive_missing_days()
        elif name == "forecast":
            forecast_tracking.backfill_yesterday()
        elif name == "consumption":
            consumption_tracking.backfill_yesterday()
    except Exception as e:
        print("[TICK DAILY FOLLOWUP ERROR]", name, e)

    print("[DAILY FOLLOWUP] {} {} ms".format(name, time.ticks_diff(time.ticks_ms(), t0)))


def _registry_refresh_step():
    """Jeden krok odswiezania urzadzen/czujnikow z rejestru (ems/display_devices.py::
    refresh_registry_step()); True, gdy cos odczytano."""

    try:
        import ems.display_devices as display_devices
        return display_devices.refresh_registry_step()
    except Exception as e:
        print("[TICK DISPLAY DEVICES REFRESH ERROR]", e)
        return False


# czesci sekcji OBLICZENIA dluzsze niz CALC_SLOW_MS - w konsoli "[CALC SLOW]" (linia [LOOP] podaje
# tylko sume i maksimum calej sekcji)
CALC_SLOW_MS = 1000
_calc_mark = [0]


def _calc_part(name):
    t = time.ticks_ms()
    took = time.ticks_diff(t, _calc_mark[0])
    _calc_mark[0] = t
    if took > CALC_SLOW_MS:
        print("[CALC SLOW] {} {} ms".format(name, took))


def tick():
    """Zadania okresowe - wolane z petli glownej ZARAZ PO obsludze zadan
    HTTP (www ma pierwszenstwo). Dwie sekcje, w tej kolejnosci:

      1. OBLICZENIA - tanie, na danych juz w RAM (zastosowanie
         harmonogramu, reguly urzadzen, rozliczenia, odbior ramek
         Zigbee) - przy kazdym obrocie petli (wlasne throttle).
      2. ODSWIEZENIA DANYCH - kosztowne (RS485/HTTP/flash): NAJWYZEJ
         JEDNO na obrot petli (po nim return), zeby kolejne zadanie
         HTTP nie czekalo za kilkoma naraz - reszta w nastepnych
         obrotach (co ok. 50ms)."""

    global last_telemetry, last_mode_check, last_inverter_verify, last_meteo, last_deye_dump_flush, last_zigbee_flush, last_rooms_heating, last_water_heater, last_circulation, last_outdoor_temp, last_energy_summary, last_settlement_summary, last_tomorrow_init_day, last_gateway_poll, last_gas_sample, last_weather_cache, last_backfill_batch, last_registry_refresh, last_current_slot_refresh, last_battery_widget, last_local_ds18b20, last_power_poll, last_init_day, last_init_retry, last_revision_day, last_followup_day, schedule_dirty, recalc_pending

    calc_start = time.ticks_ms()
    _calc_mark[0] = calc_start

    if not wifi.is_synced():
        # Zegar jeszcze nie zsynchronizowany przez NTP (np. tuz po
        # boot, gdy ntptime.settime() "cicho" nie zdazyl przy
        # pierwszej probie) - "teraz" liczone od epoki 2000-01-01
        # rozwalaloby KAZDA logike zalezna od czasu (zmiana trybu
        # falownika, regoly harmonogramu, daily init pobierajacy
        # PSE/meteo na zla date). Potwierdzony incydent: regula
        # 04:00-06:00 wykonana z "checked_at": "2000-01-01 04:00:00".
        # Pomijamy CALY tick() (zadnych akcji aktywnych) i probujemy
        # ponowic synchronizacje - bez sleep, kolejne proby przy
        # nastepnych obrotach glownej petli (ok. co 50ms).
        try:
            wifi.sync_time(retries=1, delay_ms=0)
        except Exception as e:
            print("[TICK] NTP RETRY ERROR:", e)
        return

    now = time.time()
    lt = time.localtime(now + locale.tz_offset(now))

    hour = lt[3]
    minute = lt[4]
    day = lt[2]

    # ##################################################################
    # 1. OBLICZENIA (dane w RAM)
    # ##################################################################

    # UART ZIGBEE (ESP32-C6) - odczyt/dekodowanie ramek (nieblokujace),
    # przed regulami, zeby widzialy najswiezsze odczyty czujnikow
    try:
        zigbee.poll()
    except Exception as e:
        print("[TICK ZIGBEE POLL ERROR]", e)
    _calc_part("zigbee")

    # raport z glowicy (nastawa, temperatura) albo czujnika Zigbee - szybka
    # decyzja o urzadzeniu grzewczym z cache w RAM (bez HTTP), w kazdym
    # obrocie petli
    try:
        reports = zigbee.take_heating_reports()
        if reports:
            rooms_heating.on_reports(reports)
    except Exception as e:
        print("[TICK ROOMS HEATING EVENT ERROR]", e)
    _calc_part("glowice raport")

    # ODPYTANIE GLOWIC O TEMPERATURE (co ZB_TRV_POLL_MIN, jedna na obrot) -
    # glowice same raportuja dopiero po wiekszej zmianie (drivers/thermostat.py)
    try:
        import drivers.thermostat as thermostat
        thermostat.poll_step()
    except Exception as e:
        print("[TICK TRV POLL ERROR]", e)
    _calc_part("glowice odpyt.")

    # ZASTOSOWANIE HARMONOGRAMU - zaraz po kazdym przeliczeniu
    # (schedule_dirty) i co 60s: reaguje na granice slotu w JUZ
    # obliczonym harmonogramie (np. WAIT->CHARGE), bez telemetrii
    if schedule_dirty or now - last_mode_check > 60:

        try:
            ems.check_mode()
        except Exception as e:
            print("[TICK CHECK_MODE ERROR]", e)

        schedule_dirty = False
        last_mode_check = now
    _calc_part("check_mode")

    # HARMONOGRAM STEROWANIA URZĄDZENIAMI (Tapo/Zigbee) wg REGUŁ z API/store
    try:
        device_schedule.tick()
    except Exception as e:
        print("[TICK DEVICE SCHEDULE ERROR]", e)
    _calc_part("reguly")

    # ROZLICZENIE PROGNOZY PV (co godzine) - patrz ems/forecast_tracking.py
    try:
        forecast_tracking.tick()
    except Exception as e:
        print("[TICK FORECAST TRACKING ERROR]", e)
    _calc_part("prognoza PV")

    # HISTORIA ZUZYCIA ENERGII co SLOT (calosc + per urzadzenie) -
    # patrz ems/consumption_tracking.py
    try:
        consumption_tracking.tick()
    except Exception as e:
        print("[TICK CONSUMPTION TRACKING ERROR]", e)
    _calc_part("slot zuzycia")

    # RECZNA ZMIANA TRYBU z Pulpitu (POST /ems/manualMode tylko kolejkuje):
    # zapis do falownika ~35 s (Deye Cloud) - w tle, patrz
    # ems/ems_service.py::apply_pending_manual_mode()
    try:
        if ems.apply_pending_manual_mode():
            return
    except Exception as e:
        print("[TICK MANUAL MODE ERROR]", e)
    _calc_part("tryb reczny")

    # ZAPIS POMIESZCZENIA: wysylka limitu temperatury do glowicy (ems/rooms_heating.py)
    try:
        import ems.rooms_heating as rooms_heating_push
        if rooms_heating_push.apply_pending_push():
            return
    except Exception as e:
        print("[TICK ROOMS PUSH ERROR]", e)
    _calc_part("glowice zapis")

    # ##################################################################
    # 2. ODSWIEZENIA DANYCH - najwyzej jedno na obrot petli (return)
    # ##################################################################

    loop_stats.calc(time.ticks_diff(time.ticks_ms(), calc_start))

    # URZADZENIA KRYTYCZNE (ems/critical.py) - PRZED wszystkim: dogrzewacz, pompa, czujniki obiegu
    # CO, grzalka i czujnik zasobnika CWU odpytywane co CRITICAL_POLL_S, a w tym samym kroku
    # procedura bezpieczenstwa (przekroczenie temperatury / brak odczytu -> OFF)
    try:
        import ems.critical as critical
        if critical.step(now):
            return
    except Exception as e:
        print("[TICK CRITICAL ERROR]", e)

    # ODSWIEZANIE REJESTRU ZAGLODZONE: jego zwykle miejsce (nizej) jest za zadaniami, ktore
    # potrafia byc nalezne co obrot (np. grzalka zasobnika co 5 s w czasie pracy) - 5.11.2026
    # przez ~80 min ani jednego odczytu, odczyty starsze niz REGISTRY_STALE_S i wszystkie
    # urzadzenia WiFi/DS18B20 "offline" (/config/devices, alerty "nie odpowiada"). Po
    # DISPLAY_REGISTRY_STARVED_S bez kroku - jeden krok tutaj, przed reszta
    # po starcie - urzadzenia jeszcze nieodczytane w kazdym obrocie (display_devices.unread_pending())
    import ems.display_devices as display_devices_boot
    if now - last_registry_refresh > getattr(config, "DISPLAY_REGISTRY_STARVED_S", 20) or display_devices_boot.unread_pending():
        last_registry_refresh = now
        loop_stats.label("Rejestr!")
        if _registry_refresh_step():
            return

    import ems.heating_control as heating_control

    # ODCZYT KOTLA (ems/heating_control.py::poll_boiler()): bramka OpenTherm albo sterownik DIYLESS
    # do pamieci co GAS_SAMPLE_S - sterowanie (nizej) i pomiar zuzycia gazu (ems/boiler_monitor.py,
    # sloty 5-minutowe, alerty bledow kotla) korzystaja tylko z tego odczytu
    if now - last_gas_sample >= getattr(config, "GAS_SAMPLE_S", 15):

        last_gas_sample = now
        loop_stats.label("Kociol odcz.")

        polled = False

        try:
            polled = heating_control.poll_boiler()
        except Exception as e:
            print("[TICK BOILER POLL ERROR]", e)

        try:
            import ems.boiler_monitor as boiler_monitor
            boiler_monitor.tick()
        except Exception as e:
            print("[TICK BOILER MONITOR ERROR]", e)

        if polled:
            return

    # RZECZYWISTE STEROWANIE OGRZEWANIEM CO (ems/heating_control.py): na stanie z pamieci (kociol -
    # odczyt wyzej, dogrzewacz / pompa / czujniki - ems/critical.py i rejestr) obliczenia i wyslanie
    # decyzji (dogrzewacz ON/OFF, kociol przez DIYLESS) - po sieci juz tylko polecenia. NA POCZATKU
    # sekcji: zadania nizej ustawiaja swoj znacznik czasu przed wykonaniem, wiec gdy ktores trwa
    # dluzej niz jego interwal, jest od razu znow nalezne i glodzi wszystko, co stoi za nim. Reczna
    # nastawa pomieszczenia z panelu (POST /rooms/<id>/manual) budzi zadanie od razu (wake_pending()).
    if heating_control.wake_pending() or now - last_gateway_poll > getattr(config, "GATEWAY_POLL_INTERVAL_S", 30):

        oled_status.step("Kociol", "LAN")

        last_gateway_poll = now

        try:
            heating_control.tick()
        except Exception as e:
            print("[TICK HEATING CONTROL ERROR]", e)

        return

    # POMPA CYRKULACYJNA CWU (ems/circulation.py) - przelacznik pompy wg
    # zdarzen z pomieszczen (webhook LD2410C, Zigbee z RAM - zadnych zapytan
    # sieciowych). Tez na poczatku sekcji i z wlasnym, krotkim interwalem
    # (3 s): woda ma plynac zaraz po pojawieniu sie kogos, a zadania nizej
    # potrafia byc kolejkowane przez dziesiatki sekund. Webhook obecnosci
    # budzi to zadanie od razu (wake_pending()) - przelacznik jest sterowany
    # w nastepnym obrocie petli, nie w obsludze HTTP. Return tylko po
    # wyslaniu polecenia do przelacznika.
    if circulation.wake_pending() or now - last_circulation > getattr(config, "CIRCULATION_INTERVAL_S", 3):

        last_circulation = now
        loop_stats.label("Cyrkul.")

        try:
            if circulation.tick():
                return
        except Exception as e:
            print("[TICK CIRCULATION ERROR]", e)

    # TELEMETRIA + PRZELICZENIE HARMONOGRAMU (co ok. 60s, patrz
    # config.DEYE_REGISTER_DUMP_INTERVAL_S) - drivers/deye_service.py::
    # refresh_dashboard_cache(): w trybie RS485 SUROWY ZRZUT REJESTROW
    # do RAM (drivers/deye_rs485.py::dump_registers(), storage/
    # deye_register_dump.py), w trybie CLOUD (albo gdy zrzut sie nie
    # uda) odswiezenie cache Deye Cloud. Zaraz potem ems.recalc() -
    # algorytm charge/discharge liczy na TYM SAMYM odczycie (gettery w
    # drivers/deye_service.py czytaja swiezy zrzut zamiast osobnych
    # transakcji RS485), wynik w RAM (storage/ems_data.py::
    # get_schedule()). Pulpit (www/dashboard.py) czyta WYLACZNIE te
    # cache - zadnej komunikacji z falownikiem w requescie.
    # Zastosowanie wyniku - ems.check_mode() w sekcji OBLICZENIA
    # kolejnego obrotu (schedule_dirty).
    # z Deye Cloud rzadziej (deye_service.telemetry_interval_s(), config.DEYE_CLOUD_REFRESH_INTERVAL_S)
    if now - last_telemetry > deye_service.telemetry_interval_s():

        oled_status.step("Deye", "DEYE")

        try:
            deye_service.refresh_dashboard_cache()
        except Exception as e:
            print("[TICK DEYE TELEMETRY ERROR]", e)

        # przeliczenie harmonogramu osobnym krokiem (nizej, nastepny obrot petli) - miedzy
        # odczytem (Deye Cloud: sekundy) a przeliczeniem petla obsluguje czekajace strony
        recalc_pending = True
        last_telemetry = now
        return

    # PRZELICZENIE HARMONOGRAMU na swiezym odczycie telemetrii (krok wyzej)
    if recalc_pending:

        recalc_pending = False
        oled_status.step("Harmon.", "DEYE")

        t0 = time.ticks_ms()
        timing.start()

        try:
            ems.recalc()
            schedule_dirty = True
        except Exception as e:
            print("[TICK RECALC ERROR]", e)

        print("[RECALC] {} ms: {}".format(time.ticks_diff(time.ticks_ms(), t0), timing.summary()))
        return

    # ZAPIS CELOW TOU do falownika z przeliczenia wyzej (ems/grid.py) - osobny krok: przez
    # Deye Cloud kilka zapytan HTTPS; bez zmiany celu nic nie jest wysylane
    import ems.grid as grid

    if grid.has_pending():

        loop_stats.label("TOU")
        t0 = time.ticks_ms()

        try:
            if grid.write_pending():
                print("[TOU] zapis {} ms".format(time.ticks_diff(time.ticks_ms(), t0)))
                return
        except Exception as e:
            print("[TICK TOU WRITE ERROR]", e)

    # HISTORIA DEYE CLOUD po zamknieciu slotu zuzycia (ems/consumption_tracking.py) - osobny krok
    # sieciowy (wczesniej w obliczeniach, do ok. 11 s blokady petli)
    if consumption_tracking.slot_history_pending():

        loop_stats.label("Slot hist.")
        t0 = time.ticks_ms()

        try:
            if consumption_tracking.slot_history_step():
                print("[SLOT HIST] {} ms".format(time.ticks_diff(time.ticks_ms(), t0)))
                return
        except Exception as e:
            print("[TICK SLOT HISTORY ERROR]", e)

    # WERYFIKACJA STANU FALOWNIKA - co 300s: czysty odczyt RS485,
    # wykrywa "dryf" cache wzgledem realnego stanu falownika (patrz
    # ems/ems_service.py::verify_inverter_state())
    if now - last_inverter_verify > 300:

        oled_status.step("Weryf.", "DEYE")

        try:
            ems.verify_inverter_state()
        except Exception as e:
            print("[TICK VERIFY INVERTER ERROR]", e)

        last_inverter_verify = now
        return

    # DAILY INIT (patrz _init_due()) - ems.init() buduje wiersze od nowa
    # (wszystkie w trybie IDLE), wiec od razu przeliczamy harmonogram,
    # zanim check_mode() zdazy zastosowac "pusty" IDLE.
    if _init_due(now, hour, minute, day):

        oled_status.step("Nowy dz", "NET")

        try:

            ems.init()

            # sukces
            last_init_day = day
            last_init_retry = now + 300

            # harmonogram ma juz "jutro" - nie wracamy do tego do konca dnia
            if not _rows_lack_tomorrow(now):
                last_tomorrow_init_day = day

            try:
                ems.recalc()
                schedule_dirty = True
            except Exception as e:
                print("[TICK INIT RECALC ERROR]", e)

            # historia za wczoraj - raz na dobe, w kolejnych obrotach petli (nie w tym kroku)
            if last_followup_day != day:
                last_followup_day = day
                daily_followups[:] = ["archive", "forecast", "consumption"]

        except Exception as e:

            print("[TICK INIT ERROR]", e)

            # retry za 15 minut
            last_init_retry = now + 900

        return

    # ZADANIA PO DAILY INIT - jedno na obrot petli (patrz _daily_followup_step())
    if daily_followups:

        oled_status.step("Wczoraj", "NET")
        _daily_followup_step()
        return

    # REFRESH METEO (co godzine) - ems.refresh() sam przelicza harmonogram
    if now - last_meteo > 3600:

        oled_status.step("Meteo", "NET")

        t0 = time.ticks_ms()

        try:
            ems.refresh()
            schedule_dirty = True
        except Exception as e:
            print("[TICK REFRESH ERROR]", e)

        t1 = time.ticks_ms()

        # zapis zrzutu prognozy calodobowej (jesli sie zmienila) -
        # POWIAZANE z odswiezeniem meteo, wolane TYLKO tutaj (nie w
        # kazdym tick()), bo _full_day_slot_forecast() kosztuje
        # N x pv_forecast_window() (24x godzinowo, 96x przy
        # MINUTELY_15) - patrz ems/forecast_tracking.py. Bez zmiany
        # prognozy zrzut wyszedlby taki sam - liczony tylko raz na dobe
        # (pierwszy zrzut nowego dnia)
        if ems.last_refresh_changed or last_revision_day != day:
            try:
                forecast_tracking.capture_revision_snapshots()
                last_revision_day = day
            except Exception as e:
                print("[TICK FORECAST REVISION ERROR]", e)

        print("[METEO] refresh {} ms ({}), zrzut prognozy {} ms".format(
            time.ticks_diff(t1, t0),
            "przeliczono" if ems.last_refresh_changed else "bez zmian",
            time.ticks_diff(time.ticks_ms(), t1)))

        last_meteo = now
        return

    # ZAPIS ZRZUTU REJESTROW NA FLASH (co 15 min, patrz config.
    # DEYE_REGISTER_DUMP_FLASH_INTERVAL_S) - rzadziej niz zrzut do RAM,
    # bo flash ma ograniczona liczbe cykli zapisu
    if now - last_deye_dump_flush > getattr(config, "DEYE_REGISTER_DUMP_FLASH_INTERVAL_S", 900):

        oled_status.step("Flash")

        if getattr(config, "DEYE_REGISTER_DUMP_ENABLED", True):
            try:
                deye_register_dump.flush_to_flash()
            except Exception as e:
                print("[TICK DEYE REGISTER DUMP FLASH ERROR]", e)

        last_deye_dump_flush = now
        return

    # ZAPIS TELEMETRII ZIGBEE NA FLASH (co 15 min, patrz config.
    # ZIGBEE_STATE_FLUSH_INTERVAL_S) - kazda ramka z huba aktualizuje
    # tylko RAM (storage/uart_devices_store.py::update_state())
    if now - last_zigbee_flush > getattr(config, "ZIGBEE_STATE_FLUSH_INTERVAL_S", 900):

        oled_status.step("Zigbee")

        try:
            zigbee.devices_store.flush_state()
        except Exception as e:
            print("[TICK ZIGBEE STATE FLUSH ERROR]", e)

        last_zigbee_flush = now
        return

    # OGRZEWANIE POMIESZCZEN - nastawy glowic TRV wg /config/rooms
    # (odczyt czujnikow temperatury/obecnosci po HTTP, patrz
    # ems/rooms_heating.py)
    # pelne przeliczenie co ROOMS_HEATING_INTERVAL_S - koryguje i odswieza cache
    # pierwszy odczyt okna obecnosci (np. po starcie) - od razu (device_schedule.presence_arrived())
    if now - last_rooms_heating > getattr(config, "ROOMS_HEATING_INTERVAL_S", 300) or device_schedule.presence_arrived():

        oled_status.step("Glowice", "LAN")

        try:
            rooms_heating.tick()
        except Exception as e:
            print("[TICK ROOMS HEATING ERROR]", e)

        # alerty urzadzen (nie odpowiada, hub Zigbee, bateria) - z pamieci, ems/device_alerts.py
        try:
            import ems.device_alerts as device_alerts
            device_alerts.tick()
        except Exception as e:
            print("[TICK DEVICE ALERTS ERROR]", e)

        last_rooms_heating = now
        return

    # GRZALKA ZASOBNIKA - ON/OFF wg /config/water-heater (odczyt
    # czujnika wody po HTTP, patrz ems/water_heater.py)
    # po wyslaniu OFF do dogrzewacza (priorytet grzalki zasobnika, ems/heater_guard.py)
    # stan sprawdzamy co kilka sekund, a nie dopiero za WATER_HEATER_INTERVAL_S
    # po zapisie konfiguracji CWU (water_heater.wake()) - od razu
    if water_heater.wake_pending():
        water_interval = 0
    elif water_heater.recheck_pending():
        water_interval = 5
    else:
        water_interval = getattr(config, "WATER_HEATER_INTERVAL_S", 60)

    if now - last_water_heater > water_interval:

        oled_status.step("CWU", "LAN")

        try:
            water_heater.tick()
        except Exception as e:
            print("[TICK WATER HEATER ERROR]", e)

        last_water_heater = now
        return

    # TEMPERATURA ZEWNETRZNA z prognozy Open-Meteo dla symulacji
    # ogrzewania (ems/heating_sim.py) - tylko gdy tam wybrano prognoze
    if now - last_outdoor_temp > getattr(config, "OUTDOOR_TEMP_INTERVAL_S", 900):

        oled_status.step("T.zewn", "NET")

        try:
            import ems.heating_sim as heating_sim
            heating_sim.refresh_outdoor()
        except Exception as e:
            print("[TICK OUTDOOR TEMP ERROR]", e)

        last_outdoor_temp = now
        return

    # KOSZTY I PRZYCHODY ZE SPRZEDAZY ENERGII dzis i w biezacym miesiacu dla panelu
    # (services/energy_summary.py, GET /display/energyCost) - liczone tu, bo dzisiejszy
    # raport moze pobierac historie z Deye Cloud; zadanie HTTP czyta tylko bufor
    # (zaraz po starcie, gdy sumy sa jeszcze wczytywane - co 5 s, potem co 2 min)
    if now - last_energy_summary > (5 if energy_summary.pending() else getattr(config, "ENERGY_SUMMARY_INTERVAL_S", 120)):

        oled_status.step("Koszty", "NET")

        try:
            energy_summary.refresh(now)
        except Exception as e:
            print("[TICK ENERGY SUMMARY ERROR]", e)

        last_energy_summary = now
        return

    # ROZLICZENIE OKRESOWE biezacego miesiaca dla panelu (services/settlement_summary.py,
    # GET /display/settlement) - te same wartosci co ekran "Rozliczenie okresowe"; liczone tu
    # (archiwum + dzisiaj z cache historii), zadanie HTTP czyta tylko bufor
    if now - last_settlement_summary > (5 if settlement_summary.pending() else getattr(config, "SETTLEMENT_SUMMARY_INTERVAL_S", 120)):

        oled_status.step("Rozlicz", "FLASH")

        try:
            settlement_summary.refresh(now)
        except Exception as e:
            print("[TICK SETTLEMENT SUMMARY ERROR]", e)

        last_settlement_summary = now
        return

    # DS18B20 PRZY STEROWNIKU - odczyt poprzedniej konwersji i start
    # nastepnej (drivers/local_ds18b20.py, bez czekania 750 ms)
    if local_ds18b20.enabled() and now - last_local_ds18b20 > getattr(config, "LOCAL_DS18B20_INTERVAL_S", 10):

        loop_stats.label("DS18B20")

        try:
            local_ds18b20.tick()
        except Exception as e:
            print("[TICK LOCAL DS18B20 ERROR]", e)

        last_local_ds18b20 = now
        return

    # ODSWIEZANIE JEDNEGO urzadzenia/czujnika z rejestru dla ekranu Devices panelu
    # (ems/display_devices.py::refresh_registry_step()) - /display/devices czyta
    # tylko cache, wiec nie czeka na urzadzenia po sieci
    if now - last_registry_refresh > getattr(config, "DISPLAY_REGISTRY_REFRESH_S", 5):

        last_registry_refresh = now
        loop_stats.label("Rejestr")

        if _registry_refresh_step():
            return

    # KAFEL BATERII dla panelu: odczyt falownika do cache (ems/ems_service.py::
    # refresh_battery_widget()) - GET /display/batteryWidget oddaje cache
    if now - last_battery_widget > getattr(config, "DISPLAY_BATTERY_REFRESH_S", 30):

        last_battery_widget = now
        loop_stats.label("Bateria")

        try:
            ems.refresh_battery_widget()
            return
        except Exception as e:
            print("[TICK BATTERY WIDGET REFRESH ERROR]", e)

    # ODCZYT URZADZEN BIEZACEGO SLOTU do cache (ems/consumption_tracking.py::
    # refresh_current_slot_devices()) - /display/devices czyta tylko cache
    # jedno urzadzenie na krok - pelny obieg co DISPLAY_CURRENT_SLOT_REFRESH_S
    if now - last_current_slot_refresh > consumption_tracking.current_slot_step_s():

        last_current_slot_refresh = now
        loop_stats.label("Slot")

        try:
            consumption_tracking.refresh_current_slot_devices()
            return
        except Exception as e:
            print("[TICK CURRENT SLOT REFRESH ERROR]", e)

    # ZADANIE WSADOWE: dokladne dane zuzycia z historii Deye Cloud od 1
    # stycznia - jeden dzien na wywolanie (ems/consumption_tracking.py::
    # backfill_batch_tick()), od wczoraj wstecz; po zakonczeniu no-op
    if now - last_backfill_batch > getattr(config, "CONSUMPTION_BACKFILL_INTERVAL_S", 60):

        last_backfill_batch = now
        loop_stats.label("Hist.?")

        try:
            if consumption_tracking.backfill_batch_tick():
                oled_status.step("Historia", "NET")
                return
        except Exception as e:
            print("[TICK CONSUMPTION BACKFILL BATCH ERROR]", e)

    # CACHE POGODY dla panelu (GET /cache/weather, /cache/forecast) -
    # Open-Meteo raz na interwal, panel czyta z RAM sterownika
    if now - last_weather_cache > getattr(config, "WEATHER_CACHE_INTERVAL_S", 3600):

        oled_status.step("Pogoda", "NET")

        try:
            import services.weather_cache as weather_cache
            weather_cache.refresh()
        except Exception as e:
            print("[TICK WEATHER CACHE ERROR]", e)

            # blad (np. "The service is overloaded" z Open-Meteo): ponowienie za
            # WEATHER_CACHE_RETRY_S zamiast czekac caly interwal; stary cache zostaje
            interval = getattr(config, "WEATHER_CACHE_INTERVAL_S", 3600)
            retry = getattr(config, "WEATHER_CACHE_RETRY_S", 300)
            last_weather_cache = now - max(0, interval - retry)
            return

        last_weather_cache = now
        return

    # ZDARZENIA "POBOR MOCY" - odczyt mocy urzadzen i ocena okresu
    # (ems/events.py::poll_power(), odczyty po HTTP)
    if now - last_power_poll > getattr(config, "EVENTS_POWER_POLL_S", 30):

        oled_status.step("Moc", "LAN")

        try:
            device_events.poll_power()
        except Exception as e:
            print("[TICK POWER EVENTS ERROR]", e)

        last_power_poll = now
        return

    # Ponizej zadania z WLASNYM throttle (bezpiecznie wolac przy kazdym
    # tick()) - tylko w obrotach, w ktorych nic kosztownego wyzej nie
    # ruszylo.

    # POLLING JUTRZEJSZEJ TABELI RCE (od 13:45, co 15 min - patrz
    # services/pse_service.py::poll_tomorrow() dla pelnego opisu)
    try:
        pse.poll_tomorrow()
    except Exception as e:
        print("[TICK PSE POLL TOMORROW ERROR]", e)

    # KOLEJKA UZUPELNIANIA ARCHIWUM ENERGII W TLE ("Uzupelnij braki" -
    # patrz services/energy_archive_service.py::backfill_tick())
    try:
        energy_archive_service.backfill_tick()
    except Exception as e:
        print("[TICK ENERGY BACKFILL ERROR]", e)

def log(msg):
    print("[MAIN]", msg)

def _reset_cause_label():
    """Etykieta przyczyny (re)startu - nazwy stalych machine.*_RESET
    roznia sie miedzy portami/wersjami MicroPython, wiec kazda czytamy
    przez getattr (brakująca po prostu nigdy nie dopasuje sie do
    realnej wartosci machine.reset_cause())."""

    try:
        cause = machine.reset_cause()
    except Exception:
        return "unknown"

    labels = {
        getattr(machine, "PWRON_RESET", -1): "power_on",
        getattr(machine, "HARD_RESET", -2): "hard_reset",
        getattr(machine, "WDT_RESET", -3): "watchdog",
        getattr(machine, "DEEPSLEEP_RESET", -4): "deepsleep",
        getattr(machine, "SOFT_RESET", -5): "soft_reset",
    }

    return labels.get(cause, "unknown({})".format(cause))

def boot():

    log("BOOT")

    reset_cause = _reset_cause_label()

    gc.collect()

    # ekran jako pierwszy - pokazuje postep startu (WiFi potrafi trwac)
    try:
        oled_status.init()
        oled_status.message("Laczenie WiFi...")
    except Exception as e:
        print("[BOOT OLED ERROR]", e)

    wifi.connect()

    log("WIFI OK")
    oled_status.message("WiFi OK", "Start EMS...")

    # log DOPIERO PO wifi.connect() - ono robi ntptime.settime()
    # (core/wifi.py), a przed synchronizacja zegar ESP32 zaczyna od
    # "epoki" (2000-01-01) - wpis zapisany wczesniej mialby bezsensowny
    # znacznik czasu (np. "2000-01-01 00:00:05")
    try:
        import storage.event_log as event_log
        event_log.append(
            "boot", "Uruchomienie kontrolera",
            {"reset_cause": reset_cause}
        )
    except Exception as e:
        print("[BOOT EVENT LOG ERROR]", e)

    # jednorazowe zaladowanie domyslnego urzadzenia "heater" ze
    # starego adresu IP z config.py - TYLKO jesli storage
    # (device_schedule_devices.json) jest jeszcze pusty, np. przy
    # pierwszym uruchomieniu po tej aktualizacji. Kolejne zmiany
    # urzadzen robisz juz przez API (/device/schedule/devices).
    # Dane logowania do konta Tapo (wspolne dla wszystkich urzadzen
    # typu "tapo") sa juz OSOBNO w storage/tapo_store.py - patrz
    # /tapo/config / www/tapo_config.py.
    try:
        schedule_store.seed_if_empty(
            default_devices={
                "heater": {
                    "kind": "tapo",
                    "ip": config.TAPO_HEATER_IP,
                }
            }
        )
    except Exception as e:
        print("[BOOT SEED ERROR]", e)

    log("SEED OK")

    try:
        zigbee.init()
        # C6 moze juz miec sparowane urzadzenia z poprzedniej sesji -
        # poprosmy o pelna liste, zeby odtworzyc mapowanie local_id<->ieee
        # (init() pyta tez o HUB_READY, ktory ponawia to samo - nadmiarowe,
        # ale nieszkodliwe)
        zigbee.cmd_get_device_list()
    except Exception as e:
        print("[BOOT ZIGBEE ERROR]", e)

    log("ZIGBEE OK")

    if config.DEYE_LOCAL_MODBUS_ENABLED:
        try:
            deye_rs485.init()
        except Exception as e:
            print("[BOOT DEYE RS485 ERROR]", e)

    log("DEYE RS485 OK")

    try:
        local_ds18b20.init()
    except Exception as e:
        print("[BOOT LOCAL DS18B20 ERROR]", e)

    server.start()

    # obsluga HTTP w osobnym watku (core/server.py::start_thread()) - strony nie czekaja na
    # krok petli; bez watku (SERVER_THREAD = False albo firmware bez _thread) jak dotad:
    # server.handle() co obrot, a czekanie na Deye Cloud (zapis rejestru) obsluguje
    # zapytania tylko do odczytu
    if not (getattr(config, "SERVER_THREAD", True) and server.start_thread()):
        deye_service.set_idle_hook(server.serve_readonly)

    log("SERVER OK")

boot()

last_gc = 0
last_wifi_check = 0
last_oled = 0

# Bez try wyjatek (np. PSE/Open-Meteo chwilowo niedostepne tuz po
# restarcie) konczyl main.py PO server.start() - gniazdo HTTP zajete,
# nikt go nie obsluguje, kontroler "nie odpowiada" (2026-09-29).
# Harmonogram i tak zbuduje DAILY INIT w tick() (z ponawianiem).
try:
    ems.init()
except Exception as e:
    print("[BOOT EMS INIT ERROR]", e)

def _flush_before_reset(reason):
    """Zapis buforow w RAM na flash przed restartem (Ctrl-C z tools/webrepl_reset.py albo
    restart po aktualizacji OTA, core/ota.py)."""

    try:
        import ems.heating_history as heating_history
        heating_history.flush(force=True)
        import storage.outdoor_day_store as outdoor_days
        outdoor_days.flush()
        import ems.boiler_monitor as boiler_monitor
        boiler_monitor.flush()
        import storage.event_log as event_log
        event_log.flush(force=True)
        print("[MAIN] {} - historia ogrzewania, slot gazu i dziennik zdarzen zapisane".format(reason))
    except Exception as e:
        print("[MAIN] zapis historii ogrzewania / dziennika:", e)


# Ctrl-C (tools/webrepl_reset.py przed machine.reset() przy wgrywaniu) - historia ogrzewania
# zapisywana na flash co FLUSH_S, bez tego restart gubil do 30 min wykresow
# WATCHDOG (core/watchdog.py) - od tego miejsca; boot() wyzej (WiFi, portal AP) bez niego
try:
    watchdog.start()
except Exception as e:
    print("[WDT] start nieudany:", e)

try:
    while True:

        watchdog.beat()

        # obrot petli pod blokada (watek serwera: zapytania spoza listy bez blokady czekaja na
        # koniec obrotu - core/server.py), pauza na koncu bez niej
        server.loop_enter()

        try:

            now = time.time()

            # =========================
            # SERVER LOOP
            # =========================
            try:
                # najpierw WSZYSTKIE oczekujace zadania HTTP (do limitu) - www
                # ma pierwszenstwo przed obliczeniami i odswiezaniem w tick()
                # (watek serwera - obsluguje je sam)
                http_start = time.ticks_ms()
                requests = 0

                for _ in range(0 if server.threaded() else SERVER_MAX_REQUESTS_PER_LOOP):
                    if not server.handle():
                        break
                    requests += 1

                http_ms = time.ticks_diff(time.ticks_ms(), http_start)

                # AKTUALIZACJA OTA zainstalowana (core/ota.py::install()) - odpowiedz juz wyslana
                if ota.restart_due():
                    _flush_before_reset("aktualizacja OTA")
                    machine.reset()

                # ZDARZENIA Z WEBHOOKOW (ems/events.py) - ZARAZ po obsludze
                # zadania, PRZED tick(): webhook z zerowa zwloka (np. obecnosc ->
                # swiatlo) wykonuje akcje od razu po wyslaniu odpowiedzi
                # czujnikowi, zamiast czekac za zadaniami okresowymi w tick()
                # (Deye/meteo/reguly potrafia trwac kilka sekund). Poza
                # blokada NTP w tick() - zwloki liczone sa wzgledem time.time(),
                # nie godziny zegarowej.
                try:
                    device_events.tick()
                except Exception as e:
                    print("[DEVICE EVENTS ERROR]", e)

                tick_start = time.ticks_ms()
                tick()
                loop_stats.turn(requests, http_ms, time.ticks_diff(time.ticks_ms(), tick_start))

            except Exception as e:
                print("[SERVER ERROR]", e)

            # krok tick() zakonczony (albo przerwany wyjatkiem) - czas na ekran
            oled_status.step_done()


            # =========================
            # WIFI GUARD (co 10s)
            # =========================
            if now - last_wifi_check > 10:

                try:
                    wifi.ensure()
                except:
                    pass

                last_wifi_check = now


            # =========================
            # GC GUARD (co 5s)
            # =========================
            if now - last_gc > 5:

                # dziennik zdarzen - zaleglych wpisow na flash (najwyzej co event_log.FLUSH_S)
                try:
                    import storage.event_log as event_log
                    event_log.flush()
                except Exception as e:
                    print("[EVENT LOG] flush:", e)

                t_gc = time.ticks_ms()
                gc.collect()
                print("============== FREE RAM: {} (gc {} ms)".format(
                    gc.mem_free(), time.ticks_diff(time.ticks_ms(), t_gc)))

                last_gc = now


            # =========================
            # EKRAN OLED (drivers/oled_status.py) - tylko dane z pamieci, poza
            # tick(), wiec dziala tez przed synchronizacja NTP
            # =========================
            if now - last_oled >= getattr(config, "OLED_REFRESH_S", 5):

                oled_status.refresh()

                last_oled = now

        finally:
            server.loop_exit()

        # watek serwera: pauza bez blokady - czekajace zapytanie dostaje ja teraz; bez watku
        # i tak czekalo w accept() do 0,5 s
        time.sleep_ms(getattr(config, "MAIN_LOOP_PAUSE_MS", 100) if server.threaded() else 50)
except KeyboardInterrupt:
    watchdog.pause()
    _flush_before_reset("przerwano")
    raise
