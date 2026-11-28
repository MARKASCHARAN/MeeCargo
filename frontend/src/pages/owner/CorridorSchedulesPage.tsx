import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Edit3,
  FilterX,
  Lock,
  Plus,
  Power,
  Route as RouteIcon,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  createOwnerCorridor,
  fetchOwnerCorridors,
  toggleOwnerCorridorStatus,
  updateCentralCorridorSchedule,
  updateOwnerCorridor,
  type CorridorListFilters,
  type CorridorStopPayload,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import type { CorridorScheduleRecord, CorridorSlotSchedule } from '../../types/api';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

interface CorridorEditDraft {
  operatingDays: string[];
  slot1Outbound: string;
  slot1ReturnOptionsText: string;
  slot1DefaultReturn: string;
  slot2Outbound: string;
  slot2MandatoryReturn: string;
}

interface CorridorFormState {
  mode: 'create' | 'edit';
  corridorId?: string;
  code: string;
  name: string;
  description: string;
  operatingDays: string[];
  baseRateRupeesPerKg: string;
  guaranteedCeilingRupeesPerKg: string;
  viabilityThresholdPct: string;
  isActive: boolean;
  stops: Array<{
    stopCode: string;
    name: string;
    district: string;
    state: string;
    lng: string;
    lat: string;
  }>;
  slot1Outbound: string;
  slot1ReturnOptionsText: string;
  slot1DefaultReturn: string;
  slot2Outbound: string;
  slot2MandatoryReturn: string;
}

function buildDraft(corridor: CorridorScheduleRecord): CorridorEditDraft {
  const s1 = corridor.slotSchedules.find((s) => s.slotNumber === 1);
  const s2 = corridor.slotSchedules.find((s) => s.slotNumber === 2);
  return {
    operatingDays: corridor.operatingDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    slot1Outbound: s1?.outboundPickupTime ?? '09:00',
    slot1ReturnOptionsText: (s1?.returnTimeOptions ?? ['14:00', '16:30']).join(', '),
    slot1DefaultReturn: s1?.defaultReturnTime ?? '14:00',
    slot2Outbound: s2?.outboundPickupTime ?? '12:30',
    slot2MandatoryReturn: s2?.lockedReturnTime ?? s2?.defaultReturnTime ?? '16:30',
  };
}

function buildEmptyForm(): CorridorFormState {
  return {
    mode: 'create',
    code: '',
    name: '',
    description: '',
    operatingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    baseRateRupeesPerKg: '4.5',
    guaranteedCeilingRupeesPerKg: '6.5',
    viabilityThresholdPct: '50',
    isActive: true,
    stops: [
      { stopCode: 'ORG', name: '', district: '', state: 'Gujarat', lng: '73.1812', lat: '22.3072' },
      { stopCode: 'DST', name: '', district: '', state: 'Gujarat', lng: '72.5714', lat: '23.0225' },
    ],
    slot1Outbound: '08:30',
    slot1ReturnOptionsText: '13:30, 17:00',
    slot1DefaultReturn: '13:30',
    slot2Outbound: '13:00',
    slot2MandatoryReturn: '18:00',
  };
}

function buildEditForm(corridor: CorridorScheduleRecord): CorridorFormState {
  const s1 = corridor.slotSchedules.find((s) => s.slotNumber === 1);
  const s2 = corridor.slotSchedules.find((s) => s.slotNumber === 2);
  const sortedStops = (corridor.stops ?? [])
    .slice()
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    .map((st) => ({
      stopCode: st.stopCode,
      name: st.name,
      district: st.district ?? st.name,
      state: st.state ?? 'Gujarat',
      lng: String(st.location?.coordinates?.[0] ?? 73.0),
      lat: String(st.location?.coordinates?.[1] ?? 22.5),
    }));

  return {
    mode: 'edit',
    corridorId: corridor._id,
    code: corridor.code,
    name: corridor.name,
    description: corridor.description ?? '',
    operatingDays: corridor.operatingDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
    baseRateRupeesPerKg: ((corridor.baseRatePaisePerKg ?? 450) / 100).toString(),
    guaranteedCeilingRupeesPerKg: ((corridor.guaranteedCeilingPaisePerKg ?? 650) / 100).toString(),
    viabilityThresholdPct: String(corridor.viabilityThresholdPct ?? 50),
    isActive: corridor.isActive ?? true,
    stops: sortedStops.length >= 2 ? sortedStops : buildEmptyForm().stops,
    slot1Outbound: s1?.outboundPickupTime ?? '09:00',
    slot1ReturnOptionsText: (s1?.returnTimeOptions ?? ['14:00']).join(', '),
    slot1DefaultReturn: s1?.defaultReturnTime ?? '14:00',
    slot2Outbound: s2?.outboundPickupTime ?? '12:30',
    slot2MandatoryReturn: s2?.lockedReturnTime ?? s2?.defaultReturnTime ?? '16:30',
  };
}

function parseSlotTemplatesFromValues(values: {
  slot1Outbound: string;
  slot1ReturnOptionsText: string;
  slot1DefaultReturn: string;
  slot2Outbound: string;
  slot2MandatoryReturn: string;
}): CorridorSlotSchedule[] {
  const s1Options = values.slot1ReturnOptionsText
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const s1Default = s1Options.includes(values.slot1DefaultReturn.trim())
    ? values.slot1DefaultReturn.trim()
    : s1Options[0] ?? '';

  const slot2Mandatory = values.slot2MandatoryReturn.trim();

  return [
    {
      slotNumber: 1,
      slotCodeSuffix: 'SLOT1',
      label: `Pickup Slot 1 (${values.slot1Outbound} Outbound)`,
      outboundPickupTime: values.slot1Outbound.trim(),
      returnTimeOptions: s1Options,
      defaultReturnTime: s1Default,
      returnTimeLocked: false,
    },
    {
      slotNumber: 2,
      slotCodeSuffix: 'SLOT2',
      label: `Pickup Slot 2 (${values.slot2Outbound} Outbound • Mandatory ${slot2Mandatory} Return)`,
      outboundPickupTime: values.slot2Outbound.trim(),
      returnTimeOptions: slot2Mandatory ? [slot2Mandatory] : [],
      defaultReturnTime: slot2Mandatory,
      returnTimeLocked: true,
      lockedReturnTime: slot2Mandatory,
    },
  ];
}

export function CorridorSchedulesPage() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<CorridorListFilters>({
    status: 'ALL',
    origin: '',
    destination: '',
    operatingDay: '',
    q: '',
    sortBy: 'code',
    sortOrder: 'asc',
  });

  const [drafts, setDrafts] = useState<Record<string, CorridorEditDraft>>({});
  const [formState, setFormState] = useState<CorridorFormState | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const corridorsQuery = useQuery({
    queryKey: ['platform-owner-corridors', filters],
    queryFn: () => fetchOwnerCorridors(filters),
  });

  const hasActiveFilters = useMemo(() => {
    return (
      (filters.status && filters.status !== 'ALL') ||
      Boolean(filters.origin) ||
      Boolean(filters.destination) ||
      Boolean(filters.operatingDay) ||
      Boolean(filters.q?.trim())
    );
  }, [filters]);

  const clearFilters = () => {
    setFilters({
      status: 'ALL',
      origin: '',
      destination: '',
      operatingDay: '',
      q: '',
      sortBy: 'code',
      sortOrder: 'asc',
    });
  };

  const invalidateCorridorQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform-owner-corridors'] });
    void queryClient.invalidateQueries({ queryKey: ['platform-owner-catalog'] });
    void queryClient.invalidateQueries({ queryKey: ['platform-owner-drivers'] });
    void queryClient.invalidateQueries({ queryKey: ['corridors'] });
  };

  const saveScheduleMutation = useMutation({
    mutationFn: ({
      corridor,
      draft,
    }: {
      corridor: CorridorScheduleRecord;
      draft: CorridorEditDraft;
    }) => {
      const slotSchedules = parseSlotTemplatesFromValues(draft);
      return updateCentralCorridorSchedule(corridor._id, {
        operatingDays: draft.operatingDays,
        slotSchedules,
      });
    },
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(
        `Updated slot templates for ${res.corridor.code} (synced ${res.syncedOpenSlotsCount} OPEN slot(s); locked pools & trips preserved untouched).`
      );
      invalidateCorridorQueries();
    },
    onError: (err) => {
      setBanner(null);
      setErrorBanner(err instanceof Error ? err.message : 'Failed to save corridor schedule');
    },
  });

  const saveCorridorFormMutation = useMutation({
    mutationFn: async (state: CorridorFormState) => {
      const stops: CorridorStopPayload[] = state.stops.map((st, idx) => ({
        stopCode: st.stopCode.trim().toUpperCase(),
        name: st.name.trim(),
        district: st.district.trim() || st.name.trim(),
        state: st.state.trim() || 'Gujarat',
        sequenceOrder: idx,
        location: {
          type: 'Point',
          coordinates: [Number(st.lng) || 73.0, Number(st.lat) || 22.5],
        },
      }));
      const slotSchedules = parseSlotTemplatesFromValues(state);
      const baseRatePaisePerKg = Math.round(Number(state.baseRateRupeesPerKg) * 100);
      const guaranteedCeilingPaisePerKg = Math.round(
        Number(state.guaranteedCeilingRupeesPerKg) * 100
      );
      const viabilityThresholdPct = Number(state.viabilityThresholdPct) || 50;

      if (state.mode === 'create') {
        return createOwnerCorridor({
          code: state.code.trim().toUpperCase(),
          name: state.name.trim(),
          description: state.description.trim() || undefined,
          stops,
          operatingDays: state.operatingDays,
          slotSchedules,
          baseRatePaisePerKg,
          guaranteedCeilingPaisePerKg,
          viabilityThresholdPct,
          isActive: state.isActive,
        });
      }

      return updateOwnerCorridor(state.corridorId!, {
        name: state.name.trim(),
        description: state.description.trim() || undefined,
        stops,
        operatingDays: state.operatingDays,
        slotSchedules,
        baseRatePaisePerKg,
        guaranteedCeilingPaisePerKg,
        viabilityThresholdPct,
      });
    },
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(
        formState?.mode === 'create'
          ? `Corridor ${res.corridor.code} created cleanly.`
          : `Corridor ${res.corridor.code} updated cleanly without altering existing locked trips.`
      );
      setFormState(null);
      invalidateCorridorQueries();
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to save corridor');
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ corridorId, nextActive }: { corridorId: string; nextActive: boolean }) =>
      toggleOwnerCorridorStatus(corridorId, nextActive),
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(
        res.corridor.isActive
          ? `Corridor ${res.corridor.code} activated (${res.createdOpenSlotsCount} upcoming pooling slot(s) ensured).`
          : `Corridor ${res.corridor.code} deactivated. New bookings and slot selections are blocked; historical locked pools & trips continue operating.`
      );
      invalidateCorridorQueries();
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to toggle corridor status');
    },
  });

  if (corridorsQuery.isLoading) {
    return <LoadingState title="Loading corridor lifecycle & slot templates..." />;
  }

  if (corridorsQuery.isError) {
    return (
      <ErrorState
        description="Unable to load platform corridors."
        onRetry={() => void corridorsQuery.refetch()}
      />
    );
  }

  const corridors = corridorsQuery.data?.corridors ?? [];
  const facets = corridorsQuery.data?.facets ?? {
    origins: [],
    destinations: [],
    totalCount: corridors.length,
    activeCount: corridors.filter((c) => c.isActive !== false).length,
    inactiveCount: corridors.filter((c) => c.isActive === false).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Corridors & Centralized Slot Templates</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage corridor lifecycle, ordered route stops, operating days, and coupled slot templates.
            Active Tier 1 drivers select open slots dynamically when pooling windows open.
          </p>
        </div>
        <Button onClick={() => setFormState(buildEmptyForm())}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Corridor
        </Button>
      </div>

      {/* Summary metrics */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-xs font-medium text-slate-500">Total Corridors</p>
              <p className="text-xl font-bold text-slate-900">{facets.totalCount}</p>
            </div>
            <Badge variant="neutral">Catalog</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-xs font-medium text-slate-500">Active (Pooling Open)</p>
              <p className="text-xl font-bold text-emerald-700">{facets.activeCount}</p>
            </div>
            <Badge variant="success">ACTIVE</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-xs font-medium text-slate-500">Inactive (Paused)</p>
              <p className="text-xl font-bold text-slate-700">{facets.inactiveCount}</p>
            </div>
            <Badge variant="warning">INACTIVE</Badge>
          </CardContent>
        </Card>
      </div>

      {banner && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{banner}</span>
        </div>
      )}
      {errorBanner && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorBanner}</span>
        </div>
      )}

      {/* Create / Edit Corridor Form Panel */}
      {formState && (
        <Card className="border-indigo-300 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {formState.mode === 'create'
                  ? 'Create New Freight Corridor'
                  : `Edit Corridor: ${formState.code}`}
              </h2>
              <p className="text-xs text-slate-500">
                Configure ordered origin/drop/destination stops, operating days, pricing guardrails, and
                coupled Slot 1 / locked Slot 2 templates.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setFormState(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-slate-700">Unique Corridor Code *</label>
                <input
                  type="text"
                  disabled={formState.mode === 'edit'}
                  value={formState.code}
                  onChange={(e) =>
                    setFormState({ ...formState, code: e.target.value.toUpperCase() })
                  }
                  placeholder="e.g. GJ-AMD-SUR-01"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm uppercase disabled:bg-slate-100"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-700">Corridor Name *</label>
                <input
                  type="text"
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  placeholder="e.g. Ahmedabad - Bharuch - Surat Industrial Spine"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-700">Description</label>
                <input
                  type="text"
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  placeholder="Operational corridor notes & industrial clusters"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Base Rate (₹/kg) *</label>
                <input
                  type="number"
                  step="0.1"
                  value={formState.baseRateRupeesPerKg}
                  onChange={(e) =>
                    setFormState({ ...formState, baseRateRupeesPerKg: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Ceiling Rate (₹/kg) *</label>
                <input
                  type="number"
                  step="0.1"
                  value={formState.guaranteedCeilingRupeesPerKg}
                  onChange={(e) =>
                    setFormState({ ...formState, guaranteedCeilingRupeesPerKg: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Ordered Stops Builder */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Ordered Route Stops (Origin → Drop Zones → Destination)
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setFormState({
                      ...formState,
                      stops: [
                        ...formState.stops,
                        { stopCode: '', name: '', district: '', state: 'Gujarat', lng: '73.0', lat: '22.5' },
                      ],
                    })
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Stop
                </Button>
              </div>
              <div className="space-y-2">
                {formState.stops.map((stop, idx) => (
                  <div
                    key={idx}
                    className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2.5 sm:grid-cols-12 items-center"
                  >
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-semibold text-slate-500">
                        {idx === 0
                          ? 'ORIGIN CODE'
                          : idx === formState.stops.length - 1
                            ? 'DEST CODE'
                            : `STOP ${idx} CODE`}
                      </label>
                      <input
                        type="text"
                        value={stop.stopCode}
                        onChange={(e) => {
                          const next = [...formState.stops];
                          next[idx] = { ...next[idx], stopCode: e.target.value.toUpperCase() };
                          setFormState({ ...formState, stops: next });
                        }}
                        placeholder="VAD"
                        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs uppercase"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-[10px] font-semibold text-slate-500">Stop Name</label>
                      <input
                        type="text"
                        value={stop.name}
                        onChange={(e) => {
                          const next = [...formState.stops];
                          next[idx] = { ...next[idx], name: e.target.value };
                          setFormState({ ...formState, stops: next });
                        }}
                        placeholder="City / Zone"
                        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-[10px] font-semibold text-slate-500">District</label>
                      <input
                        type="text"
                        value={stop.district}
                        onChange={(e) => {
                          const next = [...formState.stops];
                          next[idx] = { ...next[idx], district: e.target.value };
                          setFormState({ ...formState, stops: next });
                        }}
                        placeholder="District"
                        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-semibold text-slate-500">Lng / Lat</label>
                      <div className="flex gap-1 mt-0.5">
                        <input
                          type="text"
                          value={stop.lng}
                          onChange={(e) => {
                            const next = [...formState.stops];
                            next[idx] = { ...next[idx], lng: e.target.value };
                            setFormState({ ...formState, stops: next });
                          }}
                          className="w-1/2 rounded border border-slate-300 px-1.5 py-1 text-[11px]"
                        />
                        <input
                          type="text"
                          value={stop.lat}
                          onChange={(e) => {
                            const next = [...formState.stops];
                            next[idx] = { ...next[idx], lat: e.target.value };
                            setFormState({ ...formState, stops: next });
                          }}
                          className="w-1/2 rounded border border-slate-300 px-1.5 py-1 text-[11px]"
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-2 flex justify-end gap-1 pt-3">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => {
                          const next = [...formState.stops];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          setFormState({ ...formState, stops: next });
                        }}
                        className="rounded border border-slate-200 p-1 text-slate-600 disabled:opacity-30"
                        title="Move Up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === formState.stops.length - 1}
                        onClick={() => {
                          const next = [...formState.stops];
                          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                          setFormState({ ...formState, stops: next });
                        }}
                        className="rounded border border-slate-200 p-1 text-slate-600 disabled:opacity-30"
                        title="Move Down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      {formState.stops.length > 2 && (
                        <button
                          type="button"
                          onClick={() =>
                            setFormState({
                              ...formState,
                              stops: formState.stops.filter((_, i) => i !== idx),
                            })
                          }
                          className="rounded border border-rose-200 p-1 text-rose-600 hover:bg-rose-50"
                          title="Remove stop"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Operating Days */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Operating Days
              </p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const active = formState.operatingDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        const next = active
                          ? formState.operatingDays.filter((d) => d !== day)
                          : [...formState.operatingDays, day];
                        setFormState({ ...formState, operatingDays: next });
                      }}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                        active
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Coupled Slot Templates inside Modal */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                <p className="text-xs font-bold text-slate-800">Slot 1 Template (Flexible Return)</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Pickup (HH:mm)</label>
                    <input
                      type="text"
                      value={formState.slot1Outbound}
                      onChange={(e) => setFormState({ ...formState, slot1Outbound: e.target.value })}
                      className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Allowed Returns</label>
                    <input
                      type="text"
                      value={formState.slot1ReturnOptionsText}
                      onChange={(e) =>
                        setFormState({ ...formState, slot1ReturnOptionsText: e.target.value })
                      }
                      placeholder="13:30, 17:00"
                      className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Display Default</label>
                    <input
                      type="text"
                      value={formState.slot1DefaultReturn}
                      onChange={(e) =>
                        setFormState({ ...formState, slot1DefaultReturn: e.target.value })
                      }
                      className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
                <p className="text-xs font-bold text-slate-800">Slot 2 Template (Mandatory Locked Return)</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Pickup (HH:mm)</label>
                    <input
                      type="text"
                      value={formState.slot2Outbound}
                      onChange={(e) => setFormState({ ...formState, slot2Outbound: e.target.value })}
                      className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600">Locked Return (HH:mm)</label>
                    <input
                      type="text"
                      value={formState.slot2MandatoryReturn}
                      onChange={(e) =>
                        setFormState({ ...formState, slot2MandatoryReturn: e.target.value })
                      }
                      className="mt-0.5 w-full rounded border border-amber-300 px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setFormState(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saveCorridorFormMutation.isPending}
                onClick={() => saveCorridorFormMutation.mutate(formState)}
              >
                {formState.mode === 'create' ? 'Create Corridor' : 'Save Corridor Changes'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search, Multi-Filter & Sort Toolbar (MC-046) */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-4">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Search Corridor / City / Stop
              </label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={filters.q ?? ''}
                  onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                  placeholder="Code, name, Anand, Vadodara..."
                  className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-xs"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Status
              </label>
              <select
                value={filters.status ?? 'ALL'}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    status: e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE',
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Origin
              </label>
              <select
                value={filters.origin ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, origin: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">All Origins</option>
                {facets.origins.map((orig) => (
                  <option key={orig} value={orig}>
                    {orig}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Destination
              </label>
              <select
                value={filters.destination ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, destination: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">All Destinations</option>
                {facets.destinations.map((dest) => (
                  <option key={dest} value={dest}>
                    {dest}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Operating Day
              </label>
              <select
                value={filters.operatingDay ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, operatingDay: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Any Day</option>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-600">
                Showing {corridors.length} of {facets.totalCount} corridor(s)
              </span>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <FilterX className="mr-1 h-3.5 w-3.5" />
                  Clear All Filters
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500">Sort by:</span>
              <select
                value={`${filters.sortBy ?? 'code'}:${filters.sortOrder ?? 'asc'}`}
                onChange={(e) => {
                  const [sortBy, sortOrder] = e.target.value.split(':') as [
                    'code' | 'name' | 'updatedAt',
                    'asc' | 'desc',
                  ];
                  setFilters((f) => ({ ...f, sortBy, sortOrder }));
                }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs"
              >
                <option value="code:asc">Corridor Code (A–Z)</option>
                <option value="name:asc">Corridor Name (A–Z)</option>
                <option value="updatedAt:desc">Most Recently Updated</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Corridor Cards */}
      {corridors.length === 0 ? (
        <EmptyState
          title="No corridors match your filters"
          description={
            hasActiveFilters
              ? 'Try clearing your search or combining fewer origin/destination/day filters.'
              : 'Create your first corridor to start opening pooling windows and managing contracts.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                Clear All Filters
              </Button>
            ) : (
              <Button size="sm" onClick={() => setFormState(buildEmptyForm())}>
                Create Corridor
              </Button>
            )
          }
        />
      ) : (
        corridors.map((corridor) => {
          const draft = drafts[corridor._id] ?? buildDraft(corridor);
          const updateDraft = (patch: Partial<CorridorEditDraft>) => {
            setDrafts((prev) => ({
              ...prev,
              [corridor._id]: { ...(prev[corridor._id] ?? buildDraft(corridor)), ...patch },
            }));
          };
          const isActive = corridor.isActive !== false;

          return (
            <Card key={corridor._id} className={!isActive ? 'opacity-85 border-slate-300' : ''}>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RouteIcon className="h-4 w-4 text-indigo-600" />
                    <h2 className="text-lg font-bold text-slate-900">
                      {corridor.code} — {corridor.name}
                    </h2>
                    <Badge variant={isActive ? 'success' : 'warning'}>
                      {isActive ? 'ACTIVE' : 'INACTIVE'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Ordered Stops:{' '}
                    {(corridor.stops ?? [])
                      .slice()
                      .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                      .map((st) => `${st.name} (${st.stopCode})`)
                      .join(' → ')}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setFormState(buildEditForm(corridor))}
                  >
                    <Edit3 className="mr-1 h-3.5 w-3.5" />
                    Edit Corridor
                  </Button>
                  <Button
                    variant={isActive ? 'outline' : 'primary'}
                    size="sm"
                    disabled={toggleStatusMutation.isPending}
                    onClick={() =>
                      toggleStatusMutation.mutate({
                        corridorId: corridor._id,
                        nextActive: !isActive,
                      })
                    }
                  >
                    <Power className="mr-1 h-3.5 w-3.5" />
                    {isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="space-y-5">
                {/* Operating Days */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Operating Days
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day) => {
                      const active = draft.operatingDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            const nextDays = active
                              ? draft.operatingDays.filter((d) => d !== day)
                              : [...draft.operatingDays, day];
                            if (nextDays.length > 0) {
                              updateDraft({ operatingDays: nextDays });
                            }
                          }}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                            active
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-slate-200 bg-white text-slate-600'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Coupled Pickup Slots */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-emerald-700" />
                        <h3 className="text-sm font-bold text-slate-900">Pickup Slot 1 Template</h3>
                      </div>
                      <Badge variant="success">Flexible Return (Driver Chooses)</Badge>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-medium text-slate-700">
                          Outbound Pickup (24h HH:mm)
                        </label>
                        <input
                          type="text"
                          value={draft.slot1Outbound}
                          onChange={(e) => updateDraft({ slot1Outbound: e.target.value })}
                          placeholder="09:00"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700">
                          Default Display Return
                        </label>
                        <input
                          type="text"
                          value={draft.slot1DefaultReturn}
                          onChange={(e) => updateDraft({ slot1DefaultReturn: e.target.value })}
                          placeholder="14:00"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700">
                        Permitted Return Options (comma-separated 24h HH:mm)
                      </label>
                      <input
                        type="text"
                        value={draft.slot1ReturnOptionsText}
                        onChange={(e) => updateDraft({ slot1ReturnOptionsText: e.target.value })}
                        placeholder="14:00, 16:30"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-amber-700" />
                        <h3 className="text-sm font-bold text-slate-900">Pickup Slot 2 Template</h3>
                      </div>
                      <Badge variant="warning">
                        <Lock className="mr-1 inline h-3 w-3" /> Mandatory Locked Return
                      </Badge>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-medium text-slate-700">
                          Outbound Pickup (24h HH:mm)
                        </label>
                        <input
                          type="text"
                          value={draft.slot2Outbound}
                          onChange={(e) => updateDraft({ slot2Outbound: e.target.value })}
                          placeholder="12:30"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700">
                          Locked Return Timing
                        </label>
                        <input
                          type="text"
                          value={draft.slot2MandatoryReturn}
                          onChange={(e) => updateDraft({ slot2MandatoryReturn: e.target.value })}
                          placeholder="16:30"
                          className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm font-medium text-amber-900"
                        />
                      </div>
                    </div>

                    <p className="text-[11px] text-amber-900">
                      Backend enforces that drivers selecting Slot 2 are locked to this exact return
                      timing with zero override capability. Locked pools keep their original snapshot.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-500">
                    Central template edits update future OPEN windows without silently altering existing
                    locked trips.
                  </span>
                  <Button
                    size="sm"
                    disabled={saveScheduleMutation.isPending}
                    onClick={() => saveScheduleMutation.mutate({ corridor, draft })}
                  >
                    Save Slot Templates
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
