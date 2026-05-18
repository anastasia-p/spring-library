// Страница плеера: метаданные, кастомные controls, скорость, перемотка, fullscreen, зум, mute, заметки.

import {
    subscribeToAuth,
    subscribeToProfile,
    isVideoLiked,
    toggleVideoLike,
} from "./firebase.js";
import { videosApi } from "./data.js";
import { createFolderIcon } from "./ui.js";
import { formatDuration, formatBytes, formatDate, getSourceLabel } from "./utils.js";
import { subscribeToNotes, deleteNote } from "./notes.js";
import { openNoteEditor } from "./note-editor.js";

const SEEK_STEP = 10;
const DOUBLE_CLICK_DELAY = 280;
const DRAG_THRESHOLD = 5;
const CONTROLS_HIDE_DELAY = 2500;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const videoEl = document.getElementById("video");
const videoContainer = document.getElementById("video-container");
const playerContent = document.getElementById("player-content");
const errorEl = document.getElementById("error-state");
const titleEl = document.getElementById("info-title");
const metaEl = document.getElementById("info-meta");
const descriptionEl = document.getElementById("info-description");
const sourceLinkEl = document.getElementById("info-source");
const touchZone = document.getElementById("touch-zone");
const seekHintLeft = document.getElementById("seek-hint-left");
const seekHintRight = document.getElementById("seek-hint-right");
const fsToggleBtn = document.getElementById("fs-toggle");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomResetBtn = document.getElementById("zoom-reset-btn");
const zoomValueEl = document.getElementById("zoom-value");
const zoomIndicatorEl = document.getElementById("zoom-indicator");
const playBtn = document.getElementById("play-btn");
const muteBtn = document.getElementById("mute-btn");
const timelineEl = document.getElementById("timeline");
const timeCurrentEl = document.getElementById("time-current");
const timeTotalEl = document.getElementById("time-total");
const playerControlsEl = document.getElementById("player-controls");
const controlsStackEl = document.getElementById("controls-stack");
const backLinkEl = document.getElementById("back-link");
const likeBtnEl = document.getElementById("like-btn");
const playlistEl = document.getElementById("info-playlist");
const playlistPrevEl = document.getElementById("playlist-prev");
const playlistNextEl = document.getElementById("playlist-next");
const playlistPositionEl = document.getElementById("playlist-position");
const btnPlayFolder = document.getElementById("btn-play-folder");
const btnRepeat = document.getElementById("btn-repeat");
const btnMarkA = document.getElementById("btn-mark-a");
const btnMarkB = document.getElementById("btn-mark-b");
const markDotA = document.getElementById("mark-dot-a");
const markDotB = document.getElementById("mark-dot-b");

// --- Заметки ---
const notesSectionEl = document.getElementById("notes-section");
const notesListEl = document.getElementById("notes-list");
const notesEmptyEl = document.getElementById("notes-empty");
const notesCountEl = document.getElementById("notes-count");
const addNoteBtnEl = document.getElementById("add-note-btn");

const NOTE_PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
const NOTE_TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;

const PLAYBACK_OPTS_KEY = "spring_library_playback_opts";
const ACTIVE_CLASS = "ctrl-btn--active";

function loadPlaybackOpts() {
    try {
        const raw = localStorage.getItem(PLAYBACK_OPTS_KEY);
        if (!raw) return { playFolder: false, repeat: false };
        const parsed = JSON.parse(raw);
        return {
            playFolder: !!parsed.playFolder,
            repeat: !!parsed.repeat,
        };
    } catch {
        return { playFolder: false, repeat: false };
    }
}

function savePlaybackOpts() {
    try {
        localStorage.setItem(PLAYBACK_OPTS_KEY, JSON.stringify({
            playFolder: btnPlayFolder.classList.contains(ACTIVE_CLASS),
            repeat: btnRepeat.classList.contains(ACTIVE_CLASS),
        }));
    } catch {
        // localStorage заблокирован — игнорируем
    }
}

let videoId = new URLSearchParams(window.location.search).get("id");

const controlsStackOriginalParent = controlsStackEl.parentElement;
const controlsStackOriginalNextSibling = controlsStackEl.nextElementSibling;

let zoom = 1;
let panX = 0;
let panY = 0;
let hideControlsTimer = null;

// Плейлист текущей папки: [{id, title, ...}, ...] отсортирован по title.
let playlist = [];
let currentIndex = -1;
let pendingPlaybackRate = null;
let pendingAutoplay = false;

// A-B loop: метки отрезка. null = метка не задана. Сохраняются только в рамках сессии.
let markA = null;
let markB = null;

// Заметки: активная подписка onSnapshot и последний снимок списка.
// При смене видео в плейлисте подписка пере-устанавливается на новый videoId.
let unsubscribeNotes = null;
let currentNotes = [];

async function init() {
    if (!videoId) {
        showError("В URL не указан id видео");
        return;
    }

    try {
        playerContent.hidden = false;
        setupPlayer();
        setupSpeedControls();
        setupSeekControls();
        setupFullscreen();
        setupZoom();
        setupInteractions();
        setupPlaybackOptions();
        setupLikeButton();
        setupAddNoteButton();

        await loadVideo(videoId, false);

        window.addEventListener("popstate", onPopState);
    } catch (err) {
        console.error(err);
        showError(`Ошибка загрузки: ${err.message}`);
    }
}

function setupPlaybackOptions() {
    const opts = loadPlaybackOpts();
    btnPlayFolder.classList.toggle(ACTIVE_CLASS, opts.playFolder);
    btnRepeat.classList.toggle(ACTIVE_CLASS, opts.repeat);

    btnPlayFolder.addEventListener("click", () => {
        btnPlayFolder.classList.toggle(ACTIVE_CLASS);
        savePlaybackOpts();
    });
    btnRepeat.addEventListener("click", () => {
        const wasActive = btnRepeat.classList.contains(ACTIVE_CLASS);
        btnRepeat.classList.toggle(ACTIVE_CLASS);
        // Если кнопка только что погасла И были метки — сбросить метки
        if (wasActive && (markA !== null || markB !== null)) {
            markA = null;
            markB = null;
            updateMarksUI();
        }
        savePlaybackOpts();
    });

    btnMarkA.addEventListener("click", () => setMark("A"));
    btnMarkB.addEventListener("click", () => setMark("B"));
}

// --- Лайк --------------------------------------------------------------
// Состояние сердечка обновляется в двух случаях:
//   1) при смене видео (loadVideo) — у нового видео свое состояние лайка
//   2) при изменении профиля через subscribeToProfile — тот же видео-id,
//      но лайк мог быть переключен (например, из другой вкладки)

function setupLikeButton() {
    likeBtnEl.addEventListener("click", async () => {
        if (!videoId) return;
        likeBtnEl.disabled = true;
        try {
            await toggleVideoLike(videoId);
        } catch (err) {
            console.error("Ошибка лайка:", err);
            alert(`Не удалось обновить лайк: ${err.message}`);
        } finally {
            likeBtnEl.disabled = false;
        }
    });

    // Реактивность — Firestore SDK обновит локальный кеш и onSnapshot
    // стрельнет подпиской профиля. UI отреагирует автоматически.
    subscribeToProfile(updateLikeButton);
}

function updateLikeButton() {
    if (!videoId) return;
    const liked = isVideoLiked(videoId);
    likeBtnEl.classList.toggle("like-btn--active", liked);
    const newTitle = liked ? "Убрать лайк" : "Лайк";
    likeBtnEl.title = newTitle;
    likeBtnEl.setAttribute("aria-label", newTitle);
}

function setMark(which) {
    const t = videoEl.currentTime || 0;
    if (which === "A") markA = t;
    else markB = t;
    updateMarksUI();
}

// Перерисовка UI меток: подсветка кнопок A/B, засечки на таймлайне, градиент отрезка,
// автоактивация "Повтор" и скрытие "Подряд" при активном отрезке.
function updateMarksUI() {
    btnMarkA.classList.toggle(ACTIVE_CLASS, markA !== null);
    btnMarkB.classList.toggle(ACTIVE_CLASS, markB !== null);

    const bothSet = markA !== null && markB !== null;
    const duration = videoEl.duration || 0;

    // Засечки в позициях A и B (видны как только метка задана, не дожидаясь второй)
    updateMarkDot(markDotA, markA, duration);
    updateMarkDot(markDotB, markB, duration);

    // Подсветка отрезка — только когда заданы обе метки
    if (bothSet && duration > 0) {
        const start = Math.min(markA, markB);
        const end = Math.max(markA, markB);
        timelineEl.style.setProperty("--mark-start-pct", `${(start / duration) * 100}%`);
        timelineEl.style.setProperty("--mark-end-pct", `${(end / duration) * 100}%`);
    } else {
        timelineEl.style.setProperty("--mark-start-pct", "0%");
        timelineEl.style.setProperty("--mark-end-pct", "0%");
    }

    if (bothSet) {
        // Автоактивация "Повтор" — только если еще не горит, чтобы не дергать savePlaybackOpts впустую
        if (!btnRepeat.classList.contains(ACTIVE_CLASS)) {
            btnRepeat.classList.add(ACTIVE_CLASS);
            savePlaybackOpts();
        }
        // Пока есть отрезок — "Подряд" физически не сработает, прячем
        btnPlayFolder.hidden = true;
    } else {
        // Меток нет — возвращаем "Подряд" если видео в папке
        const inFolder = playlist.length >= 2 && currentIndex >= 0;
        btnPlayFolder.hidden = !inFolder;
    }
}

function updateMarkDot(dotEl, markValue, duration) {
    if (markValue !== null && duration > 0) {
        dotEl.style.left = `${(markValue / duration) * 100}%`;
        dotEl.classList.remove("mark-dot--hidden");
    } else {
        dotEl.classList.add("mark-dot--hidden");
    }
}

// --- Заметки -----------------------------------------------------------
// Подписка через onSnapshot живет на протяжении страницы. При смене видео
// в плейлисте старая подписка отменяется внутри subscribeToNotes (модуль
// держит ровно одну активную подписку).

function setupAddNoteButton() {
    addNoteBtnEl.addEventListener("click", () => {
        if (!videoId) return;
        // Пауза видео — момент не уезжает пока пишется текст
        try { videoEl.pause(); } catch (_e) { /* ignore */ }
        const time = Math.max(0, videoEl.currentTime || 0);
        openNoteEditor({ videoId, time });
    });
}

// Аналог formatDuration для таймстемпов заметок, выровнен по виду с заголовком
// модала редактора. Возвращает "1:23" или "1:23:45".
function formatNoteTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function seekTo(seconds) {
    const target = Math.max(0, Number(seconds) || 0);
    // Если метаданные еще не подтянулись — отложим до loadedmetadata.
    // На практике юзер кликает по таймстемпу когда видео уже играло,
    // но если кликнул прямо после смены видео в плейлисте — защита нужна.
    if (videoEl.readyState < 1) {
        const onReady = () => {
            const dur = videoEl.duration || 0;
            videoEl.currentTime = dur > 0 ? Math.min(target, dur) : target;
            videoEl.removeEventListener("loadedmetadata", onReady);
        };
        videoEl.addEventListener("loadedmetadata", onReady);
        return;
    }
    const dur = videoEl.duration || 0;
    videoEl.currentTime = dur > 0 ? Math.min(target, dur) : target;
}

function renderNotes() {
    notesSectionEl.hidden = false;

    if (currentNotes.length === 0) {
        notesListEl.replaceChildren();
        notesEmptyEl.hidden = false;
        notesCountEl.textContent = "";
        renderNoteMarks();
        return;
    }

    notesEmptyEl.hidden = true;
    notesCountEl.textContent = ` · ${currentNotes.length}`;
    notesListEl.replaceChildren(...currentNotes.map(createNoteItem));
    renderNoteMarks();
}

// Желтые точки на таймлайне в позициях заметок.
// При hover на точку подсвечивается соответствующая заметка в списке —
// чтобы сразу было видно, какая заметка стоит на этом моменте видео.
// Пере-рендериваются при изменении списка и при loadedmetadata (когда становится
// известна duration). Обработчики каждый раз вешаются на новые элементы — это ок,
// потому что точки тоже создаются заново.
function renderNoteMarks() {
    const wrap = document.querySelector(".pc-timeline-wrap");
    if (!wrap) return;

    // Удаляем старые точки
    wrap.querySelectorAll(".note-mark").forEach((el) => el.remove());

    const duration = videoEl.duration || 0;
    if (duration <= 0 || currentNotes.length === 0) return;

    for (const note of currentNotes) {
        const t = Number(note.time) || 0;
        if (!isFinite(t) || t < 0 || t > duration) continue;
        const dot = document.createElement("div");
        dot.className = "note-mark";
        dot.dataset.noteId = note.id;
        dot.style.left = `${(t / duration) * 100}%`;
        if (note.text) dot.title = note.text;

        dot.addEventListener("mouseenter", () => highlightNoteInList(note.id, true));
        dot.addEventListener("mouseleave", () => highlightNoteInList(note.id, false));

        wrap.appendChild(dot);
    }
}

function highlightNoteInList(noteId, on) {
    const item = notesListEl.querySelector(`.note-item[data-note-id="${noteId}"]`);
    if (!item) return;
    item.classList.toggle("note-item--highlight", on);
}

function createNoteItem(note) {
    const li = document.createElement("li");
    li.className = "note-item";
    li.dataset.noteId = note.id;

    const timeBtn = document.createElement("button");
    timeBtn.type = "button";
    timeBtn.className = "note-item__time";
    timeBtn.textContent = formatNoteTime(note.time);
    timeBtn.title = "Перейти к моменту";
    timeBtn.addEventListener("click", () => seekTo(note.time));

    const textEl = document.createElement("div");
    textEl.className = "note-item__text";
    textEl.textContent = note.text || "";

    const actions = document.createElement("div");
    actions.className = "note-item__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "note-item__action";
    editBtn.title = "Редактировать";
    editBtn.setAttribute("aria-label", "Редактировать заметку");
    editBtn.innerHTML = NOTE_PENCIL_SVG;
    editBtn.addEventListener("click", () => {
        openNoteEditor({
            videoId,
            time: note.time,
            note: { id: note.id, text: note.text, time: note.time },
        });
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "note-item__action";
    delBtn.title = "Удалить";
    delBtn.setAttribute("aria-label", "Удалить заметку");
    delBtn.innerHTML = NOTE_TRASH_SVG;
    delBtn.addEventListener("click", async () => {
        if (!confirm("Удалить заметку?")) return;
        try {
            await deleteNote(note.id);
        } catch (err) {
            console.error("[watch] delete note failed:", err);
            alert(err?.message || "Не удалось удалить заметку");
        }
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(timeBtn);
    li.appendChild(textEl);
    li.appendChild(actions);
    return li;
}

async function loadVideo(id, autoplay) {
    videoId = id;

    // Метки живут только в рамках одного видео — при смене сбрасываем
    markA = null;
    markB = null;

    // Заметки: пере-подписываемся на новый videoId. subscribeToNotes сам
    // отменит предыдущую подписку. До прихода первого снимка показываем
    // пустой список — это нормально, длится миллисекунды.
    currentNotes = [];
    renderNotes();
    unsubscribeNotes = subscribeToNotes(id, (list) => {
        currentNotes = list;
        renderNotes();
    });

    // Сразу запускаем стрим — endpoint /stream/{id} в бэке публичный,
    // ему не нужен auth-токен. Метаданные грузятся параллельно через fetchOne,
    // что заметно ускоряет старт воспроизведения.
    pendingPlaybackRate = videoEl.playbackRate || 1;
    pendingAutoplay = !!autoplay;
    videoEl.src = videosApi.streamUrl(id);
    videoEl.load();

    // Параллельно — метаданные для UI (title, meta, folder, плейлист).
    const video = await videosApi.fetchOne(id);
    if (!video) {
        showError("Видео не найдено");
        return;
    }

    renderInfo(video);
    updateLikeButton();

    document.title = `${video.title || "Без названия"} — Spring Library`;

    // Плейлист: только если видео в папке
    if (video.folder) {
        try {
            playlist = await videosApi.fetchInFolder(video.folder);
            currentIndex = playlist.findIndex((v) => v.id === id);
        } catch (e) {
            console.warn("Не удалось загрузить плейлист:", e);
            playlist = [];
            currentIndex = -1;
        }
    } else {
        playlist = [];
        currentIndex = -1;
    }
    renderPlaylistNav();
    updateMarksUI();
}

function navigateToVideo(id, autoplay) {
    history.pushState({}, "", `watch.html?id=${encodeURIComponent(id)}`);
    loadVideo(id, autoplay);
}

function onPopState() {
    const newId = new URLSearchParams(window.location.search).get("id");
    if (newId && newId !== videoId) {
        loadVideo(newId, false);
    }
}

function renderPlaylistNav() {
    const inFolder = playlist.length >= 2 && currentIndex >= 0;

    // Кнопка "Подряд" — только если видео в папке. "Повтор" видна всегда.
    btnPlayFolder.hidden = !inFolder;

    if (!inFolder) {
        playlistEl.hidden = true;
        return;
    }

    const prev = currentIndex > 0 ? playlist[currentIndex - 1] : null;
    const next = currentIndex < playlist.length - 1 ? playlist[currentIndex + 1] : null;

    if (prev) {
        playlistPrevEl.textContent = `← ${prev.title || "(без названия)"}`;
        playlistPrevEl.href = `watch.html?id=${encodeURIComponent(prev.id)}`;
        playlistPrevEl.onclick = (e) => {
            e.preventDefault();
            navigateToVideo(prev.id, !videoEl.paused);
        };
        playlistPrevEl.hidden = false;
    } else {
        playlistPrevEl.hidden = true;
    }

    if (next) {
        playlistNextEl.textContent = `${next.title || "(без названия)"} →`;
        playlistNextEl.href = `watch.html?id=${encodeURIComponent(next.id)}`;
        playlistNextEl.onclick = (e) => {
            e.preventDefault();
            navigateToVideo(next.id, !videoEl.paused);
        };
        playlistNextEl.hidden = false;
    } else {
        playlistNextEl.hidden = true;
    }

    playlistPositionEl.textContent = `${currentIndex + 1} из ${playlist.length}`;
    playlistEl.hidden = false;
}

function renderInfo(video) {
    titleEl.textContent = video.title || "(без названия)";

    // meta строится через DOM, потому что для папки нужна SVG-иконка
    // (textContent с эмодзи отказались — нужен единый цвет с эмблемы школы).
    metaEl.replaceChildren();
    const textParts = [];
    if (video.duration_sec != null) textParts.push(formatDuration(video.duration_sec));
    if (video.file_size_bytes) textParts.push(formatBytes(video.file_size_bytes));
    if (video.recorded_at) textParts.push(`Запись: ${formatDate(video.recorded_at)}`);
    if (textParts.length > 0) {
        metaEl.appendChild(document.createTextNode(textParts.join(" · ")));
    }
    if (video.folder) {
        if (textParts.length > 0) {
            metaEl.appendChild(document.createTextNode(" · "));
        }
        metaEl.appendChild(createFolderIcon());
        metaEl.appendChild(document.createTextNode(video.folder));
    }

    if (video.source_url) {
        sourceLinkEl.href = video.source_url;
        sourceLinkEl.textContent = getSourceLabel(video.source_url);
        sourceLinkEl.hidden = false;
    } else {
        sourceLinkEl.hidden = true;
    }

    descriptionEl.textContent = video.description || "";

    if (video.folder) {
        backLinkEl.href = `folder.html?name=${encodeURIComponent(video.folder)}`;
        backLinkEl.textContent = `← ${video.folder}`;
    } else {
        backLinkEl.href = "index.html#videos";
        backLinkEl.textContent = "← Видео";
    }
}

function setupPlayer() {
    playBtn.addEventListener("click", togglePlay);
    muteBtn.addEventListener("click", toggleMute);

    videoEl.addEventListener("play", () => {
        playBtn.textContent = "⏸";
        if (isFullscreen()) scheduleHideControls();
    });
    videoEl.addEventListener("pause", () => {
        playBtn.textContent = "▶";
        showControls();
        clearTimeout(hideControlsTimer);
    });

    videoEl.addEventListener("volumechange", () => {
        muteBtn.textContent = videoEl.muted ? "🔇" : "🔊";
    });

    videoEl.addEventListener("loadedmetadata", () => {
        timelineEl.max = videoEl.duration || 0;
        timeTotalEl.textContent = formatDuration(Math.floor(videoEl.duration || 0));
        // Восстанавливаем скорость воспроизведения с предыдущего видео
        if (pendingPlaybackRate !== null) {
            videoEl.playbackRate = pendingPlaybackRate;
            applySpeedUI(pendingPlaybackRate);
            pendingPlaybackRate = null;
        }
        if (pendingAutoplay) {
            pendingAutoplay = false;
            videoEl.play().catch(() => {});
        }
        // Пересчет градиента таймлайна с актуальной duration
        updateMarksUI();
        // И точки заметок — раньше duration могла быть 0, теперь есть
        renderNoteMarks();
    });

    videoEl.addEventListener("timeupdate", () => {
        timelineEl.value = videoEl.currentTime;
        timeCurrentEl.textContent = formatDuration(Math.floor(videoEl.currentTime));

        // A-B loop: при достижении конца отрезка прыгаем в начало.
        // Мягкая клетка — seek вне отрезка разрешен, ловим только на end.
        if (markA !== null && markB !== null) {
            const start = Math.min(markA, markB);
            const end = Math.max(markA, markB);
            if (videoEl.currentTime >= end) {
                videoEl.currentTime = start;
            }
        }
    });

    timelineEl.addEventListener("input", () => {
        videoEl.currentTime = parseFloat(timelineEl.value);
    });

    // Автопереход по окончании. Учитывает кнопки "Подряд" и "Повтор".
    videoEl.addEventListener("ended", () => {
        const playFolder = btnPlayFolder.classList.contains(ACTIVE_CLASS);
        const repeat = btnRepeat.classList.contains(ACTIVE_CLASS);
        const inFolder = playlist.length >= 2 && currentIndex >= 0;

        // Идём в папку: есть следующее → переходим
        if (playFolder && inFolder && currentIndex < playlist.length - 1) {
            navigateToVideo(playlist[currentIndex + 1].id, true);
            return;
        }
        // Идём в папку: достигли конца + повтор → возвращаемся к первому
        if (playFolder && inFolder && repeat && currentIndex === playlist.length - 1) {
            navigateToVideo(playlist[0].id, true);
            return;
        }
        // Не идём в папку, но повтор включён → крутим текущее видео
        if (!playFolder && repeat) {
            videoEl.currentTime = 0;
            videoEl.play().catch(() => {});
            return;
        }
        // Иначе — стоп
    });
}

function togglePlay() {
    if (videoEl.paused) videoEl.play();
    else videoEl.pause();
}

function toggleMute() {
    videoEl.muted = !videoEl.muted;
}

function setupSpeedControls() {
    const buttons = document.querySelectorAll(".ctrl-btn[data-speed]");
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const speed = parseFloat(btn.dataset.speed);
            videoEl.playbackRate = speed;
            applySpeedUI(speed);
        });
    });
}

function applySpeedUI(rate) {
    document.querySelectorAll(".ctrl-btn[data-speed]").forEach((b) => {
        b.classList.toggle("ctrl-btn--active", parseFloat(b.dataset.speed) === rate);
    });
}

function setupSeekControls() {
    document.addEventListener("keydown", (event) => {
        if (event.target.matches("input, textarea")) return;
        if (event.code === "ArrowLeft") {
            event.preventDefault();
            seek(-SEEK_STEP);
            showSeekHint("left");
        } else if (event.code === "ArrowRight") {
            event.preventDefault();
            seek(SEEK_STEP);
            showSeekHint("right");
        } else if (event.code === "Escape" && isFullscreen()) {
            exitFullscreen();
        } else if (event.code === "KeyF") {
            toggleFullscreen();
        } else if (event.code === "Space") {
            event.preventDefault();
            togglePlay();
        } else if (event.code === "KeyM") {
            toggleMute();
        } else if (event.code === "KeyA") {
            setMark("A");
        } else if (event.code === "KeyB") {
            setMark("B");
        }
    });
}

function seek(delta) {
    const duration = videoEl.duration || 0;
    videoEl.currentTime = Math.max(0, Math.min(duration, videoEl.currentTime + delta));
}

function showSeekHint(side) {
    const hint = side === "left" ? seekHintLeft : seekHintRight;
    hint.classList.add("seek-hint--show");
    clearTimeout(hint._timer);
    hint._timer = setTimeout(() => hint.classList.remove("seek-hint--show"), 500);
}

function setupFullscreen() {
    fsToggleBtn.addEventListener("click", toggleFullscreen);
}

function isFullscreen() {
    return videoContainer.classList.contains("video-container--fullscreen");
}

function enterFullscreen() {
    videoContainer.appendChild(controlsStackEl);
    videoContainer.classList.add("video-container--fullscreen");
    document.body.style.overflow = "hidden";
    fsToggleBtn.textContent = "⛶ Свернуть";
    showControls();
    if (!videoEl.paused) scheduleHideControls();
}

function exitFullscreen() {
    videoContainer.classList.remove("video-container--fullscreen");
    document.body.style.overflow = "";
    fsToggleBtn.textContent = "⛶ Развернуть";

    if (controlsStackOriginalNextSibling && controlsStackOriginalNextSibling.parentElement === controlsStackOriginalParent) {
        controlsStackOriginalParent.insertBefore(controlsStackEl, controlsStackOriginalNextSibling);
    } else {
        controlsStackOriginalParent.appendChild(controlsStackEl);
    }

    showControls();
    clearTimeout(hideControlsTimer);
}

function toggleFullscreen() {
    isFullscreen() ? exitFullscreen() : enterFullscreen();
}

function showControls() {
    controlsStackEl.classList.remove("controls--hidden");
    playerControlsEl.classList.remove("controls--hidden");
    fsToggleBtn.classList.remove("controls--hidden");
}

function hideControls() {
    if (!isFullscreen()) return;
    if (videoEl.paused) return;
    controlsStackEl.classList.add("controls--hidden");
    playerControlsEl.classList.add("controls--hidden");
    fsToggleBtn.classList.add("controls--hidden");
}

function scheduleHideControls() {
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(hideControls, CONTROLS_HIDE_DELAY);
}

function onUserActivity() {
    showControls();
    if (isFullscreen() && !videoEl.paused) {
        scheduleHideControls();
    }
}

function setupZoom() {
    zoomInBtn.addEventListener("click", () => setZoom(zoom + ZOOM_STEP));
    zoomOutBtn.addEventListener("click", () => setZoom(zoom - ZOOM_STEP));
    zoomResetBtn.addEventListener("click", () => setZoom(1));
}

function setZoom(newZoom) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    if (zoom === 1) {
        panX = 0;
        panY = 0;
    } else {
        clampPan();
    }
    applyTransform();
    updateZoomUI();
}

function clampPan() {
    const w = videoEl.clientWidth;
    const h = videoEl.clientHeight;
    const maxX = (w * (zoom - 1)) / (2 * zoom);
    const maxY = (h * (zoom - 1)) / (2 * zoom);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
}

function applyTransform() {
    videoEl.style.transform = `scale(${zoom}) translate(${panX}px, ${panY}px)`;
    if (zoom > 1) {
        touchZone.classList.add("touch-zone--zoomed");
    } else {
        touchZone.classList.remove("touch-zone--zoomed");
    }
}

function updateZoomUI() {
    const text = `${zoom.toFixed(1)}x`;
    zoomValueEl.textContent = text;
    zoomIndicatorEl.textContent = text;
    if (zoom > 1) {
        zoomIndicatorEl.classList.add("zoom-indicator--show");
    } else {
        zoomIndicatorEl.classList.remove("zoom-indicator--show");
    }
}

function setupInteractions() {
    videoContainer.addEventListener("mousemove", onUserActivity);
    videoContainer.addEventListener("touchstart", onUserActivity, { passive: true });

    let mouseClickTimer = null;
    let mouseDownPos = null;
    let mousePanStart = null;
    let mouseDragging = false;

    touchZone.addEventListener("mousedown", (event) => {
        mouseDownPos = { x: event.clientX, y: event.clientY };
        mousePanStart = { x: panX, y: panY };
        mouseDragging = false;
    });

    document.addEventListener("mousemove", (event) => {
        if (!mouseDownPos) return;
        const dx = event.clientX - mouseDownPos.x;
        const dy = event.clientY - mouseDownPos.y;
        if (!mouseDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD && zoom > 1) {
            mouseDragging = true;
        }
        if (mouseDragging) {
            panX = mousePanStart.x + dx / zoom;
            panY = mousePanStart.y + dy / zoom;
            clampPan();
            applyTransform();
        }
    });

    document.addEventListener("mouseup", () => {
        mouseDownPos = null;
        if (mouseDragging) {
            mouseDragging = false;
            touchZone.addEventListener("click", (e) => e.stopPropagation(), { once: true, capture: true });
        }
    });

    touchZone.addEventListener("click", () => {
        if (mouseClickTimer) {
            clearTimeout(mouseClickTimer);
            mouseClickTimer = null;
            return;
        }
        mouseClickTimer = setTimeout(() => {
            togglePlay();
            mouseClickTimer = null;
        }, DOUBLE_CLICK_DELAY);
    });

    touchZone.addEventListener("dblclick", (event) => {
        event.preventDefault();
        if (mouseClickTimer) {
            clearTimeout(mouseClickTimer);
            mouseClickTimer = null;
        }
        if (zoom > 1) {
            setZoom(1);
        } else {
            const rect = touchZone.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const isLeft = x < rect.width / 2;
            seek(isLeft ? -SEEK_STEP : SEEK_STEP);
            showSeekHint(isLeft ? "left" : "right");
        }
    });

    let touchStartPos = null;
    let touchPanStart = null;
    let touchDragging = false;
    let pinchStartDistance = null;
    let pinchStartZoom = 1;
    let lastTapTime = 0;

    touchZone.addEventListener("touchstart", (event) => {
        if (event.touches.length === 2) {
            pinchStartDistance = getTouchDistance(event.touches);
            pinchStartZoom = zoom;
            touchStartPos = null;
        } else if (event.touches.length === 1) {
            const t = event.touches[0];
            touchStartPos = { x: t.clientX, y: t.clientY };
            touchPanStart = { x: panX, y: panY };
            touchDragging = false;
        }
    });

    touchZone.addEventListener("touchmove", (event) => {
        if (event.touches.length === 2 && pinchStartDistance !== null) {
            event.preventDefault();
            const dist = getTouchDistance(event.touches);
            setZoom(pinchStartZoom * (dist / pinchStartDistance));
        } else if (event.touches.length === 1 && touchStartPos !== null) {
            const t = event.touches[0];
            const dx = t.clientX - touchStartPos.x;
            const dy = t.clientY - touchStartPos.y;
            if (!touchDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD && zoom > 1) {
                touchDragging = true;
            }
            if (touchDragging) {
                event.preventDefault();
                panX = touchPanStart.x + dx / zoom;
                panY = touchPanStart.y + dy / zoom;
                clampPan();
                applyTransform();
            }
        }
    });

    touchZone.addEventListener("touchend", (event) => {
        if (event.touches.length === 0) {
            pinchStartDistance = null;
            if (touchStartPos !== null && !touchDragging) {
                const now = Date.now();
                const rect = touchZone.getBoundingClientRect();
                const tapX = (event.changedTouches[0]?.clientX || 0) - rect.left;

                if (now - lastTapTime < DOUBLE_CLICK_DELAY) {
                    if (zoom > 1) {
                        setZoom(1);
                    } else {
                        const isLeft = tapX < rect.width / 2;
                        seek(isLeft ? -SEEK_STEP : SEEK_STEP);
                        showSeekHint(isLeft ? "left" : "right");
                    }
                    lastTapTime = 0;
                } else {
                    lastTapTime = now;
                    setTimeout(() => {
                        if (lastTapTime === now) {
                            togglePlay();
                            lastTapTime = 0;
                        }
                    }, DOUBLE_CLICK_DELAY);
                }
            }
            touchStartPos = null;
            touchDragging = false;
        }
    });
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
}

// Ждем авторизованного пользователя — auth-overlay покрывает страницу пока нет user.
let didInit = false;
subscribeToAuth((user) => {
    if (user && !didInit) {
        didInit = true;
        init();
    }
});
