import { useAuthStore } from '../stores/authStore';
import type {
  AuthResponse,
  BusinessProfile,
  CargoCalculationResult,
  CargoCategory,
  CargoPreset,
  Corridor,
  CsvImportReport,
  DimensionUnit,
  DriverAvailability,
  DriverNotification,
  DriverProfile,
  GeocodeResult,
  HealthResponse,
  MeResponse,
  PaymentChoice,
  PaymentRecord,
  PoolSummary,
  PriceCalculationBreakdown,
  Shipment,
  StructuredAddress,
  TripSummary,
  UserRole,
  WeightUnit,
} from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = useAuthStore.getState().refreshToken;
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
      if (!response.ok) {
        useAuthStore.getState().logout();
        return null;
      }
      const data = (await response.json()) as AuthResponse;
      useAuthStore.getState().setSession({
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      return data.accessToken;
    } catch {
      useAuthStore.getState().logout();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  allowRetry = true
): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (
    response.status === 401 &&
    allowRetry &&
    !path.startsWith('/api/v1/auth/login') &&
    !path.startsWith('/api/v1/auth/register') &&
    !path.startsWith('/api/v1/auth/refresh')
  ) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, init, false);
    }
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error ?? `Request failed with status ${response.status}`,
      data?.code
    );
  }
  return data as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/api/v1/health');
}

export function registerUser(payload: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: UserRole;
}): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function loginUser(payload: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return apiFetch<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function logoutUser(): Promise<void> {
  const refreshToken = useAuthStore.getState().refreshToken;
  try {
    await apiFetch('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
  } finally {
    useAuthStore.getState().logout();
  }
}

export function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/api/v1/auth/me');
}

export function fetchBusinessProfile(): Promise<{
  success: boolean;
  businessProfile: BusinessProfile | null;
}> {
  return apiFetch('/api/v1/shipper/business');
}

export function createBusinessProfile(
  payload: Omit<BusinessProfile, '_id' | 'ownerId' | 'memberUserIds' | 'isActive'>
): Promise<{ success: boolean; businessProfile: BusinessProfile }> {
  return apiFetch('/api/v1/shipper/business', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateBusinessProfile(
  payload: Partial<
    Omit<BusinessProfile, '_id' | 'ownerId' | 'memberUserIds' | 'isActive'>
  >
): Promise<{ success: boolean; businessProfile: BusinessProfile }> {
  return apiFetch('/api/v1/shipper/business', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function fetchCorridors(): Promise<{
  success: boolean;
  corridors: Corridor[];
}> {
  return apiFetch('/api/v1/corridors');
}

export function geocodeAddress(payload: {
  addressLine?: string;
  villageOrTown: string;
  district: string;
  state?: string;
  pincode?: string;
}): Promise<{ success: boolean } & GeocodeResult> {
  return apiFetch('/api/v1/corridors/geocode', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchCargoPresets(): Promise<{
  success: boolean;
  presets: CargoPreset[];
}> {
  return apiFetch('/api/v1/shipments/cargo-presets');
}

export function calculateChargeableWeight(payload: {
  category: CargoCategory;
  quantity: number;
  length: number;
  width: number;
  height: number;
  dimensionUnit: DimensionUnit;
  unitActualWeight: number;
  weightUnit: WeightUnit;
}): Promise<{ success: boolean; metrics: CargoCalculationResult }> {
  return apiFetch('/api/v1/shipments/calculate-chargeable-weight', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchShipments(): Promise<{
  success: boolean;
  shipments: Shipment[];
}> {
  return apiFetch('/api/v1/shipments');
}

export function createShipment(payload: {
  corridorId: string;
  slotId: string;
  pickupStopCode: string;
  deliveryStopCode: string;
  pickupAddress?: StructuredAddress;
  deliveryAddress: StructuredAddress;
  recipientName: string;
  recipientPhone: string;
  cargo: {
    category: CargoCategory;
    quantity: number;
    length: number;
    width: number;
    height: number;
    dimensionUnit: DimensionUnit;
    unitActualWeight: number;
    weightUnit: WeightUnit;
    stackable: boolean;
    handlingRestrictions: string[];
    declaredContents: string;
    handlingNotes?: string;
    irregularCargoNotes?: string;
  };
  paymentChoice: PaymentChoice;
  idempotencyKey?: string;
}): Promise<{ success: boolean; deduplicated: boolean; shipment: Shipment }> {
  return apiFetch('/api/v1/shipments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function confirmShipmentToken(shipmentId: string): Promise<{
  success: boolean;
  alreadyConfirmed: boolean;
  shipment: Shipment;
}> {
  return apiFetch(`/api/v1/shipments/${shipmentId}/confirm-token`, {
    method: 'POST',
  });
}

export function fetchQuotePreview(payload: {
  corridorId: string;
  slotId: string;
  chargeableWeightKg: number;
  isAnchorEligible?: boolean;
}): Promise<{
  success: boolean;
  isEstimateFinal: boolean;
  breakdown: PriceCalculationBreakdown;
}> {
  return apiFetch('/api/v1/shipments/quote-preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function payShipmentToken(
  shipmentId: string,
  payload: { idempotencyKey?: string; simulateOutcome?: 'SUCCESS' | 'FAILED' }
): Promise<{
  success: boolean;
  deduplicated: boolean;
  payment: PaymentRecord;
  shipment: Shipment;
}> {
  return apiFetch(`/api/v1/shipments/${shipmentId}/pay-token`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function cancelShipment(
  shipmentId: string,
  reason: string
): Promise<{
  success: boolean;
  shipment: Shipment;
  refund: PaymentRecord | null;
}> {
  return apiFetch(`/api/v1/shipments/${shipmentId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function submitViabilityDecision(
  shipmentId: string,
  payload: { decision: 'ROLLOVER' | 'REFUND'; targetSlotId?: string }
): Promise<{
  success: boolean;
  decision: 'ROLLOVER' | 'REFUND';
  shipment: Shipment;
}> {
  return apiFetch(`/api/v1/shipments/${shipmentId}/viability-decision`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchPools(): Promise<{
  success: boolean;
  pricingVersion: string;
  pools: PoolSummary[];
}> {
  return apiFetch('/api/v1/pools');
}

export function triggerPoolCutoff(poolId: string): Promise<{
  success: boolean;
  idempotentHit: boolean;
  viabilityPassed: boolean;
  pool: PoolSummary;
}> {
  return apiFetch(`/api/v1/pools/${poolId}/cutoff`, {
    method: 'POST',
    body: JSON.stringify({ enforceCutoffClock: false }),
  });
}

export async function downloadCsvTemplate(): Promise<string> {
  const token = useAuthStore.getState().accessToken;
  const response = await fetch(`${API_BASE_URL}/api/v1/shipments/import/template`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to download CSV template');
  }
  return response.text();
}

export function importShipmentsCsv(payload: {
  csvText: string;
  dryRun?: boolean;
}): Promise<{ success: boolean } & CsvImportReport> {
  return apiFetch('/api/v1/shipments/import/csv', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchDriverProfile(): Promise<{
  success: boolean;
  driverProfile: DriverProfile | null;
}> {
  return apiFetch('/api/v1/driver/profile');
}

export function upsertDriverProfile(payload: {
  name: string;
  phone: string;
  availabilityStatus: DriverAvailability;
  fleetTier: 'TIER_1' | 'TIER_2' | 'TIER_3';
  licenseNumber?: string;
  homeBase?: string;
}): Promise<{ success: boolean; driverProfile: DriverProfile }> {
  return apiFetch('/api/v1/driver/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateDriverAvailability(
  availabilityStatus: DriverAvailability
): Promise<{ success: boolean; driverProfile: DriverProfile }> {
  return apiFetch('/api/v1/driver/availability', {
    method: 'PATCH',
    body: JSON.stringify({ availabilityStatus }),
  });
}

export function fetchDriverTrips(): Promise<{
  success: boolean;
  trips: TripSummary[];
}> {
  return apiFetch('/api/v1/driver/trips');
}

export function respondToDriverTrip(
  tripId: string,
  payload: { decision: 'ACCEPT' | 'REJECT'; reason?: string }
): Promise<{
  success: boolean;
  reassigned: boolean;
  message: string;
  trip: TripSummary;
}> {
  return apiFetch(`/api/v1/driver/trips/${tripId}/respond`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchDriverNotifications(): Promise<{
  success: boolean;
  notifications: DriverNotification[];
}> {
  return apiFetch('/api/v1/driver/notifications');
}

export function markDriverNotificationRead(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/driver/notifications/${id}/read`, {
    method: 'PATCH',
  });
}
