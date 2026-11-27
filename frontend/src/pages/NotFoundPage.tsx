import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/StateViews';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <EmptyState
          title="Page not found"
          description="The requested route does not exist in MeeCargo. Note that MeeCargo operates automatically without a dispatcher dashboard."
          action={
            <Link to="/">
              <Button variant="primary" size="sm">
                Back to Home
              </Button>
            </Link>
          }
        />
      </div>
    </div>
  );
}
