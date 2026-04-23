import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppShell from './components/layout/AppShell';
import { useAuthStore } from './hooks/useAuth';

// Pages (lazy)
const LoginPage        = lazy(() => import('./pages/LoginPage'));
const DashboardPage    = lazy(() => import('./pages/DashboardPage'));
const ClaimsPage       = lazy(() => import('./pages/ClaimsPage'));
const ClaimDetailPage  = lazy(() => import('./pages/ClaimDetailPage'));
const NewClaimPage     = lazy(() => import('./pages/NewClaimPage'));
const DenialsPage      = lazy(() => import('./pages/DenialsPage'));
const EligibilityPage  = lazy(() => import('./pages/EligibilityPage'));
const PayersPage       = lazy(() => import('./pages/PayersPage'));
const ProvidersPage    = lazy(() => import('./pages/ProvidersPage'));
const PatientsPage     = lazy(() => import('./pages/PatientsPage'));
const ImportPage       = lazy(() => import('./pages/ImportPage'));
const SettingsPage     = lazy(() => import('./pages/SettingsPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const PageLoader = () => (
  <div className="flex items-center justify-center h-full p-12">
    <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="claims" element={<ClaimsPage />} />
              <Route path="claims/new" element={<NewClaimPage />} />
              <Route path="claims/:id" element={<ClaimDetailPage />} />
              <Route path="denials" element={<DenialsPage />} />
              <Route path="eligibility" element={<EligibilityPage />} />
              <Route path="payers" element={<PayersPage />} />
              <Route path="providers" element={<ProvidersPage />} />
              <Route path="patients" element={<PatientsPage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="settings" element={<SettingsPage />} />
              {/* fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
