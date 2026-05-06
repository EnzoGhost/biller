# Account Management Features Needed — AngelClaims

These features are needed in AngelClaims but do not currently exist. Prioritized by criticality.

---

## 🔴 High Priority

### 1. Change Password
- User can update their own password from within the app
- Requires: current password confirmation + new password + confirm new password
- Invalidates all other active sessions on change

### 2. Profile Settings
- User can update: full name, email address, preferred language
- Avatar/initials auto-generated from name (already partially done)

### 3. Password Reset Flow
- "Forgot password?" link on login page
- Sends reset link to user's email (backend: `/auth/reset-password`)
- Time-limited token (e.g., 30 minutes), single-use
- Requires email delivery configured in backend

---

## 🟠 Medium Priority

### 4. User Creation / Management by Admin
- Admin role can create new users for their organization
- Form: full name, email, role (admin / biller / viewer)
- Temporary password or invite-by-email flow
- Deactivate / reactivate users (not hard delete)

### 5. Role-Based Access Control (RBAC)
- Roles: `admin`, `biller`, `viewer`
  - **admin**: full access, user management, settings
  - **biller**: create/edit claims, patients, providers, payments; no user management
  - **viewer**: read-only access to claims and reports
- Backend: enforce permissions on each API endpoint
- Frontend: hide/disable actions based on role

### 6. Session Management
- List of active sessions (device, browser, last seen, IP)
- "Revoke session" for any active session
- "Logout all other devices" action
- JWT expiration + refresh token flow (currently unclear if implemented)

---

## 🟡 Lower Priority

### 7. Organization / Clinic Settings
- Currently clinic info is in Settings page, but there's no concept of "organizations" with multiple users
- Need: Organization entity with name, address, NPI, EIN
- Multiple practices under one organization (for Multi-Practice tier)
- Users belong to an organization, not just globally

### 8. Audit Log for User Actions
- Track: who changed what, when (partially exists via `audit` module)
- Expose in Settings → Security or Admin panel
- Filter by user, action type, date range

### 9. Two-Factor Authentication (2FA)
- TOTP (Google Authenticator / Authy)
- Optional per-user, required per-org (admin setting)
- Recovery codes

---

## Backend Work Required

| Feature | Endpoint(s) needed |
|---|---|
| Change password | `POST /auth/change-password` |
| Password reset | `POST /auth/forgot-password`, `POST /auth/reset-password` |
| User CRUD | `GET/POST /users`, `PUT/DELETE /users/{id}` |
| Session list/revoke | `GET /sessions`, `DELETE /sessions/{id}` |
| Org settings | `GET/PUT /org` |
| RBAC middleware | Permission checks on all existing endpoints |

---

## Frontend Work Required

- Settings page: add **Account** tab (change password, profile)
- New **Users** page (admin only): list, create, deactivate users
- Login page: add **"Forgot password?"** link
- Password reset page (new route: `/reset-password?token=...`)
- Role-based conditional rendering throughout the app

---

*Created: 2026-05-05*
