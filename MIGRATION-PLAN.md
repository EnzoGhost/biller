# SometeoPR Migration Plan: Web App → Tauri Desktop App

## Overview
Convert SometeoPR from a Python FastAPI + React web app to a Tauri 2 desktop app with Rust backend commands + same React frontend.

## Current Stack
- **Backend:** Python FastAPI (~8K lines) — SQLite, EDI generation, API integrations
- **Frontend:** React + Vite + TailwindCSS + TypeScript (~8K lines) — full billing UI
- **i18n:** es/en via i18next (already done)
- **Database:** SQLite via SQLAlchemy

## Target Stack
- **Shell:** Tauri 2 (Rust)
- **Frontend:** Same React + Vite + TailwindCSS (minimal changes)
- **Backend:** Tauri Rust commands (replaces FastAPI routes)
- **Database:** SQLite via rusqlite or sqlx (Tauri plugin)
- **EDI:** @stedi/x12 NPM package (local 837P generation, replaces Python edi/)
- **File I/O:** Tauri fs plugin (write 837 to ImPlug folder, read 835 ERAs)

## Migration Phases

### Phase 1: Scaffold Tauri App
- [ ] Init Tauri 2 project wrapping existing frontend
- [ ] Configure for macOS + Windows builds
- [ ] Set up Tauri SQLite plugin
- [ ] Create database schema in Rust (mirror models.py)
- [ ] Seed data migration

### Phase 2: Port Backend Routes → Tauri Commands
Each FastAPI router becomes a Tauri command module:

| Python Router | Tauri Command Module | Complexity |
|---|---|---|
| auth.py (44 lines) | commands/auth.rs | Low — local auth only |
| patients.py (139) | commands/patients.rs | Low — CRUD |
| payers.py (79) | commands/payers.rs | Low — CRUD |
| providers.py (84) | commands/providers.rs | Low — CRUD |
| claims.py (351) | commands/claims.rs | Medium — core CRUD + status |
| dashboard.py (319) | commands/dashboard.rs | Medium — aggregation queries |
| denials.py (143) | commands/denials.rs | Low — CRUD + filters |
| payments.py (371) | commands/payments.rs | Medium — reconciliation logic |
| audit.py (103) | commands/audit.rs | Low — log queries |
| templates.py (236) | commands/templates.rs | Low — CRUD |
| prior_auth.py (183) | commands/prior_auth.rs | Low — CRUD |
| followup.py (239) | commands/followup.rs | Low — CRUD + queue |
| clinic.py (196) | commands/clinic.rs | Low — settings CRUD |
| imports.py (792) | commands/imports.rs | High — CSV parsing, Wink import |
| validation.py (394) | commands/validation.rs | Medium — claim scrubbing rules |
| ai.py (317) | commands/ai.rs | Medium — LLM API calls |
| stedi.py (481) | commands/edi.rs | High — port to @stedi/x12 JS |
| inmediata.py (456) | commands/inmediata.rs | High — ImPlug folder integration |
| availity.py (401) | commands/availity.rs | High — OAuth2 + API |

### Phase 3: Frontend Adaptation
- [ ] Replace all `fetch('/api/...')` calls with Tauri `invoke()` commands
- [ ] Create `src/lib/tauri-api.ts` wrapper (drop-in replacement for api.ts)
- [ ] Remove auth token handling (local app, no JWT needed)
- [ ] Add ImPlug folder picker in Settings
- [ ] Add ERA file watcher integration
- [ ] Keep all UI components as-is (DatePicker, SearchableSelect, etc.)
- [ ] Keep i18n as-is

### Phase 4: ImPlug Integration
- [ ] Settings page: configure ImPlug outbound/inbound folder paths
- [ ] Write 837 files to outbound folder on claim submit
- [ ] Watch inbound folder for 835 ERA files
- [ ] Parse ERA files and update claim statuses automatically
- [ ] Notification when ERA arrives

### Phase 5: Polish & Build
- [ ] Windows build + testing
- [ ] macOS build + testing  
- [ ] Auto-updater (Tauri built-in)
- [ ] App icon + branding
- [ ] Installer packaging

## Key Decisions
- **No Python sidecar** — clean Rust backend, cross-platform without Python dependency
- **EDI generation moves to frontend/JS** — @stedi/x12 NPM package, invoked from Tauri command or frontend
- **Auth simplified** — no JWT, no sessions. Local app = local user. Optional PIN/password for launch.
- **ImPlug paths stored in app config** — user picks folders once in settings
- **angelclaims.com** — marketing site + download page

## Files to Reference (Wink patterns)
- Wink Tauri config: check wink-app/ for Tauri 2 setup patterns
- Wink SQLite: check how Wink handles local DB
- Wink updater: check Wink's tauri.conf.json for auto-update config
