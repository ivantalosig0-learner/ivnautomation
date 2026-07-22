from typing import Any
from pydantic import BaseModel, Field


class Business(BaseModel):
    name: str = Field(min_length=1)
    industry: str | None = None
    website: str | None = None
    location: str | None = None
    description: str | None = None
    extra: dict[str, Any] | None = None


class Sender(BaseModel):
    name: str
    role: str | None = None
    company: str = "Quality Cleaning Services Australia"
    phone: str | None = None


class OutreachRequest(BaseModel):
    business: Business
    sender: Sender
    contact_name: str | None = None
    notes: str | None = None


class FollowupRequest(BaseModel):
    business: Business
    sender: Sender
    original_email: str = Field(min_length=1)
    sequence_number: int = Field(ge=1, le=10)
    days_since_last_contact: int = Field(ge=0)
    contact_name: str | None = None


class WebsiteAnalysisRequest(BaseModel):
    url: str | None = None
    website_text: str = Field(min_length=20, max_length=30000)


class BusinessSummaryRequest(BaseModel):
    business: Business
    website_analysis: dict[str, Any] | None = None


class CrmNoteRequest(BaseModel):
    business_name: str
    interaction_type: str
    interaction_details: str = Field(min_length=1)
    outcome: str | None = None


class CategorizeRequest(BaseModel):
    business: Business
    website_text: str | None = Field(default=None, max_length=15000)


class SubjectLineRequest(BaseModel):
    email_body: str = Field(min_length=1)
    business_name: str | None = None
    context: str | None = None


class RewriteEmailRequest(BaseModel):
    email_body: str = Field(min_length=1)
    instructions: str = Field(min_length=1)


class OpportunityRequest(BaseModel):
    business: Business
    website_analysis: dict[str, Any] | None = None


class PainPointsRequest(BaseModel):
    business: Business
    website_analysis: dict[str, Any] | None = None


class ExtractInfoRequest(BaseModel):
    text: str = Field(min_length=1, max_length=30000)
    source: str | None = None
