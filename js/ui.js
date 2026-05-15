// Общие DOM-компоненты: карточки, иконки.

import { formatDuration, formatBytes, formatDate, getSourceLabel } from "./utils.js";
import { videosApi } from "./data.js";
import { isAdmin } from "./firebase.js";
import { openVideoEditor } from "./editor.js";
import { openFolderEditor } from "./folder-editor.js";

const TRASH_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6"></path>
    <path d="M14 11v6"></path>
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
</svg>`;

const EDIT_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
</svg>`;

/**
 * Карточка видео. У админа — иконки редактирования и удаления.
 * Layout: превью слева, контент справа (title, description, source-link, footer).
 * Если у видео есть source_url — отображается ссылка "Открыть в X".
 * Превью грузится по /thumb/{id}; при 404 показывается плейсхолдер.
 * @param {object} video
 * @param {object} options
 * @param {function} options.onDelete - callback после успешного удаления (для рефреша списка)
 * @param {function} options.onSaved  - callback после успешного редактирования (для рефреша списка)
 * @returns {HTMLElement}
 */
export function createVideoCard(video, { onDelete, onSaved } = {}) {
    const card = document.createElement("div");
    card.className = "card";
    card.addEventListener("click", () => {
        window.location.href = `watch.html?id=${encodeURIComponent(video.id)}`;
    });

    card.appendChild(createThumb(video.id, video.thumb_offset_y));

    const body = document.createElement("div");
    body.className = "card__body";

    const title = document.createElement("h3");
    title.className = "card__title";
    title.textContent = video.title || "(без названия)";
    body.appendChild(title);

    if (video.description) {
        const desc = document.createElement("p");
        desc.className = "card__description";
        desc.textContent = video.description;
        body.appendChild(desc);
    }

    const footer = document.createElement("div");
    footer.className = "card__footer";

    const meta = document.createElement("div");
    meta.className = "card__meta";
    meta.textContent = formatVideoMeta(video);
    footer.appendChild(meta);

    if (isAdmin()) {
        footer.appendChild(createEditButton(video, onSaved));
        footer.appendChild(createDeleteButton(video, onDelete));
    }

    body.appendChild(footer);
    card.appendChild(body);

    if (video.source_url) {
        card.appendChild(createSourceLink(video.source_url));
    }

    return card;
}

/**
 * Карточка папки внутри раздела (например, папка видео).
 * У админа — иконки редактирования и удаления (как у видео-карточки).
 * @param {string} folderName
 * @param {number} videoCount
 * @param {object} options
 * @param {function} options.onDelete - callback после успешного удаления папки
 * @param {function} options.onRenamed - callback после успешного переименования
 * @param {string[]} options.existingFolders - имена всех папок (для проверки коллизии в editor)
 */
export function createFolderCard(folderName, videoCount, { onDelete, onRenamed, existingFolders } = {}) {
    const card = document.createElement("div");
    card.className = "card card--folder";
    card.addEventListener("click", () => {
        window.location.href = `folder.html?name=${encodeURIComponent(folderName)}`;
    });

    const title = document.createElement("h3");
    title.className = "card__title";
    title.textContent = `📁 ${folderName}`;
    card.appendChild(title);

    const footer = document.createElement("div");
    footer.className = "card__footer";
    const meta = document.createElement("div");
    meta.className = "card__meta";
    meta.textContent = `${videoCount} видео`;
    footer.appendChild(meta);

    if (isAdmin()) {
        footer.appendChild(createFolderEditButton(folderName, videoCount, onRenamed, existingFolders));
        footer.appendChild(createFolderDeleteButton(folderName, videoCount, onDelete));
    }

    card.appendChild(footer);
    return card;
}

// --- Внутренние -----------------------------------------------------------

function createThumb(videoId, offsetY) {
    const wrap = document.createElement("div");
    wrap.className = "card__thumb";

    const placeholder = document.createElement("div");
    placeholder.className = "card__thumb-placeholder";
    placeholder.textContent = "🎬";
    wrap.appendChild(placeholder);

    const img = document.createElement("img");
    img.className = "card__thumb-img";
    img.loading = "lazy";
    img.alt = "";
    img.src = videosApi.thumbUrl(videoId);
    const y = typeof offsetY === "number" ? offsetY : 50;
    img.style.objectPosition = `50% ${y}%`;
    img.addEventListener("error", () => img.remove());
    wrap.appendChild(img);

    return wrap;
}

function createSourceLink(sourceUrl) {
    const link = document.createElement("a");
    link.className = "card__source";
    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = getSourceLabel(sourceUrl);
    // Не давать клику пробуросить на карточку — иначе откроется плеер вместо ссылки.
    link.addEventListener("click", (e) => e.stopPropagation());
    return link;
}

function createDeleteButton(video, onDelete) {
    const btn = document.createElement("button");
    btn.className = "card__delete";
    btn.innerHTML = TRASH_ICON_SVG;
    btn.title = "Удалить видео";
    btn.setAttribute("aria-label", "Удалить видео");
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Удалить "${video.title}"? Это безвозвратно.`)) return;
        btn.disabled = true;
        try {
            await videosApi.delete(video.id);
            if (onDelete) onDelete();
        } catch (err) {
            alert(`Ошибка удаления: ${err.message}`);
            btn.disabled = false;
        }
    });
    return btn;
}

function createEditButton(video, onSaved) {
    const btn = document.createElement("button");
    btn.className = "card__edit";
    btn.innerHTML = EDIT_ICON_SVG;
    btn.title = "Редактировать";
    btn.setAttribute("aria-label", "Редактировать видео");
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openVideoEditor(video, { onSaved });
    });
    return btn;
}

function createFolderEditButton(folderName, videoCount, onRenamed, existingFolders) {
    const btn = document.createElement("button");
    btn.className = "card__edit";
    btn.innerHTML = EDIT_ICON_SVG;
    btn.title = "Переименовать папку";
    btn.setAttribute("aria-label", "Переименовать папку");
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openFolderEditor(folderName, {
            existingFolders: existingFolders || [],
            onRenamed: () => { if (onRenamed) onRenamed(); },
        });
    });
    return btn;
}

function createFolderDeleteButton(folderName, videoCount, onDelete) {
    const btn = document.createElement("button");
    btn.className = "card__delete";
    btn.innerHTML = TRASH_ICON_SVG;
    btn.title = "Удалить папку";
    btn.setAttribute("aria-label", "Удалить папку");
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const msg = `Удалить папку "${folderName}" и все ${videoCount} видео внутри? Это безвозвратно.`;
        if (!confirm(msg)) return;
        btn.disabled = true;
        try {
            await videosApi.deleteFolder(folderName);
            if (onDelete) onDelete();
        } catch (err) {
            alert(`Ошибка удаления: ${err.message}`);
            btn.disabled = false;
        }
    });
    return btn;
}

function formatVideoMeta(video) {
    const parts = [];
    if (video.duration_sec != null) parts.push(formatDuration(video.duration_sec));
    if (video.file_size_bytes) parts.push(formatBytes(video.file_size_bytes));
    if (video.recorded_at) parts.push(formatDate(video.recorded_at));
    return parts.join(" · ");
}
