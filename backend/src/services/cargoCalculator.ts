import { env } from '../config/env.js';
import { HttpError } from '../utils/errors.js';

export type CargoCategory =
  | 'STANDARD_BOX'
  | 'SACK_BAG'
  | 'TEXTILE_ROLL'
  | 'PALLET_BUNDLE'
  | 'CUSTOM';

export type DimensionUnit = 'CM' | 'IN' | 'M';
export type WeightUnit = 'KG' | 'G';

export interface CargoPreset {
  category: CargoCategory;
  label: string;
  description: string;
  defaultDimensionsCm: { length: number; width: number; height: number };
  defaultUnitWeightKg: number;
  defaultStackable: boolean;
}

export const CARGO_PRESETS: CargoPreset[] = [
  {
    category: 'STANDARD_BOX',
    label: 'Standard Carton Box',
    description: 'Corrugated shipping carton (50 × 40 × 40 cm)',
    defaultDimensionsCm: { length: 50, width: 40, height: 40 },
    defaultUnitWeightKg: 18,
    defaultStackable: true,
  },
  {
    category: 'SACK_BAG',
    label: 'Woven Sack / Agro Bag',
    description: 'Grain, feed or polymer sack (70 × 45 × 25 cm)',
    defaultDimensionsCm: { length: 70, width: 45, height: 25 },
    defaultUnitWeightKg: 25,
    defaultStackable: true,
  },
  {
    category: 'TEXTILE_ROLL',
    label: 'Textile / Fabric Roll',
    description: 'Cylindrical fabric bale (120 × 30 × 30 cm bounding box)',
    defaultDimensionsCm: { length: 120, width: 30, height: 30 },
    defaultUnitWeightKg: 22,
    defaultStackable: false,
  },
  {
    category: 'PALLET_BUNDLE',
    label: 'Pallet / Strapped Bundle',
    description: 'Industrial palletized load (120 × 100 × 90 cm)',
    defaultDimensionsCm: { length: 120, width: 100, height: 90 },
    defaultUnitWeightKg: 180,
    defaultStackable: false,
  },
  {
    category: 'CUSTOM',
    label: 'Custom / Irregular Cargo',
    description: 'Machinery parts, pipes or irregular shapes using bounding dimensions',
    defaultDimensionsCm: { length: 80, width: 60, height: 50 },
    defaultUnitWeightKg: 35,
    defaultStackable: false,
  },
];

export interface CargoCalculationInput {
  category: CargoCategory;
  quantity: number;
  length: number;
  width: number;
  height: number;
  dimensionUnit?: DimensionUnit;
  unitActualWeight: number;
  weightUnit?: WeightUnit;
  volumetricDivisor?: number;
}

export interface CargoCalculationResult {
  category: CargoCategory;
  quantity: number;
  unitDimensionsCm: {
    length: number;
    width: number;
    height: number;
  };
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

const DIMENSION_TO_CM: Record<DimensionUnit, number> = {
  CM: 1,
  IN: 2.54,
  M: 100,
};

const WEIGHT_TO_KG: Record<WeightUnit, number> = {
  KG: 1,
  G: 0.001,
};

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateCargoMetrics(
  input: CargoCalculationInput
): CargoCalculationResult {
  const divisor = input.volumetricDivisor ?? env.VOLUMETRIC_DIVISOR;
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new HttpError(500, 'Invalid volumetric divisor configuration', 'CONFIG_ERROR');
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000) {
    throw new HttpError(400, 'Quantity must be an integer between 1 and 1000', 'VALIDATION_ERROR');
  }

  if (
    input.length <= 0 ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.unitActualWeight <= 0
  ) {
    throw new HttpError(
      400,
      'Cargo dimensions and weight must be greater than zero',
      'VALIDATION_ERROR'
    );
  }

  const dimFactor = DIMENSION_TO_CM[input.dimensionUnit ?? 'CM'];
  const weightFactor = WEIGHT_TO_KG[input.weightUnit ?? 'KG'];

  const lengthCm = roundTo(input.length * dimFactor, 2);
  const widthCm = roundTo(input.width * dimFactor, 2);
  const heightCm = roundTo(input.height * dimFactor, 2);

  if (lengthCm > 600 || widthCm > 260 || heightCm > 260) {
    throw new HttpError(
      400,
      'Cargo dimensions exceed maximum prototype vehicle envelope (600 × 260 × 260 cm)',
      'CARGO_OVERSIZE'
    );
  }

  const unitActualWeightKg = roundTo(input.unitActualWeight * weightFactor, 3);
  const totalActualWeightKg = roundTo(unitActualWeightKg * input.quantity, 2);

  const perUnitVolumeCbm = (lengthCm * widthCm * heightCm) / 1_000_000;
  const totalVolumeCbm = roundTo(perUnitVolumeCbm * input.quantity, 4);

  const perUnitVolumetricWeightKg = (lengthCm * widthCm * heightCm) / divisor;
  const totalVolumetricWeightKg = roundTo(perUnitVolumetricWeightKg * input.quantity, 2);

  const chargeableWeightKg = Math.max(totalActualWeightKg, totalVolumetricWeightKg);
  const billingBasis =
    totalVolumetricWeightKg > totalActualWeightKg ? 'VOLUMETRIC' : 'ACTUAL';

  return {
    category: input.category,
    quantity: input.quantity,
    unitDimensionsCm: {
      length: lengthCm,
      width: widthCm,
      height: heightCm,
    },
    unitActualWeightKg,
    totalActualWeightKg,
    volumetricDivisor: divisor,
    perUnitVolumetricWeightKg: roundTo(perUnitVolumetricWeightKg, 2),
    totalVolumetricWeightKg,
    chargeableWeightKg,
    billingBasis,
    perUnitVolumeCbm: roundTo(perUnitVolumeCbm, 4),
    totalVolumeCbm,
  };
}
