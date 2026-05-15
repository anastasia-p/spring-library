# spring-library

PWA-фронтенд для библиотеки видео по Вин Чун. Бэкенд — отдельный репо `spring-library-api`.

## Структура

```
spring-library/
├── admin.html              # страница загрузки видео
├── index.html              # главная (со списком видео — следующий этап)
├── js/
│   ├── config.js           # API URL + Firebase config
│   └── admin.js            # логика страницы загрузки
└── README.md
```

## Запуск локально

Фронт — это просто статические файлы, нужно их раздать любым HTTP-сервером.

Сначала убедись, что бэк (`spring-library-api`) запущен на `http://127.0.0.1:8000`.

В новом терминале (отдельном от бэка), из папки `spring-library`:

```bash
cd /Users/anastasiaponomareva/Documents/GitHub/spring-library
python3 -m http.server 8080
```

Открой в браузере `http://localhost:8080/admin.html`.

## Использование admin-страницы

1. Нажми "Выбрать файл" — выбери видео-файл (.mp4, .mov, .mkv, .avi, .webm, .m4v).
2. Заполни название (обязательно), описание и дату записи — опционально.
3. Нажми "Загрузить".

Под формой появится статус: "Загружаем…" → "Загружено" (с id и длительностью).

Видео уйдёт в `spring-library-api/videos/library/{id}.{ext}`, метаданные — в Firestore.

## Деплой

GitHub Pages будет настроен позже. Сейчас работаем локально.
