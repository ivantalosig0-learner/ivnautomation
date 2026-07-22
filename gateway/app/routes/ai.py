from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import schemas
from app.prompts import PROMPTS
from app.services.engine import ExecutionError, execute

router = APIRouter(prefix="/v1/ai", tags=["ai"])

# (path, capability, request model)
_ROUTES: list[tuple[str, str, type[BaseModel]]] = [
    ("/outreach/initial", "generate_outreach", schemas.OutreachRequest),
    ("/outreach/followup", "generate_followup", schemas.FollowupRequest),
    ("/website/analyze", "website_analysis", schemas.WebsiteAnalysisRequest),
    ("/business/summary", "business_summary", schemas.BusinessSummaryRequest),
    ("/crm/note", "crm_note", schemas.CrmNoteRequest),
    ("/business/categorize", "categorize_business", schemas.CategorizeRequest),
    ("/email/subject-lines", "subject_line", schemas.SubjectLineRequest),
    ("/email/rewrite", "rewrite_email", schemas.RewriteEmailRequest),
    ("/analysis/cleaning-opportunities", "cleaning_opportunity", schemas.OpportunityRequest),
    ("/analysis/pain-points", "pain_points", schemas.PainPointsRequest),
    ("/extract/business-info", "extract_business_info", schemas.ExtractInfoRequest),
]


def _make_endpoint(capability: str, model_cls: type[BaseModel]):
    async def endpoint(body: model_cls):  # type: ignore[valid-type]
        try:
            return await execute(capability, body.model_dump(exclude_none=True))
        except ExecutionError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc))
    endpoint.__name__ = capability
    return endpoint


for path, capability, model_cls in _ROUTES:
    router.add_api_route(path, _make_endpoint(capability, model_cls),
                         methods=["POST"], name=capability)


@router.get("/capabilities")
async def capabilities():
    return {
        "capabilities": [
            {
                "capability": cap,
                "endpoint": f"/v1/ai{path}",
                "prompt_version": PROMPTS[cap].version,
                "prompt_id": PROMPTS[cap].full_id,
            }
            for path, cap, _ in _ROUTES
        ]
    }
