import { Router, type IRouter } from "express";
import {
  AddInventoryItemBody,
  AddInventoryItemResponse,
  GetInventoryResponse,
  GetTelemetryResponse,
  RemoveInventoryItemParams,
  RemoveInventoryItemResponse,
  ResetSystemResponse,
} from "@workspace/api-zod";

type InventoryItem = {
  id: string;
  name: string;
  type: "packaged" | "produce";
  barcode: string | null;
  detectionMethod: string;
  calories: number;
  expirationDate: string;
  storageCondition: string;
  syncStatus: string;
  shelf: string;
};

type TelemetryPacket = {
  id: string;
  timestamp: string;
  temperature: number;
  humidity: number;
  ethylene: number;
  source: string;
};

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
  return {
    id: `telemetry-${sequence}`,
    timestamp: new Date().toISOString(),
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

router.get("/bigtable/telemetry", (_req, res): void => {
  appendTelemetry();
  res.json(GetTelemetryResponse.parse(telemetry));
});

router.get("/firestore/inventory", (_req, res): void => {
  res.json(GetInventoryResponse.parse(inventory));
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
  inventory = [...inventory, item];
  res.status(201).json(AddInventoryItemResponse.parse(item));
});

router.delete("/firestore/remove-item/:id", (req, res): void => {
  const parsed = RemoveInventoryItemParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const removed = inventory.find((item) => item.id === parsed.data.id);
  if (!removed) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  inventory = inventory.filter((item) => item.id !== parsed.data.id);
  res.json(RemoveInventoryItemResponse.parse(removed));
});

router.post("/system/reset", (_req, res): void => {
  const clearedInventory = inventory.length;
  const clearedTelemetry = telemetry.length;
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
});

export default router;