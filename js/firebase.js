// Инициализация Firebase + общие auth-функции + слой профиля пользователя (лайки).
// Без анонимного входа: страницы доступны только после явной авторизации.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    doc,
    setDoc,
    onSnapshot,
    arrayUnion,
    arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

import { firebaseConfig, ADMIN_EMAIL } from "./config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Локальный кеш Firestore в IndexedDB. Мгновенный отклик при повторных заходах,
// обновления в фоне. persistentMultipleTabManager синхронизирует вкладки.
try {
    initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
        }),
    });
} catch (e) {
    // Уже инициализирован (горячая перезагрузка) — продолжаем со стандартным экземпляром.
    console.warn("Firestore уже инициализирован:", e);
}
export const db = getFirestore(app);

export function getCurrentUser() {
    return auth.currentUser;
}

/**
 * Админ — пользователь с email, совпадающим с ADMIN_EMAIL из config.js.
 * Можно передать user явно (полезно внутри обработчика onAuthStateChanged),
 * иначе берется auth.currentUser.
 */
export function isAdmin(user) {
    const u = user !== undefined ? user : auth.currentUser;
    return !!u && u.email === ADMIN_EMAIL;
}

/**
 * Подписка на изменения состояния аутентификации.
 * Callback вызывается с user (User | null) сразу после подписки и на каждое изменение.
 * Возвращает функцию отписки.
 */
export function subscribeToAuth(callback) {
    return onAuthStateChanged(auth, callback);
}

export async function loginWithEmail(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
}

export async function registerWithEmail(email, password) {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    return result.user;
}

export async function sendPasswordReset(email) {
    await sendPasswordResetEmail(auth, email);
}

export async function logout() {
    await signOut(auth);
}

/**
 * Понятные сообщения об ошибках Firebase Auth.
 */
export function getAuthErrorMessage(code) {
    const messages = {
        "auth/user-not-found":         "Неверный email или пароль",
        "auth/wrong-password":         "Неверный email или пароль",
        "auth/invalid-credential":     "Неверный email или пароль",
        "auth/internal-error":         "Неверный email или пароль",
        "auth/invalid-email":          "Неверный формат email",
        "auth/email-already-in-use":   "Этот email уже зарегистрирован",
        "auth/weak-password":          "Пароль слишком короткий — минимум 6 символов",
        "auth/too-many-requests":      "Слишком много попыток. Попробуй позже",
        "auth/network-request-failed": "Ошибка сети. Проверь подключение",
        "auth/operation-not-allowed":  "Email/Password не включен в Firebase Console",
        "auth/user-disabled":          "Аккаунт заблокирован",
    };
    return messages[code] || "Что-то пошло не так. Попробуй еще раз";
}

// --- Профиль пользователя (лайки) -------------------------------------------
// Документ user_profiles/{uid} с массивами liked_videos и liked_folders.
// Кеш в памяти + единая подписка на onSnapshot. UI-компоненты подписываются
// на наши локальные события через subscribeToProfile — это дешевле, чем
// каждому компоненту подписываться на Firestore отдельно.
// Toggle идет прямой записью в Firestore (правила разрешают пользователю
// писать только в свой документ). Optimistic update получаем бесплатно
// от Firestore SDK через локальный кеш + onSnapshot.

const EMPTY_PROFILE = { liked_videos: [], liked_folders: [] };
let userProfileCache = EMPTY_PROFILE;
let unsubscribeFromProfile = null;
const profileListeners = new Set();

function notifyProfileListeners() {
    for (const cb of profileListeners) {
        try {
            cb(userProfileCache);
        } catch (e) {
            console.error("Profile listener error:", e);
        }
    }
}

function startProfileSubscription(user) {
    // Сначала отписываемся от предыдущего пользователя, если был
    if (unsubscribeFromProfile) {
        unsubscribeFromProfile();
        unsubscribeFromProfile = null;
    }
    if (!user) {
        userProfileCache = EMPTY_PROFILE;
        notifyProfileListeners();
        return;
    }
    const ref = doc(db, "user_profiles", user.uid);
    unsubscribeFromProfile = onSnapshot(
        ref,
        (snap) => {
            const data = snap.exists() ? (snap.data() || {}) : {};
            userProfileCache = {
                liked_videos: data.liked_videos || [],
                liked_folders: data.liked_folders || [],
            };
            notifyProfileListeners();
        },
        (err) => {
            // Не критично — при ошибке оставляем пустой профиль
            console.warn("Не удалось подписаться на user_profiles:", err);
            userProfileCache = EMPTY_PROFILE;
            notifyProfileListeners();
        }
    );
}

// Привязываем подписку к auth state. При логине — подписываемся,
// при логауте — отписываемся и сбрасываем кеш.
onAuthStateChanged(auth, (user) => {
    startProfileSubscription(user);
});

/**
 * Возвращает текущий профиль пользователя из кеша.
 * Если пользователь не залогинен или документ не существует —
 * возвращает { liked_videos: [], liked_folders: [] }.
 * Синхронная функция, безопасна для использования в рендере.
 */
export function getUserProfile() {
    return userProfileCache;
}

/**
 * Подписка на изменения профиля. Callback вызывается:
 * - сразу при подписке с текущим состоянием
 * - на каждое изменение (включая логин/логаут и удаленные обновления через onSnapshot)
 * Возвращает функцию отписки.
 */
export function subscribeToProfile(callback) {
    profileListeners.add(callback);
    callback(userProfileCache);
    return () => profileListeners.delete(callback);
}

/**
 * Лайкнуто ли видео (синхронная проверка по кешу).
 */
export function isVideoLiked(videoId) {
    return userProfileCache.liked_videos.includes(videoId);
}

/**
 * Лайкнута ли папка (синхронная проверка по кешу).
 */
export function isFolderLiked(folderName) {
    return userProfileCache.liked_folders.includes(folderName);
}

/**
 * Toggle лайка на видео. Прямая запись в Firestore — UI обновится
 * автоматически через onSnapshot. Документ создается при первой записи.
 */
export async function toggleVideoLike(videoId) {
    const user = auth.currentUser;
    if (!user) throw new Error("Не авторизован");
    const ref = doc(db, "user_profiles", user.uid);
    const update = {
        liked_videos: userProfileCache.liked_videos.includes(videoId)
            ? arrayRemove(videoId)
            : arrayUnion(videoId),
    };
    await setDoc(ref, update, { merge: true });
}

/**
 * Toggle лайка на папку. Поведение аналогично toggleVideoLike.
 */
export async function toggleFolderLike(folderName) {
    const user = auth.currentUser;
    if (!user) throw new Error("Не авторизован");
    const ref = doc(db, "user_profiles", user.uid);
    const update = {
        liked_folders: userProfileCache.liked_folders.includes(folderName)
            ? arrayRemove(folderName)
            : arrayUnion(folderName),
    };
    await setDoc(ref, update, { merge: true });
}
