import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';

/**
 * Mint the VAPID pair that standards-based Web Push needs to talk to Apple's and Google's push
 * services, and keep it where only the server can read it.
 *
 * The private key is written straight into the root .env and never printed, so no credential passes
 * through a terminal scrollback or a chat log. The public key is printed on purpose: it is handed to
 * every browser that subscribes, which is exactly what `GET /account/push-public-key` does at runtime,
 * so nothing is gained by treating it as a secret.
 *
 * Re-running is safe: an existing pair is left alone, because a rotated key silently invalidates every
 * subscription already registered — the push services answer 404 and the devices go quiet until each
 * person opens the app again.
 */

const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const KEY_NAMES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'];

if (!existsSync(envPath)) {
  console.error('No .env at the repository root. Copy .env.example to .env first, then run this again.');
  process.exit(1);
}

const raw = readFileSync(envPath, 'utf8');
const valueOf = (name) => {
  const match = raw.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
};

if (KEY_NAMES.every((name) => valueOf(name))) {
  console.log('A VAPID pair is already configured — left untouched.');
  console.log(`Public key: ${valueOf('VAPID_PUBLIC_KEY')}`);
  process.exit(0);
}

const { publicKey, privateKey } = webPush.generateVAPIDKeys();
const subject = valueOf('VAPID_SUBJECT') || 'mailto:no-reply@e-madaaris.com';

const lines = [
  '',
  '# Web Push (VAPID) — minted by `npm run push:vapid -w server`.',
  '# The private half signs the assertion sent to Apple/Google and stays on this machine.',
  'VAPID_PUBLIC_KEY=',
  'VAPID_PRIVATE_KEY=',
  'VAPID_SUBJECT=',
];

let next = raw;
if (KEY_NAMES.some((name) => !new RegExp(`^${name}=`, 'm').test(next))) {
  next = `${next.replace(/\s+$/, '')}\n${lines.join('\n')}\n`;
}
next = next.replace(/^VAPID_PUBLIC_KEY=.*/m, `VAPID_PUBLIC_KEY=${publicKey}`);
next = next.replace(/^VAPID_PRIVATE_KEY=.*/m, `VAPID_PRIVATE_KEY=${privateKey}`);
next = next.replace(/^VAPID_SUBJECT=.*/m, `VAPID_SUBJECT=${subject}`);

writeFileSync(envPath, next, 'utf8');

console.log('VAPID keys written to .env (the private key was not printed).');
console.log(`Public key for browsers: ${publicKey}`);
console.log(`Subject sent to push services: ${subject}`);
console.log('Restart the API so it picks them up.');
