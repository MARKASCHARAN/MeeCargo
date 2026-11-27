export type UserRole = 'SHIPPER' | 'DRIVER';

export type BusinessType =
  | 'MANUFACTURER'
  | 'WHOLESALER'
  | 'TEXTILE_MILL'
  | 'AGRO_PROCESSOR'
  | 'RETAILER'
  | 'OTHER';

export type FleetTier = 'TIER_1' | 'TIER_2' | 'TIER_3';
export type DriverAvailability = 'AVAILABLE' | 'ON_TRIP' | 'OFFLINE';

export type CargoCategory =
  | 'STANDARD_BOX'
  | 'SACK_BAG'
  | 'TEXTILE_ROLL'
  | 'PALLET_BUNDLE'
  | 'CUSTOM';

export type DimensionUnit = 'CM' | 'IN' | 'M';
export type WeightUnit = 'KG' | 'G';
export type PaymentChoice = 'TOKEN_PLUS_PICKUP_BALANCE' | 'FULL_PREPAID';

export type ShipmentStatus =
  | 'DRAFT'
  | 'PENDING_TOKEN'
  | 'CONFIRMED'
  | 'POOLED'
  | 'LOCKED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'AT_DESTINATION'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ROLLED_OVER';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  businessId?: string;
  businessName?: string;
}

export interface StructuredAddress {
  addressLine: string;
  villageOrTown: string;
  district: string;
  state: string;
  pincode: string;
  landmark?: string;
  location: GeoPoint;
}

export interface ServiceLocation {
  label: string;
  villageOrTown: string;
  district: string;
  state: string;
  pincode?: string;
}

export interface BusinessProfile {
  _id: string;
  businessName: string;
  businessType: BusinessType;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  gstin?: string;
  pickupAddress: StructuredAddress;
  serviceLocations: ServiceLocation[];
  ownerId: string;
  memberUserIds: string[];
  isActive: boolean;
}

export interface CorridorStop {
  stopCode: string;
  name: string;
  district: string;
  state: string;
  sequenceOrder: number;
  location: GeoPoint;
}

export interface Slot {
  _id: string;
  corridorId: string;
  slotCode: string;
  label: string;
  departureDate: string;
  cutoffAt: string;
  plannedDepartureAt: string;
  estimatedArrivalStartAt: string;
  estimatedArrivalEndAt: string;
  capacityWeightKg: number;
  capacityVolumeCbm: number;
  reservedWeightKg: number;
  reservedVolumeCbm: number;
  availableWeightKg: number;
  availableVolumeCbm: number;
  isPastCutoff: boolean;
  status: 'OPEN' | 'LOCKING' | 'LOCKED' | 'COMPLETED' | 'CANCELLED';
}

export interface Corridor {
  _id: string;
  code: string;
  name: string;
  description?: string;
  stops: CorridorStop[];
  operatingDays: string[];
  isEstablishedRoute: boolean;
  guaranteedCeilingPaisePerKg: number;
  baseRatePaisePerKg: number;
  viabilityThresholdPct: number;
  isDemoData: boolean;
  slots: Slot[];
}

export interface CargoPreset {
  category: CargoCategory;
  label: string;
  description: string;
  defaultDimensionsCm: { length: number; width: number; height: number };
  defaultUnitWeightKg: number;
  defaultStackable: boolean;
}

export interface CargoCalculationResult {
  category: CargoCategory;
  quantity: number;
  unitDimensionsCm: { length: number; width: number; height: number };
  unitActualWeightKg: number;
  totalActualWeightKg: number;
  volumetricDivisor: number;
  perUnitVolumetricWeightKg: number;
  totalVolumetricWeightKg: number;
  chargeableWeightKg: number;
  billingBasis: 'ACTUAL' | 'VOLUMETRIC';
  perUnitVolumeCbm: number;
  totalVolumeCbm: number;
}

export interface GeocodeResult {
  coordinates: [number, number];
  formattedLabel: string;
  provider: 'FIXTURE' | 'NOMINATIM';
  isApproximate: boolean;
}

export interface Shipment {
  _id: string;
  reference: string;
  businessId: string;
  corridorId: string | { _id: string; code: string; name: string; stops?: CorridorStop[] };
  slotId:
    | string
    | {
        _id: string;
        slotCode: string;
        label: string;
        plannedDepartureAt: string;
        cutoffAt: string;
      };
  pickupStopCode: string;
  pickupStopOrder: number;
  deliveryStopCode: string;
  deliveryStopOrder: number;
  pickupAddress: StructuredAddress;
  deliveryAddress: StructuredAddress;
  recipientName: string;
  recipientPhone: string;
  cargo: {
    category: CargoCategory;
    quantity: number;
    unitDimensionsCm: { length: number; width: number; height: number };
    unitActualWeightKg: number;
    totalActualWeightKg: number;
    volumetricDivisor: number;
    volumetricWeightKg: number;
    chargeableWeightKg: number;
    billingBasis: 'ACTUAL' | 'VOLUMETRIC';
    volumeCbm: number;
    stackable: boolean;
    handlingRestrictions: string[];
    declaredContents: string;
    handlingNotes?: string;
    irregularCargoNotes?: string;
  };
  paymentChoice: PaymentChoice;
  tokenStatus: string;
  pricingSnapshot?: {
    pricingVersion: string;
    ceilingPricePaise: number;
    projectedPricePaise: number;
    finalLockedPricePaise?: number;
    tokenAmountPaise: number;
    tokenPaidPaise: number;
    remainingBalancePaise?: number;
    isAnchorEligible: boolean;
    poolDiscountPaise: number;
    anchorDiscountPaise: number;
    handlingFeePaise: number;
    subsidyPaise: number;
    marginFlagged: boolean;
  };
  viabilityDecision?:
    | 'NONE'
    | 'PENDING_CHOICE'
    | 'ROLLOVER_CONSENTED'
    | 'REFUND_REQUESTED';
  status: ShipmentStatus;
  externalOrderRef?: string;
  trackingToken: string;
  qrToken: string;
  statusHistory: Array<{
    status: ShipmentStatus;
    at: string;
    note?: string;
  }>;
  createdAt: string;
}

export interface PriceCalculationBreakdown {
  pricingVersion: string;
  chargeableWeightKg: number;
  effectiveUtilizationPct: number;
  appliedTierLabel: string;
  appliedDiscountBps: number;
  baseFreightPaise: number;
  ceilingPricePaise: number;
  poolDiscountPaise: number;
  anchorDiscountPaise: number;
  handlingFeePaise: number;
  computedPricePaise: number;
  minAllowedPricePaise: number;
  subsidyPaise: number;
  marginFlagged: boolean;
  tokenAmountPaise: number;
  remainingBalancePaise: number;
  effectiveRatePaisePerKg: number;
}

export interface PoolLiveMetrics {
  poolId: string;
  poolCode: string;
  corridorId: string;
  slotId: string;
  status: string;
  weightUtilizationPct: number;
  volumeUtilizationPct: number;
  reservedWeightKg: number;
  capacityWeightKg: number;
  reservedVolumeCbm: number;
  capacityVolumeCbm: number;
  shipmentCount: number;
  projectedRatePaisePerKg: number;
  appliedTierLabel: string;
  isEstimateFinal: boolean;
  viabilityStatus: string;
  updatedAt: string;
}

export interface PoolSummary {
  _id: string;
  poolCode: string;
  status:
    | 'OPEN'
    | 'LOCKING'
    | 'LOCKED'
    | 'AWAITING_VIABILITY_DECISION'
    | 'CANCELLED'
    | 'ROLLED_OVER';
  viabilityStatus: 'PENDING' | 'PASSED' | 'FAILED';
  viabilityReason?: string;
  corridorId?: {
    _id: string;
    code: string;
    name: string;
    isEstablishedRoute: boolean;
  };
  slotId?: {
    _id: string;
    slotCode: string;
    label: string;
    cutoffAt: string;
    plannedDepartureAt: string;
  };
  liveMetrics: PoolLiveMetrics | null;
  trip?: {
    _id: string;
    tripCode: string;
    status: string;
    vehicleId?: {
      registrationNumber: string;
      vehicleClass: string;
      tier: FleetTier;
    };
  } | null;
}

export interface PaymentRecord {
  _id: string;
  shipmentId: string;
  type: 'TOKEN' | 'PICKUP_BALANCE' | 'REFUND';
  amountPaise: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED';
  mode: 'SIMULATED' | 'TEST_GATEWAY';
  isSimulated: boolean;
  providerRef: string;
  refundReference?: string;
  refundReason?: string;
  processedAt?: string;
}

export interface CsvImportReport {
  summary: {
    totalRows: number;
    createdCount: number;
    rejectedCount: number;
    duplicateCount: number;
  };
  created: Array<{
    rowNumber: number;
    externalOrderRef: string;
    reference: string;
    chargeableWeightKg: number;
    status: string;
  }>;
  rejected: Array<{
    rowNumber: number;
    externalOrderRef?: string;
    errors: string[];
  }>;
  duplicates: Array<{
    rowNumber: number;
    externalOrderRef: string;
    reason: string;
  }>;
}

export interface VehicleSummary {
  _id: string;
  registrationNumber: string;
  operatorName?: string;
  tier: FleetTier;
  vehicleClass: string;
  maxWeightKg: number;
  maxVolumeCbm: number;
  bedDimensionsCm: {
    length: number;
    width: number;
    height: number;
  };
}

export interface DriverProfile {
  _id: string;
  userId: string;
  name: string;
  phone: string;
  availabilityStatus: DriverAvailability;
  fleetTier: FleetTier;
  vehicleId?: VehicleSummary | null;
  licenseNumber?: string;
  homeBase?: string;
}

export interface TripSummary {
  _id: string;
  tripCode: string;
  status: string;
  plannedDepartureAt: string;
  estimatedEndAt?: string;
  notes?: string;
  corridorId?: {
    _id: string;
    code: string;
    name: string;
  };
  slotId?: {
    _id: string;
    slotCode: string;
    label: string;
    plannedDepartureAt: string;
    estimatedArrivalStartAt: string;
    estimatedArrivalEndAt: string;
  };
  vehicleId?: VehicleSummary;
  allocationEconomics?: {
    allocatedTier: FleetTier;
    tier1MinGuaranteeIncludedPaise: number;
    selectedVehicleMinGuaranteePaise: number;
    estimatedDistanceKm: number;
    estimatedVehiclePayoutPaise: number;
    rightSized: boolean;
    reason: string;
  };
  stopsSummary: Array<{
    stopCode: string;
    name: string;
    sequenceOrder: number;
  }>;
}

export interface DriverNotification {
  _id: string;
  eventType: string;
  title: string;
  message: string;
  readAt?: string;
  createdAt: string;
}

export interface AuthResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface MeResponse {
  success: boolean;
  user: AuthUser;
  businessProfile: BusinessProfile | null;
  driverProfile: DriverProfile | null;
}

export interface HealthResponse {
  success: boolean;
  service: string;
  environment: string;
  uptimeSeconds: number;
  db: {
    connected: boolean;
    readyState: string;
    replicaSetSupported: boolean;
  };
  modes: {
    payment: 'SIMULATED' | 'TEST_GATEWAY';
    routing: 'FIXTURE' | 'OSRM';
    notifications: 'CONSOLE' | 'WEBHOOK';
  };
  timestamp: string;
}
