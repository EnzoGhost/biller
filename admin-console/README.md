# AngelClaims Admin Console

Super admin panel for managing AngelClaims organizations, users, subscriptions, and providers.

Deployed at: **admin.angelclaims.app**

## Stack

- React + Vite + TailwindCSS + TypeScript
- Connects to the AngelClaims backend at `VITE_API_URL`

## Setup

### 1. Backend Migration

Run this once on the server to create admin tables and seed the super admin user:

```bash
cd biller/backend
source .venv/bin/activate

# Optional: set custom creds
export SUPER_ADMIN_EMAIL=admin@angelclaims.app
export SUPER_ADMIN_PASSWORD=changeme123

python migrations/add_admin_tables.py
```

⚠️ **Change the password after first login!**

### 2. Local Dev

```bash
cp .env.example .env.local
# Edit VITE_API_URL if needed (default: http://localhost:8100)

npm install
npm run dev
# Opens at http://localhost:5175
```

### 3. Production Build

```bash
npm run build
# Output in dist/
```

Deploy `dist/` to `/opt/someteopr/admin-console/dist/` on the VPS.
See `nginx.conf.example` for the nginx config.

## Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Stats overview |
| Organizations | `/organizations` | List/create/manage orgs |
| Org Detail | `/organizations/:id` | Edit org + subscription |
| Users | `/users` | Create/manage users |
| Subscriptions | `/subscriptions` | Quick-edit tiers |
| Providers | `/providers` | Read-only provider list |

## Auth

- Login: `POST /api/admin/login` with `{email, password}`
- Must have `is_super_admin=true` on the User record
- Token stored in localStorage, sent as `Authorization: Bearer <token>`
- Token expires in 24h
