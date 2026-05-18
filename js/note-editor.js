// js/note-editor.js
// Модал создания/редактирования заметки. Bottom-sheet на мобиле, центральный на десктопе.
//
// Стили инлайнятся через <style> в head — плеер темный, без theme.css.
//
// API: openNoteEditor({ videoId, time, note?, onSaved?, onDeleted?, onCancelled? })
//   - Создание: передать videoId + time
//   - Редактирование: передать note = { id, text, time }

import { addNote, updateNote, deleteNote, MAX_NOTE_TEXT_LENGTH } from "./notes.js";

const STYLE_ID = "note-modal-styles";

const STYLES = `
.note-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 1000;
    animation: note-modal-fade-in 0.18s ease-out;
}
.note-modal {
    --note-primary: #0295DE;
    --note-bg: #1a1a1a;
    --note-surface: #2a2a2a;
    --note-text: #ffffff;
    --note-text-muted: #aaaaaa;
    --note-danger: #d9261c;
    --note-border: #3a3a3a;

    width: 100%;
    max-width: 560px;
    background: var(--note-bg);
    color: var(--note-text);
    border-radius: 16px 16px 0 0;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-height: 90vh;
    box-sizing: border-box;
    font-family: "Onest", system-ui, -apple-system, sans-serif;
    animation: note-modal-slide-up 0.22s ease-out;
}
@media (min-width: 600px) {
    .note-modal-overlay { align-items: center; }
    .note-modal { border-radius: 16px; }
}
.note-modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}
.note-modal__title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--note-text);
}
.note-modal__close {
    background: none;
    border: none;
    color: var(--note-text-muted);
    font-size: 26px;
    line-height: 1;
    cursor: pointer;
    padding: 0 6px;
}
.note-modal__close:hover { color: var(--note-text); }
.note-modal__field { display: flex; flex-direction: column; gap: 6px; }
.note-modal__textarea {
    background: var(--note-surface);
    color: var(--note-text);
    border: 1px solid var(--note-border);
    border-radius: 10px;
    padding: 12px;
    font-size: 15px;
    font-family: inherit;
    resize: vertical;
    min-height: 110px;
    box-sizing: border-box;
    outline: none;
    line-height: 1.5;
    width: 100%;
}
.note-modal__textarea::placeholder { color: #666; }
.note-modal__textarea:focus { border-color: var(--note-primary); }
.note-modal__counter {
    font-size: 12px;
    color: var(--note-text-muted);
    text-align: right;
}
.note-modal__counter--over { color: var(--note-danger); }
.note-modal__error {
    color: var(--note-danger);
    font-size: 13px;
    min-height: 18px;
}
.note-modal__footer {
    display: flex;
    gap: 10px;
    justify-content: space-between;
    align-items: center;
}
.note-modal__footer-left,
.note-modal__footer-right { display: flex; gap: 10px; }
.note-modal__btn {
    background: var(--note-surface);
    color: var(--note-text);
    border: 1px solid var(--note-border);
    border-radius: 10px;
    padding: 10px 18px;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    font-weight: 500;
}
.note-modal__btn:hover { background: #333; }
.note-modal__btn--primary {
    background: var(--note-primary);
    color: #fff;
    border-color: var(--note-primary);
}
.note-modal__btn--primary:hover { background: #0282c5; }
.note-modal__btn--primary:disabled { opacity: 0.55; cursor: not-allowed; }
.note-modal__btn--danger {
    color: var(--note-danger);
    background: transparent;
    border-color: transparent;
    padding: 10px 14px;
}
.note-modal__btn--danger:hover { background: rgba(217, 38, 28, 0.10); }
@keyframes note-modal-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes note-modal-slide-up {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
}
`;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = STYLES;
    document.head.appendChild(el);
}

function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Открыть редактор заметки.
 *
 * @param {Object} opts
 * @param {string} opts.videoId
 * @param {number} opts.time - текущая секунда видео (для создания)
 * @param {Object} [opts.note] - существующая заметка для режима редактирования { id, text, time }
 * @param {Function} [opts.onSaved] - вызывается после успешного сохранения
 * @param {Function} [opts.onDeleted] - вызывается после удаления
 * @param {Function} [opts.onCancelled] - вызывается при закрытии без сохранения
 */
export function openNoteEditor({
    videoId,
    time,
    note = null,
    onSaved,
    onDeleted,
    onCancelled,
}) {
    injectStyles();

    const isEdit = Boolean(note);
    const displayTime = isEdit ? note.time : time;
    const initialText = isEdit ? (note.text || "") : "";

    // --- DOM ---
    const overlay = document.createElement("div");
    overlay.className = "note-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "note-modal";
    overlay.appendChild(modal);

    // header
    const header = document.createElement("div");
    header.className = "note-modal__header";
    const title = document.createElement("h3");
    title.className = "note-modal__title";
    title.textContent = isEdit
        ? `Заметка на ${formatTime(displayTime)} — редактирование`
        : `Заметка на ${formatTime(displayTime)}`;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "note-modal__close";
    closeBtn.setAttribute("aria-label", "Закрыть");
    closeBtn.textContent = "×";
    header.appendChild(title);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // textarea
    const field = document.createElement("div");
    field.className = "note-modal__field";
    const textarea = document.createElement("textarea");
    textarea.className = "note-modal__textarea";
    textarea.placeholder = "Что заметила…";
    textarea.maxLength = MAX_NOTE_TEXT_LENGTH;
    textarea.value = initialText;
    const counter = document.createElement("div");
    counter.className = "note-modal__counter";
    field.appendChild(textarea);
    field.appendChild(counter);
    modal.appendChild(field);

    const errorEl = document.createElement("div");
    errorEl.className = "note-modal__error";
    modal.appendChild(errorEl);

    // footer
    const footer = document.createElement("div");
    footer.className = "note-modal__footer";
    const footerLeft = document.createElement("div");
    footerLeft.className = "note-modal__footer-left";
    const footerRight = document.createElement("div");
    footerRight.className = "note-modal__footer-right";
    footer.appendChild(footerLeft);
    footer.appendChild(footerRight);

    let deleteBtn = null;
    if (isEdit) {
        deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "note-modal__btn note-modal__btn--danger";
        deleteBtn.textContent = "Удалить";
        footerLeft.appendChild(deleteBtn);
    }

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "note-modal__btn";
    cancelBtn.textContent = "Отмена";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "note-modal__btn note-modal__btn--primary";
    saveBtn.textContent = "Сохранить";

    footerRight.appendChild(cancelBtn);
    footerRight.appendChild(saveBtn);
    modal.appendChild(footer);

    document.body.appendChild(overlay);

    // фокус с задержкой — успеть анимации
    setTimeout(() => {
        textarea.focus();
        // курсор в конец
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 60);

    updateCounter();

    // --- handlers ---

    function updateCounter() {
        const len = textarea.value.length;
        counter.textContent = `${len} / ${MAX_NOTE_TEXT_LENGTH}`;
        counter.classList.toggle("note-modal__counter--over", len > MAX_NOTE_TEXT_LENGTH);
    }

    function showError(msg) {
        errorEl.textContent = msg || "";
    }

    function close() {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
    }

    function isDirty() {
        return textarea.value.trim() !== initialText.trim();
    }

    function confirmCloseIfDirty() {
        if (!isDirty()) return true;
        return confirm("Изменения не сохранены. Закрыть?");
    }

    function handleCancel() {
        if (!confirmCloseIfDirty()) return;
        close();
        if (onCancelled) onCancelled();
    }

    async function handleSave() {
        showError("");
        const text = textarea.value.trim();
        if (!text) {
            showError("Текст не может быть пустым");
            textarea.focus();
            return;
        }
        if (text.length > MAX_NOTE_TEXT_LENGTH) {
            showError(`Текст не должен превышать ${MAX_NOTE_TEXT_LENGTH} символов`);
            return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = "Сохранение…";
        try {
            if (isEdit) {
                await updateNote(note.id, text);
            } else {
                await addNote(videoId, time, text);
            }
            close();
            if (onSaved) onSaved();
        } catch (err) {
            console.error("[note-editor] save failed:", err);
            showError(err?.message || "Не удалось сохранить");
            saveBtn.disabled = false;
            saveBtn.textContent = "Сохранить";
        }
    }

    async function handleDelete() {
        if (!confirm("Удалить заметку?")) return;
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.textContent = "Удаление…";
        }
        try {
            await deleteNote(note.id);
            close();
            if (onDeleted) onDeleted();
        } catch (err) {
            console.error("[note-editor] delete failed:", err);
            showError(err?.message || "Не удалось удалить");
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.textContent = "Удалить";
            }
        }
    }

    function onKey(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            handleCancel();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
        }
    }

    textarea.addEventListener("input", updateCounter);
    closeBtn.addEventListener("click", handleCancel);
    cancelBtn.addEventListener("click", handleCancel);
    saveBtn.addEventListener("click", handleSave);
    if (deleteBtn) deleteBtn.addEventListener("click", handleDelete);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) handleCancel();
    });
    document.addEventListener("keydown", onKey);
}
