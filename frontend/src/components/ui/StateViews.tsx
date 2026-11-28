import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from './Button';

export function LoadingState({
  title = 'Loading...',
  description = 'Fetching the latest MeeCargo data.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-12 text-center"
    >
      <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      <h3 className="mt-3 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-500 shadow-xs">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50/70 px-6 py-10 text-center"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-700">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-base font-semibold text-rose-950">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-rose-700">{description}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function UnauthorizedState({
  title = 'Access denied',
  description,
  action,
}: {
  title?: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50/80 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-800">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h2 className="mt-3 text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      {action ? <div className="mt-5 flex gap-3">{action}</div> : null}
    </div>
  );
}
