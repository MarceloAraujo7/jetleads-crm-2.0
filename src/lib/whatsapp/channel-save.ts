import type { SupabaseClient } from '@supabase/supabase-js';
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import { encrypt } from '@/lib/whatsapp/encryption';

// ------------------------------------------------------------
// Shared "verify with Meta, encrypt, persist" core used by both the
// legacy single-channel route (/api/whatsapp/config, untouched —
// keeps managing "the default channel" for back-compat) and the new
// multi-number routes (/api/whatsapp/channels[...]). Extracted so
// adding a second/third number reuses the exact same
// register/verify/subscribe flow instead of a second hand-rolled
// copy that could drift.
// ------------------------------------------------------------

export interface SaveMetaChannelInput {
  /** User-scoped (RLS-enforced) client — does the actual insert/update. */
  db: SupabaseClient;
  /** Service-role client — cross-account phone_number_id ownership check. */
  admin: SupabaseClient;
  accountId: string;
  userId: string;
  /** Existing channel row to update. Omit to insert a new channel. */
  channelId?: string;
  phone_number_id: string;
  waba_id?: string | null;
  access_token: string;
  verify_token?: string | null;
  pin?: string | null;
  label?: string | null;
  ddd?: string | null;
  /** Insert path only — whether the new row becomes the account default. */
  makeDefault?: boolean;
  /**
   * Insert path only — ties the new channel to a specific agent
   * (self-service "connect my own WhatsApp" flow). Never touched on
   * the update path — reassigning an existing channel's owner isn't
   * supported here (would need the admin service-role path, like
   * is_default).
   */
  assignedAgentId?: string | null;
}

export type SaveMetaChannelResult =
  | {
      ok: true;
      channelId: string;
      registered: boolean;
      registration_skipped: boolean;
      registration_error: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      phone_info: any;
    }
  | { ok: false; status: number; error: string };

export async function saveMetaChannel(
  input: SaveMetaChannelInput
): Promise<SaveMetaChannelResult> {
  const {
    db,
    admin,
    accountId,
    userId,
    channelId,
    phone_number_id,
    waba_id,
    access_token,
    verify_token,
    pin,
    label,
    ddd,
    makeDefault,
    assignedAgentId,
  } = input;

  if (!access_token || !phone_number_id) {
    return {
      ok: false,
      status: 400,
      error: 'access_token and phone_number_id are required',
    };
  }
  if (pin !== undefined && pin !== null && pin !== '') {
    if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return { ok: false, status: 400, error: 'PIN must be exactly 6 digits.' };
    }
  }

  // If updating, the row must exist and belong to this account.
  let existing: {
    id: string;
    registered_at: string | null;
    phone_number_id: string | null;
  } | null = null;
  if (channelId) {
    const { data } = await db
      .from('whatsapp_channels')
      .select('id, registered_at, phone_number_id')
      .eq('id', channelId)
      .eq('account_id', accountId)
      .eq('provider', 'meta_cloud')
      .maybeSingle();
    if (!data) {
      return { ok: false, status: 404, error: 'Channel not found.' };
    }
    existing = data;
  }

  // phone_number_id is globally unique (whatsapp_channels_phone_number_id_key)
  // — check up front for a friendly message instead of a raw constraint
  // violation, whether the collision is with another account's channel
  // or another channel already on THIS account.
  const NIL_UUID = '00000000-0000-0000-0000-000000000000';
  const { data: claimed, error: claimedError } = await admin
    .from('whatsapp_channels')
    .select('id, account_id')
    .eq('provider', 'meta_cloud')
    .eq('phone_number_id', phone_number_id)
    .neq('id', channelId ?? NIL_UUID)
    .maybeSingle();
  if (claimedError) {
    console.error('Error checking phone_number_id ownership:', claimedError);
    return {
      ok: false,
      status: 500,
      error: 'Failed to validate configuration',
    };
  }
  if (claimed) {
    return {
      ok: false,
      status: 409,
      error:
        claimed.account_id === accountId
          ? 'This phone number is already connected to another number on this account.'
          : 'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected once.',
    };
  }

  // Verify credentials with Meta BEFORE saving.
  let phoneInfo;
  try {
    phoneInfo = await verifyPhoneNumber({
      phoneNumberId: phone_number_id,
      accessToken: access_token,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('Meta API verification failed during save:', message);
    return { ok: false, status: 400, error: `Meta API error: ${message}` };
  }

  let encryptedAccessToken: string;
  let encryptedVerifyToken: string | null;
  try {
    encryptedAccessToken = encrypt(access_token);
    encryptedVerifyToken = verify_token ? encrypt(verify_token) : null;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown encryption error';
    console.error('Encryption failed:', message);
    return {
      ok: false,
      status: 500,
      error:
        'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
    };
  }

  const sameNumber =
    existing?.phone_number_id === phone_number_id &&
    existing?.registered_at != null;

  let registeredAt: string | null = existing?.registered_at ?? null;
  let registrationError: string | null = null;
  let registrationSkipped = false;

  const needsRegistration =
    !sameNumber || (typeof pin === 'string' && pin.length > 0);
  if (needsRegistration) {
    if (!pin) {
      registrationSkipped = true;
    } else {
      try {
        await registerPhoneNumber({
          phoneNumberId: phone_number_id,
          accessToken: access_token,
          pin,
        });
        registeredAt = new Date().toISOString();
      } catch (err) {
        registrationError =
          err instanceof Error ? err.message : 'Unknown Meta API error';
        console.error('Phone number /register failed:', registrationError);
      }
    }
  }

  let subscribedAppsAt: string | null = null;
  if (waba_id) {
    try {
      await subscribeWabaToApp({ wabaId: waba_id, accessToken: access_token });
      subscribedAppsAt = new Date().toISOString();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('WABA subscribed_apps failed (non-fatal):', message);
    }
  }

  const baseRow: Record<string, unknown> = {
    phone_number_id,
    waba_id: waba_id || null,
    access_token: encryptedAccessToken,
    verify_token: encryptedVerifyToken,
    status: registrationError ? 'disconnected' : 'connected',
    connected_at: registrationError ? null : new Date().toISOString(),
    registered_at: registrationError ? null : registeredAt,
    subscribed_apps_at: subscribedAppsAt ?? null,
    last_registration_error: registrationError,
    display_phone_number: phoneInfo?.display_phone_number ?? null,
    verified_name: phoneInfo?.verified_name ?? null,
    updated_at: new Date().toISOString(),
  };
  if (label !== undefined) baseRow.label = label || null;
  if (ddd !== undefined) baseRow.ddd = ddd || null;

  let resultChannelId: string;
  if (existing) {
    const { error: updateError } = await db
      .from('whatsapp_channels')
      .update(baseRow)
      .eq('id', existing.id);
    if (updateError) {
      console.error('Error updating whatsapp_channels:', updateError);
      return {
        ok: false,
        status: 500,
        error: 'Failed to update configuration',
      };
    }
    resultChannelId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await db
      .from('whatsapp_channels')
      .insert({
        account_id: accountId,
        user_id: userId,
        provider: 'meta_cloud',
        is_default: makeDefault ?? false,
        assigned_agent_id: assignedAgentId ?? null,
        label: label || null,
        ddd: ddd || null,
        ...baseRow,
      })
      .select('id')
      .single();
    if (insertError || !inserted) {
      console.error('Error inserting whatsapp_channels:', insertError);
      return { ok: false, status: 500, error: 'Failed to save configuration' };
    }
    resultChannelId = inserted.id as string;
  }

  return {
    ok: true,
    channelId: resultChannelId,
    registered: registrationError ? false : registeredAt != null,
    registration_skipped: registrationSkipped,
    registration_error: registrationError,
    phone_info: phoneInfo,
  };
}
