// Страница папки видео.

import { subscribeToAuth, subscribeToProfile, getUserProfile } from "./firebase.js";
import { videosApi } from "./data.js";
import { createVideoCard, createFolderIcon } from "./ui.js";
import { createSortControl, loadSort, sortVideosWithLikes } from "./sort-controls.js";

const listEl = document.getElementById("video-list");
const emptyEl = document.getElementById("empty-state");
const errorEl = document.getElementById("error-state");
const loadingEl = document.getElementById("loading-state");
const titleEl = document.getElementById("folder-title");
const metaEl = document.getElementById("folder-meta");
const sortContainer = document.getElementById("folder-sort");

const params = new URLSearchParams(window.location.search);
const folderName = params.get("name");

// Заголовок страницы папки рендерим синхронно при загрузке модуля —
// имя папки есть в URL, ждать auth для этого не нужно.
if (folderName && titleEl) {
    titleEl.replaceChildren();
    titleEl.appendChild(createFolderIcon());
    titleEl.appendChild(document.createTextNode(folderName));
    document.title = `${folderName} — Spring Library`;
}

// Кэш видео + текущая сортировка. Контрол сортировки меняет currentSort
// и вызывает renderList(allVideosCache) — без повторного запроса.
let allVideosCache = [];
let currentSort = loadSort();
let sortControlMounted = false;
let unsubscribeFromVideos = null;
// Отслеживаем переход с непустой на пустую — confirm "вернуться?" срабатывает
// только если папка была непустой и опустела при нас, а не при первом заходе.
let wasNonEmpty = false;

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

function startSubscription() {
    if (unsubscribeFromVideos) return; // уже подписаны

    loadingEl.hidden = false;
    emptyEl.hidden = true;
    errorEl.hidden = true;

    // onSnapshot отдает первый callback мгновенно из persistentLocalCache
    // (если данные в IndexedDB есть), потом обновляет реактивно при изменениях
    // в Firestore. Это значительно быстрее одноразового getDocs.
    unsubscribeFromVideos = videosApi.subscribeInFolder(folderName, (videos) => {
        allVideosCache = videos;
        loadingEl.hidden = true;
        renderState(videos);
    });
}

function stopSubscription() {
    if (unsubscribeFromVideos) {
        unsubscribeFromVideos();
        unsubscribeFromVideos = null;
    }
}

function renderState(videos) {
    if (videos.length === 0) {
        listEl.innerHTML = "";
        emptyEl.hidden = false;
        metaEl.textContent = "";
        if (sortContainer) sortContainer.hidden = true;

        // Если папка опустела при пользователе (а не была пустой изначально) —
        // предлагаем вернуться. Иначе тихо показываем empty-state.
        if (wasNonEmpty) {
            setTimeout(() => {
                if (confirm("В этой папке больше нет видео. Вернуться к разделу Видео?")) {
                    window.location.href = "index.html#videos";
                }
            }, 100);
            wasNonEmpty = false;
        }
        return;
    }

    wasNonEmpty = true;
    emptyEl.hidden = true;
    metaEl.textContent = `${videos.length} видео`;
    if (sortContainer) sortContainer.hidden = false;
    renderList(videos);
    mountSortControl();
}

function renderList(videos) {
    // Снимаем позицию скролла ДО изменения DOM (innerHTML="" и appendChild сбрасывают scroll).
    const savedScroll = window.scrollY;

    const profile = getUserProfile();
    const likedVideosSet = new Set(profile.liked_videos);
    const sorted = sortVideosWithLikes(
        videos, currentSort.field, currentSort.dir, likedVideosSet
    );
    listEl.innerHTML = "";
    for (const video of sorted) {
        // Колбэки onDelete/onSaved/onHiddenChanged больше не передаем —
        // onSnapshot сам обновит UI после любого изменения в Firestore.
        listEl.appendChild(createVideoCard(video));
    }

    // Восстанавливаем скролл после изменения DOM.
    restoreScrollAfterRender(savedScroll);
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

if (!folderName) {
    showError("В URL не указано имя папки");
} else {
    // Стартуем подписку как только появится залогиненный пользователь.
    // При логауте — отписываемся. Reauth → переподписка.
    subscribeToAuth((user) => {
        if (user) {
            startSubscription();
        } else {
            stopSubscription();
        }
    });
}

// Ре-сортировка при изменении профиля (лайки переключены — список меняет порядок).
subscribeToProfile(() => {
    if (allVideosCache.length > 0) {
        renderList(allVideosCache);
    }
});
