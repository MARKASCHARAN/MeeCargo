import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CheckCircle2, QrCode, ShieldCheck, WifiOff } from 'lucide-react';
import { fetchDriverTrips, scanDriverQrPickup } from '@/api/client';
import { formatPaise } from '@/lib/format';

export function DriverScanPage() {
  const queryClient = useQueryClient();
  const tripsQuery = useQuery({
    queryKey: ['driver-trips'],
    queryFn: fetchDriverTrips,
  });

  const trips = tripsQuery.data?.trips ?? [];
  const [selectedTripId, setSelectedTripId] = useState('');
  const [qrInput, setQrInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{
    reference: string;
    deduplicated: boolean;
    balanceDuePaise: number;
    balanceTriggered: boolean;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const effectiveTripId = selectedTripId || trips[0]?._id || '';

  const scanMutation = useMutation({
    mutationFn: ({ tripId, qrToken }: { tripId: string; qrToken: string }) =>
      scanDriverQrPickup(tripId, {
        qrToken,
        idempotencyKey: `qr_${tripId}_${qrToken}`,
      }),
    onSuccess: (res) => {
      setErrorMsg(null);
      setScanResult({
        reference: res.shipment.reference,
        deduplicated: res.deduplicated,
        balanceDuePaise: res.pickupBalanceDuePaise,
        balanceTriggered: res.balanceCollectionTriggered,
      });
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
    },
  });

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        void scannerRef.current.stop().catch(() => undefined);
      }
    };
  }, []);

  const startCameraScan = async () => {
    setErrorMsg(null);
    if (!effectiveTripId) {
      setErrorMsg('Select an assigned trip first.');
      return;
    }
    try {
      const scanner = new Html5Qrcode('driver-qr-reader');
      scannerRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          setQrInput(decodedText);
          void scanner.stop().catch(() => undefined);
          setScanning(false);
          scanMutation.mutate({ tripId: effectiveTripId, qrToken: decodedText });
        },
        () => undefined
      );
    } catch {
      setScanning(false);
      setErrorMsg(
        'Camera unavailable in this browser environment. Paste or enter the shipment QR token below.'
      );
    }
  };

  const stopCameraScan = async () => {
    if (scannerRef.current) {
      await scannerRef.current.stop().catch(() => undefined);
    }
    setScanning(false);
  };

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  return (
    <div className="space-y-6">
      {/* Editorial Orbit Header */}
      <section className="orbit-reveal-1 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_18px_55px_-28px_rgba(24,60,115,0.22)] sm:p-7">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#7a94df]">
            Corridor Pickup Verification
          </p>
          <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-[#080e2b] sm:text-[36px]">
            QR pickup{' '}
            <em
              className="font-orbit-serif text-[1.12em] font-normal text-[#4a72e7]"
              style={{ fontStyle: 'italic' }}
            >
              verification.
            </em>
          </h1>
          <p className="mt-1 text-xs text-[#5c6b94] sm:text-sm">
            Verify cargo belongs to your manifest and trigger pickup balance collection.
          </p>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cddbfa] bg-[#eef3ff] px-3.5 py-1.5 text-xs font-semibold text-[#3563e4]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Online Required
        </span>
      </section>

      {!isOnline ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
          <WifiOff className="h-4 w-4 shrink-0" />
          QR manifest verification requires an active network connection.
        </div>
      ) : null}

      {/* Responsive Desktop Split (Camera Left / Manual Token & Status Right) */}
      <div className="orbit-reveal-2 grid gap-6 lg:grid-cols-12">
        {/* Camera Scanner Frame */}
        <div className="flex flex-col justify-between rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_20px_55px_-28px_rgba(24,60,115,0.22)] sm:p-6 lg:col-span-7">
          <div>
            <div className="flex items-center justify-between gap-2 pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
                  <Camera className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[#080e2b]">Camera Scanner</h2>
                  <p className="text-[11px] text-[#5c6b94]">
                    Point your device camera at the shipment QR label
                  </p>
                </div>
              </div>
              {scanning ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Live Camera
                </span>
              ) : null}
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-[#dce5fa] bg-[#f4f8ff] p-2">
              <div
                id="driver-qr-reader"
                className="min-h-[210px] overflow-hidden rounded-xl bg-[#eef3ff]/70"
              />
              {!scanning ? (
                <div className="pointer-events-none flex flex-col items-center justify-center py-6 text-center">
                  <QrCode className="h-10 w-10 text-[#8ca4e3]" />
                  <p className="mt-2 text-xs font-medium text-[#5c6b94]">
                    Scanner standby — tap below to activate rear camera
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4">
            {!scanning ? (
              <button
                type="button"
                onClick={() => void startCameraScan()}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#080e2b] px-5 py-3 text-xs font-semibold text-white shadow-xs transition hover:-translate-y-0.5 hover:bg-[#141f4b]"
              >
                <Camera className="h-4 w-4" />
                Open Mobile Camera Scanner
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void stopCameraScan()}
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#d6e0f8] bg-white px-5 py-3 text-xs font-semibold text-[#080e2b] transition hover:border-rose-300 hover:text-rose-700"
              >
                Stop Scanner
              </button>
            )}
          </div>
        </div>

        {/* Trip Selection + Manual Token Verification */}
        <div className="flex flex-col justify-between space-y-5 rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_20px_55px_-28px_rgba(24,60,115,0.22)] sm:p-6 lg:col-span-5">
          <div className="space-y-5">
            <div>
              <label
                htmlFor="driver-scan-trip-select"
                className="mb-1.5 block text-xs font-semibold text-[#080e2b]"
              >
                Active Assigned Trip
              </label>
              <select
                id="driver-scan-trip-select"
                value={effectiveTripId}
                onChange={(e) => setSelectedTripId(e.target.value)}
                className="orbit-input"
              >
                {trips.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.tripCode} ({t.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 border-t border-[#eaf0fd] pt-4">
              <label
                htmlFor="driver-scan-manual-input"
                className="block text-xs font-semibold text-[#080e2b]"
              >
                Or Enter / Paste Shipment QR Identifier
              </label>
              <p className="text-[11px] text-[#5c6b94]">
                Idempotent verification safely prevents duplicate pickup charges.
              </p>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <input
                  id="driver-scan-manual-input"
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  placeholder="Paste 32-char QR token..."
                  className="orbit-input flex-1 font-mono"
                />
                <button
                  type="button"
                  disabled={!qrInput.trim() || !effectiveTripId || scanMutation.isPending}
                  onClick={() =>
                    scanMutation.mutate({ tripId: effectiveTripId, qrToken: qrInput.trim() })
                  }
                  className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-2xl bg-[#4673eb] px-5 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#345fda] disabled:pointer-events-none disabled:opacity-45"
                >
                  <QrCode className="h-4 w-4" />
                  Verify
                </button>
              </div>
            </div>

            {errorMsg ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
                {errorMsg}
              </div>
            ) : null}

            {scanResult ? (
              <div className="space-y-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Pickup Verified: {scanResult.reference}
                  {scanResult.deduplicated ? ' (Duplicate scan — idempotent)' : ''}
                </div>
                {scanResult.balanceTriggered ? (
                  <p>
                    Pickup balance collection triggered:{' '}
                    <strong>{formatPaise(scanResult.balanceDuePaise)}</strong>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-3.5 text-[11px] text-[#5c6b94]">
            Tip: Verified parcels automatically unlock in-transit controls and pickup balance
            settlement inside the Trips workspace.
          </div>
        </div>
      </div>
    </div>
  );
}
