// 선물 시험용 가짜 Supabase·문자·텔레그램. 실제 네트워크로 나가지 않는다.
const json = (x, status = 200) => new Response(JSON.stringify(x), { status });
export function fakeDb(start) {
  const db = { row: start, patches: [], order: null, orderPatches: [], intent: null, sms: [], tg: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("api.solapi.com")) {
      const b = JSON.parse(init.body); db.sms.push(...b.messages);
      return json({ groupInfo: { count: { registeredSuccess: b.messages.length, registeredFailed: 0 } } });
    }
    if (u.includes("api.telegram.org")) { db.tg.push(JSON.parse(init.body)); return json({ ok: true }); }
    if (u.includes("/gift_links") && init.method === "PATCH") {
      const fields = JSON.parse(init.body);
      db.patches.push(fields);
      db.row = { ...db.row, ...fields };
      return json([db.row]);
    }
    const want = (u.match(/[?&]status=eq\.([a-z_]+)/) || [])[1];
    const before = decodeURIComponent((u.match(/[?&]expires_at=lt\.([^&]+)/) || [])[1] || "");
    if (u.includes("/gift_links")) return json(db.row && (!want || db.row.status === want) && (!before || db.row.expires_at < before) ? [db.row] : []);
    if (u.includes("/payment_intents")) return json(db.intent ? [{ order_data: db.intent, order_id: db.row && db.row.order_id }] : []);
    if (u.includes("/orders") && init.method === "PATCH") {
      const fields = JSON.parse(init.body);
      db.orderPatches.push(fields);
      if (!db.order || !["gift_wait", "new"].includes(db.order.status)) return json([]);
      db.order = { ...db.order, ...fields };
      return json([{ order_id: db.order.order_id }]);
    }
    if (u.includes("/orders")) return json(db.order && (!want || db.order.status === want) ? [db.order] : []);
    throw new Error("unexpected " + u);
  };
  return db;
}
