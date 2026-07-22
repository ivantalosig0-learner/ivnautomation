import httpx

from app.core.settings import get_settings
from app.utils.logger import get_logger

logger = get_logger("ai.client")


class InferenceError(Exception):
    pass


class LlamaClient:
    """OpenAI-compatible chat client for the llama.cpp server."""

    def __init__(self) -> None:
        s = get_settings()
        self.base_url = s.llama_url.rstrip("/")
        self.timeout = s.inference_timeout_s
        self._client = httpx.AsyncClient(timeout=self.timeout)

    async def chat(
        self,
        messages: list[dict],
        model: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool = True,
    ) -> str:
        payload: dict = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        try:
            r = await self._client.post(
                f"{self.base_url}/v1/chat/completions", json=payload
            )
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise InferenceError(f"Inference backend error: {exc}") from exc
        data = r.json()
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as exc:
            raise InferenceError("Malformed inference response") from exc

    async def health(self) -> bool:
        try:
            r = await self._client.get(f"{self.base_url}/health")
            return r.status_code == 200
        except httpx.HTTPError:
            return False

    async def close(self) -> None:
        await self._client.aclose()
