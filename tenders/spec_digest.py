#!/usr/bin/env python3
"""Разбор PDF «Техническая спецификация» лота по правилам, без ИИ и без платных ключей.

Из PDF достаёт таблицы: краткое описание (количество, место и срок поставки, оплата) и таблицу «Параметр | Требование»,
а в тексте находит условия: аналоги и эквиваленты, сертификаты и документы, гарантия, стандарты, состояние товара, комплектность.
Это не «понимание» текста, как у ИИ: скрипт структурирует спецификацию и подсвечивает условия, а суждения оставляет человеку.

Использование:
    python tenders/spec_digest.py spec.pdf        # печатает JSON
В коде: from spec_digest import digest_pdf; digest_pdf(path) -> dict или None (если нет PyMuPDF или файл не читается).
Нужен пакет pymupdf (pip install pymupdf).
"""
import json
import re
import sys

try:
    import pymupdf as fitz  # новое имя пакета
except ImportError:  # старое имя
    try:
        import fitz
    except ImportError:
        fitz = None

# Подписи строк краткого описания -> ключи
SUMMARY_KEYS = {
    "номер строки": "line_no",
    "наименование и краткая характеристика": "name",
    "наименование категории октру": "category",
    "дополнительная характеристика": "extra",
    "количество": "quantity",
    "единица измерения": "unit",
    "место поставки": "delivery_place",
    "условия поставки": "delivery_terms",
    "срок поставки": "deadline",
    "условия оплаты": "payment",
}

# Условия, которые стоит подсветить: (ключ, подпись, регулярное выражение)
NOTE_RULES = [
    ("analogs", "Аналоги", r"аналог|эквивалент|или равноценн"),
    ("docs", "Документы и сертификаты", r"сертификат|паспорт|декларац|свидетельств|заключени"),
    ("warranty", "Гарантия", r"гаранти"),
    ("standards", "Стандарты", r"гост|ст рк|\bту\b|iso\b|\ben\s?\d|din\b|астм|astm"),
    ("condition", "Состояние товара", r"нов(ый|ого|ое|ая)\b|не бывш|не восстановл|не после ремонта|не б/у"),
    ("shelf", "Срок годности и дата выпуска", r"срок годности|дата изготовления|год выпуска|год/дата"),
    ("package", "Упаковка и маркировка", r"упаковк|маркировк"),
    ("kit", "Комплектность", r"комплект"),
]


def _clean(s):
    return re.sub(r"[ \t\r\n\xa0]+", " ", s or "").strip()


def _ru_start(doc):
    """Номер страницы, с которой начинается русская часть спецификации."""
    for i, page in enumerate(doc):
        if re.search(r"ТЕХНИЧЕСКАЯ\s+СПЕЦИФИКАЦИЯ", page.get_text(), re.I):
            return i
    return 0


def digest_pdf(path):
    if fitz is None:
        return None
    try:
        doc = fitz.open(path)
    except Exception:
        return None
    start = _ru_start(doc)
    summary, params, texts, paras = {}, [], [], []
    for i in range(start, len(doc)):
        page = doc[i]
        texts.append(page.get_text())
        try:
            paras += [_clean(b[4]) for b in page.get_text("blocks") if len(b) > 4 and isinstance(b[4], str)]
        except Exception:
            pass
        try:
            tables = page.find_tables().tables
        except Exception:
            continue
        for t in tables:
            try:
                rows = t.extract()
            except Exception:
                continue
            for r in rows:
                cells = [_clean(c) for c in r]
                if len(cells) == 2:
                    key = SUMMARY_KEYS.get(cells[0].lower())
                    if key and key not in summary:
                        summary[key] = cells[1]
                elif len(cells) >= 3 and re.fullmatch(r"\d{1,3}", cells[0] or ""):
                    name, value = cells[1], " ".join(c for c in cells[2:] if c)
                    if name or value:
                        params.append({"n": int(cells[0]), "name": name, "value": value})
    text = "\n".join(texts)
    text = re.sub(r"Документ сформирован веб-порталом.*", "", text)

    # Условия: сначала строки таблицы параметров (в них мысль законченная), потом абзацы текста с ключевыми словами.
    notes = {}
    paras = [x for x in paras if x and not x.startswith("Документ сформирован")]
    lines = [f"{p['name']}: {p['value']}" for p in params] + paras
    for key, _label, rx in NOTE_RULES:
        found = []
        if key == "kit":
            # комплектность: после заголовка берём ближайшие пункты списка
            for i, ln in enumerate(paras):
                if re.search(r"комплектност|в комплект", ln, re.I) and len(ln) < 70:
                    found = [x[:170] for x in paras[i + 1 : i + 4] if len(x) > 6 and not re.match(r"^\d+\.\s*[А-ЯA-Z]", x)][:3]
                    break
        else:
            for ln in lines:
                if len(ln) < 8 or ln.lower().startswith("параметр") or not re.search(rx, ln, re.I):
                    continue
                ln = ln[:170]
                if ln not in found:
                    found.append(ln)
                if len(found) >= 3:
                    break
        if found:
            notes[key] = found

    # Описание текстом (нужно, когда в спецификации нет таблицы параметров)
    desc = ""
    m = re.search(r"Описание и требуемые[^\n]*\n", text)
    if m:
        desc = _clean(text[m.end():])[:700]
    return {"summary": summary, "params": params, "notes": notes, "desc": desc, "pages": len(doc), "ru_from_page": start + 1}


def format_digest(d, max_params=12):
    """Короткий текст для чата. Возвращает список строк."""
    out = []
    s = d.get("summary", {})
    cond = []
    if s.get("deadline"):
        cond.append(f"срок поставки: {s['deadline']}")
    if s.get("delivery_terms"):
        cond.append(f"условия: {s['delivery_terms']}")
    if s.get("payment"):
        cond.append(f"оплата: {s['payment']}")
    if cond:
        out.append("Условия поставки: " + "; ".join(cond))
    params = d.get("params", [])
    if not params and d.get("desc"):
        out.append("Описание и требования (текстом):")
        out.append("  " + d["desc"])
    if params:
        out.append(f"Требования к товару ({len(params)}):")
        for p in params[:max_params]:
            out.append(f"  • {p['name']}: {p['value']}" if p["name"] else f"  • {p['value']}")
        if len(params) > max_params:
            out.append(f"  … ещё {len(params) - max_params} в PDF")
    labels = {k: lbl for k, lbl, _ in NOTE_RULES}
    notes = d.get("notes", {})
    shown = [k for k, _l, _r in NOTE_RULES if k in notes]
    if shown:
        out.append("Что отмечено в тексте спецификации:")
        for k in shown:
            out.append(f"  • {labels[k]}: " + " | ".join(notes[k][:2]))
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python tenders/spec_digest.py spec.pdf")
        sys.exit(1)
    res = digest_pdf(sys.argv[1])
    print(json.dumps(res, ensure_ascii=False, indent=1) if res else "Не удалось прочитать PDF (нужен pymupdf)")
