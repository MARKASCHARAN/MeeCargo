import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Building2,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Route as RouteIcon,
  Truck,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { logoutUser } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

const shipperNav = [
  { to: '/shipper', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/shipper/corridors', label: 'Corridors & Pools', icon: RouteIcon, end: false },
  { to: '/shipper/book', label: 'Book Shipment', icon: PackagePlus, end: false },
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
    <div className="min-h-screen bg-slate-50 md:flex">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <Link to="/" className="text-base font-bold tracking-tight text-slate-900">
              MeeCargo
            </Link>
            <p className="text-[11px] font-medium text-emerald-700">Shipper Portal</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Shipper navigation">
          {shipperNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3">
            <p className="truncate text-sm font-semibold text-slate-900">
              {user?.businessName ?? user?.name}
            </p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile Header & Drawer */}
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:h-16 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <span className="font-semibold text-slate-900 md:hidden">MeeCargo Shipper</span>
            <Badge variant="info" className="hidden sm:inline-flex">
              Automated Pooling Active
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="neutral">SHIPPER</Badge>
          </div>
        </header>

        {mobileOpen ? (
          <nav className="border-b border-slate-200 bg-white p-3 md:hidden">
            <div className="space-y-1">
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
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                        isActive
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'text-slate-600 hover:bg-slate-100'
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                );
              })}
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </nav>
        ) : null}

        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
