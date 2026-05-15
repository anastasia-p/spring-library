// API-слой. Сгруппирован по типам контента — videosApi, в перспективе booksApi / filmsApi.
// Снаружи никто не должен импортировать firebase-firestore — только через объекты-API ниже.

import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

import { API_BASE_URL } from "./config.js";
import { db, getCurrentUser, isAdmin } from "./firebase.js";

function sortByTitle(a, b) {
    const ta = (a.title || "").trim();
    const tb = (b.title || "").trim();
    return ta.localeCompare(tb, "ru", { sensitivity: "base", numeric: true });
}

// Фильтрация скрытых: обычный пользователь не видит видео с hidden === true.
// Админ видит все. Это UX-фильтр, не security — документы доступны через Firestore SDK напрямую.
function filterVisible(list) {
    if (isAdmin()) return list;
    return list.filter((v) => !v.hidden);
}

// --- Видео ------------------------------------------------------------------

export const videosApi = {
    collectionName: "videos",

    async fetchAll() {
        const snapshot = await getDocs(collection(db, this.collectionName));
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        return filterVisible(list).sort((a, b) => sortByTitle(a, b));
    },

    /**
     * Подписка на коллекцию videos. Callback вызывается на каждое изменение.
     * Возвращает функцию отписки.
     */
    subscribeAll(callback) {
        return onSnapshot(collection(db, this.collectionName), (snapshot) => {
            const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
            callback(filterVisible(list).sort((a, b) => sortByTitle(a, b)));
        });
    },

    async fetchOne(id) {
        const docSnap = await getDoc(doc(db, this.collectionName, id));
        if (!docSnap.exists()) return null;
        return { id: docSnap.id, ...docSnap.data() };
    },

    async fetchInFolder(folderName) {
        const q = query(
            collection(db, this.collectionName),
            where("folder", "==", folderName)
        );
        const snapshot = await getDocs(q);
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        return filterVisible(list).sort((a, b) => sortByTitle(a, b));
    },

    /**
     * Подписка на видео внутри папки. Callback вызывается на каждое изменение.
     * Возвращает функцию отписки.
     */
    subscribeInFolder(folderName, callback) {
        const q = query(
            collection(db, this.collectionName),
            where("folder", "==", folderName)
        );
        return onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
            callback(filterVisible(list).sort((a, b) => sortByTitle(a, b)));
        });
    },

    async fetchFolderNames() {
        const snapshot = await getDocs(collection(db, this.collectionName));
        const admin = isAdmin();
        const folders = new Set();
        snapshot.forEach((d) => {
            const data = d.data();
            if (!data.folder) return;
            if (!admin && data.hidden) return; // папка появляется только если есть видимое видео
            folders.add(data.folder);
        });
        return [...folders].sort((a, b) => a.localeCompare(b, "ru"));
    },

    async delete(id) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/videos/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Ошибка ${response.status}`);
        }
    },

    // Специфично для видео:

    async upload(formData, onProgress, signal) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${API_BASE_URL}/api/upload`);
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);

            // Если передан AbortSignal — даём ему ABORT-ить XHR
            if (signal) {
                if (signal.aborted) {
                    xhr.abort();
                    reject(new DOMException("Загрузка отменена", "AbortError"));
                    return;
                }
                signal.addEventListener("abort", () => xhr.abort());
            }

            // Сглаживаем расчёт скорости — обновляемся раз в ~300мс
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
                onProgress({
                    downloaded: event.loaded,
                    total: event.total,
                    speed,
                    eta,
                });
            });

            xhr.addEventListener("load", () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
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
     * Скачать видео по URL через бэкенд (yt-dlp).
     * Возвращает финальный объект видео (event с типом "done").
     * onEvent({type, ...}) вызывается на каждое событие стрима: progress, status, heartbeat.
     * При дубликате source_url — бросает Error с .duplicateId.
     */
    async uploadFromUrl(formData, onEvent, signal) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();
        const response = await fetch(`${API_BASE_URL}/api/upload-from-url`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
            signal,
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            // 409 — дубликат: detail = { message, id }
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

        // Читаем NDJSON-стрим
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
        return finalEvent;
    },

    streamUrl(id) {
        return `${API_BASE_URL}/stream/${id}`;
    },

    thumbUrl(id) {
        return `${API_BASE_URL}/thumb/${id}`;
    },

    async setThumbOffsetY(id, offsetY) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();
        const formData = new FormData();
        formData.append("thumb_offset_y", String(offsetY));
        const response = await fetch(`${API_BASE_URL}/api/videos/${id}/thumbnail`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Ошибка ${response.status}`);
        }
        return response.json();
    },

    /**
     * Обновить редактируемые поля видео (title, description, folder, recorded_at, thumb_offset_y).
     */
    async update(id, data) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();
        const formData = new FormData();
        formData.append("title", data.title);
        formData.append("description", data.description || "");
        formData.append("folder", data.folder || "");
        formData.append("recorded_at", data.recorded_at || "");
        formData.append("thumb_offset_y", String(
            typeof data.thumb_offset_y === "number" ? data.thumb_offset_y : 50
        ));
        const response = await fetch(`${API_BASE_URL}/api/videos/${id}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Ошибка ${response.status}`);
        }
        return response.json();
    },
    /**
     * Удаляет папку целиком — все видео внутри + файлы/превью.
     */
    async deleteFolder(folderName) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();
        const response = await fetch(
            `${API_BASE_URL}/api/folders/${encodeURIComponent(folderName)}`,
            {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            }
        );
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Ошибка ${response.status}`);
        }
        return response.json();
    },

    /**
     * Переименовывает папку — у всех видео внутри обновляется поле folder.
     * Если newName совпадает с существующей папкой, бэк не блокирует (это слияние).
     * Защиту от случайного слияния делает фронт (confirm в editor).
     */
    async renameFolder(folderName, newName) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();
        const formData = new FormData();
        formData.append("new_name", newName);
        const response = await fetch(
            `${API_BASE_URL}/api/folders/${encodeURIComponent(folderName)}`,
            {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            }
        );
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Ошибка ${response.status}`);
        }
        return response.json();
    },

    /**
     * Переключает скрытость одного видео.
     */
    async setHidden(id, hidden) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();
        const formData = new FormData();
        formData.append("hidden", String(hidden));
        const response = await fetch(`${API_BASE_URL}/api/videos/${id}/hidden`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Ошибка ${response.status}`);
        }
        return response.json();
    },

    /**
     * Массово переключает скрытость всех видео в папке.
     */
    async setFolderHidden(folderName, hidden) {
        const user = getCurrentUser();
        if (!user) throw new Error("Не авторизован");
        const token = await user.getIdToken();
        const formData = new FormData();
        formData.append("hidden", String(hidden));
        const response = await fetch(
            `${API_BASE_URL}/api/folders/${encodeURIComponent(folderName)}/hidden`,
            {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            }
        );
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `Ошибка ${response.status}`);
        }
        return response.json();
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
