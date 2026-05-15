// folder-editor.js — модал редактирования имени папки.
// Использование: openFolderEditor(folderName, { onRenamed, existingFolders })
//
// existingFolders — массив имён существующих папок (для проверки коллизии перед confirm).
// onRenamed(newName) — callback после успешного переименования.

import { videosApi } from "./data.js";

const FOLDER_MAX = 60;

export function openFolderEditor(folderName, { onRenamed, existingFolders } = {}) {
    const state = {
        oldName: folderName,
        existingFolders: existingFolders || [],
        dirty: false,
        values: {
            folder: folderName,
        },
        onRenamed: onRenamed || (() => {}),
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

    const onKey = (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            confirmClose(state, overlay);
        }
    };
    document.addEventListener("keydown", onKey);
    overlay._escHandler = onKey;

    setTimeout(() => sheet.querySelector("input[data-field='folder']")?.focus(), 0);
}

function buildHeader(state, overlay) {
    const header = document.createElement("div");
    header.className = "modal-header";

    const titles = document.createElement("div");
    titles.className = "modal-header__titles";
    const subtitle = document.createElement("div");
    subtitle.className = "modal-header__subtitle";
    subtitle.textContent = "Папка";
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
        field: "folder",
        state,
        required: true,
        maxLen: FOLDER_MAX,
    }));

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

function buildField({ label, field, state, required, maxLen }) {
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

    const el = document.createElement("input");
    el.className = "modal-field__input";
    el.dataset.field = field;
    el.type = "text";
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
        el.classList.remove("modal-field__input--error");
    });

    lbl.htmlFor = el.id = `modal-field-${field}`;
    wrap.appendChild(el);

    return wrap;
}

async function save(state, overlay, saveBtn) {
    const newName = (state.values.folder || "").trim();
    const input = overlay.querySelector("input[data-field='folder']");

    if (!newName) {
        input?.focus();
        input?.classList.add("modal-field__input--error");
        return;
    }

    if (newName === state.oldName) {
        // Ничего не меняли — просто закрываем
        closeOverlay(overlay);
        return;
    }

    // Проверка коллизии — если новое имя уже есть среди других папок
    const collision = state.existingFolders.some(
        (name) => name === newName && name !== state.oldName
    );
    if (collision) {
        const ok = confirm(
            `Папка "${newName}" уже существует. Слить с ней? Все видео из "${state.oldName}" перейдут в "${newName}".`
        );
        if (!ok) return;
    }

    saveBtn.disabled = true;
    saveBtn.style.width = saveBtn.offsetWidth + "px";
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Сохранение...";

    try {
        await videosApi.renameFolder(state.oldName, newName);
        state.dirty = false;
        state.onRenamed(newName);
        saveBtn.textContent = "Сохранено ✓";
        saveBtn.classList.add("modal-btn--saved");
        setTimeout(() => closeOverlay(overlay), 600);
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
