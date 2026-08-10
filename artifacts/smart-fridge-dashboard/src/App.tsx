import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, ReactElement } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Archive,
  Barcode,
  Camera,
  Check,
  ChevronRight,
  Cloud,
  CloudCog,
  Database,
  DoorClosed,
  DoorOpen,
  Gauge,
  HardDrive,
  Layers3,
  Lightbulb,
  Loader2,
  Package,
  Plus,
  Radio,
  RefreshCw,
  ScanLine,
  Server,
  Snowflake,
  Thermometer,
  Trash2,
  Upload,
  Wifi,
  Wind,
  X,
} from 'lucide-react';
import {
  getGetInventoryQueryKey,
  getGetTelemetryQueryKey,
  useAddInventoryItem,
  useGetInventory,
  useGetTelemetry,
  useRemoveInventoryItem,
  useResetSystem,
} from '@workspace/api-client-react';
import type { InventoryItem, InventoryItemInput, TelemetryPacket } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

type SensorKind = 'environmental' | 'tof' | 'camera' | 'weight' | 'barcode';
type ShelfKey = 'upper' | 'middle' | 'lower' | 'produce';
type DrawerFood = {
  key: string;
  name: string;
  type: 'packaged' | 'produce';
  barcode: string | null;
  icon: 'milk' | 'soup' | 'apple' | 'banana';
};

const sensors: Array<{ kind: SensorKind; name: string; detail: string; Icon: typeof Activity; requiresOpen: boolean }> = [
  { kind: 'environmental', name: 'Environmental', detail: 'Temp · humidity · gas', Icon: Thermometer, requiresOpen: false },
  { kind: 'tof', name: 'ToF depth', detail: 'Shelf occupancy', Icon: ScanLine, requiresOpen: true },
  { kind: 'camera', name: 'RGB camera', detail: 'Vision recognition', Icon: Camera, requiresOpen: true },
  { kind: 'weight', name: 'Load cell', detail: 'Weight sensing', Icon: Gauge, requiresOpen: true },
  { kind: 'barcode', name: 'Barcode scanner', detail: 'Packaged metadata', Icon: Barcode, requiresOpen: true },
];

const drawerFoods: DrawerFood[] = [
  { key: 'milk', name: 'Whole milk 1L', type: 'packaged', barcode: '001234', icon: 'milk' },
  { key: 'soup', name: 'Canned soup', type: 'packaged', barcode: '005678', icon: 'soup' },
  { key: 'apple', name: 'Red apple', type: 'produce', barcode: null, icon: 'apple' },
  { key: 'banana', name: 'Yellow bananas', type: 'produce', barcode: null, icon: 'banana' },
];

const shelfNames: Array<{ key: ShelfKey; label: string }> = [
  { key: 'upper', label: 'Shelf 01 · chilled' },
  { key: 'middle', label: 'Shelf 02 · ambient' },
  { key: 'lower', label: 'Shelf 03 · deep cool' },
];

const sensorIcon = (kind: SensorKind) => {
  const match = sensors.find((sensor) => sensor.kind === kind);
  return match?.Icon ?? Activity;
};

function Home() {
  const queryClient = useQueryClient();
  const [doorOpen, setDoorOpen] = useState(false);
  const [mounted, setMounted] = useState<SensorKind[]>(['environmental']);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'inventory'>('telemetry');
  const [shelves, setShelves] = useState<Record<ShelfKey, InventoryItem[]>>({ upper: [], middle: [], lower: [], produce: [] });
  const [draggingFood, setDraggingFood] = useState<DrawerFood | InventoryItem | null>(null);
  const [draggingSensor, setDraggingSensor] = useState<SensorKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const environmentalSensorActive = mounted.includes('environmental');
  const telemetryParams = { environmentalSensorActive };
  const telemetryQuery = useGetTelemetry(telemetryParams, { query: { queryKey: getGetTelemetryQueryKey(telemetryParams), refetchInterval: 2000 } });
  const inventoryQuery = useGetInventory({ query: { queryKey: getGetInventoryQueryKey(), refetchInterval: 4000 } });
  const addItem = useAddInventoryItem();
  const removeItem = useRemoveInventoryItem();
  const resetSystem = useResetSystem();

  const telemetry = useMemo<TelemetryPacket[]>(() => telemetryQuery.data ?? [], [telemetryQuery.data]);
  const inventory = useMemo<InventoryItem[]>(() => inventoryQuery.data ?? [], [inventoryQuery.data]);
  const assignedIds = useMemo(() => new Set(Object.values(shelves).flat().map((item) => item.id)), [shelves]);
  const unplacedApiItems = inventory.filter((item) => !assignedIds.has(item.id));

  useEffect(() => {
    if (!inventory.length) return;
    setShelves((current) => {
      const known = new Set(Object.values(current).flat().map((item) => item.id));
      const next = { ...current };
      inventory.forEach((item) => {
        if (!known.has(item.id)) {
          const shelf = (['upper', 'middle', 'lower', 'produce'].includes(item.shelf) ? item.shelf : item.type === 'produce' ? 'produce' : 'middle') as ShelfKey;
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
    if (!mounted.includes(kind)) return 'off';
    if (kind !== 'environmental' && !doorOpen) return 'sleep';
    return 'streaming';
  };

  const onDoorToggle = () => {
    setDoorOpen((open) => {
      const next = !open;
      showToast(next ? 'Pub/Sub event emitted · attached sensors awake' : 'Door closed · secondary sensors entering sleep mode');
      return next;
    });
  };

  const onReset = () => {
    resetSystem.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getGetInventoryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTelemetryQueryKey() });
        setMounted(['environmental']);
        setShelves({ upper: [], middle: [], lower: [], produce: [] });
        setResetOpen(false);
        showToast(`System reset complete · ${result.clearedInventory} docs and ${result.clearedTelemetry} packets cleared`);
      },
      onError: () => showToast('Reset failed · Cloud gateway did not acknowledge the command'),
    });
  };

  const canAddFood = (food: DrawerFood) => {
    if (!doorOpen) {
      showToast('Open the fridge door before moving inventory');
      return false;
    }
    const needed: SensorKind[] = food.type === 'packaged' ? ['barcode'] : ['camera', 'environmental'];
    if (needed.some((kind) => !mounted.includes(kind))) {
      showToast(food.type === 'packaged' ? 'Mount the barcode scanner first' : 'Mount the RGB camera and environmental sensor first');
      return false;
    }
    return true;
  };

  const handleFoodDrop = (shelf: ShelfKey) => {
    if (!draggingFood) return;
    if (!doorOpen) {
      showToast('Door closed · inventory movement blocked');
      setDraggingFood(null);
      return;
    }
    if ('id' in draggingFood) {
      setDraggingFood(null);
      return;
    }
    if (!canAddFood(draggingFood)) {
      setDraggingFood(null);
      return;
    }
    const averageTemp = telemetry.length ? telemetry.reduce((sum, packet) => sum + packet.temperature, 0) / telemetry.length : 3.5;
    const input: InventoryItemInput = {
      name: draggingFood.name,
      type: draggingFood.type,
      barcode: draggingFood.barcode,
      detectionMethod: draggingFood.type === 'packaged' ? 'barcode_scan' : 'rgb_vision',
      calories: draggingFood.type === 'packaged' ? (draggingFood.key === 'milk' ? 120 : 190) : (draggingFood.key === 'apple' ? 95 : 105),
      expirationDate: new Date(Date.now() + (draggingFood.type === 'produce' ? 5 : 12) * 86400000).toISOString().slice(0, 10),
      storageCondition: averageTemp < 5 ? 'cold_chain_ok' : 'temperature_review',
      shelf,
    };
    addItem.mutate({ data: input }, {
      onSuccess: (item) => {
        setShelves((current) => ({ ...current, [shelf]: [...current[shelf], item] }));
        queryClient.invalidateQueries({ queryKey: getGetInventoryQueryKey() });
        showToast(`${item.name} recognized · Firestore document synced`);
      },
      onError: () => showToast('Recognition failed · item was not written to Firestore'),
    });
    setDraggingFood(null);
  };

  const handleRemove = (item: InventoryItem) => {
    removeItem.mutate({ id: item.id }, {
      onSuccess: () => {
        setShelves((current) => Object.fromEntries(Object.entries(current).map(([key, values]) => [key, values.filter((value) => value.id !== item.id)])) as Record<ShelfKey, InventoryItem[]>);
        queryClient.invalidateQueries({ queryKey: getGetInventoryQueryKey() });
        showToast(`${item.name} returned to the right shelf · Firestore document removed`);
      },
      onError: () => showToast('Return action failed · document remains in Firestore'),
    });
  };

  const handleSensorDrop = () => {
    if (!draggingSensor) return;
    if (!mounted.includes(draggingSensor)) {
      setMounted((current) => [...current, draggingSensor]);
      showToast(`${sensors.find((sensor) => sensor.kind === draggingSensor)?.name} mounted to the cold chain`);
    } else showToast('Sensor already mounted in this simulation');
    setDraggingSensor(null);
  };

  const renderFoodIcon = (food: DrawerFood | InventoryItem) => {
    const produce = food.type === 'produce';
    return <span className={`item-orb ${produce ? 'produce' : ''}`}>{produce ? <Wind size={15} /> : <Package size={15} />}</span>;
  };

  return (
    <div className="dashboard-shell scanline">
      <header className="topbar flex flex-wrap items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="brand-mark"><Snowflake size={19} /></div>
          <div className="brand-copy">
            <div className="flex items-center gap-2">
              <h1 className="text-[15px] font-bold tracking-[.02em] text-[#e0f8ff]">COLDCHAIN // LAB</h1>
              <span className="eyebrow hidden sm:inline">SIMULATOR 0.9</span>
            </div>
            <p className="mt-0.5 text-[11px] text-[#7eabbc]">Smart refrigerator mission control</p>
          </div>
        </div>
        <div className="topbar-actions flex items-center gap-2">
          <div className="gateway-control status-pill"><span className="status-dot live" /><Cloud size={14} /> GOOGLE CLOUD GATEWAY <span className="hidden sm:inline opacity-60">·</span> <span className="hidden sm:inline opacity-75">PUB/SUB + EVENTARC</span></div>
          <button data-testid="button-door-toggle" className={`btn-ops ${doorOpen ? 'btn-primary' : ''}`} onClick={onDoorToggle}>
            {doorOpen ? <DoorOpen size={15} /> : <DoorClosed size={15} />} {doorOpen ? 'CLOSE DOOR' : 'OPEN FRIDGE DOOR'}
          </button>
          <button data-testid="button-reset-system" className="btn-ops btn-danger" onClick={() => setResetOpen(true)} disabled={resetSystem.isPending}>
            {resetSystem.isPending ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} RESET SYSTEM
          </button>
        </div>
      </header>

      <main>
        <div className="mx-auto flex max-w-[1680px] items-center justify-between px-4 pt-5 md:px-6">
          <div>
            <div className="eyebrow flex items-center gap-2"><span className={`status-dot ${doorOpen ? 'live text-[#72e5b0]' : 'text-[#f4c66d]'}`} /> CURRENT RUN · {doorOpen ? 'ACTIVE' : 'STANDBY'}</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-[#d9f5ff] md:text-2xl">Fridge architecture overview</h2>
          </div>
          <div className={`status-pill ${doorOpen ? 'text-[#72e5b0]' : 'text-[#f4c66d]'}`} data-testid="status-door-mode">
            {doorOpen ? <Activity size={13} /> : <Lightbulb size={13} />} DOOR {doorOpen ? 'OPEN · ACTIVE' : 'CLOSED · SLEEP MODE'}
          </div>
        </div>

        <div className="main-grid">
          <section className="panel left-panel">
            <div className="panel-heading"><div><div className="eyebrow">Input layer / 05</div><h2 className="mt-1">Sensor palette</h2></div><Layers3 className="text-[#69cce9]" size={17} /></div>
            <div className="space-y-2 p-3">
              {sensors.map(({ kind, name, detail, Icon, requiresOpen }) => {
                const status = mountedStatus(kind);
                return (
                  <div key={kind} draggable data-testid={`sensor-module-${kind}`} className="module-card" onDragStart={() => setDraggingSensor(kind)} onDragEnd={() => setDraggingSensor(null)}>
                    <div className="flex items-center gap-2.5">
                      <div className="module-icon"><Icon size={16} /></div>
                      <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-[#d9f5ff]">{name}</div><div className="mt-0.5 truncate text-[9px] text-[#789dab]">{detail}</div></div>
                      <span className={`mini-badge ${status}`}>{status === 'streaming' ? 'STREAMING' : status === 'sleep' ? 'SLEEP' : 'OFF'}</span>
                    </div>
                    {requiresOpen && <div className="mt-2 flex items-center gap-1 text-[9px] text-[#789dab]"><DoorOpen size={10} /> Requires open door</div>}
                  </div>
                );
              })}
            </div>
            <div className="gateway">
              <div className="gateway-content">
                <div className="flex items-center justify-between"><span className="eyebrow text-[#b9adff]">Cloud event bus</span><CloudCog size={17} className="text-[#b9adff]" /></div>
                <div className="mt-2 text-[12px] font-semibold text-[#ece8ff]">Gateway online</div>
                <div className="mt-1 text-[10px] leading-relaxed text-[#a49fca]">Sensor packets route through Pub/Sub into the simulator data plane.</div>
                <div className="mt-3 flex items-center gap-2 font-mono text-[9px] text-[#72e5b0]"><span className="cloud-dot" /> LATENCY 24ms <span className="ml-auto text-[#8e86bb]">TLS OK</span></div>
              </div>
            </div>
          </section>

          <section className="panel center-panel fridge-stage ops-grid">
            <div className="panel-heading stage-label border-b-0"><div><div className="eyebrow">Simulation canvas / 01</div><h2 className="mt-1">Virtual refrigerator</h2></div><div className="font-mono text-[9px] text-[#78bfd4]">ZONE: KITCHEN.ALPHA</div></div>
            {mounted.length > 0 && <div className="connector" />}
            <div className="fridge-body" onDragOver={(event) => event.preventDefault()} onDrop={handleSensorDrop}>
              <div className="mb-3 flex items-center justify-between"><div className="door-name">TWO-DOOR COLD STORAGE</div><div className="font-mono text-[9px] text-[#79d9eb]">{mounted.length} / 5 SENSORS MOUNTED</div></div>
              <div className="fridge-doors">
                <div className="door left">
                  <div className="door-name">FRESH ZONE</div>
                  <div className="shelf-stack">
                    {shelfNames.map(({ key, label }) => <ShelfDrop key={key} shelfKey={key} label={label} items={shelves[key]} onDragOver={(event) => event.preventDefault()} onDrop={() => handleFoodDrop(key)} onDragStart={setDraggingFood} onRemove={handleRemove} renderFoodIcon={renderFoodIcon} />)}
                  </div>
                </div>
                <div className="door right">
                  <div className="door-name">DOOR STORAGE</div>
                  <div className="mt-[15px] space-y-2 text-[10px] text-[#82a8b7]">
                    <div className="rounded border border-dashed border-[#36758b] bg-[#113449]/50 p-2"><span className="font-mono text-[9px] text-[#5eaec4]">BIN A</span><div className="mt-2 h-7 rounded bg-[#1b5268]/30" /></div>
                    <div className="rounded border border-dashed border-[#36758b] bg-[#113449]/50 p-2"><span className="font-mono text-[9px] text-[#5eaec4]">BIN B</span><div className="mt-2 h-7 rounded bg-[#1b5268]/30" /></div>
                  </div>
                </div>
              </div>
              <ShelfDrop shelfKey="produce" label="BOTTOM PRODUCE DRAWER · TEMPERATURE CONTROLLED" items={shelves.produce} onDragOver={(event) => event.preventDefault()} onDrop={() => handleFoodDrop('produce')} onDragStart={setDraggingFood} onRemove={handleRemove} renderFoodIcon={renderFoodIcon} produce />
              <div className="mount-row">
                {(['tof', 'camera', 'weight'] as SensorKind[]).map((kind) => <div key={kind} className={`mount-slot ${mounted.includes(kind) ? 'filled' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={handleSensorDrop}>{mounted.includes(kind) ? <><Check size={13} /><span>{sensors.find((sensor) => sensor.kind === kind)?.name}</span></> : <><Plus size={13} /><span>DROP SENSOR</span></>}</div>)}
              </div>
            </div>
            <div className="relative z-10 mt-3 flex items-center justify-center gap-2 font-mono text-[9px] text-[#7397a6]"><span className={`status-dot ${doorOpen ? 'live text-[#72e5b0]' : 'text-[#f4c66d]'}`} /> {doorOpen ? 'LIVE SENSOR STREAM · MOVEMENT ENABLED' : 'LOCKED STATE · OPEN DOOR TO INTERACT'}</div>
          </section>

          <section className="panel right-panel">
            <div className="panel-heading"><div><div className="eyebrow">Storage queue / {drawerFoods.length}</div><h2 className="mt-1">Food item drawer</h2></div><Archive className="text-[#b9a6fb]" size={17} /></div>
            <div className="p-3">
              <div className="mb-3 rounded-md border border-[#7d67bd]/30 bg-[#4c3b81]/10 p-2.5 text-[10px] leading-relaxed text-[#b9aed9]"><Upload size={13} className="mr-1 inline text-[#b9a6fb]" /> Drag an item into a shelf to trigger recognition and Firestore sync.</div>
              <div className="drawer-divider">Packaged items <span className="ml-auto normal-case tracking-normal text-[#5f8493]">barcode required</span></div>
              <div className="drawer-items space-y-2">
                {drawerFoods.filter((food) => food.type === 'packaged').map((food) => <DrawerFoodRow key={food.key} food={food} onDragStart={setDraggingFood} />)}
                {unplacedApiItems.filter((item) => item.type === 'packaged').map((item) => <InventoryRow key={item.id} item={item} renderFoodIcon={renderFoodIcon} onDragStart={setDraggingFood} />)}
              </div>
              <div className="drawer-divider">Fresh produce <span className="ml-auto normal-case tracking-normal text-[#5f8493]">vision required</span></div>
              <div className="drawer-items space-y-2">
                {drawerFoods.filter((food) => food.type === 'produce').map((food) => <DrawerFoodRow key={food.key} food={food} onDragStart={setDraggingFood} />)}
                {unplacedApiItems.filter((item) => item.type === 'produce').map((item) => <InventoryRow key={item.id} item={item} renderFoodIcon={renderFoodIcon} onDragStart={setDraggingFood} />)}
              </div>
              <div className="mt-5 flex items-center gap-2 border-t border-[#4b7382]/20 pt-3 font-mono text-[9px] text-[#789dab]"><Radio size={12} className="text-[#72e5b0]" /> RETURN ZONE ACTIVE <span className="ml-auto">DROP TO RETURN</span></div>
              <div className="mt-2 rounded border border-dashed border-[#4b7382]/30 p-3 text-center text-[10px] text-[#668895]" onDragOver={(event) => event.preventDefault()} onDrop={() => {
                if (draggingFood && 'id' in draggingFood) handleRemove(draggingFood);
                setDraggingFood(null);
              }}>Drop fridge items here to remove from inventory</div>
            </div>
          </section>
        </div>

        <section className="bottom-panel">
          <div className="panel overflow-hidden">
            <div className="db-tabs">
              <button data-testid="tab-telemetry" className={`db-tab ${activeTab === 'telemetry' ? 'active' : ''}`} onClick={() => setActiveTab('telemetry')}><Activity size={14} /> Bigtable · telemetry stream <span className="status-dot live text-[#72e5b0]" /></button>
              <button data-testid="tab-inventory" className={`db-tab ${activeTab === 'inventory' ? 'active' : ''}`} onClick={() => setActiveTab('inventory')}><Database size={14} /> Firestore · inventory documents <span className="font-mono text-[9px] text-[#7397a6]">{inventory.length} DOCS</span></button>
            </div>
            <div className="db-content">
              {activeTab === 'telemetry' ? <TelemetryTable loading={telemetryQuery.isLoading} error={Boolean(telemetryQuery.error)} packets={telemetry} /> : <InventoryTable loading={inventoryQuery.isLoading} error={Boolean(inventoryQuery.error)} items={inventory} />}
            </div>
          </div>
        </section>
      </main>

      {toast && <div data-testid="status-activity-toast" className="activity-toast"><div className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-[#72e5b0]" /><span>{toast}</span><button data-testid="button-dismiss-toast" className="ml-2 text-[#789dab]" onClick={() => setToast(null)}><X size={14} /></button></div></div>}
      {resetOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#020d16]/75 p-4 backdrop-blur-sm"><div className="panel w-full max-w-sm p-5 shadow-2xl"><div className="flex items-start gap-3"><div className="rounded-lg bg-[#9f3348]/20 p-2 text-[#ff9aa7]"><AlertTriangle size={20} /></div><div><h3 className="font-semibold text-[#e2f7ff]">Reset simulation?</h3><p className="mt-1 text-[12px] leading-relaxed text-[#8eafbb]">This clears telemetry and inventory documents, then unmounts every sensor.</p></div></div><div className="mt-5 flex justify-end gap-2"><button data-testid="button-cancel-reset" className="btn-ops" onClick={() => setResetOpen(false)}>CANCEL</button><button data-testid="button-confirm-reset" className="btn-ops btn-danger" onClick={onReset}>RESET SYSTEM</button></div></div></div>}
    </div>
  );
}

function ShelfDrop({ shelfKey, label, items, onDragOver, onDrop, onDragStart, onRemove, renderFoodIcon, produce = false }: { shelfKey: ShelfKey; label: string; items: InventoryItem[]; onDragOver: (event: DragEvent) => void; onDrop: () => void; onDragStart: (item: InventoryItem) => void; onRemove: (item: InventoryItem) => void; renderFoodIcon: (food: InventoryItem) => ReactElement; produce?: boolean }) {
  return <div className={`shelf ${produce ? 'produce-drawer' : ''}`} data-testid={`dropzone-shelf-${shelfKey}`} onDragOver={onDragOver} onDrop={onDrop}><div className="shelf-name">{label}</div><div className="shelf-items">{items.length ? items.map((item) => <div key={item.id} draggable className={`food-chip ${item.type === 'produce' ? 'produce' : ''}`} data-testid={`fridge-item-${item.id}`} onDragStart={() => onDragStart(item)}>{renderFoodIcon(item)}<span>{item.name}</span><button data-testid={`button-remove-item-${item.id}`} onClick={() => onRemove(item)} aria-label={`Return ${item.name}`}><Trash2 size={11} /></button></div>) : <span className="mt-1 text-[9px] text-[#5c7f8d]">Drop food here</span>}</div></div>;
}

function DrawerFoodRow({ food, onDragStart }: { food: DrawerFood; onDragStart: (food: DrawerFood) => void }) {
  return <div draggable data-testid={`drawer-food-${food.key}`} className="drawer-item" onDragStart={() => onDragStart(food)}><span className={`item-orb ${food.type === 'produce' ? 'produce' : ''}`}>{food.type === 'produce' ? <Wind size={15} /> : <Package size={15} />}</span><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-[#d7f4fc]">{food.name}</div><div className="mt-0.5 font-mono text-[9px] text-[#6e9aa9]">{food.barcode ? `BARCODE ${food.barcode}` : 'UNPACKAGED · VISION'}</div></div><ChevronRight size={14} className="text-[#5f93a4]" /></div>;
}

function InventoryRow({ item, renderFoodIcon, onDragStart }: { item: InventoryItem; renderFoodIcon: (food: InventoryItem) => ReactElement; onDragStart: (item: InventoryItem) => void }) {
  return <div draggable data-testid={`drawer-inventory-${item.id}`} className="drawer-item" onDragStart={() => onDragStart(item)}>{renderFoodIcon(item)}<div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-[#d7f4fc]">{item.name}</div><div className="mt-0.5 font-mono text-[9px] text-[#72e5b0]">RETURNED FROM FRIDGE · {item.syncStatus}</div></div><ChevronRight size={14} className="text-[#5f93a4]" /></div>;
}

function TelemetryTable({ packets, loading, error }: { packets: TelemetryPacket[]; loading: boolean; error: boolean }) {
  if (loading) return <div className="p-4"><div className="loading-bar" /><div className="empty-state">Connecting to Bigtable stream…</div></div>;
  if (error) return <div className="empty-state"><div><AlertTriangle className="mx-auto mb-2 text-[#ff9aa7]" size={20} /><p className="error-copy">Telemetry stream unavailable</p><p className="mt-1 text-[10px]">Retrying on the next gateway interval</p></div></div>;
  if (!packets.length) return <div className="empty-state"><div><HardDrive className="mx-auto mb-2 text-[#6d9cac]" size={20} /><p>No packets in the current run</p><p className="mt-1 font-mono text-[9px]">Mount the environmental sensor to begin streaming</p></div></div>;
  return <table className="data-table"><thead><tr><th>Packet ID</th><th>Timestamp</th><th>Temperature</th><th>Humidity</th><th>Ethylene</th><th>Source</th></tr></thead><tbody>{packets.slice(0, 8).map((packet) => <tr key={packet.id} data-testid={`row-telemetry-${packet.id}`}><td className="font-mono text-[#75d4eb]">{packet.id.slice(0, 10)}…</td><td className="font-mono">{new Date(packet.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td>{packet.temperature.toFixed(1)}°C</td><td>{packet.humidity.toFixed(1)}%</td><td>{packet.ethylene.toFixed(3)} ppm</td><td><span className="inline-flex items-center gap-1.5 text-[#72e5b0]"><span className="cloud-dot" />{packet.source}</span></td></tr>)}</tbody></table>;
}

function InventoryTable({ items, loading, error }: { items: InventoryItem[]; loading: boolean; error: boolean }) {
  if (loading) return <div className="p-4"><div className="loading-bar" /><div className="empty-state">Reading Firestore collection…</div></div>;
  if (error) return <div className="empty-state"><div><AlertTriangle className="mx-auto mb-2 text-[#ff9aa7]" size={20} /><p className="error-copy">Inventory collection unavailable</p></div></div>;
  if (!items.length) return <div className="empty-state"><div><Server className="mx-auto mb-2 text-[#6d9cac]" size={20} /><p>Firestore inventory is empty</p><p className="mt-1 font-mono text-[9px]">Recognized items will appear here</p></div></div>;
  return <table className="data-table"><thead><tr><th>Document ID</th><th>Item name</th><th>Type</th><th>Detection</th><th>Calories</th><th>Expiration</th><th>Condition</th><th>Sync</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} data-testid={`row-inventory-${item.id}`}><td className="font-mono text-[#75d4eb]">{item.id.slice(0, 10)}…</td><td>{item.name}</td><td className="capitalize">{item.type}</td><td>{item.detectionMethod}</td><td>{item.calories} kcal</td><td>{item.expirationDate}</td><td>{item.storageCondition}</td><td><span className="inline-flex items-center gap-1.5 text-[#72e5b0]"><span className="cloud-dot" />{item.syncStatus}</span></td></tr>)}</tbody></table>;
}

function Router() {
  return <ErrorBoundary resetKey={useLocation()[0]}><Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;