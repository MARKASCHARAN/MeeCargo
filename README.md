# MeeCargo

Crowd-pooled, asset-light B2B freight prototype for semi-urban and rural corridors (**UM-02**).
Routine pooling, pricing, cutoff locking, vehicle allocation, and trip execution are automated by the backend — **there is no dispatcher role or dispatcher UI**.

---

## Tech Stack (Stage 1 Foundation)

- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS v4 + React Router + TanStack Query + Zustand
- **Backend:** Node.js + Express 5 + TypeScript + Mongoose 9 + Zod
- **Database:** MongoDB (replica set recommended for multi-document ACID transactions)

---

## Prerequisites

- Node.js `>= 20` (tested on `v24.12.0`)
- npm `>= 10`
- MongoDB (either Docker with `docker-compose.yml` for a local single-node replica set, or a MongoDB Atlas connection string)

---

## Environment Variables (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `5000` | Express API port |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `ORIGIN` | No | `http://localhost:5173` | Allowed frontend CORS origin |
| `MONGODB_URL` | **Yes** | — | MongoDB connection URI (include `?replicaSet=rs0` for local Docker) |
| `JWT_SECRET` | **Yes** | — | Signing key (`>= 8` chars) |
| `JWT_REFRESH_SECRET` | No | dev default | Refresh token signing key |
| `VOLUMETRIC_DIVISOR` | No | `5000` | Divisor for `(L × W × H) / divisor` |
| `TOKEN_PERCENTAGE` | No | `15` | Refundable booking token percentage |
| `PAYMENT_MODE` | No | `SIMULATED` | `SIMULATED` or `TEST_GATEWAY` |
| `ROUTING_PROVIDER` | No | `FIXTURE` | `FIXTURE` or `OSRM` |
| `NOTIFICATION_PROVIDER` | No | `CONSOLE` | `CONSOLE` or `WEBHOOK` |

> **Never commit `.env` files or real credentials.**

---

## MongoDB Replica-Set Setup (Local Development)

Multi-document booking, pooling, and ledger operations use Mongoose transactions when connected to a replica set:

```bash
docker compose up -d
```

Once healthy, MongoDB runs on `mongodb://localhost:27017/meecargo?replicaSet=rs0`.

---

## Running Locally

### 1. Seed Demo Data (Corridor, Slots, Vehicles, Demo Users)

```bash
cd backend
npm install
npm run seed
```

Demo accounts created by the seed script (password: `Demo@1234`):
- Shipper 1: `shipper1@meecargo.demo`
- Shipper 2: `shipper2@meecargo.demo`
- Driver 1: `driver1@meecargo.demo`

### 2. Start Backend API

```bash
cd backend
npm run dev
```

Health check: `GET http://localhost:5000/api/v1/health`

### 3. Start Frontend App

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Verification Scripts

```bash
# Backend typecheck & unit tests
cd backend
npm run typecheck
npm test
npm run build

# Frontend typecheck, build & lint
cd frontend
npm run build
npm run lint
```

---

## Mocked / Simulated Services (Prototype Boundaries)

- **Payments:** Explicitly simulated (`PAYMENT_MODE=SIMULATED`); no real UPI or card charges occur.
- **Routing / Geocoding:** Deterministic Gujarat demo corridor (`Vadodara → Anand → Nadiad → Ahmedabad`) fixtures when `ROUTING_PROVIDER=FIXTURE`.
- **Notifications:** Console/log delivery when `NOTIFICATION_PROVIDER=CONSOLE`.
