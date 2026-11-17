(function () {

    function el(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
        });
    }

    function fmtNum(value, digits) {
        return value == null ? "-" : value.toFixed(digits);
    }

    // format jak na fakturze Enea: kropka tysiecy, przecinek dziesietny
    // ("1.370,17", "1.002")
    function fmtPl(value, digits) {

        if (value == null) { return "-"; }

        var parts = Number(value).toFixed(digits).split(".");
        var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");

        return parts.length > 1 ? int + "," + parts[1] : int;
    }

    var MONTH_SHORT = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

    function monthLabel(monthKey) {
        var p = monthKey.split("-");
        return MONTH_SHORT[parseInt(p[1], 10) - 1] + "." + p[0];
    }

    // Tabela miesieczna w ukladzie faktury Enea - "columns":
    // [{label, value(statement) -> tekst}]; kolumna "miesiac" dodawana
    // zawsze jako pierwsza
    function renderMonthlyTable(statements, columns) {

        var head = "<th>miesiąc</th>" + columns.map(function (col) {
            return "<th class=\"align-right\">" + escapeHtml(col.label) + "</th>";
        }).join("");

        var body = statements.map(function (s) {
            return "<tr><td>" + escapeHtml(monthLabel(s.month)) + "</td>" +
                columns.map(function (col) {
                    return "<td class=\"measurement-energy\">" + col.value(s) + "</td>";
                }).join("") + "</tr>";
        }).join("");

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr>" + head + "</tr></thead>" +
            "<tbody>" + body + "</tbody>" +
            "</table></div>";
    }

    function panel(title, content, hint) {
        return "<section class=\"settings-panel\">" +
            "<div class=\"settings-panel-title\">" + escapeHtml(title) + "</div>" +
            content +
            (hint ? "<p class=\"settings-hint\" style=\"padding:8px 0 0\">" + escapeHtml(hint) + "</p>" : "") +
            "</section>";
    }

    // ROZLICZENIE ENERGII POBRANEJ / WPROWADZONEJ (DEPOZYT PROSUMENCKI) -
    // jak na fakturze Enea, w trzech tabelach (jedna nie miescila sie w
    // szerokosci okna)
    function renderDepositTables(statements) {

        return panel("ROZLICZENIE ENERGII ELEKTRYCZNEJ POBRANEJ Z SIECI W DANYM MIESIĄCU", renderMonthlyTable(statements, [
                { label: "Eb(t)+ (kWh)", value: function (s) { return fmtPl(s.total_kwh, 0); } },
                { label: "Netto (zł)", value: function (s) { return fmtPl(s.sale_net_total, 2); } },
                { label: "Brutto (zł)", value: function (s) { return fmtPl(s.sale_gross_total, 2); } },
            ]), "Eb(t)+ - ilość energii pobranej, zbilansowanej godzinowo.") +
            panel("ROZLICZENIE ENERGII ELEKTRYCZNEJ WPROWADZONEJ DO SIECI (DEPOZYT PROSUMENCKI)", renderMonthlyTable(statements, [
                { label: "Eb(t)- (kWh)", value: function (s) { return fmtPl(s.export_kwh, 0); } },
                { label: "Cena rynkowa (zł/kWh)", value: function (s) { return fmtPl(s.market_price_pln, 5); } },
                { label: "Wartość (zł)", value: function (s) { return fmtPl(s.deposit_value_pln, 2); } },
            ]), "Eb(t)- - ilość energii wprowadzonej, zbilansowanej godzinowo. Wartość = Eb(t)- × cena rynkowa energii × współczynnik 1,23.") +
            panel("WARTOŚĆ DEPOZYTU", renderMonthlyTable(statements, [
                { label: "Z poprzedniego okresu (zł)", value: function (s) { return fmtPl(s.deposit_start_pln, 2); } },
                { label: "Wykorzystany (zł)", value: function (s) { return fmtPl(s.deposit_used_pln, 2); } },
                { label: "Do wykorzystania (zł)", value: function (s) { return fmtPl(s.deposit_balance_pln, 2); } },
                { label: "Do zapłaty (zł)", value: function (s) { return fmtPl(s.to_pay_pln, 2); } },
            ]), "Z poprzedniego okresu - saldo depozytu na początek miesiąca, od salda zapisanego na ekranie Odczyty liczników " +
                "(kolejne miesiące wyliczane). Wykorzystany - w bieżącym miesiącu, pokrywa tylko należność za energię (brutto). Do wykorzystania - " +
                "w rozliczeniach w kolejnych miesiącach. Do zapłaty - ogółem brutto minus wykorzystany depozyt (opłaty dystrybucyjne zawsze).");
    }

    // Enea podaje zuzycie w PELNYCH kWh - ilosci juz zaokraglone przez
    // services/energy_report.py::build_settlement_report() (od nich
    // liczone sa naleznosci)
    function fmtKwhWhole(value) {
        return value == null ? "-" : String(Math.round(value));
    }

    var tariffSelect = el("settlement-tariff");

    function loadTariffOptions() {
        fetch("/tariffs")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                var tariffs = res.tariffs || {};
                var activeId = res.active_id;

                var options = "<option value=\"\">(aktywna" + (activeId && tariffs[activeId] ? " - " + escapeHtml(tariffs[activeId].name) : "") + ")</option>";

                options += Object.keys(tariffs).map(function (id) {
                    return "<option value=\"" + id + "\">" + escapeHtml(tariffs[id].name || id) + "</option>";
                }).join("");

                tariffSelect.innerHTML = options;
            })
            .catch(function () {
                tariffSelect.innerHTML = "<option value=\"\">(aktywna)</option>";
            });
    }


    var startInput = el("settlement-start");
    var endInput = el("settlement-end");
    var prevMonthButton = el("settlement-prev-month");
    var showButton = el("settlement-show");
    var statusEl = el("settlement-status");
    var statementsEl = el("settlement-statements");
    function monthOf(dateText) { return (dateText || "").slice(0, 7); }


    var MAX_MONTHS_BACK = 12;

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    function fmtDate(y, m, d) {
        return y + "-" + pad2(m) + "-" + pad2(d);
    }

    function lastDayOfMonth(year, month) {
        return new Date(year, month, 0).getDate();
    }

    function todayParts() {
        var now = new Date();
        return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    }

    function monthsBetween(y1, m1, y2, m2) {
        return (y2 - y1) * 12 + (m2 - m1);
    }

    prevMonthButton.addEventListener("click", function () {

        var startParts = startInput.value.split("-").map(Number);
        var year = startParts[0];
        var month = startParts[1] - 1;

        if (month < 1) { month = 12; year -= 1; }

        var today = todayParts();

        if (monthsBetween(year, month, today.y, today.m) >= MAX_MONTHS_BACK) {
            statusEl.textContent = "Można cofnąć się maksymalnie " + MAX_MONTHS_BACK + " miesięcy wstecz.";
            statusEl.className = "settings-message error";
            return;
        }

        startInput.value = fmtDate(year, month, 1);
        endInput.value = fmtDate(year, month, lastDayOfMonth(year, month));

        statusEl.textContent = "";
    });

    // groupDescriptions - opis powtarzajacy sie w kolejnym wierszu nie jest
    // wypisywany ponownie (jak na fakturze Enea)
    function renderRowsTable(rows, netTotal, sumLabel, groupDescriptions, grossRow) {

        var body = rows.map(function (row, i) {
            var prev = i > 0 ? rows[i - 1] : null;
            var repeated = groupDescriptions && prev && prev.description === row.description;
            return "<tr>" +
                "<td>" + (repeated ? "" : escapeHtml(row.description)) + "</td>" +
                "<td>" + escapeHtml(row.zone == null ? "-" : row.zone) + "</td>" +
                "<td>" + escapeHtml(row.unit) + "</td>" +
                "<td>" + escapeHtml(row.date) + "</td>" +
                "<td class=\"measurement-energy\">" + (row.unit === "kWh" ? fmtKwhWhole(row.quantity) : fmtNum(row.quantity, 4)) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtNum(row.unit_price_pln, 4) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtNum(row.net_pln, 2) + "</td>" +
                "<td class=\"measurement-energy\">" + fmtNum(row.vat_percent, 2) + "</td>" +
                "</tr>";
        }).join("");

        var sumRow = "<tr class=\"settlement-sum-row\">" +
            "<td colspan=\"6\"><strong>" + escapeHtml(sumLabel) + "</strong></td>" +
            "<td class=\"measurement-energy\"><strong>" + fmtNum(netTotal, 2) + " zł</strong></td>" +
            "<td></td>" +
            "</tr>";

        // grossRow - dodatkowy wiersz sumy brutto {label, value}
        if (grossRow) {
            sumRow += "<tr class=\"settlement-sum-row\">" +
                "<td colspan=\"6\"><strong>" + escapeHtml(grossRow.label) + "</strong></td>" +
                "<td class=\"measurement-energy\"><strong>" + fmtNum(grossRow.value, 2) + " zł</strong></td>" +
                "<td></td>" +
                "</tr>";
        }

        if (!rows.length) {
            body = "<tr><td colspan=\"8\" class=\"history-empty\">Brak pozycji</td></tr>";
        }

        return "<div class=\"history-measurements-wrapper\">" +
            "<table class=\"history-measurements\">" +
            "<thead><tr>" +
            "<th>Opis</th><th>Strefa</th><th>j.m.</th><th>Data</th>" +
            "<th class=\"align-right\">Ilość</th><th class=\"align-right\">Cena jedn. netto (zł)</th><th class=\"align-right\">Należność netto (zł)</th><th class=\"align-right\">Stawka VAT (%)</th>" +
            "</tr></thead>" +
            "<tbody>" + body + sumRow + "</tbody>" +
            "</table></div>";
    }

    // Laczy wiersze TEGO SAMEGO rodzaju (sale_rows/distribution_rows)
    // ze WSZYSTKICH miesiecy zakresu w JEDNA liste, sortowana po
    // dacie, a w ramach dnia po strefie (i dla distribution_rows -
    // dodatkowo po opłacie w ramach strefy) - statements sa juz
    // chronologiczne, a KAZDY statement sam w sobie generuje swoje
    // wiersze juz w kolejnosci strefa->opłata (patrz
    // services/energy_report.py::build_settlement_report(), petle
    // "for zone in tariff_def.get('zones', [])" / "for cost in
    // zone.get('other_costs', [])") - dlatego samo zlaczenie w
    // kolejnosci miesiecy wystarcza, bez dodatkowego sortowania.
    function flattenRowsAcrossMonths(statements, rowsKey) {

        var combined = [];

        statements.forEach(function (statement) {
            combined = combined.concat(statement[rowsKey] || []);
        });

        return combined;
    }

    // Usluga dystrybucji: opis -> data -> strefa. Opisy: najpierw oplaty
    // stale (bez strefy), potem zmienne, kazde w kolejnosci z taryfy.
    // Backend generuje wiersze strefa po strefie (oplaty kazdej strefy w
    // kolejnosci z taryfy, na koncu stale), wiec kolejnosc opisu = jego
    // pierwsze wystapienie, a strefy = indeks wiersza (Array.sort nie
    // wszedzie jest stabilny).
    function sortDistributionRows(rows) {

        var descRank = {};

        rows.forEach(function (row, i) {
            var d = row.description || "";
            if (!(d in descRank)) {
                // stale przed zmiennymi - przesuniecie o liczbe wierszy
                descRank[d] = (row.zone == null ? 0 : rows.length) + i;
            }
        });

        var indexed = rows.map(function (row, i) { return { row: row, i: i }; });

        indexed.sort(function (a, b) {
            var ra = descRank[a.row.description || ""], rb = descRank[b.row.description || ""];
            if (ra !== rb) { return ra - rb; }
            if (a.row.date !== b.row.date) { return a.row.date < b.row.date ? -1 : 1; }
            return a.i - b.i;
        });

        return indexed.map(function (item) { return item.row; });
    }

    function sumField(statements, field) {
        return statements.reduce(function (sum, s) { return sum + (s[field] || 0); }, 0);
    }

    // dystrybucja brutto = ogolem brutto - sprzedaz energii brutto (services/energy_report.py::
    // settlement_statement()) - zgodne co do grosza z "Do zaplaty" przy depozycie pokrywajacym energie
    function distributionGross(statements) {
        return statements.reduce(function (sum, s) {
            return sum + (s.gross_total_pln || 0) - (s.sale_gross_total || 0);
        }, 0);
    }

    function renderReport(report) {

        if (report.error) {
            statementsEl.innerHTML = "<section class=\"settings-panel\"><div class=\"settings-hint\">Błąd: " + escapeHtml(report.error) + (report.hint ? " (" + escapeHtml(report.hint) + ")" : "") + "</div></section>";
            return;
        }

        var statements = report.statements || [];

        if (!statements.length) {
            statementsEl.innerHTML = "<section class=\"settings-panel\"><div class=\"settings-hint\">Brak miesięcy w tym okresie.</div></section>";
            return;
        }

        var saleRows = flattenRowsAcrossMonths(statements, "sale_rows");
        var distributionRows = sortDistributionRows(flattenRowsAcrossMonths(statements, "distribution_rows"));

        statementsEl.innerHTML =
            renderDepositTables(statements) +

            "<section class=\"settings-panel\">" +
            "<div class=\"settings-panel-title\">ROZLICZENIE - SPRZEDAŻ ENERGII</div>" +
            renderRowsTable(saleRows, sumField(statements, "sale_net_total"), "Razem sprzedaż energii") +
            "</section>" +

            "<section class=\"settings-panel\">" +
            "<div class=\"settings-panel-title\">ROZLICZENIE - USŁUGA DYSTRYBUCJI ENERGII</div>" +
            renderRowsTable(distributionRows, sumField(statements, "distribution_net_total"), "Razem usługa dystrybucji (netto)", true,
                { label: "Razem usługa dystrybucji (brutto)", value: distributionGross(statements) }) +
            "</section>" +

            "<section class=\"settings-panel\">" +
            "<div class=\"settings-panel-title\">Podsumowanie okresu " + escapeHtml(report.start) + " - " + escapeHtml(report.end) + "</div>" +
            "<div class=\"settings-row\">" +
            "<div class=\"settings-row-text\"><label>Zużycie energii w okresie</label></div>" +
            "<div class=\"settings-hint\">" + fmtKwhWhole(sumField(statements, "total_kwh")) + " kWh</div>" +
            "</div>" +
            "<div class=\"settings-row\">" +
            "<div class=\"settings-row-text\"><label>Ogółem netto</label></div>" +
            "<div class=\"settings-hint\">" + fmtNum(sumField(statements, "net_total_pln"), 2) + " zł</div>" +
            "</div>" +
            "<div class=\"settings-row\">" +
            "<div class=\"settings-row-text\"><label>Ogółem brutto</label></div>" +
            "<div class=\"settings-hint\">" + fmtNum(sumField(statements, "gross_total_pln"), 2) + " zł</div>" +
            "</div>" +
            "<div class=\"settings-row\">" +
            "<div class=\"settings-row-text\"><label>Do zapłaty (po rozliczeniu depozytu)</label></div>" +
            "<div class=\"settings-hint\">" + fmtNum(sumField(statements, "to_pay_pln"), 2) + " zł</div>" +
            "</div>" +
            "</section>";

        var missingDates = report.missing_dates || [];

        if (missingDates.length && !backfillPollTimer) {
            showMissingDataPrompt(missingDates);
        }
    }

    function loadReport() {

        if (!startInput.value || !endInput.value) { return; }

        if (startInput.value > endInput.value) {
            statusEl.textContent = "Data \"Od\" musi być wcześniejsza niż \"Do\".";
            statusEl.className = "settings-message error";
            return;
        }

        statusEl.textContent = "";
        statementsEl.innerHTML = "<section class=\"settings-panel\"><div class=\"settings-hint\">Wczytywanie&hellip;</div></section>";

        var url = "/report/energy/settlement?start=" + encodeURIComponent(startInput.value) + "&end=" + encodeURIComponent(endInput.value);

        if (tariffSelect.value) {
            url += "&tariff_id=" + encodeURIComponent(tariffSelect.value);
        }

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(renderReport)
            .catch(function () {
                statementsEl.innerHTML = "<section class=\"settings-panel\"><div class=\"settings-hint\">Błąd wczytywania rozliczenia.</div></section>";
            });
    }

    showButton.addEventListener("click", loadReport);

    // =====================================================
    // OKNO "BRAKUJACE DANE" - jak w /report/energy/view, patrz
    // services/energy_archive_service.py::queue_backfill()
    // =====================================================

    var backfillModal = el("backfill-modal");
    var backfillModalTitle = el("backfill-modal-title");
    var backfillModalMessage = el("backfill-modal-message");
    var backfillModalClose = el("backfill-modal-close");
    var backfillModalConfirm = el("backfill-modal-confirm");
    var backfillPollTimer = null;

    function closeBackfillModal() {
        backfillModal.hidden = true;
    }

    backfillModalClose.addEventListener("click", closeBackfillModal);

    function pollBackfillStatus() {

        fetch("/report/energy/archive/backfill")
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (res.pending > 0) {
                    backfillModalMessage.textContent = "Uzupełnianie w tle… pozostało dni: " + res.pending + ". Można zamknąć to okno - wczytywanie będzie kontynuowane.";
                    return;
                }

                clearInterval(backfillPollTimer);
                backfillPollTimer = null;

                backfillModalMessage.textContent = "Uzupełnianie zakończone.";
                loadReport();
            })
            .catch(function () {
                clearInterval(backfillPollTimer);
                backfillPollTimer = null;
                backfillModalMessage.textContent = "Błąd sprawdzania postępu uzupełniania.";
            });
    }

    function startBackfill() {

        backfillModalConfirm.hidden = true;
        backfillModalTitle.textContent = "Uzupełnianie danych";
        backfillModalMessage.textContent = "Zlecanie uzupełnienia…";

        fetch("/report/energy/archive/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start: startInput.value, end: endInput.value })
        })
            .then(function (r) { return r.json(); })
            .then(function (res) {

                if (!res.status || res.status.pending === 0) {
                    backfillModalMessage.textContent = "Brak brakujących dni do uzupełnienia w tym okresie.";
                    return;
                }

                backfillModalMessage.textContent = "Zlecono uzupełnienie " + res.queued + " dni - przetwarzane w tle (jeden dzień na ok. 20s). Można zamknąć to okno - wczytywanie będzie kontynuowane.";

                if (backfillPollTimer) { clearInterval(backfillPollTimer); }
                backfillPollTimer = setInterval(pollBackfillStatus, 5000);
            })
            .catch(function () {
                backfillModalMessage.textContent = "Błąd zlecania uzupełnienia.";
            });
    }

    function showMissingDataPrompt(missingDates) {

        backfillModalTitle.textContent = "Brakujące dane";

        var range = missingDates.length > 1
            ? (missingDates[0] + " – " + missingDates[missingDates.length - 1])
            : missingDates[0];

        backfillModalMessage.textContent = "W wybranym okresie brakuje danych dla " + missingDates.length +
            " dni (" + range + "). Trzeba je doczytać z Deye Cloud / PSE, żeby rozliczenie było kompletne. Uzupełnić teraz?";

        backfillModalConfirm.hidden = false;
        backfillModalConfirm.onclick = startBackfill;

        backfillModal.hidden = false;
    }

    var today = todayParts();
    startInput.value = fmtDate(today.y, today.m, 1);
    endInput.value = fmtDate(today.y, today.m, today.d);

    loadTariffOptions();

    // raport liczy sie dopiero po "Pokaz" (duzy zakres potrafi chwile
    // trwac na kontrolerze)
    statementsEl.innerHTML = "<section class=\"settings-panel\"><div class=\"settings-hint\">Wybierz okres i kliknij \"Pokaż\".</div></section>";
})();
