// StreetTasker — Supabase Edge Function: process-withdrawal
// Handles real bank transfers via Paystack Transfer API
// Deploy: supabase functions deploy process-withdrawal
//
// Required env vars (set in Supabase Dashboard → Settings → Edge Functions → Secrets):
//   PAYSTACK_SECRET_KEY  — your sk_live_... key (NEVER put this in frontend code)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Nigerian bank codes (CBN-registered) — name → Paystack bank code
const BANK_CODES: Record<string, string> = {
  'access bank': '044',
  'access': '044',
  'citibank': '023',
  'diamond bank': '063',
  'ecobank': '050',
  'fidelity bank': '070',
  'fidelity': '070',
  'first bank': '011',
  'first bank of nigeria': '011',
  'fbn': '011',
  'first city monument bank': '214',
  'fcmb': '214',
  'guaranty trust bank': '058',
  'gtbank': '058',
  'gt bank': '058',
  'heritage bank': '030',
  'keystone bank': '082',
  'opay': '999992',
  'kuda': '999099',
  'kuda bank': '999099',
  'moniepoint': '999188',
  'moniepoint mfb': '999188',
  'palmpay': '999111',
  'polaris bank': '076',
  'providus bank': '101',
  'stanbic ibtc': '221',
  'stanbic ibtc bank': '221',
  'standard chartered': '068',
  'sterling bank': '232',
  'sterling': '232',
  'suntrust bank': '100',
  'titan trust bank': '102',
  'union bank': '032',
  'union bank of nigeria': '032',
  'united bank for africa': '033',
  'uba': '033',
  'unity bank': '215',
  'wema bank': '035',
  'wema': '035',
  'zenith bank': '057',
  'zenith': '057',
}

function resolveBankCode(bankInput: string): string | null {
  const clean = bankInput.toLowerCase().trim()
  // Direct match
  if (BANK_CODES[clean]) return BANK_CODES[clean]
  // Partial match
  for (const [name, code] of Object.entries(BANK_CODES)) {
    if (clean.includes(name) || name.includes(clean)) return code
  }
  // If it looks like a code already (3-6 digits)
  if (/^\d{3,6}$/.test(clean)) return clean
  return null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── 1. Auth check — user must be logged in ──────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create Supabase client using user's JWT
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 2. Parse request body ───────────────────────────────────
    const { amount, bank_name, account_number, account_name, transaction_id } = await req.json()

    if (!amount || amount < 500) {
      return new Response(JSON.stringify({ error: 'Minimum withdrawal is ₦500' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    if (!account_number || account_number.length !== 10) {
      return new Response(JSON.stringify({ error: 'Account number must be 10 digits' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 3. Resolve bank code ────────────────────────────────────
    const bank_code = resolveBankCode(bank_name || '')
    if (!bank_code) {
      return new Response(JSON.stringify({
        error: `Bank not recognised: "${bank_name}". Please use the full bank name (e.g. "GTBank", "Zenith Bank", "Kuda").`
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── 4. Verify wallet balance with service role (bypasses RLS) ─
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY)
    const { data: wallet, error: walletErr } = await supabaseAdmin
      .from('wallets').select('balance').eq('user_id', user.id).maybeSingle()

    if (walletErr || !wallet) {
      return new Response(JSON.stringify({ error: 'Wallet not found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    if ((wallet.balance ?? 0) < amount) {
      return new Response(JSON.stringify({
        error: `Insufficient balance. Available: ₦${Number(wallet.balance).toLocaleString()}`
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── 5. Create Paystack transfer recipient ───────────────────
    const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'nuban',
        name: account_name,
        account_number,
        bank_code,
        currency: 'NGN',
      }),
    })
    const recipientData = await recipientRes.json()
    if (!recipientData.status || !recipientData.data?.recipient_code) {
      return new Response(JSON.stringify({
        error: recipientData.message || 'Could not create transfer recipient. Check bank details.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── 6. Initiate transfer ────────────────────────────────────
    const reference = `WD-${Date.now()}-${user.id.slice(0, 6)}`
    const transferRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(amount) * 100, // Paystack uses kobo
        recipient: recipientData.data.recipient_code,
        reason: `StreetTasker withdrawal for ${account_name}`,
        reference,
        currency: 'NGN',
      }),
    })
    const transferData = await transferRes.json()

    // Paystack returns status=true even for OTP-pending transfers
    if (!transferData.status) {
      return new Response(JSON.stringify({
        error: transferData.message || 'Transfer initiation failed. Contact support.'
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── 7. Deduct wallet balance + update transaction record ────
    const newBalance = (wallet.balance ?? 0) - Math.round(amount)
    await supabaseAdmin.from('wallets')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    // Update the pending transaction record if transaction_id provided
    if (transaction_id) {
      await supabaseAdmin.from('wallet_transactions')
        .update({
          status: transferData.data?.status === 'success' ? 'completed' : 'processing',
          reference,
          note: `Withdrawal to ${account_name} (${bank_name}) — Paystack ref: ${reference}`,
        })
        .eq('id', transaction_id)
    } else {
      await supabaseAdmin.from('wallet_transactions').insert({
        user_id: user.id,
        type: 'withdrawal',
        amount,
        reference,
        status: transferData.data?.status === 'success' ? 'completed' : 'processing',
        note: `Withdrawal to ${account_name} (${bank_name}) — Paystack ref: ${reference}`,
      })
    }

    // ── 8. Return success ───────────────────────────────────────
    return new Response(JSON.stringify({
      success: true,
      reference,
      paystack_status: transferData.data?.status,
      new_balance: newBalance,
      message: transferData.data?.status === 'success'
        ? `₦${Number(amount).toLocaleString()} sent to your account.`
        : `₦${Number(amount).toLocaleString()} is being processed. Arrives within 24 hours.`,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[process-withdrawal] error:', msg)
    return new Response(JSON.stringify({ error: 'Internal server error: ' + msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})