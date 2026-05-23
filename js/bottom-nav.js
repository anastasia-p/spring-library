// Bottom navigation — фиксированная панель внизу страницы.
// Структура и стили .tabs-bar/.tabs-inner/.tab-btn перенесены из Spring Tracker.
// Подключается на index.html, folder.html, admin.html (на watch.html — нет, темная тема).
//
// Авторизации больше нет (один пользователь): слева — ссылка «Админ» (загрузка),
// справа — кнопка «Завершить»: гасит локальный сервер и закрывает окно приложения.

import { API_BASE_URL } from "./config.js";

const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
</svg>`;

const POWER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 4v8"/>
    <path d="M6.3 7.3a8 8 0 1 0 11.4 0"/>
</svg>`;

async function shutdown() {
    if (!confirm("Завершить приложение? Сервер остановится, окно закроется.")) return;
    try {
        await fetch(`${API_BASE_URL}/api/shutdown`, { method: "POST" });
    } catch (e) {
        // Сервер мог оборваться раньше, чем ответил, — это ожидаемо.
    }
    // Закрываем окно приложения. Для app-окна Chrome это разрешено;
    // если браузер закрыть не дал — показываем подсказку.
    window.close();
    setTimeout(() => {
        document.body.innerHTML =
            '<div style="display:flex;height:100vh;align-items:center;justify-content:center;' +
            'font-family:Onest,system-ui,sans-serif;color:#534AB7;font-size:18px;text-align:center;">' +
            "Сервер остановлен. Можно закрыть это окно." +
            "</div>";
    }, 400);
}

function render() {
    const isUploadPage = window.location.pathname.endsWith("admin.html");
    const bar = document.createElement("nav");
    bar.className = "tabs-bar";
    bar.innerHTML = `
        <div class="tabs-inner">
            <div class="tabs-left">
                <a href="admin.html" class="tab-btn${isUploadPage ? " active" : ""}">${LOCK_SVG}Админ</a>
            </div>
            <div class="tabs-right">
                <button type="button" class="tab-btn" id="quit-btn">${POWER_SVG}Завершить</button>
            </div>
        </div>
    `;
    document.body.appendChild(bar);
    const btn = bar.querySelector("#quit-btn");
    if (btn) btn.addEventListener("click", shutdown);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
} else {
    render();
}
