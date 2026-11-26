#!/usr/bin/env python3
"""Подробности закупок zakup.sk.kz: лоты, «точный товар» и техническая спецификация.

Для каждой закупки открывает её карточку в настоящем браузере (как пользователь), забирает
ответы, которые портал сам запрашивает у своего API (карточка и лоты), и скачивает PDF
«Техническая спецификация» каждого лота той же кнопкой-ссылкой, что и страница.
Без подделки заголовков и без обхода защиты: закупки обрабатываются по одной, с паузой.
Ошибки портала (например, 418) возвращаются в JSON и не повторяются.

Использование:
    python tenders/zakup_details.py --ids 1275177,1274647 --out-dir /tmp/specs
Результат: JSON в stdout {ok, error, tenders: [...]}. Код возврата 0, если получена хотя бы одна закупка.
Для текста из PDF нужна утилита pdftotext (пакет poppler-utils); без неё поле spec_text пустое,
а PDF всё равно сохраняется.
"""
import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

CARD_URL = "https://zakup.sk.kz/#/ext(popup:item/{id}/advert)?tabs=advert"
MAX_LOT_PAGES = 10  # не больше 100 лотов на закупку
FILE_URL = "/eprocfilestorage/open-api/files/download/"

FETCH_JS = """async (u) => {
  const r = await fetch(u);
  const b = new Uint8Array(await r.arrayBuffer());
  let s = ''; const step = 0x8000;
  for (let i = 0; i < b.length; i += step) s += String.fromCharCode.apply(null, b.subarray(i, i + step));
  return { status: r.status, b64: btoa(s) };
}"""


def pdf_to_text(path):
    """Текст PDF; если есть русская часть («ТЕХНИЧЕСКАЯ СПЕЦИФИКАЦИЯ»), берём только её."""
    if not shutil.which("pdftotext"):
        return None
    try:
        raw = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, timeout=30).stdout.decode("utf-8", "replace")
    except Exception:
        return None
    m = re.search(r"ТЕХНИЧЕСКАЯ\s+СПЕЦИФИКАЦИЯ", raw)
    text = raw[m.start():] if m else raw
    text = re.sub(r"(Документ сформирован веб-порталом|Құжат «Самұрық-Қазына»).*\n?", "", text)
    text = re.sub(r"[ \t]{3,}", "  ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def lot_info(lot):
    attrs = []
    for a in lot.get("goodsAttributeList") or []:
        name = a.get("nameRu") or a.get("attributeName") or ""
        kind = ((a.get("attribute") or {}).get("ru")) or ""
        if name:
            attrs.append({"kind": kind, "value": name})
    th = lot.get("truHistory") or {}
    return {
        "id": lot.get("id"),
        "number": lot.get("number"),
        "name": lot.get("nameRu"),
        "brief": th.get("briefRu"),
        "oktru_category": lot.get("oktruCategoryNameRu"),
        "oktru_code": lot.get("oktruFullCode"),
        "exact_product": [a["value"] for a in attrs],
        "attributes": attrs,
        "add_attribute": lot.get("addAttributeRu"),
        "quantity": lot.get("count"),
        "unit": (lot.get("mkei") or {}).get("ru"),
        "price_per_unit": lot.get("price"),
        "sum": lot.get("sumTruNoNds"),
        "delivery": lot.get("deliveryLocationRu"),
        "duration": lot.get("durationMonth"),
        "files": [
            {"uid": d.get("fileUid"), "name": d.get("fileName"), "category": d.get("documentCategory")}
            for d in (lot.get("lotDocuments") or [])
        ],
        "spec_pdf": None,
        "spec_text": None,
    }


def one_tender(page, tid, timeout_s, out_dir):
    res = {"id": tid, "ok": False, "error": None}
    holder = {}

    def on(r):
        u = r.url
        try:
            if re.search(r"/4dv3rts/%s$" % tid, u):
                holder["advert"] = (r.status, r)
            elif f"/4dv3rts/lots/{tid}" in u:
                holder["lots"] = (r.status, r)
        except Exception:
            pass

    page.on("response", on)
    try:
        page.goto(CARD_URL.format(id=tid), wait_until="domcontentloaded", timeout=timeout_s * 1000)
        end = time.time() + timeout_s
        while time.time() < end and ("advert" not in holder or "lots" not in holder):
            page.wait_for_timeout(300)
    finally:
        page.remove_listener("response", on)

    if "lots" not in holder:
        res["error"] = "Портал не прислал данные лотов"
        return res
    st, r = holder["lots"]
    if st != 200:
        res["error"] = f"Портал вернул HTTP {st}"
        return res
    lots = list(r.json())
    try:
        total = int(r.headers.get("x-total-count", len(lots)))
    except ValueError:
        total = len(lots)
    # Портал показывает лоты по 10 на странице: листаем кнопкой «следующая страница», как человек.
    pages = 1
    while len(lots) < total and pages < MAX_LOT_PAGES:
        nxt = page.locator(".m-modal__pagination a[aria-label='Next']").first
        try:
            with page.expect_response(lambda x: f"/4dv3rts/lots/{tid}" in x.url, timeout=timeout_s * 1000) as info:
                nxt.click(timeout=10000)
            more = info.value
            if more.status != 200:
                res["lots_warning"] = f"Страница лотов {pages + 1}: HTTP {more.status}"
                break
            chunk = more.json()
        except Exception as exc:
            res["lots_warning"] = f"Не удалось перейти на страницу лотов {pages + 1}: {str(exc)[:120]}"
            break
        if not chunk:
            break
        lots.extend(chunk)
        pages += 1
        page.wait_for_timeout(700)
    res["lots_total"] = total
    if len(lots) < total and "lots_warning" not in res:
        res["lots_warning"] = f"Получено лотов {len(lots)} из {total}"
    advert = holder["advert"][1].json() if "advert" in holder and holder["advert"][0] == 200 else {}
    customer = (advert.get("customer") or {})
    res.update(
        ok=True,
        number=advert.get("number") or str(tid),
        name=advert.get("nameRu"),
        sum=advert.get("sumTruNoNds"),
        accept_until=advert.get("acceptanceEndDateTime"),
        customer=customer.get("nameRu"),
        customer_phone=advert.get("phone") or customer.get("phone"),
        customer_email=advert.get("email") or customer.get("email"),
        lots=[lot_info(x) for x in (lots if isinstance(lots, list) else [])],
        documents=[
            {"name": d.get("fileName"), "category": d.get("documentCategory")}
            for d in (advert.get("documents") or [])
        ],
    )

    # Скачиваем PDF «Техническая спецификация» каждого лота.
    for lot in res["lots"]:
        for f in lot["files"]:
            if f["category"] != "LOT_TECHNICAL_SPECIFICATION" or not f["uid"]:
                continue
            try:
                got = page.evaluate(FETCH_JS, FILE_URL + f["uid"])
            except Exception as exc:
                lot["spec_error"] = str(exc)[:200]
                break
            if got["status"] != 200:
                lot["spec_error"] = f"HTTP {got['status']}"
                break
            data = base64.b64decode(got["b64"])
            if data[:4] != b"%PDF":
                lot["spec_error"] = "Файл не PDF"
                break
            os.makedirs(out_dir, exist_ok=True)
            path = os.path.join(out_dir, f"spec_{tid}_{lot['number']}.pdf")
            with open(path, "wb") as fh:
                fh.write(data)
            lot["spec_pdf"] = path
            lot["spec_text"] = pdf_to_text(path)
            break
        page.wait_for_timeout(500)  # небольшая пауза между файлами
    return res


def main():
    ap = argparse.ArgumentParser(description="Подробности закупок zakup.sk.kz")
    ap.add_argument("--ids", required=True, help="номера закупок через запятую")
    ap.add_argument("--out-dir", default="specs", help="куда сохранять PDF спецификаций")
    ap.add_argument("--timeout", type=int, default=45)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--chrome-path", default=os.environ.get("CHROME_PATH"))
    args = ap.parse_args()

    ids = [s.strip() for s in args.ids.split(",") if s.strip().isdigit()]
    out = {"ok": False, "error": None, "tenders": []}
    try:
        with sync_playwright() as p:
            kw = {"headless": not args.headed}
            if args.chrome_path:
                kw["executable_path"] = args.chrome_path
            browser = p.chromium.launch(**kw)
            try:
                page = browser.new_context(locale="ru-RU").new_page()
                for tid in ids:
                    try:
                        t = one_tender(page, tid, args.timeout, args.out_dir)
                    except PWTimeout:
                        t = {"id": tid, "ok": False, "error": "Тайм-аут портала"}
                    except Exception as exc:
                        t = {"id": tid, "ok": False, "error": str(exc)[:300]}
                    out["tenders"].append(t)
                    if not t["ok"] and "HTTP" in (t.get("error") or ""):
                        break  # ошибку портала не повторяем
                    page.wait_for_timeout(1000)
            finally:
                browser.close()
    except Exception as exc:
        out["error"] = str(exc)[:300]

    out["ok"] = any(t["ok"] for t in out["tenders"])
    if not out["ok"] and not out["error"]:
        out["error"] = next((t.get("error") for t in out["tenders"] if t.get("error")), "Нет данных")
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0 if out["ok"] else 2)


if __name__ == "__main__":
    main()
