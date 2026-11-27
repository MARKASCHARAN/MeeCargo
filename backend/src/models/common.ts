import { Schema } from 'mongoose';

export interface GeoPoint {
  type: 'Point';
  /**
   * GeoJSON coordinate order is strictly [longitude, latitude].
   */
  coordinates: [number, number];
}

export function isValidLngLat(coords: unknown): coords is [number, number] {
  if (!Array.isArray(coords) || coords.length !== 2) return false;
  const [lng, lat] = coords;
  return (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

export const geoPointSchema = new Schema<GeoPoint>(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: isValidLngLat,
        message: 'GeoJSON coordinates must be [longitude, latitude] within valid bounds.',
      },
    },
  },
  { _id: false }
);
