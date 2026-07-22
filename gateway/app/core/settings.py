from functools import lru_cache
from pydantic import BaseModel
import os


class Settings(BaseModel):
    llama_url: str = os.getenv("LLAMA_URL", "http://ivnautomation-llama:8080")
    model: str = os.getenv("MODEL", "qwen3-8b")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    inference_timeout_s: float = float(os.getenv("INFERENCE_TIMEOUT_S", "120"))
    max_retries: int = int(os.getenv("MAX_RETRIES", "2"))
    temperature: float = float(os.getenv("TEMPERATURE", "0.2"))
    max_tokens: int = int(os.getenv("MAX_TOKENS", "1536"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
