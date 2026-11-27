import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Calculator,
  CheckCircle2,
  CreditCard,
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
  DimensionUnit,
  PaymentChoice,
  PriceCalculationBreakdown,
  WeightUnit,
} from '../../types/api';

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
  const [pickupStopCode, setPickupStopCode] = useState('');
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
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>(
    'TOKEN_PLUS_PICKUP_BALANCE'
  );
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

  const effectivePickupStopCode = useMemo(() => {
    if (
      pickupStopCode &&
      selectedCorridor?.stops.some((s) => s.stopCode === pickupStopCode)
    ) {
      return pickupStopCode;
    }
    return selectedCorridor?.stops[0]?.stopCode ?? '';
  }, [pickupStopCode, selectedCorridor]);

  const effectiveDeliveryStopCode = useMemo(() => {
    if (
      deliveryStopCode &&
      selectedCorridor?.stops.some((s) => s.stopCode === deliveryStopCode)
    ) {
      return deliveryStopCode;
    }
    return selectedCorridor?.stops[1]?.stopCode ?? '';
  }, [deliveryStopCode, selectedCorridor]);

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
    if (!selectedCorridor || !effectiveServiceDate) {
      setFormError('Please select a corridor and an upcoming bookable service date.');
      return;
    }

    bookMutation.mutate({
      corridorId: selectedCorridor._id,
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
      paymentChoice,
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
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            1. Corridor, Service Date & Stops
          </h2>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Corridor
            </label>
            <select
              value={selectedCorridor?._id ?? ''}
              onChange={(e) => {
                setCorridorId(e.target.value);
                setServiceDate('');
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
              Origin / Pickup Zone
            </label>
            <select
              value={effectivePickupStopCode}
              onChange={(e) => setPickupStopCode(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {selectedCorridor?.stops.map((stop) => (
                <option key={stop.stopCode} value={stop.stopCode}>
                  {stop.sequenceOrder + 1}. {stop.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Destination Drop Zone
            </label>
            <select
              value={effectiveDeliveryStopCode}
              onChange={(e) => {
                const code = e.target.value;
                setDeliveryStopCode(code);
                const stop = selectedCorridor?.stops.find((s) => s.stopCode === code);
                if (stop) {
                  setDeliveryVillageOrTown(stop.name.split(' ')[0]);
                  setDeliveryDistrict(stop.district);
                  setDeliveryCoords(stop.location.coordinates);
                }
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {selectedCorridor?.stops.map((stop) => (
                <option key={stop.stopCode} value={stop.stopCode}>
                  {stop.sequenceOrder + 1}. {stop.name}
                </option>
              ))}
            </select>
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
                  Remaining payable balance:{' '}
                  <strong className="text-slate-900">{formatPaise(quoteResult.remainingBalancePaise)}</strong>
                </span>
                <span>(Never exceeds guaranteed price ceiling.)</span>
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
        </CardContent>
      </Card>

      {/* Payment Choice & Submit */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">4. Payment Choice</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <select
            value={paymentChoice}
            onChange={(e) => setPaymentChoice(e.target.value as PaymentChoice)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="TOKEN_PLUS_PICKUP_BALANCE">
              Refundable Booking Token (15%) + Pickup Balance
            </option>
            <option value="FULL_PREPAID">Full Prepaid (Prototype Simulation)</option>
          </select>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={bookMutation.isPending}
          >
            {bookMutation.isPending ? 'Creating Booking...' : 'Create Shipment Booking'}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
