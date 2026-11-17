// Wspolne dla wszystkich stron: rozwijane menu w naglowku
// (patrz www/layout.py). Bezpieczne no-op na stronach bez menu.
(function () {
    var button = document.getElementById("menu-button");
    var dropdown = document.getElementById("menu-dropdown");

    if (!button || !dropdown) {
        return;
    }

    function close() {
        dropdown.hidden = true;
        button.setAttribute("aria-expanded", "false");
    }

    function toggle(e) {
        e.stopPropagation();
        var willOpen = dropdown.hidden;
        dropdown.hidden = !willOpen;
        button.setAttribute("aria-expanded", willOpen ? "true" : "false");
    }

    button.addEventListener("click", toggle);

    document.addEventListener("click", function (e) {
        if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== button) {
            close();
        }
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            close();
        }
    });
})();
