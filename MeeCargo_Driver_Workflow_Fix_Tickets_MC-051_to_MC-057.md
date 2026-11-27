# MeeCargo — Driver Workflow Fix Tickets

**Ticket range:** MC-051 to MC-057  
**Purpose:** Correct the driver-facing Pooling Windows and Assigned Trips workflows against MeeCargo's agreed operating model.  
**Implementation guidance:** Inspect the existing implementation and data model before changing anything. Extend existing flows; do not rebuild unrelated modules.

---

## Non-negotiable business rules

1. MeeCargo has exactly **one Platform Owner** for the entire platform.
2. MeeCargo does not own or purchase vehicles. Tier 1 drivers bring their own vehicles; the Platform Owner records and maintains their vehicle details and specifications.
3. Tier 1 contracts define corridor eligibility. They do **not** permanently assign drivers to pickup slots.
4. The Platform Owner configures corridor-level pickup and return slot templates.
5. When a pooling window opens, eligible drivers choose the slot(s) they are available to serve and, for flexible-return slots, choose one permitted return option.
6. A driver's slot selection is an availability commitment. It is not a guarantee that the driver will receive a trip.
7. Once the pooling window closes, the backend validates commitments and automatically pools shipments, allocates eligible drivers/driver-owned vehicles, right-sizes capacity and generates trips/routes.
8. A Tier 1 trip may only be assigned to a driver whose valid, locked commitment matches that trip's corridor, slot and service date.
9. Driver trip routing and allocation stay automated. There is no dispatcher role, dispatcher dashboard or manual dispatcher workflow.
10. Tier 2 and Tier 3 marketplace drivers remain independent and their existing workflows must not be unintentionally changed.
11. Locked pooling windows and trips use immutable schedule/slot snapshots. Later corridor-template edits must not silently rewrite existing commitments or trips.
12. Do not represent simulated payments, collection records, route plans or load diagrams as verified real-world payment, navigation or certified load-safety systems.

## Priority and dependency overview

| Ticket | Priority | Main outcome | Depends on |
|---|---|---|---|
| MC-051 | Critical | Enforce commitment-to-trip allocation consistency | Existing pooling and allocation flows |
| MC-052 | High | Prevent overlapping driver slot commitments | MC-051; slot commitment data |
| MC-053 | High | Correct Assigned Trips lifecycle and actions | MC-051 |
| MC-054 | High | Show locked trip schedule and complete return plan | MC-051; corridor schedule snapshots |
| MC-055 | Medium | Render actual shipment placement using the registered vehicle dimensions | Driver vehicle specs; trip manifest |
| MC-056 | High | Complete pickup, collection and delivery-proof workflow | Trip manifest; QR; payment/proof integrations |
| MC-057 | Medium | Make route execution backend-controlled and exception-driven | Automated route generation |

---

# MC-051 — Enforce Slot Commitment to Trip Allocation Consistency

**Priority:** Critical  
**Area:** Backend pooling, allocation engine, trip generation, driver authorization

### Problem

The driver Pooling Windows screen shows a committed Slot 1 selection for the operating date **29 November 2026**, while Slot 2 is still open for selection. The Assigned Trips screen simultaneously shows a trip for the same corridor and date with a planned departure of **12:30 PM**, which corresponds to Slot 2.

A Tier 1 driver must never receive a trip for a slot they did not commit to. This is a backend correctness issue, not merely a UI display issue.

### Requirements

1. Treat a valid, locked driver slot commitment as the source of eligibility for Tier 1 trip allocation.
2. Every generated Tier 1 trip must reference the exact source commitment/slot-window record.
3. Validate that the following values match between trip and commitment:
   - driver ID;
   - corridor ID;
   - corridor slot/template ID;
   - pooling-window instance ID;
   - service date;
   - selected return option or locked return time;
   - eligible driver-owned vehicle, where the vehicle is snapshotted for the trip.
4. Allocation must only consider commitments that are valid, locked and eligible at the time of allocation.
5. A commitment is not itself a guaranteed trip. Multiple drivers may commit to a slot; the backend selects eligible driver/vehicle capacity according to existing Tier 1 allocation, capacity and minimum-guarantee rules.
6. Drivers who committed but were not selected must receive a clear `NOT_ALLOCATED` outcome for that pooling-window instance. Do not create a trip for them.
7. Do not generate a trip from an open, withdrawn, expired, invalid or uncommitted slot selection.
8. Make allocation idempotent. Re-running a pooling-window closure or retrying a job must not create duplicate trips or allocate the same driver/vehicle to conflicting trips.
9. Reject or quarantine inconsistent legacy records rather than silently displaying them as valid assignments.
10. Keep Tier 2/Tier 3 allocation paths separate unless they already use a compatible shared contract. Do not force marketplace drivers into Tier 1 commitment rules.

### Data and integrity expectations

- Add/retain a stable reference from a Tier 1 trip to its source locked commitment or pooling-window participation record.
- Snapshot the service date, corridor slot, pickup time, selected/locked return time and vehicle identity/specifications on the trip when it is generated.
- Enforce uniqueness/idempotency for the appropriate allocation key, such as one allocation per selected driver commitment and allocation run, according to the existing domain model.
- Validate ownership and driver identity server-side. Never trust a `driverId`, `commitmentId` or `vehicleId` supplied by the client without authorization checks.

### Acceptance criteria

- A driver committed only to Slot 1 cannot receive a Slot 2 trip.
- A driver with no valid locked commitment cannot receive a Tier 1 trip for that pooling window.
- A generated trip references the exact locked commitment from which it was allocated.
- Trip corridor, service date, pickup time and return schedule match the commitment snapshot.
- A driver whose commitment was not selected sees `NOT_ALLOCATED`, not an unrelated trip.
- Retrying allocation does not create duplicate trips or conflicting assignments.
- Existing locked trips remain unchanged when corridor templates are edited later.
- Automated tests cover valid allocation, wrong-slot allocation, wrong-date allocation, wrong-corridor allocation, withdrawn commitment, open commitment, duplicate allocation and unauthorized reference substitution.

---

# MC-052 — Prevent Overlapping Driver Slot Commitments

**Priority:** High  
**Area:** Driver Pooling Windows, commitment validation, availability engine

### Problem

The Pooling Windows screen can show one slot committed and another slot open even when their operating intervals overlap. For example, a 09:00 outbound with a 14:00 return overlaps a 12:30 outbound with a 16:30 return.

The same driver must not commit to operationally incompatible slots, including across different corridors.

### Requirements

1. Validate a proposed commitment against all existing commitments and trips for that driver on the relevant dates.
2. Calculate the operational interval using the corridor's pickup time, the selected or locked return schedule, configured expected journey/operating duration and a configurable turnaround buffer.
3. Include commitments from other corridors, not just the corridor currently being viewed.
4. Include already allocated trips and trips in progress.
5. For flexible-return Slot 1, validate the specific return option selected by the driver. A different return option may produce a different conflict result.
6. For mandatory-return Slot 2, use the backend-enforced locked return time; do not accept a client-supplied alternative.
7. Apply the same validation when creating, updating or withdrawing a commitment. Revalidate at the server when the driver submits the action.
8. Allow the Platform Owner to configure relevant operational buffers/durations through the existing corridor/operations configuration where supported; do not invent a universal fixed buffer in the UI.
9. If duration data is unavailable, fail safely or apply an explicitly configured conservative rule. Do not assume the driver can complete two overlapping trips.

### UI requirements

- Disable or reject conflicting slots with a concise reason, such as: “Conflicts with your committed Slot 1 (09:00–14:00) on this date.”
- Revalidate when the driver changes the flexible return option.
- Do not display a slot as selectable merely because it is open to other drivers; show driver-specific eligibility separately.
- Clearly distinguish `OPEN FOR SELECTION` from `UNAVAILABLE — SCHEDULE CONFLICT`.

### Acceptance criteria

- The same driver cannot commit to overlapping Slot 1 and Slot 2 intervals.
- Conflicts are detected across corridors and operating dates where intervals cross midnight.
- A flexible return option that conflicts is disabled/rejected while a non-conflicting permitted option remains selectable, where applicable.
- Backend validation cannot be bypassed by direct API requests.
- Existing allocated/in-progress trips prevent conflicting commitments.
- Tests cover exact boundary times, turnaround buffers, cross-corridor conflicts, overnight intervals, changed return options and race conditions from simultaneous requests.

---

# MC-053 — Correct Assigned Trips Lifecycle and Driver Actions

**Priority:** High  
**Area:** Driver PWA, trip state machine, exception handling

### Problem

The Assigned Trips card currently displays `Accept Trip`, `Decline` and `Start Trip` together. This creates an unnecessary second acceptance step after the driver has already committed availability during the pooling window, and it may allow a trip to be started in an invalid state.

### Requirements

1. Remove the routine `Accept Trip` and `Decline` actions from the normal Tier 1 flow. A slot commitment is the driver's availability commitment; the allocation engine uses it to generate the trip.
2. Display the assigned trip as an allocation outcome linked to the driver's locked commitment.
3. Before trip start, provide a clear trip summary and a `Report Issue / Cannot Operate` action for genuine exceptions (vehicle breakdown, driver emergency, incorrect vehicle details, unsafe conditions, etc.).
4. Reporting an issue must create an exception and trigger the defined automated reassessment/reallocation workflow. It must not directly assign a replacement driver from the UI.
5. Make `Start Trip` available only when:
   - trip is assigned to the authenticated driver;
   - trip is in the correct pre-start state;
   - the service date/time is valid under the configured start window;
   - the linked vehicle remains active and eligible;
   - required pre-trip checks are complete, where implemented;
   - the trip has not been cancelled or superseded.
6. Once started, show in-progress actions appropriate to the current stop and trip state.
7. Completed/cancelled trips become read-only except for permitted proof/history views.
8. Ensure all trip state transitions are validated by the backend; frontend button visibility is not a security or integrity control.

### Suggested driver-facing action mapping

| Trip state | Driver-facing actions |
|---|---|
| ASSIGNED / READY_TO_START | View Trip, Report Issue, Start Trip when start conditions are met |
| IN_PROGRESS | Navigate to Current Stop, Scan/Verify Shipment, Update Stop, Report Exception |
| COMPLETED | View Summary, View Proof |
| CANCELLED / SUPERSEDED | View Outcome |

Do not add a dispatcher role or manual dispatcher approval flow. If the existing state machine uses different names, map these behaviors to existing states rather than creating duplicate state concepts.

### Acceptance criteria

- `Accept Trip` and `Decline` are not shown as routine actions for Tier 1 allocated trips.
- A driver cannot start a trip assigned to another driver.
- A driver cannot start a cancelled, completed, superseded or otherwise invalid trip.
- A driver can report a legitimate pre-start issue; the backend records it and invokes the automated exception path.
- An issue does not silently change the driver, vehicle, commitment or trip manifest.
- UI actions match the trip's current state and are tested across refresh/offline/reconnect scenarios.

---

# MC-054 — Display Locked Trip Schedule and Complete Return Plan

**Priority:** High  
**Area:** Driver PWA, trip detail, return/backhaul display

### Problem

The Assigned Trips card currently shows only a planned departure time. It does not clearly identify the selected corridor slot or show the return schedule. The `Return Plan` section is blank even though the corridor slot has a configured return time.

### Requirements

1. Display the source corridor slot on every Tier 1 trip.
2. Display the locked trip schedule snapshot:
   - operating/service date;
   - slot number/name;
   - outbound pickup time;
   - selected return time for flexible-return slots;
   - enforced return time for mandatory-return slots.
3. Read schedule details from the locked trip/commitment snapshot, not from the current live corridor template.
4. Display a return plan generated by the backend, including:
   - scheduled return time;
   - return route/stops, if configured;
   - return/backhaul shipment count and manifest when available;
   - required pickup/drop actions;
   - empty-return status when no return cargo is allocated.
5. If no return cargo exists, show an explicit state such as `Scheduled empty return`; do not leave the section blank.
6. Distinguish a configured return schedule from an estimated arrival time. Do not present a planned return time as a guaranteed ETA.
7. If a return plan is pending, unavailable or changed due to an approved exception, show the correct state and last-updated information.
8. Do not modify an already locked return schedule when the Platform Owner edits a future corridor template.

### Acceptance criteria

- Slot 1 trip shows the specific return option selected by the driver and locked for that trip.
- Slot 2 trip shows the mandatory locked return time from its snapshot.
- Return plan displays backhaul stops/shipments when allocated.
- Empty return is explicitly shown when there are no return shipments.
- No return-plan data produces an intentional empty/pending state rather than a blank panel.
- Editing a corridor template does not change the schedule shown on an existing locked trip.
- Tests cover flexible return, mandatory return, backhaul available, empty return and updated future corridor templates.

---

# MC-055 — Render Truck-Bed Loading Plan from Actual Vehicle and Shipment Data

**Priority:** Medium  
**Area:** Driver PWA, loading visualization, manifest/capacity validation

### Problem

The truck-bed visualizer currently renders an empty fixed-size `425 × 195 cm` area. It does not show the actual shipment placements and appears to assume a single vehicle size. This does not provide the driver with the intended destination-based loading guidance.

### Requirements

1. Use the active driver-owned vehicle's registered internal cargo-bed/floor dimensions. Do not use one hardcoded bed size for every vehicle.
2. Use the trip's locked manifest and actual cargo dimensions/quantities to produce the loading layout.
3. Show cargo groups by delivery destination, following the agreed reverse-stop/LIFO loading logic:
   - farthest delivery loaded first;
   - nearest delivery loaded last;
   - nearest delivery is accessible for first unloading.
4. For the Vadodara → Anand → Nadiad → Ahmedabad example, the illustrative loading order is Ahmedabad first, Nadiad second, Anand last; unloading is Anand → Nadiad → Ahmedabad.
5. Display shipment/cargo labels, destination, quantity and dimensions where useful. Provide a legend that maps colors/zones to stops.
6. Validate fit constraints independently where data is available:
   - payload weight;
   - total cargo volume;
   - floor area and individual item footprint;
   - item dimensions and vehicle internal dimensions;
   - stackability/orientation restrictions;
   - access to cargo at each unloading stop.
7. Do not imply that a 2D placement heuristic proves axle-load distribution, tie-down safety, vehicle stability or certified load safety.
8. Retain a clear safety disclaimer. If a required vehicle or cargo dimension is missing, show `Loading layout unavailable — dimensions missing` with the missing data instead of rendering an empty misleading diagram.
9. Keep the loading plan linked to the trip's manifest snapshot. Manifest changes must trigger a controlled plan refresh and be recorded.
10. The plan is guidance for loading; shipper/receiver personnel perform loading/unloading as agreed. The driver verifies the manifest and may report unsafe or incorrect loading; do not silently make the driver a replacement loading crew.

### Acceptance criteria

- A valid trip with dimensioned cargo shows cargo placements rather than an empty rectangle.
- Different vehicle sizes produce correctly scaled bed layouts.
- The farthest-stop cargo is loaded first and nearest-stop cargo last in the prescribed plan.
- The UI clearly communicates unloading sequence and destination zones.
- Capacity overages are surfaced instead of drawing an apparently valid layout.
- Missing dimensions produce an explicit unavailable state.
- The disclaimer remains visible and does not claim certified safety validation.
- Tests cover multiple stops, multiple shipments per stop, vehicle-size variation, oversize cargo, overweight cargo, missing dimensions and manifest updates.

---

# MC-056 — Complete Pickup Collection and Delivery Proof Workflow

**Priority:** High  
**Area:** Driver PWA, QR scanning, collection records, recipient verification, offline sync

### Problem

The trip card shows a pickup balance and a collection action, but the complete pickup-to-delivery sequence is not sufficiently represented. Delivery OTP and photo proof should be part of the stop workflow.

### Requirements

1. At pickup, the driver scans the shipment QR and the backend verifies:
   - shipment belongs to the assigned trip/manifest;
   - shipment is expected at the current pickup stop;
   - shipment has not already been collected or cancelled;
   - shipment/QR identity is valid.
2. Display verified shipment details before confirming pickup.
3. Record pickup confirmation, timestamp, driver, trip, shipment and available proof (where required).
4. If a pickup balance is due, show the amount and supported collection method.
5. Record collection as a distinct financial event. Do not conflate customer collection with MeeCargo settlement, driver payout or platform revenue.
6. Clearly label simulated payment methods/records in demo mode. Do not claim that a simulated UPI collection is a real payment.
7. At delivery, verify the shipment is due at the current stop and require recipient OTP verification according to the configured delivery policy.
8. Capture photo proof where required, with consent and appropriate privacy handling.
9. Record delivery outcome, timestamp, driver, recipient verification result and proof references.
10. Support documented exception outcomes such as recipient unavailable, refused delivery, damaged package or incorrect destination. Do not mark these as successfully delivered.
11. Support offline driver operation using the existing local persistence approach. Queue signed/identifiable events locally and synchronize safely when connectivity returns.
12. Make event submission idempotent to prevent duplicate pickup, collection or delivery records after retries.
13. Secure tracking links and proof assets. Recipients must not gain access to unrelated shipments or precise driver location beyond the existing policy.

### Acceptance criteria

- An invalid, duplicate or wrong-stop QR cannot mark a shipment as picked up.
- Pickup status is recorded against the correct trip and shipment.
- Collection records are separate from settlement/payout records.
- Simulated payment is visibly identified as simulated.
- Successful delivery requires the configured OTP verification and proof steps.
- Failed delivery attempts are recorded as exceptions, not successful deliveries.
- Offline events synchronize without duplicates when connectivity returns.
- Recipient tracking reflects verified shipment events.
- Tests cover invalid QR, duplicate scan, wrong stop, collection due/not due, simulated payment, correct/incorrect OTP, photo proof, failed delivery and offline retry.

---

# MC-057 — Backend-Controlled Route Execution and Route Exception Handling

**Priority:** Medium  
**Area:** Driver PWA, routing service, trip/stop state, exception workflow

### Problem

The Assigned Trips screen exposes an `Optimize & Plan` action to the driver. Official route generation and trip planning are backend responsibilities. Drivers should execute the locked route and report problems, not independently regenerate the official trip plan.

### Requirements

1. Remove the driver-facing `Optimize & Plan` action for official trip planning.
2. Display the route generated and locked by the backend for the trip.
3. Provide navigation to the current stop using the configured navigation integration, without changing the official manifest/order.
4. Provide a `Report Route Issue` action for road closure, access restriction, unsafe road, vehicle restriction, delay or incorrect stop information.
5. Route issues must be recorded with trip, stop, driver, timestamp, reason and optional evidence/location where permitted.
6. The backend evaluates whether rerouting is required and produces an updated official route/stop sequence when appropriate.
7. Preserve the existing shipment manifest and delivery commitments during rerouting. If stop order or delivery feasibility changes, apply the defined exception policy and notify affected parties.
8. Keep route versions/audit history so the driver can distinguish the current approved route from a superseded route.
9. Do not expose precise driver location publicly. Continue the existing rule that location tracking is active only during an in-progress trip and is not exposed publicly to recipients.
10. If navigation integration is unavailable, keep the official stop sequence visible and show a clear navigation-unavailable state.

### UI changes

Replace `Optimize & Plan` with:
- `View Route Plan` — displays the official locked route and stops.
- `Navigate to Current Stop` — opens navigation for the current assigned stop.
- `Report Route Issue` — submits an exception for backend review/replanning.

### Acceptance criteria

- Drivers cannot mutate the official route/manifest through a client-side optimization action.
- The driver sees the current backend-approved route and ordered stops.
- Navigation opens the current stop, not an arbitrary stop selected outside the trip workflow.
- Route issues are recorded and handled through the backend exception/replanning flow.
- Updated routes are versioned and communicated to the driver.
- Recipient tracking does not expose public precise driver location.
- Tests cover normal navigation, unavailable navigation, issue reporting, reroute versioning and stop/manifest consistency.

---

## Cross-ticket regression requirements

After implementing the tickets, run end-to-end regression tests for these journeys:

### Journey A — Valid Slot 1 allocation
1. Tier 1 driver has an active contract eligible for the corridor.
2. Driver has an active driver-owned vehicle with valid specifications.
3. Pooling window opens for the service date.
4. Driver commits to Slot 1 and selects one permitted return option.
5. Window closes.
6. Backend validates and allocates the driver only if selected by the allocation engine.
7. Generated trip references the exact locked Slot 1 commitment and selected return time.
8. Assigned Trips displays the same corridor, service date, pickup time and return time.

### Journey B — Slot 2 without commitment
1. Driver commits to Slot 1 only.
2. Slot 2 remains open or is not selected by that driver.
3. Allocation runs.
4. Backend must not assign a Slot 2 trip to that driver.
5. Driver sees no Slot 2 trip and receives the correct outcome for their Slot 1 commitment.

### Journey C — Overlapping slots
1. Driver commits to Slot 1 with a return time that overlaps Slot 2.
2. Driver attempts to commit to Slot 2 on the same date.
3. Backend rejects the conflicting commitment and UI explains why.
4. The result is the same when the request is sent directly to the API.

### Journey D — Return plan and empty return
1. Driver receives a valid allocated trip.
2. Trip detail shows the locked return time from the trip snapshot.
3. If backhaul cargo exists, the return plan lists the allocated return stops/shipments.
4. If no backhaul cargo exists, the screen explicitly shows the scheduled empty return.

### Journey E — Trip execution
1. Driver opens the assigned trip and sees the official route and loading plan.
2. Driver scans a valid pickup QR and records pickup/collection as applicable.
3. Driver navigates through backend-approved stops.
4. Driver completes recipient verification and delivery proof.
5. Offline events, when applicable, synchronize without duplicate records.
6. Trip and recipient tracking show the correct final status.

## Definition of Done

- All acceptance criteria for the applicable ticket are met.
- Backend validation exists for every business-critical rule; UI-only validation is insufficient.
- Automated tests cover normal, invalid, boundary, duplicate-request and failure scenarios.
- Existing Shipper, Driver, Recipient, pooling, pricing, payment and tracking workflows pass regression tests.
- No dispatcher role, multiple Platform Owner accounts or MeeCargo-owned fleet assumptions are introduced.
- No existing locked trip or pooling-window snapshot is silently modified by future corridor changes.
- Any simulated payment, heuristic loading visualization or estimated timing is clearly labelled.
- Antigravity reports files/modules changed, schema/migration changes, tests executed and any remaining limitations.
