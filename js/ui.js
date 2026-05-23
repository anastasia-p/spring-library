// Общие DOM-компоненты: карточки, иконки.

import { formatDuration, formatBytes, formatDate, getSourceLabel } from "./utils.js";
import { videosApi } from "./data.js";
import {
    isAdmin,
    isVideoLiked,
    isFolderLiked,
    toggleVideoLike,
    toggleFolderLike,
    subscribeToProfile,
} from "./firebase.js";
import { openVideoEditor } from "./editor.js";
import { openFolderEditor } from "./folder-editor.js";
import { videoHasNotes, subscribeToNotesIndex } from "./notes.js";

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

const EYE_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
</svg>`;

const EYE_OFF_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
</svg>`;

// Сердечко — одна SVG, fill переключается через CSS на currentColor при .card__like--active
const HEART_ICON_SVG = `
<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"></path>
</svg>`;

// Значок "есть таймстемпы" — список строк с маркерами слева (ассоциация с
// заметками к моментам видео). Декоративный, не интерактивный.
const NOTES_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="9" y1="6" x2="20" y2="6"></line>
    <line x1="9" y1="12" x2="20" y2="12"></line>
    <line x1="9" y1="18" x2="20" y2="18"></line>
    <circle cx="4" cy="6" r="1"></circle>
    <circle cx="4" cy="12" r="1"></circle>
    <circle cx="4" cy="18" r="1"></circle>
</svg>`;

// Иконка папки — flat-стиль, лимонно-желтый из эмблемы школы (приглушенный),
// с тонкой обводкой на пару ступеней темнее заливки.
// Используется в createFolderCard здесь, а также в folder.js и watch.js через экспорт.
const FOLDER_ICON_FILL = "#EEE318";
const FOLDER_ICON_STROKE = "#C9BC2D";

/**
 * Создает SVG-иконку папки как inline-block элемент.
 * Размер задается через CSS (.folder-icon) — em-units, автомасштабируется
 * под font-size родителя. Декоративная, aria-hidden.
 */
export function createFolderIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "folder-icon");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M2 4 L9 4 L11 6 L22 6 L22 22 L2 22 Z");
    path.setAttribute("fill", FOLDER_ICON_FILL);
    path.setAttribute("stroke", FOLDER_ICON_STROKE);
    path.setAttribute("stroke-width", "0.8");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
}

/**
 * Карточка видео. У админа — иконки редактирования и удаления.
 * Layout: превью слева (с сердечком в правом верхнем углу),
 * контент справа (title, description, footer с meta+source+actions).
 * source-линка теперь живет внутри строки метаданных, не как абсолют сверху.
 * @param {object} video
 * @param {object} options
 * @param {function} options.onDelete - callback после успешного удаления (для рефреша списка)
 * @param {function} options.onSaved  - callback после успешного редактирования (для рефреша списка)
 * @returns {HTMLElement}
 */
export function createVideoCard(video, { onDelete, onSaved, onHiddenChanged } = {}) {
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
    fillVideoMeta(meta, video);
    footer.appendChild(meta);

    if (isAdmin()) {
        const actions = document.createElement("div");
        actions.className = "card__actions";
        actions.appendChild(createVideoHideButton(video, onHiddenChanged));
        actions.appendChild(createEditButton(video, onSaved));
        actions.appendChild(createDeleteButton(video, onDelete));
        footer.appendChild(actions);
    }

    body.appendChild(footer);
    card.appendChild(body);
    card.appendChild(createNotesBadge(video.id));
    card.appendChild(createLikeButton("video", video.id));

    return card;
}

/**
 * Карточка папки внутри раздела (например, папка видео).
 * Сердечко в правом верхнем углу карточки.
 * У админа — иконки скрытия/редактирования/удаления в футере.
 * @param {string} folderName
 * @param {number} videoCount
 * @param {object} options
 * @param {function} options.onDelete - callback после успешного удаления папки
 * @param {function} options.onRenamed - callback после успешного переименования
 * @param {string[]} options.existingFolders - имена всех папок (для проверки коллизии в editor)
 */
export function createFolderCard(folderName, videoCount, { onDelete, onRenamed, existingFolders, allHidden, hasHidden, onHiddenChanged } = {}) {
    const card = document.createElement("div");
    card.className = "card card--folder";
    card.addEventListener("click", () => {
        window.location.href = `folder.html?name=${encodeURIComponent(folderName)}`;
    });

    const title = document.createElement("h3");
    title.className = "card__title";
    title.appendChild(createFolderIcon());
    title.appendChild(document.createTextNode(folderName));
    card.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "card__meta";
    meta.textContent = `${videoCount} видео`;
    card.appendChild(meta);

    if (isAdmin()) {
        const actions = document.createElement("div");
        actions.className = "card__actions";
        actions.appendChild(createFolderHideButton(folderName, !!allHidden, !!hasHidden, onHiddenChanged));
        actions.appendChild(createFolderEditButton(folderName, videoCount, onRenamed, existingFolders));
        actions.appendChild(createFolderDeleteButton(folderName, videoCount, onDelete));
        card.appendChild(actions);
    }

    card.appendChild(createLikeButton("folder", folderName));

    return card;
}

// --- Значок "есть таймстемпы" ---------------------------------------------
// Не кнопка, а индикатор: показываем, если у текущего юзера есть хотя бы одна
// заметка к этому видео (videoHasNotes — синхронно из индекса в памяти).
// Клик по значку НЕ перехватываем — он пробрасывается на карточку и открывает
// видео, как клик по любому ее месту. pointer-events оставляем включенными,
// иначе native title-tooltip не показывается (см. урок про pointer-events:none).
// Значение видимости держим классом --visible, чтобы глобальная подписка ниже
// могла показывать/прятать значок при изменении заметок без пересоздания карточки.

function createNotesBadge(videoId) {
    const badge = document.createElement("div");
    badge.className = videoHasNotes(videoId)
        ? "card__notes card__notes--visible"
        : "card__notes";
    badge.innerHTML = NOTES_ICON_SVG;
    badge.title = "Есть таймстемпы";
    badge.setAttribute("aria-label", "В этом видео есть ваши таймстемпы");
    badge.dataset.notesId = videoId;
    return badge;
}

// Единая глобальная подписка на индекс заметок. При его изменении проходим по
// всем значкам на странице и переключаем видимость. Тем же приемом, что лайки.
subscribeToNotesIndex(() => {
    document.querySelectorAll(".card__notes").forEach((badge) => {
        const videoId = badge.dataset.notesId;
        if (!videoId) return;
        badge.classList.toggle("card__notes--visible", videoHasNotes(videoId));
    });
});

// --- Лайки ----------------------------------------------------------------
// Кнопка сердечка. Кликает — toggle через firebase.js, UI обновляется
// через глобальную подписку ниже (Firestore SDK → onSnapshot → subscribeToProfile).

function createLikeButton(targetType, targetId) {
    const liked = targetType === "video" ? isVideoLiked(targetId) : isFolderLiked(targetId);
    const btn = document.createElement("button");
    btn.className = liked ? "card__like card__like--active" : "card__like";
    btn.innerHTML = HEART_ICON_SVG;
    btn.title = liked ? "Убрать лайк" : "Лайк";
    btn.setAttribute("aria-label", btn.title);
    btn.dataset.likeTarget = targetType;
    btn.dataset.likeId = targetId;
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        try {
            if (targetType === "video") {
                await toggleVideoLike(targetId);
            } else {
                await toggleFolderLike(targetId);
            }
        } catch (err) {
            console.error("Ошибка лайка:", err);
            alert(`Не удалось обновить лайк: ${err.message}`);
        } finally {
            btn.disabled = false;
        }
    });
    return btn;
}

// Единая глобальная подписка. При изменении профиля проходим по всем сердечкам
// на странице и обновляем визуальное состояние. На текущем масштабе (десятки
// карточек) дешевле, чем подписка на каждую карточку с управлением cleanup.
subscribeToProfile(() => {
    document.querySelectorAll(".card__like").forEach((btn) => {
        const targetType = btn.dataset.likeTarget;
        const targetId = btn.dataset.likeId;
        if (!targetType || !targetId) return;
        const liked = targetType === "video"
            ? isVideoLiked(targetId)
            : isFolderLiked(targetId);
        btn.classList.toggle("card__like--active", liked);
        const newTitle = liked ? "Убрать лайк" : "Лайк";
        btn.title = newTitle;
        btn.setAttribute("aria-label", newTitle);
    });
});

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

function createVideoHideButton(video, onHiddenChanged) {
    const isHidden = !!video.hidden;
    const btn = document.createElement("button");
    btn.className = isHidden ? "card__hide card__hide--has-hidden" : "card__hide";
    btn.innerHTML = isHidden ? EYE_OFF_ICON_SVG : EYE_ICON_SVG;
    btn.title = isHidden ? "Показать видео" : "Скрыть видео";
    btn.setAttribute("aria-label", btn.title);
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        try {
            await videosApi.setHidden(video.id, !isHidden);
            if (onHiddenChanged) onHiddenChanged();
        } catch (err) {
            alert(`Ошибка: ${err.message}`);
            btn.disabled = false;
        }
    });
    return btn;
}

function createFolderHideButton(folderName, allHidden, hasHidden, onHiddenChanged) {
    // Три состояния:
    //   1) ничего не скрыто:    открытый глаз, без подложки
    //   2) что-то скрыто (mix): открытый глаз, серая подложка
    //   3) все скрыто:          перечеркнутый глаз, серая подложка
    // Подложка управляется классом has-hidden, иконка — отдельной логикой.
    const btn = document.createElement("button");
    btn.className = hasHidden ? "card__hide card__hide--has-hidden" : "card__hide";
    btn.innerHTML = allHidden ? EYE_OFF_ICON_SVG : EYE_ICON_SVG;
    btn.title = allHidden ? "Показать всю папку" : "Скрыть всю папку";
    btn.setAttribute("aria-label", btn.title);
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        try {
            await videosApi.setFolderHidden(folderName, !allHidden);
            if (onHiddenChanged) onHiddenChanged();
        } catch (err) {
            alert(`Ошибка: ${err.message}`);
            btn.disabled = false;
        }
    });
    return btn;
}

/**
 * Наполняет элемент мета-строкой видео: "длительность · размер · дата · ВК".
 * Source-линка (если есть source_url) — кликабельная ссылка, не пробрасывает
 * клик на карточку. Текстовые части и ссылка чередуются через текстовые узлы,
 * чтобы все встало в одну строку.
 */
function fillVideoMeta(parent, video) {
    parent.replaceChildren();
    const textParts = [];
    if (video.duration_sec != null) textParts.push(formatDuration(video.duration_sec));
    if (video.file_size_bytes) textParts.push(formatBytes(video.file_size_bytes));
    if (video.recorded_at) textParts.push(formatDate(video.recorded_at));

    if (textParts.length > 0) {
        parent.appendChild(document.createTextNode(textParts.join(" · ")));
    }

    if (video.source_url) {
        if (textParts.length > 0) {
            parent.appendChild(document.createTextNode(" · "));
        }
        parent.appendChild(createSourceLink(video.source_url));
    }
}
