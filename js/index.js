// Главная страница — табы Видео / Книги / Фильмы.
// URL-hash отвечает за выбранный таб (#videos / #books / #films).

import { subscribeToAuth, subscribeToProfile, getUserProfile } from "./firebase.js";
import { videosApi } from "./data.js";
import { createVideoCard, createFolderCard } from "./ui.js";
import {
    createSortControl,
    loadSort,
    sortVideosWithLikes,
    sortFoldersWithLikes,
} from "./sort-controls.js";

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
const standaloneSortContainer = document.getElementById("standalone-sort");

// Какие табы уже подписались на данные (чтобы не плодить подписки при переключении назад)
const subscribedTabs = new Set();

// Кэш последнего списка видео + текущая сортировка. Контрол сортировки меняет
// currentSort и вызывает renderVideos(allVideosCache) — без повторного запроса.
let allVideosCache = [];
let currentSort = loadSort();
let sortControlMounted = false;
let unsubscribeFromVideos = null;

// --- Сохранение позиции скролла ---
// При ре-рендере списка (редактирование, скрытие, лайк → onSnapshot)
// и при возврате с watch.html через back — позиция теряется.
// Решение: синхронный снапшот scrollY ДО изменения DOM,
// восстановление через requestAnimationFrame ПОСЛЕ.
// Между страницами — sessionStorage по url.
if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
}
const SCROLL_STORAGE_KEY = `scroll_${location.pathname}${location.search}`;
let scrollRestoredFromStorage = false;
window.addEventListener("pagehide", () => {
    sessionStorage.setItem(SCROLL_STORAGE_KEY, String(window.scrollY));
});

function restoreScrollAfterRender(savedScroll) {
    // Первый рендер на странице — приоритет у сохранённой между страницами позиции.
    if (!scrollRestoredFromStorage) {
        scrollRestoredFromStorage = true;
        const stored = sessionStorage.getItem(SCROLL_STORAGE_KEY);
        if (stored) {
            sessionStorage.removeItem(SCROLL_STORAGE_KEY);
            const y = parseInt(stored, 10);
            if (y > 0) {
                requestAnimationFrame(() => window.scrollTo(0, y));
                return;
            }
        }
    }
    // Последующие рендеры — возвращаемся к снапшоту, если был ненулевой.
    if (savedScroll > 0) {
        requestAnimationFrame(() => window.scrollTo(0, savedScroll));
    }
}

async function init() {
    setupTabRouting();

    // При логине стартуем подписки активного таба. При логауте — отписываемся
    // и сбрасываем флаги, чтобы при следующем логине подписки переподнялись.
    subscribeToAuth((user) => {
        if (user) {
            activateTab(getCurrentTabFromHash());
        } else {
            stopVideosSubscription();
            subscribedTabs.clear();
            allVideosCache = [];
        }
    });

    // Реактивность на изменение профиля (лайки): пере-сортируем список.
    subscribeToProfile(() => {
        if (allVideosCache.length > 0) {
            renderVideos(allVideosCache);
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

    if (!subscribedTabs.has(tabName)) {
        subscribedTabs.add(tabName);
        loadTabContent(tabName);
    }
}

function loadTabContent(tabName) {
    if (tabName === "videos") startVideosSubscription();
    // books/films пока статичные заглушки, ничего не грузим
}

// --- Видео ---

function startVideosSubscription() {
    if (unsubscribeFromVideos) return; // уже подписаны

    videosLoadingEl.hidden = false;
    videosEmptyEl.hidden = true;
    videosErrorEl.hidden = true;
    videosTotalEl.hidden = true;
    foldersSection.hidden = true;
    standaloneSection.hidden = true;

    // onSnapshot вместо одноразового getDocs: первый callback приходит
    // мгновенно из persistentLocalCache (IndexedDB), потом обновляется
    // реактивно. Заметно быстрее на повторных заходах и при возврате на вкладку.
    unsubscribeFromVideos = videosApi.subscribeAll((videos) => {
        allVideosCache = videos;
        videosLoadingEl.hidden = true;

        if (videos.length === 0) {
            foldersList.innerHTML = "";
            standaloneList.innerHTML = "";
            videosEmptyEl.hidden = false;
            videosTotalEl.hidden = true;
            foldersSection.hidden = true;
            standaloneSection.hidden = true;
            return;
        }

        videosEmptyEl.hidden = true;
        renderVideos(videos);
    });
}

function stopVideosSubscription() {
    if (unsubscribeFromVideos) {
        unsubscribeFromVideos();
        unsubscribeFromVideos = null;
    }
}

function renderVideos(videos) {
    // Снимаем позицию скролла ДО изменения DOM (innerHTML="" и appendChild сбрасывают scroll).
    const savedScroll = window.scrollY;

    videosTotalEl.textContent = `${videos.length} видео`;
    videosTotalEl.hidden = false;

    const folderMap = new Map();
    const standaloneVideos = [];

    for (const video of videos) {
        if (video.folder) {
            if (!folderMap.has(video.folder)) {
                folderMap.set(video.folder, { count: 0 });
            }
            folderMap.get(video.folder).count += 1;
        } else {
            standaloneVideos.push(video);
        }
    }

    // Берем актуальный профиль (лайки) для сортировки
    const profile = getUserProfile();
    const likedVideosSet = new Set(profile.liked_videos);
    const likedFoldersSet = new Set(profile.liked_folders);

    // Папки: лайкнутые сверху по алфавиту, нелайкнутые ниже по алфавиту
    foldersList.innerHTML = "";
    const folderNames = sortFoldersWithLikes([...folderMap.keys()], likedFoldersSet);
    const allFolderNames = [...folderMap.keys()].sort((a, b) => a.localeCompare(b, "ru"));
    for (const name of folderNames) {
        const info = folderMap.get(name);
        // Колбэки не передаем — после любой мутации refreshVideos() сам
        // перерисует список. existingFolders нужен только для проверки
        // коллизий имен при переименовании в редакторе.
        foldersList.appendChild(createFolderCard(name, info.count, {
            existingFolders: allFolderNames,
        }));
    }
    foldersSection.hidden = folderNames.length === 0;

    // Одиночные видео: лайкнутые сверху, внутри — по текущей сортировке
    standaloneList.innerHTML = "";
    const standaloneSorted = sortVideosWithLikes(
        standaloneVideos, currentSort.field, currentSort.dir, likedVideosSet
    );
    for (const video of standaloneSorted) {
        standaloneList.appendChild(createVideoCard(video));
    }
    standaloneSection.hidden = standaloneVideos.length === 0;

    // Контрол сортировки монтируем один раз при первом рендере (когда контейнер уже в DOM).
    mountSortControl();

    // Восстанавливаем скролл после изменения DOM.
    restoreScrollAfterRender(savedScroll);
}

function mountSortControl() {
    if (sortControlMounted) return;
    if (!standaloneSortContainer) return;
    const ctrl = createSortControl((sort) => {
        currentSort = sort;
        // Перерисуем только стандалоны — папки сортируются отдельно (по алфавиту, не меняется).
        renderVideos(allVideosCache);
    });
    standaloneSortContainer.appendChild(ctrl);
    sortControlMounted = true;
}

init();
