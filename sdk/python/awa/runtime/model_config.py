"""
The default model reference, read from one configuration: the environment
variable AWA_DEFAULT_AI_MODEL_ID, else `default_ai_model_id` in awa/config.json, the same
setting and value as the TypeScript SDK (see .agent/rules/ai-rules.md).
The engine default, the AI agent default and the judge default all use it.
"""

import json
import os
from pathlib import Path

_CONFIG_FILE = Path(__file__).resolve().parents[1] / "config.json"


def _configured() -> str:
    try:
        value = json.loads(_CONFIG_FILE.read_text(encoding="utf-8")).get("default_ai_model_id")
    except (OSError, ValueError):
        value = None
    return value if isinstance(value, str) and value else "gemini-3-flash-preview"


DEFAULT_AI_MODEL_ID: str = os.environ.get("AWA_DEFAULT_AI_MODEL_ID") or _configured()
