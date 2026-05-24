# SometeoPR — Tauri 2 Desktop App

Medical billing app for Puerto Rico, migrated from Python FastAPI + React to a Tauri 2 desktop app.

## Architecture

```
someteopr-app/
├── src/                        # React + Vite + TailwindCSS frontend
│   ├── pages/                  # All 18 pages (Dashboard, Claims, Patients, etc.)
│   ├── components/             # UI components (DatePicker, SearchableSelect, etc.)
│   ├── lib/
│   │   ├── tauri-api.ts        # All DB operations via @tauri-apps/plugin-sql
│   │   ├── api.ts              # Axios-compatible shim → routes to tauri-api.ts
│   │   ├── db.ts               # SQLite connection helper
│   │   ├── edi.ts              # X12 837P EDI generator (TypeScript)
│   │   ├── dates.ts            # Date formatting utilities
│   │   ├── cpt.ts              # CPT code search
│   │   └── icd10.ts            # ICD-10 code search
│   ├── i18n/                   # Bilingual (es/en) — identical to original
│   ├── hooks/useAuth.ts        # Local auth (no JWT, SQLite users table)
│   └── types/index.ts          # All TypeScript types
└── src-tauri/
    ├── src/lib.rs              # Minimal Rust: file I/O commands for ImPlug
    ├── migrations/
    │   ├── 001_schema.sql      # Full database schema (ported from SQLAlchemy)
    │   └── 002_seed.sql        # Seed data (10 PR payers, 3 providers, 8 patients, 7 claims)
    └── tauri.conf.json         # Tauri 2 config (1440x900 window)
```

## Key Design Decisions

1. **No Python sidecar** — pure Rust + TypeScript
2. **Frontend handles all DB calls** — via `@tauri-apps/plugin-sql` (same pattern as Wink)
3. **Minimal Rust** — only file I/O commands (write_edi_file, list_era_files, etc.)
4. **Auth simplified** — no JWT/sessions; local user login checked against SQLite `users` table
5. **EDI in TypeScript** — `lib/edi.ts` builds X12 837P files without Python

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# In another terminal, start Tauri dev
npx tauri dev
```

## Building

```bash
# Build the app
npx tauri build

# Build without installer (faster, for testing)
npx tauri build --no-bundle
```

**Note:** The Rust backend requires Rust toolchain installed. First build takes 5-15 minutes.

## Default Login

- Email: `admin@biller.pr`
- Password: `Admin1234!`

(Credentials are stored in the SQLite DB as plaintext for local desktop use.)

## ImPlug Integration

Settings → ImPlug / EDI Folders:
- **Outbound folder**: SometeoPR writes 837P EDI files here when submitting claims
- **Inbound folder**: SometeoPR watches this for 835 ERA files and auto-processes payments

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Dashboard | `/` | KPIs, attention claims, weekly trends |
| Claims | `/claims` | List/filter all claims |
| New Claim | `/claims/new` | Create claim with service lines |
| Claim Detail | `/claims/:id` | Full claim view, submit, post payment |
| Denials | `/denials` | Denial management + appeals |
| Eligibility | `/eligibility` | Check patient eligibility |
| Payers | `/payers` | Manage insurance payers |
| Providers | `/providers` | Manage billing providers |
| Patients | `/patients` | Patient demographics + insurance |
| Import | `/import` | Import CSV patients, superbills |
| Settings | `/settings` | Clinic info, Stedi, Availity, ImPlug |
| Reports | `/reports` | Revenue reports, denial rate |
| ERA | `/era` | ERA/835 file processing |
| Payments | `/payments` | Payment posting |
| Follow-Up | `/follow-up` | Claims needing attention |
| Setup Wizard | `/setup` | Initial clinic configuration |

## Seed Data

The database is pre-seeded with:
- 10 Puerto Rico payers (Triple-S, MCS, MMM, Medicare/Novitas, Envolve, ASES, etc.)
- 3 providers (Optometry/Ophthalmology)
- 8 patients with insurance
- 7 sample claims in various statuses (paid, submitted, denied, draft, etc.)

## Database

SQLite at: `~/Library/Application Support/com.angelclaims.app/angelclaims.db` (macOS)
