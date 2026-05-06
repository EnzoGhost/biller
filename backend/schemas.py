"""Pydantic schemas for request/response validation."""
from __future__ import annotations
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Any
from datetime import datetime, date
from models import ClaimStatus, Gender, UserRole, PayerType, SubmissionMethod


# ── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


# ── Users ────────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    model_config = {"from_attributes": True}

class UserCreate(BaseModel):
    email: str
    full_name: str
    password: str
    role: UserRole = UserRole.BILLER


# ── Providers ────────────────────────────────────────────────────────────────

class ProviderOut(BaseModel):
    id: int
    npi: str
    first_name: str
    last_name: str
    specialty: Optional[str]
    taxonomy_code: Optional[str]
    license_number: Optional[str]
    address_line1: Optional[str]
    city: Optional[str]
    state: str
    zip_code: Optional[str]
    phone: Optional[str]
    fax: Optional[str]
    ein: Optional[str]
    is_active: bool
    model_config = {"from_attributes": True}

class ProviderCreate(BaseModel):
    npi: str = Field(..., min_length=10, max_length=10)
    first_name: str
    last_name: str
    specialty: Optional[str] = None
    taxonomy_code: Optional[str] = None
    license_number: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: str = "PR"
    zip_code: Optional[str] = None
    phone: Optional[str] = None
    fax: Optional[str] = None
    ein: Optional[str] = None

class ProviderUpdate(ProviderCreate):
    npi: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


# ── Payers ───────────────────────────────────────────────────────────────────

class PayerOut(BaseModel):
    id: int
    name: str
    payer_id: str
    payer_type: PayerType
    submission_method: SubmissionMethod
    stedi_payer_id: Optional[str]
    inmediata_payer_id: Optional[str]
    address_line1: Optional[str]
    city: Optional[str]
    state: str
    zip_code: Optional[str]
    phone: Optional[str]
    fax_number: Optional[str]
    timely_filing_days: int
    is_active: bool
    notes: Optional[str]
    is_reforma: bool = False
    model_config = {"from_attributes": True}

class PayerCreate(BaseModel):
    name: str
    payer_id: str
    payer_type: PayerType = PayerType.COMMERCIAL
    submission_method: SubmissionMethod = SubmissionMethod.STEDI
    stedi_payer_id: Optional[str] = None
    inmediata_payer_id: Optional[str] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: str = "PR"
    zip_code: Optional[str] = None
    phone: Optional[str] = None
    fax_number: Optional[str] = None
    timely_filing_days: int = 90
    notes: Optional[str] = None


# ── Patients ─────────────────────────────────────────────────────────────────

class PatientInsuranceOut(BaseModel):
    id: int
    payer_id: int
    payer: Optional[PayerOut] = None
    member_id: str
    group_number: Optional[str]
    subscriber_name: Optional[str]
    relationship_to_subscriber: str
    effective_date: Optional[date]
    termination_date: Optional[date]
    is_primary: bool
    ai_verified: bool = False
    ai_verified_at: Optional[datetime] = None
    model_config = {"from_attributes": True}

class PatientInsuranceCreate(BaseModel):
    payer_id: int
    member_id: str
    group_number: Optional[str] = None
    subscriber_name: Optional[str] = None
    subscriber_dob: Optional[date] = None
    relationship_to_subscriber: str = "self"
    effective_date: Optional[date] = None
    termination_date: Optional[date] = None
    is_primary: bool = True

class PatientOut(BaseModel):
    id: int
    mrn: Optional[str]
    wink_patient_id: Optional[str]
    first_name: str
    last_name: str
    dob: date
    gender: Gender
    phone: Optional[str]
    email: Optional[str]
    address_line1: Optional[str]
    city: Optional[str]
    state: str
    zip_code: Optional[str]
    is_active: bool
    insurances: List[PatientInsuranceOut] = []
    model_config = {"from_attributes": True}

class PatientCreate(BaseModel):
    first_name: str
    last_name: str
    dob: date
    gender: Gender = Gender.U
    ssn_last4: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: str = "PR"
    zip_code: Optional[str] = None
    insurances: List[PatientInsuranceCreate] = []

class PatientUpdate(PatientCreate):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    dob: Optional[date] = None


# ── Claims ───────────────────────────────────────────────────────────────────

class ServiceLineOut(BaseModel):
    id: int
    line_number: int
    cpt_code: str
    modifiers: List[str]
    description: Optional[str]
    service_date: Optional[date]
    place_of_service: str
    units: int
    billed_amount: float
    allowed_amount: Optional[float]
    paid_amount: float
    diagnosis_pointers: List[int]
    model_config = {"from_attributes": True}

class ServiceLineCreate(BaseModel):
    cpt_code: str
    modifiers: List[str] = []
    description: Optional[str] = None
    service_date: Optional[date] = None
    place_of_service: str = "11"
    units: int = 1
    billed_amount: float
    diagnosis_pointers: List[int] = [1]

class ClaimOut(BaseModel):
    id: int
    claim_number: str
    status: ClaimStatus
    patient_id: int
    provider_id: int
    payer_id: int
    patient: Optional[PatientOut] = None
    provider: Optional[ProviderOut] = None
    payer: Optional[PayerOut] = None
    service_date_from: date
    service_date_to: Optional[date]
    date_of_submission: Optional[datetime]
    place_of_service: str
    diagnosis_codes: List[str]
    prior_auth_number: Optional[str]
    referral_number: Optional[str]
    total_billed: float
    total_paid: float
    patient_responsibility: float
    scrub_score: Optional[float]
    scrub_issues: Optional[list] = None
    denial_risk_score: Optional[float]
    stedi_transaction_id: Optional[str]
    payer_claim_number: Optional[str]
    source: str
    sale_items: Optional[list] = None
    notes: Optional[str]
    service_lines: List[ServiceLineOut] = []
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

class ClaimCreate(BaseModel):
    patient_id: int
    provider_id: int
    payer_id: int
    service_date_from: date
    service_date_to: Optional[date] = None
    place_of_service: str = "11"
    diagnosis_codes: List[str] = []
    prior_auth_number: Optional[str] = None
    referral_number: Optional[str] = None
    service_lines: List[ServiceLineCreate] = []
    notes: Optional[str] = None

class ClaimUpdate(BaseModel):
    status: Optional[ClaimStatus] = None
    diagnosis_codes: Optional[List[str]] = None
    prior_auth_number: Optional[str] = None
    referral_number: Optional[str] = None
    notes: Optional[str] = None
    payer_claim_number: Optional[str] = None


# ── Payments ─────────────────────────────────────────────────────────────────

class PaymentOut(BaseModel):
    id: int
    claim_id: int
    check_number: Optional[str]
    check_date: Optional[date]
    payment_amount: float
    adjustment_amount: float
    patient_responsibility: float
    payment_method: str
    notes: Optional[str]
    posted_at: datetime
    model_config = {"from_attributes": True}

class PaymentCreate(BaseModel):
    check_number: Optional[str] = None
    check_date: Optional[date] = None
    payment_amount: float
    adjustment_amount: float = 0.0
    patient_responsibility: float = 0.0
    payment_method: str = "eft"
    eob_data: Optional[dict] = None
    notes: Optional[str] = None


# ── Denials ───────────────────────────────────────────────────────────────────

class DenialOut(BaseModel):
    id: int
    claim_id: int
    denial_code: str
    denial_reason: str
    denial_date: date
    carc_code: Optional[str]
    rarc_code: Optional[str]
    ai_analysis: Optional[dict]
    is_resolved: bool
    created_at: datetime
    model_config = {"from_attributes": True}

class DenialCreate(BaseModel):
    denial_code: str
    denial_reason: str
    denial_date: date
    carc_code: Optional[str] = None
    rarc_code: Optional[str] = None


# ── Appeals ───────────────────────────────────────────────────────────────────

class AppealOut(BaseModel):
    id: int
    claim_id: int
    denial_id: Optional[int]
    appeal_date: date
    deadline: Optional[date]
    status: str
    appeal_letter: Optional[str]
    ai_drafted: bool
    outcome: Optional[str]
    outcome_date: Optional[date]
    notes: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}

class AppealCreate(BaseModel):
    denial_id: Optional[int] = None
    appeal_date: date
    deadline: Optional[date] = None
    notes: Optional[str] = None


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_claims: int
    claims_by_status: dict
    total_billed_mtd: float
    total_paid_mtd: float
    collection_rate: float
    pending_appeals: int
    avg_days_to_pay: Optional[float]
    top_denial_reasons: List[dict]


# ── Eligibility ───────────────────────────────────────────────────────────────

class EligibilityRequest(BaseModel):
    payer_id: int
    member_id: str
    patient_dob: date
    patient_first_name: str
    patient_last_name: str
    service_type_code: str = "30"  # 30=Health Benefit Plan Coverage
    service_date: Optional[date] = None

class EligibilityResponse(BaseModel):
    is_eligible: bool
    payer_name: str
    member_id: str
    coverage_start: Optional[date]
    coverage_end: Optional[date]
    copay: Optional[float]
    deductible: Optional[float]
    deductible_met: Optional[float]
    out_of_pocket_max: Optional[float]
    out_of_pocket_met: Optional[float]
    raw_response: Optional[dict]


# ── AI ────────────────────────────────────────────────────────────────────────

class ScrubRequest(BaseModel):
    claim_id: int

class ScrubResponse(BaseModel):
    claim_id: int
    score: float  # 0–100, higher = cleaner
    issues: List[dict]
    suggestions: List[str]

class DenialAnalysisRequest(BaseModel):
    denial_id: int

class DenialAnalysisResponse(BaseModel):
    denial_id: int
    root_cause: str
    recommended_action: str
    appeal_probability: float
    appeal_letter_draft: Optional[str]

class CodingAssistRequest(BaseModel):
    description: str
    specialty: Optional[str] = None
    icd10_codes: List[str] = []

class CodingAssistResponse(BaseModel):
    suggested_cpt_codes: List[dict]
    suggested_modifiers: List[str]
    notes: str


# ── Import ────────────────────────────────────────────────────────────────────

class ImportResult(BaseModel):
    imported: int
    skipped: int
    errors: List[str]
    claims_created: List[int]


# ── Pagination ────────────────────────────────────────────────────────────────

class PaginatedResponse(BaseModel):
    items: List[Any]
    total: int
    page: int
    per_page: int
    pages: int
