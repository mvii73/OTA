(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    function getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function api(url, method, body) {
        var opts = { method: method || "GET" };

        if (body !== undefined) {
            opts.headers = { "Content-Type": "application/json" };
            opts.body = JSON.stringify(body);
        }

        return fetch(url, opts).then(function (r) { return r.json(); });
    }

    function setStatus(id, text, isError) {
        var elm = el(id);
        elm.textContent = text;
        elm.className = "settings-message " + (isError ? "error" : "success");
    }

    function formatTestResult(res) {

        if (!res.online) {
            return "Błąd: " + (res.error || "brak odpowiedzi");
        }

        var parts = ["OK - urządzenie odpowiada"];

        if (res.power != null) { parts.push("moc: " + res.power + " W"); }
        if (res.enabled != null) { parts.push("stan: " + (res.enabled ? "włączone" : "wyłączone")); }

        if (res.data && res.data.detected !== undefined) {
            // czujnik obecności LD2410C - patrz drivers/ld2410c_presence.py::extract()
            parts.push("obecność: " + (res.data.detected ? "wykryta" : "brak"));
            if (res.data.state_name) { parts.push("stan: " + res.data.state_name); }
            if (res.data.duration_s != null) { parts.push("czas trwania: " + res.data.duration_s + " s"); }
        } else if (res.data && res.data.roms !== undefined) {
            // DS18B20 przy sterowniku - patrz drivers/local_ds18b20.py::status()
            parts.push("temperatura: " + res.data.temperature_c + " °C");
            parts.push("odczyt " + res.data.age_s + " s temu");
            parts.push("ROM: " + res.data.rom);
        } else if (res.data && res.data.temperature_c !== undefined) {
            // czujnik DS18B20 - patrz drivers/ds18b20_hub.py::extract()
            if (res.data.name) { parts.push("nazwa na hubie: " + res.data.name); }
            parts.push("temperatura: " + res.data.temperature_c + " °C");
            parts.push("hub: " + (res.data.online ? "online" : "offline"));
        } else if (res.data != null) {
            // Sonoff - surowe parametry z mDNS, do sprawdzenia co
            // urzadzenie raportuje lokalnie (patrz services/sonoff_service.py)
            parts.push("dane: " + JSON.stringify(res.data));
        }

        if (res.voltage != null) { parts.push("napięcie: " + res.voltage + " V"); }
        if (res.source) {
            parts.push("źródło: " + ({ "local": "lokalnie", "cloud": "chmura", "local+cloud": "lokalnie + moc z chmury" })[res.source]);
        }

        return parts.join(", ");
    }

    function loadZigbeeDevices(select, selectedIeee) {
        return api("/zigbee/devices").then(function (res) {

            select.innerHTML = (res || []).map(function (d) {
                var label = d.device_type_name + " (" + d.ieee + ")";
                return "<option value=\"" + d.ieee + "\">" + label + "</option>";
            }).join("");

            if (selectedIeee) {
                select.value = selectedIeee;
            }
            // bez zapamietanej wersji - zapytanie od razu, tylko przy edycji (nie przy dodawaniu)
            showFirmware(select, !!getQueryParam("id"));
        });
    }

    // wersja firmware urzadzenia Zigbee (GET/POST /zigbee/devices/<ieee>/firmware,
    // drivers/uart_zigbee.py::firmware_read()) - wiersz "<prefiks>-firmware" pod lista
    // "<prefiks>-ieee"; bez zapamietanej wersji - zapytanie urzadzenia od razu ("auto")
    function firmwareText(fw) {
        if (!fw) { return null; }
        var parts = [];
        if (fw.sw_build) { parts.push("wersja " + fw.sw_build); }
        if (fw.ota_file_version != null) { parts.push("plik OTA 0x" + ("0000000" + fw.ota_file_version.toString(16)).slice(-8)); }
        if (fw.app_version != null) { parts.push("aplikacja " + fw.app_version); }
        if (fw.hw_version != null) { parts.push("sprzęt " + fw.hw_version); }
        if (fw.date_code) { parts.push("data " + fw.date_code); }
        return parts.length ? parts.join(" · ") : null;
    }

    function showFirmware(select, auto, retries) {
        var target = el(select.id.replace(/-ieee$/, "-firmware"));
        var ieee = select.value;
        if (!target) { return; }
        if (!ieee) { target.textContent = "--"; return; }
        api("/zigbee/devices/" + ieee + "/firmware").then(function (res) {
            if (select.value !== ieee) { return; }
            var text = res && !res.error ? firmwareText(res.firmware) : null;
            if (text) { target.textContent = text; return; }
            if (auto) { readFirmware(select); return; }
            if (retries > 0) {
                target.textContent = "Czekam na odpowiedź urządzenia…";
                setTimeout(function () { showFirmware(select, false, retries - 1); }, 4000);
                return;
            }
            target.textContent = "Brak odpowiedzi (urządzenie uśpione albo nie podaje wersji) - spróbuj ponownie";
        });
    }

    function readFirmware(select) {
        var target = el(select.id.replace(/-ieee$/, "-firmware"));
        if (!select.value) { return; }
        target.textContent = "Odczyt…";
        api("/zigbee/devices/" + select.value + "/firmware", "POST", {}).then(function (res) {
            if (res && res.error) { target.textContent = "Błąd: " + res.error; return; }
            setTimeout(function () { showFirmware(select, false, 4); }, 3000);
        });
    }

    ["sensor-ieee", "device-ieee"].forEach(function (id) {
        var select = el(id);
        if (!select) { return; }
        select.addEventListener("change", function () { showFirmware(select, true); });
    });

    document.addEventListener("click", function (e) {
        var btn = e.target.closest && e.target.closest("[data-firmware-read]");
        if (btn) { readFirmware(el(btn.dataset.firmwareRead + "-ieee")); }
    });

    var editId = getQueryParam("id");

    // =====================================================
    // CZUJNIK
    // =====================================================

    var sensorForm = el("sensor-form");

    if (sensorForm) {

        var sensorNameInput = el("sensor-name");
        var sensorKindSelect = el("sensor-kind");
        var sensorTestButton = el("sensor-test-button");
        var sensorDs18b20DiscoverButton = el("sensor-ds18b20-discover-button");
        var sensorDs18b20DiscoverResult = el("sensor-ds18b20-discover-result");

        function updateSensorKindFields() {
            var kind = sensorKindSelect.value;
            var isZigbee = kind === "zigbee";
            var isLd2410c = kind === "ld2410c";
            var isDs18b20 = kind === "ds18b20";
            var isLocalDs18b20 = kind === "local_ds18b20";
            el("sensor-wifi-fields").hidden = isZigbee || isLd2410c || isDs18b20 || isLocalDs18b20;
            el("sensor-local-ds18b20-fields").hidden = !isLocalDs18b20;
            el("sensor-zigbee-fields").hidden = !isZigbee;
            el("sensor-ld2410c-fields").hidden = !isLd2410c;
            el("sensor-ds18b20-fields").hidden = !isDs18b20;
        }

        sensorKindSelect.addEventListener("change", updateSensorKindFields);

        if (editId) {

            el("sensor-form-title").textContent = "Edytuj czujnik";

            api("/device/schedule/sensors/" + editId).then(function (s) {

                if (s.error) {
                    setStatus("sensor-form-status", "Błąd: " + s.error, true);
                    return;
                }

                sensorNameInput.value = s.name || editId;

                var kind = s.kind || "wifi";
                sensorKindSelect.value = kind;
                updateSensorKindFields();

                if (kind === "zigbee") {
                    loadZigbeeDevices(el("sensor-ieee"), s.ieee);
                } else if (kind === "ld2410c") {
                    el("sensor-ld2410c-ip").value = s.ip || "";
                } else if (kind === "ds18b20") {
                    el("sensor-ds18b20-ip").value = s.ip || "";
                    el("sensor-ds18b20-rom").value = s.rom || "";
                } else if (kind === "local_ds18b20") {
                    el("sensor-local-ds18b20-rom").value = s.rom || "";
                } else {
                    el("sensor-ip").value = s.ip || "";
                    el("sensor-path").value = s.path || "";
                    el("sensor-timeout").value = s.timeout || "";
                }
            });

        } else {
            updateSensorKindFields();
            loadZigbeeDevices(el("sensor-ieee"));
        }

        function collectSensorData() {

            var kind = sensorKindSelect.value;
            var data = { kind: kind, name: sensorNameInput.value.trim() };

            if (kind === "zigbee") {
                data.ieee = el("sensor-ieee").value;
            } else if (kind === "ld2410c") {
                data.ip = el("sensor-ld2410c-ip").value;
            } else if (kind === "ds18b20") {
                data.ip = el("sensor-ds18b20-ip").value;
                data.rom = el("sensor-ds18b20-rom").value.trim();
            } else if (kind === "local_ds18b20") {
                data.rom = el("sensor-local-ds18b20-rom").value.trim();
            } else {
                data.ip = el("sensor-ip").value;
                data.path = el("sensor-path").value;
                if (el("sensor-timeout").value) {
                    data.timeout = parseInt(el("sensor-timeout").value, 10);
                }
            }

            return data;
        }

        var localDiscoverButton = el("sensor-local-ds18b20-discover-button");
        var localDiscoverResult = el("sensor-local-ds18b20-discover-result");

        localDiscoverButton.addEventListener("click", function () {

            localDiscoverButton.disabled = true;
            localDiscoverResult.innerHTML = "<div class=\"settings-hint\">Wyszukiwanie…</div>";

            api("/sensor/discover_local_roms")
                .then(function (res) {

                    if (!res.ok) {
                        localDiscoverResult.innerHTML = "<div class=\"settings-message error\">" +
                            (res.error === "local_ds18b20_disabled"
                                ? "Brak LOCAL_DS18B20_PIN w config.py."
                                : "Błąd: " + (res.error || "nieznany")) + "</div>";
                        return;
                    }

                    if (!res.roms.length) {
                        localDiscoverResult.innerHTML = "<div class=\"settings-message error\">Nie znaleziono czujnika - sprawdź podłączenie i rezystor 4,7 kΩ.</div>";
                        return;
                    }

                    localDiscoverResult.innerHTML = res.roms.map(function (rom) {
                        return "<div class=\"settings-row\">" +
                            "<div class=\"settings-row-text\"><label>" + rom + "</label></div>" +
                            "<button type=\"button\" data-rom=\"" + rom + "\">Wybierz</button>" +
                            "</div>";
                    }).join("");

                    Array.prototype.forEach.call(localDiscoverResult.querySelectorAll("[data-rom]"), function (btn) {
                        btn.addEventListener("click", function () {
                            el("sensor-local-ds18b20-rom").value = btn.getAttribute("data-rom");
                            localDiscoverResult.innerHTML = "";
                        });
                    });
                })
                .catch(function () {
                    localDiscoverResult.innerHTML = "<div class=\"settings-message error\">Błąd zapytania.</div>";
                })
                .then(function () {
                    localDiscoverButton.disabled = false;
                });
        });

        sensorDs18b20DiscoverButton.addEventListener("click", function () {

            var ip = el("sensor-ds18b20-ip").value;

            if (!ip) {
                sensorDs18b20DiscoverResult.innerHTML = "<div class=\"settings-message error\">Podaj najpierw adres IP huba.</div>";
                return;
            }

            sensorDs18b20DiscoverButton.disabled = true;
            sensorDs18b20DiscoverResult.innerHTML = "<div class=\"settings-hint\">Wyszukiwanie…</div>";

            api("/sensor/discover_roms?ip=" + encodeURIComponent(ip))
                .then(function (res) {

                    if (!res.ok) {
                        sensorDs18b20DiscoverResult.innerHTML = "<div class=\"settings-message error\">Błąd: " + (res.error || "nieznany") + "</div>";
                        return;
                    }

                    // "sensors" (nazwa + ROM) z nowszego huba, samo "roms" ze starszego
                    var hubSensors = res.sensors || res.roms.map(function (rom) { return { rom: rom }; });

                    if (!hubSensors.length) {
                        sensorDs18b20DiscoverResult.innerHTML = "<div class=\"settings-message error\">Hub nie zwrócił żadnych czujników.</div>";
                        return;
                    }

                    sensorDs18b20DiscoverResult.innerHTML = hubSensors.map(function (s, i) {
                        var hint = s.rom;
                        if (s.online === false) {
                            hint += " · offline";
                        } else if (s.temperature_c != null) {
                            hint += " · " + s.temperature_c + " °C";
                        }
                        return "<div class=\"settings-row\">" +
                            "<div class=\"settings-row-text\"><label>" + escapeHtml(s.name || s.rom) + "</label>" +
                            (s.name ? "<div class=\"settings-hint\">" + escapeHtml(hint) + "</div>" : "") +
                            "</div>" +
                            "<button type=\"button\" data-hub-sensor=\"" + i + "\">Wybierz</button>" +
                            "</div>";
                    }).join("");

                    Array.prototype.forEach.call(sensorDs18b20DiscoverResult.querySelectorAll("[data-hub-sensor]"), function (btn) {
                        btn.addEventListener("click", function () {
                            var s = hubSensors[Number(btn.getAttribute("data-hub-sensor"))];
                            el("sensor-ds18b20-rom").value = s.rom;
                            // nazwa z huba jako podpowiedz - tylko gdy pole jest puste
                            if (s.name && !el("sensor-name").value) {
                                el("sensor-name").value = s.name;
                            }
                            sensorDs18b20DiscoverResult.innerHTML = "";
                        });
                    });
                })
                .catch(function () {
                    sensorDs18b20DiscoverResult.innerHTML = "<div class=\"settings-message error\">Błąd zapytania.</div>";
                })
                .then(function () {
                    sensorDs18b20DiscoverButton.disabled = false;
                });
        });

        sensorTestButton.addEventListener("click", function () {

            setStatus("sensor-form-status", "Testowanie…", false);

            api("/sensor/test", "POST", collectSensorData())
                .then(function (res) {
                    setStatus("sensor-form-status", formatTestResult(res), !res.online);
                })
                .catch(function () {
                    setStatus("sensor-form-status", "Błąd testu połączenia.", true);
                });
        });

        sensorForm.addEventListener("submit", function (e) {
            e.preventDefault();

            setStatus("sensor-form-status", "Zapisywanie...", false);

            var data = collectSensorData();

            var req = editId
                ? api("/device/schedule/sensors/" + editId, "PUT", data)
                : api("/device/schedule/sensors", "POST", data);

            req.then(function (res) {

                if (res.error) {
                    setStatus("sensor-form-status", "Błąd: " + res.error, true);
                    return;
                }

                window.location.href = "/config/devices/list";
            });
        });
    }

    // =====================================================
    // URZADZENIE
    // =====================================================

    var deviceForm = el("device-form");

    if (deviceForm) {

        var deviceNameInput = el("device-name");
        var deviceKindSelect = el("device-kind");
        var deviceTestButton = el("device-test-button");
        var sonoffCloudSelect = el("device-sonoff-cloud");
        var sonoffCloudRefresh = el("device-sonoff-cloud-refresh");
        var sonoffDeviceIdInput = el("device-sonoff-device-id");
        var sonoffDeviceKeyInput = el("device-sonoff-device-key");
        var sonoffCloudDevices = [];
        var sonoffCloudLoaded = false;

        function setSonoffCloudOptions(options) {
            sonoffCloudSelect.innerHTML = "";
            options.forEach(function (o) {
                var opt = document.createElement("option");
                opt.value = o.value;
                opt.textContent = o.label;
                sonoffCloudSelect.appendChild(opt);
            });
        }

        // Lista urzadzen z konta eWeLink (chmura, services/ewelink_cloud.py) -
        // wybor uzupelnia Device ID/Device Key (pola tylko do odczytu)
        function loadSonoffCloudDevices() {

            sonoffCloudLoaded = true;
            sonoffCloudSelect.disabled = true;
            sonoffCloudRefresh.disabled = true;
            setSonoffCloudOptions([{ value: "", label: "Pobieranie listy z eWeLink…" }]);

            api("/ewelink/devices")
                .then(function (res) {

                    if (!res.ok) {
                        var messages = {
                            no_account: "Brak konta eWeLink - uzupełnij w ustawieniach eWeLink",
                            no_app_config: "Brak App ID/App Secret/adresu API - uzupełnij w ustawieniach eWeLink"
                        };
                        sonoffCloudDevices = [];
                        setSonoffCloudOptions([{
                            value: "",
                            label: messages[res.error] || ("Błąd: " + (res.error || "nieznany"))
                        }]);
                        return;
                    }

                    sonoffCloudDevices = res.devices || [];

                    var options = [{
                        value: "",
                        label: sonoffCloudDevices.length ? "— wybierz urządzenie —" : "Brak urządzeń na koncie eWeLink"
                    }];

                    sonoffCloudDevices.forEach(function (d) {
                        var type = [d.brand, d.model].filter(Boolean).join(" ");
                        options.push({
                            value: d.device_id,
                            label: d.name + (type ? " — " + type : "") + (d.online ? "" : " (offline)")
                        });
                    });

                    // edycja urzadzenia, ktorego nie ma juz na koncie -
                    // zachowujemy zapisane dane zamiast je gubic
                    var currentId = sonoffDeviceIdInput.value;
                    var known = sonoffCloudDevices.some(function (d) { return d.device_id === currentId; });

                    if (currentId && !known) {
                        options.push({ value: currentId, label: "(zapisane, brak na koncie) " + currentId });
                    }

                    setSonoffCloudOptions(options);
                    sonoffCloudSelect.value = currentId || "";

                    // zapisany Device Key inny niz na koncie (np. wpisany
                    // recznie przed integracja z chmura) - bez tego
                    // urzadzenie nie odszyfruje zapytan lokalnych (timeout)
                    sonoffCloudDevices.forEach(function (d) {
                        if (d.device_id === currentId && d.device_key && d.device_key !== sonoffDeviceKeyInput.value) {
                            sonoffDeviceKeyInput.value = d.device_key;
                            setStatus("device-form-status", "Device Key zaktualizowany z konta eWeLink - zapisz urządzenie.", false);
                        }
                    });
                })
                .catch(function () {
                    setSonoffCloudOptions([{ value: "", label: "Błąd pobierania listy z eWeLink" }]);
                })
                .then(function () {
                    sonoffCloudSelect.disabled = false;
                    sonoffCloudRefresh.disabled = false;
                });
        }

        sonoffCloudSelect.addEventListener("change", function () {

            var id = sonoffCloudSelect.value;

            if (id === sonoffDeviceIdInput.value) {
                return;
            }

            var device = null;

            sonoffCloudDevices.forEach(function (d) {
                if (d.device_id === id) { device = d; }
            });

            sonoffDeviceIdInput.value = device ? device.device_id : "";
            sonoffDeviceKeyInput.value = device ? device.device_key : "";

            if (device && !deviceNameInput.value.trim()) {
                deviceNameInput.value = device.name;
            }
        });

        sonoffCloudRefresh.addEventListener("click", loadSonoffCloudDevices);

        function updateDeviceKindFields() {

            var kind = deviceKindSelect.value;
            var isZigbee = kind === "zigbee";
            var isSonoff = kind === "sonoff";

            el("device-ip-fields").hidden = isZigbee;
            el("device-zigbee-fields").hidden = !isZigbee;
            el("device-sonoff-fields").hidden = !isSonoff;

            el("device-ip-hint").hidden = kind !== "tapo";

            if (isSonoff && !sonoffCloudLoaded) {
                loadSonoffCloudDevices();
            }
        }

        deviceKindSelect.addEventListener("change", updateDeviceKindFields);

        if (editId) {

            el("device-form-title").textContent = "Edytuj urządzenie";

            api("/device/schedule/devices/" + editId).then(function (d) {

                if (d.error) {
                    setStatus("device-form-status", "Błąd: " + d.error, true);
                    return;
                }

                deviceNameInput.value = d.name || editId;

                var kind = d.kind || "tapo";

                deviceKindSelect.value = kind;

                if (kind === "zigbee") {
                    loadZigbeeDevices(el("device-ieee"), d.ieee);
                } else {
                    el("device-ip").value = d.ip || "";
                    if (kind === "sonoff") {
                        // PRZED updateDeviceKindFields() - lista eWeLink
                        // zaznacza urzadzenie wg tego pola
                        sonoffDeviceIdInput.value = d.device_id || "";
                        sonoffDeviceKeyInput.value = d.device_key || "";
                        el("device-sonoff-control").value = d.control || "local_cloud";
                    }
                }

                updateDeviceKindFields();
            });

        } else {
            updateDeviceKindFields();
            loadZigbeeDevices(el("device-ieee"));
        }

        function collectDeviceData() {

            var kind = deviceKindSelect.value;
            var data = { kind: kind, name: deviceNameInput.value.trim() };

            if (kind === "zigbee") {
                data.ieee = el("device-ieee").value;
            } else {
                data.ip = el("device-ip").value;
                if (kind === "sonoff") {
                    data.device_id = sonoffDeviceIdInput.value.trim();
                    data.device_key = sonoffDeviceKeyInput.value.trim();
                    data.control = el("device-sonoff-control").value;
                }
            }

            return data;
        }

        deviceTestButton.addEventListener("click", function () {

            setStatus("device-form-status", "Testowanie…", false);

            api("/device/test", "POST", collectDeviceData())
                .then(function (res) {
                    setStatus("device-form-status", formatTestResult(res), !res.online);
                })
                .catch(function () {
                    setStatus("device-form-status", "Błąd testu połączenia.", true);
                });
        });

        deviceForm.addEventListener("submit", function (e) {
            e.preventDefault();

            var data = collectDeviceData();

            if (data.kind === "sonoff" && !(data.device_id && data.device_key)) {
                setStatus("device-form-status", "Wybierz urządzenie z listy eWeLink.", true);
                return;
            }

            setStatus("device-form-status", "Zapisywanie...", false);

            var req = editId
                ? api("/device/schedule/devices/" + editId, "PUT", data)
                : api("/device/schedule/devices", "POST", data);

            req.then(function (res) {

                if (res.error) {
                    setStatus("device-form-status", "Błąd: " + res.error, true);
                    return;
                }

                window.location.href = "/config/devices/list";
            });
        });
    }

    // =====================================================
    // WSPOLNY FORMULARZ DODAWANIA (/config/devices/add) - lista "Rodzaj"
    // pokazuje formularz czujnika albo urzadzenia i ustawia jego "Typ"
    // (wlasne pole "Typ" formularza jest wtedy ukryte)
    // =====================================================

    var addKind = el("add-kind");

    if (addKind) {

        [sensorKindSelect, deviceKindSelect].forEach(function (select) {
            var row = select.closest(".settings-row");
            if (row) { row.style.display = "none"; }
        });

        var applyAddKind = function () {

            var parts = addKind.value.split(":");
            var isSensor = parts[0] === "sensor";
            var isDevice = parts[0] === "device";

            el("add-sensor-wrap").hidden = !isSensor;
            el("add-device-wrap").hidden = !isDevice;

            var select = isSensor ? sensorKindSelect : (isDevice ? deviceKindSelect : null);

            if (select) {
                select.value = parts[1];
                select.dispatchEvent(new Event("change"));
            }
        };

        addKind.addEventListener("change", applyAddKind);

        var presetKind = getQueryParam("type");

        if (presetKind) {
            addKind.value = presetKind;
            applyAddKind();
        }
    }
})();
