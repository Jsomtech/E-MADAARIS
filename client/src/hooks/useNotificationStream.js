import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { realtimeUnavailableReason, subscribeToInbox } from '../api/realtime.js';

/**
 * The live inbox feed for whoever is signed in in this tab.
 *
 * A message written for this account reaches the bell within a second, without a refresh and without
 * push: no Firebase permission, no service worker, no browser notification settings. That is what keeps
 * a school working on a locked-down managed laptop, or on a phone where the user declined notifications
 * but still wants the list to move.
 *
 * The subscription belongs to the account, not the browser, so signing out or switching tenants tears it
 * down. If the two public Supabase values are missing, nothing is attempted and `live` stays false —
 * callers keep the polling they already have.
 *
 * @param {(kind: 'insert'|'update', row: object) => void} onEvent
 */
export function useNotificationStream(onEvent) {
  const { profile } = useAuth();
  const userId = profile?.userId;
  const [live, setLive] = useState(false);
  // The newest callback, kept out of the dependency list: a re-render must not reopen the socket.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    let teardown = null;
    subscribeToInbox({
      userId,
      onInsert: (row) => handler.current?.('insert', row),
      onUpdate: (row) => handler.current?.('update', row),
      onStatusChange: (status) => { if (alive) setLive(status === 'SUBSCRIBED'); },
    }).then((stop) => {
      if (!stop) return;
      // The feed can open after an unmount or a switch of account; hand it straight back.
      if (!alive) { stop(); return; }
      teardown = stop;
      setLive(true);
    }).catch(() => {});
    return () => {
      alive = false;
      setLive(false);
      if (teardown) teardown();
    };
  }, [userId]);

  return { live, offlineReason: realtimeUnavailableReason() };
}
