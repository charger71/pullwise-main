#!/usr/bin/env node
// A VAPID key pair for app notifications (supabase/functions/push-notify). One pair can serve every shop: set both on
// each shop's project, with the address push services can reach you at:
//
//   node tools/vapid-keys.mjs
//   supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com --project-ref <ref>
//
// Keep the private key secret (a password manager), and keep the pair: a new pair means every customer has to turn
// notifications on again.

import { generateKeyPairSync } from 'node:crypto';

/** { publicKey, privateKey } as Web Push wants them: the raw P-256 public point and private scalar, base64url. */
export function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
  return { publicKey: raw.toString('base64url'), privateKey: priv.d };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { publicKey, privateKey } = vapidKeys();
  console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
}
