// Tiny HTTP wrapper around picnic-api for the Lyst backend (internal Docker network only).
// Auth: `Authorization: Bearer <PICNIC_SIDECAR_TOKEN>`. Deliberately NO checkout / slot /
// payment endpoints — the sidecar can fill the cart, never place an order.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { getClient, NotConnectedError, resetClient, searchProducts, sessionIsValid } from "./lib.mjs";

const TOKEN = process.env.PICNIC_SIDECAR_TOKEN ?? "";
const PORT = Number(process.env.PORT ?? 8081);
const MAX_BODY = 16 * 1024;
const MAX_ADD_ITEMS = 50;
const MAX_COUNT = 99;
const SEARCH_LIMIT = 10;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,32}$/;

if (!TOKEN) {
  console.error("PICNIC_SIDECAR_TOKEN is not set — refusing to start without auth.");
  process.exit(1);
}

class HttpError extends Error {
  constructor(status, error, message) {
    super(message ?? error);
    this.status = status;
    this.error = error;
  }
}

function authorized(req) {
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "body_too_large");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function summarizeCart(cart) {
  const lines = (cart.items ?? []).map((line) => {
    const art = line.items?.[0];
    const qty = art?.decorators?.find((d) => d.type === "QUANTITY")?.quantity;
    return { id: art?.id ?? line.id, name: art?.name ?? "?", count: qty ?? 1, price_cents: line.price };
  });
  return { lines, total_cents: cart.total_price ?? 0 };
}

async function route(req, url) {
  // Unauthenticated + no Picnic call, so a Docker healthcheck can poll it freely.
  if (req.method === "GET" && url.pathname === "/health") return { ok: true };

  if (!authorized(req)) throw new HttpError(401, "unauthorized");

  if (req.method === "GET" && url.pathname === "/status") {
    const connected = await sessionIsValid();
    // The login script runs in another process: re-read the session file next time.
    if (!connected) resetClient();
    return { connected };
  }

  if (req.method === "GET" && url.pathname === "/search") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q || q.length > 100) throw new HttpError(400, "invalid_query");
    const results = await searchProducts(await getClient(), q);
    return { results: results.slice(0, SEARCH_LIMIT), total: results.length };
  }

  if (req.method === "GET" && url.pathname === "/cart") {
    return summarizeCart(await (await getClient()).cart.getCart());
  }

  if (req.method === "POST" && url.pathname === "/cart/add") {
    const { items } = await readJson(req);
    if (!Array.isArray(items) || !items.length || items.length > MAX_ADD_ITEMS) {
      throw new HttpError(400, "invalid_items");
    }
    const products = items.map((i) => {
      const count = i?.count ?? 1;
      if (!PRODUCT_ID.test(String(i?.id)) || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
        throw new HttpError(400, "invalid_items");
      }
      return { productId: String(i.id), quantity: count };
    });
    return summarizeCart(await (await getClient()).cart.addProductsToCart(products));
  }

  throw new HttpError(404, "not_found");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://sidecar");
  let status = 200;
  let body;
  try {
    body = await route(req, url);
  } catch (e) {
    if (e instanceof HttpError) {
      status = e.status;
      body = { error: e.error };
    } else if (e instanceof NotConnectedError) {
      resetClient();
      status = 409;
      body = { error: "not_connected" };
    } else {
      status = 502;
      body = { error: "picnic_error", message: e?.message ?? String(e) };
    }
  }
  console.log(`${req.method} ${url.pathname} -> ${status}`);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
});

server.listen(PORT, () => console.log(`picnic-sidecar listening on :${PORT}`));
