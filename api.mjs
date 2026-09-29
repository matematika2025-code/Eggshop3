import { getStore } from "@netlify/blobs";
const SIZES = ["Jumbo", "Xtra Large", "Large", "Medium"];
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
const clean = (v, n) => String(v ?? "").trim().slice(0, n);

export default async (req) => {
  const store = getStore("eggshop");
  const route = new URL(req.url).pathname.replace(/^\/(\.netlify\/functions\/)?api\/?/, "").replace(/\/$/, "");
  const isAdmin = () => !!process.env.ADMIN_PASSWORD && req.headers.get("x-admin-password") === process.env.ADMIN_PASSWORD;
  const getInv = async () => (await store.get("inventory", { type: "json" })) || { cur: "", items: {} };

  try {
    if (route === "inventory" && req.method === "GET") return json(await getInv());

    if (route === "order" && req.method === "POST") {
      const b = await req.json();
      const name = clean(b.name, 100), address = clean(b.address, 300), phone = clean(b.phone, 30);
      if (!name || !address) return json({ error: "Name and address are required." }, 400);
      const inv = await getInv(), lines = [];
      let total = 0;
      for (const s of SIZES) {
        const q = Math.floor(Number(b.qty?.[s]) || 0);
        if (q <= 0) continue;
        const i = inv.items[s] || { price: 0, stock: 0 };
        if (q > i.stock) return json({ error: `Sorry, only ${i.stock} tray(s) of ${s} left.` }, 409);
        i.stock -= q; inv.items[s] = i;
        lines.push({ size: s, qty: q, price: i.price }); total += q * i.price;
      }
      if (!lines.length) return json({ error: "Choose at least one tray." }, 400);
      await store.setJSON("inventory", inv);
      const at = Date.now(), id = `${at}-${Math.random().toString(36).slice(2, 7)}`;
      await store.setJSON(`order:${id}`, { id, name, address, phone, lines, total, status: "pending", at });
      return json({ ok: true, id });
    }

    if (!isAdmin()) return json({ error: "Unauthorized" }, 401);

    if (route === "inventory" && req.method === "POST") {
      const b = await req.json(), items = {};
      for (const s of SIZES) items[s] = { price: Math.max(0, Number(b.items?.[s]?.price) || 0), stock: Math.max(0, Math.floor(Number(b.items?.[s]?.stock) || 0)) };
      await store.setJSON("inventory", { cur: clean(b.cur, 4), items });
      return json({ ok: true });
    }
    if (route === "orders" && req.method === "GET") {
      const { blobs } = await store.list({ prefix: "order:" });
      const orders = (await Promise.all(blobs.map((x) => store.get(x.key, { type: "json" })))).filter(Boolean);
      return json({ orders: orders.sort((a, b) => b.at - a.at).slice(0, 200) });
    }
    if (route === "done" && req.method === "POST") {
      const { id } = await req.json(), key = `order:${clean(id, 60)}`;
      const o = await store.get(key, { type: "json" });
      if (!o) return json({ error: "Not found" }, 404);
      o.status = "delivered"; await store.setJSON(key, o);
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: "Server error: " + (e && e.message ? e.message : String(e)) }, 500);
  }
};
export const config = { path: ["/api", "/api/*"] };
