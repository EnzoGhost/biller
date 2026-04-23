import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const PageLoader = () => (
  <div className="flex items-center justify-center h-full p-12">
    <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

export default function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
