// Утилиты форматирования — без зависимостей.

export function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(bytes) {
    const mb = bytes / 1024 / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} МБ`;
    return `${(mb / 1024).toFixed(2)} ГБ`;
}

/**
 * Превращает ISO-дату YYYY-MM-DD в DD.MM.YYYY для отображения.
 * Хранение в Firestore остается в ISO — функция применяется только в UI.
 * Невалидные/пустые значения возвращаются как есть, чтобы не терять данные.
 */
export function formatDate(iso) {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    return `${m[3]}.${m[2]}.${m[1]}`;
}

// Известные видео-платформы → читаемые названия.
// Для неизвестных доменов — fallback на сам хост.
const SOURCE_PLATFORMS = {
    "vk.com": "ВК Видео",
    "vkvideo.ru": "ВК Видео",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "rutube.ru": "Rutube",
    "vimeo.com": "Vimeo",
    "dzen.ru": "Дзен",
    "ok.ru": "Одноклассники",
};

/**
 * Возвращает короткий лейбл источника по URL: "ВК Видео", "YouTube", "Rutube", и т.д.
 * Для неизвестных доменов — сам хост (например, "example.com").
 * При невалидном URL — "Источник".
 */
export function getSourceLabel(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
        return SOURCE_PLATFORMS[host] || host;
    } catch {
        return "Источник";
    }
}
