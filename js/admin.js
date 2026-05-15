// admin.html — добавление контента. Доступно только админу.
// Логин/регистрация — общий auth-overlay (см. auth-overlay.js). Logout — в шапке (header.js).

import { subscribeToAuth, isAdmin } from "./firebase.js";
import { videosApi } from "./data.js";
import { formatBytes, formatDate } from "./utils.js";
import { openVideoEditor } from "./editor.js";

// --- Секции страницы ---
const adminSection = document.getElementById("admin-section");
const notAdminSection = document.getElementById("not-admin-section");

// --- Внутренние табы (Видео / Книги / Фильмы) ---
const tabs = document.querySelectorAll(".admin-tab");
const tabContents = document.querySelectorAll(".admin-tab-content");

// --- Форма загрузки видео ---
const uploadForm = document.getElementById("upload-form");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submit-btn");
const cancelBtn = document.getElementById("cancel-btn");
const fileInput = document.getElementById("file");
const fileLabel = document.getElementById("file-label");
const folderListEl = document.getElementById("folder-list");
const folderInput = document.getElementById("folder");
const urlInput = document.getElementById("url");
const sourceRadios = document.querySelectorAll("input[name='source']");
const fileOnlyFields = document.querySelectorAll("[data-source='file']");
const urlOnlyFields = document.querySelectorAll("[data-source='url']");

let activeUploadController = null;
let didInit = false;

// --- Прогресс-бар ---
const progressEl = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");

// --- Auth-подписка: показываем admin / not-admin в зависимости от роли ---
subscribeToAuth((user) => {
    if (!user) {
        // auth-overlay покрывает страницу — ничего делать не надо
        adminSection.hidden = true;
        notAdminSection.hidden = true;
        return;
    }
    if (isAdmin(user)) {
        adminSection.hidden = false;
        notAdminSection.hidden = true;
        if (!didInit) {
            didInit = true;
            initAdmin();
        }
        loadVideoFolders();
    } else {
        adminSection.hidden = true;
        notAdminSection.hidden = false;
    }
});

function initAdmin() {
    setupTabs();
    setupSourceToggle();

    cancelBtn.addEventListener("click", () => {
        if (activeUploadController) activeUploadController.abort();
    });

    // Освежаем список папок при возврате во вкладку / фокусе на поле папки.
    folderInput.addEventListener("focus", () => {
        if (isAdmin()) loadVideoFolders();
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && isAdmin()) loadVideoFolders();
    });

    uploadForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const source = getSelectedSource();
        if (source === "url") {
            await handleUrlUpload();
        } else {
            await handleFileUpload();
        }
    });

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        fileLabel.textContent = file ? file.name : "Файл не выбран";
    });
}

// --- Tabs ---
function setupTabs() {
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.tab;
            tabs.forEach((t) => t.classList.toggle("admin-tab--active", t === tab));
            tabContents.forEach((c) => {
                c.classList.toggle("admin-tab-content--active", c.dataset.tabContent === target);
            });
        });
    });
}

// --- Переключатель источника (Файл / Ссылка) ---
function setupSourceToggle() {
    sourceRadios.forEach((radio) => {
        radio.addEventListener("change", applySourceMode);
    });
    applySourceMode();
}

function getSelectedSource() {
    const checked = document.querySelector("input[name='source']:checked");
    return checked ? checked.value : "file";
}

function applySourceMode() {
    const isFile = getSelectedSource() === "file";
    fileOnlyFields.forEach((el) => { el.hidden = !isFile; });
    urlOnlyFields.forEach((el) => { el.hidden = isFile; });
}

// --- Папки для автокомплита ---
async function loadVideoFolders() {
    try {
        const folders = await videosApi.fetchFolderNames();
        folderListEl.innerHTML = "";
        folders.forEach((name) => {
            const opt = document.createElement("option");
            opt.value = name;
            folderListEl.appendChild(opt);
        });
    } catch (err) {
        console.warn("Не удалось загрузить список папок:", err);
    }
}

// --- Загрузка файлом ---
async function handleFileUpload() {
    const file = fileInput.files[0];
    if (!file) {
        showStatus("Выберите файл", "error");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", document.getElementById("title").value);
    formData.append("description", document.getElementById("description").value);
    formData.append("recorded_at", document.getElementById("recorded_at").value);
    formData.append("folder", document.getElementById("folder").value);

    submitBtn.disabled = true;
    showStatus("", "info");
    showProgress(0, file.size, 0, 0);
    cancelBtn.hidden = false;
    activeUploadController = new AbortController();

    try {
        const data = await videosApi.upload(
            formData,
            (p) => showProgress(p.downloaded, p.total, p.speed, p.eta),
            activeUploadController.signal,
        );
        hideProgress();
        const folderPart = data.folder ? ` в папку "${data.folder}"` : "";
        showStatus(
            `Загружено: "${data.title}"${folderPart} (${data.duration_sec || "?"} сек)`,
            "success"
        );
        openVideoEditor(data, { onSaved: loadVideoFolders });
        resetForm();
        loadVideoFolders();
    } catch (err) {
        hideProgress();
        if (err.name === "AbortError") {
            showStatus("Загрузка отменена", "info");
        } else {
            showStatus(`Ошибка: ${err.message}`, "error");
        }
    } finally {
        cancelBtn.hidden = true;
        activeUploadController = null;
        submitBtn.disabled = false;
    }
}

// --- Загрузка по URL ---
async function handleUrlUpload() {
    const url = urlInput.value.trim();
    if (!url) {
        showStatus("Введите ссылку", "error");
        return;
    }

    const formData = new FormData();
    formData.append("url", url);
    formData.append("title", document.getElementById("title").value);
    formData.append("description", document.getElementById("description").value);
    formData.append("folder", document.getElementById("folder").value);

    submitBtn.disabled = true;
    showStatus("", "info");
    showProgress(0, 0, 0, 0);
    cancelBtn.hidden = false;
    activeUploadController = new AbortController();

    try {
        const data = await videosApi.uploadFromUrl(
            formData,
            handleStreamEvent,
            activeUploadController.signal,
        );
        hideProgress();
        const folderPart = data.folder ? ` в папку "${data.folder}"` : "";
        const datePart = data.recorded_at ? `, дата ${formatDate(data.recorded_at)}` : "";
        showStatus(
            `Скачано: "${data.title}"${folderPart} (${data.duration_sec || "?"} сек${datePart})`,
            "success"
        );
        openVideoEditor(data, { onSaved: loadVideoFolders });
        resetForm();
        loadVideoFolders();
    } catch (err) {
        hideProgress();
        if (err.name === "AbortError") {
            showStatus("Загрузка отменена", "info");
        } else if (err.duplicateId) {
            showStatusWithLink(
                err.message,
                `watch.html?id=${encodeURIComponent(err.duplicateId)}`,
                "Открыть существующее",
                "error"
            );
        } else {
            showStatus(`Ошибка: ${err.message}`, "error");
        }
    } finally {
        cancelBtn.hidden = true;
        activeUploadController = null;
        submitBtn.disabled = false;
    }
}

// --- Стрим прогресса ---
function handleStreamEvent(event) {
    if (event.type === "progress") {
        showProgress(event.downloaded, event.total, event.speed, event.eta);
    } else if (event.type === "status") {
        showStatus(event.message, "info");
        if (event.message && !event.message.toLowerCase().includes("скачив")) {
            setProgressIndeterminate(event.message);
        }
    }
}

// --- Прогресс-бар ---
function showProgress(downloaded, total, speed, eta) {
    progressEl.hidden = false;
    progressBar.classList.remove("progress__bar--indeterminate");
    if (total > 0) {
        const percent = Math.min(100, (downloaded / total) * 100);
        progressBar.style.width = `${percent.toFixed(1)}%`;
        progressLabel.textContent = formatProgressLabel(percent, downloaded, total, speed, eta);
    } else {
        progressBar.style.width = "";
        progressBar.classList.add("progress__bar--indeterminate");
        const speedPart = speed ? ` · ${formatBytes(speed)}/с` : "";
        progressLabel.textContent = `${formatBytes(downloaded)}${speedPart}`;
    }
}

function setProgressIndeterminate(message) {
    progressEl.hidden = false;
    progressBar.style.width = "";
    progressBar.classList.add("progress__bar--indeterminate");
    progressLabel.textContent = message;
}

function hideProgress() {
    progressEl.hidden = true;
    progressBar.style.width = "0%";
    progressBar.classList.remove("progress__bar--indeterminate");
    progressLabel.textContent = "";
}

function formatProgressLabel(percent, downloaded, total, speed, eta) {
    const parts = [`${percent.toFixed(0)}%`];
    parts.push(`${formatBytes(downloaded)} из ${formatBytes(total)}`);
    if (speed) parts.push(`${formatBytes(speed)}/с`);
    if (eta) parts.push(formatEta(eta));
    return parts.join(" · ");
}

function formatEta(seconds) {
    if (seconds < 60) return `${Math.round(seconds)} с`;
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return `${m} м ${s} с`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} ч ${m} м`;
}

// --- Reset / статусы ---
function resetForm() {
    uploadForm.reset();
    fileLabel.textContent = "Файл не выбран";
    applySourceMode();
}

function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = `status status--${type}`;
}

function showStatusWithLink(message, href, linkText, type) {
    statusEl.textContent = message + " ";
    statusEl.className = `status status--${type}`;
    const link = document.createElement("a");
    link.href = href;
    link.textContent = linkText;
    statusEl.appendChild(link);
}
