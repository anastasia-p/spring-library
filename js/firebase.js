// Инициализация Firebase + общие auth-функции.
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
