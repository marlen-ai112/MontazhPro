#!/usr/bin/env python3
"""Разведка сайта: открывает страницу в браузере и записывает в файл
ссылки, текст, и запросы к API (адрес, метод, размер ответа, начало ответа).

Нужно, чтобы найти, как сайт отдаёт список закупок, и подключить его как источник.
Ничего не отправляет и не меняет на сайте: только открывает страницу и ждёт.

Использование:
    python tenders/explore.py https://skstore.kz/home/main
    python tenders/explore.py https://skstore.kz/home/main --headed   # показать окно
    python tenders/explore.py https://skstore.kz/home/main --click "Закупки"   # нажать пункт меню

Результат сохраняется в tenders/explore_result.txt: пришлите этот файл (cookie и
заголовки в него не попадают).
"""
import argparse
import os

from playwright.sync_api import sync_playwright


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--headed", action="store_true", help="показывать окно браузера")
    ap.add_argument("--click", help="текст пункта меню/ссылки, который нужно нажать после загрузки")
    ap.add_argument("--wait", type=int, default=6, help="сколько секунд ждать после загрузки")
    ap.add_argument("--chrome-path", default=os.environ.get("CHROME_PATH"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "explore_result.txt"))
    args = ap.parse_args()

    lines = []
    calls = []

    def on_response(r):
        if r.request.resource_type not in ("xhr", "fetch"):
            return
        entry = {"status": r.status, "method": r.request.method, "url": r.url, "body": "", "post": ""}
        try:
            entry["post"] = (r.request.post_data or "")[:500]
        except Exception:
            pass
        try:
            entry["body"] = r.text()[:400].replace("\n", " ")
        except Exception:
            pass
        calls.append(entry)

    with sync_playwright() as p:
        kw = {"headless": not args.headed}
        if args.chrome_path:
            kw["executable_path"] = args.chrome_path
        browser = p.chromium.launch(**kw)
        page = browser.new_context(locale="ru-RU").new_page()
        page.on("response", on_response)

        resp = page.goto(args.url, wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(args.wait * 1000)
        lines.append(f"URL: {args.url}")
        lines.append(f"HTTP: {resp.status if resp else '?'}  Заголовок: {page.title()}")

        if args.click:
            try:
                page.get_by_text(args.click, exact=False).first.click(timeout=10000)
                page.wait_for_load_state("networkidle", timeout=30000)
                page.wait_for_timeout(args.wait * 1000)
                lines.append(f"Нажато: {args.click}. Адрес теперь: {page.url}")
            except Exception as exc:
                lines.append(f"Не удалось нажать «{args.click}»: {exc}")

        lines.append("")
        lines.append("ССЫЛКИ:")
        seen = set()
        for text, href in page.eval_on_selector_all(
            "a", "els => els.map(e => [e.innerText.trim().slice(0, 80), e.getAttribute('href')])"
        ):
            if (text, href) not in seen and (text or href):
                seen.add((text, href))
                lines.append(f"  {text} -> {href}")

        lines.append("")
        lines.append("ТЕКСТ СТРАНИЦЫ (начало):")
        lines.append(page.inner_text("body")[:1500])
        browser.close()

    lines.append("")
    lines.append("ЗАПРОСЫ К API:")
    for c in calls:
        lines.append(f"  {c['status']} {c['method']} {c['url']}")
        if c["post"]:
            lines.append(f"      тело запроса: {c['post']}")
        if c["body"]:
            lines.append(f"      ответ: {c['body']}")

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Готово. Результат сохранён в {args.out}")
    print(f"Найдено запросов к API: {len(calls)}")


if __name__ == "__main__":
    main()
