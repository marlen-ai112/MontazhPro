# Коннектор Playwright (Python) для zakup.sk.kz

`zakup_sk.py` открывает страницу поиска закупок в настоящем браузере и забирает список объявлений из ответа, который портал сам запрашивает у своего API. Фильтры: предмет «товар», способ «запрос ценовых предложений», опубликованные, сумма до `--price`.

Скрипт делает один обычный запрос за запуск, ничего не подделывает и не обходит защиту. Если портал отвечает ошибкой (например, 418), скрипт возвращает код ошибки и не повторяет запрос.

## Установка
```bash
pip install -r tenders/requirements.txt
playwright install chromium
```

## Запуск
```bash
python tenders/zakup_sk.py                          # до 5 000 000 тг
python tenders/zakup_sk.py --price 3000000 --max-items 10
python tenders/zakup_sk.py --headed                 # показать окно браузера
```
Результат: JSON в stdout (`ok`, `status`, `items`, `error`). Код возврата 0 при успехе, 2 при ошибке.

Поля объявления: `number`, `nameRu`, `tenderType`, `sumTruNoNds`, `acceptanceBeginDateTime`, `acceptanceEndDateTime`, `advertStatus`.

## В Telegram-боте
`bot/index.js` уже регистрирует инструмент `search_tenders`, который запускает этот скрипт. Переменные: `PYTHON` (команда Python, по умолчанию `python` на Windows и `python3` в остальных системах), `TENDERS_HEADED=1` (показывать окно браузера).
