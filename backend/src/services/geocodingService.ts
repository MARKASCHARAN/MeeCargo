import { env } from '../config/env.js';
import { HttpError } from '../utils/errors.js';

export interface GeocodeRequest {
  addressLine?: string;
  villageOrTown: string;
  district: string;
  state?: string;
  pincode?: string;
}

export interface GeocodeResult {
  coordinates: [number, number]; // [longitude, latitude]
  formattedLabel: string;
  provider: 'FIXTURE' | 'NOMINATIM';
  isApproximate: boolean;
}

interface FixturePlace {
  keywords: string[];
  pincodes?: string[];
  coordinates: [number, number]; // [lng, lat]
  label: string;
}

const GUJARAT_FIXTURE_PLACES: FixturePlace[] = [
  {
    keywords: ['makarpura', 'gidc vadodara', 'vadodara'],
    pincodes: ['390010', '390001', '390011', '390012'],
    coordinates: [73.184, 22.256],
    label: 'Makarpura / Vadodara Industrial Area, Gujarat',
  },
  {
    keywords: ['karjan'],
    pincodes: ['391240'],
    coordinates: [73.1225, 22.0543],
    label: 'Karjan, Vadodara District, Gujarat',
  },
  {
    keywords: ['padra'],
    pincodes: ['391440'],
    coordinates: [73.0844, 22.2408],
    label: 'Padra, Vadodara District, Gujarat',
  },
  {
    keywords: ['anand', 'vallabh vidyanagar', 'gidc anand'],
    pincodes: ['388001', '388120', '388121'],
    coordinates: [72.9289, 22.5645],
    label: 'Anand GIDC / Town, Gujarat',
  },
  {
    keywords: ['borsad'],
    pincodes: ['388540'],
    coordinates: [72.8981, 22.4086],
    label: 'Borsad, Anand District, Gujarat',
  },
  {
    keywords: ['nadiad', 'kheda', 'chaklasi'],
    pincodes: ['387001', '387002', '387315'],
    coordinates: [72.8634, 22.6916],
    label: 'Nadiad, Kheda District, Gujarat',
  },
  {
    keywords: ['narol', 'vatva', 'sarkhej', 'ahmedabad'],
    pincodes: ['380001', '380002', '382405', '382440', '382210'],
    coordinates: [72.5714, 23.0225],
    label: 'Narol / Ahmedabad Freight Hub, Gujarat',
  },
  {
    keywords: ['sanand'],
    pincodes: ['382110'],
    coordinates: [72.3819, 22.9916],
    label: 'Sanand Industrial Belt, Ahmedabad, Gujarat',
  },
  {
    keywords: ['bavla'],
    pincodes: ['382220'],
    coordinates: [72.3627, 22.8347],
    label: 'Bavla, Ahmedabad District, Gujarat',
  },
];

function lookupFixture(req: GeocodeRequest): GeocodeResult {
  const haystack = `${req.addressLine ?? ''} ${req.villageOrTown} ${req.district}`.toLowerCase();
  const pincode = req.pincode?.trim();

  if (pincode) {
    const byPin = GUJARAT_FIXTURE_PLACES.find((p) => p.pincodes?.includes(pincode));
    if (byPin) {
      return {
        coordinates: byPin.coordinates,
        formattedLabel: `${byPin.label} (Fixture match by PIN ${pincode})`,
        provider: 'FIXTURE',
        isApproximate: true,
      };
    }
  }

  const byKeyword = GUJARAT_FIXTURE_PLACES.find((p) =>
    p.keywords.some((kw) => haystack.includes(kw))
  );
  if (byKeyword) {
    return {
      coordinates: byKeyword.coordinates,
      formattedLabel: `${byKeyword.label} (Fixture match)`,
      provider: 'FIXTURE',
      isApproximate: true,
    };
  }

  throw new HttpError(
    422,
    'Could not automatically geocode this rural/semi-urban address in fixture mode. Please place or adjust the map pin manually.',
    'GEOCODE_NOT_FOUND'
  );
}

export async function geocodeAddress(req: GeocodeRequest): Promise<GeocodeResult> {
  if (env.GEOCODING_PROVIDER === 'FIXTURE') {
    return lookupFixture(req);
  }

  const query = [
    req.addressLine,
    req.villageOrTown,
    req.district,
    req.state ?? 'Gujarat',
    req.pincode,
    'India',
  ]
    .filter(Boolean)
    .join(', ');

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    query
  )}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MeeCargo-Prototype/1.0 (logistics-dev)',
      },
    });
    if (!response.ok) {
      throw new HttpError(502, 'Geocoding provider returned an error', 'GEOCODER_ERROR');
    }
    const items = (await response.json()) as Array<{
      lon: string;
      lat: string;
      display_name: string;
    }>;
    if (!items.length) {
      throw new HttpError(
        422,
        'Address not found by geocoding provider. Please set the map pin manually.',
        'GEOCODE_NOT_FOUND'
      );
    }
    const lng = Number(items[0].lon);
    const lat = Number(items[0].lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new HttpError(502, 'Geocoder returned invalid coordinates', 'GEOCODER_ERROR');
    }
    return {
      coordinates: [lng, lat],
      formattedLabel: items[0].display_name,
      provider: 'NOMINATIM',
      isApproximate: true,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      504,
      'Geocoding request timed out. Please drop the map pin manually.',
      'GEOCODER_TIMEOUT'
    );
  } finally {
    clearTimeout(timer);
  }
}
