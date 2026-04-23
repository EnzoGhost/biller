export type ClaimStatus =
  | 'draft' | 'ready' | 'submitted' | 'accepted'
  | 'rejected' | 'paid' | 'denied' | 'appealed' | 'void';

export type Gender = 'M' | 'F' | 'U';
export type UserRole = 'admin' | 'biller' | 'provider' | 'viewer';
export type PayerType = 'commercial' | 'medicare' | 'medicaid' | 'vision' | 'dental' | 'other';
export type SubmissionMethod = 'stedi' | 'inmediata' | 'fax' | 'mail';

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}

export interface Provider {
  id: number;
  npi: string;
  first_name: string;
  last_name: string;
  specialty?: string;
  taxonomy_code?: string;
  license_number?: string;
  address_line1?: string;
  city?: string;
  state: string;
  zip_code?: string;
  phone?: string;
  fax?: string;
  ein?: string;
  is_active: boolean;
}

export interface Payer {
  id: number;
  name: string;
  payer_id: string;
  payer_type: PayerType;
  submission_method: SubmissionMethod;
  stedi_payer_id?: string;
  inmediata_payer_id?: string;
  address_line1?: string;
  city?: string;
  state: string;
  zip_code?: string;
  phone?: string;
  fax_number?: string;
  timely_filing_days: number;
  is_active: boolean;
  notes?: string;
}

export interface PatientInsurance {
  id: number;
  payer_id: number;
  payer?: Payer;
  member_id: string;
  group_number?: string;
  subscriber_name?: string;
  relationship_to_subscriber: string;
  effective_date?: string;
  termination_date?: string;
  is_primary: boolean;
}

export interface Patient {
  id: number;
  mrn?: string;
  wink_patient_id?: string;
  first_name: string;
  last_name: string;
  dob: string;
  gender: Gender;
  phone?: string;
  email?: string;
  address_line1?: string;
  city?: string;
  state: string;
  zip_code?: string;
  is_active: boolean;
  insurances: PatientInsurance[];
}

export interface ServiceLine {
  id: number;
  line_number: number;
  cpt_code: string;
  modifiers: string[];
  description?: string;
  service_date?: string;
  place_of_service: string;
  units: number;
  billed_amount: number;
  allowed_amount?: number;
  paid_amount: number;
  diagnosis_pointers: number[];
}

export interface Claim {
  id: number;
  claim_number: string;
  status: ClaimStatus;
  patient_id: number;
  provider_id: number;
  payer_id: number;
  patient?: Patient;
  provider?: Provider;
  payer?: Payer;
  service_date_from: string;
  service_date_to?: string;
  date_of_submission?: string;
  place_of_service: string;
  diagnosis_codes: string[];
  prior_auth_number?: string;
  referral_number?: string;
  total_billed: number;
  total_paid: number;
  patient_responsibility: number;
  scrub_score?: number;
  denial_risk_score?: number;
  stedi_transaction_id?: string;
  payer_claim_number?: string;
  source: string;
  notes?: string;
  service_lines: ServiceLine[];
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  claim_id: number;
  check_number?: string;
  check_date?: string;
  payment_amount: number;
  adjustment_amount: number;
  patient_responsibility: number;
  payment_method: string;
  notes?: string;
  posted_at: string;
}

export interface Denial {
  id: number;
  claim_id: number;
  denial_code: string;
  denial_reason: string;
  denial_date: string;
  carc_code?: string;
  rarc_code?: string;
  ai_analysis?: Record<string, unknown>;
  is_resolved: boolean;
  created_at: string;
}

export interface Appeal {
  id: number;
  claim_id: number;
  denial_id?: number;
  appeal_date: string;
  deadline?: string;
  status: string;
  appeal_letter?: string;
  ai_drafted: boolean;
  outcome?: string;
  outcome_date?: string;
  notes?: string;
  created_at: string;
}

export interface DashboardStats {
  total_claims: number;
  claims_by_status: Record<ClaimStatus, number>;
  total_billed_mtd: number;
  total_paid_mtd: number;
  collection_rate: number;
  pending_appeals: number;
  top_denial_reasons: Array<{ reason: string; count: number }>;
  recent_claims: Array<{
    id: number;
    claim_number: string;
    status: ClaimStatus;
    total_billed: number;
    service_date_from: string;
  }>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}
