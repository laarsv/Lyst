// Picnic spike — read-only: login (+2FA), product search, view cart.
// Run: cp .env.example .env, fill it in, then `npm install && npm run spike [-- "suchbegriff"]`.
// Pass --add to also put the top search hit into the cart (1x); remove it in the Picnic app after.
import { createInterface } from "node:readline/promises";
import { readFile, writeFile, chmod } from "node:fs/promises";
import PicnicClient from "picnic-api";

const SESSION_FILE = ".picnic-session.json";
const { PICNIC_USERNAME, PICNIC_PASSWORD, PICNIC_COUNTRY_CODE = "DE" } = process.env;
const args = process.argv.slice(2);
const doAdd = args.includes("--add");
const query = args.find((a) => !a.startsWith("--")) ?? "Milch";

async function saveKey(authKey) {
  await writeFile(SESSION_FILE, JSON.stringify({ authKey }), { mode: 0o600 });
  await chmod(SESSION_FILE, 0o600);
}

async function loadKey() {
  try {
    return JSON.parse(await readFile(SESSION_FILE, "utf8")).authKey ?? null;
  } catch {
    return null;
  }
}

async function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

const savedKey = await loadKey();
let client = new PicnicClient({ countryCode: PICNIC_COUNTRY_CODE, authKey: savedKey ?? undefined });

// Reuse the stored key if it still works; otherwise log in from scratch.
let ok = false;
if (savedKey) {
  try {
    await client.cart.getCart();
    ok = true;
    console.log("✓ gespeicherte Session ist noch gültig");
  } catch {
    console.log("· gespeicherte Session abgelaufen, neuer Login");
    client = new PicnicClient({ countryCode: PICNIC_COUNTRY_CODE });
  }
}

if (!ok) {
  if (!PICNIC_USERNAME || !PICNIC_PASSWORD) {
    console.error("PICNIC_USERNAME / PICNIC_PASSWORD fehlen in .env");
    process.exit(1);
  }
  const res = await client.auth.login(PICNIC_USERNAME, PICNIC_PASSWORD);
  console.log(`✓ Login ok (2FA nötig: ${res.second_factor_authentication_required})`);
  if (res.second_factor_authentication_required) {
    await client.auth.generate2FACode("SMS");
    const code = await ask("SMS-Code: ");
    const v = await client.auth.verify2FACode(code);
    console.log("✓ 2FA ok");
    await saveKey(v.authKey ?? client.authKey);
  } else {
    await saveKey(res.authKey ?? client.authKey);
  }
}

const hits = await client.catalog.search(query);
console.log(`\nSuche "${query}": ${hits.length} Treffer`);
for (const h of hits.slice(0, 5)) {
  console.log(`  ${h.id}  ${h.name}  ${(h.display_price / 100).toFixed(2)} €  (${h.unit_quantity})`);
}

const cart = await client.cart.getCart();
console.log(`\nWarenkorb: ${cart.items?.length ?? 0} Positionen, Summe ${(cart.total_price ?? 0) / 100} €`);

if (doAdd && hits[0]) {
  await client.cart.addProductToCart(hits[0].id, 1);
  console.log(`✓ "${hits[0].name}" 1x in den Warenkorb gelegt — bitte in der Picnic-App wieder entfernen`);
}
