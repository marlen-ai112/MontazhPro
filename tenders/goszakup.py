#!/usr/bin/env python3
"""Коннектор для портала госзакупок goszakup.gov.kz.

Делает обычный запрос страницы поиска объявлений (как браузер или curl) с теми же фильтрами, что и на сайте:
способ закупки «Запрос ценовых предложений», предмет «Товар», сумма от и до, только активные для участия.
Таблица результатов приходит в самом HTML, браузер не нужен. Без обхода защиты, одна страница за раз с паузой.
Ошибки сайта (в том числе обрыв соединения) возвращаются в JSON и не повторяются.

Параметры поиска на сайте (форма GET /ru/search/announce):
    filter[method][]=3        Запрос ценовых предложений (126 = «не ГЗ new»)
    filter[trade_type]=g      Предмет закупки: g = Товар, s = Услуга, r = Работа
    filter[amount_from], filter[amount_to]   Сумма закупки, тг
    filter[signs][]=is_active  Активные для участия

Использование:
    python tenders/goszakup.py --min-price 1500000 --price 5000000 --pages 3
Результат: JSON {ok, status, source_url, total, items, error, pages_read}; код возврата 0 при успехе, 2 при ошибке.
Записи совместимы с zakup_sk.py: id, number, nameRu, sumTruNoNds, acceptanceEndDateTime, плюс source=goszakup, url, customer, status.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlencode, urljoin

BASE = "https://goszakup.gov.kz"
TZ = "+05:00"  # Астана


def build_url(min_price, max_price, methods, page=1):
    q = [("filter[method][]", m) for m in methods]
    q += [
        ("filter[trade_type]", "g"),
        ("filter[amount_from]", str(min_price)),
    ]
    if max_price > 0:  # 0 = без верхней границы
        q.append(("filter[amount_to]", str(max_price)))
    q.append(("filter[signs][]", "is_active"))
    if page > 1:
        q.append(("page", str(page)))
    return f"{BASE}/ru/search/announce?{urlencode(q)}"


UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


class _Tables(HTMLParser):
    """Достаёт таблицы (строки и ячейки с текстом) и все ссылки страницы."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.links = [], []
        self._t = None  # текущая таблица
        self._row = None  # текущая строка
        self._cell = None  # текст текущей ячейки

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
            if self._row is not None and self._row["href"] is None and "/announce/index/" in a["href"]:
                self._row["href"] = a["href"]
        elif tag == "table":
            self._t = {"rows": [], "text": []}
        elif tag == "tr" and self._t is not None:
            self._row = {"cells": [], "th": 0, "href": None}
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
            if tag == "th":
                self._row["th"] += 1
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            text = re.sub(r"[ \t\r\n\xa0]+", " ", "".join(self._cell)).strip()
            self._row["cells"].append(text)
            self._t["text"].append(text)
            self._cell = None
        elif tag == "tr" and self._row is not None and self._t is not None:
            self._t["rows"].append(self._row)
            self._row = None
        elif tag == "table" and self._t is not None:
            self.tables.append(self._t)
            self._t = None


def parse_html(html):
    """Возвращает (найдена ли таблица объявлений, строки, ссылки страницы)."""
    p = _Tables()
    p.feed(html)
    for t in p.tables:
        if any("Наименование объявления" in x for x in t["text"]):
            rows = [{"cells": r["cells"], "href": r["href"]} for r in t["rows"] if not r["th"] and len(r["cells"]) >= 6]
            return True, rows, p.links
    return False, [], p.links


def next_page_url(links, current):
    """Ссылка на страницу current+1 из блока пагинации."""
    for href in links:
        m = re.search(r"[?&]page=(\d+)", href)
        if m and int(m.group(1)) == current + 1:
            return urljoin(BASE, href)
    return None


def http_get(url, timeout):
    """Обычный GET страницы (как в браузере или curl), с перенаправлениями. Сайт бывает очень медленным."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        charset = r.headers.get_content_charset() or "utf-8"
        return r.status, raw.decode(charset, "replace"), r.geturl()


def to_iso(s):
    m = re.match(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})", s or "")
    return f"{m.group(1)}T{m.group(2)}{TZ}" if m else None


def to_number(s):
    try:
        return float(re.sub(r"[^\d.,]", "", s or "").replace(",", "."))
    except ValueError:
        return None


def row_to_item(r):
    c = r["cells"]
    num_full = c[0].split(" ")[0]  # «18029903-1 Лотов: 1» -> 18029903-1
    base = num_full.split("-")[0]
    lots = re.search(r"Лотов:\s*(\d+)", c[0])
    name, _, org = c[1].partition("Организатор:")
    href = r["href"] or f"/ru/announce/index/{base}"
    return {
        "id": f"gz:{base}",
        "number": num_full,
        "nameRu": name.strip(),
        "customer": org.strip() or None,
        "method": c[2],
        "acceptanceBeginDateTime": to_iso(c[3]),
        "acceptanceEndDateTime": to_iso(c[4]),
        "sumTruNoNds": to_number(c[5]),
        "status": c[6] if len(c) > 6 else None,
        "lots": int(lots.group(1)) if lots else None,
        "url": urljoin(BASE, href),
        "source": "goszakup",
    }


def main():
    ap = argparse.ArgumentParser(description="Закупки goszakup.gov.kz через Playwright")
    ap.add_argument("--price", type=int, default=5_000_000, help="сумма до, тг (0 = без верхней границы)")
    ap.add_argument("--min-price", type=int, default=1_500_000, help="сумма от, тг")
    ap.add_argument("--methods", default=os.environ.get("GOSZAKUP_METHODS", "3"), help="способы закупки через запятую (3 = запрос ценовых предложений)")
    ap.add_argument("--pages", type=int, default=3)
    ap.add_argument("--max-items", type=int, default=100)
    ap.add_argument("--timeout", type=int, default=150, help="ожидание ответа сайта, сек (он бывает медленным)")
    ap.add_argument("--headed", action="store_true", help="не используется (оставлено для совместимости)")
    args = ap.parse_args()

    methods = [m.strip() for m in args.methods.split(",") if m.strip()]
    result = {"ok": False, "status": None, "source_url": None, "total": 0, "items": [], "error": None, "pages_read": 0}
    seen = set()
    url = build_url(args.min_price, args.price, methods)
    for n in range(1, max(1, args.pages) + 1):
        result["source_url"] = url
        try:
            status, html, final = http_get(url, args.timeout)
        except Exception as exc:
            result["error"] = f"Не удалось получить страницу: {str(exc).splitlines()[0][:200]}"
            break
        result["status"] = status
        found, rows, links = parse_html(html)
        if not found:
            text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
            if re.search(r"не найден|ничего не найдено|нет данных|записей нет", text, re.I):
                result["ok"] = True  # сайт ответил, что по фильтрам объявлений нет
                result["pages_read"] = n
                break
            title = re.search(r"<title>(.*?)</title>", html, re.S)
            result["error"] = f"В ответе нет таблицы объявлений. Заголовок: «{(title.group(1).strip() if title else '')[:80]}». Адрес: {final[:90]}. Текст: {text.strip()[:150]}"
            break
        items = [row_to_item(r) for r in rows]
        result["ok"] = True
        result["pages_read"] = n
        new = [i for i in items if i["id"] not in seen]
        for i in new:
            seen.add(i["id"])
        result["items"].extend(new)
        nxt = next_page_url(links, n)
        if not new or not nxt:
            break
        url = nxt
        time.sleep(1.5)  # пауза между страницами

    if result["ok"]:
        lo, hi = args.min_price, args.price
        result["items"] = [
            i for i in result["items"] if i["sumTruNoNds"] is None or (lo <= i["sumTruNoNds"] and (hi <= 0 or i["sumTruNoNds"] <= hi))
        ][: args.max_items]
        result["total"] = len(result["items"])
        result["error"] = None

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 2)


if __name__ == "__main__":
    main()
