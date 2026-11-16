try:
    import ujson as json
except ImportError:
    import json

import os


UPDATE_MARKER = "ota_update.json"
BACKUP_DIR = "ota_backup"


def _exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


def _remove(path):
    if _exists(path):
        os.remove(path)


def _remove_directory(path):
    try:
        os.rmdir(path)
    except OSError:
        pass


def _restore_interrupted_update():
    if not _exists(UPDATE_MARKER):
        return

    with open(UPDATE_MARKER) as marker_file:
        entries = json.load(marker_file)

    for entry in entries:
        path = entry["path"]
        backup = BACKUP_DIR + "/" + path
        if entry["had_old"]:
            if not _exists(backup):
                raise OSError("OTA rollback backup missing: " + backup)
            _remove(path)
            os.rename(backup, path)
        else:
            _remove(path)

        _remove(BACKUP_DIR + "/" + path)
        _remove("ota_stage/" + path)

    os.remove(UPDATE_MARKER)
    _remove(UPDATE_MARKER + ".tmp")
    _remove_directory(BACKUP_DIR + "/web")
    _remove_directory(BACKUP_DIR)
    _remove_directory("ota_stage/web")
    _remove_directory("ota_stage")


_restore_interrupted_update()
