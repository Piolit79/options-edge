import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { fmt, fmtPct, gainLoss } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Play, Square, RefreshCw, Zap, ShieldAlert, Bot, FlaskConical } from 'lucide-react';

interface Settings {
  auto_enabled: string;
  mode: string;
  max_positions: string;
  profit_target_pct: string;
  stop_loss_pct: string;
  virtual_balance: string;
  min_conviction: string;
}

interface AutoOrder {
  id: string; ticker: string; strike: number; expiration: string;
  option_type: string; contracts: number; entry_price: number;
  signal_type: string; conviction: number; risk_pct: number;
  status: string; simulated: boolean; current_price?: number;
  pnl_dollars?: number; pnl_pct?: number; close_reason?: string;
  opened_at: string; closed_at?: string;
}

const SIGNAL_LABELS: Record<string, string> = {
  momentum_dip: 'Momentum Dip',
  breakout: 'Breakout',
  oversold_uptrend: 'Oversold',
};

const CONVICTION_LABELS: Record<number, string> = { 3: 'High', 2: 'Medium', 1: 'Low' };
const CONVICTION_COLORS: Record<number, string> = {
  3: 'bg-green-500/20 text-green-400 border-green-500/30',
  2: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  1: 'bg-muted text-muted-foreground border-border',
};

export default function AutoTrader() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [orders, setOrders] = useState<AutoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settingsRes, ordersRes] = await Promise.all([
        fetch('/api/auto-settings'),
        supabase.from('oe_auto_orders' as any).select('*').order('opened_at', { ascending: false }).limit(50),
      ]);
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setSettings(s);
      }
      if (ordersRes.data) setOrders(ordersRes.data as AutoOrder[]);
    } catch (e) {
      console.error('AutoTrader load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSetting = async (key: string, value: string) => {
    setSaving(true);
    await fetch('/api/auto-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    });
    setSettings(prev => prev ? { ...prev, [key]: value } : prev);
    setSaving(false);
  };

  const toggleEnabled = () => {
    const next = settings?.auto_enabled === 'true' ? 'false' : 'true';
    saveSetting('auto_enabled', next);
    toast(next === 'true' ? 'Auto-trader enabled' : 'Auto-trader stopped');
  };

  const toggleMode = () => {
    if (settings?.mode === 'live') {
      saveSetting('mode', 'simulation');
      toast('Switched to simulation mode');
    } else {
      // Confirm before going live
      if (!window.confirm('Switch to LIVE mode? Real orders will be placed on your Tastytrade account.')) return;
      saveSetting('mode', 'live');
      toast.warning('Live mode active — real orders will be placed');
    }
  };

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/auto-scan');
      const data = await res.json();
      toast.success(data.message);
      await load();
    } catch {
      toast.error('Scan failed');
    }
    setScanning(false);
  };

  const runMonitor = async () => {
    setMonitoring(true);
    try {
      const res = await fetch('/api/monitor');
      const data = await res.json();
      toast.success(data.message);
      await load();
    } catch {
      toast.error('Monitor check failed');
    }
    setMonitoring(false);
  };

  const openOrders = orders.filter(o => o.status === 'open');
  const closedOrders = orders.filter(o => o.status === 'closed');
  const totalSimPnL = closedOrders.filter(o => o.simulated).reduce((s, o) => s + (o.pnl_dollars ?? 0), 0);
  const simWinners = closedOrders.filter(o => o.simulated && (o.pnl_dollars ?? 0) > 0);
  const simWinRate = closedOrders.filter(o => o.simulated).length
    ? Math.round((simWinners.length / closedOrders.filter(o => o.simulated).length) * 100)
    : 0;

  const isEnabled = settings?.auto_enabled === 'true';
  const isLive = settings?.mode === 'live';

  if (loading) return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">Auto Trader</h1>
            <Badge className={isLive ? 'bg-destructive/20 text-destructive border-destructive/30 text-[10px]' : 'bg-primary/20 text-primary border-primary/30 text-[10px]'}>
              {isLive ? 'LIVE' : 'SIMULATION'}
            </Badge>
            {isEnabled && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isEnabled ? 'Running — scanning market each day at 9:15am ET' : 'Stopped — toggle to enable'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={runMonitor} disabled={monitoring}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${monitoring ? 'animate-spin' : ''}`} />
            Monitor
          </Button>
          <Button size="sm" variant="outline" onClick={runScan} disabled={scanning}>
            <Zap className="h-3.5 w-3.5 mr-1" />
            {scanning ? 'Scanning...' : 'Scan Now'}
          </Button>
          <Button
            size="sm"
            variant={isEnabled ? 'destructive' : 'default'}
            onClick={toggleEnabled}
          >
            {isEnabled ? <><Square className="h-3.5 w-3.5 mr-1" /> Stop</> : <><Play className="h-3.5 w-3.5 mr-1" /> Enable</>}
          </Button>
        </div>
      </div>

      {/* Live mode warning */}
      {isLive && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/50 bg-destructive/10 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>Live mode active. Real orders are being placed on your Tastytrade account (5WI48587).</span>
        </div>
      )}

      {/* Sim stats */}
      {closedOrders.filter(o => o.simulated).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                <FlaskConical className="h-3 w-3" /> Sim P&L
              </div>
              <div className={`text-xl font-bold ${totalSimPnL >= 0 ? 'gain' : 'loss'}`}>{fmt(totalSimPnL)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Sim Win Rate</div>
              <div className={`text-xl font-bold ${simWinRate >= 55 ? 'gain' : 'loss'}`}>{simWinRate}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Sim Trades</div>
              <div className="text-xl font-bold">{closedOrders.filter(o => o.simulated).length}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {/* Settings panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4" /> Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mode toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium">Mode</div>
                <div className="text-[11px] text-muted-foreground">{isLive ? 'Real orders' : 'Virtual only'}</div>
              </div>
              <button
                onClick={toggleMode}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${isLive ? 'bg-destructive' : 'bg-muted'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isLive ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>

            <Separator />

            {[
              { key: 'max_positions', label: 'Max Positions', suffix: '' },
              { key: 'profit_target_pct', label: 'Profit Target', suffix: '%' },
              { key: 'stop_loss_pct', label: 'Stop Loss', suffix: '%' },
              { key: 'virtual_balance', label: 'Virtual Balance', suffix: '' },
              { key: 'min_conviction', label: 'Min Conviction', suffix: '' },
            ].map(({ key, label, suffix }) => (
              <div key={key} className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">{label}</div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={settings?.[key as keyof Settings] ?? ''}
                    onChange={e => setSettings(prev => prev ? { ...prev, [key]: e.target.value } : prev)}
                    onBlur={e => saveSetting(key, e.target.value)}
                    className="w-16 h-6 text-xs text-right bg-muted border border-border rounded px-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Open positions */}
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle>Open Positions ({openOrders.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {openOrders.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {isEnabled ? 'No open positions — next scan at 9:15am ET' : 'Enable auto-trader to start scanning'}
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {openOrders.map(o => {
                    const unrealized = o.current_price && o.entry_price
                      ? (o.current_price - o.entry_price) / o.entry_price * 100
                      : null;
                    return (
                      <div key={o.id} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{o.ticker}</span>
                            <span className="text-xs text-muted-foreground">${o.strike} {o.expiration}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0 text-[10px] font-semibold ${CONVICTION_COLORS[o.conviction]}`}>
                              {CONVICTION_LABELS[o.conviction]}
                            </span>
                            {o.simulated && <span className="text-[10px] text-muted-foreground border border-border rounded px-1">SIM</span>}
                          </div>
                          {unrealized !== null && (
                            <span className={`text-sm font-semibold ${unrealized >= 0 ? 'gain' : 'loss'}`}>
                              {unrealized >= 0 ? '+' : ''}{unrealized.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span>{o.contracts}x @ {fmt(o.entry_price)}</span>
                          <span>{SIGNAL_LABELS[o.signal_type] ?? o.signal_type}</span>
                          {o.current_price && <span>Now: {fmt(o.current_price)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent closed */}
          {closedOrders.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Recent Closed</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border/50">
                  {closedOrders.slice(0, 8).map(o => (
                    <div key={o.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{o.ticker}</span>
                        <span className="text-xs text-muted-foreground">${o.strike} {o.expiration}</span>
                        {o.simulated && <span className="text-[10px] text-muted-foreground border border-border rounded px-1">SIM</span>}
                        {o.close_reason && (
                          <span className={`text-[10px] ${o.close_reason === 'profit_target' ? 'gain' : 'loss'}`}>
                            {o.close_reason === 'profit_target' ? 'Target hit' : 'Stop hit'}
                          </span>
                        )}
                      </div>
                      <div className={`text-sm font-semibold ${o.pnl_dollars !== undefined ? gainLoss(o.pnl_dollars) : ''}`}>
                        {o.pnl_dollars !== undefined
                          ? `${o.pnl_dollars >= 0 ? '+' : ''}${fmt(o.pnl_dollars)} (${fmtPct(o.pnl_pct ?? 0)})`
                          : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
