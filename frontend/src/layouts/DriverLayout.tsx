import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  LogOut,
  QrCode,
  Truck,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { fetchDriverProfile, logoutUser } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { Badge } from '../components/ui/Badge';

export function DriverLayout() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const profileQuery = useQuery({
    queryKey: ['driver-profile'],
    queryFn: fetchDriverProfile,
    enabled: Boolean(user),
  });

  const profile = profileQuery.data?.driverProfile ?? null;
  const isTier2 = profile?.fleetTier === 'TIER_2';
  const isTier2PendingOrRejected =
    isTier2 && profile?.tier2ApplicationStatus !== 'APPROVED';

  const driverNav = isTier2PendingOrRejected
    ? [
        { to: '/driver', label: 'Application', icon: ClipboardCheck, end: true },
        { to: '/driver/profile', label: 'Profile', icon: UserCheck, end: false },
      ]
    : isTier2
      ? [
          { to: '/driver', label: 'Marketplace', icon: ClipboardList, end: true },
          { to: '/driver/earnings', label: 'Earnings', icon: Wallet, end: false },
          { to: '/driver/scan', label: 'Scan QR', icon: QrCode, end: false },
          { to: '/driver/profile', label: 'Profile', icon: UserCheck, end: false },
        ]
      : [
          { to: '/driver', label: 'Trips', icon: ClipboardList, end: true },
          { to: '/driver/slots', label: 'Slots', icon: CalendarClock, end: false },
          { to: '/driver/scan', label: 'Scan QR', icon: QrCode, end: false },
          { to: '/driver/profile', label: 'Profile', icon: UserCheck, end: false },
        ];

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-20">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-slate-950">
              <Truck className="h-4 w-4" />
            </div>
            <div>
              <span className="text-sm font-bold">MeeCargo Driver</span>
              <p className="text-[10px] text-slate-300">{user?.name ?? 'Driver'}</p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Badge variant={isTier2PendingOrRejected ? 'warning' : 'success'}>
              {isTier2PendingOrRejected
                ? 'TIER 2 REVIEW'
                : isTier2
                  ? 'TIER 2 MARKETPLACE'
                  : 'DRIVER PWA'}
            </Badge>
            <button
              type="button"
              onClick={() => void handleLogout()}
              aria-label="Sign out"
              className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg p-4">
        <Outlet />
      </main>

      <nav
        aria-label="Driver bottom navigation"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white"
      >
        <div
          className={cn(
            'mx-auto grid max-w-lg',
            driverNav.length === 2
              ? 'grid-cols-2'
              : driverNav.length === 3
                ? 'grid-cols-3'
                : 'grid-cols-4'
          )}
        >
          {driverNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors',
                    isActive
                      ? 'text-emerald-700'
                      : 'text-slate-500 hover:text-slate-900'
                  )
                }
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
