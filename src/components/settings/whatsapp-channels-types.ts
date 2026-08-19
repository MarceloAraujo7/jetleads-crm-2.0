export interface ChannelListItem {
  id: string;
  label: string | null;
  ddd: string | null;
  is_default: boolean;
  assigned_agent_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  waba_id: string | null;
  status: string;
  registered_at: string | null;
  subscribed_apps_at: string | null;
  last_registration_error: string | null;
  connected_at: string | null;
  created_at: string;
}
