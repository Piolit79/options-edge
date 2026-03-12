import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? 'https://nlusfndskgdcottasfdy.supabase.co',
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const { data } = await supabase.from('oe_settings').select('key, value');
    return res.json(Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value])));
  }

  if (req.method === 'POST') {
    const updates = req.body as Record<string, string>;
    for (const [key, value] of Object.entries(updates)) {
      await supabase.from('oe_settings').upsert({ key, value, updated_at: new Date().toISOString() });
    }
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
