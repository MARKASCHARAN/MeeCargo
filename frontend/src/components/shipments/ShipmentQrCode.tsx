import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function ShipmentQrCode({
  qrToken,
  reference,
}: {
  qrToken: string;
  reference: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(qrToken, { width: 120, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [qrToken]);

  if (!dataUrl) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 text-xs">
      <img
        src={dataUrl}
        alt={`Pickup QR for ${reference}`}
        className="h-16 w-16 shrink-0"
      />
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">Pickup Verification QR</p>
        <p className="truncate font-mono text-[10px] text-slate-500">{qrToken}</p>
        <p className="text-[10px] text-slate-400">
          Contains non-PII verification token only
        </p>
      </div>
    </div>
  );
}
