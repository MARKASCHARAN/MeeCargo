import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CheckCircle2, QrCode, WifiOff } from 'lucide-react';
import { fetchDriverTrips, scanDriverQrPickup } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { formatPaise } from '../../lib/format';

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">QR Pickup Verification</h1>
          <p className="text-xs text-slate-500">
            Verify cargo belongs to your manifest and trigger pickup balance collection.
          </p>
        </div>
        <Badge variant="info">Online Required</Badge>
      </div>

      {!isOnline ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <WifiOff className="h-4 w-4 shrink-0" />
          QR manifest verification requires an active network connection.
        </div>
      ) : null}

      <Card>
        <CardHeader className="py-3">
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Active Assigned Trip
          </label>
          <select
            value={effectiveTripId}
            onChange={(e) => setSelectedTripId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {trips.map((t) => (
              <option key={t._id} value={t._id}>
                {t.tripCode} ({t.status})
              </option>
            ))}
          </select>
        </CardHeader>

        <CardContent className="space-y-4">
          <div id="driver-qr-reader" className="overflow-hidden rounded-lg bg-slate-100" />

          <div className="flex gap-2">
            {!scanning ? (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => void startCameraScan()}
              >
                <Camera className="h-4 w-4" />
                Open Mobile Camera Scanner
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void stopCameraScan()}
              >
                Stop Scanner
              </Button>
            )}
          </div>

          <div className="space-y-2 border-t border-slate-200 pt-3">
            <label className="block text-xs font-medium text-slate-700">
              Or Enter / Paste Shipment QR Identifier
            </label>
            <div className="flex gap-2">
              <input
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder="Paste 32-char QR token..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!qrInput.trim() || !effectiveTripId || scanMutation.isPending}
                onClick={() =>
                  scanMutation.mutate({ tripId: effectiveTripId, qrToken: qrInput.trim() })
                }
              >
                <QrCode className="h-4 w-4" />
                Verify
              </Button>
            </div>
          </div>

          {errorMsg ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {errorMsg}
            </div>
          ) : null}

          {scanResult ? (
            <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
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
        </CardContent>
      </Card>
    </div>
  );
}
