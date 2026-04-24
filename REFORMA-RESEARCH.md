# Puerto Rico Reforma & Billing Research

## What is Reforma?

**Reforma** (officially **Plan Vital**) is Puerto Rico's Medicaid managed care program. PR is 100% managed care — every Medicaid beneficiary is enrolled through an MCO (managed care organization).

### The 4 Reforma MCOs (Plan Vital contractors):
1. **First Medical Health Plan** — Reforma/VITAL ✅ Stedi supported
2. **Triple-S Salud** — Reforma/VITAL + Commercial ✅ Stedi supported
3. **MMM Multi Health** — Reforma/VITAL ✅ Stedi supported
4. **Plan de Salud Menonita** — Reforma/VITAL ⚠️ Need to verify on Stedi

### Medicare Advantage (Platino) plans in PR:
- Humana PR (exiting 2026!)
- Triple-S Advantage ⚠️ Stedi enrollment required
- MCS ✅ Stedi supported
- MMM Healthcare ✅ Stedi supported
- First Medical ✅ Stedi supported
- Plan de Salud Menonita — need to verify

## Reforma Claims — Key Differences

Reforma claims are essentially **Medicaid managed care claims**, but processed through the MCO (not directly to CMS). Key differences from commercial:

1. **Lower reimbursement rates** — typically 40-60% of commercial rates
2. **Prior authorization** more common
3. **Specific Reforma plan codes** — each MCO has its own plan/group numbers
4. **CMS-1500 format** — same as commercial, but with Medicaid-specific fields
5. **Timely filing** — usually 90-180 days (varies by MCO)

### First Medical Reforma Paper Claims
Your mom confirmed First Medical Reforma requires paper claims mailed in. This is unusual but common in PR for certain plan types. Our solution:
- **Option A**: Generate CMS-1500 PDF, auto-print or auto-fax via Twilio ($0.03-0.05/page)
- **Option B**: Check if Stedi can submit to First Medical's Reforma/VITAL plan electronically (Stedi ID: HMWME — "First Medical Puerto Rico Government Health Plan (VITAL)")
- **Option C**: Use Availity (Envolve's clearinghouse) as alternative electronic route

## Envolve Vision — TPA, NOT a Clearinghouse

**Important distinction**: Envolve Vision is a **Third Party Administrator (TPA)**, not a clearinghouse.

### What a TPA does:
- Manages vision benefits on behalf of insurance plans
- Sets reimbursement rates, defines covered services
- Processes and adjudicates vision claims
- Providers contract with Envolve to be "in-network" for vision plans

### How it works for your mom's clinic:
1. Patient has insurance (e.g., Triple-S, MMM, etc.)
2. That insurer contracts Envolve Vision to manage their vision benefits in PR
3. Your mom submits vision claims TO Envolve (not to the insurer directly)
4. Envolve adjudicates and pays (taking their cut — the 35% your mom mentioned)
5. Envolve uses **Availity** as their electronic clearinghouse (Payer ID: 56190)

### The 35% Cut
This is Envolve's contractual arrangement with the insurers. Your mom's clinic gets the remainder after Envolve's fee. This is standard for managed vision care — providers accept lower rates in exchange for patient volume. We can't fix this directly, but we CAN:
- Track which claims go through Envolve vs direct
- Report on the effective rate loss
- Help identify if some services can be billed directly to the insurer (medical eye exams billed as medical, not vision)

## Inmediata — Your Mom's Current Clearinghouse

Inmediata is a PR-based clearinghouse she pays **$140/month** flat rate. They handle electronic claim submission to most PR payers.

### Can Stedi Replace Inmediata?
**Partially yes, but not immediately.** Here's why:

| Factor | Stedi | Inmediata |
|--------|-------|-----------|
| PR Commercial (Triple-S, MCS, etc.) | ✅ Supported | ✅ Supported |
| Reforma/VITAL claims | ✅ First Medical VITAL on Stedi | ✅ All MCOs |
| Medicare PR | ⚠️ Enrollment required | ✅ Already set up |
| Vision via Envolve | ❓ Need to test | ✅ Already working |
| Paper-only payers | ❌ | ❌ (still paper) |
| Monthly cost | Free first 100, then $0.20/claim | $140/month flat |
| Setup effort | Low (API-based) | Already done |

### Cost Analysis — Stedi vs Inmediata

At **250 claims/month** (your mom's volume):
- **Stedi Basic (free)**: First 100 free + 150 × $0.20 = **$30/month**
- **Stedi Developer** (for API access): $500/month — **way too expensive for one clinic**
- **Inmediata**: **$140/month** flat

**⚠️ CRITICAL**: Stedi's free Basic plan only gives portal access + test API keys. To use the **production API** (which is what our biller app needs), you need the **Developer plan at $500/month**. The free tier is portal-only.

**For your mom's clinic alone**: Inmediata at $140/month is cheaper than Stedi Developer at $500/month.

**For selling to multiple clinics**: Stedi Developer becomes cost-effective if you process claims for 3+ clinics through one account.

### Recommendation:
1. **Phase 1 (pilot)**: Use Stedi Basic portal manually for testing + our app with Inmediata's SFTP integration for real claims
2. **Phase 2 (product)**: When we have multiple clinics, upgrade to Stedi Developer and route everything through API
3. **Keep Inmediata** as the production clearinghouse for now — $140/month is reasonable

## Claim Data Requirements (CMS-1500 / 837P)

Every claim needs these fields, regardless of payer:

### Patient Info (from Wink):
- Full name, DOB, gender, address
- Insurance member ID, group number
- Relationship to subscriber (self/spouse/child)
- Secondary insurance (if applicable)

### Provider Info:
- NPI (National Provider Identifier)
- Tax ID / EIN
- Provider name, address
- Taxonomy code (optometry: 152W00000X)
- License number

### Service Info (from exam/invoice):
- **Date of service**
- **CPT codes** (procedure codes) — e.g., 92014 (comprehensive eye exam)
- **ICD-10 diagnosis codes** — e.g., H52.13 (myopia)
- **Modifiers** (-LT left eye, -RT right eye, -25 significant evaluation)
- **Place of service** (11 = office)
- **Units and charges**
- **Diagnosis pointers** (which dx codes justify which CPT codes)
- **Prior authorization number** (if required)
- **Referring provider NPI** (if applicable)

### The Key AI Opportunity — What Your Mom Described:
When a patient comes with an external prescription and the clinic doesn't add the proper codes:
1. **AI scrubbing** catches missing codes BEFORE submission
2. **AI coding assistant** suggests CPT codes from the exam notes
3. **Mandatory field validation** prevents submission without required codes
4. **Smart defaults** based on exam type (e.g., comprehensive exam → 92014 + refraction 92015)

## What Wink Needs to Capture

For the biller to work seamlessly, Wink's invoice/billing screen needs:

1. **Patient insurance info** (member ID, group #, payer) — ✅ Already have insurance fields
2. **CPT codes** with dropdown/search — 🔴 NEED TO ADD
3. **ICD-10 diagnosis codes** — ✅ Already in exams, need to auto-populate in invoice
4. **Modifiers** (-LT, -RT, -25, etc.) — 🔴 NEED TO ADD
5. **Place of service** — 🔴 NEED TO ADD (default: 11)
6. **Prior auth number** — 🔴 NEED TO ADD
7. **Referring provider** — 🔴 NEED TO ADD (for referral claims)
8. **Auto-calculate from exam**: Diagnosis → CPT suggestion → invoice pre-filled

## Payment Reconciliation (ERA/835)

The check-matching pain point your mom described is called **ERA (Electronic Remittance Advice)**:
1. Payer sends 835 ERA file saying "we paid $X for claim Y"
2. Biller app matches ERA to our claims
3. Auto-posts payments, flags underpayments
4. Highlights claims that weren't paid / partially paid
5. Stedi supports ERA at $0.15/paid claim (first 100 free)

This eliminates manual check-matching entirely.
