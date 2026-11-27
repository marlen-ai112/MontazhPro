#!/usr/bin/env python3
"""Коннектор Playwright (Python) для портала закупок zakup.sk.kz.

Открывает страницу поиска в настоящем браузере и забирает список объявлений
из ответа, который портал сам запрашивает у своего API. Это обычная загрузка
страницы, как у пользователя: без подделки заголовков, без обхода защиты,
один запрос за запуск. Если портал отвечает ошибкой (например, 418), скрипт
честно сообщает код и не пытается повторять запрос.

Использование:
    python tenders/zakup_sk.py                      # до 5 000 000 тг, запрос ценовых предложений, товары
    python tenders/zakup_sk.py --min-price 1500000 --price 5000000 --pages 6 --max-items 50
    python tenders/zakup_sk.py --price 3000000 --max-items 10
    python tenders/zakup_sk.py --headed             # показать окно браузера (если headless блокируют)

Результат: JSON в stdout. Код возврата 0 при успехе, 2 при ошибке портала/сети.

Установка:
    pip install -r tenders/requirements.txt
    playwright install chromium
"""
import argparse
import json
import os
import sys

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

# Фильтры: предмет «товар», способ «запрос ценовых предложений», опубликованные.
DEFAULT_URL = (
    "https://zakup.sk.kz/#/ext?tabs=advert&pto={price}&g=true&pmet=CP"
    "&adst=PUBLISHED&lst=PUBLISHED&page={page}"
)
# То же без верхней границы суммы (--price 0).
DEFAULT_URL_NO_MAX = "https://zakup.sk.kz/#/ext?tabs=advert&g=true&pmet=CP&adst=PUBLISHED&lst=PUBLISHED&page={page}"
# Адрес запроса списка объявлений, который делает сама страница.
DEFAULT_API_MARK = "/eprocsearch/api/external/4dv3rts/filter"


def fetch(url, api_mark, timeout_s, headless, chrome_path, max_items):
    out = {"ok": False, "status": None, "source_url": url, "total": None, "items": [], "error": None}
    with sync_playwright() as p:
        launch_args = {"headless": headless}
        if chrome_path:
            launch_args["executable_path"] = chrome_path
        browser = p.chromium.launch(**launch_args)
        try:
            context = browser.new_context(locale="ru-RU")
            page = context.new_page()
            try:
                with page.expect_response(lambda r: api_mark in r.url, timeout=timeout_s * 1000) as info:
                    page.goto(url, wait_until="domcontentloaded", timeout=timeout_s * 1000)
                resp = info.value
            except PWTimeout:
                out["error"] = "Портал не прислал список объявлений за отведённое время"
                return out

            out["status"] = resp.status
            if resp.status != 200:
                out["error"] = f"Портал вернул HTTP {resp.status}"
                return out

            try:
                data = resp.json()
            except Exception as exc:  # ответ не JSON
                out["error"] = f"Ответ портала не удалось разобрать: {exc}"
                return out

            # Список может лежать в корне или в поле content/items/data.
            items = data
            total = None
            if isinstance(data, dict):
                total = data.get("totalElements") or data.get("total")
                for key in ("content", "items", "data", "results"):
                    if isinstance(data.get(key), list):
                        items = data[key]
                        break
            if not isinstance(items, list):
                items = [items]
            out["ok"] = True
            out["total"] = total if total is not None else len(items)
            out["items"] = items[:max_items]
            return out
        finally:
            browser.close()


def main():
    ap = argparse.ArgumentParser(description="Закупки zakup.sk.kz через Playwright")
    ap.add_argument("--price", type=int, default=5_000_000, help="максимальная сумма, тг (0 = без верхней границы)")
    ap.add_argument("--min-price", type=int, default=0, help="минимальная сумма, тг (фильтр по полученным данным)")
    ap.add_argument("--pages", type=int, default=1, help="сколько страниц портала просмотреть (по 10 объявлений)")
    ap.add_argument("--url", help="своя ссылка поиска (по умолчанию фильтры: товар, CP, до --price)")
    ap.add_argument("--api-mark", default=DEFAULT_API_MARK, help="часть адреса запроса со списком")
    ap.add_argument("--timeout", type=int, default=45, help="ожидание ответа портала, сек")
    ap.add_argument("--max-items", type=int, default=20, help="сколько объявлений вернуть")
    ap.add_argument("--headed", action="store_true", help="показывать окно браузера")
    ap.add_argument("--chrome-path", default=os.environ.get("CHROME_PATH"), help="путь к Chrome/Chromium, если нужен свой")
    args = ap.parse_args()

    result = {"ok": False, "status": None, "source_url": None, "total": 0, "items": [], "error": None, "pages_read": 0}
    seen = set()
    for page_no in range(1, max(1, args.pages) + 1):
        url = args.url or (DEFAULT_URL.format(price=args.price, page=page_no) if args.price > 0 else DEFAULT_URL_NO_MAX.format(page=page_no))
        try:
            r = fetch(url, args.api_mark, args.timeout, not args.headed, args.chrome_path, 1000)
        except Exception as exc:  # браузер не запустился и т.п.
            r = {"ok": False, "status": None, "error": str(exc), "items": []}
        result["source_url"] = url
        result["status"] = r["status"]
        if not r["ok"]:
            result["error"] = r["error"]
            break  # ошибку портала не повторяем
        result["ok"] = True
        result["pages_read"] = page_no
        new_items = [i for i in r["items"] if i.get("id") not in seen]
        for i in new_items:
            seen.add(i.get("id"))
        result["items"].extend(new_items)
        if not new_items or args.url:  # страницы кончились или задана своя ссылка
            break

    if result["ok"]:
        lo = args.min_price
        result["items"] = [
            i for i in result["items"]
            if not isinstance(i.get("sumTruNoNds"), (int, float)) or i["sumTruNoNds"] >= lo
        ][: args.max_items]
        result["total"] = len(result["items"])
        result["error"] = None

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 2)


if __name__ == "__main__":
    main()
