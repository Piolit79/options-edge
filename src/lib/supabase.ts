import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://nlusfndskgdcottasfdy.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sdXNmbmRza2dkY290dGFzZmR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NTY0NDYsImV4cCI6MjA4ODMzMjQ0Nn0.sGSdCsQl0wgAHk5L-xi6ZdrLkuAEaHcdhJ8uazjTjbA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
