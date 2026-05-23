// Локальный слой «авторизации» и лайков.
//
// Имя файла историческое: Firebase удален полностью. Приложение
// однопользовательское и работает на localhost, поэтому авторизации нет —
// есть один локальный «пользователь», и ему можно все. Данные (лайки)
// ходят в локальный бэкенд через fetch.
//
// Интерфейс модуля сохранен 1-в-1 с прежним (subscribeToAuth, isAdmin,
// getUserProfile, subscribeToProfile, isVideoLiked/isFolderLiked,
// toggleVideoLike/toggleFolderLike, getCurrentUser), чтобы потребители
// (ui.js, index.js, folder.js, watch.js) не пришлось трогать.

import { API_BASE_URL } from "./config.js";

// Единственный «пользователь». Все страницы стартуют так, будто кто-то залогинен.
const LOCAL_USER = { uid: "local", email: "" };

export function getCurrentUser() {
    return LOCAL_USER;
}

// Один пользователь = полные права. Раньше отделяло админа от зрителей.
export function isAdmin() {
    return true;
}

/**
 * Подписка на «состояние аутентификации». Сразу отдает локального пользователя
 * (auth нет), чтобы все подписки на данные запустились. Возвращает no-op отписку.
 */
export function subscribeToAuth(callback) {
    callback(LOCAL_USER);
    return () => {};
}

// --- Лайки (глобальные, без uid) -------------------------------------------
// Кеш в памяти + слушатели. Грузим один раз с бэка при старте модуля.
// Toggle — оптимистично: меняем кеш и оповещаем сразу, при ошибке откатываем.

let profileCache = { liked_videos: [], liked_folders: [] };
const profileListeners = new Set();

function notifyProfile() {
    for (const cb of profileListeners) {
        try {
            cb(profileCache);
        } catch (e) {
            console.error("Profile listener error:", e);
        }
    }
}

async function loadProfile() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/likes`);
        if (!res.ok) return;
        const data = await res.json();
        profileCache = {
            liked_videos: data.liked_videos || [],
            liked_folders: data.liked_folders || [],
        };
        notifyProfile();
    } catch (e) {
        console.warn("Не удалось загрузить лайки:", e);
    }
}

/** Синхронно возвращает кеш профиля. Никогда не null. */
export function getUserProfile() {
    return profileCache;
}

/**
 * Подписка на изменения профиля (лайки). Колбэк вызывается сразу с текущим
 * состоянием и далее при каждом toggle. Возвращает функцию отписки.
 */
export function subscribeToProfile(callback) {
    profileListeners.add(callback);
    callback(profileCache);
    return () => profileListeners.delete(callback);
}

export function isVideoLiked(videoId) {
    return profileCache.liked_videos.includes(videoId);
}

export function isFolderLiked(folderName) {
    return profileCache.liked_folders.includes(folderName);
}

async function setLike(kind, key, liked) {
    const path = kind === "video"
        ? `/api/likes/video/${encodeURIComponent(key)}`
        : `/api/likes/folder/${encodeURIComponent(key)}`;
    const fd = new FormData();
    fd.append("liked", String(liked));
    const res = await fetch(`${API_BASE_URL}${path}`, { method: "POST", body: fd });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
    }
}

export async function toggleVideoLike(videoId) {
    const next = !isVideoLiked(videoId);
    const before = profileCache.liked_videos;
    profileCache = {
        ...profileCache,
        liked_videos: next ? [...before, videoId] : before.filter((id) => id !== videoId),
    };
    notifyProfile();
    try {
        await setLike("video", videoId, next);
    } catch (e) {
        profileCache = { ...profileCache, liked_videos: before };
        notifyProfile();
        throw e;
    }
}

export async function toggleFolderLike(folderName) {
    const next = !isFolderLiked(folderName);
    const before = profileCache.liked_folders;
    profileCache = {
        ...profileCache,
        liked_folders: next ? [...before, folderName] : before.filter((n) => n !== folderName),
    };
    notifyProfile();
    try {
        await setLike("folder", folderName, next);
    } catch (e) {
        profileCache = { ...profileCache, liked_folders: before };
        notifyProfile();
        throw e;
    }
}

// Грузим лайки при загрузке модуля — значки на карточках появятся, как придут данные.
loadProfile();
