// One-time interactive Picnic login (+2FA) that stores the session key for the sidecar.
// In Docker:  docker compose exec -it picnic-sidecar node login.mjs
// Locally:    PICNIC_DATA_DIR=. node --env-file=.env login.mjs
// Credentials come from PICNIC_USERNAME / PICNIC_PASSWORD if set, otherwise are prompted
// (password input is hidden). Re-run whenever Picnic invalidates the session.
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createClient, saveKey, SESSION_FILE } from "./lib.mjs";

// One readline for the whole script; muting its output stops it echoing a typed password.
let muted = false;
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
const lines = rl[Symbol.asyncIterator](); // buffers input, unlike rl.question with piped stdin

async function ask(prompt, { hidden = false } = {}) {
  process.stdout.write(prompt);
  muted = hidden; // the prompt itself was written above, so nothing visible is lost
  try {
    return String((await lines.next()).value ?? "").trim();
  } finally {
    muted = false;
    if (hidden) process.stdout.write("\n");
  }
}

const username = process.env.PICNIC_USERNAME || (await ask("Picnic-Login (E-Mail): "));
const password = process.env.PICNIC_PASSWORD || (await ask("Passwort: ", { hidden: true }));
if (!username || !password) {
  console.error("Benutzername und Passwort werden benötigt.");
  rl.close();
  process.exit(1);
}

const client = createClient();
try {
  const res = await client.auth.login(username, password);
  let authKey = res.authKey ?? client.authKey;
  if (res.second_factor_authentication_required) {
    await client.auth.generate2FACode("SMS");
    const code = await ask("SMS-Code: ");
    const v = await client.auth.verify2FACode(code);
    authKey = v.authKey ?? client.authKey;
  }
  // Prove the key works before persisting it.
  await client.cart.getCart();
  await saveKey(authKey);
  console.log(`✓ Angemeldet, Session gespeichert in ${SESSION_FILE}`);
} catch (e) {
  console.error(`✗ Anmeldung fehlgeschlagen: ${e.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
