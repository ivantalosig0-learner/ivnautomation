import json
import re
from typing import Any

THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


class ResponseParseError(Exception):
    pass


def extract_json(raw: str) -> dict[str, Any]:
    """Extract a JSON object from model output. Handles think blocks,
    code fences, and leading/trailing prose."""
    text = THINK_RE.sub("", raw).strip()
    fence = FENCE_RE.search(text)
    if fence:
        text = fence.group(1).strip()
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            obj = json.loads(text[start : end + 1])
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass
    raise ResponseParseError("Model output is not valid JSON")


def require_keys(obj: dict[str, Any], keys: list[str]) -> None:
    missing = [k for k in keys if k not in obj]
    if missing:
        raise ResponseParseError(f"Missing required keys: {missing}")
