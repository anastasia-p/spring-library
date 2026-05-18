// js/notes.js
// Модуль работы с личными заметками к видео.
//
// Архитектура: подколлекция user_profiles/{uid}/notes/{noteId}.
// Чтение/запись напрямую с клиента через Firestore SDK, Rules защищают
// принадлежность. Optimistic UI приходит через onSnapshot из persistentLocalCache.
//
// Документ заметки:
//   videoId: string
//   time: number (секунды в видео, может быть float)
//   text: string (1..1000 символов)
//   createdAt: serverTimestamp
//   updatedAt: serverTimestamp

import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { db, getCurrentUser, subscribeToAuth } from "./firebase.js";

export const MAX_NOTE_TEXT_LENGTH = 1000;

// Текущий uid (актуализируется через subscribeToAuth)
let currentUid = null;

// Активная подписка: { videoId, callback, unsubscribe }
let activeSub = null;

subscribeToAuth((user) => {
    const newUid = user?.uid || null;
    if (newUid === currentUid) return;
    currentUid = newUid;
    // Если была активная подписка — пере-подписываемся с новым uid
    if (activeSub) {
        const { videoId, callback } = activeSub;
        stopSub();
        startSub(videoId, callback);
    }
});

function notesCol(uid) {
    return collection(db, "user_profiles", uid, "notes");
}

function startSub(videoId, callback) {
    if (!currentUid) {
        // Без авторизации — отдаем пустой список и не подписываемся
        callback([]);
        activeSub = { videoId, callback, unsubscribe: () => {} };
        return;
    }
    const q = query(
        notesCol(currentUid),
        where("videoId", "==", videoId),
        orderBy("time", "asc"),
    );
    const unsubscribe = onSnapshot(
        q,
        (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            callback(list);
        },
        (err) => {
            console.error("[notes] subscription error:", err);
            callback([]);
        },
    );
    activeSub = { videoId, callback, unsubscribe };
}

function stopSub() {
    if (!activeSub) return;
    try { activeSub.unsubscribe(); } catch (e) { /* ignore */ }
    activeSub = null;
}

/**
 * Подписаться на заметки конкретного видео.
 * Колбэк вызывается с массивом заметок (отсортирован по time asc) при каждом изменении.
 * Возвращает функцию отписки.
 *
 * При повторном вызове предыдущая подписка автоматически отменяется
 * (рассчитано на сценарий "одна страница плеера = одна активная подписка").
 */
export function subscribeToNotes(videoId, callback) {
    stopSub();
    startSub(videoId, callback);
    return () => stopSub();
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

/**
 * Создать заметку.
 */
export async function addNote(videoId, time, text) {
    const user = getCurrentUser();
    if (!user) throw new Error("Не авторизованы");
    const cleanText = validateText(text);
    const cleanTime = Number(time);
    if (!isFinite(cleanTime) || cleanTime < 0) {
        throw new Error("Некорректное время");
    }
    return addDoc(notesCol(user.uid), {
        videoId,
        time: cleanTime,
        text: cleanText,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
}

/**
 * Обновить текст заметки (время фиксировано — не меняем).
 */
export async function updateNote(noteId, text) {
    const user = getCurrentUser();
    if (!user) throw new Error("Не авторизованы");
    const cleanText = validateText(text);
    const ref = doc(db, "user_profiles", user.uid, "notes", noteId);
    return updateDoc(ref, {
        text: cleanText,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Удалить заметку.
 */
export async function deleteNote(noteId) {
    const user = getCurrentUser();
    if (!user) throw new Error("Не авторизованы");
    const ref = doc(db, "user_profiles", user.uid, "notes", noteId);
    return deleteDoc(ref);
}
