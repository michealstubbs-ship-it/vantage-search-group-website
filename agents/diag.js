const { createClient } = require('@supabase/supabase-js');
const SUPA_URL = 'https://mkqbegnqrgveiygrycyg.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcWJlZ25xcmd2ZWl5Z3J5Y3lnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjE3NjAsImV4cCI6MjA5Nzc5Nzc2MH0.0Qprp9wRW8iPhmqPbmXEkp0toz3z8TGXoVEESkP6Tp4';
const db = createClient(SUPA_URL, SUPA_KEY);
(async () => {
  const { data, error, count } = await db.from('linkedin_outreach').select('*', { count: 'exact' }).limit(3);
  console.log('total rows (limit3 shown), count=', count, 'error=', error);
  console.log(JSON.stringify(data, null, 2));
  const { data: conn, error: err2, count: c2 } = await db.from('linkedin_outreach').select('id', { count: 'exact' }).eq('status','connected');
  console.log('connected count=', c2, 'error=', err2);
})();
