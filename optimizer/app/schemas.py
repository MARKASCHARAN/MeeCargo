from typing import List, Optional, Literal
from pydantic import BaseModel, Field, model_validator


class OptimizerVehicle(BaseModel):
    id: str = Field(..., min_length=1)
    max_weight_kg: float = Field(..., gt=0)
    max_volume_cbm: float = Field(..., gt=0)


class OptimizerStop(BaseModel):
    stop_index: int = Field(..., ge=0)
    stop_code: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    demand_weight_kg: float = Field(0, ge=0)
    demand_volume_cbm: float = Field(0, ge=0)
    time_window_min: Optional[tuple[int, int]] = None
    shipment_ids: List[str] = Field(default_factory=list)


class OptimizeRequest(BaseModel):
    vehicles: List[OptimizerVehicle] = Field(..., min_length=1)
    stops: List[OptimizerStop] = Field(..., min_length=2)
    distance_matrix_meters: List[List[int]]
    duration_matrix_seconds: List[List[int]]
    open_ended_outbound: bool = True
    time_limit_seconds: int = Field(5, ge=1, le=30)

    @model_validator(mode="after")
    def validate_matrices_and_stops(self) -> "OptimizeRequest":
        n = len(self.stops)
        indices = [s.stop_index for s in self.stops]
        if indices != list(range(n)):
            raise ValueError("stops.stop_index must be contiguous 0..N-1")

        if len(self.distance_matrix_meters) != n or any(
            len(row) != n for row in self.distance_matrix_meters
        ):
            raise ValueError("distance_matrix_meters must be N x N matching stops")

        if len(self.duration_matrix_seconds) != n or any(
            len(row) != n for row in self.duration_matrix_seconds
        ):
            raise ValueError("duration_matrix_seconds must be N x N matching stops")

        for row in self.distance_matrix_meters:
            if any(v < 0 for v in row):
                raise ValueError("distance_matrix_meters cannot contain negative values")

        for row in self.duration_matrix_seconds:
            if any(v < 0 for v in row):
                raise ValueError("duration_matrix_seconds cannot contain negative values")

        for stop in self.stops:
            if stop.time_window_min is not None:
                start_m, end_m = stop.time_window_min
                if start_m < 0 or end_m < start_m:
                    raise ValueError(f"Invalid time window on stop {stop.stop_code}")

        return self


class OrderedStopOutput(BaseModel):
    sequence: int
    stop_index: int
    stop_code: str
    name: str
    arrival_min: int
    cumulative_distance_meters: int
    shipment_ids: List[str]


class OptimizeResponse(BaseModel):
    status: Literal["OPTIMAL", "INFEASIBLE"]
    vehicle_id: Optional[str] = None
    ordered_stops: List[OrderedStopOutput] = Field(default_factory=list)
    assigned_shipments: List[str] = Field(default_factory=list)
    total_distance_meters: int = 0
    estimated_duration_seconds: int = 0
    reason: Optional[str] = None
