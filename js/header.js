// Общая шапка для страниц index/folder/admin (на watch.html — своя topbar).
// Подключается одним <script type="module" src="js/header.js"></script> в <head>.
//
// data-active-tab на <header id="page-header"> — какой таб подсветить (опц.,
// на index не нужен — JS-роутер сам ставит active по hash).
//
// Управление пользователем (Выйти / переход в Админ) — в нижней панели (bottom-nav.js).

const TABS = [
    { id: "videos", label: "Видео" },
    { id: "books",  label: "Книги" },
    { id: "films",  label: "Фильмы" },
];

function init() {
    const el = document.getElementById("page-header");
    if (!el) return;

    const activeTab = el.dataset.activeTab || "";
    const tabsHtml = TABS.map(({ id, label }) => {
        const active = id === activeTab ? " tab-link--active" : "";
        return `<a href="index.html#${id}" class="tab-link${active}" data-tab="${id}">${label}</a>`;
    }).join("");

    el.innerHTML = `
        <div class="page-header__wrap">
            <img class="school-emblem" src="img/wingchun-emblem.png" alt="">
            <div class="page-header__inner">
                <img class="page-header__logo" src="img/logo.svg" alt="">
                <h1>Spring Library</h1>
            </div>
            <nav class="tabs-nav">${tabsHtml}</nav>
        </div>
    `;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
