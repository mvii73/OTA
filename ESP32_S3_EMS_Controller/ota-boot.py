import gc
import machine

machine.freq(240000000)
gc.enable()

gc.collect()


# PRZERWANA AKTUALIZACJA OTA (core/ota.py::install()) - ota_update.json
# zostaje tylko, gdy podmiana plikow nie dobiegla konca (np. zanik
# zasilania): przywracamy stare pliki z ota_backup/, zanim main.py
# zaimportuje mieszanke starych i nowych modulow. Celowo bez importu
# core.ota - ten modul moze byc wlasnie jednym z podmienianych plikow.
def _ota_restore():

    import os

    def exists(path):
        try:
            os.stat(path)
            return True
        except OSError:
            return False

    if not exists("ota_update.json"):
        return

    try:
        import json

        with open("ota_update.json") as f:
            entries = json.load(f)

        for entry in entries:
            path = entry["path"]
            backup = "ota_backup/" + path

            if entry.get("had_old"):
                if exists(backup):
                    if exists(path):
                        os.remove(path)
                    os.rename(backup, path)
            elif not entry.get("remove") and exists(path):
                os.remove(path)

        os.remove("ota_update.json")
        print("[OTA] przerwana aktualizacja - przywrocono poprzednie pliki")

    except Exception as e:
        print("[OTA] blad przywracania:", e)


_ota_restore()
gc.collect()

# WebREPL (patrz config.py::WEBREPL_PASSWORD) - uruchamiane TUTAJ, w
# boot.py, PRZED polaczeniem WiFi (ktore dzieje sie pozniej,
# synchronicznie i moze dlugo trwac - patrz main.py::boot() ->
# core/wifi.py::connect(), w tym mozliwy blokujacy tryb portalu AP) -
# zeby konsola sieciowa byla gotowa od razu, jak tylko STA dostanie
# adres IP, niezaleznie od tego, czy main.py pozniej w ogole dojdzie
# do konca bez bledu. Awaria importu/startu (np. brak modulu webrepl w
# tym build'zie firmware) NIE powinna zablokowac reszty bootu.
try:
    import config
    import webrepl
    webrepl.start(password=config.WEBREPL_PASSWORD)
except Exception as e:
    print("[WEBREPL] start failed:", e)

gc.collect()