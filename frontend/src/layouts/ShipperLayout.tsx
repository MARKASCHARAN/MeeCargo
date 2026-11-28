import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Building2,
  ClipboardList,
  FileSpreadsheet,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Route as RouteIcon,
  X,
  Zap,
} from 'lucide-react';
import { logoutUser } from '@/api/client';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';

const shipperNav = [
  { to: '/shipper', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/shipper/corridors', label: 'Corridors & Pools', icon: RouteIcon, end: false },
  { to: '/shipper/book', label: 'Book Shipment', icon: PackagePlus, end: false },
  { to: '/shipper/express', label: 'Express (One-Way)', icon: Zap, end: false },
  { to: '/shipper/shipments', label: 'Shipments', icon: ClipboardList, end: false },
  { to: '/shipper/import', label: 'CSV Import', icon: FileSpreadsheet, end: false },
  { to: '/shipper/profile', label: 'Business Profile', icon: Building2, end: false },
];

export function ShipperLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  return (
    <div className="font-orbit-sans orbit-page-bg relative min-h-screen text-[#080e2b] md:flex">
      {/* Subtle Ambient Sky Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[360px] overflow-hidden opacity-75"
      >
        <div className="orbit-animate-float-slow absolute -right-20 -top-20 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(70,115,235,0.12),transparent_72%)] blur-3xl" />
      </div>

      {/* Obsidian Black Desktop Sidebar */}
      <aside className="relative z-20 hidden w-72 shrink-0 flex-col border-r border-[#1a223d] bg-[#080b14] text-white md:flex">
        <div className="flex h-[82px] items-center justify-between border-b border-white/10 px-6">
          <Link to="/" className="group inline-flex items-center gap-3 text-[23px] font-semibold tracking-[-1.3px] text-white">
            <svg
              viewBox="0 0 38 38"
              aria-hidden="true"
              className="h-[30px] w-[30px] shrink-0 transition-transform duration-200 group-hover:scale-105"
            >
              <defs>
                <radialGradient id="shipper-orb-dark" cx="30%" cy="20%">
                  <stop stopColor="#8faeff" />
                  <stop offset="1" stopColor="#4674e9" />
                </radialGradient>
              </defs>
              <circle cx="23" cy="15" r="14" fill="url(#shipper-orb-dark)" />
              <circle cx="10" cy="27" r="8" fill="#6389f0" />
              <circle cx="15" cy="8" r="3.5" fill="#d9e4ff" opacity="0.55" />
            </svg>
            <span className="flex flex-col gap-[3px] leading-none">
              <span>meecargo</span>
              <small className="ml-[1px] text-[8px] font-medium uppercase tracking-[0.22em] text-[#8ea5e2]">
                shipper portal
              </small>
            </span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1.5 px-4 py-5" aria-label="Shipper navigation">
          {shipperNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-2xl px-4 py-2.5 text-[13px] font-medium transition-all duration-200',
                    isActive
                      ? 'bg-white text-[#080b14] font-semibold shadow-[0_10px_28px_-10px_rgba(255,255,255,0.45)]'
                      : 'text-[#9aa7c7] hover:bg-white/8 hover:text-white'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive ? 'text-[#4673eb]' : 'text-[#7c8cb5]'
                      )}
                    />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="mb-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
            <p className="truncate text-xs font-semibold text-white">
              {user?.businessName ?? user?.name ?? 'Shipper Account'}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#8ea0c7]">{user?.email}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-medium text-[#cfd8ee] transition hover:border-white/30 hover:text-white"
            >
              <Home className="h-3.5 w-3.5" />
              Home
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-medium text-[#cfd8ee] transition hover:border-rose-400/50 hover:bg-rose-500/15 hover:text-rose-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* Top Glass Header */}
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[#dce5fa]/90 bg-white/88 px-4 backdrop-blur-md sm:px-6 lg:h-[82px] lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#dce5fa] bg-white text-[#080b14] transition hover:bg-[#f4f7ff] md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>

            <Link to="/shipper" className="flex items-center gap-2 md:hidden">
              <svg viewBox="0 0 38 38" aria-hidden="true" className="h-6 w-6">
                <circle cx="23" cy="15" r="14" fill="#4674e9" />
                <circle cx="10" cy="27" r="8" fill="#080b14" />
              </svg>
              <span className="text-base font-semibold tracking-tight text-[#080b14]">
                meecargo
              </span>
            </Link>

            <div className="hidden items-center gap-2.5 md:flex">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#080b14] px-3.5 py-1 text-[11px] font-semibold tracking-wide text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-[#6d94ff]" />
                B2B Shipper Workspace
              </span>
              {user?.businessName ? (
                <span className="text-xs font-medium text-[#4d5a83]">{user.businessName}</span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {user?.email ? (
              <span className="hidden truncate rounded-full border border-[#dce5fa] bg-[#f8faff] px-3 py-1 text-[11px] font-medium text-[#4d5a83] sm:inline">
                {user.email}
              </span>
            ) : null}
            <Link
              to="/shipper/book"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#080b14] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#192038]"
            >
              <PackagePlus className="h-3.5 w-3.5 text-[#7d9efa]" />
              <span>New Booking</span>
            </Link>
          </div>
        </header>

        {/* Mobile Drawer Navigation */}
        {mobileOpen ? (
          <nav className="border-b border-[#1f2945] bg-[#080b14] p-4 text-white md:hidden">
            <div className="space-y-1.5">
              {shipperNav.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium transition',
                        isActive
                          ? 'bg-white text-[#080b14] font-semibold'
                          : 'text-[#a5b2d2] hover:bg-white/10 hover:text-white'
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                );
              })}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Link
                  to="/"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white"
                >
                  <Home className="h-3.5 w-3.5" />
                  Home
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="flex items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-200"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </div>
          </nav>
        ) : null}

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
