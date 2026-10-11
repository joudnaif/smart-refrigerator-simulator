import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Bigtable, type Table } from "@google-cloud/bigtable";
import { Firestore } from "@google-cloud/firestore";
import { PubSub, type Message } from "@google-cloud/pubsub";
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
const fridgeEventTopicName = "fridge-event";
const fridgeEventSubscriptionName = "fridge-event-sub";

type LiveGoogleClients = {
  firestore: Firestore;
  table: Table;
  pubsub: PubSub;
};

let clients: LiveGoogleClients | null = null;
let clientsInitialized = false;
let subscriberStarted = false;
let topicReady: Promise<ReturnType<PubSub["topic"]>> | null = null;

function getGoogleClientOptions(): GoogleClientOptions {
  const rawCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? undefined;
  const defaultCredentialPath = [
    resolve(process.cwd(), "service-account.json"),
    resolve(process.cwd(), "artifacts/api-server/service-account.json"),
  ].find((candidate) => existsSync(candidate));

  if (!rawCredentials && !defaultCredentialPath) {
    return { projectId };
  }

  if (rawCredentials?.startsWith("{")) {
    const serviceAccount = JSON.parse(rawCredentials) as ServiceAccount;
    return {
      projectId: projectId ?? serviceAccount.project_id,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    };
  }

  return { projectId, keyFilename: rawCredentials ?? defaultCredentialPath };
}


function hasConfiguredGoogleCredentials(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    existsSync(resolve(process.cwd(), "service-account.json")) ||
    existsSync(
      resolve(process.cwd(), "artifacts/api-server/service-account.json"),
    ) ||
    process.env.K_SERVICE,
  );
}


async function getReadyFridgeEventTopic(pubsub: PubSub) {
  if (!topicReady) {
    topicReady = (async () => {
      const topic = pubsub.topic(fridgeEventTopicName);
      const [exists] = await topic.exists();
      if (!exists) {
        await topic.create();
        logger.info(
          { topic: fridgeEventTopicName },
          "Created Google Cloud Pub/Sub topic",
        );
      }
      return topic;
    })().catch((error: unknown) => {
      topicReady = null;
      throw error;
    });
  }
  return topicReady;
}

async function syncReceivedFridgeEvent(
  firestore: Firestore,
  table: Table,
  message: Message,
): Promise<void> {
  const raw = message.data.toString("utf8");
  const envelope = JSON.parse(raw) as {
    event?: unknown;
    data?: unknown;
    timestamp?: unknown;
  };
  const event = typeof envelope.event === "string" ? envelope.event : "UNKNOWN";
  const data =
    envelope.data && typeof envelope.data === "object" ? envelope.data : {};
  const timestamp =
    typeof envelope.timestamp === "string"
      ? envelope.timestamp
      : new Date().toISOString();

  logger.info(
    `[PUB/SUB RECEIVED] Event: ${event} | Payload: ${JSON.stringify(data)}`,
  );

  await writeLiveFridgeEvent(table, event, data, timestamp, message.id);

  if (event === "ITEM_ADDED") {
    await writeLiveInventory(firestore, data as InventoryItem);
  }
}

async function startFridgeEventSubscriber(
  pubsub: PubSub,
  firestore: Firestore,
  table: Table,
): Promise<void> {
  if (subscriberStarted) return;
  subscriberStarted = true;

  try {
    const topic = await getReadyFridgeEventTopic(pubsub);
    const [topicMetadata] = await topic.getMetadata();
    const expectedTopicName = topicMetadata.name;
    const subscription = pubsub.subscription(fridgeEventSubscriptionName);
    const [exists] = await subscription.exists();
    if (!exists) {
      await topic.createSubscription(fridgeEventSubscriptionName);
      logger.info(
        { subscription: fridgeEventSubscriptionName },
        "Created Google Cloud Pub/Sub subscription",
      );
    } else {
      const [subscriptionMetadata] = await subscription.getMetadata();
      if (subscriptionMetadata.topic !== expectedTopicName) {
        logger.warn(
          {
            subscription: fridgeEventSubscriptionName,
            existingTopic: subscriptionMetadata.topic,
            expectedTopic: expectedTopicName,
          },
          "Repairing Pub/Sub subscription topic mismatch",
        );
        await subscription.delete();
        await topic.createSubscription(fridgeEventSubscriptionName);
      }
    }

    subscription.on("message", (message) => {
      void syncReceivedFridgeEvent(firestore, table, message)
        .then(() => message.ack())
        .catch((error: unknown) => {
          logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            "Pub/Sub message processing failed",
          );
          message.nack();
        });
    });
    subscription.on("error", (error: Error) => {
      logger.error(
        { error: error.message },
        "Google Cloud Pub/Sub subscriber error",
      );
    });
    subscription.open();
    logger.info(
      {
        topic: fridgeEventTopicName,
        subscription: fridgeEventSubscriptionName,
      },
      "Google Cloud Pub/Sub subscriber listening",
    );
  } catch (error) {
    subscriberStarted = false;
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Google Cloud Pub/Sub subscriber could not start",
    );
  }
}

export function getLiveGoogleClients(): {
  firestore: Firestore;
  table: Table;
  pubsub: PubSub;
} | null {
  if (!hasConfiguredGoogleCredentials()) {
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
    const pubsub = new PubSub(options);
    clients = {
      firestore,
      table: bigtable.instance(bigtableInstance).table(bigtableTable),
      pubsub,
    };
    void startFridgeEventSubscriber(pubsub, firestore, clients.table);
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

export async function publishFridgeEvent(
  eventType: string,
  payload: object,
): Promise<string> {
  const live = getLiveGoogleClients();
  if (!live) {
    throw new Error(
      "Google Cloud credentials are required to publish fridge events",
    );
  }

  const messagePayload = {
    event: eventType,
    data: payload,
    timestamp: new Date().toISOString(),
  };
  const topic = await getReadyFridgeEventTopic(live.pubsub);
  return topic.publishMessage({
    data: Buffer.from(JSON.stringify(messagePayload), "utf8"),
  });
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

export async function writeLiveFridgeEvent(
  table: Table,
  eventType: string,
  payload: object,
  timestamp: string,
  messageId: string,
): Promise<void> {
  const row = table.row(`fridge-event#${messageId}`);
  await row.save({
    [telemetryColumnFamily]: {
      event: eventType,
      data: JSON.stringify(payload),
      timestamp,
      messageId,
      source: "google-cloud-pubsub",
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
  // Fetch all rows in the table (includes both 'smart-fridge#' telemetry and 'fridge-event#' logs)
  const [rows] = await table.getRows();
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
