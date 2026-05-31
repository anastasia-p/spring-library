// API-слой. Сгруппирован по типам контента — videosApi (+ заглушки books/films).
//
// Раньше тут жил клиентский Firestore SDK. Теперь — обычный fetch в локальный
// бэкенд. Чтобы не трогать потребителей (index.js, folder.js), сохранен
// «наблюдаемый» интерфейс: subscribeAll/subscribeInFolder регистрируют слушателя,
// а любая мутация (delete/update/upload/folder ops) дергает refreshVideos()
// — перезапрос всех видео и оповещение слушателей. Для одного пользователя на
// одной вкладке это полностью заменяет realtime от onSnapshot.

import { API_BASE_URL } from "./config.js";

function sortByTitle(a, b) {
    const ta = (a.title || "").trim();
    const tb = (b.title || "").trim();
    return ta.localeCompare(tb, "ru", { sensitivity: "base", numeric: true });
}

async function apiGet(path) {
    const res = await fetch(`${API_BASE_URL}${path}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
    }
    return res.json();
}

async function apiSend(path, method, formData) {
    const res = await fetch(`${API_BASE_URL}${path}`, { method, body: formData });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
    }
    return res.json();
}

// --- Наблюдаемый слой видео -------------------------------------------------

let videosCache = null;       // последний полный список с сервера (или null)
const videoSubs = new Set();  // { folder: string|null, cb }

function notifyVideoSub(sub) {
    if (videosCache === null) return;
    const scoped = sub.folder == null
        ? videosCache
        : videosCache.filter((v) => v.folder === sub.folder);
    sub.cb(scoped.slice().sort(sortByTitle));
}

function notifyAllVideoSubs() {
    for (const sub of videoSubs) notifyVideoSub(sub);
}

async function refreshVideos() {
    videosCache = await apiGet("/api/videos");
    notifyAllVideoSubs();
}

// --- Видео ------------------------------------------------------------------

export const videosApi = {
    collectionName: "videos",

    async fetchAll() {
        const list = await apiGet("/api/videos");
        return list.slice().sort(sortByTitle);
    },

    /**
     * Подписка на все видео. Колбэк вызывается сразу (если кеш есть), затем
     * после каждой мутации. Возвращает функцию отписки.
     */
    subscribeAll(callback) {
        const sub = { folder: null, cb: callback };
        videoSubs.add(sub);
        if (videosCache !== null) notifyVideoSub(sub);
        refreshVideos().catch((e) => console.error("Ошибка загрузки видео:", e));
        return () => videoSubs.delete(sub);
    },

    async fetchOne(id) {
        try {
            return await apiGet(`/api/videos/${encodeURIComponent(id)}`);
        } catch {
            return null; // 404 или сетевая ошибка → null (как прежний fetchOne)
        }
    },

    async fetchInFolder(folderName) {
        const list = await apiGet(`/api/videos?folder=${encodeURIComponent(folderName)}`);
        return list.slice().sort(sortByTitle);
    },

    /**
     * Подписка на видео внутри папки. Поведение как у subscribeAll, но список
     * отфильтрован по folder. Возвращает функцию отписки.
     */
    subscribeInFolder(folderName, callback) {
        const sub = { folder: folderName, cb: callback };
        videoSubs.add(sub);
        if (videosCache !== null) notifyVideoSub(sub);
        refreshVideos().catch((e) => console.error("Ошибка загрузки видео:", e));
        return () => videoSubs.delete(sub);
    },

    async fetchFolderNames() {
        return apiGet("/api/folders");
    },

    async delete(id) {
        await apiSend(`/api/videos/${encodeURIComponent(id)}`, "DELETE");
        await refreshVideos();
    },

    async upload(formData, onProgress, signal) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${API_BASE_URL}/api/upload`);

            if (signal) {
                if (signal.aborted) {
                    xhr.abort();
                    reject(new DOMException("Загрузка отменена", "AbortError"));
                    return;
                }
                signal.addEventListener("abort", () => xhr.abort());
            }

            let lastTime = Date.now();
            let lastLoaded = 0;
            let speed = 0;

            xhr.upload.addEventListener("progress", (event) => {
                if (!event.lengthComputable || !onProgress) return;
                const now = Date.now();
                const dt = (now - lastTime) / 1000;
                if (dt >= 0.3) {
                    speed = (event.loaded - lastLoaded) / dt;
                    lastTime = now;
                    lastLoaded = event.loaded;
                }
                const eta = speed > 0 ? (event.total - event.loaded) / speed : 0;
                onProgress({ downloaded: event.loaded, total: event.total, speed, eta });
            });

            xhr.addEventListener("load", () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        refreshVideos().catch(() => {});
                        resolve(data);
                    } catch {
                        reject(new Error("Ошибка парсинга ответа"));
                    }
                } else {
                    let detail = `Ошибка сервера: ${xhr.status}`;
                    try {
                        const err = JSON.parse(xhr.responseText);
                        detail = err.detail || detail;
                    } catch { /* пусто */ }
                    reject(new Error(detail));
                }
            });

            xhr.addEventListener("error", () => reject(new Error("Сетевая ошибка")));
            xhr.addEventListener("abort", () => {
                reject(new DOMException("Загрузка отменена", "AbortError"));
            });

            xhr.send(formData);
        });
    },

    /**
     * Скачать видео по URL через бэкенд (yt-dlp). NDJSON-стрим.
     * Возвращает финальный объект (событие "done"). onEvent — на каждое событие.
     * При дубликате source_url — Error с .duplicateId.
     */
    async uploadFromUrl(formData, onEvent, signal) {
        const response = await fetch(`${API_BASE_URL}/api/upload-from-url`, {
            method: "POST",
            body: formData,
            signal,
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            if (response.status === 409 && typeof err.detail === "object" && err.detail?.id) {
                const dupErr = new Error(err.detail.message || "Видео уже загружено");
                dupErr.duplicateId = err.detail.id;
                throw dupErr;
            }
            const detail = typeof err.detail === "string"
                ? err.detail
                : JSON.stringify(err.detail);
            throw new Error(detail || `Ошибка сервера: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalEvent = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let lineEnd;
            while ((lineEnd = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, lineEnd).trim();
                buffer = buffer.slice(lineEnd + 1);
                if (!line) continue;
                let event;
                try {
                    event = JSON.parse(line);
                } catch {
                    continue;
                }
                if (event.type === "error") {
                    throw new Error(event.detail || "Ошибка скачивания");
                }
                if (event.type === "done") {
                    finalEvent = event;
                }
                if (onEvent) onEvent(event);
            }
        }

        if (!finalEvent) {
            throw new Error("Скачивание прервалось без результата");
        }
        refreshVideos().catch(() => {});
        return finalEvent;
    },

    streamUrl(id) {
        return `${API_BASE_URL}/stream/${id}`;
    },

    thumbUrl(id) {
        return `${API_BASE_URL}/thumb/${id}`;
    },

    async setThumbOffsetY(id, offsetY) {
        const fd = new FormData();
        fd.append("thumb_offset_y", String(offsetY));
        const data = await apiSend(`/api/videos/${encodeURIComponent(id)}/thumbnail`, "PATCH", fd);
        await refreshVideos();
        return data;
    },

    async update(id, data) {
        const fd = new FormData();
        fd.append("title", data.title);
        fd.append("description", data.description || "");
        fd.append("folder", data.folder || "");
        fd.append("recorded_at", data.recorded_at || "");
        fd.append("thumb_offset_y", String(
            typeof data.thumb_offset_y === "number" ? data.thumb_offset_y : 50
        ));
        const result = await apiSend(`/api/videos/${encodeURIComponent(id)}`, "PATCH", fd);
        await refreshVideos();
        return result;
    },

    async deleteFolder(folderName) {
        const result = await apiSend(
            `/api/folders/${encodeURIComponent(folderName)}`, "DELETE"
        );
        await refreshVideos();
        return result;
    },

    async renameFolder(folderName, newName) {
        const fd = new FormData();
        fd.append("new_name", newName);
        const result = await apiSend(
            `/api/folders/${encodeURIComponent(folderName)}`, "PATCH", fd
        );
        await refreshVideos();
        return result;
    },
};

// --- Книги, Фильмы — заглушки на будущее -----------------------------------

export const booksApi = {
    collectionName: "books",
    async fetchAll() { return []; },
    async fetchOne() { return null; },
    async fetchInFolder() { return []; },
    async fetchFolderNames() { return []; },
    async delete() { throw new Error("Не реализовано"); },
};

export const filmsApi = {
    collectionName: "films",
    async fetchAll() { return []; },
    async fetchOne() { return null; },
    async fetchInFolder() { return []; },
    async fetchFolderNames() { return []; },
    async delete() { throw new Error("Не реализовано"); },
};
