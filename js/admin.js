// admin.html — добавление контента.
// Авторизации больше нет (приложение однопользовательское) — страница доступна
// сразу, без проверки роли. Форма минимальная: только источник (файл/URL).
// Title подставляется на бэке (из имени файла или yt-dlp), остальные поля
// дозаполняются в editor, который открывается сразу после успешной загрузки.

import { videosApi } from "./data.js";
import { formatBytes, formatDate } from "./utils.js";
import { openVideoEditor } from "./editor.js";

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
const urlInput = document.getElementById("url");
const sourceRadios = document.querySelectorAll("input[name='source']");
const fileOnlyFields = document.querySelectorAll("[data-source='file']");
const urlOnlyFields = document.querySelectorAll("[data-source='url']");

let activeUploadController = null;

// --- Прогресс-бар ---
const progressEl = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");

function initAdmin() {
    // Авторизации больше нет. Если в разметке секция формы помечена hidden
    // (как в исходном admin.html, где ее раскрывал старый auth-код) — раскрываем
    // ее сами; секцию-заглушку 'не админ', если она есть, прячем.
    const adminSection = document.getElementById("admin-section");
    if (adminSection) adminSection.hidden = false;
    const notAdminSection = document.getElementById("not-admin-section");
    if (notAdminSection) notAdminSection.hidden = true;

    setupTabs();
    setupSourceToggle();

    cancelBtn.addEventListener("click", () => {
        if (activeUploadController) activeUploadController.abort();
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

// --- Загрузка файлом ---
async function handleFileUpload() {
    const file = fileInput.files[0];
    if (!file) {
        showStatus("Выберите файл", "error");
        return;
    }

    // В форме теперь только файл — title и остальные поля подставит бэк (имя файла,
    // ffprobe-метаданные). Дозаполнение в editor, который откроется ниже.
    const formData = new FormData();
    formData.append("file", file);

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
        showStatus(`Загружено: "${data.title}" (${data.duration_sec || "?"} сек)`, "success");
        openVideoEditor(data);
        resetForm();
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

    // В форме теперь только URL — title и остальное подставит yt-dlp (info.title, upload_date).
    const formData = new FormData();
    formData.append("url", url);

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
        const datePart = data.recorded_at ? `, дата ${formatDate(data.recorded_at)}` : "";
        showStatus(
            `Скачано: "${data.title}" (${data.duration_sec || "?"} сек${datePart})`,
            "success"
        );
        openVideoEditor(data);
        resetForm();
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

// Модуль грузится как type="module" (defer) — DOM уже готов. На всякий случай ждем.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdmin);
} else {
    initAdmin();
}
