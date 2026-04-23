# Stedi Setup — Biller App

## Account Setup
- **Plan:** Basic (free) — 100 production transactions/month + test API keys
- **Signup:** https://portal.stedi.com/auth/sign-up-intent → Select "Basic" plan
- **No company needed** — just email
- **For production:** Will need clinic NPI + tax ID (use Rey's mom's clinic)

## What Basic Plan Includes
- Production portal access (eligibility, claims, ERAs, claim status)
- Test API keys for dev/integration testing
- Unlimited users, providers, and transaction enrollments
- 100 free production transactions/month
- Stedi Apps access

## API Endpoints
- Eligibility (270/271): `POST /healthcare/eligibility` (JSON or X12)
- Claims (837P): `POST /healthcare/claims` (professional)
- Claims (837D): `POST /healthcare/claims` (dental)
- Claim Status (276/277): `POST /healthcare/claim-status`
- ERAs (835): `GET /healthcare/reports/835`
- Payer Search: `GET /payers/search?query=...`
- Payer CSV: `GET /payers/csv`
- Base URL: `https://healthcare.us.stedi.com/2024-04-01`

## PR Payers to Verify (once we have API key)
Search each on the Payer Network or via CSV download:

| Payer | Type | Likely Covered? |
|-------|------|----------------|
| Medicare / Novitas Solutions | Federal | ✅ Yes (confirmed on Stedi blog) |
| Triple-S Salud (BCBS affiliate) | Commercial | ✅ Likely (BCBS is everywhere) |
| Humana Puerto Rico | Commercial | ✅ Likely (major national) |
| MCS Healthcare | Commercial | ⚠️ Need to verify |
| MMM Healthcare | Commercial | ⚠️ Need to verify |
| First Medical Health Plan | Commercial | ⚠️ Need to verify |
| Plan de Salud Menonita (PSM) | Commercial | ⚠️ Need to verify |
| Molina Healthcare | Commercial | ✅ Likely (national) |
| PMC Medicare Choice | Commercial | ⚠️ Need to verify |
| VSP | Vision | ✅ Likely (major national) |
| EyeMed | Vision | ✅ Likely (major national) |
| Davis Vision | Vision | ✅ Likely |
| Envolve Vision (MMM carve-out) | Vision | ⚠️ Need to verify |
| Mi Salud (Medicaid) | Government | ⚠️ Need to verify |
| TRICARE | Federal | ✅ Likely |

## Next Steps
1. Sign up at stedi.com/create-account (Rey needs to do this — needs email)
2. Generate test API key
3. Download payer CSV and verify all PR payers
4. Test mock eligibility check via API
5. Wire up the biller app to Stedi sandbox

## Key Facts
- Stedi routes through Change Healthcare and other aggregators
- 3,500+ payers supported
- They build direct connections AND use other clearinghouses as needed
- MCP server available for AI agent integration
- Redundant routes with automatic failover
- No payer ID mapping needed — they handle aliases
