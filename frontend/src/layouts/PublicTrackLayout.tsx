import { Link, Outlet } from 'react-router-dom';
import { ShieldCheck, Truck } from 'lucide-react';
import { Badge } from '../components/ui/Badge';

export function PublicTrackLayout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Truck className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold text-slate-900">MeeCargo Track</span>
          </Link>

          <Badge variant="success">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secure Link • No Login Required
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
