// Bottom navigation — фиксированная панель внизу страницы.
// Структура и стили .tabs-bar/.tabs-inner/.tab-btn перенесены из Spring Tracker.
// Подключается на index.html, folder.html, admin.html (на watch.html — нет, темная тема).

import { subscribeToAuth, isAdmin, logout } from "./firebase.js";

const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
</svg>`;

let barEl = null;

function buildHtml(user) {
    const isAdminPage = window.location.pathname.endsWith("admin.html");
    const leftHtml = isAdmin(user)
        ? `<a href="admin.html" class="tab-btn${isAdminPage ? " active" : ""}">${LOCK_SVG}Админ</a>`
        : `<div class="tab-btn--empty"></div>`;

    return `
        <div class="tabs-inner">
            <div class="tabs-left">${leftHtml}</div>
            <div class="tabs-right">
                <span class="tab-email">${escapeHtml(user.email || "")}</span>
                <button type="button" class="btn-secondary" data-action="logout">Выйти</button>
            </div>
        </div>
    `;
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function ensureBar() {
    if (barEl) return barEl;
    barEl = document.createElement("nav");
    barEl.className = "tabs-bar";
    document.body.appendChild(barEl);

    // Делегированный клик на logout
    barEl.addEventListener("click", (e) => {
        const target = e.target.closest("[data-action]");
        if (!target) return;
        if (target.dataset.action === "logout") logout();
    });

    return barEl;
}

function render(user) {
    if (!user) {
        if (barEl) barEl.style.display = "none";
        return;
    }
    ensureBar();
    barEl.style.display = "";
    barEl.innerHTML = buildHtml(user);
}

subscribeToAuth((user) => render(user));
