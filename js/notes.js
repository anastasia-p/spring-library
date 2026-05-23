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
//
// Две независимые подписки:
//   1) activeSub  — заметки ОДНОГО видео (плеер). Одна на страницу, пере-создается
//      на каждый subscribeToNotes. Сортировка по time asc.
//   2) indexSub   — индекс "в каких видео вообще есть заметки" (для значка на
//      карточках в списке). Подписка на ВСЮ коллекцию notes юзера, без where.
//      Держим Set videoId в памяти; videoHasNotes() — синхронный геттер.
//      Паттерн зеркалит лайки (firebase.js: профиль в памяти + isVideoLiked).

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

// Активная подписка плеера: { videoId, callback, unsubscribe }
let activeSub = null;

// --- Индекс заметок (для значка на карточках) ----------------------------
// notesIndex — множество videoId, у которых есть хотя бы одна заметка.
// indexUnsub — отписка от onSnapshot всей коллекции (null = не подписаны).
// indexCallbacks — слушатели обновления индекса (ui.js перерисовывает значки).
let notesIndex = new Set();
let indexUnsub = null;
const indexCallbacks = new Set();

subscribeToAuth((user) => {
    const newUid = user?.uid || null;
    if (newUid === currentUid) return;
    currentUid = newUid;
    // Подписка плеера: пере-подписываемся с новым uid
    if (activeSub) {
        const { videoId, callback } = activeSub;
        stopSub();
        startSub(videoId, callback);
    }
    // Индекс заметок: пере-подписываемся с новым uid (или чистим при выходе),
    // только если кто-то на него подписан.
    stopIndexSub();
    notesIndex = new Set();
    notifyIndex();
    if (indexCallbacks.size > 0) {
        startIndexSub();
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

// --- Индекс заметок: внутреннее ------------------------------------------

function notifyIndex() {
    for (const cb of indexCallbacks) {
        try { cb(notesIndex); } catch (e) { console.error("[notes] index callback error:", e); }
    }
}

function startIndexSub() {
    // Без авторизации — индекс пустой, не подписываемся.
    if (!currentUid) {
        notesIndex = new Set();
        notifyIndex();
        return;
    }
    if (indexUnsub) return; // уже подписаны
    // Вся коллекция notes юзера, без where/orderBy — нужны только videoId.
    const q = query(notesCol(currentUid));
    indexUnsub = onSnapshot(
        q,
        (snap) => {
            const next = new Set();
            snap.docs.forEach((d) => {
                const vid = d.data().videoId;
                if (vid) next.add(vid);
            });
            notesIndex = next;
            notifyIndex();
        },
        (err) => {
            console.error("[notes] index subscription error:", err);
            notesIndex = new Set();
            notifyIndex();
        },
    );
}

function stopIndexSub() {
    if (indexUnsub) {
        try { indexUnsub(); } catch (e) { /* ignore */ }
        indexUnsub = null;
    }
}

/**
 * Синхронно: есть ли у текущего юзера хотя бы одна заметка к этому видео.
 * Читает индекс из памяти (как isVideoLiked для лайков) — без обращения к базе.
 * До первой загрузки индекса вернет false; значок появится, когда индекс придет
 * (через subscribeToNotesIndex).
 */
export function videoHasNotes(videoId) {
    return notesIndex.has(videoId);
}

/**
 * Подписаться на обновления индекса заметок.
 * Колбэк получает Set videoId (с заметками) — сразу при подписке (текущее
 * состояние) и далее при каждом изменении. Первая подписка запускает
 * onSnapshot на коллекцию notes.
 * Возвращает функцию отписки (снимает слушатель; саму onSnapshot оставляем
 * активной до смены auth — на масштабе одной вкладки это дешевле, чем
 * пере-подписываться при каждом ремонтировании списка).
 */
export function subscribeToNotesIndex(callback) {
    indexCallbacks.add(callback);
    if (!indexUnsub && currentUid) {
        startIndexSub();
    }
    // Отдать текущее состояние немедленно (как делает subscribeToProfile).
    try { callback(notesIndex); } catch (e) { /* ignore */ }
    return () => {
        indexCallbacks.delete(callback);
    };
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
