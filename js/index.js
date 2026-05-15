// Главная страница — табы Видео / Книги / Фильмы.
// URL-hash отвечает за выбранный таб (#videos / #books / #films).

import { subscribeToAuth } from "./firebase.js";
import { videosApi } from "./data.js";
import { createVideoCard, createFolderCard } from "./ui.js";

const DEFAULT_TAB = "videos";

const tabs = document.querySelectorAll(".tab-link");
const sections = document.querySelectorAll(".tab-section");

const videosEmptyEl = document.getElementById("videos-empty");
const videosErrorEl = document.getElementById("videos-error");
const videosLoadingEl = document.getElementById("videos-loading");
const videosTotalEl = document.getElementById("videos-total");

const foldersSection = document.getElementById("folders-section");
const foldersList = document.getElementById("folders-list");
const standaloneSection = document.getElementById("standalone-section");
const standaloneList = document.getElementById("standalone-list");

// Какие табы уже загружали данные (чтобы не перезагружать при переключении назад)
const loadedTabs = new Set();

async function init() {
    setupTabRouting();

    // Ждем авторизованного пользователя — auth-overlay покрывает страницу пока нет user.
    let didLoad = false;
    subscribeToAuth((user) => {
        if (user && !didLoad) {
            didLoad = true;
            activateTab(getCurrentTabFromHash());
        }
    });

    // Если у пользователя открыто несколько вкладок — освежаем список когда
    // он возвращается во вкладку (например, после загрузки в админке).
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && loadedTabs.has("videos")) {
            loadVideos();
        }
    });
}

// --- Tabs ---

function setupTabRouting() {
    tabs.forEach((tab) => {
        tab.addEventListener("click", (e) => {
            e.preventDefault();
            const target = tab.dataset.tab;
            activateTab(target);
            if (location.hash !== `#${target}`) {
                history.pushState(null, "", `#${target}`);
            }
        });
    });

    // Back/forward — слушаем смену hash
    window.addEventListener("hashchange", () => {
        activateTab(getCurrentTabFromHash());
    });
}

function getCurrentTabFromHash() {
    const hash = location.hash.slice(1);
    if (["videos", "books", "films"].includes(hash)) return hash;
    return DEFAULT_TAB;
}

function activateTab(tabName) {
    tabs.forEach((t) => t.classList.toggle("tab-link--active", t.dataset.tab === tabName));
    sections.forEach((s) =>
        s.classList.toggle("tab-section--active", s.dataset.section === tabName)
    );

    if (!loadedTabs.has(tabName)) {
        loadedTabs.add(tabName);
        loadTabContent(tabName);
    }
}

function loadTabContent(tabName) {
    if (tabName === "videos") loadVideos();
    // books/films пока статичные заглушки, ничего не грузим
}

// --- Видео ---

async function loadVideos() {
    try {
        videosLoadingEl.hidden = false;
        videosEmptyEl.hidden = true;
        videosErrorEl.hidden = true;
        videosTotalEl.hidden = true;
        foldersSection.hidden = true;
        standaloneSection.hidden = true;

        const videos = await videosApi.fetchAll();

        videosLoadingEl.hidden = true;

        if (videos.length === 0) {
            foldersList.innerHTML = "";
            standaloneList.innerHTML = "";
            videosEmptyEl.hidden = false;
            videosTotalEl.hidden = true;
            return;
        }

        renderVideos(videos);
    } catch (err) {
        console.error(err);
        videosLoadingEl.hidden = true;
        videosErrorEl.textContent = `Не удалось загрузить список: ${err.message}`;
        videosErrorEl.hidden = false;
    }
}

function renderVideos(videos) {
    videosTotalEl.textContent = `${videos.length} видео`;
    videosTotalEl.hidden = false;

    const folderMap = new Map();
    const standaloneVideos = [];

    for (const video of videos) {
        if (video.folder) {
            if (!folderMap.has(video.folder)) folderMap.set(video.folder, []);
            folderMap.get(video.folder).push(video);
        } else {
            standaloneVideos.push(video);
        }
    }

    // Папки
    foldersList.innerHTML = "";
    const folderNames = [...folderMap.keys()].sort((a, b) => a.localeCompare(b, "ru"));
    for (const name of folderNames) {
        foldersList.appendChild(createFolderCard(name, folderMap.get(name).length, {
            onDelete: loadVideos,
            onRenamed: loadVideos,
            existingFolders: folderNames,
        }));
    }
    foldersSection.hidden = folderNames.length === 0;

    // Одиночные видео
    standaloneList.innerHTML = "";
    for (const video of standaloneVideos) {
        standaloneList.appendChild(createVideoCard(video, { onDelete: loadVideos, onSaved: loadVideos }));
    }
    standaloneSection.hidden = standaloneVideos.length === 0;
}

init();
