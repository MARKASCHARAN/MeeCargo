import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/StateViews';

export function ShipperSectionPlaceholder({
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
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500">{stageLabel}</p>
      </div>
      <EmptyState
        title={`${title} ready for ${stageLabel}`}
        description={description}
        action={
          <Link to="/shipper">
            <Button variant="outline" size="sm">
              Back to Overview
            </Button>
          </Link>
        }
      />
    </div>
  );
}
