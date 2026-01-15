# Site Hack

Безопасный сайт для авторизации через Discord и управления кейсами без Express.

## Запуск

1. Установите зависимости:

```bash
npm install
```

2. Заполните `.env` по примеру `.env.example` (файл читается автоматически через `dotenv`). Для локального HTTP используйте `BASE_URL=http://localhost:80`, `COOKIE_SECURE=false` и добавьте `ALLOWED_ORIGINS=http://localhost:80`. Убедитесь, что `BASE_URL` содержит протокол (`http://` или `https://`), а `MONGODB_URI` указывает на базу (например, `/sitehack`).
3. Запустите сервер:

```bash
npm start
```

## Безопасность

- OAuth только серверный flow с state, тайм-аутом и строгим redirect URI.
- Access JWT живет 10 минут, refresh токен хранится только в базе как хэш.
- Refresh rotation с отзывом при повторном использовании.
- CSRF + проверка Origin для POST/PUT/DELETE.
- Отдельные rate limits для IP, пользователя, логина и write-запросов.
- HTTP заголовки безопасности и HTTPS-only cookies.
