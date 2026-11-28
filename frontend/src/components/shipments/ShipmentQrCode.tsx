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
    <div className="flex items-center gap-3 rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-3 text-xs">
      <img
        src={dataUrl}
        alt={`Pickup QR for ${reference}`}
        className="h-16 w-16 shrink-0 rounded-lg border border-[#e3ebfc] bg-white p-1"
      />
      <div className="min-w-0">
        <p className="font-semibold text-[#080b14]">Pickup Verification QR</p>
        <p className="truncate font-mono text-[10px] text-[#4d5a83]">{qrToken}</p>
        <p className="text-[10px] text-[#7a87aa]">
          Contains non-PII verification token only
        </p>
      </div>
    </div>
  );
}
