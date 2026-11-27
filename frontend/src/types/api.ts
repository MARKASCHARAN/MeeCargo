export type UserRole = 'SHIPPER' | 'DRIVER' | 'PLATFORM_OWNER';

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
  isFull?: boolean;
  status: 'OPEN' | 'LOCKING' | 'LOCKED' | 'COMPLETED' | 'CANCELLED';
}

export interface CorridorServiceDateSummary {
  serviceDate: string;
  departureDate: string;
  status: 'OPEN' | 'LOCKED' | 'FULL' | 'CLOSED';
  bookable: boolean;
  pooledShipmentCount: number;
  capacityWeightKg: number;
  capacityVolumeCbm: number;
  reservedWeightKg: number;
  reservedVolumeCbm: number;
  availableWeightKg: number;
  availableVolumeCbm: number;
  maxSinglePoolAvailableWeightKg: number;
  maxSinglePoolAvailableVolumeCbm: number;
  weightUtilizationPct: number;
  volumeUtilizationPct: number;
  projectedRatePaisePerKg: number;
  cutoffAt: string;
}

export interface Corridor {
  _id: string;
  code: string;
  name: string;
  description?: string;
  stops: CorridorStop[];
  operatingDays: string[];
  isEstablishedRoute?: boolean;
  guaranteedCeilingPaisePerKg: number;
  baseRatePaisePerKg: number;
  viabilityThresholdPct?: number;
  isDemoData?: boolean;
  serviceDates?: CorridorServiceDateSummary[];
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
        departureDate?: string;
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
  podSummary?: {
    confirmationMode: string;
    verifiedAt: string;
    b2bSignOffName?: string;
    photoUrl: string | null;
  } | null;
  pickupCollectionSummary?: {
    collectionState: string;
    settlementState: string;
    collectedAmountPaise: number;
    paymentMethod: string;
    providerRef: string;
    isSimulated: boolean;
  } | null;
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
  appliedTierLabel?: string;
  isEstimateFinal: boolean;
  viabilityStatus: string;
  updatedAt: string;
}

export interface PoolSummary {
  _id: string;
  poolCode?: string;
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
    isEstablishedRoute?: boolean;
    guaranteedCeilingPaisePerKg?: number;
  };
  slotId?: {
    _id: string;
    slotNumber?: 1 | 2;
    slotCode?: string;
    label: string;
    departureDate?: string;
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
    turnaroundBufferMin?: number;
    estimatedOutboundDurationMin?: number;
    stops?: CorridorStopSummary[];
  };
  slotId?: {
    _id: string;
    slotNumber?: 1 | 2;
    slotCode: string;
    label: string;
    departureDate?: string;
    plannedDepartureAt: string;
    estimatedArrivalStartAt: string;
    estimatedArrivalEndAt: string;
    returnTimeOptions?: string[];
    returnTimeLocked?: boolean;
    lockedReturnTime?: string;
  };
  sourceCommitmentId?:
    | {
        _id: string;
        slotNumber: 1 | 2;
        selectedPickupTime: string;
        selectedReturnTime: string;
        status: DriverSlotCommitmentStatus;
        departureDate: string;
      }
    | string;
  quarantined?: boolean;
  quarantineReason?: string;
  scheduleSnapshot?: {
    serviceDate: string;
    slotNumber?: 1 | 2;
    slotCode: string;
    slotLabel: string;
    outboundPickupTime: string;
    selectedReturnTime: string;
    returnTimeLocked: boolean;
  };
  vehicleSnapshot?: {
    registrationNumber: string;
    vehicleClass: string;
    bodyType?: string;
    maxWeightKg: number;
    maxVolumeCbm: number;
    bedDimensionsCm?: {
      length: number;
      width: number;
      height: number;
    };
    ownershipType?: string;
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
  routePlan?: {
    routeVersion?: number;
    optimizationStatus: 'PENDING' | 'OPTIMAL' | 'INFEASIBLE' | 'OPTIMIZER_UNAVAILABLE';
    provider: 'OR_TOOLS' | 'NONE';
    matrixProvider: 'FIXTURE' | 'OSRM';
    totalDistanceMeters: number;
    estimatedDurationSeconds: number;
    orderedStops: Array<{
      sequence: number;
      stopCode: string;
      name: string;
      arrivalMin: number;
      cumulativeDistanceMeters: number;
      shipmentIds: string[];
    }>;
    failureReason?: string;
    optimizedAt?: string;
    routeHistory?: Array<{
      version: number;
      optimizationStatus: string;
      totalDistanceMeters: number;
      estimatedDurationSeconds: number;
      reason?: string;
      supersededAt: string;
    }>;
  };
  loadingPlan?: {
    zoneMapping: Array<{
      stopCode: string;
      dropSequence: number;
      zoneColor: 'GREEN' | 'YELLOW' | 'RED' | 'BLUE';
      zoneLabel: string;
    }>;
    sequenceItems: Array<{
      loadOrder: number;
      shipmentId: string;
      reference: string;
      stopCode: string;
      dropSequence: number;
      zoneColor: 'GREEN' | 'YELLOW' | 'RED' | 'BLUE';
      zoneLabel: string;
      quantity: number;
      dimensionsCm: { length: number; width: number; height: number };
      weightKg: number;
      stackable: boolean;
      handlingNotes?: string;
      placed: boolean;
      bedRect?: {
        xCm: number;
        yCm: number;
        lengthCm: number;
        widthCm: number;
      };
    }>;
    overflowShipmentIds: string[];
    manualOverrides: Array<{
      shipmentId: string;
      note: string;
      at: string;
    }>;
    planningAidDisclaimer: string;
    planStatus?: 'READY' | 'UNAVAILABLE_MISSING_DIMENSIONS' | 'OVER_CAPACITY';
    missingDimensions?: string[];
    capacityIssues?: string[];
  };
  backhaulDecision?: {
    decision: 'MATCHED' | 'EARLY_TURNAROUND' | 'PENDING';
    requestCode?: string;
    repositioningDistanceKm: number;
    repositioningCostPaise: number;
    expectedReturnRevenuePaise: number;
    netContributionPaise: number;
    tier1MinGuaranteeIncludedPaise: number;
    scheduledReturnTime?: string;
    returnStops?: Array<{ stopCode: string; name: string; action: string }>;
    returnShipmentCount?: number;
    returnCargoSummary?: string;
    emptyReturn?: boolean;
    reason: string;
    evaluatedAt?: string;
  };
  stopsSummary: Array<{
    stopCode: string;
    name: string;
    sequenceOrder: number;
  }>;
  shipmentIds?: Array<{
    _id: string;
    reference: string;
    pickupStopCode?: string;
    deliveryStopCode: string;
    recipientName: string;
    status: ShipmentStatus;
    qrToken: string;
    allowB2bWarehouseConfirm: boolean;
    pickupBalanceCollectedAt?: string;
    deliveryAddress: StructuredAddress;
    cargo: {
      category: CargoCategory;
      quantity: number;
      chargeableWeightKg: number;
      declaredContents: string;
      handlingNotes?: string;
    };
    pricingSnapshot?: {
      remainingBalancePaise?: number;
    };
  }>;
}

export interface PublicTrackingResponse {
  success: boolean;
  tracking: {
    reference: string;
    status: ShipmentStatus;
    corridorName: string;
    pickupStopCode: string;
    deliveryStopCode: string;
    destinationTown: string;
    destinationDistrict: string;
    cargoSummary: {
      category: CargoCategory;
      quantity: number;
      declaredContents: string;
    };
    estimatedArrivalWindow: {
      startAt: string;
      endAt: string;
      slotLabel: string;
    } | null;
    milestones: Array<{
      status: ShipmentStatus;
      at: string;
      note?: string;
    }>;
    deliveryProof: {
      verifiedAt: string;
      confirmationMode: string;
      photoUrl: string | null;
    } | null;
  };
}

export interface OperationalImpactMetrics {
  shipperScoped: {
    totalBookings: number;
    deliveredCount: number;
    activeCount: number;
    failedCount: number;
    cancelledCount: number;
    totalActualOrProjectedSpendPaise: number;
    totalCeilingBaselinePaise: number;
    estimatedSavingsPaise: number;
    estimatedSavingsPct: number;
    projectedSpendPaise?: number;
    projectedBaselinePaise?: number;
    projectedSavingsPaise?: number;
    projectedSavingsPct?: number | null;
    finalizedSpendPaise?: number;
    finalizedBaselinePaise?: number;
    finalizedSavingsPaise?: number;
    finalizedSavingsPct?: number | null;
    hasPricedShipments?: boolean;
    hasValidBaselineComparison?: boolean;
    baselineMethodology: string;
    isEstimated: true;
  };
  platformUtilization: {
    tripsCount: number;
    avgVehicleWeightUtilizationPct: number;
    avgVehicleVolumeUtilizationPct: number;
    avgPoolFillLevelPct: number;
    totalRoadDistanceKm: number;
    emptyReturnDistanceKm: number;
    costPerSuccessfulShipmentPaise: number | null;
    onTimeDeliveryRatePct: number | null;
    failedDeliveryRatePct: number;
    estimatedCo2ImpactKg: number | null;
    co2Methodology: string;
    isIllustrativeDemoData: true;
  };
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

export type ExceptionType =
  | 'CUSTOMER_UNAVAILABLE'
  | 'INCORRECT_ADDRESS'
  | 'VEHICLE_BREAKDOWN'
  | 'ROAD_BLOCKED'
  | 'SHIPMENT_DAMAGED'
  | 'RECIPIENT_REFUSES'
  | 'DRIVER_UNAVAILABLE'
  | 'PARTIAL_DELIVERY'
  | 'PICKUP_FAILURE'
  | 'ROUTE_INFEASIBILITY';

export interface ExceptionRecord {
  _id: string;
  tripId?: string;
  shipmentId?: string;
  exceptionType: ExceptionType;
  reason: string;
  resolutionStatus: 'OPEN' | 'RESCHEDULED' | 'RETURNED' | 'REASSIGNED' | 'RESOLVED';
  reassignedTripId?: string;
  routeRecalculated?: boolean;
  createdAt: string;
}

export type DriverAccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type DriverContractStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'INACTIVE'
  | 'EXPIRED'
  | 'TERMINATED';

export type VehicleOwnershipType = 'DRIVER_OWNED' | 'MARKETPLACE';
export type VehicleBodyType =
  | 'CLOSED_BODY'
  | 'OPEN_BODY'
  | 'CONTAINER'
  | 'FLATBED'
  | 'MINI_PICKUP';
export type VehicleOperationalStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'MAINTENANCE'
  | 'SUSPENDED';

export interface DriverOwnedVehicleRecord {
  _id: string;
  registrationNumber: string;
  operatorName: string;
  tier: FleetTier;
  ownershipType: VehicleOwnershipType;
  vehicleClass: string;
  bodyType: VehicleBodyType;
  maxWeightKg: number;
  maxVolumeCbm: number;
  bedDimensionsCm: {
    length: number;
    width: number;
    height: number;
  };
  operationalStatus: VehicleOperationalStatus;
  isAvailable: boolean;
  documents?: {
    rcNumber?: string;
    insurancePolicyNumber?: string;
    insuranceValidUntil?: string;
    fitnessValidUntil?: string;
    permitNotes?: string;
    verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  };
}

export interface CorridorSlotSchedule {
  slotNumber: 1 | 2;
  slotCodeSuffix: string;
  label: string;
  outboundPickupTime: string;
  returnTimeOptions: string[];
  defaultReturnTime: string;
  returnTimeLocked: boolean;
  lockedReturnTime?: string;
}

export interface CorridorStopSummary {
  stopCode: string;
  name: string;
  district?: string;
  state?: string;
  sequenceOrder: number;
  location?: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export interface CorridorScheduleRecord {
  _id: string;
  code: string;
  name: string;
  description?: string;
  isActive?: boolean;
  operatingDays: string[];
  stops: CorridorStopSummary[];
  slotSchedules: CorridorSlotSchedule[];
  guaranteedCeilingPaisePerKg?: number;
  baseRatePaisePerKg?: number;
  viabilityThresholdPct?: number;
  updatedAt?: string;
}

export interface CorridorFacets {
  origins: string[];
  destinations: string[];
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
}

export type DriverSlotCommitmentStatus =
  | 'COMMITTED'
  | 'LOCKED'
  | 'WITHDRAWN'
  | 'ALLOCATED'
  | 'NOT_ALLOCATED'
  | 'EXPIRED'
  | 'INVALIDATED';

export interface DriverSlotCommitmentRecord {
  _id: string;
  corridorId:
    | string
    | {
        _id: string;
        code: string;
        name: string;
      };
  slotId:
    | string
    | {
        _id: string;
        slotCode: string;
        label: string;
        departureDate: string;
        cutoffAt: string;
        status: string;
      };
  poolId?: string;
  slotNumber: 1 | 2;
  departureDate: string;
  selectedPickupTime: string;
  selectedReturnTime: string;
  status: DriverSlotCommitmentStatus;
  invalidationReason?: string;
  committedAt: string;
  withdrawnAt?: string;
  allocatedAt?: string;
}

export interface DriverWindowConflictDetail {
  sourceType: 'COMMITMENT' | 'TRIP';
  slotId?: string;
  slotNumber?: 1 | 2;
  corridorCode?: string;
  tripCode?: string;
  departureDate: string;
  pickupTime: string;
  returnTime: string;
  turnaroundBufferMin: number;
}

export interface DriverPoolingSlotItem {
  slotId: string;
  slotCode: string;
  slotNumber: 1 | 2;
  slotStatus?: string;
  label: string;
  departureDate: string;
  cutoffAt: string;
  plannedDepartureAt: string;
  availabilityState?: 'COMMITTED' | 'OPEN_FOR_SELECTION' | 'UNAVAILABLE_SCHEDULE_CONFLICT';
  conflictReason?: string | null;
  conflictDetail?: DriverWindowConflictDetail | null;
  optionConflicts?: Record<string, string | null>;
  turnaroundBufferMin?: number;
  corridor: {
    _id: string;
    code: string;
    name: string;
    stops: CorridorStopSummary[];
  };
  template: {
    outboundPickupTime: string;
    returnTimeOptions: string[];
    defaultReturnTime: string;
    returnTimeLocked: boolean;
    lockedReturnTime?: string;
  };
  capacity?: {
    capacityWeightKg: number;
    capacityVolumeCbm: number;
    reservedWeightKg: number;
    reservedVolumeCbm: number;
  };
  poolSummary: {
    poolId: string;
    poolCode: string;
    status: string;
    shipmentCount: number;
    reservedWeightKg: number;
    reservedVolumeCbm: number;
  } | null;
  commitment: DriverSlotCommitmentRecord | null;
}

export interface DriverPoolingSlotsResponse {
  success: boolean;
  eligible: boolean;
  ineligibleReason?: string;
  vehicle?: {
    _id: string;
    registrationNumber: string;
    vehicleClass: string;
    maxWeightKg: number;
    maxVolumeCbm: number;
  };
  slots: DriverPoolingSlotItem[];
  commitments: DriverSlotCommitmentRecord[];
}

export interface DriverContractRecord {
  _id: string;
  contractCode: string;
  platformOwnerId: string;
  driverProfileId: string;
  driverUserId: string;
  startDate: string;
  endDate: string;
  minimumGuaranteeTerms: {
    minGuaranteePaise: number;
    perKmRatePaise: number;
    guaranteedMonthlyDays?: number;
    notes?: string;
  };
  assignedVehicleId?: DriverOwnedVehicleRecord | null;
  eligibleCorridorIds: CorridorScheduleRecord[];
  status: DriverContractStatus;
  history: Array<{
    action: string;
    status: DriverContractStatus;
    actorUserId: string;
    at: string;
    note?: string;
  }>;
  createdAt: string;
}

export interface ManagedContractDriver {
  driverProfile: DriverProfile & {
    accountStatus: DriverAccountStatus;
    platformOwnerId: string;
    userId?: {
      _id: string;
      name: string;
      email: string;
      phone?: string;
      isActive: boolean;
    };
  };
  driverOwnedVehicle: DriverOwnedVehicleRecord | null;
  activeContract: DriverContractRecord | null;
  contracts: DriverContractRecord[];
}

export interface PlatformOwnerCatalog {
  corridors: CorridorScheduleRecord[];
}
