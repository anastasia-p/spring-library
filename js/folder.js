// Страница папки видео.

import { subscribeToAuth } from "./firebase.js";
import { videosApi } from "./data.js";
import { createVideoCard } from "./ui.js";
import { createSortControl, loadSort, sortVideos } from "./sort-controls.js";

const listEl = document.getElementById("video-list");
const emptyEl = document.getElementById("empty-state");
const errorEl = document.getElementById("error-state");
const loadingEl = document.getElementById("loading-state");
const titleEl = document.getElementById("folder-title");
const metaEl = document.getElementById("folder-meta");
const sortContainer = document.getElementById("folder-sort");

const params = new URLSearchParams(window.location.search);
const folderName = params.get("name");

// Кэш видео + текущая сортировка. Контрол сортировки меняет currentSort
// и вызывает renderList(allVideosCache) — без повторного запроса.
let allVideosCache = [];
let currentSort = loadSort();
let sortControlMounted = false;

async function load() {
    if (!folderName) {
        showError("В URL не указано имя папки");
        return;
    }

    titleEl.textContent = `📁 ${folderName}`;
    document.title = `${folderName} — Spring Library`;

    try {
        loadingEl.hidden = false;
        emptyEl.hidden = true;
        errorEl.hidden = true;

        const videos = await videosApi.fetchInFolder(folderName);
        allVideosCache = videos;

        loadingEl.hidden = true;

        if (videos.length === 0) {
            listEl.innerHTML = "";
            emptyEl.hidden = false;
            metaEl.textContent = "";
            if (sortContainer) sortContainer.hidden = true;
            setTimeout(() => {
                if (confirm("В этой папке больше нет видео. Вернуться к разделу Видео?")) {
                    window.location.href = "index.html#videos";
                }
            }, 100);
            return;
        }

        metaEl.textContent = `${videos.length} видео`;
        if (sortContainer) sortContainer.hidden = false;
        renderList(videos);
        mountSortControl();
    } catch (err) {
        console.error(err);
        loadingEl.hidden = true;
        showError(`Не удалось загрузить папку: ${err.message}`);
    }
}

function renderList(videos) {
    const sorted = sortVideos(videos, currentSort.field, currentSort.dir);
    listEl.innerHTML = "";
    for (const video of sorted) {
        listEl.appendChild(createVideoCard(video, {
            onDelete: load,
            onSaved: load,
            onHiddenChanged: load,
        }));
    }
}

function mountSortControl() {
    if (sortControlMounted) return;
    if (!sortContainer) return;
    const ctrl = createSortControl((sort) => {
        currentSort = sort;
        renderList(allVideosCache);
    });
    sortContainer.appendChild(ctrl);
    sortControlMounted = true;
}

function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
}

// Ждем авторизованного пользователя — auth-overlay покрывает страницу пока нет user.
let didLoad = false;
subscribeToAuth((user) => {
    if (user && !didLoad) {
        didLoad = true;
        load();
    }
});

// Освежаем список когда вкладка снова становится активной — на случай если
// видео были загружены/удалены в другой вкладке.
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && didLoad) load();
});
