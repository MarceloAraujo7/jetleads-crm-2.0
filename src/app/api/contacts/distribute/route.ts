import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { maybeDistributeNewLead } from '@/lib/contacts/assign-lead'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

const MAX_IDS = 1000

/**
 * POST /api/contacts/distribute
 *
 * Runs lead distribution (see src/lib/contacts/assign-lead.ts) for a
 * batch of just-created contacts. Exists because the CSV import flow
 * (src/components/contacts/import-modal.tsx) inserts contacts
 * client-side under the importing user's own session — and that
 * session's RLS view of `contacts` is deliberately narrowed once an
 * account has agent-owned channels (migration 043), which would skew
 * the load-balancing count if distribution ran with that client
 * directly. This route does it server-side with the service-role
 * client instead, same as every other creation path.
 *
 * Body: `{ contact_ids: string[] }`. Silently no-ops (200) for ids
 * that don't belong to the caller's account, are already assigned, or
 * if the account hasn't turned distribution on — this is a
 * best-effort enhancement on top of an import that already succeeded.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()
    const body = await request.json()
    const contactIds = Array.isArray(body.contact_ids) ? body.contact_ids : []
    if (contactIds.length === 0) {
      return NextResponse.json({ error: 'contact_ids must be a non-empty array' }, { status: 400 })
    }
    if (contactIds.length > MAX_IDS) {
      return NextResponse.json({ error: `contact_ids is capped at ${MAX_IDS} per request` }, { status: 400 })
    }

    // Sequential on purpose: pickAgentForNewLead() counts current load
    // per request, so firing these concurrently would let several
    // contacts race against the same stale "least loaded" snapshot
    // and pile onto one agent instead of spreading out.
    const admin = supabaseAdmin()
    for (const contactId of contactIds) {
      if (typeof contactId === 'string') {
        await maybeDistributeNewLead(admin, accountId, contactId)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
