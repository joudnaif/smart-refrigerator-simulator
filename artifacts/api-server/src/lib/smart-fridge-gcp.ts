import { Bigtable, type Table } from "@google-cloud/bigtable";
import { Firestore } from "@google-cloud/firestore";
import { logger } from "./logger";

export type InventoryItem = {
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

export type TelemetryPacket = {
  id: string;
  timestamp: string;
  temperature: number;
  humidity: number;
  ethylene: number;
  source: string;
};

type ServiceAccount = {
  project_id?: string;
  client_email: string;
  private_key: string;
};

type GoogleClientOptions = {
  projectId?: string;
  keyFilename?: string;
  credentials?: {
    client_email: string;
    private_key: string;
  };
};

type BigtableCell = { value?: string | Buffer };
type BigtableRow = {
  id?: string;
  key?: string;
  data?: Record<string, Record<string, BigtableCell[]>>;
  delete: () => Promise<unknown>;
};

const firestoreCollection =
  process.env.SMART_FRIDGE_FIRESTORE_COLLECTION ?? "smart_fridge_inventory";
const firestoreDatabase =
  process.env.SMART_FRIDGE_FIRESTORE_DATABASE ??
  process.env.FIRESTORE_DATABASE_ID ??
  "(default)";
const bigtableInstance =
  process.env.SMART_FRIDGE_BIGTABLE_INSTANCE ??
  process.env.BIGTABLE_INSTANCE_ID ??
  "smart-fridge";
const bigtableTable =
  process.env.SMART_FRIDGE_BIGTABLE_TABLE ??
  process.env.BIGTABLE_TABLE_ID ??
  "telemetry";
const telemetryPrefix = "smart-fridge#";
const telemetryColumnFamily = "metrics";

let clients: { firestore: Firestore; table: Table } | null = null;
let clientsInitialized = false;

function getGoogleClientOptions(): GoogleClientOptions {
  const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? undefined;

  if (!rawCredentials) {
    return { projectId };
  }

  if (rawCredentials.startsWith("{")) {
    const serviceAccount = JSON.parse(rawCredentials) as ServiceAccount;
    return {
      projectId: projectId ?? serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    };
  }

  return { projectId, keyFilename: rawCredentials };
}

export function getLiveGoogleClients(): {
  firestore: Firestore;
  table: Table;
} | null {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return null;
  }

  if (clientsInitialized) {
    return clients;
  }

  clientsInitialized = true;
  try {
    const options = getGoogleClientOptions();
    const firestore = new Firestore({
      ...options,
      databaseId: firestoreDatabase,
    });
    const bigtable = new Bigtable(options);
    clients = {
      firestore,
      table: bigtable.instance(bigtableInstance).table(bigtableTable),
    };
    logger.info(
      {
        firestoreCollection,
        firestoreDatabase,
        bigtableInstance,
        bigtableTable,
        projectId: options.projectId,
      },
      "Google Cloud smart fridge clients configured",
    );
    return clients;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Google Cloud clients could not be configured",
    );
    return null;
  }
}

function readCell(
  row: BigtableRow,
  family: string,
  column: string,
): string | undefined {
  const value = row.data?.[family]?.[column]?.[0]?.value;
  if (value === undefined) return undefined;
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function rowToTelemetry(row: BigtableRow): TelemetryPacket | null {
  const timestamp = readCell(row, telemetryColumnFamily, "timestamp");
  const temperature = Number(
    readCell(row, telemetryColumnFamily, "temperature"),
  );
  const humidity = Number(readCell(row, telemetryColumnFamily, "humidity"));
  const ethylene = Number(readCell(row, telemetryColumnFamily, "ethylene"));
  if (
    !timestamp ||
    !Number.isFinite(temperature) ||
    !Number.isFinite(humidity) ||
    !Number.isFinite(ethylene)
  ) {
    return null;
  }

  return {
    id:
      readCell(row, telemetryColumnFamily, "id") ??
      row.id ??
      row.key ??
      "telemetry-live",
    timestamp,
    temperature,
    humidity,
    ethylene,
    source:
      readCell(row, telemetryColumnFamily, "source") ??
      "environmental-sensor-01",
  };
}

export async function writeLiveTelemetry(
  table: Table,
  packet: TelemetryPacket,
): Promise<void> {
  const row = table.row(`${telemetryPrefix}${packet.id}`);
  await row.save({
    [telemetryColumnFamily]: {
      id: packet.id,
      timestamp: packet.timestamp,
      temperature: String(packet.temperature),
      humidity: String(packet.humidity),
      ethylene: String(packet.ethylene),
      source: packet.source,
    },
  });
}

export async function readLiveTelemetry(
  table: Table,
): Promise<TelemetryPacket[]> {
  // Bigtable's `limit` applies to row-key order, not timestamp order. Since
  // row keys also include a sequence number, limiting the read here can hide
  // freshly written packets behind older lexicographically earlier keys.
  const [rows] = await table.getRows({ prefix: telemetryPrefix });
  return (rows as unknown as BigtableRow[])
    .map(rowToTelemetry)
    .filter((packet): packet is TelemetryPacket => packet !== null)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-40);
}

export async function clearLiveTelemetry(table: Table): Promise<number> {
  const [rows] = await table.getRows({ prefix: telemetryPrefix });
  const liveRows = rows as unknown as BigtableRow[];
  await Promise.all(liveRows.map((row) => row.delete()));
  return liveRows.length;
}

function toInventoryItem(
  id: string,
  data: FirebaseFirestore.DocumentData,
): InventoryItem {
  const type = data.type === "produce" ? "produce" : "packaged";
  return {
    id,
    name: typeof data.name === "string" ? data.name : "Unknown item",
    type,
    barcode: typeof data.barcode === "string" ? data.barcode : null,
    detectionMethod:
      typeof data.detectionMethod === "string"
        ? data.detectionMethod
        : "cloud_sync",
    calories: Number.isFinite(Number(data.calories))
      ? Number(data.calories)
      : 0,
    expirationDate:
      typeof data.expirationDate === "string" ? data.expirationDate : "",
    storageCondition:
      typeof data.storageCondition === "string"
        ? data.storageCondition
        : "temperature monitored",
    syncStatus: "Synced",
    shelf: typeof data.shelf === "string" ? data.shelf : "middle",
  };
}

export async function readLiveInventory(
  firestore: Firestore,
): Promise<InventoryItem[]> {
  const snapshot = await firestore.collection(firestoreCollection).get();
  return snapshot.docs.map((doc) => toInventoryItem(doc.id, doc.data()));
}

export async function writeLiveInventory(
  firestore: Firestore,
  item: InventoryItem,
): Promise<void> {
  await firestore
    .collection(firestoreCollection)
    .doc(item.id)
    .set({
      ...item,
      updatedAt: new Date().toISOString(),
    });
}

export async function readLiveInventoryItem(
  firestore: Firestore,
  id: string,
): Promise<InventoryItem | null> {
  const doc = await firestore.collection(firestoreCollection).doc(id).get();
  return doc.exists ? toInventoryItem(doc.id, doc.data() ?? {}) : null;
}

export async function deleteLiveInventoryItem(
  firestore: Firestore,
  id: string,
): Promise<void> {
  await firestore.collection(firestoreCollection).doc(id).delete();
}

export async function clearLiveInventory(
  firestore: Firestore,
): Promise<number> {
  const snapshot = await firestore.collection(firestoreCollection).get();
  if (snapshot.empty) return 0;
  const batch = firestore.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
}
