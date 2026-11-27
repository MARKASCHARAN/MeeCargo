import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface MapPinPickerProps {
  coordinates: [number, number]; // [longitude, latitude]
  onChange: (coords: [number, number]) => void;
  label?: string;
  heightClassName?: string;
}

const PIN_ICON = L.divIcon({
  className: 'meecargo-map-pin',
  html: `<div style="width:20px;height:20px;border-radius:9999px;background:#059669;border:3px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export function MapPinPicker({
  coordinates,
  onChange,
  label = 'Click map or drag pin to adjust location',
  heightClassName = 'h-56',
}: MapPinPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [lng, lat] = coordinates;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView([lat, lng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    const marker = L.marker([lat, lng], {
      draggable: true,
      icon: PIN_ICON,
    }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      onChangeRef.current([
        Number(pos.lng.toFixed(6)),
        Number(pos.lat.toFixed(6)),
      ]);
    });

    map.on('click', (event: L.LeafletMouseEvent) => {
      const next: [number, number] = [
        Number(event.latlng.lng.toFixed(6)),
        Number(event.latlng.lat.toFixed(6)),
      ];
      marker.setLatLng([next[1], next[0]]);
      onChangeRef.current(next);
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Intentionally initialize once and sync coordinates below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([lat, lng]);
    mapRef.current.panTo([lat, lng]);
  }, [lng, lat]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>{label}</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-800">
          GeoJSON [lng, lat]: [{lng.toFixed(4)}, {lat.toFixed(4)}]
        </span>
      </div>
      <div
        ref={containerRef}
        className={`w-full overflow-hidden rounded-lg border border-slate-300 z-0 ${heightClassName}`}
      />
    </div>
  );
}
