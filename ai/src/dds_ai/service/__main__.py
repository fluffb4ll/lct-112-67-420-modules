"""Запуск: `python -m dds_ai.service` (порт — `DDS_AI_PORT`, по умолчанию 8090).

Уровень логов — `DDS_AI_LOG_LEVEL` (по умолчанию INFO): без настройки uvicorn показывает
только свои строки, и причины отказов (например, почему не применён текст модели) не видны.
"""

import logging
import os

import uvicorn

from .app import create_app

if __name__ == "__main__":
    logging.basicConfig(
        level=os.environ.get("DDS_AI_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    uvicorn.run(
        create_app(),
        host=os.environ.get("DDS_AI_HOST", "0.0.0.0"),
        port=int(os.environ.get("DDS_AI_PORT", "8090")),
    )
