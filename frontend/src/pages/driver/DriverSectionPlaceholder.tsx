import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/StateViews';

export function DriverSectionPlaceholder({
  title,
  stageLabel,
  description,
}: {
  title: string;
  stageLabel: string;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="text-xs text-slate-500">{stageLabel}</p>
      </div>
      <EmptyState
        title={`${title} ready for ${stageLabel}`}
        description={description}
        action={
          <Link to="/driver">
            <Button variant="outline" size="sm">
              Back to Trips
            </Button>
          </Link>
        }
      />
    </div>
  );
}
