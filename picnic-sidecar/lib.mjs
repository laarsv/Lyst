// Shared Picnic helpers for the sidecar: session file, client, purchase history, search.
// One household account; the session key lives in PICNIC_DATA_DIR (a Docker volume in prod).
import { readFile, writeFile, chmod } from "node:fs/promises";
import PicnicClient from "picnic-api";

const COUNTRY = process.env.PICNIC_COUNTRY_CODE ?? "DE";
const DATA_DIR = process.env.PICNIC_DATA_DIR ?? ".";
export const SESSION_FILE = `${DATA_DIR}/.picnic-session.json`;

// Scanning a delivery costs one API call each, so bound it and cache the result.
const HISTORY_DELIVERIES = Number(process.env.PICNIC_HISTORY_DELIVERIES ?? 20);
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

export async function saveKey(authKey) {
  await writeFile(SESSION_FILE, JSON.stringify({ authKey }), { mode: 0o600 });
  await chmod(SESSION_FILE, 0o600);
}

export async function loadKey() {
  try {
    return JSON.parse(await readFile(SESSION_FILE, "utf8")).authKey ?? null;
  } catch {
    return null;
  }
}

export function createClient(authKey) {
  return new PicnicClient({ countryCode: COUNTRY, authKey: authKey ?? undefined });
}

export class NotConnectedError extends Error {
  constructor() {
    super("Picnic nicht verbunden (noch kein Login gespeichert)");
  }
}

let cached = null;

/** Client built from the stored session key. Throws NotConnectedError if none exists. */
export async function getClient() {
  if (cached) return cached;
  const key = await loadKey();
  if (!key) throw new NotConnectedError();
  cached = createClient(key);
  return cached;
}

/** Forget the in-memory client so the next call re-reads the session file (after a re-login). */
export function resetClient() {
  cached = null;
  history = null;
}

/** True iff the stored key still works. A cart read is the cheapest authenticated call. */
export async function sessionIsValid() {
  try {
    await (await getClient()).cart.getCart();
    return true;
  } catch {
    return false;
  }
}

let history = null; // { at, counts: Map<productId, number>, inflight?: Promise }

/** product id -> how many recent completed deliveries contained it. */
export async function getPurchaseCounts(client) {
  if (history?.counts && Date.now() - history.at < HISTORY_TTL_MS) return history.counts;
  if (history?.inflight) return history.inflight;

  const inflight = (async () => {
    const counts = new Map();
    const deliveries = await client.delivery.getDeliveries(["COMPLETED"]);
    const recent = [...deliveries]
      .sort((a, b) => String(b.creation_time).localeCompare(String(a.creation_time)))
      .slice(0, HISTORY_DELIVERIES);
    for (const d of recent) {
      const detail = await client.delivery.getDelivery(d.delivery_id);
      for (const order of detail.orders ?? []) {
        for (const line of order.items ?? []) {
          for (const art of line.items ?? []) counts.set(art.id, (counts.get(art.id) ?? 0) + 1);
        }
      }
    }
    history = { at: Date.now(), counts };
    return counts;
  })();
  history = { ...history, inflight };
  try {
    return await inflight;
  } finally {
    if (history?.inflight === inflight) delete history.inflight;
  }
}

/**
 * Search, de-duplicated by product id (Picnic returns the same product in several result
 * groups), in Picnic's own order, each hit annotated with `bought` (recent purchase count).
 * Ranking against remembered mappings happens in Lyst, not here.
 */
export async function searchProducts(client, query) {
  const [hits, counts] = await Promise.all([client.catalog.search(query), getPurchaseCounts(client)]);
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({
      id: h.id,
      name: h.name,
      price_cents: h.display_price,
      unit: h.unit_quantity,
      image_id: h.image_id,
      bought: counts.get(h.id) ?? 0,
    });
  }
  return out;
}
