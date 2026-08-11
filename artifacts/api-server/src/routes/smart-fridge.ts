import { Router, type IRouter } from "express";
import {
  AddInventoryItemBody,
  AddInventoryItemResponse,
  GetInventoryResponse,
  GetTelemetryQueryParams,
  GetTelemetryResponse,
  RemoveInventoryItemParams,
  RemoveInventoryItemResponse,
  ResetSystemResponse,
} from "@workspace/api-zod";
import {
  clearLiveInventory,
  clearLiveTelemetry,
  deleteLiveInventoryItem,
  getLiveGoogleClients,
  publishFridgeEvent,
  readLiveInventory,
  readLiveInventoryItem,
  readLiveTelemetry,
  type InventoryItem,
  type TelemetryPacket,
  writeLiveInventory,
  writeLiveTelemetry,
} from "../lib/smart-fridge-gcp";

const router: IRouter = Router();

const originalInventory: InventoryItem[] = [
  {
    id: "milk-001",
    name: "Whole Milk 1L",
    type: "packaged",
    barcode: "001234",
    detectionMethod: "Barcode scan",
    calories: 610,
    expirationDate: "2026-08-16",
    storageCondition: "Keep chilled",
    syncStatus: "Synced",
    shelf: "middle",
  },
  {
    id: "soup-002",
    name: "Canned Soup",
    type: "packaged",
    barcode: "005678",
    detectionMethod: "Barcode scan",
    calories: 240,
    expirationDate: "2027-02-08",
    storageCondition: "Cool & dry",
    syncStatus: "Synced",
    shelf: "lower",
  },
];

let inventory: InventoryItem[] = structuredClone(originalInventory);
let telemetry: TelemetryPacket[] = [];
let sequence = 0;

function createTelemetryPacket(): TelemetryPacket {
  sequence += 1;
  const phase = sequence % 8;
  const timestamp = new Date().toISOString();
  return {
    id: `telemetry-${Date.now()}-${sequence}`,
    timestamp,
    temperature: Number((3.4 + phase * 0.03).toFixed(2)),
    humidity: Number((84.2 + (phase % 4) * 0.4).toFixed(1)),
    ethylene: Number((0.018 + (phase % 5) * 0.001).toFixed(3)),
    source: "environmental-sensor-01",
  };
}

function appendTelemetry(): void {
  telemetry = [...telemetry, createTelemetryPacket()].slice(-40);
}

for (let index = 0; index < 12; index += 1) {
  appendTelemetry();
}

router.get("/bigtable/telemetry", (req, res): void => {
  const rawActive = Array.isArray(req.query.environmentalSensorActive)
    ? req.query.environmentalSensorActive[0]
    : req.query.environmentalSensorActive;
  const parsedQuery = GetTelemetryQueryParams.safeParse({
    environmentalSensorActive:
      rawActive === undefined ? false : rawActive === "true",
  });

  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  const environmentalSensorActive =
    parsedQuery.data.environmentalSensorActive;
  const live = getLiveGoogleClients();
  if (!live) {
    if (environmentalSensorActive) {
      appendTelemetry();
    }
    res.json(GetTelemetryResponse.parse(telemetry));
    return;
  }

  void (async () => {
    try {
      if (environmentalSensorActive) {
        const packet = createTelemetryPacket();
        await writeLiveTelemetry(live.table, packet);
        req.log.info(
          { telemetryId: packet.id },
          "Environmental telemetry written to Bigtable",
        );
      }
      const packets = await readLiveTelemetry(live.table);
      res.json(GetTelemetryResponse.parse(packets));
    } catch (error) {
      req.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Bigtable telemetry unavailable; using local stream",
      );
      if (live) {
        res.status(503).json({ error: "Bigtable telemetry unavailable" });
        return;
      }
      if (environmentalSensorActive) {
        appendTelemetry();
      }
      res.json(GetTelemetryResponse.parse(telemetry));
    }
  })();
});

router.get("/firestore/inventory", (req, res): void => {
  const live = getLiveGoogleClients();
  if (!live) {
    res.json(GetInventoryResponse.parse(inventory));
    return;
  }

  void (async () => {
    try {
      inventory = await readLiveInventory(live.firestore);
      res.json(GetInventoryResponse.parse(inventory));
    } catch (error) {
      req.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Firestore inventory unavailable; using local inventory",
      );
      res.json(GetInventoryResponse.parse(inventory));
    }
  })();
});

router.post("/firestore/add-item", (req, res): void => {
  const parsed = AddInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid inventory item");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const item: InventoryItem = {
    id: `item-${Date.now()}-${sequence}`,
    ...parsed.data,
    syncStatus: "Synced",
  };
  const live = getLiveGoogleClients();
  void (async () => {
    try {
      if (live) {
        await writeLiveInventory(live.firestore, item);
        inventory = await readLiveInventory(live.firestore);
        const messageId = await publishFridgeEvent("ITEM_ADDED", item);
        req.log.info(
          { messageId },
          `[PUB/SUB PUBLISHED] Published ITEM_ADDED for item: ${item.name}`,
        );
      } else {
        inventory = [...inventory, item];
      }
      res.status(201).json(AddInventoryItemResponse.parse(item));
    } catch (error) {
      req.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Firestore write failed; keeping item in local simulator",
      );
      inventory = [...inventory, item];
      res.status(201).json(AddInventoryItemResponse.parse(item));
    }
  })();
});

router.delete("/firestore/remove-item/:id", (req, res): void => {
  const parsed = RemoveInventoryItemParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const live = getLiveGoogleClients();
  void (async () => {
    let removed = live
      ? await readLiveInventoryItem(live.firestore, parsed.data.id)
      : inventory.find((item) => item.id === parsed.data.id) ?? null;

    if (!removed) {
      res.status(404).json({ error: "Inventory item not found" });
      return;
    }

    try {
      if (live) {
        await deleteLiveInventoryItem(live.firestore, parsed.data.id);
        inventory = await readLiveInventory(live.firestore);
      } else {
        inventory = inventory.filter((item) => item.id !== parsed.data.id);
      }
      res.json(RemoveInventoryItemResponse.parse(removed));
    } catch (error) {
      req.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Firestore delete failed; keeping document",
      );
      res.status(503).json({ error: "Firestore delete failed" });
    }
  })().catch((error: unknown) => {
    req.log.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Inventory removal failed",
    );
    res.status(503).json({ error: "Firestore is unavailable" });
  });
});

router.post("/system/reset", (req, res): void => {
  const live = getLiveGoogleClients();
  void (async () => {
    let clearedInventory = inventory.length;
    let clearedTelemetry = telemetry.length;
    if (live) {
      try {
        clearedInventory = await clearLiveInventory(live.firestore);
        clearedTelemetry = await clearLiveTelemetry(live.table);
      } catch (error) {
        req.log.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "Live reset partially failed; clearing local simulator",
        );
      }
    }
    inventory = [];
    telemetry = [];
    sequence = 0;
    res.json(
      ResetSystemResponse.parse({
        clearedInventory,
        clearedTelemetry,
        unmountedSensors: 5,
      }),
    );
  })().catch((error: unknown) => {
    req.log.error(
      { error: error instanceof Error ? error.message : String(error) },
      "System reset failed",
    );
    res.status(503).json({ error: "Google Cloud reset failed" });
  });
});

export default router;