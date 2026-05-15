// Страница папки видео.

import { subscribeToAuth } from "./firebase.js";
import { videosApi } from "./data.js";
import { createVideoCard } from "./ui.js";

const listEl = document.getElementById("video-list");
const emptyEl = document.getElementById("empty-state");
const errorEl = document.getElementById("error-state");
const loadingEl = document.getElementById("loading-state");
const titleEl = document.getElementById("folder-title");
const metaEl = document.getElementById("folder-meta");

const params = new URLSearchParams(window.location.search);
const folderName = params.get("name");

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

        loadingEl.hidden = true;

        if (videos.length === 0) {
            listEl.innerHTML = "";
            emptyEl.hidden = false;
            metaEl.textContent = "";
            setTimeout(() => {
                if (confirm("В этой папке больше нет видео. Вернуться к разделу Видео?")) {
                    window.location.href = "index.html#videos";
                }
            }, 100);
            return;
        }

        metaEl.textContent = `${videos.length} видео`;
        listEl.innerHTML = "";
        for (const video of videos) {
            listEl.appendChild(createVideoCard(video, { onDelete: load, onSaved: load }));
        }
    } catch (err) {
        console.error(err);
        loadingEl.hidden = true;
        showError(`Не удалось загрузить папку: ${err.message}`);
    }
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
