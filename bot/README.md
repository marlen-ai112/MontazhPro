# Личный бот-помощник (Telegram + Claude)

Вы пишете боту, что нужно сделать, он отвечает планом через Claude.

## Настройка
1. Создайте бота у @BotFather и возьмите токен.
2. Запустите бота без `ALLOWED_CHAT_IDS`, напишите ему `/start`: он покажет ваш chat id.
3. Добавьте переменные в `.env` или окружение:
   - `TELEGRAM_BOT_TOKEN`: токен бота
   - `ANTHROPIC_API_KEY`: ключ Anthropic
   - `ALLOWED_CHAT_IDS`: ваш chat id (можно несколько через запятую)
   - `AGENT_MODEL`: необязательно, по умолчанию `claude-sonnet-5-5`

## Запуск
```bash
npm run bot
```

## Команды
- `/start`: приветствие и ваш chat id
- `/reset`: очистить историю диалога

## Подключение инструментов
В `bot/index.js` вызовите `registerTool(definition, run)` до запуска. `definition` — описание в формате Anthropic tools (`name`, `description`, `input_schema`), `run` — async-функция, возвращающая строку.
