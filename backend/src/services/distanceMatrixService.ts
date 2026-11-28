import { env } from '../config/env.js';
import { RouteMatrixCache } from '../models/RouteMatrixCache.js';
import { HttpError } from '../utils/errors.js';

export interface MatrixPoint {
  code: string;
  coordinates: [number, number]; // [longitude, latitude]
}

export interface RoadDistanceMatrix {
  provider: 'FIXTURE' | 'OSRM';
  fromCache: boolean;
  stopCodes: string[];
  distanceMatrixMeters: number[][];
  durationMatrixSeconds: number[][];
}

// Deterministic NH-48 / NE-1 Gujarat road distances (meters) and travel times (seconds)
// Never uses straight-line Haversine distance.
const FIXTURE_ROAD_LEGS: Record<string, { meters: number; seconds: number }> = {
  'VAD->VAD': { meters: 0, seconds: 0 },
  'VAD->ANA': { meters: 42800, seconds: 3120 },
  'VAD->NAD': { meters: 61400, seconds: 4380 },
  'VAD->AMD': { meters: 114600, seconds: 7380 },

  'ANA->VAD': { meters: 42800, seconds: 3120 },
  'ANA->ANA': { meters: 0, seconds: 0 },
  'ANA->NAD': { meters: 20500, seconds: 1620 },
  'ANA->AMD': { meters: 74200, seconds: 4920 },

  'NAD->VAD': { meters: 61400, seconds: 4380 },
  'NAD->ANA': { meters: 20500, seconds: 1620 },
  'NAD->NAD': { meters: 0, seconds: 0 },
  'NAD->AMD': { meters: 55800, seconds: 3780 },

  'AMD->VAD': { meters: 114600, seconds: 7380 },
  'AMD->ANA': { meters: 74200, seconds: 4920 },
  'AMD->NAD': { meters: 55800, seconds: 3780 },
  'AMD->AMD': { meters: 0, seconds: 0 },
};

function computeHaversineMeters(
  fromCoords: [number, number],
  toCoords: [number, number]
): number {
  const [lon1, lat1] = fromCoords;
  const [lon2, lat2] = toCoords;
  if (lon1 === lon2 && lat1 === lat2) return 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getCoordinateRoadEstimate(
  fromCoords: [number, number],
  toCoords: [number, number]
): { meters: number; seconds: number } {
  const straightMeters = computeHaversineMeters(fromCoords, toCoords);
  if (straightMeters <= 5) {
    return { meters: 0, seconds: 0 };
  }
  // Standard Indian highway road circuity factor (1.28x) and avg 48 km/h commercial freight speed
  const roadMeters = Math.max(500, Math.round(straightMeters * 1.28));
  const roadSeconds = Math.max(120, Math.round((roadMeters / 1000 / 48) * 3600));
  return { meters: roadMeters, seconds: roadSeconds };
}

export function getFixtureRoadLeg(
  fromCode: string,
  toCode: string
): { meters: number; seconds: number } {
  const key = `${fromCode.toUpperCase()}->${toCode.toUpperCase()}`;
  const leg = FIXTURE_ROAD_LEGS[key];
  if (!leg) {
    throw new HttpError(
      422,
      `Road matrix fixture missing for leg ${key}. Configure OSRM or supply road distance data.`,
      'ROUTE_MATRIX_MISSING'
    );
  }
  return leg;
}

export async function getRoadDistanceMatrix(
  points: MatrixPoint[],
  options?: { useCache?: boolean; allowCoordinateEstimate?: boolean }
): Promise<RoadDistanceMatrix> {
  if (points.length < 2) {
    throw new HttpError(400, 'At least 2 points are required for a road matrix', 'VALIDATION_ERROR');
  }
  if (points.length > 25) {
    throw new HttpError(
      400,
      'Matrix request exceeds provider limit of 25 waypoints',
      'MATRIX_LIMIT_EXCEEDED'
    );
  }

  const provider = env.ROUTING_PROVIDER;
  const stopCodes = points.map((p) => p.code.toUpperCase());
  const cacheKey = `${provider}:${points
    .map((p) => `${p.code.toUpperCase()}@${p.coordinates[0].toFixed(4)},${p.coordinates[1].toFixed(4)}`)
    .join('|')}`;

  if (options?.useCache !== false) {
    try {
      const cached = await RouteMatrixCache.findOne({
        cacheKey,
        expiresAt: { $gt: new Date() },
      }).lean();
      if (cached) {
        return {
          provider: cached.provider,
          fromCache: true,
          stopCodes: cached.stopCodes,
          distanceMatrixMeters: cached.distanceMatrixMeters,
          durationMatrixSeconds: cached.durationMatrixSeconds,
        };
      }
    } catch {
      // Cache read is best-effort
    }
  }

  let distanceMatrixMeters: number[][] = [];
  let durationMatrixSeconds: number[][] = [];

  if (provider === 'FIXTURE') {
    distanceMatrixMeters = points.map((from) =>
      points.map((to) => {
        try {
          return getFixtureRoadLeg(from.code, to.code).meters;
        } catch (err) {
          if (options?.allowCoordinateEstimate) {
            return getCoordinateRoadEstimate(from.coordinates, to.coordinates).meters;
          }
          throw err;
        }
      })
    );
    durationMatrixSeconds = points.map((from) =>
      points.map((to) => {
        try {
          return getFixtureRoadLeg(from.code, to.code).seconds;
        } catch (err) {
          if (options?.allowCoordinateEstimate) {
            return getCoordinateRoadEstimate(from.coordinates, to.coordinates).seconds;
          }
          throw err;
        }
      })
    );
  } else {
    const coordsParam = points
      .map((p) => `${p.coordinates[0]},${p.coordinates[1]}`)
      .join(';');
    const url = `${env.OSRM_BASE_URL}/table/v1/driving/${coordsParam}?annotations=distance,duration`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new HttpError(
          502,
          `OSRM routing provider returned HTTP ${response.status}`,
          'ROUTING_PROVIDER_ERROR'
        );
      }
      const data = (await response.json()) as {
        code?: string;
        distances?: Array<Array<number | null>>;
        durations?: Array<Array<number | null>>;
      };

      if (data.code !== 'Ok' || !data.distances || !data.durations) {
        throw new HttpError(
          502,
          `OSRM failed to compute matrix (${data.code ?? 'unknown error'})`,
          'ROUTING_PROVIDER_ERROR'
        );
      }

      for (let i = 0; i < data.distances.length; i++) {
        for (let j = 0; j < data.distances[i].length; j++) {
          if (data.distances[i][j] === null || data.durations[i][j] === null) {
            throw new HttpError(
              422,
              `Road route unavailable between ${stopCodes[i]} and ${stopCodes[j]}`,
              'ROUTE_DATA_UNAVAILABLE'
            );
          }
        }
      }

      distanceMatrixMeters = data.distances.map((row) =>
        row.map((val) => Math.round(val ?? 0))
      );
      durationMatrixSeconds = data.durations.map((row) =>
        row.map((val) => Math.round(val ?? 0))
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        504,
        'Road routing provider timed out or was unreachable',
        'ROUTING_PROVIDER_TIMEOUT'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  if (options?.useCache !== false) {
    try {
      await RouteMatrixCache.findOneAndUpdate(
        { cacheKey },
        {
          $set: {
            cacheKey,
            provider,
            stopCodes,
            distanceMatrixMeters,
            durationMatrixSeconds,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        },
        { upsert: true }
      );
    } catch {
      // Best-effort cache write
    }
  }

  return {
    provider,
    fromCache: false,
    stopCodes,
    distanceMatrixMeters,
    durationMatrixSeconds,
  };
}
