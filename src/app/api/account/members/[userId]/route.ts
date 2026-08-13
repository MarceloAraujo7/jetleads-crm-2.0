// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role and/or daily lead quota. Admin+.
//   DELETE — remove a member.                                Admin+.
//
// Role changes delegate to the SECURITY DEFINER RPCs from migration
// 018 (set_member_role / remove_account_member) — the RPCs do the
// *real* authorisation work — caller must be admin+, target must be
// in caller's account, target can't be the owner, can't be self. The
// TS layer here only forwards the call and maps Postgres SQLSTATEs
// back to HTTP statuses.
//
// Quota changes use the service-role client instead of an RPC: the
// `profiles_update` RLS policy only lets a user touch their OWN row
// (migration 017), so an admin editing a teammate's row needs a
// supervised path — `requireRole('admin')` here IS that supervision,
// same pattern as the whatsapp_channels is_default/assigned_agent_id
// writes.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; daily_lead_quota?: unknown }
      | null;

    if (body && "daily_lead_quota" in body) {
      const quota = body.daily_lead_quota;
      if (quota !== null && (typeof quota !== "number" || !Number.isInteger(quota) || quota < 0)) {
        return NextResponse.json(
          { error: "'daily_lead_quota' must be a non-negative integer or null" },
          { status: 400 },
        );
      }
      // Service-role, not ctx.supabase — profiles_update RLS only
      // lets a user touch their own row (migration 017); requireRole
      // above is the supervision an admin editing a teammate needs.
      const { error: quotaError } = await supabaseAdmin()
        .from("profiles")
        .update({ daily_lead_quota: quota })
        .eq("user_id", userId)
        .eq("account_id", ctx.accountId);
      if (quotaError) {
        console.error("[members route] quota update error:", quotaError);
        return NextResponse.json({ error: "Failed to update quota" }, { status: 500 });
      }
    }

    if (body && "role" in body) {
      const role = body.role;
      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      // The RPC blocks promotion to / demotion from owner, but
      // surface the friendlier 400 before crossing the wire too.
      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }

      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role,
      });

      if (error) return rpcErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
