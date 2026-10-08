import { createProgressHandler } from './handler.ts'

// The partner token is verified by our private DB function, not by Supabase JWT.
// The project service credential never appears in a partner response or client.
Deno.serve(createProgressHandler(async (hash, numbers) => {
  const url = Deno.env.get('SUPABASE_URL')
  const credential = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !credential) throw new Error('Server configuration unavailable')
  const response = await fetch(`${url}/rest/v1/rpc/get_order_progress_inputs_v1015`, {
    method: 'POST',
    headers: { apikey: credential, Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key_hash: hash, p_order_numbers: numbers }),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('Upstream unavailable')
  return response.json()
}))
