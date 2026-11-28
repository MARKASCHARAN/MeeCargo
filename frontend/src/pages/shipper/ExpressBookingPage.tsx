import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, CreditCard, Zap, AlertTriangle, ArrowLeft } from 'lucide-react';
import {
  createExpressMarketplaceBooking,
  quoteExpressMarketplaceBooking,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { formatPaise } from '../../lib/format';
import type { CargoCategory, DimensionUnit, ExpressMarketplaceQuote, WeightUnit } from '../../types/api';

function makeExpressKey() {
  return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ExpressBookingPage() {
  const [serviceType, setServiceType] = useState<'EXPRESS_MARKETPLACE' | 'NEW_ROUTE_MARKETPLACE'>(
    'EXPRESS_MARKETPLACE'
  );
  const [pickupAddressLine, setPickupAddressLine] = useState('Plot 45, GIDC Makarpura');
  const [pickupTown, setPickupTown] = useState('Vadodara');
  const [pickupDistrict, setPickupDistrict] = useState('Vadodara');
  const [pickupPincode, setPickupPincode] = useState('390010');
  const [pickupLng, setPickupLng] = useState(73.1812);
  const [pickupLat, setPickupLat] = useState(22.2587);
  const [pickupContactName, setPickupContactName] = useState('Warehouse Supervisor');
  const [pickupContactPhone, setPickupContactPhone] = useState('+919825001100');

  const [deliveryAddressLine, setDeliveryAddressLine] = useState('Gate 7, Sarkhej Freight Yard');
  const [deliveryTown, setDeliveryTown] = useState('Ahmedabad');
  const [deliveryDistrict, setDeliveryDistrict] = useState('Ahmedabad');
  const [deliveryPincode, setDeliveryPincode] = useState('382210');
  const [deliveryLng, setDeliveryLng] = useState(72.4986);
  const [deliveryLat, setDeliveryLat] = useState(22.9734);
  const [recipientName, setRecipientName] = useState('Patel Distributors');
  const [recipientPhone, setRecipientPhone] = useState('+919825002299');

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
      location: { type: 'Point' as const, coordinates: [deliveryLng, deliveryLat] as [number, number] },
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
      <Card className="border-emerald-200">
        <CardHeader>
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
            <h1 className="text-lg font-bold">
              {serviceType === 'EXPRESS_MARKETPLACE'
                ? 'One-Way Express Booking Confirmed'
                : 'New-Route Marketplace Demand Recorded'}
            </h1>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <p>
            Shipment Reference: <strong className="font-mono">{createdResult.reference}</strong>
          </p>
          {createdResult.opportunityCode ? (
            <p>
              Marketplace Opportunity:{' '}
              <strong className="font-mono text-emerald-700">{createdResult.opportunityCode}</strong>{' '}
              ({createdResult.dispatchedCount ?? 0} verified Tier 2 driver offer(s) dispatched)
            </p>
          ) : (
            <p className="text-xs text-amber-800">
              Batch viability is under evaluation; if minimum load fill is not reached by deadline, full rollover/refund applies automatically.
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link to={`/track/${createdResult.trackingToken}`}>
              <Button variant="primary">Open Live Public Tracking</Button>
            </Link>
            <Link to="/shipper/shipments">
              <Button variant="outline">View Shipments</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/shipper/book"
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Standard Scheduled Shared Pool
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Zap className="h-6 w-6 text-amber-500" />
            Express &amp; New-Route Marketplace (One-Way Direct)
          </h1>
          <p className="text-sm text-slate-500">
            Direct point-to-point Tier 2 dispatch for urgent freight. One-way delivery only (no two-way return trips).
          </p>
        </div>
        <Badge variant="info">ONE-WAY TIER 2 MARKETPLACE</Badge>
      </div>

      {errorMsg ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">1. Dispatch Mode</h2>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setServiceType('EXPRESS_MARKETPLACE')}
            className={`rounded-lg border px-4 py-2 text-xs font-semibold ${
              serviceType === 'EXPRESS_MARKETPLACE'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            Express Direct (One-Way Immediate Dispatch)
          </button>
          <button
            type="button"
            onClick={() => setServiceType('NEW_ROUTE_MARKETPLACE')}
            className={`rounded-lg border px-4 py-2 text-xs font-semibold ${
              serviceType === 'NEW_ROUTE_MARKETPLACE'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-700'
            }`}
          >
            New-Route Batch (Subject to Viability Threshold)
          </button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-900">2. Origin Pickup Location</h2>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <input
              value={pickupAddressLine}
              onChange={(e) => setPickupAddressLine(e.target.value)}
              placeholder="Address Line"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                value={pickupTown}
                onChange={(e) => setPickupTown(e.target.value)}
                placeholder="City/Town"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                value={pickupDistrict}
                onChange={(e) => setPickupDistrict(e.target.value)}
                placeholder="District"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                value={pickupPincode}
                onChange={(e) => setPickupPincode(e.target.value)}
                placeholder="PIN"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={pickupContactName}
                onChange={(e) => setPickupContactName(e.target.value)}
                placeholder="Pickup Contact Name"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                value={pickupContactPhone}
                onChange={(e) => setPickupContactPhone(e.target.value)}
                placeholder="Pickup Phone"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="0.0001"
                value={pickupLat}
                onChange={(e) => setPickupLat(Number(e.target.value))}
                placeholder="Lat"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                type="number"
                step="0.0001"
                value={pickupLng}
                onChange={(e) => setPickupLng(Number(e.target.value))}
                placeholder="Lng"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-900">3. Recipient Delivery Location</h2>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <input
              value={deliveryAddressLine}
              onChange={(e) => setDeliveryAddressLine(e.target.value)}
              placeholder="Delivery Address Line"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                value={deliveryTown}
                onChange={(e) => setDeliveryTown(e.target.value)}
                placeholder="City/Town"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                value={deliveryDistrict}
                onChange={(e) => setDeliveryDistrict(e.target.value)}
                placeholder="District"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                value={deliveryPincode}
                onChange={(e) => setDeliveryPincode(e.target.value)}
                placeholder="PIN"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Recipient Name"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder="Recipient Phone"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="0.0001"
                value={deliveryLat}
                onChange={(e) => setDeliveryLat(Number(e.target.value))}
                placeholder="Lat"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
              <input
                type="number"
                step="0.0001"
                value={deliveryLng}
                onChange={(e) => setDeliveryLng(Number(e.target.value))}
                placeholder="Lng"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">4. Cargo Details &amp; Capacity Quote</h2>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <div className="grid gap-3 sm:grid-cols-6">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CargoCategory)}
              className="rounded-lg border border-slate-300 px-3 py-2 sm:col-span-2"
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
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              type="number"
              min={1}
              value={unitActualWeight}
              onChange={(e) => setUnitActualWeight(Number(e.target.value))}
              placeholder="Unit Weight (kg)"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              type="number"
              min={1}
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              placeholder="L (cm)"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              placeholder="W (cm)"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              placeholder="Height (cm)"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <input
              value={declaredContents}
              onChange={(e) => setDeclaredContents(e.target.value)}
              placeholder="Declared Contents"
              className="rounded-lg border border-slate-300 px-3 py-2 sm:col-span-2"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={stackable}
              onChange={(e) => setStackable(e.target.checked)}
            />
            Stackable cargo
          </label>

          {quote ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
              <div className="flex justify-between">
                <span>Estimated Road Distance:</span>
                <strong>{quote.estimatedDistanceKm} km ({quote.estimatedDurationMin} min)</strong>
              </div>
              <div className="flex justify-between">
                <span>Compatible Verified Tier 2 Vehicles Available:</span>
                <strong className={quote.compatibleVehicleCount > 0 ? 'text-emerald-700' : 'text-rose-700'}>
                  {quote.compatibleVehicleCount}
                </strong>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold text-slate-900">
                <span>Fixed One-Way Charge:</span>
                <span>{formatPaise(quote.customerChargePaise)}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={quoteMutation.isPending}
              onClick={() => quoteMutation.mutate()}
            >
              {quoteMutation.isPending ? 'Checking Capacity & Quote...' : 'Calculate Express Quote'}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={bookMutation.isPending}
              onClick={() => bookMutation.mutate()}
            >
              <CreditCard className="h-4 w-4" />
              {bookMutation.isPending
                ? 'Confirming Dispatch...'
                : 'Confirm & Dispatch One-Way Booking (Simulated)'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
