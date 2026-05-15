// editor.js — модал редактирования видео.
// Использование: openVideoEditor(video, { onSaved })

import { videosApi } from "./data.js";
import { getSourceLabel } from "./utils.js";

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;
const FOLDER_MAX = 60;

export function openVideoEditor(video, { onSaved } = {}) {
    const state = {
        videoId: video.id,
        sourceUrl: video.source_url || null,
        dirty: false,
        values: {
            title: video.title || "",
            description: video.description || "",
            folder: video.folder || "",
            recorded_at: video.recorded_at || "",
            thumb_offset_y: typeof video.thumb_offset_y === "number" ? video.thumb_offset_y : 50,
        },
        onSaved: onSaved || (() => {}),
    };

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) confirmClose(state, overlay);
    });

    const sheet = document.createElement("div");
    sheet.className = "modal-sheet";
    sheet.appendChild(buildHeader(state, overlay));
    sheet.appendChild(buildBody(state));
    sheet.appendChild(buildFooter(state, overlay));

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Esc — закрытие с подтверждением
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            confirmClose(state, overlay, onKey);
        }
    };
    document.addEventListener("keydown", onKey);
    overlay._escHandler = onKey;

    // Фокус в название
    setTimeout(() => sheet.querySelector("input[data-field='title']")?.focus(), 0);
}

// --- Структура -------------------------------------------------------------

function buildHeader(state, overlay) {
    const header = document.createElement("div");
    header.className = "modal-header";

    const titles = document.createElement("div");
    titles.className = "modal-header__titles";
    const subtitle = document.createElement("div");
    subtitle.className = "modal-header__subtitle";
    subtitle.textContent = "Видео";
    const title = document.createElement("div");
    title.className = "modal-header__title";
    title.textContent = "Редактирование";
    titles.appendChild(subtitle);
    titles.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-header__close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Закрыть");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => confirmClose(state, overlay));

    header.appendChild(titles);
    header.appendChild(closeBtn);
    return header;
}

function buildBody(state) {
    const body = document.createElement("div");
    body.className = "modal-body";

    body.appendChild(buildField({
        label: "Название",
        field: "title",
        state,
        required: true,
        maxLen: TITLE_MAX,
    }));

    body.appendChild(buildField({
        label: "Описание",
        field: "description",
        state,
        multiline: true,
        maxLen: DESCRIPTION_MAX,
    }));

    body.appendChild(buildField({
        label: "Папка",
        field: "folder",
        state,
        maxLen: FOLDER_MAX,
        hint: "Если пусто — видео ляжет в общий список.",
    }));

    body.appendChild(buildField({
        label: "Дата записи",
        field: "recorded_at",
        state,
        type: "date",
    }));

    if (state.sourceUrl) {
        body.appendChild(buildSourceRow(state.sourceUrl));
    }

    body.appendChild(buildThumbEditor(state));

    return body;
}

function buildFooter(state, overlay) {
    const footer = document.createElement("div");
    footer.className = "modal-footer";

    const closeBtn = document.createElement("button");
    closeBtn.className = "modal-btn modal-btn--secondary";
    closeBtn.type = "button";
    closeBtn.textContent = "Закрыть";
    closeBtn.addEventListener("click", () => confirmClose(state, overlay));

    const saveBtn = document.createElement("button");
    saveBtn.className = "modal-btn modal-btn--primary";
    saveBtn.type = "button";
    saveBtn.textContent = "Сохранить";
    saveBtn.addEventListener("click", () => save(state, overlay, saveBtn));

    footer.appendChild(closeBtn);
    footer.appendChild(saveBtn);
    return footer;
}

// --- Поля ------------------------------------------------------------------

function buildField({ label, field, state, required, maxLen, multiline, hint, type }) {
    const wrap = document.createElement("div");
    wrap.className = "modal-field";

    const header = document.createElement("div");
    header.className = "modal-field__header";
    const lbl = document.createElement("label");
    lbl.className = "modal-field__label";
    lbl.textContent = required ? `${label} *` : label;
    header.appendChild(lbl);

    let counter = null;
    if (maxLen) {
        counter = document.createElement("span");
        counter.className = "modal-field__counter";
        header.appendChild(counter);
    }
    wrap.appendChild(header);

    const el = multiline ? document.createElement("textarea") : document.createElement("input");
    el.className = "modal-field__input";
    el.dataset.field = field;
    if (!multiline) el.type = type || "text";
    if (maxLen) el.maxLength = maxLen;
    el.value = state.values[field] || "";

    const updateCounter = () => {
        if (!counter) return;
        const len = el.value.length;
        const threshold = Math.floor(maxLen * 0.8);
        const remaining = maxLen - len;
        counter.textContent = len >= threshold ? `${remaining} / ${maxLen}` : "";
        counter.classList.toggle("modal-field__counter--warn", remaining <= 10);
    };
    updateCounter();

    el.addEventListener("input", () => {
        state.values[field] = el.value;
        state.dirty = true;
        updateCounter();
    });

    lbl.htmlFor = el.id = `modal-field-${field}`;

    wrap.appendChild(el);

    if (hint) {
        const h = document.createElement("div");
        h.className = "modal-field__hint";
        h.textContent = hint;
        wrap.appendChild(h);
    }

    return wrap;
}

function buildSourceRow(url) {
    const wrap = document.createElement("div");
    wrap.className = "modal-field";

    const lbl = document.createElement("div");
    lbl.className = "modal-field__label";
    lbl.textContent = "Источник";
    wrap.appendChild(lbl);

    const link = document.createElement("a");
    link.className = "modal-source-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = getSourceLabel(url);
    wrap.appendChild(link);

    return wrap;
}

function buildThumbEditor(state) {
    const wrap = document.createElement("div");
    wrap.className = "modal-field";

    const lbl = document.createElement("div");
    lbl.className = "modal-field__label";
    lbl.textContent = "Превью";
    wrap.appendChild(lbl);

    const hint = document.createElement("div");
    hint.className = "modal-field__hint";
    hint.textContent = "Потяни картинку вверх или вниз, чтобы выбрать какую часть кадра показывать.";
    hint.style.marginTop = "0";
    hint.style.marginBottom = "8px";
    wrap.appendChild(hint);

    const frame = document.createElement("div");
    frame.className = "modal-thumb-frame";

    const placeholder = document.createElement("div");
    placeholder.className = "modal-thumb-placeholder";
    placeholder.textContent = "🎬";
    frame.appendChild(placeholder);

    const img = document.createElement("img");
    img.className = "modal-thumb-img";
    img.alt = "";
    img.src = `${videosApi.thumbUrl(state.videoId)}?v=${Date.now()}`;
    img.style.objectPosition = `50% ${state.values.thumb_offset_y}%`;
    img.addEventListener("error", () => img.remove());
    frame.appendChild(img);

    setupThumbDrag(frame, img, state);
    wrap.appendChild(frame);
    return wrap;
}

function setupThumbDrag(frame, img, state) {
    let dragging = false;
    let startY = 0;
    let startOffset = state.values.thumb_offset_y;

    frame.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        dragging = true;
        startY = event.clientY;
        startOffset = state.values.thumb_offset_y;
        frame.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });

    frame.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        const rect = frame.getBoundingClientRect();
        const dy = event.clientY - startY;
        const delta = (-dy / rect.height) * 100;
        const next = Math.max(0, Math.min(100, startOffset + delta));
        state.values.thumb_offset_y = next;
        state.dirty = true;
        img.style.objectPosition = `50% ${next}%`;
    });

    const onUp = (event) => {
        if (!dragging) return;
        dragging = false;
        frame.releasePointerCapture?.(event.pointerId);
    };
    frame.addEventListener("pointerup", onUp);
    frame.addEventListener("pointercancel", onUp);
}

// --- Сохранение / закрытие -------------------------------------------------

async function save(state, overlay, saveBtn) {
    const title = (state.values.title || "").trim();
    if (!title) {
        const titleInput = overlay.querySelector("input[data-field='title']");
        titleInput?.focus();
        titleInput?.classList.add("modal-field__input--error");
        return;
    }

    saveBtn.disabled = true;
    saveBtn.style.width = saveBtn.offsetWidth + "px";
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Сохранение...";

    try {
        const data = await videosApi.update(state.videoId, {
            title,
            description: state.values.description,
            folder: state.values.folder,
            recorded_at: state.values.recorded_at,
            thumb_offset_y: Math.round(state.values.thumb_offset_y),
        });
        state.dirty = false;
        state.onSaved(data);
        saveBtn.textContent = "Сохранено ✓";
        saveBtn.classList.add("modal-btn--saved");
        setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
            saveBtn.style.width = "";
            saveBtn.classList.remove("modal-btn--saved");
        }, 2000);
    } catch (err) {
        alert(`Ошибка при сохранении: ${err.message}`);
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
        saveBtn.style.width = "";
    }
}

function confirmClose(state, overlay) {
    if (state.dirty) {
        if (!confirm("Есть несохранённые изменения. Выйти без сохранения?")) return;
    }
    closeOverlay(overlay);
}

function closeOverlay(overlay) {
    if (overlay._escHandler) {
        document.removeEventListener("keydown", overlay._escHandler);
    }
    overlay.remove();
}
