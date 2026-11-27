# MeeCargo

Crowd-pooled, asset-light B2B freight prototype for semi-urban and rural corridors (**UM-02**).
Routine pooling, dynamic pricing, cutoff locking, hybrid-fleet vehicle allocation, OR-Tools route optimization, LIFO loading plans, and delivery tracking are automated by the backend — **there is no dispatcher role, dispatcher account, or dispatcher UI**.

---

## Architecture & Tech Stack

- **Frontend (`frontend/`):** React 19 + Vite 8 + TypeScript + Tailwind CSS v4 + React Router + TanStack Query + Zustand + Leaflet + Recharts + `vite-plugin-pwa` (Dexie IndexedDB offline queue)
- **Backend API (`backend/`):** Node.js + Express 5 + TypeScript + Mongoose 9 + Socket.IO + Zod + `express-rate-limit` + Vitest
- **Route Optimizer (`optimizer/`):** Python 3.11+ + FastAPI + Pydantic v2 + Google OR-Tools (`ortools`)
- **Database:** MongoDB Atlas (or any MongoDB replica-set URI via `MONGODB_URL` in `backend/.env` — no Docker required)

---

## Prerequisites

- **Node.js** `>= 20` (verified on `v24.12.0`) and **npm** `>= 10`
- **Python** `>= 3.11` and `pip` / virtual environment tooling
- **MongoDB Atlas** cluster (or another reachable MongoDB URI) configured in `backend/.env`

---

## Environment Variables

### 1. Backend (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `5000` | Express API + Socket.IO port (`3000` if matched with `VITE_API_URL`) |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `ORIGIN` | No | `http://localhost:5173` | Allowed frontend CORS origin |
| `MONGODB_URL` | **Yes** | — | MongoDB Atlas connection string (`mongodb+srv://...`) |
| `JWT_SECRET` | **Yes** | — | Access token signing secret (`>= 8` chars) |
| `JWT_REFRESH_SECRET` | No | dev default | Refresh token signing secret |
| `VOLUMETRIC_DIVISOR` | No | `5000` | Divisor for `(L × W × H) / divisor` |
| `TOKEN_PERCENTAGE` | No | `15` | Refundable booking token percentage of ceiling price |
| `PAYMENT_MODE` | No | `SIMULATED` | `SIMULATED` or `TEST_GATEWAY` |
| `ROUTING_PROVIDER` | No | `FIXTURE` | `FIXTURE` (deterministic corridor matrix) or `OSRM` |
| `OSRM_BASE_URL` | No | `https://router.project-osrm.org` | OSRM server base URL when `ROUTING_PROVIDER=OSRM` |
| `OPTIMIZER_URL` | No | `http://localhost:8000` | Python FastAPI + OR-Tools base URL |
| `OPTIMIZER_TIMEOUT_MS` | No | `5000` | HTTP timeout calling optimizer |
| `GEOCODING_PROVIDER` | No | `FIXTURE` | `FIXTURE` or `NOMINATIM` |
| `NOTIFICATION_PROVIDER` | No | `CONSOLE` | `CONSOLE` or `WEBHOOK` |
| `CO2_EMISSIONS_FACTOR_KG_PER_TON_KM` | No | unset | Optional positive number enabling CO₂ impact estimates |

### 2. Frontend (`frontend/.env`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VITE_API_URL` | No | empty (uses Vite proxy) | Leave empty in `vite dev` to use built-in proxy to `http://localhost:5000`, or set explicitly to your backend URL (e.g., `http://localhost:5000`) |

> **Never commit `.env` files, API tokens, or production secrets.**

---

## Local Setup & Run Instructions

### 1. Configure MongoDB Atlas URI

Set `MONGODB_URL` in `backend/.env` to your MongoDB Atlas connection string (for example `mongodb+srv://<user>:<password>@<cluster>/meecargo?retryWrites=true&w=majority`).

### 2. Seed (or Reset & Replay) Demo Data

```bash
cd backend
npm install
npm run seed          # Upsert base demo data
npm run seed:reset    # Clear mutable demo state and replay clean scenario
```

Demo credentials (password for all accounts: **`Demo@1234`**):
- **Shipper 1 (Patel Textiles Pvt. Ltd.):** `shipper1@meecargo.demo`
- **Shipper 2 (Charotar Agro Mills):** `shipper2@meecargo.demo`
- **Shipper 3 (Kheda Ceramic & Hardware):** `shipper3@meecargo.demo`
- **Driver 1 (Tier 1 Attached Vehicle `GJ-06-MC-1001`):** `driver1@meecargo.demo`
- **Driver 2 (Tier 2 Marketplace Vehicle `GJ-06-MK-2044`):** `driver2@meecargo.demo`
- **Platform Owner (Singleton Account managing all Tier 1 contracts):** `owner@meecargo.demo` (or configured via `PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD` in `backend/.env`)

What `seed:reset` prepares:
- Fixed corridor **`GJ-VAD-AMD-01`** (`Vadodara → Anand → Nadiad → Ahmedabad`) with open `AM` and `PM` slots
- Pre-pooled `AM` pool containing shipments `MC-DEMO-001` (Shipper 1, anchor-eligible) and `MC-DEMO-002` (Shipper 2) so booking as Shipper 3 visibly increases utilization and updates projected savings
- Pre-assigned executable `PM` trip **`MC-DEMO-TRIP-PM1`** (`driver1`, Tier 1 vehicle) carrying `MC-DEMO-003` with a live non-sequential `/track/<token>` recipient URL printed by the seed output
- Confirmed return backhaul request **`BH-AMD-VAD-001`** (`AMD → VAD`)

### 3. Start the Python OR-Tools Optimizer

```bash
cd optimizer
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# Linux / macOS:
# source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Health check: `GET http://localhost:8000/health`

### 4. Start the Backend API

```bash
cd backend
npm run dev
```

Health check: `GET http://localhost:5000/api/v1/health`

### 5. Start the Frontend PWA

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Automated Verification Commands

```bash
# Python OR-Tools optimizer tests
cd optimizer && pytest -v

# Backend typecheck, Vitest suite, and TypeScript build
cd backend && npm run typecheck && npm test && npm run build

# Frontend typecheck, PWA build, and ESLint
cd frontend && npm run build && npm run lint
```

---

## Mocked / Simulated External Services

- **Payments (`PAYMENT_MODE=SIMULATED`):** Booking token payments, pickup balance collection records, and refunds execute deterministic in-app simulations with audit references (`SIM-*`) — no real UPI, card, or bank transfers occur.
- **Road Distance & Geocoding (`ROUTING_PROVIDER=FIXTURE`, `GEOCODING_PROVIDER=FIXTURE`):** Uses deterministic road distances and place coordinates for the seeded Gujarat corridor. Real `OSRM` / `NOMINATIM` HTTP providers can be enabled via env vars.
- **Notifications (`NOTIFICATION_PROVIDER=CONSOLE`):** Logs in-app `NotificationLog` documents and console messages. SMS and WhatsApp gateways report `configured: false` in the prototype.
- **Platform Impact Metrics:** Aggregated platform utilization and cost benchmarks display explicit calculation methodologies and illustrative demo disclosures when populated from seed/test data.

---

## Known Limitations

1. **MongoDB Transactions on Standalone Instances:** Multi-document atomicity requires a MongoDB replica set (`rs0`); standalone MongoDB instances log a warning and execute steps sequentially without transaction rollback.
2. **Fixture Matrix Scope:** Under `ROUTING_PROVIDER=FIXTURE`, road distances exist for the demo corridor stop codes (`VAD`, `ANA`, `NAD`, `AMD`); adding custom stops requires `ROUTING_PROVIDER=OSRM` (capped at 25 matrix stops per request).
3. **CO₂ Impact Optionality:** Estimated CO₂ impact intentionally returns `null` (with an explanatory message) unless `CO2_EMISSIONS_FACTOR_KG_PER_TON_KM` is explicitly configured in the environment.
4. **Offline PWA Boundaries:** Drivers can view cached trips/manifests and queue status transitions offline, but final delivery verification (OTP validation / B2B sign-off / photo POD upload) requires connectivity.
5. **External Gateways & Permits:** No live payment gateway settlement, SMS/WhatsApp delivery, or municipal city-entry permit API integration is wired in this prototype.
