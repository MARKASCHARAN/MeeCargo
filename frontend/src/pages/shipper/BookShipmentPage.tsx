import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Calculator,
  CheckCircle2,
  CreditCard,
  Lock,
  MapPin,
  Navigation,
} from 'lucide-react';
import {
  calculateChargeableWeight,
  createShipment,
  fetchBusinessProfile,
  fetchCargoPresets,
  fetchCorridors,
  fetchQuotePreview,
  geocodeAddress,
  payShipmentToken,
} from '@/api/client';
import { MapPinPicker } from '@/components/map/MapPinPicker';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/format';
import type {
  CargoCalculationResult,
  CargoCategory,
  CorridorStop,
  DimensionUnit,
  PriceCalculationBreakdown,
  WeightUnit,
} from '@/types/api';

const MAX_DROP_ZONE_RADIUS_KM = 30;

function haversineDistanceKm(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function makeIdempotencyKey(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function BookShipmentPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const businessQuery = useQuery({
    queryKey: ['shipper-business-profile'],
    queryFn: fetchBusinessProfile,
  });
  const corridorsQuery = useQuery({
    queryKey: ['corridors'],
    queryFn: fetchCorridors,
  });
  const presetsQuery = useQuery({
    queryKey: ['cargo-presets'],
    queryFn: fetchCargoPresets,
  });

  const business = businessQuery.data?.businessProfile ?? null;
  const corridors = useMemo(
    () => corridorsQuery.data?.corridors ?? [],
    [corridorsQuery.data]
  );
  const presets = useMemo(
    () => presetsQuery.data?.presets ?? [],
    [presetsQuery.data]
  );

  const [corridorId, setCorridorId] = useState(searchParams.get('corridorId') ?? '');
  const [serviceDate, setServiceDate] = useState(searchParams.get('serviceDate') ?? '');
  const [deliveryStopCode, setDeliveryStopCode] = useState('');

  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [deliveryAddressLine, setDeliveryAddressLine] = useState('');
  const [deliveryVillageOrTown, setDeliveryVillageOrTown] = useState('Anand');
  const [deliveryDistrict, setDeliveryDistrict] = useState('Anand');
  const [deliveryState, setDeliveryState] = useState('Gujarat');
  const [deliveryPincode, setDeliveryPincode] = useState('388001');
  const [deliveryLandmark, setDeliveryLandmark] = useState('');
  const [deliveryCoords, setDeliveryCoords] = useState<[number, number]>([
    72.9289, 22.5645,
  ]);

  const [category, setCategory] = useState<CargoCategory>('STANDARD_BOX');
  const [quantity, setQuantity] = useState(2);
  const [length, setLength] = useState(50);
  const [width, setWidth] = useState(40);
  const [height, setHeight] = useState(40);
  const [dimensionUnit, setDimensionUnit] = useState<DimensionUnit>('CM');
  const [unitActualWeight, setUnitActualWeight] = useState(18);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('KG');
  const [stackable, setStackable] = useState(true);
  const [declaredContents, setDeclaredContents] = useState('');
  const [handlingNotes, setHandlingNotes] = useState('');
  const [irregularCargoNotes, setIrregularCargoNotes] = useState('');
  const [bookingIdempotencyKey] = useState(() => makeIdempotencyKey('bk'));
  const [paymentIdempotencyKey] = useState(() => makeIdempotencyKey('pay'));

  const [calcResult, setCalcResult] = useState<CargoCalculationResult | null>(null);
  const [quoteResult, setQuoteResult] = useState<PriceCalculationBreakdown | null>(null);
  const [geocodeMsg, setGeocodeMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdShipmentId, setCreatedShipmentId] = useState<string | null>(null);
  const [createdRef, setCreatedRef] = useState<string | null>(null);

  const selectedCorridor = useMemo(
    () => corridors.find((c) => c._id === corridorId) ?? corridors[0],
    [corridors, corridorId]
  );

  const effectiveServiceDate = useMemo(() => {
    const dates = selectedCorridor?.serviceDates ?? [];
    if (serviceDate && dates.some((d) => d.serviceDate === serviceDate && d.bookable)) {
      return serviceDate;
    }
    const openDate = dates.find((d) => d.bookable);
    return openDate?.serviceDate ?? '';
  }, [serviceDate, selectedCorridor]);

  const orderedStops = useMemo(
    () =>
      [...(selectedCorridor?.stops ?? [])].sort(
        (a, b) => a.sequenceOrder - b.sequenceOrder
      ),
    [selectedCorridor]
  );

  const originStop = orderedStops[0] ?? null;

  const downstreamStops = useMemo(
    () =>
      originStop
        ? orderedStops.filter((s) => s.sequenceOrder > originStop.sequenceOrder)
        : [],
    [orderedStops, originStop]
  );

  const effectivePickupStopCode = originStop?.stopCode ?? '';

  const effectiveDeliveryStopCode = useMemo(() => {
    if (
      deliveryStopCode &&
      downstreamStops.some((s) => s.stopCode === deliveryStopCode)
    ) {
      return deliveryStopCode;
    }
    return downstreamStops[0]?.stopCode ?? '';
  }, [deliveryStopCode, downstreamStops]);

  const selectedDeliveryStop = useMemo(
    () =>
      downstreamStops.find((s) => s.stopCode === effectiveDeliveryStopCode) ?? null,
    [downstreamStops, effectiveDeliveryStopCode]
  );

  const dropZoneDistanceKm = useMemo(() => {
    const stopCoords = selectedDeliveryStop?.location?.coordinates;
    if (
      !stopCoords ||
      stopCoords.length !== 2 ||
      (stopCoords[0] === 0 && stopCoords[1] === 0)
    ) {
      return null;
    }
    return haversineDistanceKm(deliveryCoords, stopCoords);
  }, [deliveryCoords, selectedDeliveryStop]);

  const isOutsideDropZone =
    dropZoneDistanceKm !== null && dropZoneDistanceKm > MAX_DROP_ZONE_RADIUS_KM;

  const syncDestinationStop = (stop: CorridorStop | undefined) => {
    if (!stop) return;
    setDeliveryStopCode(stop.stopCode);
    setDeliveryVillageOrTown(stop.name.split(' ')[0] ?? stop.district);
    setDeliveryDistrict(stop.district);
    setDeliveryState(stop.state);
    if (stop.location?.coordinates?.length === 2) {
      setDeliveryCoords(stop.location.coordinates);
    }
    setGeocodeMsg(null);
  };

  useEffect(() => {
    if (quantity < 1 || length <= 0 || width <= 0 || height <= 0 || unitActualWeight <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      calculateChargeableWeight({
        category,
        quantity,
        length,
        width,
        height,
        dimensionUnit,
        unitActualWeight,
        weightUnit,
      })
        .then((res) => {
          setCalcResult(res.metrics);
          if (selectedCorridor?._id && effectiveServiceDate) {
            return fetchQuotePreview({
              corridorId: selectedCorridor._id,
              serviceDate: effectiveServiceDate,
              chargeableWeightKg: res.metrics.chargeableWeightKg,
              volumeCbm: res.metrics.totalVolumeCbm,
            }).then((q) => setQuoteResult(q.breakdown));
          }
        })
        .catch(() => {
          setCalcResult(null);
          setQuoteResult(null);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [
    category,
    quantity,
    length,
    width,
    height,
    dimensionUnit,
    unitActualWeight,
    weightUnit,
    selectedCorridor?._id,
    effectiveServiceDate,
  ]);

  const applyPreset = (cat: CargoCategory) => {
    setCategory(cat);
    const preset = presets.find((p) => p.category === cat);
    if (preset) {
      setLength(preset.defaultDimensionsCm.length);
      setWidth(preset.defaultDimensionsCm.width);
      setHeight(preset.defaultDimensionsCm.height);
      setDimensionUnit('CM');
      setUnitActualWeight(preset.defaultUnitWeightKg);
      setWeightUnit('KG');
      setStackable(preset.defaultStackable);
    }
  };

  const handleGeocode = async () => {
    setGeocodeMsg(null);
    try {
      const res = await geocodeAddress({
        addressLine: deliveryAddressLine,
        villageOrTown: deliveryVillageOrTown || 'Anand',
        district: deliveryDistrict || 'Anand',
        state: deliveryState,
        pincode: deliveryPincode || undefined,
      });
      setDeliveryCoords(res.coordinates);
      setGeocodeMsg(`Located via ${res.provider}: ${res.formattedLabel}`);
    } catch (error) {
      setGeocodeMsg(
        error instanceof Error
          ? error.message
          : 'Could not geocode address; drag the map pin manually.'
      );
    }
  };

  const bookMutation = useMutation({
    mutationFn: createShipment,
    onSuccess: (res) => {
      setCreatedShipmentId(res.shipment._id);
      setCreatedRef(res.shipment.reference);
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
      void queryClient.invalidateQueries({ queryKey: ['corridors'] });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const payTokenMutation = useMutation({
    mutationFn: (shipmentId: string) =>
      payShipmentToken(shipmentId, {
        idempotencyKey: paymentIdempotencyKey,
        simulateOutcome: 'SUCCESS',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
      void queryClient.invalidateQueries({ queryKey: ['pools'] });
      void queryClient.invalidateQueries({ queryKey: ['corridors'] });
      navigate('/shipper/shipments');
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  if (businessQuery.isLoading || corridorsQuery.isLoading) {
    return <LoadingState title="Preparing shipment booking form..." />;
  }

  if (corridorsQuery.isError) {
    return (
      <ErrorState
        title="Could not load corridors"
        description={corridorsQuery.error.message}
        onRetry={() => void corridorsQuery.refetch()}
      />
    );
  }

  if (!business) {
    return (
      <ErrorState
        title="Business profile required"
        description="Please create your B2B business profile before booking shipments."
        onRetry={() => navigate('/shipper/profile')}
      />
    );
  }

  if (createdShipmentId && createdRef) {
    return (
      <div className="orbit-reveal-1 mx-auto max-w-2xl overflow-hidden rounded-[28px] border border-[#1d2542] bg-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.3)]">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#080b14] px-6 py-5 text-white">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8ea5e2]">
                Reservation Created
              </p>
              <h1 className="text-lg font-bold text-white">Booking Created: {createdRef}</h1>
            </div>
          </div>
          <Badge variant="warning">SIMULATED PAYMENT</Badge>
        </div>

        <div className="space-y-5 p-6">
          <p className="text-sm text-[#4d5a83]">
            Status is <strong className="text-[#080b14]">PENDING_TOKEN</strong>. Pay the refundable
            15% booking token to join the live freight pool and reserve capacity.
          </p>

          {quoteResult ? (
            <div className="space-y-2 rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-4 text-xs">
              <div className="flex justify-between text-[#4d5a83]">
                <span>Guaranteed Price Ceiling:</span>
                <strong className="text-[#080b14]">
                  {formatPaise(quoteResult.ceilingPricePaise)}
                </strong>
              </div>
              <div className="flex justify-between text-[#4d5a83]">
                <span>Projected Pooled Price (Non-Final Estimate):</span>
                <strong className="text-[#080b14]">
                  {formatPaise(quoteResult.computedPricePaise)}
                </strong>
              </div>
              <div className="flex justify-between border-t border-[#e3ebfc] pt-2 font-semibold text-[#080b14]">
                <span>Refundable Token Due Now (15% of ceiling):</span>
                <span className="text-sm text-[#4673eb]">
                  {formatPaise(quoteResult.tokenAmountPaise)}
                </span>
              </div>
              <div className="flex justify-between text-[#5c6b94]">
                <span>Est. Remaining Balance at Pickup (after token credit):</span>
                <strong className="text-[#080b14]">
                  {formatPaise(
                    Math.max(0, quoteResult.computedPricePaise - quoteResult.tokenAmountPaise)
                  )}
                </strong>
              </div>
            </div>
          ) : null}

          {formError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
              {formError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={payTokenMutation.isPending}
              onClick={() => payTokenMutation.mutate(createdShipmentId)}
              className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#080b14] px-5 py-3 text-xs font-semibold text-white shadow-xs transition hover:bg-[#192038] disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4 text-[#82a2ff]" />
              {payTokenMutation.isPending
                ? 'Processing Simulated Token...'
                : 'Pay Refundable Token (Simulated) & Join Pool'}
            </button>
            <Link
              to="/shipper/shipments"
              className="inline-flex items-center rounded-2xl border border-[#d5ddf0] bg-white px-4 py-3 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14]"
            >
              Pay Later in History
            </Link>
          </div>

          <p className="text-[11px] text-[#7a87aa]">
            Simulation notice: No real UPI or bank charge occurs in prototype mode.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (
      !selectedCorridor ||
      !effectiveServiceDate ||
      !effectivePickupStopCode ||
      !effectiveDeliveryStopCode
    ) {
      setFormError(
        'Please select a corridor, an upcoming bookable service date, and a downstream destination drop zone.'
      );
      return;
    }
    if (isOutsideDropZone && selectedDeliveryStop) {
      setFormError(
        `Recipient map location is ${dropZoneDistanceKm?.toFixed(1)} km from ${
          selectedDeliveryStop.name
        } (outside ${MAX_DROP_ZONE_RADIUS_KM} km drop-zone area). Adjust the delivery pin or select the matching destination drop zone.`
      );
      return;
    }

    bookMutation.mutate({
      corridorId: selectedCorridor._id,
      serviceType: 'STANDARD_SCHEDULED_SHARED_POOL',
      serviceDate: effectiveServiceDate,
      pickupStopCode: effectivePickupStopCode,
      deliveryStopCode: effectiveDeliveryStopCode,
      deliveryAddress: {
        addressLine: deliveryAddressLine,
        villageOrTown: deliveryVillageOrTown,
        district: deliveryDistrict,
        state: deliveryState,
        pincode: deliveryPincode,
        landmark: deliveryLandmark || undefined,
        location: {
          type: 'Point',
          coordinates: deliveryCoords,
        },
      },
      recipientName,
      recipientPhone,
      cargo: {
        category,
        quantity,
        length,
        width,
        height,
        dimensionUnit,
        unitActualWeight,
        weightUnit,
        stackable,
        handlingRestrictions: stackable ? [] : ['NON_STACKABLE'],
        declaredContents,
        handlingNotes: handlingNotes || undefined,
        irregularCargoNotes:
          category === 'CUSTOM' ? irregularCargoNotes || undefined : undefined,
      },
      paymentChoice: 'TOKEN_PLUS_PICKUP_BALANCE',
      idempotencyKey: bookingIdempotencyKey,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Obsidian Hero Header */}
      <section className="orbit-reveal-1 relative overflow-hidden rounded-[28px] border border-[#1d2542] bg-[#080b14] p-6 text-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.65)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(70,115,235,0.28),transparent_70%)] blur-xl"
        />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#8ea5e2]">
              Standard Scheduled Shared Pool
            </p>
            <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-white sm:text-[36px]">
              Book a{' '}
              <em
                className="font-orbit-serif text-[1.12em] font-normal text-[#82a2ff]"
                style={{ fontStyle: 'italic' }}
              >
                shipment.
              </em>
            </h1>
            <p className="mt-1 text-xs text-[#a8b5d6] sm:text-sm">
              Pickup defaults to your business profile ({business.businessName}).
            </p>
          </div>
          <Link
            to="/shipper/express"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white transition hover:border-white/30 hover:bg-white/12"
          >
            Urgent One-Way Express Dispatch
            <ArrowRight className="h-3.5 w-3.5 text-[#82a2ff]" />
          </Link>
        </div>
      </section>

      {formError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          {formError}
        </div>
      ) : null}

      {/* 1. Corridor & Service Date */}
      <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
          <h2 className="text-sm font-semibold text-[#080b14] sm:text-base">
            1. Corridor, Service Date &amp; Route Stops
          </h2>
          <Badge variant="info">Standard Scheduled Shared Pool (One-Way)</Badge>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">Corridor</label>
            <select
              value={selectedCorridor?._id ?? ''}
              onChange={(e) => {
                const nextId = e.target.value;
                setCorridorId(nextId);
                setServiceDate('');
                const nextCor = corridors.find((c) => c._id === nextId);
                const nextStops = [...(nextCor?.stops ?? [])].sort(
                  (a, b) => a.sequenceOrder - b.sequenceOrder
                );
                const nextOrigin = nextStops[0];
                const firstDownstream = nextStops.find(
                  (s) => nextOrigin && s.sequenceOrder > nextOrigin.sequenceOrder
                );
                syncDestinationStop(firstDownstream);
              }}
              className="orbit-input-dark"
            >
              {corridors.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
              Service Date (Automatic Pool Matching)
            </label>
            <select
              value={effectiveServiceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="orbit-input-dark"
            >
              {(selectedCorridor?.serviceDates ?? []).map((sd) => (
                <option key={sd.serviceDate} value={sd.serviceDate} disabled={!sd.bookable}>
                  {new Date(sd.departureDate ?? sd.serviceDate).toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  [{sd.status}] — {sd.availableWeightKg.toFixed(0)} kg /{' '}
                  {sd.availableVolumeCbm.toFixed(1)} m³ free
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-[#7a87aa]">
              MeeCargo automatically associates your booking with the best operational pool.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
              Origin / Pickup Hub (Fixed)
            </label>
            <div className="flex items-center justify-between rounded-2xl border border-[#d5ddf0] bg-[#f4f7ff] px-3.5 py-2.5 text-xs text-[#080b14]">
              <span className="font-semibold">
                {originStop
                  ? `${originStop.sequenceOrder + 1}. ${originStop.name} (${originStop.stopCode})`
                  : 'No origin configured'}
              </span>
              <Lock className="h-3.5 w-3.5 shrink-0 text-[#5c6b94]" />
            </div>
            <p className="mt-1 text-[11px] text-[#7a87aa]">
              Origin pickup is fixed to the selected corridor&apos;s origin hub.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
              Destination Drop Zone *
            </label>
            <select
              value={effectiveDeliveryStopCode}
              onChange={(e) => {
                const stop = downstreamStops.find((s) => s.stopCode === e.target.value);
                syncDestinationStop(stop);
              }}
              className="orbit-input-dark"
            >
              {downstreamStops.map((stop) => (
                <option key={stop.stopCode} value={stop.stopCode}>
                  {stop.sequenceOrder + 1}. {stop.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-[#7a87aa]">
              Valid downstream drop zones for {selectedCorridor?.code}.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Cargo & Chargeable Weight */}
      <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[#080b14] sm:text-base">
              2. Cargo Details, Chargeable Weight &amp; Projected Price
            </h2>
            <p className="text-xs text-[#5c6b94]">
              Deterministic backend calculation in paise. Projected price is non-final until cutoff.
            </p>
          </div>
          <Badge variant="info">
            <Calculator className="h-3.5 w-3.5" />
            Deterministic Pricing
          </Badge>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid gap-2.5 sm:grid-cols-5">
            {presets.map((preset) => {
              const active = category === preset.category;
              return (
                <button
                  key={preset.category}
                  type="button"
                  onClick={() => applyPreset(preset.category)}
                  className={cn(
                    'cursor-pointer rounded-2xl border p-3.5 text-left transition-all',
                    active
                      ? 'border-[#080b14] bg-[#080b14] text-white shadow-sm'
                      : 'border-[#dce5fa] bg-[#f8faff] text-[#080b14] hover:border-[#080b14]/40 hover:bg-white'
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Box
                      className={cn('h-3.5 w-3.5', active ? 'text-[#82a2ff]' : 'text-[#4673eb]')}
                    />
                    {preset.label}
                  </div>
                  <p
                    className={cn(
                      'mt-1 text-[11px]',
                      active ? 'text-[#a8b5d6]' : 'text-[#5c6b94]'
                    )}
                  >
                    {preset.description}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-6">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">Quantity *</label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">Length *</label>
              <input
                type="number"
                step="any"
                min={1}
                value={length}
                onChange={(e) => setLength(Number(e.target.value))}
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">Width *</label>
              <input
                type="number"
                step="any"
                min={1}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">Height *</label>
              <input
                type="number"
                step="any"
                min={1}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">Dim Unit</label>
              <select
                value={dimensionUnit}
                onChange={(e) => setDimensionUnit(e.target.value as DimensionUnit)}
                className="orbit-input-dark"
              >
                <option value="CM">cm</option>
                <option value="IN">inches</option>
                <option value="M">meters</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                  Unit Wt *
                </label>
                <input
                  type="number"
                  step="any"
                  min={0.1}
                  value={unitActualWeight}
                  onChange={(e) => setUnitActualWeight(Number(e.target.value))}
                  className="orbit-input-dark px-2.5"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">Unit</label>
                <select
                  value={weightUnit}
                  onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
                  className="orbit-input-dark px-2"
                >
                  <option value="KG">kg</option>
                  <option value="G">g</option>
                </select>
              </div>
            </div>
          </div>

          {calcResult ? (
            <div className="grid gap-3 rounded-2xl border border-[#1d2542] bg-[#080b14] p-4 text-xs text-white sm:grid-cols-4">
              <div>
                <p className="text-[#9aa7c7]">Total Actual Weight</p>
                <p className="mt-0.5 text-sm font-bold">{calcResult.totalActualWeightKg} kg</p>
              </div>
              <div>
                <p className="text-[#9aa7c7]">
                  Volumetric (÷ {calcResult.volumetricDivisor})
                </p>
                <p className="mt-0.5 text-sm font-bold">{calcResult.totalVolumetricWeightKg} kg</p>
              </div>
              <div>
                <p className="text-[#82a2ff]">
                  Chargeable Weight ({calcResult.billingBasis})
                </p>
                <p className="mt-0.5 text-base font-extrabold text-white">
                  {calcResult.chargeableWeightKg} kg
                </p>
              </div>
              <div>
                <p className="text-[#9aa7c7]">Cargo Volume (separate)</p>
                <p className="mt-0.5 text-sm font-bold">{calcResult.totalVolumeCbm} m³</p>
              </div>
            </div>
          ) : null}

          {quoteResult ? (
            <div className="space-y-2.5 rounded-2xl border border-[#cddbfa] bg-[#f4f8ff] p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[#080b14]">
                  Projected Price Breakdown (Rate:{' '}
                  {formatPaise(quoteResult.effectiveRatePaisePerKg)} / Chargeable kg)
                </span>
                <Badge variant="warning">Non-Final Estimate Until Cutoff</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-5">
                <div>
                  <span className="text-[#5c6b94]">Base Freight</span>
                  <p className="font-semibold text-[#080b14]">
                    {formatPaise(quoteResult.baseFreightPaise)}
                  </p>
                </div>
                <div>
                  <span className="text-[#5c6b94]">Pool Discount</span>
                  <p className="font-semibold text-emerald-700">
                    -{formatPaise(quoteResult.poolDiscountPaise)}
                  </p>
                </div>
                <div>
                  <span className="text-[#5c6b94]">Handling Fee</span>
                  <p className="font-semibold text-[#080b14]">
                    {formatPaise(quoteResult.handlingFeePaise)}
                  </p>
                </div>
                <div>
                  <span className="text-[#5c6b94]">Guaranteed Ceiling</span>
                  <p className="font-semibold text-[#080b14]">
                    {formatPaise(quoteResult.ceilingPricePaise)}
                  </p>
                </div>
                <div>
                  <span className="font-medium text-[#4673eb]">Projected Total</span>
                  <p className="text-sm font-bold text-[#080b14]">
                    {formatPaise(quoteResult.computedPricePaise)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#5c6b94]">
                <span>
                  Refundable booking token:{' '}
                  <strong className="text-[#080b14]">
                    {formatPaise(quoteResult.tokenAmountPaise)}
                  </strong>
                </span>
                <span>
                  Estimated remaining balance (collected at pickup):{' '}
                  <strong className="text-[#080b14]">
                    {formatPaise(
                      Math.max(0, quoteResult.computedPricePaise - quoteResult.tokenAmountPaise)
                    )}
                  </strong>
                </span>
                <span>
                  (Token is credited toward final locked price; never exceeds guaranteed ceiling.)
                </span>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Declared Contents *
              </label>
              <input
                value={declaredContents}
                onChange={(e) => setDeclaredContents(e.target.value)}
                placeholder="e.g. Cotton fabric rolls / agro feed"
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Handling Notes
              </label>
              <input
                value={handlingNotes}
                onChange={(e) => setHandlingNotes(e.target.value)}
                placeholder="Keep dry, fragile edges"
                className="orbit-input-dark"
              />
            </div>
          </div>

          {category === 'CUSTOM' ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Irregular Cargo Geometry / Loading Notes
              </label>
              <input
                value={irregularCargoNotes}
                onChange={(e) => setIrregularCargoNotes(e.target.value)}
                placeholder="e.g. L-shaped machine frame, overhang clearance needed"
                className="orbit-input-dark"
              />
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs font-medium text-[#3b476b]">
            <input
              type="checkbox"
              checked={stackable}
              onChange={(e) => setStackable(e.target.checked)}
              className="h-4 w-4 rounded border-[#cddbfa] accent-[#080b14]"
            />
            Cargo is stackable (uncheck for top-load / fragile rolls)
          </label>
        </div>
      </section>

      {/* 3. Delivery Location & Map Pin */}
      <section className="orbit-reveal-3 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[#080b14] sm:text-base">
              3. Recipient &amp; Delivery Location (Rural / Semi-Urban Pin)
            </h2>
            <p className="text-xs text-[#5c6b94]">
              Enter landmark/village details, auto-locate, and drag the pin to correct manually.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleGeocode()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-2xl border border-[#d5ddf0] bg-white px-4 py-2 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14]"
          >
            <Navigation className="h-3.5 w-3.5 text-[#4673eb]" />
            Auto-Locate Pin
          </button>
        </div>

        <div className="space-y-4 p-6">
          {geocodeMsg ? (
            <div className="flex items-center gap-2 rounded-2xl border border-[#cddbfa] bg-[#eef3ff] px-3.5 py-2.5 text-xs text-[#080b14]">
              <MapPin className="h-4 w-4 shrink-0 text-[#4673eb]" />
              {geocodeMsg}
            </div>
          ) : null}

          <div className="grid gap-3.5 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Recipient Name / Shop *
              </label>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Anand Yarn Traders"
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Recipient Phone *
              </label>
              <input
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder="+919825000111"
                className="orbit-input-dark"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Address Line / Plot / Shop No. *
              </label>
              <input
                value={deliveryAddressLine}
                onChange={(e) => setDeliveryAddressLine(e.target.value)}
                placeholder="Plot 12, GIDC Phase 2"
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Village / Town *
              </label>
              <input
                value={deliveryVillageOrTown}
                onChange={(e) => setDeliveryVillageOrTown(e.target.value)}
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">District *</label>
              <input
                value={deliveryDistrict}
                onChange={(e) => setDeliveryDistrict(e.target.value)}
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">State *</label>
              <input
                value={deliveryState}
                onChange={(e) => setDeliveryState(e.target.value)}
                className="orbit-input-dark"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                PIN Code (6 digits) *
              </label>
              <input
                value={deliveryPincode}
                onChange={(e) => setDeliveryPincode(e.target.value)}
                placeholder="388001"
                pattern="\d{6}"
                className="orbit-input-dark font-mono"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Landmark (helpful for semi-urban/rural drop)
              </label>
              <input
                value={deliveryLandmark}
                onChange={(e) => setDeliveryLandmark(e.target.value)}
                placeholder="Opposite Dairy Gate / Near Water Tank"
                className="orbit-input-dark"
              />
            </div>
          </div>

          <MapPinPicker coordinates={deliveryCoords} onChange={setDeliveryCoords} />

          {dropZoneDistanceKm !== null && selectedDeliveryStop ? (
            isOutsideDropZone ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
                  <span>
                    Map pin is <strong>{dropZoneDistanceKm.toFixed(1)} km</strong> from{' '}
                    <strong>{selectedDeliveryStop.name}</strong> (exceeds {MAX_DROP_ZONE_RADIUS_KM}{' '}
                    km drop-zone service area). Move the pin into this drop zone or select a
                    matching Destination Drop Zone above.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => syncDestinationStop(selectedDeliveryStop)}
                  className="cursor-pointer rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-900 hover:bg-rose-100"
                >
                  Move Pin to {selectedDeliveryStop.name}
                </button>
              </div>
            ) : (
              <p className="text-[11px] font-medium text-emerald-700">
                Pin is {dropZoneDistanceKm.toFixed(1)} km from {selectedDeliveryStop.name} hub
                (within {MAX_DROP_ZONE_RADIUS_KM} km drop-zone delivery area).
              </p>
            )
          ) : null}
        </div>
      </section>

      {/* 4. Standard Pooling Payment Workflow */}
      <section className="orbit-reveal-4 overflow-hidden rounded-[28px] border border-[#1d2542] bg-[#080b14] p-6 text-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.65)] sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
          <h2 className="text-base font-semibold text-white">4. Standard Pooling Payment</h2>
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold text-[#82a2ff]">
            Refundable Token + Pickup Balance
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5 text-xs text-[#a8b5d6]">
            <p className="font-medium text-white">
              1. Booking Token (15% of ceiling):{' '}
              <strong className="text-[#82a2ff]">
                {quoteResult ? formatPaise(quoteResult.tokenAmountPaise) : 'Calculated from cargo'}
              </strong>{' '}
              due now to reserve pool capacity.
            </p>
            <p>
              2. Final pooled rate locks automatically at cutoff with your token credited toward the
              final charge. Remaining balance (
              {quoteResult
                ? formatPaise(
                    Math.max(0, quoteResult.computedPricePaise - quoteResult.tokenAmountPaise)
                  )
                : 'final charge minus token'}{' '}
              est.) is collected at pickup via QR verification.
            </p>
          </div>

          <button
            type="submit"
            disabled={bookMutation.isPending || isOutsideDropZone}
            className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-xs font-semibold text-[#080b14] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#eef3ff] disabled:pointer-events-none disabled:opacity-45"
          >
            {bookMutation.isPending ? 'Creating Booking...' : 'Create Shipment Booking'}
          </button>
        </div>
      </section>
    </form>
  );
}
