from fastapi import FastAPI
from .schemas import OptimizeRequest, OptimizeResponse
from .solver import solve_vrp

app = FastAPI(
    title="MeeCargo Route Optimizer",
    version="1.0.0",
    description="Google OR-Tools CVRP/VRPTW service for MeeCargo multi-drop corridor trips.",
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "meecargo-optimizer", "solver": "ortools"}


@app.post("/optimize", response_model=OptimizeResponse)
def optimize(payload: OptimizeRequest) -> OptimizeResponse:
    return solve_vrp(payload)
