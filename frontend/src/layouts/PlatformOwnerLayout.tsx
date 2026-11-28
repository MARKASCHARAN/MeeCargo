import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CalendarClock, ClipboardCheck, FileText, LogOut, ShieldCheck, Truck } from 'lucide-react';
import { logoutUser } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
import { useAuthStore } from '../stores/authStore';

export function PlatformOwnerLayout() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <Link to="/" className="text-base font-bold tracking-tight text-slate-900">
              MeeCargo
            </Link>
            <p className="text-[11px] font-medium text-emerald-700">Platform Owner</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Platform Owner navigation">
          <NavLink
            to="/owner"
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )
            }
          >
            <FileText className="h-4 w-4" />
            Tier 1 Contract Drivers
          </NavLink>
          <NavLink
            to="/owner/corridors"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )
            }
          >
            <CalendarClock className="h-4 w-4" />
            Corridor Schedules
          </NavLink>
          <NavLink
            to="/owner/tier2-applications"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )
            }
          >
            <ClipboardCheck className="h-4 w-4" />
            Tier 2 Driver Applications
          </NavLink>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3">
            <p className="truncate text-sm font-semibold text-slate-900">{user?.name}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            onClick={() => void handleLogout()}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:h-16 md:px-6">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-emerald-700 md:hidden" />
            <span className="font-semibold text-slate-900 md:hidden">MeeCargo Owner</span>
            <Badge variant="info">Tier 1 Fleet Contracts Only • Automated Allocation</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral">PLATFORM_OWNER</Badge>
            <Button
              variant="outline"
              size="sm"
              className="md:hidden"
              onClick={() => void handleLogout()}
            >
              Sign out
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
