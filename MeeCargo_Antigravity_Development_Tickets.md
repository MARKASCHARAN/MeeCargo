# MeeCargo --- Development Tickets

**Project:** MeeCargo\
**Problem statement:** UM-02 --- Affordable Logistics Solutions for
Small-Scale Companies in Semi-Urban and Rural Areas\
**Document purpose:** End-to-end implementation backlog for Antigravity\
**Build approach:** Rapid prototype, modular monolith, MongoDB,
automated operations, no dispatcher role/UI.

------------------------------------------------------------------------

## 0. Product scope and non-negotiable decisions

### Product concept

MeeCargo is an asset-light, B2B crowd-pooled freight platform. It
combines compatible shipments from small businesses along scheduled
semi-urban and rural corridors, allocates suitable third-party vehicles,
optimizes delivery routes, and coordinates shipment execution.

### User-facing roles

1.  **Shipper:** B2B business that books and tracks shipments.
2.  **Driver:** Attached-fleet or marketplace driver who executes
    assigned trips.
3.  **Recipient / End user:** Consignee who receives notifications and
    uses a secure tracking link. No account is required.

**There is no dispatcher role and no dispatcher dashboard.** Routine
operations should be automated by the backend. Operational configuration
for the prototype can be provided through seed data/configuration.
Unsafe, unavailable or non-viable situations must fail safely rather
than silently creating a trip.

### Agreed technical direction

  Area                     Choice
  ------------------------ -----------------------------------------------------------
  Frontend                 React + Vite + TypeScript
  Application UI           One React application with role-based routes
  Styling                  Tailwind CSS + shadcn/ui
  Client state             Zustand where needed
  Server state             TanStack Query
  Forms / validation       React Hook Form + Zod
  Backend                  Node.js + Express + TypeScript
  Database                 MongoDB Atlas + Mongoose
  Optimization             Python + FastAPI + Google OR-Tools
  Maps                     Leaflet + suitable OpenStreetMap-compatible tile provider
  Road routing             OSRM or another configured routing provider
  Realtime                 Socket.IO
  Offline driver storage   IndexedDB + Dexie
  PWA                      vite-plugin-pwa
  QR                       qrcode + html5-qrcode
  Image evidence           Cloudinary or local development adapter
  Payments                 Payment-provider test mode or clearly labelled simulation
  Charts                   Recharts

### Product boundaries for the prototype

-   Start with **fixed, scheduled corridors** and single-origin,
    multi-drop outbound trips.
-   No company-owned trucks, warehouses, packaging inventory or salaried
    loading helpers.
-   Shippers pack their own cargo; shipper staff load and recipient
    staff unload.
-   No mid-route pickup in the initial workflow.
-   Route, pricing, capacity and trip economics must use real
    calculations from supplied data. Do not hardcode claimed savings.
-   Show projected price before cutoff and immutable locked price after
    cutoff.
-   Do not claim 35--50% savings as proven. Treat it as a
    target/hypothesis until validated.
-   A visual truck-bed plan is a planning aid, not a certified
    load-safety calculation.
-   Keep external integrations replaceable; use mocks/simulations where
    live credentials are unavailable and label them honestly.

------------------------------------------------------------------------

# 1. Project foundation

## MC-001 --- Initialize the rapid-prototype application

**Priority:** P0\
**Type:** Foundation

### Description

Create the React/Vite frontend and Express/TypeScript backend required
for the MeeCargo prototype. Keep the setup lightweight; do not introduce
microservices, Kubernetes or production infrastructure not needed for
the prototype.

### Acceptance criteria

-   [x] Frontend starts locally using documented commands.
-   [x] Express API starts locally using documented commands.
-   [x] TypeScript checks pass for both applications.
-   [x] Environment variables are loaded from `.env` and validated at
    startup.
-   [x] A health endpoint confirms API availability.
-   [x] CORS is configured for the local frontend origin.
-   [x] A concise README explains setup, scripts and required
    environment variables.
-   [x] No secrets or credentials are committed.

## MC-002 --- Configure MongoDB and Mongoose

**Priority:** P0\
**Type:** Foundation

### Description

Connect the backend to MongoDB using Mongoose. Create the initial models
and indexes as features are implemented.

### Acceptance criteria

-   [x] MongoDB connection is configurable through an environment
    variable.
-   [x] Connection failure is reported clearly.
-   [x] Mongoose models use TypeScript types.
-   [x] Important unique constraints and query indexes are defined.
-   [x] GeoJSON locations use valid longitude/latitude ordering.
-   [x] Geospatial fields that require proximity queries have `2dsphere`
    indexes.
-   [x] Multi-document financial/booking operations use transactions
    where supported; development setup documents replica-set
    requirements.
-   [ ] Seed script creates demo corridors, slots, vehicles and users. *(Implemented in `backend/src/seeds/seed.ts`; awaiting `MONGODB_URL` / running MongoDB instance to execute live against DB.)*

## MC-003 --- Build shared UI shell and route guards

**Priority:** P0\
**Type:** Frontend foundation

### Description

Create one React application with role-specific areas. Do not build a
dispatcher interface.

### Routes

-   `/shipper/*`
-   `/driver/*`
-   `/track/:trackingToken`

### Acceptance criteria

-   [x] Shipper, driver and public tracking routes have distinct
    layouts.
-   [x] Authenticated routes enforce the correct role.
-   [x] Tracking route is public but requires a secure, unguessable
    token.
-   [x] Shared components and API types are reused.
-   [x] Responsive layouts work on desktop and mobile.
-   [x] Loading, empty, error and unauthorized states are implemented.

------------------------------------------------------------------------

# 2. Identity, businesses and access

## MC-004 --- Implement authentication and role-based access

**Priority:** P0\
**Type:** Backend + frontend

### Description

Support shipper business users and drivers. Recipients do not create
accounts.

### Acceptance criteria

-   [x] Users can register and log in.
-   [x] Roles include `SHIPPER` and `DRIVER`; no `DISPATCHER` role
    exists.
-   [x] Passwords are securely hashed.
-   [x] Authenticated API endpoints enforce role authorization.
-   [x] Sessions/tokens can be refreshed or invalidated according to the
    chosen auth implementation.
-   [x] A driver cannot access shipper-only business data.
-   [x] A shipper cannot access another business's shipments.
-   [x] Demo accounts can be seeded for development.

## MC-005 --- Create shipper business profiles

**Priority:** P0\
**Type:** Backend + frontend

### Description

Allow a shipper user to create and manage a B2B business profile.

### Data

Business name, business type, contact details, pickup address, GSTIN
(optional for prototype), service locations and account owner.

### Acceptance criteria

-   [x] Shipper can create and edit their business profile.
-   [x] A user is associated with a business.
-   [x] Business data is isolated by business ownership.
-   [x] Multiple shipper users per business can be supported by the data
    model, even if the first UI only supports one owner.
-   [x] Business profile is required before creating a shipment.

## MC-006 --- Create driver profiles

**Priority:** P0\
**Type:** Backend + frontend

### Description

Create driver accounts and associate them with a vehicle/operator
category.

### Acceptance criteria

-   [x] Driver profile includes name, phone and availability.
-   [x] Driver can view only trips assigned to them.
-   [x] Driver can update availability.
-   [x] Driver can see vehicle and trip information relevant to their
    assignment.
-   [x] Driver profile can be associated with Tier 1, Tier 2 or Tier 3
    fleet records.

------------------------------------------------------------------------

# 3. Corridors, slots and shipment booking

## MC-007 --- Configure corridors and scheduled slots

**Priority:** P0\
**Type:** Backend + shipper UI

### Description

Represent fixed corridor routes and their scheduled departure slots.
Seed the initial corridor for the demo, for example Vadodara → Anand →
Nadiad → Ahmedabad. Treat this as demo data, not a claim of an operating
service.

### Acceptance criteria

-   [x] Corridor has ordered stops and geographic coordinates.
-   [x] Corridor defines operating days and scheduled slots.
-   [x] Each slot has booking cutoff, planned departure and estimated
    arrival windows.
-   [x] Shipper can browse available corridors and slots.
-   [x] Booking is blocked after cutoff unless a later slot is selected.
-   [x] Slot availability reflects capacity reserved by confirmed
    bookings.
-   [x] Corridor/slot data can be changed through seed/configuration
    data without a dispatcher UI.

## MC-008 --- Implement cargo details and chargeable weight

**Priority:** P0\
**Type:** Backend + shipper UI

### Description

Capture cargo details and calculate chargeable weight using actual and
volumetric weight.

### Inputs

-   Cargo category: standard box, sack/bag, textile roll, pallet/bundle,
    custom.
-   Actual weight.
-   Length, width and height.
-   Quantity.
-   Stackability and handling restrictions.
-   Declared contents / handling notes.

### Calculation

`Volumetric Weight = (Length × Width × Height) / Volumetric Divisor`

`Chargeable Weight = max(Actual Weight, Volumetric Weight)`

Use consistent units and a configurable divisor. Do not assume a divisor
without making it a configuration value.

### Acceptance criteria

-   [x] Shipper can select visual cargo presets or enter custom
    dimensions.
-   [x] Dimensions, quantity and weight are validated.
-   [x] Unit conversion is handled consistently.
-   [x] Volumetric and chargeable weight are calculated on the backend.
-   [x] UI displays the calculation transparently.
-   [x] Cargo volume is stored separately from chargeable weight.
-   [x] Irregular cargo can be represented without forcing it into a
    standard box preset.

## MC-009 --- Implement shipment address and location capture

**Priority:** P0\
**Type:** Frontend + backend

### Description

Support practical semi-urban and rural address entry.

### Acceptance criteria

-   [x] Pickup and delivery location support address text and map pin.
-   [x] Store GeoJSON coordinates in `[longitude, latitude]` order.
-   [x] Address supports village, town, district, PIN code and landmark.
-   [x] Shipper can correct a geocoded location manually.
-   [x] Missing or invalid delivery coordinates prevent booking
    confirmation when route calculation requires them.
-   [x] Geocoding provider is configurable and can be mocked in
    development.

## MC-010 --- Create shipment booking

**Priority:** P0\
**Type:** Backend + shipper UI

### Description

Allow a business to book a shipment on a corridor and departure slot.

### Acceptance criteria

-   [x] Shipper selects corridor, slot, pickup/delivery stop and cargo.
-   [x] Booking receives a unique human-readable reference.
-   [x] Booking stores business, cargo, locations, payment choice and
    selected slot.
-   [x] Shipment status lifecycle is explicit and validated.
-   [x] Duplicate submissions do not create duplicate bookings.
-   [x] Shipper can view booking details and history.
-   [x] Booking is not considered confirmed until required token/payment
    state is satisfied.

## MC-011 --- Import multiple shipments using CSV

**Priority:** P1\
**Type:** Frontend + backend

### Description

Support bulk order intake for small businesses.

### Acceptance criteria

-   [x] Downloadable CSV template is available.
-   [x] CSV rows are validated individually.
-   [x] Invalid rows show actionable errors.
-   [x] Valid rows can be submitted without silently dropping invalid
    rows.
-   [x] Duplicate external order references are detected.
-   [x] Import summary shows created, rejected and duplicate rows.

------------------------------------------------------------------------

# 4. Pooling and dynamic pricing

## MC-012 --- Build shipment-pool compatibility engine

**Priority:** P0\
**Type:** Backend

### Description

Group compatible bookings by corridor, slot, pickup arrangements,
destination stops and cargo constraints.

### Acceptance criteria

-   [x] Pool is associated with one corridor and one departure slot.
-   [x] Only eligible, paid-token bookings enter a pool.
-   [x] Incompatible cargo or time requirements are rejected or assigned
    elsewhere.
-   [x] Pool tracks reserved weight, volume and capacity.
-   [x] Booking cancellation updates pool capacity correctly.
-   [x] A shipment cannot be assigned to multiple active pools.
-   [x] Pool status includes `OPEN`, `LOCKING`, `LOCKED`, `CANCELLED`
    and `ROLLED_OVER`.
-   [x] Pool membership updates are atomic enough to prevent overbooking
    under concurrent requests.

## MC-013 --- Implement live pool utilization

**Priority:** P0\
**Type:** Backend + realtime + shipper UI

### Description

Show current pool utilization and projected price as bookings arrive.

### Acceptance criteria

-   [x] Weight utilization and volume utilization are calculated
    separately.
-   [x] The UI does not imply that one utilization percentage captures
    every capacity constraint.
-   [x] Pool updates are pushed using Socket.IO.
-   [x] Shipper sees projected rate before cutoff.
-   [x] Projected rate is clearly labelled as non-final.
-   [x] No booking can push the pool beyond configured capacity.
-   [x] UI updates when another eligible shipper joins or cancels.

## MC-014 --- Implement pricing and anchor reward engine

**Priority:** P0\
**Type:** Backend + shipper UI

### Description

Implement deterministic pricing in TypeScript. Do not use an LLM for
pricing.

### Inputs

-   Chargeable weight.
-   Corridor and slot.
-   Guaranteed rate ceiling.
-   Pool utilization.
-   Configured pooling discount tiers.
-   Anchor booking eligibility.
-   Applicable additional charges.

### Acceptance criteria

-   [x] Price is calculated in integer paise.
-   [x] Guaranteed price ceiling is never exceeded.
-   [x] Pool discount tiers are configurable.
-   [x] Anchor reward is applied only to the eligible first booking
    under the configured rules.
-   [x] Price breakdown is visible to the shipper.
-   [x] Projected price and final locked price are separate fields.
-   [x] Pricing configuration/version is stored with the booking.
-   [x] Pricing tests cover boundaries, rounding and concurrent booking
    cases.
-   [x] The engine rejects or flags a price that violates the configured
    minimum margin policy unless an explicit subsidy is recorded.

## MC-015 --- Implement refundable token and payment states

**Priority:** P0\
**Type:** Backend + shipper UI

### Description

Support the proposed 15--20% refundable booking token and remaining
balance. Use a payment provider test mode or an explicitly labelled
payment simulation.

### Acceptance criteria

-   [x] Token percentage is configurable.
-   [x] Token amount is calculated from the quoted ceiling or explicitly
    defined booking basis.
-   [x] Payment states include `PENDING`, `SUCCESS`, `FAILED`,
    `REFUND_PENDING`, `REFUNDED`.
-   [x] Duplicate payment callbacks are idempotent.
-   [x] Refunds are recorded with references and reasons.
-   [x] Pickup balance is calculated from final locked price minus token
    already paid.
-   [ ] QR scan at pickup can trigger a balance-payment request. *(Wired in Stages 7–8 with QR scanning and pickup collection UI.)*
-   [x] No UI claims a real UPI payment occurred when using simulation.
-   [x] Payment and shipment state transitions are validated.

## MC-016 --- Implement cutoff lock and final price snapshot

**Priority:** P0\
**Type:** Backend

### Description

At slot cutoff, stop accepting bookings into the pool, calculate
viability, lock final pricing and create an immutable manifest input.

### Acceptance criteria

-   [x] Cutoff process is idempotent.
-   [x] Pool transitions to `LOCKING` before final calculations.
-   [x] New bookings are rejected or directed to another slot during
    locking.
-   [x] Final rate and anchor discount are snapshotted.
-   [x] Each shipment's final charge and remaining balance are
    snapshotted.
-   [x] Pool transitions to `LOCKED` only after required checks pass.
-   [x] Failed locking leaves a recoverable state and does not partially
    charge users.
-   [x] Locked prices cannot be changed by later pricing configuration
    edits.

## MC-017 --- Implement low-utilization viability and rollover/refund

**Priority:** P0\
**Type:** Backend + shipper UI

### Description

Handle low-utilization fixed corridors and new/on-demand routes
differently.

### Acceptance criteria

-   [x] Established corridor uses its configured operating policy and
    guaranteed ceiling.
-   [x] New route uses a configurable viability threshold, initially 50%
    for the prototype.
-   [x] Viability checks consider weight, volume and trip contribution
    economics, not weight percentage alone.
-   [x] If a new route fails viability, shipper can choose rollover or
    full token refund.
-   [x] Rollover requires shipper consent and targets a future
    compatible slot.
-   [x] Refund choice creates an auditable refund record.
-   [x] No trip is created for a failed new-route viability check.
-   [x] UI clearly explains the available options.

------------------------------------------------------------------------

# 5. Fleet and vehicle allocation

## MC-018 --- Model vehicles and fleet tiers

**Priority:** P0\
**Type:** Backend

### Description

Represent the hybrid fleet model.

### Fleet tiers

-   Tier 1: Attached fleet for scheduled fixed corridors.
-   Tier 2: Open marketplace capacity for overflow, express and
    right-sizing.
-   Tier 3: Empty-return partners for backhaul capacity.

### Vehicle attributes

Registration, operator, driver, tier, capacity weight, cargo volume,
dimensions, operating cost, availability, permitted vehicle class and
corridor compatibility.

### Acceptance criteria

-   [x] Vehicle stores weight and volume capacity separately.
-   [x] Vehicle availability can be restricted by date/slot.
-   [x] Tier and payout model are stored.
-   [x] Tier 1 commitments can be associated with a corridor and
    schedule.
-   [x] Tier 2 and Tier 3 vehicles can be marked available/unavailable.
-   [x] Vehicle records can be seeded for demo scenarios.

## MC-019 --- Implement automated vehicle right-sizing and tier hierarchy

**Priority:** P0\
**Type:** Backend

### Description

Select a feasible vehicle based on pool requirements and fleet rules.

### Acceptance criteria

-   [x] Tier 1 capacity is considered first for its contracted
    corridor/slot.
-   [x] Tier 2 is used for eligible overflow or separate express demand
    according to policy.
-   [x] Tier 3 is considered for return/backhaul work.
-   [x] Vehicle selection checks weight, volume, dimensions and
    operating restrictions.
-   [x] Right-sizing is possible before cutoff when policy allows.
-   [x] Tier 1 contractual minimum guarantee is included in economics
    even if a smaller vehicle is selected.
-   [x] No Tier 1 vehicle is silently cannibalized in violation of the
    agreed hierarchy.
-   [x] If no feasible vehicle exists, booking/pool is flagged for
    rollover/refund or alternative slot; do not create an impossible
    trip.

## MC-020 --- Implement driver trip assignment

**Priority:** P0\
**Type:** Backend + driver UI

### Description

Automatically assign a driver to a locked trip using vehicle/operator
availability.

### Acceptance criteria

-   [x] Driver is assigned only after vehicle allocation succeeds.
-   [x] Driver receives trip details in the PWA.
-   [x] Driver can accept or report inability to execute.
-   [x] Driver cannot accept overlapping incompatible trips.
-   [x] Assignment changes are auditable.
-   [x] If no eligible driver exists, the trip does not silently
    proceed.
-   [x] Driver receives notifications for new or changed assignments.

------------------------------------------------------------------------

# 6. Route optimization and cargo loading

## MC-021 --- Integrate road-distance matrix provider

**Priority:** P0\
**Type:** Backend + external service

### Description

Obtain road-network distances and travel-time estimates for corridor
stops and shipment destinations.

### Acceptance criteria

-   [ ] Routing provider is configurable.
-   [ ] Road distances are used instead of straight-line distances for
    trip cost/route planning.
-   [ ] Matrix request handles provider limits and errors.
-   [ ] Cached matrices can be reused for stable corridor stops.
-   [ ] Missing route data causes a visible failure or fallback, not
    invented distance values.
-   [ ] Demo mode has a deterministic fixture matrix.

## MC-022 --- Build Python OR-Tools optimization service

**Priority:** P0\
**Type:** Optimization service

### Description

Create a small FastAPI service that accepts a trip optimization request
and returns a route plan. Keep it independent and lightweight.

### Initial optimization scope

-   Fixed corridor stops.
-   Multiple delivery destinations.
-   Vehicle capacity constraints.
-   Stop sequence and estimated travel time.
-   Delivery windows where supplied.
-   Pickup at the origin only; no mid-route pickups in MVP.

### Acceptance criteria

-   [ ] API accepts vehicles, shipment destinations, demands, time
    windows and distance/time matrix.
-   [ ] API validates request data.
-   [ ] Uses OR-Tools VRP/CVRP or VRPTW as appropriate.
-   [ ] Returns ordered stops, assigned shipments, total distance and
    estimated duration.
-   [ ] Returns infeasible status when constraints cannot be satisfied.
-   [ ] Includes deterministic sample request/response fixtures.
-   [ ] Express can call the service and handle timeout/unavailable
    states.
-   [ ] No route is presented as optimized if the solver did not return
    a valid solution.

## MC-023 --- Implement delivery stop ordering and LIFO loading sequence

**Priority:** P0\
**Type:** Backend + frontend

### Description

For the initial single-origin, multi-drop model, generate a reverse-stop
loading sequence to reduce reshuffling.

### Acceptance criteria

-   [ ] Shipments are grouped by destination stop.
-   [ ] Furthest/later drop zone is loaded earlier.
-   [ ] Earliest drop zone is positioned for first access.
-   [ ] Loading sequence is displayed in the driver manifest.
-   [ ] Loading plan is consistent with route stop order.
-   [ ] Special handling and non-stackable cargo constraints are
    represented.
-   [ ] Any manual override is recorded.

## MC-024 --- Build 2D truck-bed visualizer

**Priority:** P0\
**Type:** Frontend

### Description

Create an interactive top-down truck-bed diagram showing cargo zones and
approximate cargo placement. Use SVG or Canvas; do not introduce a 3D
engine.

### Acceptance criteria

-   [ ] Truck-bed dimensions are configurable per vehicle.
-   [ ] Cargo is represented using dimensions and destination zone.
-   [ ] Zones use consistent colors: B = green, C = yellow, D = red (or
    clearly labelled equivalent).
-   [ ] Loading sequence is visible.
-   [ ] Layout flags overflow or unplaced cargo.
-   [ ] Cargo can be selected to view shipment reference and
    destination.
-   [ ] Visualizer labels itself as a planning aid, not a certified
    loading safety system.
-   [ ] Weight distribution and axle safety are not claimed as validated
    unless explicitly modelled.

## MC-025 --- Implement backhaul matching and early turnaround decision

**Priority:** P1\
**Type:** Backend

### Description

Match confirmed return shipments against available vehicle return
capacity and compare repositioning cost with return-load contribution.

### Acceptance criteria

-   [ ] Backhaul requests have origin, destination, slot, cargo and
    capacity requirements.
-   [ ] Only confirmed/eligible requests count as revenue.
-   [ ] Engine calculates additional repositioning distance and cost.
-   [ ] Backhaul is selected only when operational constraints and
    contribution rules pass.
-   [ ] If no viable backhaul exists, early turnaround can be proposed.
-   [ ] Tier 1 minimum guarantee remains included in trip economics.
-   [ ] Backhaul assignment does not conflict with the driver's schedule
    or next commitment.

------------------------------------------------------------------------

# 7. Driver execution and recipient tracking

## MC-026 --- Build driver PWA trip experience

**Priority:** P0\
**Type:** Frontend

### Description

Build a mobile-first driver experience for assigned trips.

### Acceptance criteria

-   [ ] Driver sees assigned and upcoming trips.
-   [ ] Driver sees pickup and delivery stop sequence.
-   [ ] Driver sees shipment references, cargo details and handling
    notes.
-   [ ] Driver can start, pause (with reason) and complete trip.
-   [ ] Driver can navigate to a stop using an external maps link.
-   [ ] Driver can report vehicle breakdown, delay and other exceptions.
-   [ ] UI works at common mobile screen sizes.
-   [ ] Driver cannot access another driver's trip.

## MC-027 --- Implement shipment QR generation and scanning

**Priority:** P0\
**Type:** Backend + driver UI

### Description

Generate a unique QR code for each shipment and verify pickup/loading
against the trip manifest.

### Acceptance criteria

-   [ ] Each shipment has a unique, non-guessable QR identifier.
-   [ ] QR does not expose sensitive personal information.
-   [ ] Driver scans QR to verify shipment belongs to the assigned trip.
-   [ ] Duplicate scans are idempotent.
-   [ ] Wrong-trip shipment scans are rejected.
-   [ ] Pickup event records driver, trip, timestamp and location where
    available.
-   [ ] Scan works in the supported mobile browser environment.

## MC-028 --- Implement trip status and delivery events

**Priority:** P0\
**Type:** Backend + driver UI

### Description

Track actual trip execution separately from the planned route.

### Acceptance criteria

-   [ ] Trip states are validated and transition in an allowed order.
-   [ ] Shipment states include pickup, in-transit, at-destination,
    delivered, failed and returned/rescheduled as applicable.
-   [ ] Each event stores timestamp, actor and relevant metadata.
-   [ ] Planned route is preserved separately from actual events.
-   [ ] Repeated client requests do not create duplicate events.
-   [ ] Shipper tracking view updates as events arrive.

## MC-029 --- Implement recipient public tracking page

**Priority:** P0\
**Type:** Frontend + backend

### Description

Provide a public tracking page accessible from a secure tokenized link.
Recipient does not need an account.

### Acceptance criteria

-   [ ] Tracking token is cryptographically random and unguessable.
-   [ ] Public API returns only fields safe for recipient visibility.
-   [ ] Recipient can see shipment status and estimated arrival window.
-   [ ] Recipient does not see other shippers' shipments or unrelated
    cargo.
-   [ ] Driver's personal phone number and continuous precise location
    are not exposed.
-   [ ] Token can be revoked or expired according to policy.
-   [ ] Page supports mobile browsers.

## MC-030 --- Implement delivery OTP and photo proof

**Priority:** P0\
**Type:** Backend + driver UI

### Description

Capture recipient confirmation and proof of delivery.

### Acceptance criteria

-   [ ] OTP is generated for the shipment/recipient delivery attempt.
-   [ ] OTP has expiry and attempt limits.
-   [ ] Driver submits OTP to confirm delivery.
-   [ ] Alternative confirmation path can be configured for B2B
    warehouse/shop recipients where OTP is impractical.
-   [ ] Photo evidence can be uploaded.
-   [ ] Delivery event stores timestamp, actor and location where
    available.
-   [ ] Photo URL/access is protected and not publicly enumerable.
-   [ ] Failed verification does not mark shipment delivered.

## MC-031 --- Implement notifications

**Priority:** P1\
**Type:** Backend + integration

### Description

Notify shipper and recipient at important booking and delivery
milestones.

### Events

-   Booking confirmed.
-   Token payment successful.
-   Pool cutoff approaching.
-   Pool locked and final price confirmed.
-   Vehicle/trip assigned.
-   Shipment picked up.
-   Shipment in transit.
-   Driver approaching.
-   Delivery completed or failed.
-   Rollover/refund decision required.

### Acceptance criteria

-   [ ] Notification templates are configurable.
-   [ ] Notification provider is abstracted.
-   [ ] Development can use a console/mock provider.
-   [ ] Recipient gets a tracking link.
-   [ ] Notification failures do not corrupt shipment state.
-   [ ] Duplicate event delivery does not send uncontrolled duplicate
    notifications.
-   [ ] SMS/WhatsApp integrations are clearly marked as unavailable when
    not configured.

## MC-032 --- Implement offline-first driver actions

**Priority:** P1\
**Type:** Frontend + backend

### Description

Allow drivers to continue basic trip execution during poor network
connectivity.

### Acceptance criteria

-   [ ] Assigned trip and manifest can be cached before departure.
-   [ ] Driver can record supported status events offline.
-   [ ] Offline events are stored in IndexedDB.
-   [ ] Events sync when connectivity returns.
-   [ ] Sync uses idempotency keys.
-   [ ] Conflicts are surfaced rather than silently overwritten.
-   [ ] UI shows pending/synced/failed synchronization state.
-   [ ] QR verification and OTP delivery confirmation clearly indicate
    when online verification is required.
-   [ ] Location tracking is limited to active trips and disclosed to
    the driver.

------------------------------------------------------------------------

# 8. Financial operations and analytics

## MC-033 --- Implement pickup balance and collection records

**Priority:** P0\
**Type:** Backend + driver UI

### Description

Record remaining freight payment at pickup after final price lock.

### Acceptance criteria

-   [ ] Remaining balance equals locked price minus successful token
    payment and valid adjustments.
-   [ ] Driver can initiate/record collection at pickup.
-   [ ] Payment method and provider reference are stored.
-   [ ] Collection state is distinct from customer payment settlement.
-   [ ] Duplicate collection requests are idempotent.
-   [ ] Simulated collections are visibly labelled as simulated.

## MC-034 --- Implement trip economics ledger

**Priority:** P0\
**Type:** Backend + shipper UI (appropriate summaries)

### Description

Calculate trip-level economics from recorded/configured values.

### Metrics

-   Outbound shipment revenue.
-   Backhaul revenue.
-   Vehicle payout / minimum guarantee.
-   Fuel and toll estimate or actual.
-   Hub/handling cost.
-   Payment and operating fees.
-   Refunds/subsidies.
-   Platform contribution.

### Acceptance criteria

-   [ ] Every cost/revenue line has source and status (estimated or
    actual).
-   [ ] Minimum Guarantee is included in the economics.
-   [ ] Unconfirmed backhaul revenue is excluded.
-   [ ] Platform contribution is calculated consistently.
-   [ ] Shipper sees only their own shipment charges and relevant
    savings estimate.
-   [ ] Internal platform economics are not exposed to unrelated
    shippers.
-   [ ] Demo figures are labelled illustrative.

## MC-035 --- Build shipper shipment dashboard and history

**Priority:** P1\
**Type:** Frontend

### Description

Provide a simple overview of a shipper's bookings and shipments.

### Acceptance criteria

-   [ ] Show upcoming, active, delivered, failed, cancelled and
    rolled-over shipments.
-   [ ] Filter by corridor, date and status.
-   [ ] Show shipment price breakdown and payment state.
-   [ ] Provide tracking links.
-   [ ] Provide shipment detail and proof-of-delivery summary.
-   [ ] Export shipment history to CSV.

## MC-036 --- Build operational impact and utilization metrics

**Priority:** P1\
**Type:** Backend + frontend

### Description

Display trip and platform metrics based on real calculation inputs.

### Metrics

-   Vehicle weight utilization.
-   Vehicle volume utilization.
-   Distance travelled.
-   Empty distance.
-   Cost per successful shipment.
-   On-time delivery rate.
-   Failed delivery rate.
-   Pool fill level.
-   Estimated savings against a clearly defined baseline.
-   Estimated CO₂ impact only if an explicit emissions factor and
    calculation methodology are configured.

### Acceptance criteria

-   [ ] Weight and volume utilization are separate.
-   [ ] Baseline methodology is visible.
-   [ ] Estimated values are labelled estimated.
-   [ ] No hardcoded 35--50% saving claim is presented as measured fact.
-   [ ] Metrics can be traced to trips and shipment records.

------------------------------------------------------------------------

# 9. Exceptions, safety and reliability

## MC-037 --- Implement exception handling

**Priority:** P0\
**Type:** Backend + driver/shipper UI

### Description

Handle real-world disruptions without losing shipment accountability.

### Cases

-   Customer unavailable.
-   Incorrect address.
-   Vehicle breakdown.
-   Road blocked.
-   Shipment damaged.
-   Recipient refuses shipment.
-   Driver unavailable.
-   Partial delivery.
-   Pickup failure.
-   Route infeasibility.

### Acceptance criteria

-   [ ] Driver can report an exception with reason and optional
    evidence.
-   [ ] Shipment is not silently marked delivered or discarded.
-   [ ] Relevant shipper is notified.
-   [ ] Reschedule, return or reallocation options are represented as
    explicit state transitions.
-   [ ] Vehicle breakdown can trigger reassignment of remaining
    shipments where feasible.
-   [ ] Any changed route is recalculated and recorded.
-   [ ] Every exception has a timestamp and actor.

## MC-038 --- Implement access control and data privacy safeguards

**Priority:** P0\
**Type:** Backend

### Acceptance criteria

-   [ ] All shipper data queries enforce business ownership.
-   [ ] Public tracking endpoints return minimal fields.
-   [ ] Tracking tokens are not sequential IDs.
-   [ ] Driver location is shared only during active assigned trips and
    according to disclosed policy.
-   [ ] Payment references and personal data are not exposed in logs.
-   [ ] Uploads validate file type and size.
-   [ ] Secrets are stored in environment variables.
-   [ ] Rate limits protect login, OTP and public tracking endpoints.

------------------------------------------------------------------------

# 10. Demo data, testing and delivery

## MC-039 --- Create end-to-end demo scenario

**Priority:** P0\
**Type:** Demo / seed data

### Description

Create a deterministic demonstration of the core MeeCargo value
proposition.

### Scenario

-   One fixed corridor with several ordered stops.
-   Two or three shipper businesses.
-   Multiple shipments with different weights, dimensions and
    destinations.
-   Tier 1 attached vehicle and at least one Tier 2 alternative.
-   One return/backhaul request.
-   One driver and recipient tracking links.

### Acceptance criteria

-   [ ] Demo can be reset and replayed.
-   [ ] Adding shippers visibly changes pool utilization and projected
    price.
-   [ ] Cutoff locks the pool and final pricing.
-   [ ] Vehicle allocation uses actual capacity and configured policy.
-   [ ] Route optimization returns a valid stop order.
-   [ ] Truck-bed visualizer shows destination zones.
-   [ ] Driver can scan/verify pickup and update trip.
-   [ ] Recipient tracking page reflects trip progress.
-   [ ] Trip economics are calculated from demo inputs.
-   [ ] No demo metric is presented as real-world measured performance.

## MC-040 --- Add core automated tests

**Priority:** P0\
**Type:** Testing

### Acceptance criteria

-   [ ] Unit tests for chargeable-weight calculation.
-   [ ] Unit tests for pricing tiers and anchor discount.
-   [ ] Tests for price ceiling and paise rounding.
-   [ ] Tests for pool capacity and concurrent booking protection.
-   [ ] Tests for cutoff locking idempotency.
-   [ ] Tests for vehicle weight/volume feasibility.
-   [ ] Tests for low-utilization rollover/refund.
-   [ ] Tests for role and business data isolation.
-   [ ] Tests for trip and shipment state transitions.
-   [ ] Tests for duplicate QR scans/payment callbacks.
-   [ ] Integration test for Express-to-optimizer request/response.
-   [ ] One end-to-end test covering booking to recipient tracking.

## MC-041 --- Prepare local run and demo documentation

**Priority:** P0\
**Type:** Documentation

### Acceptance criteria

-   [ ] README lists prerequisites and environment variables.
-   [ ] MongoDB setup and seed instructions are documented.
-   [ ] Frontend, backend and optimizer run commands are documented.
-   [ ] Demo accounts and scenario reset instructions are documented.
-   [ ] External services that are mocked/simulated are explicitly
    listed.
-   [ ] Known limitations are documented.
-   [ ] No unsupported claims about real payment, routing, city-entry or
    emissions integrations.

------------------------------------------------------------------------

# 11. Suggested implementation order

Build in dependency order. Do not attempt all features in parallel
before the core data and state transitions exist.

    Order Tickets            Deliverable
  ------- ------------------ -----------------------------------------
        1 MC-001 to MC-003   Runnable app, MongoDB, role-based shell
        2 MC-004 to MC-006   Shipper and driver identity
        3 MC-007 to MC-011   Corridor and shipment booking
        4 MC-012 to MC-017   Pooling, pricing and cutoff
        5 MC-018 to MC-020   Fleet and automated allocation
        6 MC-021 to MC-025   Routing, loading and backhaul
        7 MC-026 to MC-032   Driver execution and recipient tracking
        8 MC-033 to MC-036   Payments, economics and analytics
        9 MC-037 to MC-038   Exceptions and safeguards
       10 MC-039 to MC-041   Demo, tests and documentation

------------------------------------------------------------------------

# 12. Antigravity execution instructions

Use these instructions when implementing the tickets:

1.  **Inspect before changing:** Review the existing project and
    preserve working code. Do not replace existing implementation
    without a reason.
2.  **Implement incrementally:** Complete a small, coherent group of
    tickets at a time.
3.  **Respect the agreed stack:** React/Vite/TypeScript,
    Express/TypeScript, MongoDB/Mongoose, Python/FastAPI/OR-Tools. Do
    not introduce a different database or framework without asking.
4.  **No dispatcher:** Do not create dispatcher accounts, dispatcher
    roles, dispatcher routes or dispatcher UI.
5.  **Automate operations:** Pooling, cutoff, pricing, vehicle
    allocation and trip generation should be backend-driven.
6.  **No fake optimization:** Use OR-Tools and a road-distance matrix or
    deterministic fixtures. Do not hardcode an allegedly optimized
    route.
7.  **No fake financial claims:** Use explicit inputs and formulas.
    Label estimates and simulations.
8.  **Keep the prototype lean:** Avoid microservices, Kubernetes, Kafka,
    complex event infrastructure and premature abstractions.
9.  **Validate important transitions:** Payment, pool locking, vehicle
    assignment, pickup and delivery must be idempotent and validated.
10. **Preserve traceability:** Record who performed an action and when.
11. **Build usable interfaces:** Include loading, empty, error, success
    and mobile-responsive states.
12. **Update this backlog:** Mark a ticket complete only after its
    acceptance criteria are met. Record blocked items and known
    limitations.
13. **Run checks:** Run relevant TypeScript checks, tests and
    application builds after each implementation group.
14. **Ask before scope changes:** Do not silently add major product
    features or change the operating model.

## Definition of Done

A ticket is complete only when: - Its acceptance criteria are
implemented. - Relevant validation and error states exist. - The
affected UI/API works with the agreed data model. - Relevant tests or a
repeatable manual verification are available. - No unrelated feature or
role has been introduced. - Known limitations are recorded.

------------------------------------------------------------------------

**Product principle:** MeeCargo should make shared freight booking,
pooling, pricing and delivery execution simple for small businesses. The
backend should coordinate the logistics automatically; shippers and
drivers should not need a dispatcher to operate the normal workflow.
