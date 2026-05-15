// Auth-overlay — экран входа/регистрации поверх любой страницы.
// Структура и классы перенесены из Spring Tracker (см. app.html, auth.js).
// Подключается одним <script type="module" src="js/auth-overlay.js"></script> в <head>.

import {
    subscribeToAuth,
    loginWithEmail,
    registerWithEmail,
    sendPasswordReset,
    getAuthErrorMessage,
} from "./firebase.js";

// SVG лого ростка на плашке. Цвет плашки — #dff5ed (визуальная семья Spring X).
const LOGO_SVG = `
<svg width="32" height="32" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="22" fill="#D8EDFD"/>
    <path d="M48 76 Q48 58 48 48" stroke="#0F6E56" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M48 48 Q52 28 68 22 Q66 42 48 48Z" fill="#1D9E75" stroke="#0F6E56" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M48 58 Q44 42 28 38 Q32 56 48 58Z" fill="#5DCAA5" stroke="#0F6E56" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

const EYE_OPEN_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
</svg>`;

const EYE_CLOSED_SVG = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

let overlayEl = null;
let mode = "login"; // "login" | "register"

function ensureOverlay() {
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement("div");
    overlayEl.id = "auth-screen";
    overlayEl.className = "auth-overlay";
    overlayEl.innerHTML = `
        <div class="auth-box">
            <div class="auth-logo">
                ${LOGO_SVG}
                <h1>Spring Library</h1>
            </div>

            <div id="auth-login">
                <div class="auth-subtitle">Войти в аккаунт</div>
                <div class="auth-field">
                    <label>Email<span class="req">*</span></label>
                    <input class="auth-input" type="email" id="login-email" placeholder="your@email.com">
                </div>
                <div class="auth-field">
                    <label>Пароль<span class="req">*</span></label>
                    <div class="auth-pass-wrap">
                        <input class="auth-input" type="password" id="login-password" placeholder="">
                        <button class="eye-btn" type="button" data-action="toggle-password" data-target="login-password">${EYE_OPEN_SVG}</button>
                    </div>
                </div>
                <div class="auth-error" id="auth-error-login">\u200B</div>
                <button class="auth-btn" type="button" data-action="login">Войти</button>
                <div class="auth-link"><a data-action="reset">Забыли пароль?</a></div>
                <div class="auth-link">Нет аккаунта? <a data-action="switch-register">Зарегистрироваться</a></div>
            </div>

            <div id="auth-register" style="display:none">
                <div class="auth-subtitle">Создать аккаунт</div>
                <div class="auth-field">
                    <label>Email<span class="req">*</span></label>
                    <input class="auth-input" type="email" id="reg-email" placeholder="your@email.com">
                </div>
                <div class="auth-field">
                    <label>Пароль<span class="req">*</span></label>
                    <div class="auth-pass-wrap">
                        <input class="auth-input" type="password" id="reg-password" placeholder="">
                        <button class="eye-btn" type="button" data-action="toggle-password" data-target="reg-password">${EYE_OPEN_SVG}</button>
                    </div>
                </div>
                <div class="auth-field">
                    <label>Повтори пароль<span class="req">*</span></label>
                    <div class="auth-pass-wrap">
                        <input class="auth-input" type="password" id="reg-password2" placeholder="">
                        <button class="eye-btn" type="button" data-action="toggle-password" data-target="reg-password2">${EYE_OPEN_SVG}</button>
                    </div>
                </div>
                <div class="auth-error" id="auth-error-register">\u200B</div>
                <div class="auth-privacy">
                    <input type="checkbox" id="reg-privacy">
                    <label for="reg-privacy">
                        Я согласен(а) с <span class="auth-policy-link">политикой конфиденциальности</span>
                    </label>
                </div>
                <button class="auth-btn" type="button" data-action="register">Зарегистрироваться</button>
                <div class="auth-link">Уже есть аккаунт? <a data-action="switch-login">Войти</a></div>
            </div>
        </div>
    `;
    document.body.appendChild(overlayEl);
    bindHandlers(overlayEl);
    return overlayEl;
}

function removeOverlay() {
    if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
    }
}

function bindHandlers(root) {
    // Делегирование кликов по data-action
    root.addEventListener("click", async (e) => {
        const target = e.target.closest("[data-action]");
        if (!target) return;
        if (target.tagName === "A") e.preventDefault();
        const action = target.dataset.action;
        if (action === "switch-register")  showMode("register");
        else if (action === "switch-login") showMode("login");
        else if (action === "login")        await doLogin();
        else if (action === "register")     await doRegister();
        else if (action === "reset")        await doReset();
        else if (action === "toggle-password") togglePassword(target);
    });

    // Enter в поле формы → submit
    root.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        if (e.target.tagName !== "INPUT") return;
        e.preventDefault();
        if (mode === "login") doLogin();
        else doRegister();
    });

    // Ввод в любое поле → очистить ошибку текущей формы
    root.addEventListener("input", (e) => {
        if (e.target.tagName === "INPUT" && e.target.type !== "checkbox") {
            clearError();
        }
    });
}

function togglePassword(btn) {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.innerHTML = show ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
}

function showMode(next) {
    mode = next;
    const root = ensureOverlay();
    root.querySelector("#auth-login").style.display    = next === "login"    ? "" : "none";
    root.querySelector("#auth-register").style.display = next === "register" ? "" : "none";
    clearError();
    setTimeout(() => {
        const sel = next === "login" ? "#login-email" : "#reg-email";
        root.querySelector(sel)?.focus();
    }, 50);
}

function setLoading(loading) {
    if (!overlayEl) return;
    overlayEl.querySelectorAll(".auth-btn").forEach((b) => { b.disabled = loading; });
}

function showError(msg) {
    if (!overlayEl) return;
    const id = mode === "register" ? "auth-error-register" : "auth-error-login";
    const el = overlayEl.querySelector(`#${id}`);
    if (el) el.textContent = msg;
}

function clearError() {
    if (!overlayEl) return;
    overlayEl.querySelectorAll(".auth-error").forEach((el) => { el.textContent = "\u200B"; });
}

async function doLogin() {
    clearError();
    const root = ensureOverlay();
    const email = root.querySelector("#login-email").value.trim();
    const password = root.querySelector("#login-password").value;
    if (!email)    { showError("Введите email");  return; }
    if (!password) { showError("Введите пароль"); return; }
    setLoading(true);
    try {
        await loginWithEmail(email, password);
        // Не снимаем loading — onAuthStateChanged скоро уберет overlay целиком.
    } catch (e) {
        setLoading(false);
        showError(getAuthErrorMessage(e.code));
    }
}

async function doRegister() {
    clearError();
    const root = ensureOverlay();
    const email = root.querySelector("#reg-email").value.trim();
    const password = root.querySelector("#reg-password").value;
    const password2 = root.querySelector("#reg-password2").value;
    const privacy = root.querySelector("#reg-privacy").checked;
    if (!email)                 { showError("Введите email");                              return; }
    if (!password)              { showError("Введите пароль");                             return; }
    if (password !== password2) { showError("Пароли не совпадают");                        return; }
    if (password.length < 6)    { showError("Пароль минимум 6 символов");                  return; }
    if (!privacy)               { showError("Необходимо согласие с политикой конфиденциальности"); return; }
    setLoading(true);
    try {
        await registerWithEmail(email, password);
        // Не снимаем loading — onAuthStateChanged скоро уберет overlay целиком.
    } catch (e) {
        setLoading(false);
        showError(getAuthErrorMessage(e.code));
    }
}

async function doReset() {
    clearError();
    const root = ensureOverlay();
    const email = root.querySelector("#login-email").value.trim();
    if (!email) { showError("Введите email для восстановления пароля"); return; }
    try {
        await sendPasswordReset(email);
        showError("Письмо отправлено на " + email);
    } catch (e) {
        showError(getAuthErrorMessage(e.code));
    }
}

// Реагируем на изменения auth-состояния
subscribeToAuth((user) => {
    if (user) {
        removeOverlay();
    } else {
        ensureOverlay();
        setTimeout(() => {
            const sel = mode === "login" ? "#login-email" : "#reg-email";
            overlayEl?.querySelector(sel)?.focus();
        }, 50);
    }
});
