import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmt, fmtPct, gainLoss } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Check, X, Pencil, Trash2 } from 'lucide-react';

interface Trade {
  id: string; ticker: string; strike: number; expiration: string;
  option_type: string; contracts: number; entry_price: number; entry_date: string;
  status: string; exit_price?: number; exit_date?: string;
  pnl_dollars?: number; pnl_pct?: number; strategy?: string; notes?: string;
}

const STRATEGIES = ['Momentum Dip', 'Breakout', 'Oversold Uptrend', 'Earnings Play', 'LEAPS', 'Other'];

const emptyForm = (): Partial<Trade> => ({
  ticker: '', strike: 0, expiration: '', option_type: 'call',
  contracts: 1, entry_price: 0, entry_date: new Date().toISOString().split('T')[0],
  status: 'open', strategy: '', notes: '',
});

export default function TradeJournal() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [open, setOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [form, setForm] = useState<Partial<Trade>>(emptyForm());
  const [closing, setClosing] = useState<Trade | null>(null);
  const [closePrice, setClosePrice] = useState('');
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split('T')[0]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all');

  useEffect(() => {
    supabase.from('oe_trades' as any).select('*').order('entry_date', { ascending: false })
      .then(({ data }) => { if (data) setTrades(data as Trade[]); });
  }, []);

  const f = (k: keyof Trade, v: string | number) => setForm(p => ({ ...p, [k]: v }));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trade: Trade = {
      id: crypto.randomUUID(),
      ticker: (form.ticker ?? '').toUpperCase(),
      strike: Number(form.strike),
      expiration: form.expiration ?? '',
      option_type: form.option_type ?? 'call',
      contracts: Number(form.contracts),
      entry_price: Number(form.entry_price),
      entry_date: form.entry_date ?? '',
      status: 'open',
      strategy: form.strategy ?? '',
      notes: form.notes ?? '',
    };
    await supabase.from('oe_trades' as any).insert(trade);
    setTrades(prev => [trade, ...prev]);
    setOpen(false);
    setForm(emptyForm());
    toast.success(`${trade.ticker} call logged`);
  };

  const handleClose = async () => {
    if (!closing || !closePrice) return;
    const exitPrice = parseFloat(closePrice);
    const costBasis = closing.entry_price * closing.contracts * 100;
    const exitValue = exitPrice * closing.contracts * 100;
    const pnl_dollars = exitValue - costBasis;
    const pnl_pct = ((exitValue - costBasis) / costBasis) * 100;
    const updates = { status: 'closed', exit_price: exitPrice, exit_date: closeDate, pnl_dollars, pnl_pct };
    await supabase.from('oe_trades' as any).update(updates).eq('id', closing.id);
    setTrades(prev => prev.map(t => t.id === closing.id ? { ...t, ...updates } : t));
    setCloseOpen(false);
    setClosing(null);
    setClosePrice('');
    toast.success(`${closing.ticker} closed — ${pnl_dollars >= 0 ? '+' : ''}${fmt(pnl_dollars)}`);
  };

  const handleDelete = async (id: string) => {
    await supabase.from('oe_trades' as any).delete().eq('id', id);
    setTrades(prev => prev.filter(t => t.id !== id));
    setConfirmDeleteId(null);
  };

  const filtered = trades.filter(t => filter === 'all' ? true : t.status === filter);

  const statusBadge = (s: string) => {
    if (s === 'closed') return <Badge variant="secondary" className="text-[10px]">Closed</Badge>;
    return <Badge variant="default" className="text-[10px]">Open</Badge>;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Trade Journal</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Log and track every trade</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Log Trade</Button>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'open', 'closed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs font-medium border transition-colors capitalize ${filter === f ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {f}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">No trades yet — click "Log Trade" to add one</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Setup</TableHead>
                  <TableHead className="text-right">Strike</TableHead>
                  <TableHead>Exp</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Exit</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-semibold">{t.ticker}</TableCell>
                    <TableCell className="text-muted-foreground text-[11px]">{t.strategy || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">${t.strike}</TableCell>
                    <TableCell className="tabular-nums text-[11px]">{t.expiration}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.contracts}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(t.entry_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.exit_price ? fmt(t.exit_price) : '—'}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${t.pnl_dollars !== undefined ? gainLoss(t.pnl_dollars) : ''}`}>
                      {t.pnl_dollars !== undefined ? `${t.pnl_dollars >= 0 ? '+' : ''}${fmt(t.pnl_dollars)}` : '—'}
                      {t.pnl_pct !== undefined && <span className="text-[10px] ml-1">({fmtPct(t.pnl_pct)})</span>}
                    </TableCell>
                    <TableCell>{statusBadge(t.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 items-center">
                        {t.status === 'open' && (
                          <button onClick={() => { setClosing(t); setCloseOpen(true); }}
                            className="text-xs text-primary hover:underline whitespace-nowrap">Close</button>
                        )}
                        {confirmDeleteId === t.id ? (
                          <>
                            <button onClick={() => handleDelete(t.id)} className="text-destructive"><Check className="h-3 w-3" /></button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-muted-foreground"><X className="h-3 w-3" /></button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(t.id)} className="text-muted-foreground/40 hover:text-destructive">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Trade Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Log Trade</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Ticker</Label>
                <Input className="h-8 text-xs uppercase" value={form.ticker} onChange={e => f('ticker', e.target.value)} required placeholder="AAPL" />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.option_type} onValueChange={v => f('option_type', v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="put">Put</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Strike</Label>
                <Input className="h-8 text-xs" type="number" value={form.strike} onChange={e => f('strike', e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Expiration</Label>
                <Input className="h-8 text-xs" type="date" value={form.expiration} onChange={e => f('expiration', e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Contracts</Label>
                <Input className="h-8 text-xs" type="number" min={1} value={form.contracts} onChange={e => f('contracts', e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Entry Price</Label>
                <Input className="h-8 text-xs" type="number" step="0.01" value={form.entry_price} onChange={e => f('entry_price', e.target.value)} required placeholder="Per contract" />
              </div>
              <div className="space-y-1">
                <Label>Entry Date</Label>
                <Input className="h-8 text-xs" type="date" value={form.entry_date} onChange={e => f('entry_date', e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Strategy</Label>
                <Select value={form.strategy} onValueChange={v => f('strategy', v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{STRATEGIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input className="h-8 text-xs" value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Setup rationale, IV rank, etc." />
            </div>
            <Button type="submit" className="w-full" size="sm">Log Trade</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Close Trade Dialog */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Close — {closing?.ticker} ${closing?.strike} {closing?.expiration}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Exit Price (per contract)</Label>
              <Input className="h-8 text-xs" type="number" step="0.01" value={closePrice} onChange={e => setClosePrice(e.target.value)} autoFocus placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>Exit Date</Label>
              <Input className="h-8 text-xs" type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} />
            </div>
            {closePrice && closing && (
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground mb-1">Estimated P&L</div>
                {(() => {
                  const pnl = (parseFloat(closePrice) - closing.entry_price) * closing.contracts * 100;
                  const pct = ((parseFloat(closePrice) - closing.entry_price) / closing.entry_price) * 100;
                  return (
                    <div className={`text-base font-bold ${pnl >= 0 ? 'gain' : 'loss'}`}>
                      {pnl >= 0 ? '+' : ''}{fmt(pnl)} <span className="text-xs">({fmtPct(pct)})</span>
                    </div>
                  );
                })()}
              </div>
            )}
            <Button className="w-full" size="sm" onClick={handleClose} disabled={!closePrice}>Confirm Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
