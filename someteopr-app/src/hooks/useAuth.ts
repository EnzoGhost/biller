import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { login as dbLogin, getUserOrgs, getUserProviders } from '../lib/tauri-api';

export interface OrgInfo {
  id: number;
  name: string;
  slug: string;
  role: string;
  subscription_tier?: string;
  subscription_status?: string;
}

export interface ProviderInfo {
  id: number;
  npi: string;
  first_name: string;
  last_name: string;
  specialty?: string;
  organization_id?: number;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  // Multi-tenancy context
  currentOrg: OrgInfo | null;
  currentProvider: ProviderInfo | null;
  organizations: OrgInfo[];
  providers: ProviderInfo[]; // providers in current org

  login: (email: string, password: string) => Promise<{
    user: User;
    organizations: OrgInfo[];
    needsOrgPicker: boolean;
  }>;
  logout: () => void;
  setUser: (user: User) => void;
  selectOrg: (org: OrgInfo) => Promise<ProviderInfo[]>;
  selectProvider: (provider: ProviderInfo) => void;
  setOrganizations: (orgs: OrgInfo[]) => void;
  setProviders: (providers: ProviderInfo[]) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      currentOrg: null,
      currentProvider: null,
      organizations: [],
      providers: [],

      login: async (email, password) => {
        const { user } = await dbLogin(email, password);
        const orgs = await getUserOrgs(user.id);
        
        let currentOrg: OrgInfo | null = null;
        let currentProvider: ProviderInfo | null = null;
        let providers: ProviderInfo[] = [];
        
        // Auto-select if single org
        if (orgs.length === 1) {
          currentOrg = orgs[0];
          providers = await getUserProviders(orgs[0].id);
          if (providers.length > 0) {
            currentProvider = providers[0];
          }
        }

        set({
          user,
          isAuthenticated: true,
          organizations: orgs,
          currentOrg,
          currentProvider,
          providers,
        });

        return {
          user,
          organizations: orgs,
          needsOrgPicker: orgs.length > 1,
        };
      },

      logout: () => {
        set({
          user: null,
          isAuthenticated: false,
          currentOrg: null,
          currentProvider: null,
          organizations: [],
          providers: [],
        });
      },

      setUser: (user) => set({ user }),

      selectOrg: async (org) => {
        const providers = await getUserProviders(org.id);
        const currentProvider = providers.length > 0 ? providers[0] : null;
        set({ currentOrg: org, providers, currentProvider });
        return providers;
      },

      selectProvider: (provider) => {
        set({ currentProvider: provider });
      },

      setOrganizations: (organizations) => set({ organizations }),
      setProviders: (providers) => set({ providers }),
    }),
    {
      name: 'angelclaims-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        currentOrg: state.currentOrg,
        currentProvider: state.currentProvider,
        organizations: state.organizations,
        providers: state.providers,
      }),
    }
  )
);
