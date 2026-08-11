import { useEffect, useMemo, useState } from "react";
import type { DragEvent, ReactElement } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Barcode,
  Camera,
  Check,
  ChevronRight,
  Cloud,
  CloudCog,
  DoorClosed,
  DoorOpen,
  Gauge,
  Layers3,
  Lightbulb,
  Loader2,
  Package,
  Plus,
  Radio,
  RefreshCw,
  ScanLine,
  Snowflake,
  Smartphone,
  Thermometer,
  Trash2,
  Upload,
  Wifi,
  Wind,
  X,
} from "lucide-react";
import {
  getGetInventoryQueryKey,
  getGetTelemetryQueryKey,
  useAddInventoryItem,
  useGetInventory,
  useGetTelemetry,
  useRemoveInventoryItem,
  useResetSystem,
} from "@workspace/api-client-react";
import type {
  InventoryItem,
  InventoryItemInput,
  TelemetryPacket,
} from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

const queryClient = new QueryClient();

type SensorKind = "environmental" | "tof" | "camera" | "weight" | "barcode";
type ShelfKey = "upper" | "middle" | "lower" | "produce";
type DrawerFood = {
  key: string;
  name: string;
  type: "packaged" | "produce";
  barcode: string | null;
  icon: "milk" | "soup" | "apple" | "banana";
};

const sensors: Array<{
  kind: SensorKind;
  name: string;
  detail: string;
  Icon: typeof Activity;
  requiresOpen: boolean;
}> = [
  {
    kind: "environmental",
    name: "Environmental",
    detail: "Temp · humidity · gas",
    Icon: Thermometer,
    requiresOpen: false,
  },
  {
    kind: "tof",
    name: "ToF depth",
    detail: "Shelf occupancy",
    Icon: ScanLine,
    requiresOpen: true,
  },
  {
    kind: "camera",
    name: "RGB camera",
    detail: "Vision recognition",
    Icon: Camera,
    requiresOpen: true,
  },
  {
    kind: "weight",
    name: "Load cell",
    detail: "Weight sensing",
    Icon: Gauge,
    requiresOpen: true,
  },
  {
    kind: "barcode",
    name: "Barcode scanner",
    detail: "Packaged metadata",
    Icon: Barcode,
    requiresOpen: true,
  },
];

const drawerFoods: DrawerFood[] = [
  {
    key: "milk",
    name: "Whole milk 1L",
    type: "packaged",
    barcode: "001234",
    icon: "milk",
  },
  {
    key: "soup",
    name: "Canned soup",
    type: "packaged",
    barcode: "005678",
    icon: "soup",
  },
  {
    key: "apple",
    name: "Red apple",
    type: "produce",
    barcode: null,
    icon: "apple",
  },
  {
    key: "banana",
    name: "Yellow bananas",
    type: "produce",
    barcode: null,
    icon: "banana",
  },
];

const shelfNames: Array<{ key: ShelfKey; label: string }> = [
  { key: "upper", label: "Shelf 01 · chilled" },
  { key: "middle", label: "Shelf 02 · ambient" },
  { key: "lower", label: "Shelf 03 · deep cool" },
];

function Home() {
  const queryClient = useQueryClient();
  const [doorOpen, setDoorOpen] = useState(false);
  const [mounted, setMounted] = useState<SensorKind[]>(["environmental"]);
  const [shelves, setShelves] = useState<Record<ShelfKey, InventoryItem[]>>({
    upper: [],
    middle: [],
    lower: [],
    produce: [],
  });
  const [draggingFood, setDraggingFood] = useState<
    DrawerFood | InventoryItem | null
  >(null);
  const [draggingSensor, setDraggingSensor] = useState<SensorKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const environmentalSensorActive = mounted.includes("environmental");
  const telemetryParams = { environmentalSensorActive };
  const telemetryQuery = useGetTelemetry(telemetryParams, {
    query: {
      queryKey: getGetTelemetryQueryKey(telemetryParams),
      refetchInterval: 2000,
    },
  });
  const inventoryQuery = useGetInventory({
    query: { queryKey: getGetInventoryQueryKey(), refetchInterval: 3000 },
  });
  const addItem = useAddInventoryItem();
  const removeItem = useRemoveInventoryItem();
  const resetSystem = useResetSystem();

  const telemetry = useMemo<TelemetryPacket[]>(
    () => telemetryQuery.data ?? [],
    [telemetryQuery.data],
  );
  const inventory = useMemo<InventoryItem[]>(
    () => inventoryQuery.data ?? [],
    [inventoryQuery.data],
  );
  const assignedIds = useMemo(
    () =>
      new Set(
        Object.values(shelves)
          .flat()
          .map((item) => item.id),
      ),
    [shelves],
  );
  const unplacedApiItems = inventory.filter(
    (item) => !assignedIds.has(item.id),
  );

  // Current temperature from telemetry stream
  const currentTemp = useMemo(() => {
    if (!telemetry.length) return "3.4";
    return telemetry[telemetry.length - 1].temperature.toFixed(1);
  }, [telemetry]);

  const currentHumidity = useMemo(() => {
    if (!telemetry.length) return "84";
    return telemetry[telemetry.length - 1].humidity.toFixed(0);
  }, [telemetry]);

  useEffect(() => {
    if (!inventory.length) return;
    setShelves((current) => {
      const known = new Set(
        Object.values(current)
          .flat()
          .map((item) => item.id),
      );
      const next = { ...current };
      inventory.forEach((item) => {
        if (!known.has(item.id)) {
          const shelf = (
            ["upper", "middle", "lower", "produce"].includes(item.shelf)
              ? item.shelf
              : item.type === "produce"
                ? "produce"
                : "middle"
          ) as ShelfKey;
          next[shelf] = [...next[shelf], item];
        }
      });
      return next;
    });
  }, [inventory]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const showToast = (message: string) => setToast(message);

  const mountedStatus = (kind: SensorKind) => {
    if (!mounted.includes(kind)) return "off";
    if (kind !== "environmental" && !doorOpen) return "sleep";
    return "streaming";
  };

  const onDoorToggle = () => {
    setDoorOpen((open) => {
      const next = !open;
      showToast(
        next
          ? "Pub/Sub event emitted · door opened"
          : "Door closed · entering sleep mode",
      );
      return next;
    });
  };

  const onReset = () => {
    resetSystem.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetInventoryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTelemetryQueryKey() });
        setMounted(["environmental"]);
        setShelves({ upper: [], middle: [], lower: [], produce: [] });
        setResetOpen(false);
        showToast(
          `System reset complete · cleared ${result.clearedInventory} docs`,
        );
      },
      onError: () => showToast("Reset failed · Cloud gateway error"),
    });
  };

  const canAddFood = (food: DrawerFood) => {
    if (!doorOpen) {
      showToast("Open the fridge door before adding items");
      return false;
    }
    const needed: SensorKind[] =
      food.type === "packaged" ? ["barcode"] : ["camera", "environmental"];
    if (needed.some((kind) => !mounted.includes(kind))) {
      showToast(
        food.type === "packaged"
          ? "Mount the barcode scanner first"
          : "Mount the RGB camera and environmental sensor first",
      );
      return false;
    }
    return true;
  };

  const handleFoodDrop = (shelf: ShelfKey) => {
    if (!draggingFood) return;
    if (!doorOpen) {
      showToast("Door closed · item placement blocked");
      setDraggingFood(null);
      return;
    }
    if ("id" in draggingFood) {
      setDraggingFood(null);
      return;
    }
    if (!canAddFood(draggingFood)) {
      setDraggingFood(null);
      return;
    }
    const averageTemp = telemetry.length
      ? telemetry.reduce((sum, packet) => sum + packet.temperature, 0) /
        telemetry.length
      : 3.5;
    const input: InventoryItemInput = {
      name: draggingFood.name,
      type: draggingFood.type,
      barcode: draggingFood.barcode,
      detectionMethod:
        draggingFood.type === "packaged" ? "barcode_scan" : "rgb_vision",
      calories:
        draggingFood.type === "packaged"
          ? draggingFood.key === "milk"
            ? 120
            : 190
          : draggingFood.key === "apple"
            ? 95
            : 105,
      expirationDate: new Date(
        Date.now() + (draggingFood.type === "produce" ? 5 : 12) * 86400000,
      )
        .toISOString()
        .slice(0, 10),
      storageCondition:
        averageTemp < 5 ? "cold_chain_ok" : "temperature_review",
      shelf,
    };
    addItem.mutate(
      { data: input },
      {
        onSuccess: (item) => {
          setShelves((current) => ({
            ...current,
            [shelf]: [...current[shelf], item],
          }));
          queryClient.invalidateQueries({
            queryKey: getGetInventoryQueryKey(),
          });
          showToast(`${item.name} added · synced with App & Firestore`);
        },
        onError: () => showToast("Recognition failed · item was not added"),
      },
    );
    setDraggingFood(null);
  };

  const handleRemove = (item: InventoryItem) => {
    removeItem.mutate(
      { id: item.id },
      {
        onSuccess: () => {
          setShelves(
            (current) =>
              Object.fromEntries(
                Object.entries(current).map(([key, values]) => [
                  key,
                  values.filter((value) => value.id !== item.id),
                ]),
              ) as Record<ShelfKey, InventoryItem[]>,
          );
          queryClient.invalidateQueries({
            queryKey: getGetInventoryQueryKey(),
          });
          showToast(`${item.name} removed from inventory`);
        },
        onError: () => showToast("Return action failed"),
      },
    );
  };

  const handleSensorDrop = () => {
    if (!draggingSensor) return;
    if (!mounted.includes(draggingSensor)) {
      setMounted((current) => [...current, draggingSensor]);
      showToast(
        `${sensors.find((sensor) => sensor.kind === draggingSensor)?.name} mounted to the fridge`,
      );
    } else showToast("Sensor already mounted");
    setDraggingSensor(null);
  };

  const renderFoodIcon = (food: DrawerFood | InventoryItem) => {
    const produce = food.type === "produce";
    return (
      <span className={`item-orb ${produce ? "produce" : ""}`}>
        {produce ? <Wind size={15} /> : <Package size={15} />}
      </span>
    );
  };

  return (
    <div className="dashboard-shell scanline">
      <header className="topbar flex flex-wrap items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <Snowflake size={19} />
          </div>
          <div className="brand-copy">
            <div className="flex items-center gap-2">
              <h1 className="text-[15px] font-bold tracking-[.02em] text-[#e0f8ff]">
                COLDCHAIN // LAB
              </h1>
              <span className="eyebrow hidden sm:inline">SIMULATOR 0.9</span>
            </div>
            <p className="mt-0.5 text-[11px] text-[#7eabbc]">
              Smart refrigerator mission control
            </p>
          </div>
        </div>
        <div className="topbar-actions flex items-center gap-2">
          <div className="gateway-control status-pill">
            <span className="status-dot live" />
            <Cloud size={14} /> GOOGLE CLOUD GATEWAY
          </div>
          <button
            data-testid="button-door-toggle"
            className={`btn-ops ${doorOpen ? "btn-primary" : ""}`}
            onClick={onDoorToggle}
          >
            {doorOpen ? <DoorOpen size={15} /> : <DoorClosed size={15} />}{" "}
            {doorOpen ? "CLOSE DOOR" : "OPEN FRIDGE DOOR"}
          </button>
          <button
            data-testid="button-reset-system"
            className="btn-ops btn-danger"
            onClick={() => setResetOpen(true)}
            disabled={resetSystem.isPending}
          >
            {resetSystem.isPending ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}{" "}
            RESET SYSTEM
          </button>
        </div>
      </header>

      <main>
        <div className="mx-auto flex max-w-[1680px] items-center justify-between px-4 pt-5 md:px-6">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <span
                className={`status-dot ${doorOpen ? "live text-[#72e5b0]" : "text-[#f4c66d]"}`}
              />{" "}
              CURRENT RUN · {doorOpen ? "ACTIVE" : "STANDBY"}
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-[#d9f5ff] md:text-2xl">
              Fridge architecture overview
            </h2>
          </div>
          <div
            className={`status-pill ${doorOpen ? "text-[#72e5b0]" : "text-[#f4c66d]"}`}
            data-testid="status-door-mode"
          >
            {doorOpen ? <Activity size={13} /> : <Lightbulb size={13} />} DOOR{" "}
            {doorOpen ? "OPEN · ACTIVE" : "CLOSED · SLEEP MODE"}
          </div>
        </div>

        <div className="main-grid">
          {/* LEFT PANEL: SENSOR PALETTE & STOCK DRAWER */}
          <section className="panel left-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Input layer / 05</div>
                <h2 className="mt-1">Sensor palette</h2>
              </div>
              <Layers3 className="text-[#69cce9]" size={17} />
            </div>
            <div className="space-y-2 p-3">
              {sensors.map(({ kind, name, detail, Icon, requiresOpen }) => {
                const status = mountedStatus(kind);
                return (
                  <div
                    key={kind}
                    draggable
                    data-testid={`sensor-module-${kind}`}
                    className="module-card"
                    onDragStart={() => setDraggingSensor(kind)}
                    onDragEnd={() => setDraggingSensor(null)}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="module-icon">
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-semibold text-[#d9f5ff]">
                          {name}
                        </div>
                        <div className="mt-0.5 truncate text-[9px] text-[#789dab]">
                          {detail}
                        </div>
                      </div>
                      <span className={`mini-badge ${status}`}>
                        {status === "streaming"
                          ? "STREAMING"
                          : status === "sleep"
                            ? "SLEEP"
                            : "OFF"}
                      </span>
                    </div>
                    {requiresOpen && (
                      <div className="mt-2 flex items-center gap-1 text-[9px] text-[#789dab]">
                        <DoorOpen size={10} /> Requires open door
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="panel-heading border-t border-[#4b7382]/20 mt-2">
              <div>
                <div className="eyebrow">Stock items</div>
                <h2 className="mt-1">Drag food to fridge</h2>
              </div>
              <Package className="text-[#b9a6fb]" size={17} />
            </div>
            <div className="p-3 space-y-2">
              <div className="mb-2 rounded-md border border-[#7d67bd]/30 bg-[#4c3b81]/10 p-2 text-[10px] leading-relaxed text-[#b9aed9]">
                <Upload size={12} className="mr-1 inline text-[#b9a6fb]" /> Drag
                into a fridge shelf below.
              </div>
              {drawerFoods.map((food) => (
                <DrawerFoodRow
                  key={food.key}
                  food={food}
                  onDragStart={setDraggingFood}
                />
              ))}
            </div>
          </section>

          {/* CENTER PANEL: VIRTUAL REFRIGERATOR */}
          <section className="panel center-panel fridge-stage ops-grid">
            <div className="panel-heading stage-label border-b-0">
              <div>
                <div className="eyebrow">Simulation canvas / 01</div>
                <h2 className="mt-1">Virtual refrigerator</h2>
              </div>
              <div className="font-mono text-[9px] text-[#78bfd4]">
                ZONE: KITCHEN.ALPHA
              </div>
            </div>
            {mounted.length > 0 && <div className="connector" />}
            <div
              className="fridge-body"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleSensorDrop}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="door-name">TWO-DOOR COLD STORAGE</div>
                <div className="font-mono text-[9px] text-[#79d9eb]">
                  {mounted.length} / 5 SENSORS MOUNTED
                </div>
              </div>
              <div className="fridge-doors">
                <div className="door left">
                  <div className="door-name">FRESH ZONE</div>
                  <div className="shelf-stack">
                    {shelfNames.map(({ key, label }) => (
                      <ShelfDrop
                        key={key}
                        shelfKey={key}
                        label={label}
                        items={shelves[key]}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => handleFoodDrop(key)}
                        onDragStart={setDraggingFood}
                        onRemove={handleRemove}
                        renderFoodIcon={renderFoodIcon}
                      />
                    ))}
                  </div>
                </div>
                <div className="door right">
                  <div className="door-name">DOOR STORAGE</div>
                  <div className="mt-[15px] space-y-2 text-[10px] text-[#82a8b7]">
                    <div className="rounded border border-dashed border-[#36758b] bg-[#113449]/50 p-2">
                      <span className="font-mono text-[9px] text-[#5eaec4]">
                        BIN A
                      </span>
                      <div className="mt-2 h-7 rounded bg-[#1b5268]/30" />
                    </div>
                    <div className="rounded border border-dashed border-[#36758b] bg-[#113449]/50 p-2">
                      <span className="font-mono text-[9px] text-[#5eaec4]">
                        BIN B
                      </span>
                      <div className="mt-2 h-7 rounded bg-[#1b5268]/30" />
                    </div>
                  </div>
                </div>
              </div>
              <ShelfDrop
                shelfKey="produce"
                label="BOTTOM PRODUCE DRAWER · TEMPERATURE CONTROLLED"
                items={shelves.produce}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleFoodDrop("produce")}
                onDragStart={setDraggingFood}
                onRemove={handleRemove}
                renderFoodIcon={renderFoodIcon}
                produce
              />
              <div className="mount-row">
                {(["tof", "camera", "weight"] as SensorKind[]).map((kind) => (
                  <div
                    key={kind}
                    className={`mount-slot ${mounted.includes(kind) ? "filled" : ""}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleSensorDrop}
                  >
                    {mounted.includes(kind) ? (
                      <>
                        <Check size={13} />
                        <span>
                          {sensors.find((sensor) => sensor.kind === kind)?.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <Plus size={13} />
                        <span>DROP SENSOR</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="relative z-10 mt-3 flex items-center justify-center gap-2 font-mono text-[9px] text-[#7397a6]">
              <span
                className={`status-dot ${doorOpen ? "live text-[#72e5b0]" : "text-[#f4c66d]"}`}
              />{" "}
              {doorOpen
                ? "LIVE SENSOR STREAM · MOVEMENT ENABLED"
                : "LOCKED STATE · OPEN DOOR TO INTERACT"}
            </div>
          </section>

          {/* RIGHT PANEL: PHONE APP SIMULATOR */}
          <section className="panel right-panel flex flex-col items-center justify-start p-4 bg-[#06121e]">
            <div className="w-full flex items-center justify-between mb-3 border-b border-[#1f384c] pb-2">
              <div className="eyebrow flex items-center gap-1.5">
                <Smartphone size={14} className="text-[#72e5b0]" /> SMART FRIDGE
                APP
              </div>
              <span className="font-mono text-[9px] text-[#72e5b0] bg-[#13322b] px-2 py-0.5 rounded border border-[#1f5c49]">
                SYNCED
              </span>
            </div>

            {/* Mock Phone Frame */}
            <div className="w-full max-w-[310px] rounded-[32px] border-[6px] border-[#1b2b3a] bg-[#0c1824] shadow-2xl overflow-hidden flex flex-col min-h-[520px]">
              {/* Phone Header / Sensor Stats Bar */}
              <div className="bg-[#122434] p-4 text-[#e0f8ff] border-b border-[#1d354a]">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[#86aac1]">
                  <span>MY SMART FRIDGE</span>
                  <div className="flex items-center gap-1">
                    <Wifi size={12} className="text-[#72e5b0]" />{" "}
                    <span>5G</span>
                  </div>
                </div>

                {/* Temperature Readout Header */}
                <div className="mt-3 flex items-center justify-between bg-[#08121c] p-3 rounded-xl border border-[#1a384e]">
                  <div>
                    <div className="text-[10px] text-[#7095a8] uppercase font-mono">
                      Internal Temp
                    </div>
                    <div className="text-2xl font-bold text-[#72e5b0] flex items-baseline gap-1">
                      {currentTemp}
                      <span className="text-sm font-normal text-[#9ec4d8]">
                        °C
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-[#7095a8] uppercase font-mono">
                      Humidity
                    </div>
                    <div className="text-sm font-semibold text-[#8ed8f8]">
                      {currentHumidity}%
                    </div>
                    <div className="text-[9px] text-[#638a9c] mt-0.5">
                      {doorOpen ? "Door Open" : "Door Closed"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Phone Content / Active Inventory List */}
              <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-[#bde8f5] uppercase tracking-wider">
                    Fridge Inventory
                  </span>
                  <span className="text-[10px] font-mono text-[#72e5b0] bg-[#123126] px-1.5 py-0.5 rounded">
                    {inventory.length} items
                  </span>
                </div>

                {inventoryQuery.isLoading && (
                  <div className="p-6 text-center text-[11px] text-[#668b9c]">
                    Updating phone sync...
                  </div>
                )}

                {!inventoryQuery.isLoading && inventory.length === 0 && (
                  <div className="p-8 text-center text-[#587a8a]">
                    <Package className="mx-auto mb-2 opacity-40" size={28} />
                    <p className="text-[11px] font-semibold">Fridge is empty</p>
                    <p className="text-[9px] mt-1 text-[#486776]">
                      Add an item to the fridge to view it on your app
                    </p>
                  </div>
                )}

                {inventory.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2.5 bg-[#122230] hover:bg-[#172b3c] rounded-xl border border-[#1d384e] transition-all"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`item-orb ${item.type === "produce" ? "produce" : ""}`}
                      >
                        {item.type === "produce" ? (
                          <Wind size={13} />
                        ) : (
                          <Package size={13} />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-[#e1f4fc] truncate">
                          {item.name}
                        </div>
                        <div className="text-[9px] font-mono text-[#6ba2b5] flex items-center gap-1.5 mt-0.5">
                          <span>Expires: {item.expirationDate || "N/A"}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(item)}
                      className="text-[#6d8d9c] hover:text-[#ff8a9a] p-1 transition-colors"
                      title="Remove item"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Phone Footer Drop Zone */}
              <div
                className="p-3 bg-[#11212e] border-t border-[#1d354a] text-center"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggingFood && "id" in draggingFood)
                    handleRemove(draggingFood);
                  setDraggingFood(null);
                }}
              >
                <div className="border border-dashed border-[#2f556b] rounded-lg p-2 text-[10px] text-[#7198aa]">
                  <Radio size={11} className="inline mr-1 text-[#72e5b0]" />{" "}
                  Drop fridge item here to remove
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      {toast && (
        <div data-testid="status-activity-toast" className="activity-toast">
          <div className="flex items-start gap-2">
            <Check size={15} className="mt-0.5 shrink-0 text-[#72e5b0]" />
            <span>{toast}</span>
            <button
              data-testid="button-dismiss-toast"
              className="ml-2 text-[#789dab]"
              onClick={() => setToast(null)}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {resetOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#020d16]/75 p-4 backdrop-blur-sm">
          <div className="panel w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-[#9f3348]/20 p-2 text-[#ff9aa7]">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-[#e2f7ff]">
                  Reset simulation?
                </h3>
                <p className="mt-1 text-[12px] leading-relaxed text-[#8eafbb]">
                  This clears inventory documents and unmounts every sensor.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                data-testid="button-cancel-reset"
                className="btn-ops"
                onClick={() => setResetOpen(false)}
              >
                CANCEL
              </button>
              <button
                data-testid="button-confirm-reset"
                className="btn-ops btn-danger"
                onClick={onReset}
              >
                RESET SYSTEM
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShelfDrop({
  shelfKey,
  label,
  items,
  onDragOver,
  onDrop,
  onDragStart,
  onRemove,
  renderFoodIcon,
  produce = false,
}: {
  shelfKey: ShelfKey;
  label: string;
  items: InventoryItem[];
  onDragOver: (event: DragEvent) => void;
  onDrop: () => void;
  onDragStart: (item: InventoryItem) => void;
  onRemove: (item: InventoryItem) => void;
  renderFoodIcon: (food: InventoryItem) => ReactElement;
  produce?: boolean;
}) {
  return (
    <div
      className={`shelf ${produce ? "produce-drawer" : ""}`}
      data-testid={`dropzone-shelf-${shelfKey}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="shelf-name">{label}</div>
      <div className="shelf-items">
        {items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              draggable
              className={`food-chip ${item.type === "produce" ? "produce" : ""}`}
              data-testid={`fridge-item-${item.id}`}
              onDragStart={() => onDragStart(item)}
            >
              {renderFoodIcon(item)}
              <span>{item.name}</span>
              <button
                data-testid={`button-remove-item-${item.id}`}
                onClick={() => onRemove(item)}
                aria-label={`Return ${item.name}`}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))
        ) : (
          <span className="mt-1 text-[9px] text-[#5c7f8d]">Drop food here</span>
        )}
      </div>
    </div>
  );
}

function DrawerFoodRow({
  food,
  onDragStart,
}: {
  food: DrawerFood;
  onDragStart: (food: DrawerFood) => void;
}) {
  return (
    <div
      draggable
      data-testid={`drawer-food-${food.key}`}
      className="drawer-item"
      onDragStart={() => onDragStart(food)}
    >
      <span className={`item-orb ${food.type === "produce" ? "produce" : ""}`}>
        {food.type === "produce" ? <Wind size={15} /> : <Package size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-[#d7f4fc]">
          {food.name}
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[#6e9aa9]">
          {food.barcode ? `BARCODE ${food.barcode}` : "UNPACKAGED · VISION"}
        </div>
      </div>
      <ChevronRight size={14} className="text-[#5f93a4]" />
    </div>
  );
}

function Router() {
  return (
    <ErrorBoundary resetKey={useLocation()[0]}>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
