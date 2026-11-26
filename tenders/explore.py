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
            entry["body"] = r.text()[:200].replace("\n", " ")
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
        nlinks = 0
        for text, href in page.eval_on_selector_all(
            "a", "els => els.map(e => [e.innerText.trim().slice(0, 80), e.getAttribute('href')])"
        ):
            if (text, href) not in seen and (text or href) and nlinks < 40:
                seen.add((text, href))
                nlinks += 1
                lines.append(f"  {text} -> {href}")

        # Формы поиска: поля, их имена и варианты выбора. Это нужно, чтобы собрать правильный запрос.
        lines.append("")
        lines.append("ФОРМЫ И ПОЛЯ:")
        forms = page.evaluate(
            r"""() => [...document.querySelectorAll('form')].slice(0, 6).map(f => ({
                action: f.getAttribute('action'), method: f.getAttribute('method'),
                fields: [...f.querySelectorAll('input,select,textarea')].slice(0, 60).map(e => ({
                    tag: e.tagName.toLowerCase(), type: e.getAttribute('type'), name: e.getAttribute('name'),
                    id: e.id || null, ph: e.getAttribute('placeholder'),
                    label: (e.labels && e.labels[0] ? e.labels[0].innerText : '').trim().slice(0, 50),
                    options: e.tagName === 'SELECT' ? [...e.options].slice(0, 40).map(o => o.value + '=' + o.text.trim().slice(0, 40)) : undefined
                }))
            }))"""
        )
        for f in forms:
            lines.append(f"  форма: action={f['action']} method={f['method']}")
            for e in f["fields"]:
                if e["type"] in ("hidden", "submit", "button"):
                    lines.append(f"    [{e['type']}] name={e['name']}")
                    continue
                opt = f" варианты: {'; '.join(e['options'])}" if e.get("options") else ""
                lines.append(f"    <{e['tag']}> type={e['type']} name={e['name']} id={e['id']} подпись={e['label'] or e['ph']}{opt}")

        # Таблицы результатов: заголовки и первые строки.
        lines.append("")
        lines.append("ТАБЛИЦЫ:")
        tables = page.evaluate(
            r"""() => [...document.querySelectorAll('table')].slice(0, 3).map(t => ({
                head: [...t.querySelectorAll('thead th, tr:first-child th')].map(x => x.innerText.trim().slice(0, 40)),
                rows: [...t.querySelectorAll('tbody tr')].slice(0, 3).map(r => [...r.querySelectorAll('td')].map(x => x.innerText.trim().replace(/[ \t\n\r]+/g, ' ').slice(0, 60))),
                links: [...t.querySelectorAll('tbody a')].slice(0, 3).map(a => a.getAttribute('href'))
            }))"""
        )
        for t in tables:
            lines.append(f"  заголовки: {t['head']}")
            for r in t["rows"]:
                lines.append(f"    строка: {r}")
            lines.append(f"    ссылки: {t['links']}")

        lines.append("")
        lines.append("ТЕКСТ СТРАНИЦЫ (начало):")
        lines.append(page.inner_text("body")[:1200])
        browser.close()

    lines.append("")
    lines.append("ЗАПРОСЫ К API:")
    if len(calls) > 25:
        lines.append(f"  (всего {len(calls)}, показаны первые 25)")
    for c in calls[:25]:
        lines.append(f"  {c['status']} {c['method']} {c['url'][:160]}")
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
