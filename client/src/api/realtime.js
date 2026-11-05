import { tokens } from './client.js';

/**
 * The browser's only direct line to Supabase: the live stream of this account's own inbox rows.
 *
 * Everything else in the app goes through the API, and that does not change here. This connection
 * subscribes to one table, and the rows it can receive are decided by the same `notifications_own` row
 * level policy the database already enforces — because the app's bearer token is a Supabase access
 * token, handing it to the realtime transport authenticates the subscription as this user. A filter on
 * the subscription is a convenience that saves traffic; it is never the thing keeping another school's
 * messages out.
 *
 * When the two public values are not configured, every entry point below says "unavailable" and the app
 * keeps working exactly as it did: the bell polls, push still arrives, nothing logs an error.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let clientPromise = null;
let reported = false;
let nextChannelId = 0;

export function realtimeConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Stated once per session: a silent fallback is honest only if the screen can say why it is silent. */
export function realtimeUnavailableReason() {
  if (!SUPABASE_URL) return 'VITE_SUPABASE_URL is not set';
  if (!SUPABASE_ANON_KEY) return 'VITE_SUPABASE_ANON_KEY is not set';
  return null;
}

async function getClient() {
  if (!realtimeConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => {
      const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        // The app owns its tokens (tab-scoped storage); Supabase must not write a second session.
        auth: { persistSession: false, autoRefreshToken: false, sessionStorage: undefined },
        realtime: { params: { eventsPerSecond: 2 } },
      });
      // A callback rather than a snapshot: the access token rotates every hour and the socket must
      // re-authenticate with the new one without dropping the subscription.
      client.realtime.setAuth(async () => tokens.access || '');
      return client;
    });
  }
  return clientPromise;
}

/**
 * One membership id can only ever be the signed-in account's own, so one filter is enough — a realtime
 * subscription takes a single `filter`, and the row level policy is what actually guards the content.
 *
 * The returned promise resolves once the socket has accepted the channel, so a caller that flips a
 * "live" indicator knows the feed is open rather than merely requested. A channel the server refuses
 * resolves to null and the caller falls back to polling. `onStatusChange` keeps reporting the socket
 * afterwards, because a dot that says "live" has to go quiet when the connection does.
 *
 * @param {{ userId: string, onInsert, onUpdate, onStatusChange }} options
 * @returns {Promise<null | (() => void)>} a teardown function, or null when realtime is not configured.
 */
export async function subscribeToInbox({ userId, onInsert, onUpdate, onStatusChange }) {
  if (!realtimeConfigured() || !userId) return null;
  let client;
  try {
    client = await getClient();
  } catch (error) {
    if (!reported) { reported = true; console.warn('[realtime] unavailable:', error.message); }
    return null;
  }
  const base = { schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}` };
  let settle;
  const opened = new Promise((resolve) => { settle = resolve; });
  // The bell and the inbox page subscribe at the same time, and one client will not host two channels
  // with the same name.
  const stop = () => {
    try { client.removeChannel(channel); } catch { /* already gone */ }
  };
  const channel = client
    .channel(`inbox-${userId}-${(nextChannelId += 1)}`)
    .on('postgres_changes', { event: 'INSERT', ...base }, (payload) => onInsert?.(payload.new))
    .on('postgres_changes', { event: 'UPDATE', ...base }, (payload) => onUpdate?.(payload.new))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') settle(stop);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') settle(null);
      onStatusChange?.(status);
    });
  return opened;
}
