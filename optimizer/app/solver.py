from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from .schemas import OptimizeRequest, OptimizeResponse, OrderedStopOutput


def solve_vrp(request: OptimizeRequest) -> OptimizeResponse:
    """
    Solves CVRP / VRPTW using Google OR-Tools for single-origin multi-drop freight.
    Returns INFEASIBLE if vehicle capacities or time windows cannot be satisfied.
    """
    num_locations = len(request.stops)
    num_vehicles = len(request.vehicles)
    depot_index = 0

    total_demand_weight = sum(s.demand_weight_kg for s in request.stops)
    total_demand_volume = sum(s.demand_volume_cbm for s in request.stops)

    # Quick capacity feasibility check across single-vehicle outbound trip
    max_vehicle_weight = max(v.max_weight_kg for v in request.vehicles)
    max_vehicle_volume = max(v.max_volume_cbm for v in request.vehicles)
    if num_vehicles == 1 and (
        total_demand_weight > max_vehicle_weight
        or total_demand_volume > max_vehicle_volume
    ):
        return OptimizeResponse(
            status="INFEASIBLE",
            reason=(
                f"Total demand ({total_demand_weight} kg / {total_demand_volume} m3) "
                f"exceeds vehicle capacity ({max_vehicle_weight} kg / {max_vehicle_volume} m3)."
            ),
        )

    manager = pywrapcp.RoutingIndexManager(num_locations, num_vehicles, depot_index)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        if request.open_ended_outbound and to_node == depot_index:
            return 0
        return request.distance_matrix_meters[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    # Weight capacity constraint (scaled to integer grams/decagrams: kg * 100)
    def weight_callback(from_index: int) -> int:
        node = manager.IndexToNode(from_index)
        return int(round(request.stops[node].demand_weight_kg * 100))

    weight_cb_idx = routing.RegisterUnaryTransitCallback(weight_callback)
    routing.AddDimensionWithVehicleCapacity(
        weight_cb_idx,
        0,
        [int(round(v.max_weight_kg * 100)) for v in request.vehicles],
        True,
        "WeightCapacity",
    )

    # Volume capacity constraint (scaled to integer litres: m3 * 1000)
    def volume_callback(from_index: int) -> int:
        node = manager.IndexToNode(from_index)
        return int(round(request.stops[node].demand_volume_cbm * 1000))

    volume_cb_idx = routing.RegisterUnaryTransitCallback(volume_callback)
    routing.AddDimensionWithVehicleCapacity(
        volume_cb_idx,
        0,
        [int(round(v.max_volume_cbm * 1000)) for v in request.vehicles],
        True,
        "VolumeCapacity",
    )

    # Time window constraint (minutes)
    def duration_min_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        if request.open_ended_outbound and to_node == depot_index:
            return 0
        service_min = 0 if from_node == depot_index else 15
        travel_min = int(round(request.duration_matrix_seconds[from_node][to_node] / 60))
        return service_min + travel_min

    time_cb_idx = routing.RegisterTransitCallback(duration_min_callback)
    horizon_min = 24 * 60
    routing.AddDimension(
        time_cb_idx,
        horizon_min,  # allow waiting slack
        horizon_min,
        False,
        "Time",
    )
    time_dimension = routing.GetDimensionOrDie("Time")

    for stop in request.stops:
        if stop.time_window_min is not None:
            index = manager.NodeToIndex(stop.stop_index)
            start_m, end_m = stop.time_window_min
            time_dimension.CumulVar(index).SetRange(start_m, end_m)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.seconds = request.time_limit_seconds

    solution = routing.SolveWithParameters(search_params)
    if solution is None:
        return OptimizeResponse(
            status="INFEASIBLE",
            reason="OR-Tools solver could not find a feasible route satisfying all capacity and time-window constraints.",
        )

    # Extract route for primary allocated vehicle
    best_vehicle_idx = 0
    for v_idx in range(num_vehicles):
        idx = routing.Start(v_idx)
        if not routing.IsEnd(solution.Value(routing.NextVar(idx))):
            best_vehicle_idx = v_idx
            break

    ordered_stops: list[OrderedStopOutput] = []
    assigned_shipments: list[str] = []
    total_distance_m = 0
    total_duration_s = 0

    index = routing.Start(best_vehicle_idx)
    prev_node = manager.IndexToNode(index)
    sequence = 0

    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        stop = request.stops[node]
        if sequence > 0:
            total_distance_m += request.distance_matrix_meters[prev_node][node]
            total_duration_s += request.duration_matrix_seconds[prev_node][node]

        arrival_min = int(solution.Min(time_dimension.CumulVar(index)))
        ordered_stops.append(
            OrderedStopOutput(
                sequence=sequence,
                stop_index=node,
                stop_code=stop.stop_code,
                name=stop.name,
                arrival_min=arrival_min,
                cumulative_distance_meters=total_distance_m,
                shipment_ids=stop.shipment_ids,
            )
        )
        assigned_shipments.extend(stop.shipment_ids)
        prev_node = node
        sequence += 1
        index = solution.Value(routing.NextVar(index))

    return OptimizeResponse(
        status="OPTIMAL",
        vehicle_id=request.vehicles[best_vehicle_idx].id,
        ordered_stops=ordered_stops,
        assigned_shipments=assigned_shipments,
        total_distance_meters=total_distance_m,
        estimated_duration_seconds=total_duration_s,
    )
