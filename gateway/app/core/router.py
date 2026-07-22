"""Model router. Workflows never reference a model directly; capabilities
are mapped to logical model roles here. Swapping the underlying model is a
one-line change per role."""

from app.core.client import LlamaClient
from app.core.settings import get_settings

# capability -> logical role -> physical model
ROLE_DEFAULT = "default"

ROLE_MODEL_MAP: dict[str, str] = {
    ROLE_DEFAULT: get_settings().model,  # qwen3-8b today; replaceable
}

CAPABILITY_ROLE_MAP: dict[str, str] = {}  # per-capability overrides if needed


class ModelRouter:
    def __init__(self) -> None:
        self.client = LlamaClient()

    def resolve(self, capability: str) -> str:
        role = CAPABILITY_ROLE_MAP.get(capability, ROLE_DEFAULT)
        return ROLE_MODEL_MAP[role]

    async def chat(self, capability: str, messages: list[dict],
                   temperature: float, max_tokens: int) -> tuple[str, str]:
        model = self.resolve(capability)
        content = await self.client.chat(
            messages, model=model, temperature=temperature,
            max_tokens=max_tokens,
        )
        return content, model


router_singleton = ModelRouter()
