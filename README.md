# spring-library

PWA-библиотека видео по Вин Чун: список, папки, плеер с заметками-таймстемпами.
Приложение полностью локальное и работает без интернета. Бэкенд — отдельный
репозиторий `spring-library-api`, он же раздает эти статические файлы.

## Структура

```
spring-library/
├── index.html             # главная: видео и папки
├── folder.html            # содержимое папки
├── watch.html             # плеер с заметками
├── admin.html             # загрузка видео (файл или ссылка)
├── fonts/                 # локальный шрифт Onest (offline, без CDN)
├── css/
│   ├── fonts.css          # @font-face Onest
│   ├── theme.css, cards.css, modal.css, sort.css, notes.css, bottom-nav.css
└── js/
    ├── config.js          # API_BASE_URL = origin (бэк раздает и фронт, и API)
    ├── firebase.js        # историческое имя; Firebase удален. Локальная заглушка
    │                      #   «авторизации» (один пользователь) + лайки через fetch
    ├── data.js            # видео: fetch + наблюдаемый слой (вместо onSnapshot)
    ├── notes.js           # заметки: fetch + наблюдаемый слой
    └── ui.js, index.js, folder.js, watch.js, editor.js, folder-editor.js,
        note-editor.js, header.js, sort-controls.js, bottom-nav.js
```

## Запуск

Отдельный сервер для фронта больше не нужен — статику раздает бэкенд на том же
порту, что и API. Запусти бэк (см. `spring-library-api/README.md`) и открой
`http://localhost:8000`. Проще всего — двойной клик по `start.command` (macOS)
или `start.bat` (Windows) в папке `spring-library-api`: поднимется сервер и
откроется окно Chrome в режиме приложения.

## Что изменилось при переходе на локальную версию

- Firebase (Auth + Firestore) удален. Метаданные, лайки и заметки теперь в
  локальном SQLite на бэке (`spring-library-api/library.db`).
- Вход/регистрация убраны: приложение однопользовательское.
- Шрифт Onest подключается локально из `fonts/` — интернет не требуется.
- `firebase.js` оставлен под прежним именем намеренно (минимальный дифф);
  внутри — локальная заглушка, Firebase там нет.

## Раздача друзьям

Каждый получает свою независимую копию (свой `library.db`, свои видео). Общего
сервера нет — это сделано осознанно. Поле `storage` у видео заложено как шов под
возможное удаленное хранилище в будущем.
