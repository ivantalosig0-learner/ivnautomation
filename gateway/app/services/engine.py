import json
import time
import uuid
from typing import Any

from app.core.client import InferenceError
from app.core.router import router_singleton
from app.core.settings import get_settings
from app.prompts import PROMPTS
from app.utils.logger import get_logger
from app.utils.validator import ResponseParseError, extract_json, require_keys

logger = get_logger("ai.engine")


class ExecutionError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


async def execute(capability: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Run a capability: prompt lookup -> inference -> parse -> validate.
    Retries on backend failure and on malformed JSON output."""
    spec = PROMPTS.get(capability)
    if spec is None:
        raise ExecutionError(f"Unknown capability: {capability}", 404)

    request_id = str(uuid.uuid4())
    messages = [
        {"role": "system", "content": spec.system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    settings = get_settings()
    attempts = 0
    start = time.monotonic()
    last_error: Exception | None = None

    while attempts <= settings.max_retries:
        attempts += 1
        try:
            raw, model = await router_singleton.chat(
                capability, messages,
                temperature=spec.temperature, max_tokens=spec.max_tokens,
            )
            data = extract_json(raw)
            require_keys(data, spec.required_keys)
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.info("capability executed", extra={"meta": {
                "request_id": request_id, "capability": capability,
                "prompt_version": spec.version, "model": model,
                "attempts": attempts, "latency_ms": latency_ms,
            }})
            return {
                "success": True,
                "capability": capability,
                "prompt_version": spec.version,
                "data": data,
                "meta": {
                    "request_id": request_id,
                    "attempts": attempts,
                    "latency_ms": latency_ms,
                },
            }
        except ResponseParseError as exc:
            last_error = exc
            messages = messages[:2] + [{
                "role": "user",
                "content": "Previous response was invalid. Respond again with "
                           "ONLY the specified valid JSON object.",
            }]
        except InferenceError as exc:
            last_error = exc

    latency_ms = int((time.monotonic() - start) * 1000)
    logger.error("capability failed", extra={"meta": {
        "request_id": request_id, "capability": capability,
        "attempts": attempts, "latency_ms": latency_ms,
        "error": str(last_error),
    }})
    raise ExecutionError(f"AI execution failed after {attempts} attempts: {last_error}")
