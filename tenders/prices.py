#!/usr/bin/env python3
"""Поиск цен на товар в интернет-магазине Satu.kz (Казахстан).

Открывает страницу поиска в обычном браузере и читает структурированные данные страницы
(schema.org, JSON-LD): название, бренд, цена, ссылка. Один запрос на товар, с паузой;
защиту сайта не обходит. Если сайт отвечает ошибкой, она возвращается в JSON.

Использование:
    python tenders/prices.py --query "насос ручной гидравлический 2л" --query "кабель силовой ВВГ"
Результат: JSON {ok, results: [{query, ok, error, used_query, offers: [{name, brand, price, url, ...}]}]}
Предложения отсортированы по цене; в поле relevance доля слов запроса, найденных в названии.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse

from playwright.sync_api import sync_playwright

SEARCH = "https://satu.kz/search?search_term={q}"


def tokens(text):
    """Слова запроса: основа русских слов (первые 5 букв) и числа/модели целиком."""
    out = []
    for w in re.findall(r"[\w,.\-]+", (text or "").lower().replace("ё", "е")):
        w = w.strip(".,-")
        if len(w) < 2:
            continue
        out.append(w if re.search(r"\d", w) else w[:5])
    return out


def relevance(query, name):
    toks = tokens(query)
    if not toks:
        return 0.0
    hay = (name or "").lower().replace("ё", "е")
    hit = 0
    for t in toks:
        if re.search(r"\d", t):
            # числа и модели ищем целиком: «2л» не должно совпадать с «3,2л»
            if re.search(r"(?<![\d,.\-])" + re.escape(t) + r"(?![\d])", hay):
                hit += 1
        elif t in hay:
            hit += 1
    return hit / len(toks)


def to_number(v):
    try:
        return float(str(v).replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def parse_offers(page):
    blocks = page.evaluate(
        "()=>[...document.querySelectorAll('script[type=\"application/ld+json\"]')].map(s=>s.textContent)"
    )
    offers = []
    for raw in blocks:
        try:
            data = json.loads(raw)
        except Exception:
            continue
        for d in data if isinstance(data, list) else [data]:
            if not isinstance(d, dict) or d.get("@type") != "ItemList":
                continue
            for el in d.get("itemListElement", []):
                it = el.get("item") if isinstance(el, dict) else None
                if not isinstance(it, dict):
                    continue
                of = it.get("offers") or {}
                if isinstance(of, list):
                    of = of[0] if of else {}
                price = to_number(of.get("price") if of.get("price") is not None else of.get("lowPrice"))
                if price is None:
                    continue
                offers.append(
                    {
                        "name": it.get("name"),
                        "brand": (it.get("brand") or {}).get("name") if isinstance(it.get("brand"), dict) else None,
                        "price": price,
                        "price_from": of.get("price") is None and of.get("lowPrice") is not None,  # «от …»
                        "currency": of.get("priceCurrency"),
                        "url": it.get("url"),
                        "in_stock": "InStock" in str(of.get("availability", "")),
                        "source": "satu.kz",
                    }
                )
    return offers


def search_one(page, query, timeout_s):
    res = {"query": query, "used_query": query, "ok": False, "error": None, "offers": []}
    for attempt, q in enumerate([query, " ".join(query.split()[:3])]):
        if attempt and (len(query.split()) <= 3 or len([o for o in res["offers"] if o["relevance"] >= 0.6]) >= 3):
            break
        res["used_query"] = q
        try:
            r = page.goto(SEARCH.format(q=urllib.parse.quote(q)), wait_until="domcontentloaded", timeout=timeout_s * 1000)
            page.wait_for_timeout(3500)
        except Exception as exc:
            res["error"] = f"Не удалось открыть Satu.kz: {str(exc)[:120]}"
            return res
        if r is None or r.status != 200:
            res["error"] = f"Satu.kz вернул HTTP {r.status if r else '—'}"
            return res
        offers = parse_offers(page)
        for o in offers:
            o["relevance"] = round(relevance(query, o["name"]), 2)
        res["offers"] = offers
        res["ok"] = True
        time.sleep(1)
    res["offers"].sort(key=lambda o: o["price"])
    return res


def main():
    ap = argparse.ArgumentParser(description="Цены на товары (Satu.kz)")
    ap.add_argument("--query", action="append", required=True, help="что искать (можно несколько раз)")
    ap.add_argument("--timeout", type=int, default=40)
    ap.add_argument("--max-offers", type=int, default=40)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--chrome-path", default=os.environ.get("CHROME_PATH"))
    args = ap.parse_args()

    out = {"ok": False, "error": None, "results": []}
    try:
        with sync_playwright() as p:
            kw = {"headless": not args.headed}
            if args.chrome_path:
                kw["executable_path"] = args.chrome_path
            browser = p.chromium.launch(**kw)
            try:
                page = browser.new_context(locale="ru-RU").new_page()
                for q in args.query:
                    r = search_one(page, q, args.timeout)
                    r["offers"] = r["offers"][: args.max_offers]
                    out["results"].append(r)
                    if r["error"] and "HTTP" in r["error"]:
                        break  # ошибку сайта не повторяем
            finally:
                browser.close()
    except Exception as exc:
        out["error"] = str(exc)[:300]
    out["ok"] = any(r["ok"] for r in out["results"])
    if not out["ok"] and not out["error"]:
        out["error"] = next((r["error"] for r in out["results"] if r["error"]), "Нет данных")
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0 if out["ok"] else 2)


if __name__ == "__main__":
    main()
