// Picnic spike — read-only: login (+2FA), purchase history, product search ranked by
// what you already bought, view cart.
// Run: cp .env.example .env, fill it in, then `npm install && npm run spike [-- "Milch" "Eier"]`.
// Pass --add to also put the top-ranked hit of the FIRST query into the cart (1x); remove it in the Picnic app after.
import { createInterface } from "node:readline/promises";
import { readFile, writeFile, chmod } from "node:fs/promises";
import PicnicClient from "picnic-api";

const SESSION_FILE = ".picnic-session.json";
const { PICNIC_USERNAME, PICNIC_PASSWORD, PICNIC_COUNTRY_CODE = "DE" } = process.env;
const args = process.argv.slice(2);
const doAdd = args.includes("--add");
const queries = args.filter((a) => !a.startsWith("--"));
if (!queries.length) queries.push("Milch");
const HISTORY_DELIVERIES = 12; // most recent completed deliveries to scan

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
  // Non-secret sanity info so a bad .env (truncated at '#', stray quotes/spaces) is visible.
  console.log(
    `· Land=${PICNIC_COUNTRY_CODE}, Benutzername ${PICNIC_USERNAME.length} Zeichen (@: ${PICNIC_USERNAME.includes("@")}), ` +
      `Passwort ${PICNIC_PASSWORD.length} Zeichen, Rand-Leerzeichen: ${PICNIC_USERNAME !== PICNIC_USERNAME.trim() || PICNIC_PASSWORD !== PICNIC_PASSWORD.trim()}`,
  );
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

// --- purchase history: product id -> { name, count } over the recent completed deliveries ---
const bought = new Map();
const deliveries = await client.delivery.getDeliveries(["COMPLETED"]);
const recent = deliveries
  .sort((a, b) => String(b.creation_time).localeCompare(String(a.creation_time)))
  .slice(0, HISTORY_DELIVERIES);
for (const d of recent) {
  const detail = await client.delivery.getDelivery(d.delivery_id);
  for (const order of detail.orders ?? []) {
    for (const line of order.items ?? []) {
      for (const art of line.items ?? []) {
        const e = bought.get(art.id) ?? { name: art.name, count: 0 };
        e.count += 1;
        bought.set(art.id, e);
      }
    }
  }
}
console.log(`\nHistorie: ${recent.length} von ${deliveries.length} Lieferungen gelesen, ${bought.size} verschiedene Produkte`);
const top = [...bought.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15);
for (const [id, e] of top) console.log(`  ${e.count}x  ${id}  ${e.name}`);

// --- search, ranked: already-bought products first (most often first), then Picnic's own order ---
const rank = (hits) =>
  hits
    .map((h, i) => ({ h, i, n: bought.get(h.id)?.count ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i);

let firstRanked = null;
for (const query of queries) {
  const ranked = rank(await client.catalog.search(query));
  firstRanked ??= ranked[0]?.h;
  console.log(`\nSuche "${query}": ${ranked.length} Treffer`);
  for (const { h, i, n } of ranked.slice(0, 5)) {
    const mark = n ? `${n}x gekauft` : "";
    console.log(`  ${h.id}  ${h.name}  ${(h.display_price / 100).toFixed(2)} €  (${h.unit_quantity})  [Picnic-Platz ${i + 1}] ${mark}`);
  }
}

const cart = await client.cart.getCart();
console.log(`\nWarenkorb: ${cart.items?.length ?? 0} Positionen, Summe ${(cart.total_price ?? 0) / 100} €`);

if (doAdd && firstRanked) {
  await client.cart.addProductToCart(firstRanked.id, 1);
  console.log(`✓ "${firstRanked.name}" 1x in den Warenkorb gelegt — bitte in der Picnic-App wieder entfernen`);
}
