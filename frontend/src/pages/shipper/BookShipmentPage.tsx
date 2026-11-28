import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
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
} from '../../api/client';
import { MapPinPicker } from '../../components/map/MapPinPicker';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/StateViews';
import { cn } from '../../lib/cn';
import { formatPaise } from '../../lib/format';
import type {
  CargoCalculationResult,
  CargoCategory,
  CorridorStop,
  DimensionUnit,
  PriceCalculationBreakdown,
  WeightUnit,
} from '../../types/api';

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
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <h1 className="text-lg font-bold text-slate-900">
                Booking Created: {createdRef}
              </h1>
            </div>
            <Badge variant="warning">SIMULATED PAYMENT</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Status is <strong>PENDING_TOKEN</strong>. Pay the refundable 15% booking token
            to join the live freight pool and reserve capacity.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {quoteResult ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span>Guaranteed Price Ceiling:</span>
                <strong>{formatPaise(quoteResult.ceilingPricePaise)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Projected Pooled Price (Non-Final Estimate):</span>
                <strong>{formatPaise(quoteResult.computedPricePaise)}</strong>
              </div>
              <div className="flex justify-between text-emerald-800 font-semibold pt-1 border-t border-slate-200">
                <span>Refundable Token Due Now (15% of ceiling):</span>
                <span>{formatPaise(quoteResult.tokenAmountPaise)}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Est. Remaining Balance at Pickup (after token credit):</span>
                <strong>
                  {formatPaise(
                    Math.max(0, quoteResult.computedPricePaise - quoteResult.tokenAmountPaise)
                  )}
                </strong>
              </div>
            </div>
          ) : null}

          {formError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              disabled={payTokenMutation.isPending}
              onClick={() => payTokenMutation.mutate(createdShipmentId)}
            >
              <CreditCard className="h-4 w-4" />
              {payTokenMutation.isPending
                ? 'Processing Simulated Token...'
                : 'Pay Refundable Token (Simulated) & Join Pool'}
            </Button>
            <Link to="/shipper/shipments">
              <Button variant="outline">Pay Later in History</Button>
            </Link>
          </div>

          <p className="text-[11px] text-slate-500">
            Simulation notice: No real UPI or bank charge occurs in prototype mode.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedCorridor || !effectiveServiceDate || !effectivePickupStopCode || !effectiveDeliveryStopCode) {
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
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Book Shipment</h1>
        <p className="text-sm text-slate-500">
          Pickup defaults to your business profile ({business.businessName}).
        </p>
      </div>

      {formError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {formError}
        </div>
      ) : null}

      {/* Corridor & Service Date */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            1. Corridor, Service Date &amp; Route Stops
          </h2>
          <Badge variant="info">Standard Scheduled Shared Pool (One-Way)</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Corridor
            </label>
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
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {corridors.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Service Date (Automatic Pool Matching)
            </label>
            <select
              value={effectiveServiceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {(selectedCorridor?.serviceDates ?? []).map((sd) => (
                <option
                  key={sd.serviceDate}
                  value={sd.serviceDate}
                  disabled={!sd.bookable}
                >
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
            <p className="mt-1 text-[11px] text-slate-500">
              MeeCargo automatically associates your booking with the best operational pool.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Origin / Pickup Hub (Fixed)
            </label>
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-800">
              <span className="font-medium">
                {originStop
                  ? `${originStop.sequenceOrder + 1}. ${originStop.name} (${originStop.stopCode})`
                  : 'No origin configured'}
              </span>
              <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Origin pickup is fixed to the selected corridor&apos;s origin hub.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Destination Drop Zone *
            </label>
            <select
              value={effectiveDeliveryStopCode}
              onChange={(e) => {
                const stop = downstreamStops.find((s) => s.stopCode === e.target.value);
                syncDestinationStop(stop);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {downstreamStops.map((stop) => (
                <option key={stop.stopCode} value={stop.stopCode}>
                  {stop.sequenceOrder + 1}. {stop.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              Valid downstream drop zones for {selectedCorridor?.code}.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Cargo & Chargeable Weight */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              2. Cargo Details, Chargeable Weight & Projected Price
            </h2>
            <p className="text-xs text-slate-500">
              Deterministic backend calculation in paise. Projected price is non-final until cutoff.
            </p>
          </div>
          <Badge variant="info">
            <Calculator className="h-3.5 w-3.5" />
            Deterministic Pricing
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-5">
            {presets.map((preset) => (
              <button
                key={preset.category}
                type="button"
                onClick={() => applyPreset(preset.category)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors cursor-pointer',
                  category === preset.category
                    ? 'border-emerald-600 bg-emerald-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Box className="h-3.5 w-3.5 text-emerald-700" />
                  {preset.label}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{preset.description}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Quantity *
              </label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Length *
              </label>
              <input
                type="number"
                step="any"
                min={1}
                value={length}
                onChange={(e) => setLength(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Width *
              </label>
              <input
                type="number"
                step="any"
                min={1}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Height *
              </label>
              <input
                type="number"
                step="any"
                min={1}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Dim Unit
              </label>
              <select
                value={dimensionUnit}
                onChange={(e) => setDimensionUnit(e.target.value as DimensionUnit)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="CM">cm</option>
                <option value="IN">inches</option>
                <option value="M">meters</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-1">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Unit Wt *
                </label>
                <input
                  type="number"
                  step="any"
                  min={0.1}
                  value={unitActualWeight}
                  onChange={(e) => setUnitActualWeight(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Unit
                </label>
                <select
                  value={weightUnit}
                  onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                >
                  <option value="KG">kg</option>
                  <option value="G">g</option>
                </select>
              </div>
            </div>
          </div>

          {calcResult ? (
            <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs sm:grid-cols-4">
              <div>
                <p className="text-slate-500">Total Actual Weight</p>
                <p className="mt-0.5 text-sm font-bold text-slate-900">
                  {calcResult.totalActualWeightKg} kg
                </p>
              </div>
              <div>
                <p className="text-slate-500">
                  Volumetric (÷ {calcResult.volumetricDivisor})
                </p>
                <p className="mt-0.5 text-sm font-bold text-slate-900">
                  {calcResult.totalVolumetricWeightKg} kg
                </p>
              </div>
              <div>
                <p className="text-emerald-800">
                  Chargeable Weight ({calcResult.billingBasis})
                </p>
                <p className="mt-0.5 text-base font-extrabold text-emerald-900">
                  {calcResult.chargeableWeightKg} kg
                </p>
              </div>
              <div>
                <p className="text-slate-500">Cargo Volume (separate)</p>
                <p className="mt-0.5 text-sm font-bold text-slate-900">
                  {calcResult.totalVolumeCbm} m³
                </p>
              </div>
            </div>
          ) : null}

          {quoteResult ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-sky-950">
                  Projected Price Breakdown (Rate: {formatPaise(quoteResult.effectiveRatePaisePerKg)} / Chargeable kg)
                </span>
                <Badge variant="warning">Non-Final Estimate Until Cutoff</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-5">
                <div>
                  <span className="text-slate-500">Base Freight</span>
                  <p className="font-semibold text-slate-900">
                    {formatPaise(quoteResult.baseFreightPaise)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Pool Discount</span>
                  <p className="font-semibold text-emerald-700">
                    -{formatPaise(quoteResult.poolDiscountPaise)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Handling Fee</span>
                  <p className="font-semibold text-slate-900">
                    {formatPaise(quoteResult.handlingFeePaise)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Guaranteed Ceiling</span>
                  <p className="font-semibold text-slate-900">
                    {formatPaise(quoteResult.ceilingPricePaise)}
                  </p>
                </div>
                <div>
                  <span className="text-sky-900 font-medium">Projected Total</span>
                  <p className="text-sm font-bold text-sky-950">
                    {formatPaise(quoteResult.computedPricePaise)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                <span>
                  Refundable booking token:{' '}
                  <strong className="text-slate-900">{formatPaise(quoteResult.tokenAmountPaise)}</strong>
                </span>
                <span>
                  Estimated remaining balance (collected at pickup):{' '}
                  <strong className="text-slate-900">
                    {formatPaise(
                      Math.max(0, quoteResult.computedPricePaise - quoteResult.tokenAmountPaise)
                    )}
                  </strong>
                </span>
                <span>(Token is credited toward final locked price; never exceeds guaranteed ceiling.)</span>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Declared Contents *
              </label>
              <input
                value={declaredContents}
                onChange={(e) => setDeclaredContents(e.target.value)}
                placeholder="e.g. Cotton fabric rolls / agro feed"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Handling Notes
              </label>
              <input
                value={handlingNotes}
                onChange={(e) => setHandlingNotes(e.target.value)}
                placeholder="Keep dry, fragile edges"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {category === 'CUSTOM' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Irregular Cargo Geometry / Loading Notes
              </label>
              <input
                value={irregularCargoNotes}
                onChange={(e) => setIrregularCargoNotes(e.target.value)}
                placeholder="e.g. L-shaped machine frame, overhang clearance needed"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={stackable}
              onChange={(e) => setStackable(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Cargo is stackable (uncheck for top-load / fragile rolls)
          </label>
        </CardContent>
      </Card>

      {/* Delivery Location & Map Pin */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              3. Recipient & Delivery Location (Rural / Semi-Urban Pin)
            </h2>
            <p className="text-xs text-slate-500">
              Enter landmark/village details, auto-locate, and drag the pin to correct manually.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleGeocode()}
          >
            <Navigation className="h-3.5 w-3.5" />
            Auto-Locate Pin
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {geocodeMsg ? (
            <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <MapPin className="h-4 w-4 shrink-0" />
              {geocodeMsg}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Recipient Name / Shop *
              </label>
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Anand Yarn Traders"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Recipient Phone *
              </label>
              <input
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder="+919825000111"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Address Line / Plot / Shop No. *
              </label>
              <input
                value={deliveryAddressLine}
                onChange={(e) => setDeliveryAddressLine(e.target.value)}
                placeholder="Plot 12, GIDC Phase 2"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Village / Town *
              </label>
              <input
                value={deliveryVillageOrTown}
                onChange={(e) => setDeliveryVillageOrTown(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                District *
              </label>
              <input
                value={deliveryDistrict}
                onChange={(e) => setDeliveryDistrict(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                State *
              </label>
              <input
                value={deliveryState}
                onChange={(e) => setDeliveryState(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                PIN Code (6 digits) *
              </label>
              <input
                value={deliveryPincode}
                onChange={(e) => setDeliveryPincode(e.target.value)}
                placeholder="388001"
                pattern="\d{6}"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Landmark (helpful for semi-urban/rural drop)
              </label>
              <input
                value={deliveryLandmark}
                onChange={(e) => setDeliveryLandmark(e.target.value)}
                placeholder="Opposite Dairy Gate / Near Water Tank"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <MapPinPicker coordinates={deliveryCoords} onChange={setDeliveryCoords} />

          {dropZoneDistanceKm !== null && selectedDeliveryStop ? (
            isOutsideDropZone ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
                  <span>
                    Map pin is <strong>{dropZoneDistanceKm.toFixed(1)} km</strong> from{' '}
                    <strong>{selectedDeliveryStop.name}</strong> (exceeds {MAX_DROP_ZONE_RADIUS_KM}{' '}
                    km drop-zone service area). Move the pin into this drop zone or select a
                    matching Destination Drop Zone above.
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => syncDestinationStop(selectedDeliveryStop)}
                >
                  Move Pin to {selectedDeliveryStop.name}
                </Button>
              </div>
            ) : (
              <p className="text-[11px] text-emerald-700">
                Pin is {dropZoneDistanceKm.toFixed(1)} km from {selectedDeliveryStop.name} hub
                (within {MAX_DROP_ZONE_RADIUS_KM} km drop-zone delivery area).
              </p>
            )
          ) : null}
        </CardContent>
      </Card>

      {/* Standard Pooling Payment Workflow */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            4. Standard Pooling Payment
          </h2>
          <Badge variant="success">Refundable Token + Pickup Balance</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 text-xs text-slate-600">
            <p className="font-medium text-slate-800">
              1. Booking Token (15% of ceiling):{' '}
              <strong className="text-slate-900">
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

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={bookMutation.isPending || isOutsideDropZone}
            className="shrink-0"
          >
            {bookMutation.isPending ? 'Creating Booking...' : 'Create Shipment Booking'}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
