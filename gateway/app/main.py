from fastapi import FastAPI

from app.core.router import router_singleton
from app.routes.ai import router as ai_router

app = FastAPI(
    title="IVNautomation AI Gateway",
    description="Centralized AI orchestration layer. All workflows consume AI "
                "exclusively through this gateway.",
    version="1.0.0",
)
app.include_router(ai_router)


@app.get("/")
async def root():
    return {"status": "ok", "service": "ivnautomation-ai-gateway"}


@app.get("/health")
async def health():
    backend = await router_singleton.client.health()
    return {
        "status": "healthy" if backend else "degraded",
        "inference_backend": "up" if backend else "down",
    }


@app.on_event("shutdown")
async def shutdown():
    await router_singleton.client.close()
