"""Адаптеры LLMProvider (ports.py). Runtime llama.cpp — опциональный extra `ai[llm-llamacpp]`."""

from .errors import LLMBusy
from .fake import EchoDraftLLM, draft_of

__all__ = ["EchoDraftLLM", "LLMBusy", "draft_of"]
