import { env } from '../config/env.js';

export interface OptimizerVehicleInput {
  id: string;
  max_weight_kg: number;
  max_volume_cbm: number;
}

export interface OptimizerStopInput {
  stop_index: number;
  stop_code: string;
  name: string;
  demand_weight_kg: number;
  demand_volume_cbm: number;
  time_window_min: [number, number] | null;
  shipment_ids: string[];
}

export interface OptimizerRequestPayload {
  vehicles: OptimizerVehicleInput[];
  stops: OptimizerStopInput[];
  distance_matrix_meters: number[][];
  duration_matrix_seconds: number[][];
  open_ended_outbound: boolean;
  time_limit_seconds?: number;
}

export interface OptimizerOrderedStop {
  sequence: number;
  stop_index: number;
  stop_code: string;
  name: string;
  arrival_min: number;
  cumulative_distance_meters: number;
  shipment_ids: string[];
}

export interface OptimizerServiceResult {
  status: 'OPTIMAL' | 'INFEASIBLE' | 'OPTIMIZER_UNAVAILABLE';
  vehicle_id?: string | null;
  ordered_stops: OptimizerOrderedStop[];
  assigned_shipments: string[];
  total_distance_meters: number;
  estimated_duration_seconds: number;
  reason?: string | null;
}

export async function callRouteOptimizer(
  payload: OptimizerRequestPayload
): Promise<OptimizerServiceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.OPTIMIZER_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.OPTIMIZER_URL}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        status: 'OPTIMIZER_UNAVAILABLE',
        ordered_stops: [],
        assigned_shipments: [],
        total_distance_meters: 0,
        estimated_duration_seconds: 0,
        reason: `Optimizer service returned HTTP ${response.status}: ${text}`,
      };
    }

    const data = (await response.json()) as OptimizerServiceResult;
    if (data.status !== 'OPTIMAL' && data.status !== 'INFEASIBLE') {
      return {
        status: 'OPTIMIZER_UNAVAILABLE',
        ordered_stops: [],
        assigned_shipments: [],
        total_distance_meters: 0,
        estimated_duration_seconds: 0,
        reason: 'Unexpected response payload from optimizer service.',
      };
    }
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'OPTIMIZER_UNAVAILABLE',
      ordered_stops: [],
      assigned_shipments: [],
      total_distance_meters: 0,
      estimated_duration_seconds: 0,
      reason: `Python OR-Tools optimizer unreachable or timed out (${message}).`,
    };
  } finally {
    clearTimeout(timer);
  }
}
