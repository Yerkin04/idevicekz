import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Package, ShoppingCart, Megaphone, Calculator, Settings as SettingsIcon,
  Plus, Trash2, LogOut, AlertTriangle, Lock, Eye, EyeOff, TrendingUp,
  Wallet, Boxes, ArrowDownToLine, CheckCircle2, XCircle, RefreshCw
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";

// ---------- Supabase REST helpers ----------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://uooppxxlikptfgvdzlbe.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_ZvcLhtS9FXSwUkPJoOlqnQ_eFy7y38I";

async function sb(path, options = {}) {
  // New sb_publishable_* keys belong in the apikey header. Authorization is
  // reserved for a user JWT. Keep Bearer only for legacy JWT-based anon keys.
  const authHeaders = SUPABASE_ANON_KEY.startsWith("eyJ")
    ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    : {};
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      ...authHeaders,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let details = text || res.statusText;
    try {
      const payload = JSON.parse(text);
      details = [payload.message, payload.details, payload.hint]
        .filter(Boolean)
        .join(" · ");
    } catch {
      // Supabase can also return a plain-text error.
    }
    throw new Error(`Supabase ${res.status}: ${details}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const sbSelect = (table, query = "select=*") => sb(`${table}?${query}`);
const sbInsert = (table, row) =>
  sb(table, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
const sbUpdate = (table, id, patch) =>
  sb(`${table}?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
const sbDelete = (table, id) => sb(`${table}?id=eq.${id}`, { method: "DELETE" });

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

// ---------- FIFO ----------
function consumeFIFO(batches, productId, qtyNeeded) {
  const productBatches = batches
    .filter((b) => b.product_id === productId && b.remaining_qty > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created_at || "").localeCompare(b.created_at || "")));
  let remaining = qtyNeeded;
  let cogsTotal = 0;
  const breakdown = [];
  const changed = {}; // id -> new remaining_qty
  for (const b of productBatches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.remaining_qty);
    cogsTotal += take * b.purchase_price;
    breakdown.push({ batch_id: b.id, qty: take, price: b.purchase_price });
    remaining -= take;
    changed[b.id] = (changed[b.id] ?? b.remaining_qty) - take;
  }
  return { cogsTotal, breakdown, changed, shortfall: remaining };
}

// ---------- small UI atoms ----------
const Card = ({ children, style, className = "" }) => (
  <div
    className={`rounded-2xl p-5 ${className}`}
    style={{ background: "var(--surface)", border: "1px solid var(--border)", ...style }}
  >
    {children}
  </div>
);

const Field = ({ label, children }) => (
  <label className="flex flex-col gap-1.5 text-sm" style={{ color: "var(--muted)" }}>
    <span>{label}</span>
    {children}
  </label>
);

const inputStyle = { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" };

const TextInput = (props) => (
  <input
    {...props}
    className={`rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 ${props.className || ""}`}
    style={{ ...inputStyle, ...(props.style || {}) }}
  />
);

const SelectInput = (props) => (
  <select
    {...props}
    className={`rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 ${props.className || ""}`}
    style={{ ...inputStyle, ...(props.style || {}) }}
  >
    {props.children}
  </select>
);

const Btn = ({ children, onClick, variant = "primary", type = "button", disabled, className = "" }) => {
  const base = "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-40";
  const style =
    variant === "primary"
      ? { background: "var(--brass)", color: "#171208" }
      : variant === "danger"
      ? { background: "transparent", color: "var(--red)", border: "1px solid var(--red)" }
      : { background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)" };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${className}`} style={style}>
      {children}
    </button>
  );
};

const fmtMoney = (n, cur) => `${Math.round(n || 0).toLocaleString("ru-RU")} ${cur}`;

const Kpi = ({ icon: Icon, label, value, sub, tone = "neutral" }) => {
  const toneColor = tone === "up" ? "var(--green)" : tone === "down" ? "var(--red)" : "var(--brass)";
  return (
    <Card>
      <div className="flex items-start justify-between">
        <span className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</span>
        <Icon size={16} style={{ color: toneColor }} />
      </div>
      <div className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{sub}</div>}
    </Card>
  );
};

const Row = ({ label, value, bold, accent }) => (
  <div className="flex justify-between">
    <span style={{ color: "var(--muted)" }}>{label}</span>
    <span style={{ color: accent ? "var(--brass)" : "var(--text)", fontWeight: bold ? 600 : 400, fontFamily: "var(--font-mono)" }}>{value}</span>
  </div>
);

export default function IDeviceApp() {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState({ id: 1, password: null, currency: "₸" });
  const [authed, setAuthed] = useState(() => localStorage.getItem("idevice_authed") === "true");
  const [passInput, setPassInput] = useState("");
  const [passInput2, setPassInput2] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [authError, setAuthError] = useState("");

  const [products, setProducts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [sales, setSales] = useState([]);
  const [adSpend, setAdSpend] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [tab, setTab] = useState("dashboard");

  const loadAll = async () => {
    setLoadError("");
    try {
      const [st, p, b, sl, ad, ex, wd] = await Promise.all([
        sbSelect("app_settings", "select=*&id=eq.1"),
        sbSelect("products", "select=*&order=created_at.asc"),
        sbSelect("batches", "select=*&order=date.asc"),
        sbSelect("sales", "select=*&order=created_at.desc"),
        sbSelect("ad_spend", "select=*&order=created_at.desc"),
        sbSelect("expenses", "select=*&order=created_at.desc"),
        sbSelect("withdrawals", "select=*&order=created_at.desc"),
      ]);
      setSettings(st && st[0] ? st[0] : { id: 1, password: null, currency: "₸" });
      setProducts(p || []);
      setBatches(b || []);
      setSales(sl || []);
      setAdSpend(ad || []);
      setExpenses(ex || []);
      setWithdrawals(wd || []);
    } catch (e) {
      setLoadError(e.message || "Не удалось подключиться к Supabase");
    } finally {
      setReady(true);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // ---------- auth ----------
  const handleAuthSubmit = async () => {
    setAuthError("");
    if (!settings.password) {
      if (passInput.length < 4) return setAuthError("Пароль должен быть не короче 4 символов");
      if (passInput !== passInput2) return setAuthError("Пароли не совпадают");
      try {
        let updated;
        try {
          updated = await sbUpdate("app_settings", 1, { password: passInput });
        } catch {
          updated = await sbInsert("app_settings", { id: 1, password: passInput, currency: settings.currency || "₸" });
        }
        setSettings(updated && updated[0] ? updated[0] : { ...settings, password: passInput });
        setAuthed(true);
        localStorage.setItem("idevice_authed", "true");
      } catch (e) {
        setAuthError("Ошибка сохранения пароля: " + e.message);
      }
    } else if (passInput === settings.password) {
      setAuthed(true);
      localStorage.setItem("idevice_authed", "true");
    } else {
      setAuthError("Неверный пароль");
    }
    setPassInput(""); setPassInput2("");
  };

  // ---------- mutations ----------
  const addProduct = async (name, sku) => {
    const [row] = await sbInsert("products", { name, sku });
    setProducts((prev) => [...prev, row]);
  };
  const deleteProduct = async (id) => {
    await sbDelete("products", id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const addBatch = async (productId, qty, purchasePrice, date) => {
    const [row] = await sbInsert("batches", { product_id: productId, qty, remaining_qty: qty, purchase_price: purchasePrice, date });
    setBatches((prev) => [...prev, row]);
  };
  const deleteBatch = async (id) => {
    await sbDelete("batches", id);
    setBatches((prev) => prev.filter((b) => b.id !== id));
  };

  const addSale = async (productId, qty, salePrice, date, paymentMethod = "cash") => {
    const { cogsTotal, breakdown, changed, shortfall } = consumeFIFO(batches, productId, qty);
    if (shortfall > 0) {
      return { ok: false, error: `Недостаточно остатка: не хватает ${shortfall} шт. Сначала добавьте закупку на складе.` };
    }
    try {
      await Promise.all(Object.entries(changed).map(([id, remaining_qty]) => sbUpdate("batches", id, { remaining_qty })));
      const [saleRow] = await sbInsert("sales", {
        product_id: productId, qty, sale_price: salePrice,
        revenue: qty * salePrice, cogs: cogsTotal, profit: qty * salePrice - cogsTotal,
        breakdown, date, payment_method: paymentMethod,
      });
      setBatches((prev) => prev.map((b) => (changed[b.id] !== undefined ? { ...b, remaining_qty: changed[b.id] } : b)));
      setSales((prev) => [saleRow, ...prev]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "Ошибка записи продажи: " + e.message };
    }
  };
  const deleteSale = async (id) => {
    const sale = sales.find((s) => s.id === id);
    if (!sale) return;
    const restore = {};
    for (const line of sale.breakdown || []) {
      const b = batches.find((x) => x.id === line.batch_id);
      if (b) restore[b.id] = (restore[b.id] ?? b.remaining_qty) + line.qty;
    }
    await Promise.all(Object.entries(restore).map(([bid, remaining_qty]) => sbUpdate("batches", bid, { remaining_qty })));
    await sbDelete("sales", id);
    setBatches((prev) => prev.map((b) => (restore[b.id] !== undefined ? { ...b, remaining_qty: restore[b.id] } : b)));
    setSales((prev) => prev.filter((s) => s.id !== id));
  };

  const addAdSpend = async (date, channel, amount, leads, ordersCount, note) => {
    const [row] = await sbInsert("ad_spend", { date, channel, amount, leads, orders_count: ordersCount, note });
    setAdSpend((prev) => [row, ...prev]);
  };
  const deleteAdSpend = async (id) => { await sbDelete("ad_spend", id); setAdSpend((prev) => prev.filter((a) => a.id !== id)); };

  const addExpense = async (date, category, amount, note) => {
    const [row] = await sbInsert("expenses", { date, category, amount, note });
    setExpenses((prev) => [row, ...prev]);
  };
  const deleteExpense = async (id) => { await sbDelete("expenses", id); setExpenses((prev) => prev.filter((e) => e.id !== id)); };

  const addWithdrawal = async (date, amount, note) => {
    const [row] = await sbInsert("withdrawals", { date, amount, note });
    setWithdrawals((prev) => [row, ...prev]);
  };
  const deleteWithdrawal = async (id) => { await sbDelete("withdrawals", id); setWithdrawals((prev) => prev.filter((w) => w.id !== id)); };

  const updateSettings = async (patch) => {
    let updated;
    try {
      updated = await sbUpdate("app_settings", 1, patch);
    } catch {
      updated = await sbInsert("app_settings", { id: 1, ...settings, ...patch });
    }
    setSettings(updated && updated[0] ? updated[0] : { ...settings, ...patch });
  };

  const resetAll = async () => {
    await Promise.all([
      ...sales.map((s) => sbDelete("sales", s.id)),
      ...batches.map((b) => sbDelete("batches", b.id)),
      ...products.map((p) => sbDelete("products", p.id)),
      ...adSpend.map((a) => sbDelete("ad_spend", a.id)),
      ...expenses.map((e) => sbDelete("expenses", e.id)),
      ...withdrawals.map((w) => sbDelete("withdrawals", w.id)),
    ]);
    setProducts([]); setBatches([]); setSales([]); setAdSpend([]); setExpenses([]); setWithdrawals([]);
  };

  // ---------- aggregates ----------
  const cur = settings.currency || "₸";

  const totals = useMemo(() => {
    const revenue = sales.reduce((s, x) => s + x.revenue, 0);
    const cogs = sales.reduce((s, x) => s + x.cogs, 0);
    const ad = adSpend.reduce((s, x) => s + x.amount, 0);
    const exp = expenses.reduce((s, x) => s + x.amount, 0);
    const wd = withdrawals.reduce((s, x) => s + x.amount, 0);
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - ad - exp;
    const available = netProfit - wd;
    return { revenue, cogs, ad, exp, wd, grossProfit, netProfit, available };
  }, [sales, adSpend, expenses, withdrawals]);

  const today = todayStr();
  const todayAgg = useMemo(() => {
    const t = sales.filter((s) => s.date === today);
    return { count: t.length, revenue: t.reduce((s, x) => s + x.revenue, 0), profit: t.reduce((s, x) => s + x.profit, 0) };
  }, [sales, today]);

  const monthAgg = useMemo(() => {
    const ym = today.slice(0, 7);
    const m = sales.filter((s) => s.date.slice(0, 7) === ym);
    return { count: m.length, revenue: m.reduce((s, x) => s + x.revenue, 0), profit: m.reduce((s, x) => s + x.profit, 0) };
  }, [sales, today]);

  const inventory = useMemo(() => {
    return products.map((p) => {
      const pb = batches.filter((b) => b.product_id === p.id);
      const qty = pb.reduce((s, b) => s + b.remaining_qty, 0);
      const value = pb.reduce((s, b) => s + b.remaining_qty * b.purchase_price, 0);
      return { ...p, batches: pb, qty, value, avgCost: qty > 0 ? value / qty : 0 };
    });
  }, [products, batches]);

  const totalStockQty = inventory.reduce((s, p) => s + p.qty, 0);
  const totalStockValue = inventory.reduce((s, p) => s + p.value, 0);
  const lowStock = inventory.filter((p) => p.qty > 0 && p.qty <= 3);
  const outOfStock = inventory.filter((p) => p.qty === 0 && p.batches.length > 0);

  const chartData = useMemo(() => {
    const arr = [];
    for (let i = 13; i >= 0; i--) {
      const d = daysAgoStr(i);
      const day = sales.filter((s) => s.date === d);
      arr.push({ date: d.slice(5), revenue: day.reduce((s, x) => s + x.revenue, 0), profit: day.reduce((s, x) => s + x.profit, 0) });
    }
    return arr;
  }, [sales]);

  const totalUnits = sales.reduce((s, x) => s + x.qty, 0);
  const avgCheck = totalUnits ? totals.revenue / totalUnits : 0;
  const avgCogsPerUnit = totalUnits ? totals.cogs / totalUnits : 0;

  // ================= RENDER =================
  if (!ready) {
    return <Root><div className="flex items-center justify-center h-full py-24 text-sm" style={{ color: "var(--muted)" }}>Подключение к базе…</div></Root>;
  }

  if (loadError) {
    return (
      <Root>
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-4">
          <AlertTriangle size={28} style={{ color: "var(--red)" }} />
          <div className="text-sm font-medium" style={{ color: "var(--text)" }}>Не удалось подключиться к Supabase</div>
          <div className="text-xs max-w-sm" style={{ color: "var(--muted)" }}>{loadError}</div>
          <div className="text-xs max-w-sm" style={{ color: "var(--muted)" }}>
            Проверь, что таблицы созданы и выполнен GRANT-запрос для роли anon.
          </div>
          <Btn onClick={loadAll}><RefreshCw size={14} /> Повторить</Btn>
        </div>
      </Root>
    );
  }

  if (!authed) {
    const firstRun = !settings.password;
    return (
      <Root>
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="mb-6 flex flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-semibold" style={{ background: "var(--brass)", color: "#171208", fontFamily: "var(--font-display)" }}>iD</div>
            <div className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}>iDevice — панель управления</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>{firstRun ? "Задайте пароль для доступа" : "Введите пароль, чтобы продолжить"}</div>
          </div>
          <Card className="w-full max-w-xs">
            <div className="flex flex-col gap-3">
              <Field label={firstRun ? "Новый пароль" : "Пароль"}>
                <div className="relative">
                  <TextInput type={showPass ? "text" : "password"} value={passInput} onChange={(e) => setPassInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !firstRun && handleAuthSubmit()} className="w-full pr-9" autoFocus />
                  <button onClick={() => setShowPass((v) => !v)} className="absolute right-2.5 top-2.5" style={{ color: "var(--muted)" }} type="button">
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>
              {firstRun && (
                <Field label="Повторите пароль">
                  <TextInput type={showPass ? "text" : "password"} value={passInput2} onChange={(e) => setPassInput2(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAuthSubmit()} className="w-full" />
                </Field>
              )}
              {authError && <div className="text-xs flex items-center gap-1.5" style={{ color: "var(--red)" }}><AlertTriangle size={13} /> {authError}</div>}
              <Btn onClick={handleAuthSubmit} className="w-full justify-center mt-1"><Lock size={14} /> {firstRun ? "Создать и войти" : "Войти"}</Btn>
            </div>
          </Card>
        </div>
      </Root>
    );
  }

  const NAV = [
    { id: "dashboard", label: "Дашборд", icon: LayoutDashboard },
    { id: "inventory", label: "Склад", icon: Package },
    { id: "sales", label: "Продажи", icon: ShoppingCart },
    { id: "marketing", label: "Реклама и расходы", icon: Megaphone },
    { id: "cac", label: "CAC калькулятор", icon: Calculator },
    { id: "settings", label: "Настройки", icon: SettingsIcon },
  ];

  return (
    <Root>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold" style={{ background: "var(--brass)", color: "#171208", fontFamily: "var(--font-display)" }}>iD</div>
          <div>
            <div className="text-sm font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--text)" }}>iDevice</div>
            <div className="text-[11px]" style={{ color: "var(--muted)" }}>Панель основателя · Supabase</div>
          </div>
        </div>
        <button onClick={() => { setAuthed(false); localStorage.removeItem("idevice_authed"); }} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg" style={{ color: "var(--muted)", border: "1px solid var(--border)" }}>
          <LogOut size={13} /> Выйти
        </button>
      </div>

      <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
        {NAV.map((n) => {
          const Icon = n.icon; const active = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)} className="flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition"
              style={active ? { background: "var(--brass)", color: "#171208" } : { background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border)" }}>
              <Icon size={13} /> {n.label}
            </button>
          );
        })}
      </div>

      {tab === "dashboard" && (
        <DashboardTab cur={cur} totals={totals} todayAgg={todayAgg} monthAgg={monthAgg}
          totalStockQty={totalStockQty} totalStockValue={totalStockValue} lowStock={lowStock} outOfStock={outOfStock} chartData={chartData} />
      )}
      {tab === "inventory" && (
        <InventoryTab cur={cur} products={products} inventory={inventory} addProduct={addProduct} deleteProduct={deleteProduct} addBatch={addBatch} deleteBatch={deleteBatch} />
      )}
      {tab === "sales" && (
        <SalesTab cur={cur} products={products} sales={sales} inventory={inventory} addSale={addSale} deleteSale={deleteSale} />
      )}
      {tab === "marketing" && (
        <MarketingTab cur={cur} adSpend={adSpend} expenses={expenses} withdrawals={withdrawals}
          addAdSpend={addAdSpend} deleteAdSpend={deleteAdSpend} addExpense={addExpense} deleteExpense={deleteExpense}
          addWithdrawal={addWithdrawal} deleteWithdrawal={deleteWithdrawal} available={totals.available} />
      )}
      {tab === "cac" && <CacTab cur={cur} avgCheck={avgCheck} avgCogsPerUnit={avgCogsPerUnit} adSpend={adSpend} />}
      {tab === "settings" && <SettingsTab settings={settings} updateSettings={updateSettings} resetAll={resetAll} />}
    </Root>
  );
}

function Root({ children }) {
  return (
    <div className="min-h-full w-full px-4 py-5 sm:px-6" style={{
      "--bg": "#101315", "--surface": "#171B1D", "--surface2": "#1D2225", "--border": "#282E31",
      "--text": "#EDEAE3", "--muted": "#8B9296", "--brass": "#C9A35C", "--green": "#6FCF97", "--red": "#E2604A",
      "--font-display": "'Space Grotesk', sans-serif", "--font-body": "'Inter', sans-serif", "--font-mono": "'JetBrains Mono', monospace",
      background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-body)",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::placeholder { color: #5C6265; }
      `}</style>
      <div className="max-w-6xl mx-auto">{children}</div>
    </div>
  );
}

function DashboardTab({ cur, totals, todayAgg, monthAgg, totalStockQty, totalStockValue, lowStock, outOfStock, chartData }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={TrendingUp} label="Продажи сегодня" value={fmtMoney(todayAgg.revenue, cur)} sub={`${todayAgg.count} шт · прибыль ${fmtMoney(todayAgg.profit, cur)}`} tone="up" />
        <Kpi icon={TrendingUp} label="Продажи за месяц" value={fmtMoney(monthAgg.revenue, cur)} sub={`${monthAgg.count} шт · прибыль ${fmtMoney(monthAgg.profit, cur)}`} tone="up" />
        <Kpi icon={Boxes} label="Остаток на складе" value={`${totalStockQty} шт`} sub={`на сумму ${fmtMoney(totalStockValue, cur)}`} />
        <Kpi icon={Wallet} label="Доступно к выводу" value={fmtMoney(totals.available, cur)} sub="продажи − себестоимость − реклама − расходы − выводы" tone={totals.available >= 0 ? "up" : "down"} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="text-sm font-medium mb-4" style={{ color: "var(--text)" }}>Выручка и прибыль за 14 дней</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#C9A35C" stopOpacity={0.35} /><stop offset="100%" stopColor="#C9A35C" stopOpacity={0} /></linearGradient>
                  <linearGradient id="prof" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6FCF97" stopOpacity={0.35} /><stop offset="100%" stopColor="#6FCF97" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#282E31" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#8B9296", fontSize: 11 }} axisLine={{ stroke: "#282E31" }} tickLine={false} />
                <YAxis tick={{ fill: "#8B9296", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={{ background: "#1D2225", border: "1px solid #282E31", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#EDEAE3" }}
                  formatter={(v, name) => [fmtMoney(v, cur), name === "revenue" ? "Выручка" : "Прибыль"]} />
                <Area type="monotone" dataKey="revenue" stroke="#C9A35C" fill="url(#rev)" strokeWidth={2} />
                <Area type="monotone" dataKey="profit" stroke="#6FCF97" fill="url(#prof)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="text-sm font-medium mb-3" style={{ color: "var(--text)" }}>Итоги (всё время)</div>
          <div className="flex flex-col gap-2 text-sm">
            <Row label="Выручка" value={fmtMoney(totals.revenue, cur)} />
            <Row label="Себестоимость" value={`− ${fmtMoney(totals.cogs, cur)}`} />
            <Row label="Валовая прибыль" value={fmtMoney(totals.grossProfit, cur)} bold />
            <Row label="Реклама" value={`− ${fmtMoney(totals.ad, cur)}`} />
            <Row label="Прочие расходы" value={`− ${fmtMoney(totals.exp, cur)}`} />
            <Row label="Чистая прибыль" value={fmtMoney(totals.netProfit, cur)} bold />
            <Row label="Уже выведено" value={`− ${fmtMoney(totals.wd, cur)}`} />
            <div className="h-px my-1" style={{ background: "var(--border)" }} />
            <Row label="Доступно к выводу" value={fmtMoney(totals.available, cur)} bold accent />
          </div>
        </Card>
      </div>
      {(lowStock.length > 0 || outOfStock.length > 0) && (
        <Card>
          <div className="flex items-center gap-2 text-sm font-medium mb-3" style={{ color: "var(--red)" }}><AlertTriangle size={15} /> Требует внимания</div>
          <div className="flex flex-col gap-1.5 text-sm">
            {outOfStock.map((p) => <div key={p.id} className="flex justify-between"><span style={{ color: "var(--text)" }}>{p.name}</span><span style={{ color: "var(--red)" }}>нет в наличии</span></div>)}
            {lowStock.map((p) => <div key={p.id} className="flex justify-between"><span style={{ color: "var(--text)" }}>{p.name}</span><span style={{ color: "var(--brass)" }}>осталось {p.qty} шт</span></div>)}
          </div>
        </Card>
      )}
    </div>
  );
}

function InventoryTab({ cur, products, inventory, addProduct, deleteProduct, addBatch, deleteBatch }) {
  const [name, setName] = useState(""); const [sku, setSku] = useState("");
  const [batchProduct, setBatchProduct] = useState(""); const [batchQty, setBatchQty] = useState("");
  const [batchPrice, setBatchPrice] = useState(""); const [batchDate, setBatchDate] = useState(todayStr());
  const [productBusy, setProductBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [productMessage, setProductMessage] = useState(null);
  const [batchMessage, setBatchMessage] = useState(null);

  useEffect(() => { if (!batchProduct && products.length) setBatchProduct(products[0].id); }, [products, batchProduct]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="text-sm font-medium mb-3">Новая модель</div>
          <div className="flex flex-col gap-3">
            <Field label="Название (например AirPods Pro 2)"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Артикул / SKU (необязательно)"><TextInput value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
            {productMessage && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-1.5 text-xs"
                style={{ color: productMessage.type === "success" ? "var(--green)" : "var(--red)" }}
              >
                {productMessage.type === "success" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span>{productMessage.text}</span>
              </div>
            )}
            <Btn disabled={productBusy} onClick={async () => {
              setProductMessage(null);
              if (!name.trim()) {
                setProductMessage({ type: "error", text: "Введите название модели." });
                return;
              }
              setProductBusy(true);
              try {
                await addProduct(name.trim(), sku.trim());
                setName("");
                setSku("");
                setProductMessage({ type: "success", text: "Модель добавлена на склад." });
              } catch (error) {
                console.error("Не удалось добавить модель:", error);
                setProductMessage({
                  type: "error",
                  text: `Не удалось добавить модель: ${error?.message || "неизвестная ошибка"}`,
                });
              } finally {
                setProductBusy(false);
              }
            }} className="self-start"><Plus size={14} /> {productBusy ? "Добавление…" : "Добавить модель"}</Btn>
          </div>
        </Card>
        <Card>
          <div className="text-sm font-medium mb-3">Новая закупка (партия)</div>
          {products.length === 0 ? (
            <div className="text-xs" style={{ color: "var(--muted)" }}>Сначала добавьте хотя бы одну модель товара.</div>
          ) : (
            <div className="flex flex-col gap-3">
              <Field label="Модель"><SelectInput value={batchProduct} onChange={(e) => setBatchProduct(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectInput></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Кол-во, шт"><TextInput type="number" min="1" value={batchQty} onChange={(e) => setBatchQty(e.target.value)} /></Field>
                <Field label={`Цена закупки за шт, ${cur}`}><TextInput type="number" min="0" value={batchPrice} onChange={(e) => setBatchPrice(e.target.value)} /></Field>
              </div>
              <Field label="Дата закупки"><TextInput type="date" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} /></Field>
              {batchMessage && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-start gap-1.5 text-xs"
                  style={{ color: batchMessage.type === "success" ? "var(--green)" : "var(--red)" }}
                >
                  {batchMessage.type === "success" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  <span>{batchMessage.text}</span>
                </div>
              )}
              <Btn disabled={batchBusy} onClick={async () => {
                setBatchMessage(null);
                const qty = Number(batchQty), price = Number(batchPrice);
                if (!batchProduct) {
                  setBatchMessage({ type: "error", text: "Выберите модель товара." });
                  return;
                }
                if (!batchQty || !Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
                  setBatchMessage({ type: "error", text: "Количество должно быть целым числом больше нуля." });
                  return;
                }
                if (batchPrice === "" || !Number.isFinite(price) || price < 0) {
                  setBatchMessage({ type: "error", text: "Укажите корректную цену закупки." });
                  return;
                }
                if (!batchDate) {
                  setBatchMessage({ type: "error", text: "Укажите дату закупки." });
                  return;
                }
                setBatchBusy(true);
                try {
                  await addBatch(batchProduct, qty, price, batchDate);
                  setBatchQty("");
                  setBatchPrice("");
                  setBatchMessage({ type: "success", text: "Партия добавлена на склад." });
                } catch (error) {
                  console.error("Не удалось добавить партию:", error);
                  setBatchMessage({
                    type: "error",
                    text: `Не удалось добавить партию: ${error?.message || "неизвестная ошибка"}`,
                  });
                } finally {
                  setBatchBusy(false);
                }
              }} className="self-start"><Plus size={14} /> {batchBusy ? "Добавление…" : "Добавить партию"}</Btn>
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {inventory.length === 0 && <Card><div className="text-sm" style={{ color: "var(--muted)" }}>Пока нет ни одной модели на складе.</div></Card>}
        {inventory.map((p) => {
          const maxQty = p.batches.reduce((s, b) => s + b.qty, 0) || 1;
          return (
            <Card key={p.id}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{p.name}</div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>{p.sku ? `SKU ${p.sku} · ` : ""}остаток {p.qty} шт · ср. себестоимость {fmtMoney(p.avgCost, cur)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm font-medium" style={{ fontFamily: "var(--font-mono)", color: "var(--brass)" }}>{fmtMoney(p.value, cur)}</div>
                  <button onClick={() => deleteProduct(p.id)} style={{ color: "var(--muted)" }}><Trash2 size={14} /></button>
                </div>
              </div>
              {p.batches.length > 0 && (
                <div className="flex h-3 w-full overflow-hidden rounded-full mb-3" style={{ background: "var(--surface2)" }}>
                  {p.batches.map((b, i) => (
                    <div key={b.id} title={`${b.date}: остаток ${b.remaining_qty}/${b.qty} по ${fmtMoney(b.purchase_price, cur)}`}
                      style={{ width: `${(b.qty / maxQty) * 100}%`, background: i % 2 === 0 ? "var(--brass)" : "#B08C48", opacity: b.qty > 0 ? Math.max(0.25, b.remaining_qty / b.qty) : 0.15 }} />
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {p.batches.map((b) => (
                  <div key={b.id} className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
                    <span>{b.date} · закупка {b.qty} шт по {fmtMoney(b.purchase_price, cur)}</span>
                    <span className="flex items-center gap-2">
                      <span style={{ color: b.remaining_qty === 0 ? "var(--muted)" : "var(--text)" }}>остаток {b.remaining_qty}</span>
                      <button onClick={() => deleteBatch(b.id)} style={{ color: "var(--muted)" }}><Trash2 size={12} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SalesTab({ cur, products, sales, inventory, addSale, deleteSale }) {
  const [productId, setProductId] = useState(""); const [qty, setQty] = useState("1");
  const [price, setPrice] = useState(""); const [date, setDate] = useState(todayStr());
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => { if (!productId && products.length) setProductId(products[0].id); }, [products, productId]);
  const stockFor = (id) => inventory.find((p) => p.id === id)?.qty ?? 0;

  const paymentLabels = { cash: "Наличные", kaspi_gold: "Kaspi Gold", kaspi_red: "Kaspi Red", installment: "Рассрочка", halyk: "Halyk" };

  const submit = async () => {
    setError("");
    const q = Number(qty), pr = Number(price);
    if (!productId || q <= 0 || pr < 0) return;
    setBusy(true);
    try {
      const res = await addSale(productId, q, pr, date, paymentMethod);
      if (!res.ok) { setError(res.error); return; }
      setQty("1"); setPrice("");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="text-sm font-medium mb-3">Новая продажа</div>
        {products.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>Сначала добавьте модели и закупки на складе.</div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Модель"><SelectInput value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name} (в наличии {stockFor(p.id)})</option>)}</SelectInput></Field>
            <Field label="Кол-во"><TextInput type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="w-20" /></Field>
            <Field label={`Цена продажи, ${cur}`}><TextInput type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="w-32" /></Field>
            <Field label="Дата"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Оплата">
              <SelectInput value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="cash">Наличные</option>
                <option value="kaspi_gold">Kaspi Gold</option>
                <option value="kaspi_red">Kaspi Red</option>
                <option value="installment">Рассрочка</option>
                <option value="halyk">Halyk</option>
              </SelectInput>
            </Field>
            <Btn disabled={busy} onClick={submit}><Plus size={14} /> Записать продажу</Btn>
          </div>
        )}
        {error && <div className="mt-3 text-xs flex items-center gap-1.5" style={{ color: "var(--red)" }}><AlertTriangle size={13} /> {error}</div>}
      </Card>
      <Card>
        <div className="text-sm font-medium mb-3">История продаж</div>
        {sales.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>Продаж пока нет.</div>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <div className="grid grid-cols-[1fr_50px_90px_90px_90px_80px_30px] gap-2 text-[11px] uppercase tracking-wide pb-2" style={{ color: "var(--muted)" }}>
              <span>Модель</span><span>Кол-во</span><span>Выручка</span><span>Себест.</span><span>Прибыль</span><span>Оплата</span><span></span>
            </div>
            {(() => {
              const sorted = [...sales].sort((a, b) => b.date.localeCompare(a.date));
              const groups = [];
              sorted.forEach((s) => {
                const last = groups[groups.length - 1];
                if (last && last.date === s.date) last.items.push(s);
                else groups.push({ date: s.date, items: [s] });
              });
              return groups.map((g) => {
                const dayQty = g.items.reduce((sum, s) => sum + s.qty, 0);
                const dayRevenue = g.items.reduce((sum, s) => sum + s.revenue, 0);
                const dayProfit = g.items.reduce((sum, s) => sum + s.profit, 0);
                return (
                  <div key={g.date} className="mt-3 first:mt-0">
                    <div className="flex items-center justify-between px-2 py-1.5 rounded-md mb-1" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{g.date}</span>
                      <span className="text-[11px]" style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                        {dayQty} шт · выручка {fmtMoney(dayRevenue, cur)} · прибыль {fmtMoney(dayProfit, cur)}
                      </span>
                    </div>
                    {g.items.map((s) => {
                      const pName = products.find((p) => p.id === s.product_id)?.name || "—";
                      return (
                        <div key={s.id} className="grid grid-cols-[1fr_50px_90px_90px_90px_80px_30px] gap-2 items-center py-1.5" style={{ borderTop: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                          <span style={{ fontFamily: "var(--font-body)", color: "var(--text)" }}>{pName}</span>
                          <span>{s.qty}</span><span>{fmtMoney(s.revenue, cur)}</span>
                          <span style={{ color: "var(--muted)" }}>{fmtMoney(s.cogs, cur)}</span>
                          <span style={{ color: s.profit >= 0 ? "var(--green)" : "var(--red)" }}>{fmtMoney(s.profit, cur)}</span>
                          <span style={{ color: "var(--muted)", fontFamily: "var(--font-body)" }}>{paymentLabels[s.payment_method] || s.payment_method || "—"}</span>
                          <button onClick={() => deleteSale(s.id)} style={{ color: "var(--muted)" }}><Trash2 size={12} /></button>
                        </div>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </Card>
    </div>
  );
}

function MarketingTab({ cur, adSpend, expenses, withdrawals, addAdSpend, deleteAdSpend, addExpense, deleteExpense, addWithdrawal, deleteWithdrawal, available }) {
  const [adDate, setAdDate] = useState(todayStr()); const [channel, setChannel] = useState("Instagram");
  const [amount, setAmount] = useState(""); const [leads, setLeads] = useState(""); const [orders, setOrders] = useState(""); const [note, setNote] = useState("");
  const [expDate, setExpDate] = useState(todayStr()); const [expCat, setExpCat] = useState("Аренда");
  const [expAmount, setExpAmount] = useState(""); const [expNote, setExpNote] = useState("");
  const [wdDate, setWdDate] = useState(todayStr()); const [wdAmount, setWdAmount] = useState(""); const [wdNote, setWdNote] = useState("");

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="text-sm font-medium mb-3 flex items-center gap-1.5"><Megaphone size={14} /> Реклама</div>
          <div className="flex flex-col gap-3">
            <Field label="Дата"><TextInput type="date" value={adDate} onChange={(e) => setAdDate(e.target.value)} /></Field>
            <Field label="Канал"><SelectInput value={channel} onChange={(e) => setChannel(e.target.value)}><option>Instagram</option><option>TikTok</option><option>Google</option><option>Telegram</option><option>Другое</option></SelectInput></Field>
            <Field label={`Бюджет, ${cur}`}><TextInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Заявки"><TextInput type="number" value={leads} onChange={(e) => setLeads(e.target.value)} /></Field>
              <Field label="Продажи"><TextInput type="number" value={orders} onChange={(e) => setOrders(e.target.value)} /></Field>
            </div>
            <Field label="Заметка"><TextInput value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Btn onClick={async () => { const a = Number(amount); if (a <= 0) return; await addAdSpend(adDate, channel, a, Number(leads) || 0, Number(orders) || 0, note); setAmount(""); setLeads(""); setOrders(""); setNote(""); }} className="self-start"><Plus size={14} /> Добавить</Btn>
          </div>
        </Card>
        <Card>
          <div className="text-sm font-medium mb-3">Прочие расходы</div>
          <div className="flex flex-col gap-3">
            <Field label="Дата"><TextInput type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} /></Field>
            <Field label="Категория"><SelectInput value={expCat} onChange={(e) => setExpCat(e.target.value)}><option>Аренда</option><option>Зарплата</option><option>Логистика</option><option>Упаковка</option><option>Комиссии</option><option>Другое</option></SelectInput></Field>
            <Field label={`Сумма, ${cur}`}><TextInput type="number" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} /></Field>
            <Field label="Заметка"><TextInput value={expNote} onChange={(e) => setExpNote(e.target.value)} /></Field>
            <Btn onClick={async () => { const a = Number(expAmount); if (a <= 0) return; await addExpense(expDate, expCat, a, expNote); setExpAmount(""); setExpNote(""); }} className="self-start"><Plus size={14} /> Добавить</Btn>
          </div>
        </Card>
        <Card>
          <div className="text-sm font-medium mb-3 flex items-center gap-1.5"><ArrowDownToLine size={14} /> Вывод средств</div>
          <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>Доступно сейчас: <b style={{ color: "var(--brass)" }}>{fmtMoney(available, cur)}</b></div>
          <div className="flex flex-col gap-3">
            <Field label="Дата"><TextInput type="date" value={wdDate} onChange={(e) => setWdDate(e.target.value)} /></Field>
            <Field label={`Сумма, ${cur}`}><TextInput type="number" value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} /></Field>
            <Field label="Заметка"><TextInput value={wdNote} onChange={(e) => setWdNote(e.target.value)} /></Field>
            <Btn onClick={async () => { const a = Number(wdAmount); if (a <= 0) return; await addWithdrawal(wdDate, a, wdNote); setWdAmount(""); setWdNote(""); }} className="self-start"><Plus size={14} /> Вывести</Btn>
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ListCard title="История рекламы" cur={cur} rows={adSpend.map((a) => ({ id: a.id, date: a.date, main: a.channel, amount: a.amount, sub: `${a.leads || 0} заявок · ${a.orders_count || 0} продаж${a.note ? " · " + a.note : ""}` }))} onDelete={deleteAdSpend} />
        <ListCard title="История расходов" cur={cur} rows={expenses.map((e) => ({ id: e.id, date: e.date, main: e.category, amount: e.amount, sub: e.note }))} onDelete={deleteExpense} />
        <ListCard title="История выводов" cur={cur} rows={withdrawals.map((w) => ({ id: w.id, date: w.date, main: "Вывод", amount: w.amount, sub: w.note }))} onDelete={deleteWithdrawal} />
      </div>
    </div>
  );
}

function ListCard({ title, cur, rows, onDelete }) {
  return (
    <Card>
      <div className="text-sm font-medium mb-3">{title}</div>
      {rows.length === 0 ? <div className="text-xs" style={{ color: "var(--muted)" }}>Записей пока нет.</div> : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start justify-between text-xs pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <div><div style={{ color: "var(--text)" }}>{r.main}</div><div style={{ color: "var(--muted)" }}>{r.date}{r.sub ? ` · ${r.sub}` : ""}</div></div>
              <div className="flex items-center gap-2">
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--brass)" }}>{fmtMoney(r.amount, cur)}</span>
                <button onClick={() => onDelete(r.id)} style={{ color: "var(--muted)" }}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CacTab({ cur, avgCheck, avgCogsPerUnit, adSpend }) {
  const [mode, setMode] = useState("plan");
  const [budget, setBudget] = useState("300000"); const [cpl, setCpl] = useState("1500"); const [conv, setConv] = useState("25");
  const [check, setCheck] = useState(Math.round(avgCheck) || 25000); const [cogs, setCogs] = useState(Math.round(avgCogsPerUnit) || 15000);
  const [factBudget, setFactBudget] = useState("300000"); const [factLeads, setFactLeads] = useState(""); const [factOrders, setFactOrders] = useState("");

  const plan = useMemo(() => {
    const b = Number(budget) || 0, c = Number(cpl) || 0, cv = (Number(conv) || 0) / 100;
    const leadsCount = c > 0 ? b / c : 0; const salesCount = leadsCount * cv;
    const cac = salesCount > 0 ? b / salesCount : 0;
    const revenue = salesCount * (Number(check) || 0);
    const marginPerUnit = (Number(check) || 0) - (Number(cogs) || 0);
    const grossProfit = salesCount * marginPerUnit; const netCampaignProfit = grossProfit - b;
    const romi = b > 0 ? (netCampaignProfit / b) * 100 : 0;
    return { leadsCount, salesCount, cac, revenue, marginPerUnit, grossProfit, netCampaignProfit, romi };
  }, [budget, cpl, conv, check, cogs]);

  const fact = useMemo(() => {
    const b = Number(factBudget) || 0, l = Number(factLeads) || 0, o = Number(factOrders) || 0;
    return { cplFact: l > 0 ? b / l : 0, convFact: l > 0 ? (o / l) * 100 : 0, cacFact: o > 0 ? b / o : 0 };
  }, [factBudget, factLeads, factOrders]);

  const adTotals30 = useMemo(() => {
    const cutoff = daysAgoStr(30);
    const recent = adSpend.filter((a) => a.date >= cutoff);
    const b = recent.reduce((s, a) => s + a.amount, 0);
    const l = recent.reduce((s, a) => s + (a.leads || 0), 0);
    const o = recent.reduce((s, a) => s + (a.orders_count || 0), 0);
    return { b, l, o, cac: o > 0 ? b / o : 0 };
  }, [adSpend]);

  const viable = plan.cac <= plan.marginPerUnit && plan.marginPerUnit > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2">
        <Btn variant={mode === "plan" ? "primary" : "secondary"} onClick={() => setMode("plan")}>Планирование</Btn>
        <Btn variant={mode === "fact" ? "primary" : "secondary"} onClick={() => setMode("fact")}>Расчёт по факту</Btn>
      </div>
      {mode === "plan" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="text-sm font-medium mb-3">Вводные</div>
            <div className="flex flex-col gap-3">
              <Field label={`Рекламный бюджет, ${cur}`}><TextInput type="number" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
              <Field label={`Цена за заявку (CPL), ${cur}`}><TextInput type="number" value={cpl} onChange={(e) => setCpl(e.target.value)} /></Field>
              <Field label="Конверсия заявка → продажа, %"><TextInput type="number" value={conv} onChange={(e) => setConv(e.target.value)} /></Field>
              <Field label={`Средний чек, ${cur}`}><TextInput type="number" value={check} onChange={(e) => setCheck(e.target.value)} /></Field>
              <Field label={`Себестоимость единицы, ${cur}`}><TextInput type="number" value={cogs} onChange={(e) => setCogs(e.target.value)} /></Field>
            </div>
          </Card>
          <Card>
            <div className="text-sm font-medium mb-3">Результат</div>
            <div className="flex flex-col gap-2 text-sm mb-4">
              <Row label="Заявок" value={plan.leadsCount.toFixed(1)} />
              <Row label="Продаж" value={plan.salesCount.toFixed(1)} />
              <Row label="CAC (цена клиента)" value={fmtMoney(plan.cac, cur)} bold accent />
              <Row label="Маржа с единицы" value={fmtMoney(plan.marginPerUnit, cur)} />
              <Row label="Выручка от кампании" value={fmtMoney(plan.revenue, cur)} />
              <Row label="Прибыль после рекламы" value={fmtMoney(plan.netCampaignProfit, cur)} bold />
              <Row label="ROMI" value={`${plan.romi.toFixed(0)}%`} />
            </div>
            <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: viable ? "#1C2A22" : "#2A1D1A", color: viable ? "var(--green)" : "var(--red)" }}>
              {viable ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {viable ? "CAC ниже маржи с единицы — кампания окупает рекламу." : "CAC выше маржи с единицы (или маржа отрицательна) — реклама съедает прибыль."}
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="text-sm font-medium mb-3">Фактические данные за период</div>
            <div className="flex flex-col gap-3">
              <Field label={`Потрачено на рекламу, ${cur}`}><TextInput type="number" value={factBudget} onChange={(e) => setFactBudget(e.target.value)} /></Field>
              <Field label="Получено заявок"><TextInput type="number" value={factLeads} onChange={(e) => setFactLeads(e.target.value)} /></Field>
              <Field label="Закрыто продаж"><TextInput type="number" value={factOrders} onChange={(e) => setFactOrders(e.target.value)} /></Field>
            </div>
          </Card>
          <Card>
            <div className="text-sm font-medium mb-3">Фактические показатели</div>
            <div className="flex flex-col gap-2 text-sm mb-4">
              <Row label="Цена заявки (CPL)" value={fmtMoney(fact.cplFact, cur)} />
              <Row label="Конверсия в продажу" value={`${fact.convFact.toFixed(1)}%`} />
              <Row label="CAC (цена клиента)" value={fmtMoney(fact.cacFact, cur)} bold accent />
            </div>
            {adTotals30.b > 0 && (
              <div className="text-xs rounded-lg px-3 py-2.5" style={{ background: "var(--surface2)", color: "var(--muted)" }}>
                За последние 30 дней в разделе «Реклама и расходы» указано: бюджет {fmtMoney(adTotals30.b, cur)}, {adTotals30.l} заявок, {adTotals30.o} продаж{adTotals30.o > 0 && <> → реальный CAC {fmtMoney(adTotals30.cac, cur)}</>}.
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ settings, updateSettings, resetAll }) {
  const [newPass, setNewPass] = useState(""); const [currency, setCurrency] = useState(settings.currency);
  const [confirmReset, setConfirmReset] = useState(false); const [savedMsg, setSavedMsg] = useState("");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <div className="text-sm font-medium mb-3">Общие настройки</div>
        <div className="flex flex-col gap-3">
          <Field label="Валюта (символ)"><TextInput value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24" /></Field>
          <Field label="Новый пароль (оставьте пустым, чтобы не менять)"><TextInput type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} /></Field>
          <Btn onClick={async () => {
            const patch = { currency: currency || "₸" };
            if (newPass.trim().length >= 4) patch.password = newPass.trim();
            await updateSettings(patch); setNewPass(""); setSavedMsg("Сохранено"); setTimeout(() => setSavedMsg(""), 2000);
          }} className="self-start">Сохранить</Btn>
          {savedMsg && <div className="text-xs" style={{ color: "var(--green)" }}>{savedMsg}</div>}
        </div>
      </Card>
      <Card style={{ borderColor: "var(--red)" }}>
        <div className="text-sm font-medium mb-3" style={{ color: "var(--red)" }}>Опасная зона</div>
        <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>Полностью удалит склад, продажи, рекламу, расходы и выводы в базе. Пароль и валюта останутся.</div>
        {!confirmReset ? <Btn variant="danger" onClick={() => setConfirmReset(true)}>Сбросить все данные</Btn> : (
          <div className="flex gap-2">
            <Btn variant="danger" onClick={() => { resetAll(); setConfirmReset(false); }}>Да, удалить всё</Btn>
            <Btn variant="secondary" onClick={() => setConfirmReset(false)}>Отмена</Btn>
          </div>
        )}
      </Card>
    </div>
  );
}
