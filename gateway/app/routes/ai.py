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


_OUTREACH_LINK = "https://kqualitycleaningservices.com.au/"
_OUTREACH_CAPABILITIES = {"generate_outreach", "generate_followup"}


def _append_outreach_link(result: dict) -> dict:
    data = result.get("data") if isinstance(result, dict) else None
    if isinstance(data, dict):
        body = data.get("email_body")
        if isinstance(body, str) and _OUTREACH_LINK not in body:
            data["email_body"] = f"{body.rstrip()}\n\n{_OUTREACH_LINK}"
    return result


def _make_endpoint(capability: str, model_cls: type[BaseModel]):
    async def endpoint(body: model_cls):  # type: ignore[valid-type]
        try:
            result = await execute(capability, body.model_dump(exclude_none=True))
            if capability in _OUTREACH_CAPABILITIES:
                result = _append_outreach_link(result)
            return result
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
