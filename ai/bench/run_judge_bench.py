#!/usr/bin/env python3
"""Замер LLM-судьи доклада руководителю (`bridge/evaluate.py`) на сценариях фронта.

Для каждого сценария с докладом — доклады пяти видов, у каждого ожидаемые баллы «Доклада
руководителю» (из 10: 4 за звонок + 6 за факты `reportMustMention` поровну):

- `sample` — эталонный доклад: всё засчитывают уже правила;
- `meaning` — факт назван другими словами или искажён распознаванием, корней правил нет:
  засчитать должна модель (польза судьи);
- `address_only` — только адрес, о происшествии ни слова: модель не должна додумать факт;
- `wrong` — адрес и другое происшествие: модель не должна засчитать чужое;
- `empty` — «всё спокойно» и пустой разговор: ни правила, ни модель баллов за факты не дают.

В сервисе зачёт фактов судьёй выключен по умолчанию; бенч включает его
(`DDS_JUDGE_REPORT_FACTS=1`), если переменная не задана. `DDS_JUDGE_REPORT_FACTS=0` — замер
судьи без фактов (только время).

Время — весь `evaluate_card` (правила, промпт, генерация, разбор). Ответ после
`JUDGE_TIMEOUT_S` — тайм-аут, итог по правилам (`evaluatedBy == "rules"`).

    python bench/run_judge_bench.py --model /models/llm/model.gguf --threads 2 --json out.json
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import time
from typing import Any

from dds_ai.bridge.evaluate import JUDGE_TIMEOUT_S, REPORT_FACTS_ENV, evaluate_card

CHIEF = "chief-1"

# сценарии фронта (`frontend/src/data/scenarios.ts`) с обязательным докладом
SCENARIOS: dict[str, dict[str, Any]] = {
    "tree": {
        "title": "Дерево упало во дворе",
        "status": "Принята",
        "comment": "Принято. Направлена бригада Жилищника, распил и вывоз дерева.",
        "groups": [["чертановск", "58"], ["дерев"]],
        "sample": "Докладываю: Чертановская, 58, корпус 2 — во дворе упало дерево, перекрыт "
        "проезд к подъезду. Пострадавших нет. Направляю бригаду Жилищника.",
        "meaning": "Чертановская 58, во дворе повалилась старая берёза, перегородила проезд, "
        "пострадавших нет",
        "address_only": "Докладываю: Чертановская, 58, корпус 2. Подробности уточняю.",
        "wrong": "Чертановская 58 — в подъезде прорвало трубу, заливает лестницу",
    },
    "lift": {
        "title": "Застревание в лифте — дом обслуживает другая организация",
        "status": "Не принята",
        "comment": "Не обслуживаем: лифты обслуживает ООО Практика. Информация передана.",
        "groups": [["кировоградск", "22"], ["лифт"]],
        "sample": "Докладываю: Кировоградская, 22, корпус 1 — застревание в лифте, в кабине "
        "женщина, медпомощь не нужна.",
        "meaning": "Кировоградская 22, застрял лист в кабине между пятым и шестым этажом, "
        "женщина одна",
        "address_only": "Докладываю: Кировоградская, 22, корпус 1. Заявка принята.",
        "wrong": "Кировоградская 22 — во дворе упало дерево на проезд",
    },
    "alarm": {
        "title": "Сработала пожарная сигнализация — дом УК «ПИК»",
        "status": "Не принята",
        "comment": "Не обслуживаем: дом УК ПИК. Информация передана в диспетчерскую УК ПИК.",
        "groups": [["варшавск", "141"], ["сигнализац"]],
        "sample": "Докладываю: Варшавское шоссе, 141, корпус 1 — сработала пожарная "
        "сигнализация в подъезде, дыма нет.",
        "meaning": "Варшавское шоссе 141, в подъезде воет пожарная сирена, не отключается, "
        "дыма и огня нет",
        "address_only": "Докладываю: Варшавское шоссе, 141, корпус 1. Передано в УК.",
        "wrong": "Варшавское шоссе 141 — в подвале посторонние, дверь открыта",
    },
    "basement": {
        "title": "Посторонние граждане в подвале",
        "status": "Принята",
        "comment": "Принято. Направлен техник для проверки подвала и закрытия доступа.",
        "groups": [["чертановск", "48"], ["подвал"]],
        "sample": "Докладываю: Чертановская, 48, корпус 2 — в подвале посторонние, дверь "
        "открыта. Направляю техника.",
        "meaning": "Чертановская 48, в цокольном помещении под домом посторонние люди, "
        "дверь туда открыта",
        "address_only": "Докладываю: Чертановская, 48, корпус 2. Направляю техника.",
        "wrong": "Чертановская 48 — на проезде открыт люк без крышки",
    },
    "hatch": {
        "title": "Открыт люк на дворовом проезде",
        "status": "Принята",
        "comment": "Принято. Люк огорожен силами техника, принадлежность устанавливается.",
        "groups": [["россошанск", "11"], ["люк"]],
        "sample": "Докладываю: Россошанская, 11 — на дворовом проезде открыт люк, рядом "
        "дети. Направляю техника огородить.",
        "meaning": "Россошанская 11, на проезде открытый колодец без крышки, рядом ходят дети",
        "address_only": "Докладываю: Россошанская, 11. Техник выехал.",
        "wrong": "Россошанская 11 — сработала пожарная сигнализация, дыма нет",
    },
    "hot_water": {
        "title": "Прорыв трубы ГВС — заливает подъезд",
        "status": "Принята",
        "comment": "Принято. Аварийная бригада перекрыла стояк, замена участка.",
        "groups": [["днепропетровск", "7"], ["горяч", "гвс", "труб"]],
        "sample": "Докладываю: Днепропетровская, 7, корпус 2 — прорыв трубы горячей воды в "
        "подъезде, заливает лестницу. Направляю аварийную бригаду.",
        "meaning": "Днепропетровская 7, в подъезде хлещет кипяток с третьего этажа, идёт пар, "
        "заливает лестницу",
        "address_only": "Докладываю: Днепропетровская, 7, корпус 2. Бригада направлена.",
        "wrong": "Днепропетровская 7 — у подъезда наледь, люди падают",
    },
    "car": {
        "title": "Повреждён автомобиль при очистке крыши",
        "status": "Принята",
        "comment": "Принято. Направлен мастер участка для составления акта.",
        "groups": [["чертановск", "60"], ["автомоб", "машин"]],
        "sample": "Докладываю: Чертановская, 60 — при очистке крыши повреждён автомобиль, "
        "пострадавших нет. Направляю мастера составить акт.",
        "meaning": "Чертановская 60, при очистке крыши глыба льда упала на припаркованную "
        "легковушку, разбито стекло",
        "address_only": "Докладываю: Чертановская, 60. Направляю мастера.",
        "wrong": "Чертановская 60 — во дворе большая лужа после ливня",
    },
}
EMPTY = ("Всё спокойно, происшествий нет.", "Алло, слышите меня? Перезвоню позже.")
EXPECTED_POINTS = {"sample": 10, "meaning": 10, "address_only": 7, "wrong": 7, "empty": 4}


def cases() -> list[tuple[str, str, str]]:
    out = []
    for sid, sc in SCENARIOS.items():
        for kind in ("sample", "meaning", "address_only", "wrong"):
            out.append((sid, kind, sc[kind]))
    out.append(("lift", "empty", EMPTY[0]))
    out.append(("hatch", "empty", EMPTY[1]))
    return out


def request(sid: str, report: str) -> dict[str, Any]:
    sc = SCENARIOS[sid]
    events = [
        {"t": 0, "kind": "arrived"},
        {"t": 8_000, "kind": "opened"},
        {"t": 40_000, "kind": "status_set", "status": sc["status"], "comment": sc["comment"]},
        {"t": 60_000, "kind": "call_started", "contactId": CHIEF},
        {"t": 80_000, "kind": "call_ended", "contactId": CHIEF, "transcript": report},
        {"t": 90_000, "kind": "finished"},
    ]
    expected = {
        "path": [sc["status"]],
        "sample": {sc["status"]: sc["comment"]},
        "commentMustMention": [],
        "callRequired": True,
        "reportMustMention": sc["groups"],
        "sampleReport": sc["sample"],
    }
    return {
        "submittedCard": {
            "incident": {"description": ""},
            "decision": {"action": sc["status"], "reason": sc["comment"]},
            "trainingLog": {"events": events, "chiefContactIds": [CHIEF]},
        },
        "referenceCard": {"expected": expected, "scenario": {"title": sc["title"]}},
        "operatorNotes": "",
        "metrics": {"durationSeconds": 90},
    }


class Recording:
    """Обёртка провайдера: запоминает последний сырой ответ модели для разбора ошибок."""

    def __init__(self, llm: Any):
        self.llm = llm
        self.model_ref = llm.model_ref
        self.last = ""
        self.tokens = (0, 0)

    def _count(self, prompt: str, out: str) -> None:
        # без шаблона чата — оценка снизу; доля генерации видна, по ней пересчитывается время стенда
        n = lambda s: len(self.llm._llm.tokenize(s.encode(), add_bos=False))  # noqa: E731
        self.tokens = (n(prompt), n(out))

    def complete(self, prompt: str, *, max_tokens: int) -> str:
        self.last = self.llm.complete(prompt, max_tokens=max_tokens)
        self._count(prompt, self.last)
        return self.last

    def complete_json(self, prompt: str, **kw: Any) -> str:
        self.last = self.llm.complete_json(prompt, **kw)
        self._count(prompt, self.last)
        return self.last


def run(args: argparse.Namespace) -> dict[str, Any]:
    from dds_ai.llm.llamacpp_provider import LlamaCppProvider

    t0 = time.perf_counter()
    llm = Recording(LlamaCppProvider(args.model, n_ctx=args.n_ctx, n_threads=args.threads))
    load_s = time.perf_counter() - t0
    rows = []
    for sid, kind, report in cases():
        t = time.perf_counter()
        llm.last, llm.tokens = "", (0, 0)
        out = evaluate_card(request(sid, report), llm)
        took = time.perf_counter() - t
        rep = next(c for c in out["checks"] if c["id"] == "report_call")
        row = {
            "scenario": sid,
            "kind": kind,
            "points": rep["points"],
            "expected": EXPECTED_POINTS[kind],
            "by": rep["by"],
            "evaluatedBy": out["evaluatedBy"],
            "seconds": round(took, 2),
            "prompt_tokens": llm.tokens[0],
            "output_tokens": llm.tokens[1],
            "detail": rep["detail"],
            "raw": llm.last,
        }
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)

    answered = [r for r in rows if r["evaluatedBy"] == "rules+llm"]
    secs = [r["seconds"] for r in rows]
    by_kind = {}
    for kind in EXPECTED_POINTS:
        rs = [r for r in rows if r["kind"] == kind]
        by_kind[kind] = f"{sum(r['points'] == r['expected'] for r in rs)}/{len(rs)}"
    return {
        "model": os.path.basename(args.model),
        "threads": args.threads,
        "n_ctx": args.n_ctx,
        "machine": platform.machine(),
        "cpu_count": os.cpu_count(),
        "load_s": round(load_s, 1),
        "judge_timeout_s": JUDGE_TIMEOUT_S,
        "cases": len(rows),
        "llm_answered": len(answered),
        "correct": sum(r["points"] == r["expected"] for r in rows),
        "correct_by_kind": by_kind,
        # засчитала факт, которого в докладе нет
        "false_credit": sum(r["points"] > r["expected"] for r in rows),
        "seconds_median": round(statistics.median(secs), 1),
        "seconds_max": round(max(secs), 1),
        "prompt_tokens_median": statistics.median(r["prompt_tokens"] for r in rows),
        "output_tokens_median": statistics.median(r["output_tokens"] for r in rows),
        "rows": rows,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--model", required=True)
    p.add_argument("--threads", type=int, default=None)
    p.add_argument("--n-ctx", type=int, default=4096)
    p.add_argument("--json")
    args = p.parse_args()
    os.environ.setdefault(REPORT_FACTS_ENV, "1")
    report = run(args)
    summary = {k: v for k, v in report.items() if k != "rows"}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
