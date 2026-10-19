"""Детерминированная оценка отработки карточки ДДС — перенос `frontend/src/domain/evaluate.ts`.

Правила выведены из регламента (Памятка АРМ-112 для ДДС) и ответов заказчика: 30 с на открытие,
3 мин на отработку, верный первичный статус, обязательный комментарий к отказу, полнота
комментария, статусы хода работ, доклад руководителю, грамотность. Это нижняя граница оценки:
LLM-судья (`review.py`) может только засчитать то, что правила не узнали по ключевым словам.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from itertools import pairwise
from typing import Any

PRIMARY = ("Принята", "Не принята")
COMMENT_REQUIRED = ("Не принята", "Отказ от выполнения работ")

SKILL_LABELS = {
    "timing": "Нормативы времени",
    "zone": "Зона ответственности",
    "profile": "Профильные происшествия",
    "duplicate": "Дубли карточек",
    "refusal_comment": "Комментарий к отказу",
    "work_progress": "Статусы хода работ",
    "report": "Доклад руководителю",
    "literacy": "Грамотность текста",
}

SKILL_ADVICE = {
    "timing": "Открывайте карточку сразу при поступлении: норматив — 30 секунд, "
    "на всю отработку — 3 минуты.",
    "zone": "Проверяйте, обслуживает ли служба объект. Если нет — «Не принята» с указанием, "
    "куда передана информация (Памятка, стр. 28–30).",
    "profile": "Не отказывайтесь от профильных происшествий только потому, что реагирует другая "
    "служба (Памятка, стр. 26, 29).",
    "duplicate": "Сверяйте адрес и тип с недавними карточками в журнале. Дубль — «Не принята: "
    "дубль / реагирование по КП №…» (Памятка, стр. 30).",
    "refusal_comment": "К «Не принята» и «Отказ от выполнения работ» комментарий обязателен: "
    "причина и куда передана информация (Памятка, стр. 30).",
    "work_progress": "Отражайте ход работ статусами «Начало реагирования», «Прибытие», "
    "«Проведение работ» с комментариями (Памятка, стр. 31).",
    "report": "В докладе руководителю называйте номер карточки, адрес, что случилось "
    "и что предпринято.",
    "literacy": "Пишите комментарий с заглавной буквы, без сокращений и опечаток — его читают "
    "другие службы.",
}

_PUNCT = re.compile(r"[«»\"'“”„()\[\].,;:!?–—-]")
_SPACES = re.compile(r"\s+")

COMMON_TYPOS = {
    "сдесь": "здесь",
    "щас": "сейчас",
    "ихний": "их",
    "ложить": "класть",
    "обсолютно": "абсолютно",
    "бригадда": "бригада",
    "расспил": "распил",
    "подьезд": "подъезд",
    "обьект": "объект",
    "рабочии": "рабочие",
    "сантехнник": "сантехник",
    "аварийнная": "аварийная",
    "перидана": "передана",
    "передона": "передана",
    "предана": "передана",
    "проинформированно": "проинформировано",
}
_CAPS_ALLOWED = {"ГОРМОСТ", "МОСЛИФТ", "ЖИЛИЩНИК"}


def normalize(text: str) -> str:
    t = text.lower().replace("ё", "е")
    return _SPACES.sub(" ", _PUNCT.sub(" ", t)).strip()


def match_groups(text: str, groups: list[list[str]]) -> tuple[int, list[list[str]]]:
    """Группа синонимов (корней) упомянута, если в тексте есть хотя бы один её корень."""
    t = normalize(text)
    missing = [g for g in groups if not any(normalize(stem) in t for stem in g)]
    return len(groups) - len(missing), missing


def literacy_issues(text: str) -> list[str]:
    t = text.strip()
    if not t:
        return []
    issues: list[str] = []
    if re.match(r"^[а-яё]", t):
        issues.append("Комментарий начинается со строчной буквы")
    if re.search(r" {2,}", text):
        issues.append("Двойные пробелы")
    if re.search(r"\s[,.;:!?]", t):
        issues.append("Пробел перед знаком препинания")
    if re.search(r"[,;:][^\s\d»\")]", t):
        issues.append("Нет пробела после знака препинания")
    caps = re.findall(r"[А-ЯЁ]{5,}", t)
    if any(w not in _CAPS_ALLOWED for w in caps):
        issues.append("Текст набран прописными буквами")
    if re.search(r"[а-яё][a-z]|[a-z][а-яё]", t, re.IGNORECASE):
        issues.append("Латинские буквы внутри русского слова (раскладка)")
    words = normalize(t).split(" ")
    for prev, cur in pairwise(words):
        if len(cur) > 2 and cur == prev:
            issues.append(f"Повтор слова «{cur}»")
            break
    for w in words:
        if w in COMMON_TYPOS:
            issues.append(f"Орфография: «{w}» → «{COMMON_TYPOS[w]}»")
    if len(words) < 3:
        issues.append("Слишком короткий комментарий — информации недостаточно")
    return issues


def _lcs(a: list[str], b: list[str]) -> int:
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            dp[i][j] = (
                dp[i - 1][j - 1] + 1 if a[i - 1] == b[j - 1] else max(dp[i - 1][j], dp[i][j - 1])
            )
    return dp[len(a)][len(b)]


@dataclass
class Check:
    id: str
    title: str
    points: int
    max: int
    detail: str
    skill: str
    ref: str | None = None
    by: str = "rules"

    @property
    def ok(self) -> bool:
        return self.points == self.max

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "ok": self.ok}


@dataclass
class Norms:
    open_sec: float = 30
    total_sec: float = 180
    pass_score: int = 70


@dataclass
class Facts:
    """Что сделал обучающийся — извлечено из журнала действий фронта."""

    path: list[str]
    comments: list[str]
    status_events: list[dict[str, Any]]
    report: str
    called_chief: bool
    open_sec: float | None
    total_sec: float


@dataclass
class RuleResult:
    checks: list[Check]
    facts: Facts
    skills: list[str] = field(default_factory=list)

    @property
    def score(self) -> int:
        return sum(c.points for c in self.checks)

    def check(self, check_id: str) -> Check:
        return next(c for c in self.checks if c.id == check_id)


def extract_facts(
    events: list[dict[str, Any]],
    chief_ids: list[str],
    *,
    fallback_report: str = "",
    total_sec_hint: float | None = None,
) -> Facts:
    sets = [e for e in events if e.get("kind") == "status_set" and e.get("status")]
    opened = next((e for e in events if e.get("kind") == "opened"), None)
    finished = next((e for e in events if e.get("kind") == "finished"), None)
    last_t = (finished or (events[-1] if events else {})).get("t", 0) or 0
    calls = [e for e in events if e.get("kind") == "call_ended"]
    chief_calls = [c for c in calls if c.get("contactId") in chief_ids] if chief_ids else calls
    report = " ".join(c.get("transcript") or "" for c in chief_calls).strip() or fallback_report
    total = last_t / 1000 if last_t else (total_sec_hint or 0)
    return Facts(
        path=[e["status"] for e in sets],
        comments=[e.get("comment") or "" for e in sets if (e.get("comment") or "").strip()],
        status_events=sets,
        report=report,
        called_chief=bool(chief_calls) or (not events and bool(fallback_report)),
        open_sec=None if opened is None else opened.get("t", 0) / 1000,
        total_sec=total,
    )


def evaluate_rules(
    scenario: dict[str, Any], expected: dict[str, Any], facts: Facts, norms: Norms
) -> RuleResult:
    skills: list[str] = list(scenario.get("skills") or [])
    exp_path: list[str] = list(expected.get("path") or [])
    comment_groups: list[list[str]] = list(expected.get("commentMustMention") or [])
    report_groups: list[list[str]] = list(expected.get("reportMustMention") or [])
    call_required = bool(expected.get("callRequired"))
    sample = expected.get("sample") or {}
    path = facts.path
    checks: list[Check] = []

    # 1. Открытие карточки — 30 секунд
    mx = 10
    if facts.open_sec is None:
        pts, detail = 0, "Карточка не была открыта"
    else:
        pts = (
            mx
            if facts.open_sec <= norms.open_sec
            else 5
            if facts.open_sec <= norms.open_sec * 2
            else 0
        )
        detail = f"Открыта через {round(facts.open_sec)} с при нормативе {round(norms.open_sec)} с"
    checks.append(
        Check(
            "open_time",
            "Своевременное открытие карточки",
            pts,
            mx,
            detail,
            "timing",
            "Памятка, стр. 5, 21",
        )
    )

    # 2. Первичный статус
    mx = 30
    want = exp_path[0] if exp_path else "Принята"
    skill = "duplicate" if "duplicate" in skills else "zone" if want == "Не принята" else "profile"
    first = next((s for s in path if s in PRIMARY), None)
    if first is None:
        pts, detail = 0, f"Первичный статус не проставлен. Ожидался «{want}»"
    elif first == want:
        pts, detail = mx, f"Проставлен «{want}» — верно"
    elif want in path:
        pts, detail = 10, f"Сначала проставлен «{first}», затем исправлено на «{want}»"
    else:
        pts, detail = 0, f"Проставлен «{first}», а следовало «{want}»"
    checks.append(
        Check(
            "primary_status",
            "Правильный первичный статус",
            pts,
            mx,
            detail,
            skill,
            "Памятка, стр. 26, 28–29",
        )
    )

    # 3. Обязательный комментарий к отказу
    mx = 10
    needing = [e for e in facts.status_events if e["status"] in COMMENT_REQUIRED]
    empty = [e for e in needing if not (e.get("comment") or "").strip()]
    if not needing:
        pts, detail = mx, "Статусы, требующие комментария, не проставлялись"
    elif empty:
        pts, detail = 0, "Без комментария: " + ", ".join(f"«{e['status']}»" for e in empty)
    else:
        pts, detail = mx, "Комментарии к отказу внесены"
    checks.append(
        Check(
            "comment_required",
            "Комментарий к «Не принята» / «Отказ»",
            pts,
            mx,
            detail,
            "refusal_comment",
            "Памятка, стр. 21–22, 30",
        )
    )

    # 4. Полнота комментариев
    mx = 15
    hit, missing = match_groups(" ".join(facts.comments), comment_groups)
    total = len(comment_groups)
    pts = mx if total == 0 else round(hit / total * mx)
    skill = (
        "refusal_comment"
        if "refusal_comment" in skills
        else "work_progress"
        if "work_progress" in skills
        else "profile"
    )
    if total == 0:
        detail = "Особых требований к тексту нет"
    elif not missing:
        detail = "Все ключевые сведения указаны"
    else:
        first_sample = next(iter(sample.values()), "")
        detail = (
            "Не указано: "
            + ", ".join(f"«{g[0]}…»" for g in missing)
            + f". Эталон: «{first_sample}»"
        )
    checks.append(
        Check(
            "comment_content", "Полнота комментария", pts, mx, detail, skill, "Памятка, стр. 26, 30"
        )
    )

    # 5. Последовательность статусов
    mx = 15
    common = _lcs(path, exp_path)
    extra = [s for s in path if s not in exp_path]
    pts = round(common / len(exp_path) * mx) if exp_path else mx
    if extra:
        pts = max(0, pts - 5)
    detail = (
        "Проставлено: "
        + (" → ".join(f"«{s}»" for s in path) if path else "—")
        + ". Эталон: "
        + " → ".join(f"«{s}»" for s in exp_path)
        + (". Лишние статусы: " + ", ".join(f"«{s}»" for s in extra) if extra else "")
    )
    checks.append(
        Check(
            "path",
            "Статусы хода реагирования",
            pts,
            mx,
            detail,
            "work_progress",
            "Памятка, стр. 21–25, 31",
        )
    )

    # 6. Доклад руководителю
    mx = 10
    if not call_required:
        pts = mx
        detail = (
            "Доклад выполнен (по сценарию не обязателен)"
            if facts.called_chief
            else "Доклад по сценарию не требовался"
        )
    elif not facts.called_chief:
        pts, detail = 0, "Не было доклада руководителю смены"
    else:
        hit, missing = match_groups(facts.report, report_groups)
        pts = 4 + round(hit / (len(report_groups) or 1) * 6)
        detail = (
            "В докладе не прозвучало: " + ", ".join(f"«{g[0]}…»" for g in missing)
            if missing
            else "Доклад содержит всё необходимое"
        )
    checks.append(
        Check(
            "report_call", "Доклад руководителю", pts, mx, detail, "report", "Q&A заказчика, п. 6"
        )
    )

    # 7. Время отработки
    mx = 5
    t = facts.total_sec
    pts = mx if t <= norms.total_sec else 2 if t <= norms.total_sec * 1.5 else 0
    checks.append(
        Check(
            "total_time",
            "Время отработки",
            pts,
            mx,
            f"{round(t)} с при нормативе {round(norms.total_sec)} с",
            "timing",
            "Q&A заказчика, п. 13",
        )
    )

    # 8. Грамотность
    mx = 5
    issues = [i for c in facts.comments for i in literacy_issues(c)]
    if not facts.comments:
        pts, detail = mx, "Комментариев нет"
    else:
        pts = mx if not issues else 3 if len(issues) == 1 else 1
        detail = "; ".join(issues) if issues else "Замечаний нет"
    checks.append(Check("literacy", "Грамотность комментариев", pts, mx, detail, "literacy"))

    return RuleResult(checks=checks, facts=facts, skills=skills)
