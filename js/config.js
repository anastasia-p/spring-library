// Конфиг фронта Spring Library.
// Бэк (FastAPI) раздает и статику фронта, и API с одного origin,
// поэтому API_BASE_URL = текущий origin. Никакого Firebase больше нет.

export const API_BASE_URL = window.location.origin;
