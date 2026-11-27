import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { TripSummary } from '../../types/api';

type LoadingPlan = NonNullable<TripSummary['loadingPlan']>;

const ZONE_FILL: Record<string, { fill: string; stroke: string; text: string }> = {
  GREEN: { fill: '#bbf7d0', stroke: '#15803d', text: '#14532d' },
  YELLOW: { fill: '#fef08a', stroke: '#ca8a04', text: '#713f12' },
  RED: { fill: '#fecdd3', stroke: '#be123c', text: '#881337' },
  BLUE: { fill: '#bae6fd', stroke: '#0369a1', text: '#0c4a6e' },
};

interface TruckBedVisualizerProps {
  bedDimensionsCm?: { length: number; width: number; height: number } | null;
  vehicleLabel?: string;
  loadingPlan?: LoadingPlan | null;
}

export function TruckBedVisualizer({
  bedDimensionsCm,
  vehicleLabel,
  loadingPlan,
}: TruckBedVisualizerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    loadingPlan?.sequenceItems?.[0]?.shipmentId ?? null
  );

  const dimsMissing =
    !bedDimensionsCm ||
    !(bedDimensionsCm.length > 0) ||
    !(bedDimensionsCm.width > 0) ||
    !(bedDimensionsCm.height > 0) ||
    !loadingPlan ||
    loadingPlan.planStatus === 'UNAVAILABLE_MISSING_DIMENSIONS';

  if (dimsMissing) {
    const missingList = loadingPlan?.missingDimensions?.length
      ? loadingPlan.missingDimensions
      : [
          ...(!bedDimensionsCm || !(bedDimensionsCm.length > 0)
            ? ['Registered vehicle internal cargo-bed dimensions']
            : []),
          ...(!loadingPlan ? ['Trip manifest loading layout'] : []),
        ];

    return (
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="font-semibold">Loading layout unavailable — dimensions missing</p>
            <p className="mt-0.5 text-[11px] text-amber-900">
              {missingList.join(' • ')}. Verify registered vehicle dimensions and manifest cargo specs.
            </p>
          </div>
        </div>
        <p className="text-[11px] text-amber-800">
          Planning aid only — not a certified load-safety or axle-weight validation system.
        </p>
      </div>
    );
  }

  const dims = bedDimensionsCm!;
  const selectedItem =
    loadingPlan.sequenceItems.find((i) => i.shipmentId === selectedId) ?? null;

  const placedItems = loadingPlan.sequenceItems.filter(
    (i) => i.placed && i.bedRect
  );
  const overflowItems = loadingPlan.sequenceItems.filter((i) => !i.placed);
  const capacityIssues = loadingPlan.capacityIssues ?? [];

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-900">
            2D Truck Bed Loading Plan ({dims.length} × {dims.width} × {dims.height} cm
            {vehicleLabel ? ` • ${vehicleLabel}` : ''})
          </h3>
          <p className="text-[11px] text-slate-500">
            LIFO Order: Load farthest drop (#1) at Cab Bulkhead first → nearest drop at Tailgate last
            (unloads first)
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {loadingPlan.zoneMapping.map((z) => {
            const colors = ZONE_FILL[z.zoneColor] ?? ZONE_FILL.GREEN;
            return (
              <span
                key={z.stopCode}
                style={{
                  backgroundColor: colors.fill,
                  borderColor: colors.stroke,
                  color: colors.text,
                }}
                className="rounded border px-2 py-0.5 text-[10px] font-semibold"
              >
                {z.zoneLabel}
              </span>
            );
          })}
        </div>
      </div>

      {capacityIssues.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>Capacity Constraint Exceeded:</strong>
            <ul className="mt-0.5 list-disc pl-4">
              {capacityIssues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {loadingPlan.sequenceItems.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          No cargo items on trip manifest to place on bed ({dims.length} × {dims.width} cm).
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg
            viewBox={`-18 -20 ${dims.length + 36} ${dims.width + 42}`}
            className="h-44 w-full min-w-[320px] rounded-lg border border-slate-200 bg-slate-50"
            role="img"
            aria-label="Top-down 2D truck bed cargo placement diagram"
          >
            {/* Cab Bulkhead Indicator */}
            <rect x={-12} y={0} width={10} height={dims.width} rx={2} fill="#334155" />
            <text x={0} y={-6} fontSize={10} fontWeight="bold" fill="#334155">
              CAB (Load #1)
            </text>
            <text
              x={dims.length}
              y={-6}
              textAnchor="end"
              fontSize={10}
              fontWeight="bold"
              fill="#0f766e"
            >
              TAILGATE (Unload First)
            </text>

            {/* Truck Bed Outline */}
            <rect
              x={0}
              y={0}
              width={dims.length}
              height={dims.width}
              fill="#ffffff"
              stroke="#64748b"
              strokeWidth={2}
            />

            {/* Placed Cargo Rectangles */}
            {placedItems.map((item) => {
              const rect = item.bedRect!;
              const colors = ZONE_FILL[item.zoneColor] ?? ZONE_FILL.GREEN;
              const isSelected = item.shipmentId === selectedId;
              return (
                <g
                  key={item.shipmentId}
                  onClick={() => setSelectedId(item.shipmentId)}
                  className="cursor-pointer"
                >
                  <rect
                    x={rect.xCm + 2}
                    y={rect.yCm + 2}
                    width={Math.max(8, rect.lengthCm - 4)}
                    height={Math.max(8, rect.widthCm - 4)}
                    rx={3}
                    fill={colors.fill}
                    stroke={isSelected ? '#0f172a' : colors.stroke}
                    strokeWidth={isSelected ? 3 : 1.5}
                  />
                  <text
                    x={rect.xCm + rect.lengthCm / 2}
                    y={rect.yCm + rect.widthCm / 2 + 4}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight="bold"
                    fill={colors.text}
                  >
                    #{item.loadOrder} {item.stopCode} (×{item.quantity})
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {overflowItems.length > 0 && capacityIssues.length === 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong>Overflow / Unplaced Cargo ({overflowItems.length}):</strong>{' '}
            {overflowItems.map((o) => `${o.reference} (${o.stopCode})`).join(', ')}
          </div>
        </div>
      ) : null}

      {selectedItem ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono font-bold text-slate-900">
              Load #{selectedItem.loadOrder} • {selectedItem.reference}
            </span>
            <span className="font-semibold text-emerald-700">
              {selectedItem.zoneLabel}
            </span>
          </div>
          <p className="mt-1">
            {selectedItem.quantity}× ({selectedItem.dimensionsCm.length}×
            {selectedItem.dimensionsCm.width}×{selectedItem.dimensionsCm.height} cm) •{' '}
            {selectedItem.weightKg} kg •{' '}
            {selectedItem.stackable ? 'Stackable' : 'Non-stackable'}
          </p>
          {selectedItem.handlingNotes ? (
            <p className="mt-0.5 text-[11px] text-amber-800">
              Handling: {selectedItem.handlingNotes}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {loadingPlan.planningAidDisclaimer} Weight distribution, tie-down safety, and axle limits
          are not validated by this diagram. Loading/unloading is performed by shipper/receiver personnel;
          verify manifest before departure.
        </span>
      </div>
    </div>
  );
}
