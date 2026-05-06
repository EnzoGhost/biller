import NotificationBell from '../NotificationBell';

export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-end h-14 px-6 bg-slate-800 border-b border-slate-700">
      <NotificationBell />
    </header>
  );
}
