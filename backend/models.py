"""
SQLAlchemy ORM models for Medical Biller.
"""
from __future__ import annotations
import enum
from datetime import datetime, date
from typing import Optional
from sqlalchemy import (
    String, Integer, Float, Boolean, Text, Date, DateTime,
    ForeignKey, Enum as SAEnum, JSON, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


# ── Enums ────────────────────────────────────────────────────────────────────

class ClaimStatus(str, enum.Enum):
    DRAFT = "draft"
    READY = "ready"
    SUBMITTED = "submitted"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    PAID = "paid"
    DENIED = "denied"
    APPEALED = "appealed"
    VOID = "void"


class Gender(str, enum.Enum):
    M = "M"
    F = "F"
    U = "U"


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    BILLER = "biller"
    PROVIDER = "provider"
    VIEWER = "viewer"


class PayerType(str, enum.Enum):
    COMMERCIAL = "commercial"
    MEDICARE = "medicare"
    MEDICAID = "medicaid"
    VISION = "vision"
    DENTAL = "dental"
    OTHER = "other"


class SubmissionMethod(str, enum.Enum):
    STEDI = "stedi"
    INMEDIATA = "inmediata"
    FAX = "fax"
    MAIL = "mail"


# ── Users ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), default=UserRole.BILLER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Providers ────────────────────────────────────────────────────────────────

class Provider(Base):
    __tablename__ = "providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    npi: Mapped[str] = mapped_column(String(10), unique=True, index=True, nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    specialty: Mapped[str] = mapped_column(String(100), nullable=True)
    taxonomy_code: Mapped[str] = mapped_column(String(10), nullable=True)
    license_number: Mapped[str] = mapped_column(String(50), nullable=True)
    address_line1: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str] = mapped_column(String(100), nullable=True)
    city: Mapped[str] = mapped_column(String(100), nullable=True)
    state: Mapped[str] = mapped_column(String(2), default="PR")
    zip_code: Mapped[str] = mapped_column(String(10), nullable=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    fax: Mapped[str] = mapped_column(String(20), nullable=True)
    ein: Mapped[str] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    claims: Mapped[list["Claim"]] = relationship("Claim", back_populates="provider")


# ── Payers ───────────────────────────────────────────────────────────────────

class Payer(Base):
    __tablename__ = "payers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    payer_id: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    payer_type: Mapped[PayerType] = mapped_column(SAEnum(PayerType), default=PayerType.COMMERCIAL)
    submission_method: Mapped[SubmissionMethod] = mapped_column(SAEnum(SubmissionMethod), default=SubmissionMethod.STEDI)
    stedi_payer_id: Mapped[str] = mapped_column(String(50), nullable=True)
    inmediata_payer_id: Mapped[str] = mapped_column(String(50), nullable=True)
    address_line1: Mapped[str] = mapped_column(String(255), nullable=True)
    city: Mapped[str] = mapped_column(String(100), nullable=True)
    state: Mapped[str] = mapped_column(String(2), default="PR")
    zip_code: Mapped[str] = mapped_column(String(10), nullable=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    fax_number: Mapped[str] = mapped_column(String(20), nullable=True)
    timely_filing_days: Mapped[int] = mapped_column(Integer, default=90)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_reforma: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    claims: Mapped[list["Claim"]] = relationship("Claim", back_populates="payer")
    patient_insurances: Mapped[list["PatientInsurance"]] = relationship("PatientInsurance", back_populates="payer")


# ── Patients ─────────────────────────────────────────────────────────────────

class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # External IDs
    wink_patient_id: Mapped[str] = mapped_column(String(50), nullable=True, index=True)
    mrn: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=True)
    # Demographics
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    dob: Mapped[date] = mapped_column(Date, nullable=False)
    gender: Mapped[Gender] = mapped_column(SAEnum(Gender), default=Gender.U)
    ssn_last4: Mapped[str] = mapped_column(String(4), nullable=True)
    # Contact
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    email: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line1: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str] = mapped_column(String(100), nullable=True)
    city: Mapped[str] = mapped_column(String(100), nullable=True)
    state: Mapped[str] = mapped_column(String(2), default="PR")
    zip_code: Mapped[str] = mapped_column(String(10), nullable=True)
    # Metadata
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    insurances: Mapped[list["PatientInsurance"]] = relationship("PatientInsurance", back_populates="patient")
    claims: Mapped[list["Claim"]] = relationship("Claim", back_populates="patient")


class PatientInsurance(Base):
    __tablename__ = "patient_insurances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(Integer, ForeignKey("patients.id"), nullable=False)
    payer_id: Mapped[int] = mapped_column(Integer, ForeignKey("payers.id"), nullable=False)
    member_id: Mapped[str] = mapped_column(String(50), nullable=False)
    group_number: Mapped[str] = mapped_column(String(50), nullable=True)
    subscriber_name: Mapped[str] = mapped_column(String(255), nullable=True)
    subscriber_dob: Mapped[date] = mapped_column(Date, nullable=True)
    relationship_to_subscriber: Mapped[str] = mapped_column(String(20), default="self")
    effective_date: Mapped[date] = mapped_column(Date, nullable=True)
    termination_date: Mapped[date] = mapped_column(Date, nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    patient: Mapped["Patient"] = relationship("Patient", back_populates="insurances")
    payer: Mapped["Payer"] = relationship("Payer", back_populates="patient_insurances")


# ── Claims ───────────────────────────────────────────────────────────────────

class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    # Relationships
    patient_id: Mapped[int] = mapped_column(Integer, ForeignKey("patients.id"), nullable=False)
    provider_id: Mapped[int] = mapped_column(Integer, ForeignKey("providers.id"), nullable=False)
    payer_id: Mapped[int] = mapped_column(Integer, ForeignKey("payers.id"), nullable=False)
    # Status
    status: Mapped[ClaimStatus] = mapped_column(SAEnum(ClaimStatus), default=ClaimStatus.DRAFT, index=True)
    # Dates
    service_date_from: Mapped[date] = mapped_column(Date, nullable=False)
    service_date_to: Mapped[date] = mapped_column(Date, nullable=True)
    date_of_submission: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    # CMS-1500 fields
    place_of_service: Mapped[str] = mapped_column(String(2), default="11")  # 11=office
    diagnosis_codes: Mapped[dict] = mapped_column(JSON, default=list)  # ["Z00.00", ...]
    prior_auth_number: Mapped[str] = mapped_column(String(50), nullable=True)
    referral_number: Mapped[str] = mapped_column(String(50), nullable=True)
    # Financial
    total_billed: Mapped[float] = mapped_column(Float, default=0.0)
    total_allowed: Mapped[float] = mapped_column(Float, nullable=True)
    total_paid: Mapped[float] = mapped_column(Float, default=0.0)
    patient_responsibility: Mapped[float] = mapped_column(Float, default=0.0)
    adjustment_amount: Mapped[float] = mapped_column(Float, default=0.0)
    # Clearinghouse tracking
    stedi_transaction_id: Mapped[str] = mapped_column(String(100), nullable=True)
    clearinghouse_ref: Mapped[str] = mapped_column(String(100), nullable=True)
    payer_claim_number: Mapped[str] = mapped_column(String(100), nullable=True)
    # AI
    scrub_score: Mapped[float] = mapped_column(Float, nullable=True)
    scrub_issues: Mapped[dict] = mapped_column(JSON, nullable=True)
    denial_risk_score: Mapped[float] = mapped_column(Float, nullable=True)
    # Source
    source: Mapped[str] = mapped_column(String(50), default="manual")  # manual, wink, csv
    external_ref: Mapped[str] = mapped_column(String(100), nullable=True)
    # Sale data (VistaNet line items, future use)
    sale_items: Mapped[dict] = mapped_column(JSON, nullable=True)  # [{"description": ..., "qty": ..., "price": ...}]
    # Notes
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    patient: Mapped["Patient"] = relationship("Patient", back_populates="claims")
    provider: Mapped["Provider"] = relationship("Provider", back_populates="claims")
    payer: Mapped["Payer"] = relationship("Payer", back_populates="claims")
    service_lines: Mapped[list["ServiceLine"]] = relationship("ServiceLine", back_populates="claim", cascade="all, delete-orphan")
    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="claim")
    denials: Mapped[list["Denial"]] = relationship("Denial", back_populates="claim")
    appeals: Mapped[list["Appeal"]] = relationship("Appeal", back_populates="claim")
    audit_logs: Mapped[list["AuditLog"]] = relationship("AuditLog", back_populates="claim", foreign_keys="AuditLog.claim_id")
    attachments: Mapped[list["ClaimAttachment"]] = relationship("ClaimAttachment", back_populates="claim", cascade="all, delete-orphan")


class ServiceLine(Base):
    __tablename__ = "service_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_id: Mapped[int] = mapped_column(Integer, ForeignKey("claims.id"), nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, default=1)
    cpt_code: Mapped[str] = mapped_column(String(10), nullable=False)
    modifiers: Mapped[dict] = mapped_column(JSON, default=list)  # ["-25", "-LT"]
    description: Mapped[str] = mapped_column(String(255), nullable=True)
    service_date: Mapped[date] = mapped_column(Date, nullable=True)
    place_of_service: Mapped[str] = mapped_column(String(2), default="11")
    units: Mapped[int] = mapped_column(Integer, default=1)
    billed_amount: Mapped[float] = mapped_column(Float, nullable=False)
    allowed_amount: Mapped[float] = mapped_column(Float, nullable=True)
    paid_amount: Mapped[float] = mapped_column(Float, default=0.0)
    diagnosis_pointers: Mapped[dict] = mapped_column(JSON, default=list)  # [1, 2]

    claim: Mapped["Claim"] = relationship("Claim", back_populates="service_lines")


# ── Payments ─────────────────────────────────────────────────────────────────

class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_id: Mapped[int] = mapped_column(Integer, ForeignKey("claims.id"), nullable=False)
    check_number: Mapped[str] = mapped_column(String(50), nullable=True)
    check_date: Mapped[date] = mapped_column(Date, nullable=True)
    payment_amount: Mapped[float] = mapped_column(Float, nullable=False)
    adjustment_amount: Mapped[float] = mapped_column(Float, default=0.0)
    patient_responsibility: Mapped[float] = mapped_column(Float, default=0.0)
    payment_method: Mapped[str] = mapped_column(String(20), default="eft")  # check, eft, virtual_card
    eob_data: Mapped[dict] = mapped_column(JSON, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    claim: Mapped["Claim"] = relationship("Claim", back_populates="payments")


# ── Denials & Appeals ────────────────────────────────────────────────────────

class Denial(Base):
    __tablename__ = "denials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_id: Mapped[int] = mapped_column(Integer, ForeignKey("claims.id"), nullable=False)
    denial_code: Mapped[str] = mapped_column(String(20), nullable=False)
    denial_reason: Mapped[str] = mapped_column(String(255), nullable=False)
    denial_date: Mapped[date] = mapped_column(Date, nullable=False)
    carc_code: Mapped[str] = mapped_column(String(10), nullable=True)   # Claim Adjustment Reason Code
    rarc_code: Mapped[str] = mapped_column(String(10), nullable=True)   # Remittance Advice Remark Code
    ai_analysis: Mapped[dict] = mapped_column(JSON, nullable=True)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    claim: Mapped["Claim"] = relationship("Claim", back_populates="denials")
    appeals: Mapped[list["Appeal"]] = relationship("Appeal", back_populates="denial")


# ── Audit Log ────────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_id: Mapped[int] = mapped_column(Integer, ForeignKey("claims.id"), nullable=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, default="claim")
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    old_value: Mapped[str] = mapped_column(Text, nullable=True)
    new_value: Mapped[str] = mapped_column(Text, nullable=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    user_email: Mapped[str] = mapped_column(String(255), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    claim: Mapped["Claim"] = relationship("Claim", back_populates="audit_logs", foreign_keys=[claim_id])


# ── Eligibility Checks ────────────────────────────────────────────────────────

class EligibilityCheck(Base):
    __tablename__ = "eligibility_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(Integer, ForeignKey("patients.id"), nullable=True)
    payer_id: Mapped[int] = mapped_column(Integer, ForeignKey("payers.id"), nullable=True)
    member_id: Mapped[str] = mapped_column(String(50), nullable=False)
    patient_first_name: Mapped[str] = mapped_column(String(100), nullable=True)
    patient_last_name: Mapped[str] = mapped_column(String(100), nullable=True)
    is_eligible: Mapped[bool] = mapped_column(Boolean, nullable=True)
    copay: Mapped[float] = mapped_column(Float, nullable=True)
    deductible: Mapped[float] = mapped_column(Float, nullable=True)
    deductible_met: Mapped[float] = mapped_column(Float, nullable=True)
    out_of_pocket_max: Mapped[float] = mapped_column(Float, nullable=True)
    out_of_pocket_met: Mapped[float] = mapped_column(Float, nullable=True)
    coverage_start: Mapped[date] = mapped_column(Date, nullable=True)
    coverage_end: Mapped[date] = mapped_column(Date, nullable=True)
    payer_name: Mapped[str] = mapped_column(String(255), nullable=True)
    raw_response: Mapped[dict] = mapped_column(JSON, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


# ── Prior Auth ───────────────────────────────────────────────────────────────

class PriorAuthStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"


class PriorAuth(Base):
    __tablename__ = "prior_auths"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_id: Mapped[int] = mapped_column(Integer, ForeignKey("claims.id"), nullable=True)
    payer_id: Mapped[int] = mapped_column(Integer, ForeignKey("payers.id"), nullable=True)
    payer_name: Mapped[str] = mapped_column(String(255), nullable=True)
    auth_number: Mapped[str] = mapped_column(String(100), nullable=True)
    cpt_codes: Mapped[dict] = mapped_column(JSON, default=list)  # ["92310", "92083"]
    status: Mapped[PriorAuthStatus] = mapped_column(SAEnum(PriorAuthStatus), default=PriorAuthStatus.PENDING)
    requested_date: Mapped[date] = mapped_column(Date, nullable=True)
    approved_date: Mapped[date] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Claim Templates ───────────────────────────────────────────────────────────

class ClaimTemplate(Base):
    __tablename__ = "claim_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=True)
    cpt_codes: Mapped[dict] = mapped_column(JSON, default=list)  # [{"code": "92014", "desc": "...", "units": 1, "amount": 0}]
    diagnosis_codes: Mapped[dict] = mapped_column(JSON, default=list)  # ["Z00.01", ...]
    place_of_service: Mapped[str] = mapped_column(String(2), default="11")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Clinic Settings ───────────────────────────────────────────────────────────

class ClinicSettings(Base):
    __tablename__ = "clinic_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    clinic_name: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line1: Mapped[str] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[str] = mapped_column(String(100), nullable=True)
    city: Mapped[str] = mapped_column(String(100), nullable=True)
    state: Mapped[str] = mapped_column(String(2), default="PR")
    zip_code: Mapped[str] = mapped_column(String(10), nullable=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    tax_id: Mapped[str] = mapped_column(String(20), nullable=True)  # EIN
    npi_org: Mapped[str] = mapped_column(String(10), nullable=True)  # Organizational NPI
    # Payer enrollments (JSON: [{payer_id, name, enrolled_date}])
    payer_enrollments: Mapped[dict] = mapped_column(JSON, default=list)
    # Clearinghouse credentials (stored as JSON)
    inmediata_sftp_host: Mapped[str] = mapped_column(String(255), nullable=True)
    inmediata_sftp_user: Mapped[str] = mapped_column(String(100), nullable=True)
    stedi_api_key: Mapped[str] = mapped_column(String(255), nullable=True)
    availity_client_id: Mapped[str] = mapped_column(String(255), nullable=True)
    availity_client_secret: Mapped[str] = mapped_column(String(255), nullable=True)
    # VistaNet credentials
    vistanet_username: Mapped[str] = mapped_column(String(100), nullable=True)
    vistanet_password: Mapped[str] = mapped_column(String(255), nullable=True)
    vistanet_location: Mapped[str] = mapped_column(String(100), nullable=True)
    # Setup wizard completion
    setup_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Fee Schedule ─────────────────────────────────────────────────────────────

class FeeScheduleEntry(Base):
    __tablename__ = "fee_schedule"
    __table_args__ = (UniqueConstraint('payer_id', 'cpt_code', name='uq_fee_payer_cpt'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    payer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("payers.id"), nullable=True)  # NULL = default/Medicare baseline
    cpt_code: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    allowed_amount: Mapped[float] = mapped_column(Float, default=0.0)
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # exam, diagnostic, contacts, materials
    source: Mapped[str] = mapped_column(String(50), default="manual")  # medicare, manual, learned
    effective_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    payer: Mapped[Optional["Payer"]] = relationship("Payer")


class ClaimAttachment(Base):
    __tablename__ = "claim_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_id: Mapped[int] = mapped_column(Integer, ForeignKey("claims.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    attachment_type: Mapped[str] = mapped_column(String(50), nullable=True)  # "insurance_card", "license", "signature"
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    claim: Mapped["Claim"] = relationship("Claim", back_populates="attachments")


class Appeal(Base):
    __tablename__ = "appeals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_id: Mapped[int] = mapped_column(Integer, ForeignKey("claims.id"), nullable=False)
    denial_id: Mapped[int] = mapped_column(Integer, ForeignKey("denials.id"), nullable=True)
    appeal_date: Mapped[date] = mapped_column(Date, nullable=False)
    deadline: Mapped[date] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    appeal_letter: Mapped[str] = mapped_column(Text, nullable=True)
    ai_drafted: Mapped[bool] = mapped_column(Boolean, default=False)
    supporting_docs: Mapped[dict] = mapped_column(JSON, default=list)
    outcome: Mapped[str] = mapped_column(String(50), nullable=True)
    outcome_date: Mapped[date] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    claim: Mapped["Claim"] = relationship("Claim", back_populates="appeals")
    denial: Mapped["Denial"] = relationship("Denial", back_populates="appeals")


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    claim_id: Mapped[int] = mapped_column(Integer, ForeignKey("claims.id"), nullable=False)
    patient_id: Mapped[int] = mapped_column(Integer, nullable=True)
    request_type: Mapped[str] = mapped_column(String(50), nullable=False)  # dx_change, code_suggestion, etc.
    requested_by: Mapped[str] = mapped_column(String(100), nullable=True)
    details: Mapped[str] = mapped_column(Text, nullable=True)
    suggested_codes: Mapped[dict] = mapped_column(JSON, nullable=True)  # JSON array of suggested codes
    current_code: Mapped[str] = mapped_column(String(20), nullable=True)  # code being changed
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, approved, rejected
    reviewed_by: Mapped[str] = mapped_column(String(100), nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    claim: Mapped["Claim"] = relationship("Claim")
