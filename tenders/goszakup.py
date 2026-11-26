#!/usr/bin/env python3
"""Коннектор Playwright для портала госзакупок goszakup.gov.kz.

Открывает страницу поиска объявлений в обычном браузере (как пользователь) с теми же фильтрами, что и на сайте:
способ закупки «Запрос ценовых предложений», предмет «Товар», сумма от и до, только активные для участия.
Читает таблицу результатов. Без подделки заголовков и без обхода защиты, одна страница за раз с паузой.
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
from urllib.parse import urlencode, urljoin

from playwright.sync_api import sync_playwright

BASE = "https://goszakup.gov.kz"
TZ = "+05:00"  # Астана


def build_url(min_price, max_price, methods, page=1):
    q = [("filter[method][]", m) for m in methods]
    q += [
        ("filter[trade_type]", "g"),
        ("filter[amount_from]", str(min_price)),
        ("filter[amount_to]", str(max_price)),
        ("filter[signs][]", "is_active"),
    ]
    if page > 1:
        q.append(("page", str(page)))
    return f"{BASE}/ru/search/announce?{urlencode(q)}"


# Читает таблицу «Наименование объявления» и ссылку на следующую страницу.
PARSE_JS = r"""() => {
  const norm = s => (s || '').replace(/[ \t\r\n]+/g, ' ').trim();
  const tables = [...document.querySelectorAll('table')];
  const t = tables.find(x => /Наименование объявления/.test(x.innerText));
  const rows = [];
  if (t) {
    for (const tr of t.querySelectorAll('tbody tr')) {
      const td = [...tr.querySelectorAll('td')];
      if (td.length < 6) continue;
      const a = tr.querySelector('a[href*="/announce/index/"]');
      rows.push({ cells: td.map(x => norm(x.innerText)), href: a ? a.getAttribute('href') : null });
    }
  }
  let next = null;
  const el = document.querySelector('ul.pagination li.active + li a, a[rel="next"]');
  if (el) next = el.getAttribute('href');
  return { found: !!t, rows, next };
}"""


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


def read_page(page):
    data = page.evaluate(PARSE_JS)
    items = [row_to_item(r) for r in data["rows"]]
    return data["found"], items, data["next"]


def main():
    ap = argparse.ArgumentParser(description="Закупки goszakup.gov.kz через Playwright")
    ap.add_argument("--price", type=int, default=5_000_000, help="сумма до, тг")
    ap.add_argument("--min-price", type=int, default=1_500_000, help="сумма от, тг")
    ap.add_argument("--methods", default=os.environ.get("GOSZAKUP_METHODS", "3"), help="способы закупки через запятую (3 = запрос ценовых предложений)")
    ap.add_argument("--pages", type=int, default=3)
    ap.add_argument("--max-items", type=int, default=100)
    ap.add_argument("--timeout", type=int, default=45)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--chrome-path", default=os.environ.get("CHROME_PATH"))
    args = ap.parse_args()

    methods = [m.strip() for m in args.methods.split(",") if m.strip()]
    result = {"ok": False, "status": None, "source_url": None, "total": 0, "items": [], "error": None, "pages_read": 0}
    seen = set()
    try:
        with sync_playwright() as p:
            kw = {"headless": not args.headed}
            if args.chrome_path:
                kw["executable_path"] = args.chrome_path
            browser = p.chromium.launch(**kw)
            try:
                page = browser.new_context(locale="ru-RU").new_page()
                url = build_url(args.min_price, args.price, methods)
                for n in range(1, max(1, args.pages) + 1):
                    result["source_url"] = url
                    resp = page.goto(url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
                    result["status"] = resp.status if resp else None
                    if not resp or resp.status != 200:
                        result["error"] = f"Портал вернул HTTP {resp.status if resp else '—'}"
                        break
                    try:
                        page.wait_for_selector("table", timeout=args.timeout * 1000)
                    except Exception:
                        result["error"] = "Портал не показал таблицу объявлений"
                        break
                    found, items, nxt = read_page(page)
                    if not found:
                        result["error"] = "На странице нет таблицы «Наименование объявления» (сайт мог измениться)"
                        break
                    result["ok"] = True
                    result["pages_read"] = n
                    new = [i for i in items if i["id"] not in seen]
                    for i in new:
                        seen.add(i["id"])
                    result["items"].extend(new)
                    if not new or not nxt:
                        break
                    url = urljoin(BASE, nxt)
                    page.wait_for_timeout(1500)  # пауза между страницами
            finally:
                browser.close()
    except Exception as exc:
        result["error"] = str(exc).split("\n")[0][:300]

    if result["ok"]:
        lo, hi = args.min_price, args.price
        result["items"] = [
            i for i in result["items"] if i["sumTruNoNds"] is None or lo <= i["sumTruNoNds"] <= hi
        ][: args.max_items]
        result["total"] = len(result["items"])
        result["error"] = None

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["ok"] else 2)


if __name__ == "__main__":
    main()
