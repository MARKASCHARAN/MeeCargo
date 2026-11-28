import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, CreditCard, Zap } from 'lucide-react';
import {
  createExpressMarketplaceBooking,
  quoteExpressMarketplaceBooking,
} from '@/api/client';
import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/format';
import type {
  CargoCategory,
  DimensionUnit,
  ExpressMarketplaceQuote,
  WeightUnit,
} from '@/types/api';

function makeExpressKey() {
  return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ExpressBookingPage() {
  const [serviceType, setServiceType] = useState<'EXPRESS_MARKETPLACE' | 'NEW_ROUTE_MARKETPLACE'>(
    'EXPRESS_MARKETPLACE'
  );
  const [pickupAddressLine, setPickupAddressLine] = useState('Plot 18, Rural Rice Mill Road');
  const [pickupTown, setPickupTown] = useState('Tadepalligudem');
  const [pickupDistrict, setPickupDistrict] = useState('West Godavari');
  const [pickupPincode, setPickupPincode] = useState('534101');
  const [pickupLng, setPickupLng] = useState(81.527);
  const [pickupLat, setPickupLat] = useState(16.8147);
  const [pickupContactName, setPickupContactName] = useState('Godavari Agro Manager');
  const [pickupContactPhone, setPickupContactPhone] = useState('+919848001100');

  const [deliveryAddressLine, setDeliveryAddressLine] = useState('Shop 12, Gollapudi Agricultural Yard');
  const [deliveryTown, setDeliveryTown] = useState('Vijayawada');
  const [deliveryDistrict, setDeliveryDistrict] = useState('NTR');
  const [deliveryPincode, setDeliveryPincode] = useState('521225');
  const [deliveryLng, setDeliveryLng] = useState(80.5847);
  const [deliveryLat, setDeliveryLat] = useState(16.5449);
  const [recipientName, setRecipientName] = useState('Krishna Produce Wholesale');
  const [recipientPhone, setRecipientPhone] = useState('+919848002299');

  const [category, setCategory] = useState<CargoCategory>('STANDARD_BOX');
  const [quantity, setQuantity] = useState(4);
  const [length, setLength] = useState(60);
  const [width, setWidth] = useState(40);
  const [height, setHeight] = useState(40);
  const [dimensionUnit] = useState<DimensionUnit>('CM');
  const [unitActualWeight, setUnitActualWeight] = useState(25);
  const [weightUnit] = useState<WeightUnit>('KG');
  const [stackable, setStackable] = useState(true);
  const [declaredContents, setDeclaredContents] = useState('Urgent industrial spares');
  const [idempotencyKey] = useState(() => makeExpressKey());

  const [quote, setQuote] = useState<ExpressMarketplaceQuote | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{
    reference: string;
    trackingToken: string;
    opportunityCode?: string;
    dispatchedCount?: number;
  } | null>(null);

  const buildPayload = () => ({
    serviceType,
    pickupStopCode: serviceType === 'EXPRESS_MARKETPLACE' ? 'EXP-PKP' : 'NRT-PKP',
    deliveryStopCode: serviceType === 'EXPRESS_MARKETPLACE' ? 'EXP-DRP' : 'NRT-DRP',
    pickupAddress: {
      addressLine: pickupAddressLine,
      villageOrTown: pickupTown,
      district: pickupDistrict,
      state: 'Gujarat',
      pincode: pickupPincode,
      location: { type: 'Point' as const, coordinates: [pickupLng, pickupLat] as [number, number] },
    },
    deliveryAddress: {
      addressLine: deliveryAddressLine,
      villageOrTown: deliveryTown,
      district: deliveryDistrict,
      state: 'Gujarat',
      pincode: deliveryPincode,
      location: {
        type: 'Point' as const,
        coordinates: [deliveryLng, deliveryLat] as [number, number],
      },
    },
    pickupContact: { name: pickupContactName, phone: pickupContactPhone },
    recipientName,
    recipientPhone,
    cargo: {
      category,
      quantity,
      unitDimensions: { length, width, height, unit: dimensionUnit },
      unitActualWeight,
      weightUnit,
      stackable,
      handlingRestrictions: stackable ? [] : ['NON_STACKABLE'],
      declaredContents,
    },
    simulatePaymentOutcome: 'SUCCESS' as const,
    idempotencyKey,
  });

  const quoteMutation = useMutation({
    mutationFn: () => quoteExpressMarketplaceBooking(buildPayload()),
    onSuccess: (res) => {
      setErrorMsg(null);
      setQuote(res.quote);
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
    },
  });

  const bookMutation = useMutation({
    mutationFn: () => createExpressMarketplaceBooking(buildPayload()),
    onSuccess: (res) => {
      setErrorMsg(null);
      setCreatedResult({
        reference: res.shipment.reference,
        trackingToken: res.shipment.trackingToken,
        opportunityCode: res.opportunity?.opportunityCode,
        dispatchedCount: res.dispatchedCount,
      });
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
    },
  });

  if (createdResult) {
    return (
      <div className="orbit-reveal-1 overflow-hidden rounded-[28px] border border-[#1d2542] bg-white shadow-sm">
        <div className="flex items-center gap-2.5 bg-[#080b14] px-6 py-5 text-white">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <h1 className="text-lg font-bold">
            {serviceType === 'EXPRESS_MARKETPLACE'
              ? 'One-Way Express Booking Confirmed'
              : 'New-Route Marketplace Demand Recorded'}
          </h1>
        </div>
        <div className="space-y-4 p-6 text-sm text-[#4d5a83]">
          <p>
            Shipment Reference:{' '}
            <strong className="font-mono text-[#080b14]">{createdResult.reference}</strong>
          </p>
          {createdResult.opportunityCode ? (
            <p>
              Marketplace Opportunity:{' '}
              <strong className="font-mono text-[#4673eb]">{createdResult.opportunityCode}</strong>{' '}
              ({createdResult.dispatchedCount ?? 0} verified Tier 2 driver offer(s) dispatched)
            </p>
          ) : (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Batch viability is under evaluation; if minimum load fill is not reached by deadline,
              full rollover/refund applies automatically.
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              to={`/track/${createdResult.trackingToken}`}
              className="inline-flex items-center rounded-2xl bg-[#080b14] px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-[#192038]"
            >
              Open Live Public Tracking
            </Link>
            <Link
              to="/shipper/shipments"
              className="inline-flex items-center rounded-2xl border border-[#d5ddf0] bg-white px-4 py-2.5 text-xs font-semibold text-[#080b14]"
            >
              View Shipments
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Obsidian Dark Hero */}
      <section className="orbit-reveal-1 relative overflow-hidden rounded-[28px] border border-[#1d2542] bg-[#080b14] p-6 text-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.65)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(70,115,235,0.28),transparent_70%)] blur-xl"
        />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              to="/shipper/book"
              className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#8ea5e2] hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Standard Scheduled Shared Pool
            </Link>
            <h1 className="flex items-center gap-2.5 text-[26px] font-[550] leading-tight tracking-[-0.04em] text-white sm:text-[34px]">
              <Zap className="h-6 w-6 text-[#82a2ff]" />
              <span>
                Express &amp; new-route{' '}
                <em
                  className="font-orbit-serif text-[1.12em] font-normal text-[#82a2ff]"
                  style={{ fontStyle: 'italic' }}
                >
                  marketplace.
                </em>
              </span>
            </h1>
            <p className="mt-1 text-xs text-[#a8b5d6] sm:text-sm">
              Direct point-to-point Tier 2 dispatch for urgent freight. One-way delivery only.
            </p>
          </div>

          <span className="rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-semibold text-[#82a2ff]">
            ONE-WAY TIER 2 MARKETPLACE
          </span>
        </div>
      </section>

      {errorMsg ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      {/* 1. Dispatch Mode */}
      <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
        <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
          <h2 className="text-sm font-semibold text-[#080b14]">1. Dispatch Mode</h2>
        </div>
        <div className="flex flex-wrap gap-3 p-6">
          <button
            type="button"
            onClick={() => setServiceType('EXPRESS_MARKETPLACE')}
            className={cn(
              'cursor-pointer rounded-2xl border px-4 py-2.5 text-xs font-semibold transition',
              serviceType === 'EXPRESS_MARKETPLACE'
                ? 'border-[#080b14] bg-[#080b14] text-white shadow-xs'
                : 'border-[#d5ddf0] bg-white text-[#4d5a83] hover:border-[#080b14]'
            )}
          >
            Express Direct (One-Way Immediate Dispatch)
          </button>
          <button
            type="button"
            onClick={() => setServiceType('NEW_ROUTE_MARKETPLACE')}
            className={cn(
              'cursor-pointer rounded-2xl border px-4 py-2.5 text-xs font-semibold transition',
              serviceType === 'NEW_ROUTE_MARKETPLACE'
                ? 'border-[#080b14] bg-[#080b14] text-white shadow-xs'
                : 'border-[#d5ddf0] bg-white text-[#4d5a83] hover:border-[#080b14]'
            )}
          >
            New-Route Batch (Subject to Viability Threshold)
          </button>
        </div>
      </section>

      {/* 2 & 3 Locations */}
      <div className="orbit-reveal-2 grid gap-5 md:grid-cols-2">
        <section className="overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
          <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <h2 className="text-sm font-semibold text-[#080b14]">2. Origin Pickup Location</h2>
          </div>
          <div className="space-y-3 p-6 text-xs">
            <input
              value={pickupAddressLine}
              onChange={(e) => setPickupAddressLine(e.target.value)}
              placeholder="Address Line"
              className="orbit-input-dark"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                value={pickupTown}
                onChange={(e) => setPickupTown(e.target.value)}
                placeholder="City/Town"
                className="orbit-input-dark"
              />
              <input
                value={pickupDistrict}
                onChange={(e) => setPickupDistrict(e.target.value)}
                placeholder="District"
                className="orbit-input-dark"
              />
              <input
                value={pickupPincode}
                onChange={(e) => setPickupPincode(e.target.value)}
                placeholder="PIN"
                className="orbit-input-dark font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={pickupContactName}
                onChange={(e) => setPickupContactName(e.target.value)}
                placeholder="Pickup Contact Name"
                className="orbit-input-dark"
              />
              <input
                value={pickupContactPhone}
                onChange={(e) => setPickupContactPhone(e.target.value)}
                placeholder="Pickup Phone"
                className="orbit-input-dark"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="0.0001"
                value={pickupLat}
                onChange={(e) => setPickupLat(Number(e.target.value))}
                placeholder="Lat"
                className="orbit-input-dark"
              />
              <input
                type="number"
                step="0.0001"
                value={pickupLng}
                onChange={(e) => setPickupLng(Number(e.target.value))}
                placeholder="Lng"
                className="orbit-input-dark"
              />
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
          <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <h2 className="text-sm font-semibold text-[#080b14]">
              3. Recipient Delivery Location
            </h2>
          </div>
          <div className="space-y-3 p-6 text-xs">
            <input
              value={deliveryAddressLine}
              onChange={(e) => setDeliveryAddressLine(e.target.value)}
              placeholder="Delivery Address Line"
              className="orbit-input-dark"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                value={deliveryTown}
                onChange={(e) => setDeliveryTown(e.target.value)}
                placeholder="City/Town"
                className="orbit-input-dark"
              />
              <input
                value={deliveryDistrict}
                onChange={(e) => setDeliveryDistrict(e.target.value)}
                placeholder="District"
                className="orbit-input-dark"
              />
              <input
                value={deliveryPincode}
                onChange={(e) => setDeliveryPincode(e.target.value)}
                placeholder="PIN"
                className="orbit-input-dark font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Recipient Name"
                className="orbit-input-dark"
              />
              <input
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder="Recipient Phone"
                className="orbit-input-dark"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="0.0001"
                value={deliveryLat}
                onChange={(e) => setDeliveryLat(Number(e.target.value))}
                placeholder="Lat"
                className="orbit-input-dark"
              />
              <input
                type="number"
                step="0.0001"
                value={deliveryLng}
                onChange={(e) => setDeliveryLng(Number(e.target.value))}
                placeholder="Lng"
                className="orbit-input-dark"
              />
            </div>
          </div>
        </section>
      </div>

      {/* 4. Cargo & Quote */}
      <section className="orbit-reveal-3 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
        <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
          <h2 className="text-sm font-semibold text-[#080b14]">
            4. Cargo Details &amp; Capacity Quote
          </h2>
        </div>

        <div className="space-y-4 p-6 text-xs">
          <div className="grid gap-3 sm:grid-cols-6">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CargoCategory)}
              className="orbit-input-dark sm:col-span-2"
            >
              <option value="STANDARD_BOX">Standard Box</option>
              <option value="SACK_BAG">Sack / Bag</option>
              <option value="TEXTILE_ROLL">Textile Roll</option>
              <option value="PALLET_BUNDLE">Pallet Bundle</option>
              <option value="CUSTOM">Custom Cargo</option>
            </select>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              placeholder="Qty"
              className="orbit-input-dark"
            />
            <input
              type="number"
              min={1}
              value={unitActualWeight}
              onChange={(e) => setUnitActualWeight(Number(e.target.value))}
              placeholder="Unit Weight (kg)"
              className="orbit-input-dark"
            />
            <input
              type="number"
              min={1}
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              placeholder="L (cm)"
              className="orbit-input-dark"
            />
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              placeholder="W (cm)"
              className="orbit-input-dark"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              placeholder="Height (cm)"
              className="orbit-input-dark"
            />
            <input
              value={declaredContents}
              onChange={(e) => setDeclaredContents(e.target.value)}
              placeholder="Declared Contents"
              className="orbit-input-dark sm:col-span-2"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-[#3b476b]">
            <input
              type="checkbox"
              checked={stackable}
              onChange={(e) => setStackable(e.target.checked)}
              className="h-4 w-4 rounded accent-[#080b14]"
            />
            Stackable cargo
          </label>

          {quote ? (
            <div className="space-y-1.5 rounded-2xl border border-[#1d2542] bg-[#080b14] p-4 text-xs text-white">
              <div className="flex justify-between text-[#a8b5d6]">
                <span>Estimated Road Distance:</span>
                <strong className="text-white">
                  {quote.estimatedDistanceKm} km ({quote.estimatedDurationMin} min)
                </strong>
              </div>
              <div className="flex justify-between text-[#a8b5d6]">
                <span>Compatible Verified Tier 2 Vehicles Available:</span>
                <strong
                  className={quote.compatibleVehicleCount > 0 ? 'text-emerald-400' : 'text-rose-400'}
                >
                  {quote.compatibleVehicleCount}
                </strong>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2 text-sm font-bold text-white">
                <span>Fixed One-Way Charge:</span>
                <span className="text-[#82a2ff]">{formatPaise(quote.customerChargePaise)}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              disabled={quoteMutation.isPending}
              onClick={() => quoteMutation.mutate()}
              className="cursor-pointer rounded-2xl border border-[#d5ddf0] bg-white px-5 py-2.5 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14] disabled:opacity-50"
            >
              {quoteMutation.isPending ? 'Checking Capacity & Quote...' : 'Calculate Express Quote'}
            </button>
            <button
              type="button"
              disabled={bookMutation.isPending}
              onClick={() => bookMutation.mutate()}
              className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#080b14] px-6 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#192038] disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4 text-[#82a2ff]" />
              {bookMutation.isPending
                ? 'Confirming Dispatch...'
                : 'Confirm & Dispatch One-Way Booking (Simulated)'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
