"""
Конвертация Единого классификатора происшествий (xlsx заказчика) в компактный JSON для фронта.

Запуск:
    pip install openpyxl
    python tools/classifier_to_json.py "путь/к/Классификатор_происшествий_....xlsx"

Результат: src/data/classifier.json
    services — список служб (колонки матрицы оповещения)
    types    — итоговые типы происшествий:
        id      — номер типа (Г*1000000 + п1*10000 + п2*100 + п3, как в колонке «Номер»)
        g       — группа происшествий
        s       — признаки 1..3 (как их выбирает специалист-112 в опросной карте)
        x       — дополнительные признаки (не влияют на тип)
        t       — итоговый тип происшествия
        arm     — индексы служб, которые получают карточку на АРМ-112 («карточка-112»)
        vis     — индексы служб, которые получают карточку через интеграцию (ВИС)

Упрощение: в классификаторе у части служб несколько колонок с условиями
(«выбран признак Пострадавшие», «Нет доступа» и т.п.). Здесь служба считается
оповещаемой, если заполнена хотя бы одна её колонка.
"""
import json
import sys
from pathlib import Path

import openpyxl

# Имена колонок классификатора -> короткие названия служб, как в панели «Службы» АРМ
RENAME = {
    "Классификатор МЧС": "Служба 101",
    "Классификатор МВД": "Служба 102",
    "Классификатор СМП": "Служба 103",
    "Классификатор МОСГАЗ": "Служба 104",
    "Классификатор ФСБ": "ФСБ",
    "Классификатор Мособлгаз": "Мособлгаз",
    "Гор. Хозяйство": "Гор. хозяйство",
    "ГОРМОСТ": "Гормост",
    "МОЭСК\n(ПАО \"Россети Московский регион\")": "Россети МР",
    "Деп. ЖКХ": "Деп. ЖКХ",
    "Департамент РБиПК             (ГКУ МОСБЕЗ)": "Мос.Без.",
    "Территориальные ОИВ": "Управа района",
    "Территориальные ОИВ    ТиНАО": "Поселение ТиНАО",
    "ДГП (Департамент градостроительной политики)": "ДГП",
}
NO_REACTION = {"нет реагирования"}


def main(src: str) -> None:
    ws = openpyxl.load_workbook(src, read_only=True, data_only=True).worksheets[0]
    rows = [list(r) + [None] * 100 for r in ws.iter_rows(values_only=True)]
    header = rows[0]

    # служба для каждой колонки матрицы (заголовки объединены — протягиваем вправо)
    col_service: dict[int, str] = {}
    last = None
    for i in range(14, 90):
        if header[i]:
            last = str(header[i]).strip()
        if last:
            col_service[i] = RENAME.get(last, last.replace("\n", " "))
    services = list(dict.fromkeys(col_service.values()))
    index = {name: i for i, name in enumerate(services)}

    types = []
    group = None
    for r in rows[3:]:
        if r[5]:
            group = str(r[5]).strip()
        final = r[10]
        if not final or r[6] == "Не отображается оператору 112":
            continue
        arm, vis = set(), set()
        for col, name in col_service.items():
            v = r[col]
            if v is None or str(v).strip() == "" or str(v).strip().lower() in NO_REACTION:
                continue
            (arm if "карточк" in str(v).lower() else vis).add(index[name])
        try:
            num = int(r[0]) * 1_000_000 + int(r[1]) * 10_000 + int(r[2]) * 100 + int(r[3])
        except (TypeError, ValueError):
            num = len(types) + 1
        types.append({
            "id": num,
            "g": group,
            "s": [str(x).strip() for x in r[6:9] if x and str(x).strip()],
            "x": str(r[9]).strip() if r[9] else "",
            "t": str(final).strip(),
            "arm": sorted(arm),
            "vis": sorted(vis - arm),
        })

    out = Path(__file__).resolve().parent.parent / "src" / "data" / "classifier.json"
    out.write_text(json.dumps({"services": services, "types": types}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"services: {len(services)}, types: {len(types)} -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])
