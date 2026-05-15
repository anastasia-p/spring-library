// Сортировка списков видео + контрол сортировки для UI.
// Используется на главной (одиночные видео) и на странице папки.
// Состояние хранится в localStorage, единое для обоих мест.

const STORAGE_KEY = "spring_library_video_sort";
const DEFAULT_SORT = { field: "name", dir: "asc" };

/**
 * Загружает сохраненное состояние сортировки из localStorage.
 * Возвращает {field, dir} с валидацией.
 */
export function loadSort() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SORT };
        const parsed = JSON.parse(raw);
        return {
            field: parsed.field === "date" ? "date" : "name",
            dir: parsed.dir === "desc" ? "desc" : "asc",
        };
    } catch {
        return { ...DEFAULT_SORT };
    }
}

function saveSort(sort) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sort));
    } catch {
        // localStorage заблокирован — игнорируем
    }
}

/**
 * Сортирует список видео по полю и направлению.
 * field: "name" | "date"
 * dir:   "asc"  | "desc"
 * Для "date" используется recorded_at (если есть), иначе fallback на uploaded_at.
 * recorded_at — строка YYYY-MM-DD; uploaded_at — Firestore Timestamp.
 */
export function sortVideos(videos, field, dir) {
    const sign = dir === "desc" ? -1 : 1;
    const list = [...videos];

    if (field === "date") {
        list.sort((a, b) => sign * (videoDateMillis(a) - videoDateMillis(b)));
    } else {
        list.sort((a, b) => {
            const ta = (a.title || "").trim();
            const tb = (b.title || "").trim();
            return sign * ta.localeCompare(tb, "ru", { sensitivity: "base", numeric: true });
        });
    }
    return list;
}

function videoDateMillis(v) {
    if (v.recorded_at) {
        const t = new Date(v.recorded_at).getTime();
        if (!isNaN(t)) return t;
    }
    if (v.uploaded_at) {
        // Firestore Timestamp при чтении через JS SDK
        if (typeof v.uploaded_at.toMillis === "function") return v.uploaded_at.toMillis();
        if (typeof v.uploaded_at.seconds === "number") return v.uploaded_at.seconds * 1000;
    }
    return 0;
}

/**
 * Создает DOM-контрол сортировки.
 * onChange({field, dir}) вызывается при каждом изменении (после сохранения).
 * Начальное состояние читается из localStorage.
 */
export function createSortControl(onChange) {
    let current = loadSort();

    const wrap = document.createElement("div");
    wrap.className = "sort-control";

    // Сегменты выбора поля
    const fieldGroup = document.createElement("div");
    fieldGroup.className = "sort-control__field-group";

    const btnName = makeFieldButton("Имя", () => {
        if (current.field === "name") return;
        current = { ...current, field: "name" };
        emit();
    });
    const btnDate = makeFieldButton("Дата", () => {
        if (current.field === "date") return;
        current = { ...current, field: "date" };
        emit();
    });
    fieldGroup.appendChild(btnName);
    fieldGroup.appendChild(btnDate);

    // Кнопка направления
    const btnDir = document.createElement("button");
    btnDir.type = "button";
    btnDir.className = "sort-control__dir-btn";
    btnDir.addEventListener("click", () => {
        current = { ...current, dir: current.dir === "asc" ? "desc" : "asc" };
        emit();
    });

    wrap.appendChild(fieldGroup);
    wrap.appendChild(btnDir);

    function render() {
        btnName.classList.toggle("sort-control__field-btn--active", current.field === "name");
        btnDate.classList.toggle("sort-control__field-btn--active", current.field === "date");
        btnDir.textContent = current.dir === "asc" ? "↓" : "↑";
        btnDir.setAttribute("aria-label", current.dir === "asc" ? "По возрастанию" : "По убыванию");
        btnDir.title = current.dir === "asc" ? "По возрастанию" : "По убыванию";
    }

    function emit() {
        saveSort(current);
        render();
        onChange(current);
    }

    render();
    return wrap;
}

function makeFieldButton(label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sort-control__field-btn";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
}
