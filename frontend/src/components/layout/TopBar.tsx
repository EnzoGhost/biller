import NotificationBell from '../NotificationBell';

export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-end h-14 px-6 bg-white border-b border-slate-100">
      <NotificationBell />
    </header>
  );
}
