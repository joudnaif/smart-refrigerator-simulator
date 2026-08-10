---
name: Bigtable telemetry schema
description: Smart-fridge telemetry uses the existing Bigtable metrics column family.
---

The `smart-fridge/telemetry` table stores telemetry cells in the `metrics` column family, not `telemetry`.

**Why:** Bigtable rejects mutations for column families that do not exist.

**How to apply:** Keep telemetry reads and writes aligned to `metrics`; use timestamp-based unique row keys and sort newest packets by timestamp after reading.