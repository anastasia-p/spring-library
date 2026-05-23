// js/notes.js
// Модуль личных заметок (таймстемпов) к видео.
//
// Раньше — подколлекция Firestore с onSnapshot. Теперь — fetch в локальный
// бэкенд. Интерфейс сохранен: subscribeToNotes (плеер), videoHasNotes +
// subscribeToNotesIndex (значок на карточках), addNote/updateNote/deleteNote.
//
// «Наблюдаемость» эмулируется: после любой мутации перезапрашиваем заметки
// активного видео (для плеера) и индекс (для значков) и оповещаем слушателей.
// Авторизации/uid больше нет — заметки глобальные (один пользователь).

import { API_BASE_URL } from "./config.js";

export const MAX_NOTE_TEXT_LENGTH = 1000;

async function apiGet(path) {
    const res = await fetch(`${API_BASE_URL}${path}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
    }
    return res.json();
}

// --- Активная подписка плеера (одно видео) ---------------------------------

let activeSub = null; // { videoId, cb }

async function loadActive() {
    if (!activeSub) return;
    const { videoId, cb } = activeSub;
    try {
        const list = await apiGet(`/api/notes?videoId=${encodeURIComponent(videoId)}`);
        if (activeSub && activeSub.videoId === videoId) cb(list);
    } catch (e) {
        console.error("[notes] load error:", e);
        if (activeSub && activeSub.videoId === videoId) cb([]);
    }
}

/**
 * Подписаться на заметки конкретного видео. Колбэк вызывается со списком
 * (отсортирован по time asc) сразу и после каждой мутации. При повторном
 * вызове предыдущая подписка заменяется (одна страница плеера = одна подписка).
 * Возвращает функцию отписки.
 */
export function subscribeToNotes(videoId, callback) {
    activeSub = { videoId, cb: callback };
    loadActive();
    return () => {
        if (activeSub && activeSub.videoId === videoId) activeSub = null;
    };
}

// --- Индекс заметок (значок «есть таймстемпы» на карточках) -----------------

let notesIndex = new Set();
const indexCallbacks = new Set();
let indexLoaded = false;

function notifyIndex() {
    for (const cb of indexCallbacks) {
        try {
            cb(notesIndex);
        } catch (e) {
            console.error("[notes] index callback error:", e);
        }
    }
}

async function loadIndex() {
    try {
        const ids = await apiGet("/api/notes/index");
        notesIndex = new Set(ids);
        notifyIndex();
    } catch (e) {
        console.error("[notes] index error:", e);
    }
}

/** Синхронно: есть ли у этого видео хотя бы одна заметка (из индекса в памяти). */
export function videoHasNotes(videoId) {
    return notesIndex.has(videoId);
}

/**
 * Подписаться на обновления индекса заметок. Колбэк получает Set videoId сразу
 * и при каждом изменении. Первая подписка грузит индекс. Возвращает отписку.
 */
export function subscribeToNotesIndex(callback) {
    indexCallbacks.add(callback);
    callback(notesIndex);
    if (!indexLoaded) {
        indexLoaded = true;
        loadIndex();
    }
    return () => indexCallbacks.delete(callback);
}

// --- После мутаций освежаем плеер и индекс ----------------------------------

async function refreshAfterMutation() {
    await loadActive();
    await loadIndex();
}

function validateText(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
        throw new Error("Текст заметки не может быть пустым");
    }
    if (trimmed.length > MAX_NOTE_TEXT_LENGTH) {
        throw new Error(`Текст не должен превышать ${MAX_NOTE_TEXT_LENGTH} символов`);
    }
    return trimmed;
}

/** Создать заметку. */
export async function addNote(videoId, time, text) {
    const cleanText = validateText(text);
    const cleanTime = Number(time);
    if (!isFinite(cleanTime) || cleanTime < 0) {
        throw new Error("Некорректное время");
    }
    const fd = new FormData();
    fd.append("videoId", videoId);
    fd.append("time", String(cleanTime));
    fd.append("text", cleanText);
    const res = await fetch(`${API_BASE_URL}/api/notes`, { method: "POST", body: fd });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
    }
    const note = await res.json();
    await refreshAfterMutation();
    return note;
}

/** Обновить текст заметки (время не меняем). */
export async function updateNote(noteId, text) {
    const cleanText = validateText(text);
    const fd = new FormData();
    fd.append("text", cleanText);
    const res = await fetch(`${API_BASE_URL}/api/notes/${noteId}`, { method: "PATCH", body: fd });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
    }
    const note = await res.json();
    await refreshAfterMutation();
    return note;
}

/** Удалить заметку. */
export async function deleteNote(noteId) {
    const res = await fetch(`${API_BASE_URL}/api/notes/${noteId}`, { method: "DELETE" });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
    }
    await refreshAfterMutation();
}
