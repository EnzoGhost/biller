const BASE_URL = import.meta.env.VITE_API_URL || 'https://app.angelclaims.app'

const AUTH_FLAG_KEY = 'ac_admin_authed'
const TOKEN_KEY = 'ac_admin_token'
const EMAIL_KEY = 'ac_admin_email'

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(AUTH_FLAG_KEY)
}

export function markAuthenticated(token: string, email: string): void {
  localStorage.setItem(AUTH_FLAG_KEY, '1')
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(EMAIL_KEY, email)
}

export function clearAuthenticated(): void {
  localStorage.removeItem(AUTH_FLAG_KEY)
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EMAIL_KEY)
}

export function getAdminEmail(): string {
  return localStorage.getItem(EMAIL_KEY) || 'admin'
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/admin/logout', { method: 'POST' })
  } catch {
    // ignore
  } finally {
    clearAuthenticated()
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) || ''
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (res.status === 401 || res.status === 403) {
    clearAuthenticated()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
    throw new Error(err.detail || `API error: ${res.status}`)
  }
  // Handle 204 No Content (e.g. DELETE responses)
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return {} as T
  }
  return res.json()
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function adminLogin(email: string, password: string): Promise<void> {
  const data = await apiFetch<{ token: string; email: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  markAuthenticated(data.token, data.email)
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface DashboardStats {
  total_organizations: number
  active_organizations: number
  total_users: number
  total_providers: number
  total_claims: number
  recent_claims_7d: number
  recent_users_7d: number
}

export async function fetchDashboard(): Promise<DashboardStats> {
  return apiFetch('/api/admin/dashboard')
}

// ── Organizations ─────────────────────────────────────────────────────────────

export interface Organization {
  id: number
  name: string
  slug: string | null
  subscription_tier: 'free' | 'pro' | 'enterprise'
  subscription_expires_at: string | null
  is_active: boolean
  notes: string | null
  user_count: number
  provider_count: number
  created_at: string
}

export interface OrgDetail extends Organization {
  stripe_customer_id: string | null
  updated_at: string
  users: OrgUser[]
}

export interface OrgUser {
  id: number
  email: string
  full_name: string
  role: string
  is_active: boolean
  created_at: string
}

export async function fetchOrganizations(): Promise<Organization[]> {
  const data = await apiFetch<{ organizations: Organization[] }>('/api/admin/organizations')
  return data.organizations
}

export async function fetchOrganization(id: number): Promise<OrgDetail> {
  return apiFetch(`/api/admin/organizations/${id}`)
}

export async function createOrganization(data: {
  name: string
  slug?: string
  subscription_tier?: string
}): Promise<Organization> {
  return apiFetch('/api/admin/organizations', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateOrganization(
  id: number,
  data: { name?: string; is_active?: boolean; notes?: string }
): Promise<void> {
  await apiFetch(`/api/admin/organizations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function updateSubscription(
  orgId: number,
  tier: string,
  expiresAt?: string | null
): Promise<void> {
  await apiFetch(`/api/admin/organizations/${orgId}/subscription`, {
    method: 'PATCH',
    body: JSON.stringify({ tier, expires_at: expiresAt || null }),
  })
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number
  email: string
  full_name: string
  role: string
  is_active: boolean
  organization_id: number | null
  created_at: string
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const data = await apiFetch<{ users: AdminUser[] }>('/api/admin/users')
  return data.users
}

export async function createUser(data: {
  email: string
  full_name: string
  password: string
  role?: string
  organization_id?: number | null
}): Promise<AdminUser> {
  return apiFetch('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateUser(
  id: number,
  data: { full_name?: string; is_active?: boolean; role?: string; organization_id?: number | null }
): Promise<void> {
  await apiFetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function resetUserPassword(id: number, newPassword: string): Promise<void> {
  await apiFetch(`/api/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

// ── Providers ─────────────────────────────────────────────────────────────────

export interface AdminProvider {
  id: number
  npi: string
  full_name: string
  specialty: string | null
  city: string | null
  state: string | null
  is_active: boolean
  claim_count: number
  created_at: string
}

export async function fetchProviders(): Promise<AdminProvider[]> {
  const data = await apiFetch<{ providers: AdminProvider[] }>('/api/admin/providers')
  return data.providers
}

export async function deleteProvider(id: number): Promise<void> {
  await apiFetch<void>(`/api/admin/providers/${id}`, { method: 'DELETE' })
}

export async function deleteUser(id: number): Promise<void> {
  await apiFetch<void>(`/api/admin/users/${id}`, { method: 'DELETE' })
}

export async function deleteOrganization(id: number): Promise<void> {
  await apiFetch<void>(`/api/admin/organizations/${id}`, { method: 'DELETE' })
}

// ── Admin Account ─────────────────────────────────────────────────────────────

export interface AdminMe {
  id: number
  email: string
  full_name: string
  is_super_admin: boolean
  created_at: string
}

export async function fetchAdminMe(): Promise<AdminMe> {
  return apiFetch('/api/admin/me')
}

export async function updateAdminMe(data: {
  email?: string
  full_name?: string
  current_password?: string
  new_password?: string
}): Promise<{ id: number; email: string; full_name: string; token: string }> {
  return apiFetch('/api/admin/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}
