import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Download,
  LogOut,
  QrCode,
  UserCheck,
  Wallet,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { fetchDriverProfile, logoutUser } from '@/api/client';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function DriverLayout() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(display-mode: standalone)').matches
      : false
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const profileQuery = useQuery({
    queryKey: ['driver-profile'],
    queryFn: fetchDriverProfile,
    enabled: Boolean(user) && isOnline,
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

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    navigate('/driver/login');
  };

  const modeBadgeLabel = isTier2PendingOrRejected
    ? 'Tier 2 Review'
    : isTier2
      ? 'Tier 2 Marketplace'
      : 'Driver PWA';

  return (
    <div className="font-orbit-sans orbit-page-bg relative flex min-h-screen flex-col pb-24 text-[#080e2b] md:pb-10">
      {/* Ambient soft sky clouds matching the home page */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[360px] overflow-hidden opacity-80"
      >
        <div className="orbit-animate-float-slow absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,#fffef7_18%,#eef4ff_58%,transparent_76%)] blur-2xl" />
        <div className="orbit-animate-float absolute -right-16 top-4 h-80 w-80 rounded-full bg-[radial-gradient(circle,#e4eeff_12%,#f3f7ff_55%,transparent_75%)] blur-3xl" />
      </div>

      {/* Responsive Orbit Top Bar (Desktop Command Nav + Mobile PWA Header) */}
      <header className="sticky top-0 z-30 border-b border-[#dce5fa]/85 bg-white/88 backdrop-blur-md">
        <div className="mx-auto flex h-[70px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-[78px] lg:px-8">
          {/* MeeCargo Orbit Dual-Orb Logo */}
          <Link
            to="/driver"
            className="group flex items-center gap-3 text-[21px] font-semibold tracking-[-1.2px] text-[#080e2b] sm:text-[24px]"
            aria-label="MeeCargo Driver Home"
          >
            <svg
              viewBox="0 0 38 38"
              aria-hidden="true"
              className="h-[28px] w-[28px] shrink-0 transition-transform duration-200 group-hover:scale-105 sm:h-[31px] sm:w-[31px]"
            >
              <defs>
                <radialGradient id="driver-pwa-orb" cx="30%" cy="20%">
                  <stop stopColor="#7d9efa" />
                  <stop offset="1" stopColor="#4674e9" />
                </radialGradient>
              </defs>
              <circle cx="23" cy="15" r="14" fill="url(#driver-pwa-orb)" />
              <circle cx="10" cy="27" r="8" fill="#6389f0" />
              <circle cx="15" cy="8" r="3.5" fill="#b2c7ff" opacity="0.45" />
            </svg>
            <span className="flex flex-col gap-[3px] leading-none">
              <span>meecargo</span>
              <small className="ml-[1px] text-[8px] font-medium uppercase tracking-[0.2em] text-[#7c96cc]">
                {user?.name ? `${user.name}` : 'driver pwa'}
              </small>
            </span>
          </Link>

          {/* Desktop Center Glass Pill Nav */}
          <nav
            aria-label="Driver desktop navigation"
            className="hidden items-center gap-1 rounded-full border border-[#dce5fa] bg-[#f6f9ff]/90 p-1 shadow-[0_6px_22px_-12px_rgba(24,60,115,0.22)] md:flex"
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
                      'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200',
                      isActive
                        ? 'bg-[#4673eb] text-white shadow-[0_8px_20px_-8px_rgba(70,115,235,0.75)]'
                        : 'text-[#5c6b94] hover:bg-white hover:text-[#080e2b]'
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          {/* Right Status + PWA Install + Sign Out */}
          <div className="flex items-center gap-2">
            {/* Connectivity Beacon */}
            <span
              title={isOnline ? 'Connected — Live Sync Ready' : 'Offline — IndexedDB Queue Active'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                isOnline
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              )}
            >
              {isOnline ? (
                <>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  <Wifi className="hidden h-3 w-3 sm:inline" />
                  <span className="hidden sm:inline">Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  <span>Offline</span>
                </>
              )}
            </span>

            {/* Tier / Mode Pill */}
            <span
              className={cn(
                'hidden rounded-full border px-3 py-1 text-[11px] font-semibold lg:inline-flex',
                isTier2PendingOrRejected
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-[#cddbfa] bg-[#eef3ff] text-[#3563e4]'
              )}
            >
              {modeBadgeLabel}
            </span>

            {/* Installable PWA Pill */}
            {installPrompt && !isStandalone ? (
              <button
                type="button"
                onClick={() => void handleInstallPwa()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#4673eb] px-3 py-1.5 text-[11px] font-semibold text-white shadow-xs transition hover:bg-[#345fda]"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Install App</span>
              </button>
            ) : null}

            {/* Home & Logout */}
            <Link
              to="/"
              className="hidden rounded-full border border-[#d6e0f8] bg-white px-3 py-1.5 text-[11px] font-medium text-[#4d5a83] transition hover:border-[#4673eb] hover:text-[#080e2b] sm:inline-flex"
            >
              Home
            </Link>

            <button
              type="button"
              onClick={() => void handleLogout()}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[#d6e0f8] bg-white text-[#5c6b94] transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Workspace (Balanced on Desktop, Native-Feeling on Mobile) */}
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>

      {/* Mobile PWA Bottom Dock Navigation (hidden on md+ Desktop where top pill nav shows) */}
      <nav
        aria-label="Driver bottom navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[#dce5fa] bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_36px_-18px_rgba(24,60,115,0.22)] backdrop-blur-md md:hidden"
      >
        <div
          className={cn(
            'mx-auto grid max-w-lg px-2 py-1.5',
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
                    'flex flex-col items-center justify-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition-all duration-200',
                    isActive
                      ? 'bg-[#eef3ff] text-[#3563e4] font-semibold'
                      : 'text-[#6c7da6] hover:text-[#080e2b]'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cn(
                        'h-5 w-5 transition-transform duration-200',
                        isActive && 'scale-110'
                      )}
                    />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
