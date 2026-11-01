/**
 * API de la tienda N3TFL1X — Vercel Function
 * ------------------------------------------------------------
 * El frontend vive en GitHub Pages y esta función es el único
 * lugar donde existe el token de Notion.
 *
 * Variables de entorno (Vercel > Settings > Environment Variables):
 *   NOTION_TOKEN    (secret)  token de la integración de Notion
 *   ADMIN_PASSWORD  (secret)  contraseña del panel de administración
 *   ALLOWED_ORIGIN  (text)    origen permitido, ej: https://usuario.github.io
 *                             (admite varios separados por coma, o "*")
 *   YAPE_NUMBER     (text)    número de Yape que verá el cliente
 *   YAPE_NAME       (text)    titular de la cuenta Yape
 * ------------------------------------------------------------
 */

const NOTION = "https://api.notion.com/v1";

const DB = {
  orders: "40b13bcc-c7ed-8146-8e50-d0fe7e9e4725",
  products: "40b13bcc-c7ed-81f5-b067-f44dc8d8a17a",
  clients: "40b13bcc-c7ed-81bc-b912-e64bc871fbea",
  payments: "40b13bcc-c7ed-81b9-bc91-c16a379633a6",
  promos: "40b13bcc-c7ed-810e-9e61-d54be898a852",
};

const S = {
  pending: "🟡 Esperando aprobación",
  approved: "✅ Aprobado · esperando pago",
  review: "🔍 Pago en revisión",
  paid: "🔐 Pago validado · por entregar",
  delivered: "📦 Entregado",
  cancelled: "❌ Cancelado",
  refunded: "↩️ Reembolsado",
};

const MAX_FILE = 4 * 1024 * 1024; // 4 MB (Vercel limita el body a 4.5 MB)

export async function handle(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = getAllowedOrigin(env, origin);
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(allowed) });
  try {
    const url = new URL(request.url);
    const path = logicalPath(url);
    const res = await route(request, env, url, path);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders(allowed))) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status,
      headers: { ...corsHeaders(allowed), "Content-Type": "application/json" },
    });
  }
}

/**
 * En Vercel todas las peticiones llegan a /api y el frontend envía
 * la ruta lógica en ?route=/api/... (así no dependemos de rewrites).
 * También acepta rutas directas /api/... para pruebas locales.
 */
function logicalPath(url) {
  let path = url.searchParams.get("route") || url.pathname;
  if (!path.startsWith("/")) path = "/" + path;
  if (path === "/" || path === "/api" || path === "/api/") return "/";
  if (!path.startsWith("/api/")) path = "/api" + path;
  return path.replace(/\/+$/, "") || "/";
}

/* ---------------------------------- rutas --------------------------------- */

async function route(req, env, url, path) {
  const m = req.method;
  if (path === "/" || path === "/api/health") return ok({ ok: true, service: "n3tfl1x-store" });
  if (path === "/api/catalog" && m === "GET") return ok(await getCatalog(env));

  if (path === "/api/orders" && m === "POST") return ok(await createOrder(req, env));

  let hit;
  if ((hit = path.match(/^\/api\/orders\/([A-Z0-9]{4,12})$/)) && m === "GET")
    return ok(await getOrderPublic(env, hit[1], url.searchParams.get("k")));

  if ((hit = path.match(/^\/api\/orders\/([A-Z0-9]{4,12})\/payment$/)) && m === "POST")
    return ok(await uploadPayment(req, env, hit[1], url.searchParams.get("k")));

  if ((hit = path.match(/^\/api\/orders\/([A-Z0-9]{4,12})\/observations$/)) && m === "POST")
    return ok(await addObservation(req, env, hit[1], url.searchParams.get("k")));

  if (path === "/api/admin/login" && m === "POST") return ok(await adminLogin(req, env));
  if (path === "/api/admin/orders" && m === "GET") {
    await requireAdmin(req, env);
    return ok(await adminOrders(env));
  }
  if ((hit = path.match(/^\/api\/admin\/orders\/([0-9a-fA-F-]{36})\/(approve|reject|validate-payment|deliver)$/)) && m === "POST") {
    await requireAdmin(req, env);
    return ok(await adminAction(req, env, hit[1], hit[2]));
  }
  fail(404, "Ruta no encontrada");
}

/* -------------------------------- catálogo -------------------------------- */

async function getCatalog(env) {
  const data = await notion(env, `/databases/${DB.products}/query`, {
    method: "POST",
    body: {
      page_size: 100,
      filter: {
        or: [
          { property: "Estado", select: { equals: "🟢 Activo" } },
          { property: "Estado", select: { equals: "🟠 Últimos cupos" } },
        ],
      },
      sorts: [
        { property: "Destacado", direction: "descending" },
        { property: "Producto", direction: "ascending" },
      ],
    },
  });
  return {
    products: (data.results || []).map((p) => {
      const pr = p.properties;
      const stock = num(pr["Stock disponible"]) ?? num(pr["Cupos / Stock"]);
      return {
        id: p.id,
        name: text(pr["Producto"]),
        category: sel(pr["Categoría"]) || "Otros",
        platform: text(pr["Plataforma"]),
        plan: text(pr["Plan / Duración"]),
        delivery: sel(pr["Tipo de entrega"]) || "Cuenta privada",
        price: num(pr["Precio venta (S/)"]) || 0,
        stock,
        available: stock === null ? true : stock > 0,
        state: sel(pr["Estado"]),
        warranty: sel(pr["Garantía"]),
        description: text(pr["Descripción"]),
        image: pr["Imagen (URL)"]?.url || null,
        highlighted: !!pr["Destacado"]?.checkbox,
        days: parseDays(text(pr["Plan / Duración"])),
      };
    }),
  };
}

/* --------------------------------- pedidos -------------------------------- */

async function createOrder(req, env) {
  const body = await req.json().catch(() => fail(400, "JSON inválido"));
  const name = clean(body.name, 80);
  const whatsapp = clean(body.whatsapp, 25).replace(/[^\d+ ]/g, "");
  const email = clean(body.email || "", 120);
  const note = clean(body.note || "", 900);
  const promoCode = clean(body.promoCode || "", 30).toUpperCase();
  const items = Array.isArray(body.items) ? body.items.slice(0, 6) : [];

  if (name.length < 2) fail(400, "Escribe tu nombre completo");
  if (whatsapp.replace(/\D/g, "").length < 6) fail(400, "Escribe un WhatsApp válido");
  if (!items.length) fail(400, "Selecciona al menos un producto");

  // Precios SIEMPRE desde Notion (nunca desde el navegador)
  const products = [];
  for (const it of items) {
    const id = clean(it.id, 50);
    const qty = Math.min(Math.max(parseInt(it.qty, 10) || 1, 1), 10);
    const page = await notion(env, `/pages/${id}`);
    if (page.parent?.database_id !== DB.products) fail(400, "Producto inválido");
    const pr = page.properties;
    if (sel(pr["Estado"]) === "🔴 Agotado") fail(409, `"${text(pr["Producto"])}" está agotado`);
    products.push({
      id,
      qty,
      name: text(pr["Producto"]),
      price: num(pr["Precio venta (S/)"]) || 0,
      days: parseDays(text(pr["Plan / Duración"])),
      delivery: sel(pr["Tipo de entrega"]) || "",
      warranty: sel(pr["Garantía"]) || "",
      category: sel(pr["Categoría"]) || "",
    });
  }

  const subtotal = round(products.reduce((a, p) => a + p.price * p.qty, 0));
  const totalUnits = products.reduce((a, p) => a + p.qty, 0);
  const unit = round(subtotal / totalUnits);

  const promo = promoCode ? await findPromo(env, promoCode) : null;
  const promoApplies = promo && (promo.category === "Todas" || products.some((p) => p.category === promo.category));
  const discount = promoApplies ? promoDiscount(promo, subtotal) : 0;
  const discountPct = subtotal > 0 ? round((discount / subtotal) * 100, 2) : 0;
  const suggested = round(subtotal - discount);

  const clientId = await upsertClient(env, { name, whatsapp, email });

  const tracking = randomCode(4) + randomCode(4);
  const token = randomHex(24);

  const detail = products
    .map((p) => `${p.name} x${p.qty} (S/ ${p.price})`)
    .join(" | ")
    .slice(0, 1900);

  const props = {
    "Pedido": title(`${name} · ${products.map((p) => p.name).join(", ")}`),
    "Tracking ID": rt(tracking),
    "Token de seguimiento": rt(token),
    "Cliente": { relation: [{ id: clientId }] },
    "Productos": { relation: products.map((p) => ({ id: p.id })) },
    "Promoción aplicada": rt(promoApplies ? `${promo.code} · ${promo.label}` : ""),
    "Detalle del pedido": rt(detail),
    "Cantidad": { number: totalUnits },
    "Precio unitario (S/)": { number: unit },
    "Descuento (%)": { number: discountPct },
    "Método de pago": { select: { name: "Yape" } },
    "Estado del pedido": { select: { name: S.pending } },
    "Fecha de venta": { date: { start: localDate() } },
    "Duración (días)": { number: Math.max(...products.map((p) => p.days || 30)) },
    "Vendedor": rt("Web"),
    "Canal": { select: { name: "Web" } },
    "Nombre del cliente (texto)": rt(name),
    "WhatsApp (texto)": { phone_number: whatsapp },
    "Observaciones del cliente": rt(note),
    "Notas": rt(`Pedido creado desde la web. Total sugerido: S/ ${suggested}`),
  };
  if (promoApplies) props["Promoción"] = { relation: [{ id: promo.id }] };

  const page = await notion(env, `/pages`, { method: "POST", body: { parent: { database_id: DB.orders, type: "database_id" }, properties: props } });
  const codeNum = page.properties["Código"]?.unique_id?.number;

  return {
    ok: true,
    tracking,
    token,
    code: codeNum ? `PED-${codeNum}` : tracking,
    state: S.pending,
    subtotal,
    discount,
    suggestedTotal: suggested,
    items: products.map((p) => ({ name: p.name, qty: p.qty, price: p.price })),
  };
}

async function getOrderPublic(env, tracking, token) {
  const page = await findOrder(env, tracking);
  if (!page) fail(404, "Pedido no encontrado");
  const props = page.properties;
  if (!token || !safeEqual(text(props["Token de seguimiento"]), token)) fail(403, "Enlace inválido o vencido");

  const state = sel(props["Estado del pedido"]) || S.pending;
  const code = props["Código"]?.unique_id?.number;
  const total = num(props["Total (S/)"]);
  const approved = num(props["Precio aprobado (S/)"]);
  const amount = approved ?? total ?? 0;
  const delivered = state === S.delivered || state === "🏁 Completado" || state === "🔐 Habilitado / entregado";
  const canPay = state === S.approved;

  const payment = await latestPayment(env, page.id);
  const items = parseDetail(text(props["Detalle del pedido"]));
  const deliveredAt = date(props["Fecha de entrega"]);
  const days = num(props["Duración (días)"]) || 30;

  return {
    ok: true,
    tracking,
    code: code ? `PED-${code}` : tracking,
    state,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    client: { name: text(props["Nombre del cliente (texto)"]), whatsapp: phone(props["WhatsApp (texto)"]) },
    items,
    subtotal: total,
    discountPct: num(props["Descuento (%)"]) || 0,
    suggestedTotal: total,
    approvedAmount: approved,
    amount,
    promo: text(props["Promoción aplicada"]) || null,
    note: text(props["Observaciones del cliente"]) || "",
    yape: canPay || state === S.review ? { number: env.YAPE_NUMBER || "", name: env.YAPE_NAME || "" } : null,
    canPay,
    payment: payment
      ? {
          status: payment.status,
          amount: payment.amount,
          operation: payment.operation,
          date: payment.date,
          imageUrl: payment.imageUrl,
          observation: payment.observation,
        }
      : null,
    delivery: delivered
      ? {
          usuario: text(props["Usuario / Correo"]),
          password: text(props["Contraseña"]),
          perfil: text(props["Perfil"]),
          pin: text(props["PIN"]),
          notas: text(props["Cuenta / perfil entregado"]),
          deliveredAt,
          expiresAt: deliveredAt ? addDays(deliveredAt, days) : null,
          days,
        }
      : null,
    observations: text(props["Observaciones del cliente"]) || "",
  };
}

async function uploadPayment(req, env, tracking, token) {
  const page = await findOrder(env, tracking);
  if (!page) fail(404, "Pedido no encontrado");
  const props = page.properties;
  if (!token || !safeEqual(text(props["Token de seguimiento"]), token)) fail(403, "Enlace inválido o vencido");

  const state = sel(props["Estado del pedido"]);
  if (state !== S.approved && state !== S.review) fail(409, "El pedido todavía no está aprobado para recibir el pago");

  const form = await req.formData();
  const file = form.get("image");
  if (!file || typeof file === "string") fail(400, "Adjunta la captura de Yape");
  if (file.size > MAX_FILE) fail(413, "El archivo supera los 4 MB. Envía una captura más liviana o un PDF más pequeño.");
  const type = file.type || "image/png";
  if (!type.startsWith("image/") && type !== "application/pdf") fail(415, "Formato no permitido (usa JPG, PNG, WEBP o PDF)");

  const amount = round(Number(form.get("amount")) || 0);
  const operation = clean(form.get("operation") || "", 60);
  const payDate = clean(form.get("date") || localDate(), 10);
  const note = clean(form.get("note") || "", 600);
  if (amount <= 0) fail(400, "Indica el monto pagado");

  // 1) crear file upload en Notion
  const upload = await notion(env, `/file_uploads`, {
    method: "POST",
    body: { filename: safeName(file.name || "yape.png"), content_type: type },
  });
  // 2) subir los bytes
  const fd = new FormData();
  fd.append("file", file, safeName(file.name || "yape.png"));
  const upRes = await fetch(upload.upload_url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": "2022-06-28" },
    body: fd,
  });
  if (!upRes.ok) fail(502, "No se pudo subir la imagen a Notion");

  // 3) fila de comprobante
  const clientId = props["Cliente"]?.relation?.[0]?.id;
  const paymentProps = {
    "Comprobante": title(`Yape S/ ${amount} · ${text(props["Nombre del cliente (texto)"]) || tracking}`),
    "Monto (S/)": { number: amount },
    "Fecha de pago": { date: { start: payDate } },
    "N° de operación": rt(operation),
    "Imagen Yape": { files: [{ type: "file_upload", file_upload: { id: upload.id } }] },
    "WhatsApp": { phone_number: phone(props["WhatsApp (texto)"]) || null },
    "Validación": { select: { name: "🕒 Por revisar" } },
    "Observación": rt(note),
    "Pedido": { relation: [{ id: page.id }] },
    "Nombre del cliente (formulario)": rt(text(props["Nombre del cliente (texto)"])),
    "Código de pedido (formulario)": rt(tracking),
  };
  if (clientId) paymentProps["Cliente"] = { relation: [{ id: clientId }] };

  await notion(env, `/pages`, { method: "POST", body: { parent: { database_id: DB.payments, type: "database_id" }, properties: paymentProps } });

  await notion(env, `/pages/${page.id}`, {
    method: "PATCH",
    body: {
      properties: {
        "Estado del pedido": { select: { name: S.review } },
        "Notas": rt(text(props["Notas"]) + `\nComprobante subido por el cliente el ${localDate()}.`),
      },
    },
  });

  return { ok: true, state: S.review };
}

async function addObservation(req, env, tracking, token) {
  const page = await findOrder(env, tracking);
  if (!page) fail(404, "Pedido no encontrado");
  const props = page.properties;
  if (!token || !safeEqual(text(props["Token de seguimiento"]), token)) fail(403, "Enlace inválido o vencido");

  const body = await req.json().catch(() => ({}));
  const msg = clean(body.message, 800);
  if (msg.length < 2) fail(400, "Escribe una observación");

  const prev = text(props["Observaciones del cliente"]);
  const line = `[${localDateTime()}] Cliente: ${msg}`;
  const next = (prev ? prev + "\n" : "") + line;

  await notion(env, `/pages/${page.id}`, {
    method: "PATCH",
    body: { properties: { "Observaciones del cliente": rt(next) } },
  });
  return { ok: true, observations: next };
}

/* --------------------------------- admin ---------------------------------- */

async function adminLogin(req, env) {
  const ip = "global";
  if (!rateLimit(ip)) fail(429, "Demasiados intentos. Espera unos minutos.");
  const body = await req.json().catch(() => ({}));
  const pass = String(body.password || "");
  if (!env.ADMIN_PASSWORD) fail(500, "Falta configurar ADMIN_PASSWORD en Vercel");
  if (!pass || !safeEqual(pass, env.ADMIN_PASSWORD)) fail(401, "Contraseña incorrecta");
  return { ok: true, token: await signSession(env), expiresIn: 8 * 3600 };
}

async function adminOrders(env) {
  const [orders, payments] = await Promise.all([
    notion(env, `/databases/${DB.orders}/query`, {
      method: "POST",
      body: { page_size: 100, sorts: [{ timestamp: "last_edited_time", direction: "descending" }] },
    }),
    notion(env, `/databases/${DB.payments}/query`, { method: "POST", body: { page_size: 100 } }),
  ]);

  const byOrder = new Map();
  for (const p of payments.results || []) {
    const orderId = p.properties["Pedido"]?.relation?.[0]?.id;
    if (!orderId) continue;
    if (!byOrder.has(orderId)) byOrder.set(orderId, []);
    byOrder.get(orderId).push(mapPayment(p));
  }
  for (const list of byOrder.values()) list.sort((a, b) => (a.created < b.created ? 1 : -1));

  return {
    orders: (orders.results || []).map((o) => mapAdminOrder(o, byOrder.get(o.id) || [])),
    stats: statsOf((orders.results || []).map((o) => sel(o.properties["Estado del pedido"]))),
  };
}

async function adminAction(req, env, orderId, action) {
  const body = await req.json().catch(() => ({}));
  const page = await notion(env, `/pages/${orderId}`);
  const props = page.properties;

  if (action === "approve") {
    const amount = round(Number(body.amount));
    if (!(amount > 0)) fail(400, "Indica el monto aprobado");
    const note = clean(body.note || "", 500);
    await patch(env, orderId, {
      "Precio aprobado (S/)": { number: amount },
      "Estado del pedido": { select: { name: S.approved } },
      "Método de pago": { select: { name: "Yape" } },
      "Fecha de venta": props["Fecha de venta"]?.date ? undefined : { date: { start: localDate() } },
      "Notas": rt(appendNote(props, `Aprobado por S/ ${amount}${note ? " · " + note : ""}`)),
    });
    return { ok: true, state: S.approved, amount };
  }

  if (action === "reject") {
    const reason = clean(body.reason || "", 400);
    await patch(env, orderId, {
      "Estado del pedido": { select: { name: S.cancelled } },
      "Notas": rt(appendNote(props, `Pedido cancelado${reason ? ": " + reason : ""}`)),
    });
    return { ok: true, state: S.cancelled };
  }

  if (action === "validate-payment") {
    const paymentId = clean(body.paymentId || "", 50);
    const valid = !!body.valid;
    if (!paymentId) fail(400, "Falta el comprobante");
    const pay = await notion(env, `/pages/${paymentId}`);
    if (pay.parent?.database_id !== DB.payments) fail(400, "Comprobante inválido");
    if (!(pay.properties["Pedido"]?.relation || []).some((r) => r.id === orderId))
      fail(409, "El comprobante no pertenece a este pedido");
    const note = clean(body.note || "", 400);
    await patch(env, paymentId, {
      "Validación": { select: { name: valid ? "✅ Validado" : "❌ Rechazado" } },
      "Observación": rt(note || (valid ? "Pago verificado por el administrador." : "Pago rechazado.")),
    });
    await patch(env, orderId, {
      "Estado del pedido": { select: { name: valid ? S.paid : S.approved } },
      "Notas": rt(appendNote(props, valid ? "Pago validado." : `Pago rechazado${note ? ": " + note : ""}`)),
    });
    return { ok: true, state: valid ? S.paid : S.approved };
  }

  if (action === "deliver") {
    const usuario = clean(body.usuario || "", 300);
    const password = clean(body.password || "", 300);
    const perfil = clean(body.perfil || "", 300);
    const pin = clean(body.pin || "", 120);
    const notas = clean(body.notas || "", 900);
    if (!usuario && !password) fail(400, "Ingresa al menos usuario o contraseña");
    if (!isPaidState(sel(props["Estado del pedido"])))
      fail(409, "Primero valida el pago del cliente antes de entregar el acceso");

    await patch(env, orderId, {
      "Usuario / Correo": rt(usuario),
      "Contraseña": rt(password),
      "Perfil": rt(perfil),
      "PIN": rt(pin),
      "Cuenta / perfil entregado": rt(notas || perfil || usuario),
      "Acceso habilitado": { checkbox: true },
      "Fecha de entrega": { date: { start: localDate() } },
      "Estado del pedido": { select: { name: S.delivered } },
      "Notas": rt(appendNote(props, "Credenciales entregadas al cliente.")),
    });
    return { ok: true, state: S.delivered };
  }

  fail(400, "Acción no válida");
}

/* ------------------------------ notificaciones ---------------------------- */

function mapAdminOrder(page, payments) {
  const p = page.properties;
  const state = sel(p["Estado del pedido"]) || S.pending;
  const approved = num(p["Precio aprobado (S/)"]);
  const total = num(p["Total (S/)"]);
  return {
    id: page.id,
    tracking: text(p["Tracking ID"]),
    token: text(p["Token de seguimiento"]),
    code: p["Código"]?.unique_id?.number ? `PED-${p["Código"].unique_id.number}` : "",
    url: page.url,
    state,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    client: {
      id: p["Cliente"]?.relation?.[0]?.id || null,
      name: text(p["Nombre del cliente (texto)"]),
      whatsapp: phone(p["WhatsApp (texto)"]),
    },
    items: parseDetail(text(p["Detalle del pedido"])),
    subtotal: total,
    discountPct: num(p["Descuento (%)"]) || 0,
    approvedAmount: approved,
    amount: approved ?? total ?? 0,
    promo: text(p["Promoción aplicada"]),
    note: text(p["Observaciones del cliente"]),
    internalNotes: text(p["Notas"]),
    hasCredentials: !!(text(p["Usuario / Correo"]) || text(p["Contraseña"])),
    credentials: {
      usuario: text(p["Usuario / Correo"]),
      password: text(p["Contraseña"]),
      perfil: text(p["Perfil"]),
      pin: text(p["PIN"]),
    },
    deliveredAt: date(p["Fecha de entrega"]),
    payments,
  };
}

function mapPayment(page) {
  const p = page.properties;
  const files = p["Imagen Yape"]?.files || [];
  const f = files[0];
  return {
    id: page.id,
    created: page.created_time,
    status: sel(p["Validación"]) || "🕒 Por revisar",
    amount: num(p["Monto (S/)"]) || 0,
    operation: text(p["N° de operación"]),
    date: date(p["Fecha de pago"]),
    observation: text(p["Observación"]),
    imageUrl: f ? f.file?.url || f.external?.url || null : null,
  };
}

function statsOf(states) {
  return {
    total: states.length,
    pending: states.filter((s) => s === S.pending || s === "🟡 Pendiente de pago").length,
    approved: states.filter((s) => s === S.approved).length,
    review: states.filter((s) => s === S.review).length,
    paid: states.filter((s) => isPaidState(s)).length,
    delivered: states.filter((s) => s === S.delivered || s === "🏁 Completado" || s === "🔐 Habilitado / entregado").length,
  };
}

function isPaidState(state) {
  return state === S.paid || state === "✅ Pagado · por entregar";
}

/* -------------------------------- helpers --------------------------------- */

async function notion(env, path, { method = "GET", body } = {}) {
  if (!env.NOTION_TOKEN) fail(500, "Falta configurar NOTION_TOKEN en Vercel");
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(NOTION + path, init);
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!res.ok) {
    console.error("Notion", path, res.status, txt.slice(0, 400));
    fail(502, "Notion: " + (data.message || res.status));
  }
  return data;
}

const patch = (env, id, properties) => {
  const clean = {};
  for (const [k, v] of Object.entries(properties)) if (v !== undefined) clean[k] = v;
  return notion(env, `/pages/${id}`, { method: "PATCH", body: { properties: clean } });
};

async function findOrder(env, tracking) {
  const data = await notion(env, `/databases/${DB.orders}/query`, {
    method: "POST",
    body: { page_size: 1, filter: { property: "Tracking ID", rich_text: { equals: tracking } } },
  });
  return (data.results || [])[0] || null;
}

async function latestPayment(env, orderId) {
  const data = await notion(env, `/databases/${DB.payments}/query`, {
    method: "POST",
    body: {
      page_size: 5,
      filter: { property: "Pedido", relation: { contains: orderId } },
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    },
  });
  const p = (data.results || [])[0];
  return p ? mapPayment(p) : null;
}

async function upsertClient(env, { name, whatsapp, email }) {
  const found = await notion(env, `/databases/${DB.clients}/query`, {
    method: "POST",
    body: { page_size: 1, filter: { property: "WhatsApp", phone_number: { equals: whatsapp } } },
  });
  if (found.results?.length) return found.results[0].id;

  const props = {
    "Cliente": title(name),
    "WhatsApp": { phone_number: whatsapp },
    "Canal de captación": { select: { name: "Web" } },
    "Estado": { select: { name: "Activo" } },
    "Notas": rt("Registrado automáticamente desde la tienda web."),
  };
  if (email) props["Email"] = { email };
  const page = await notion(env, `/pages`, {
    method: "POST",
    body: { parent: { database_id: DB.clients, type: "database_id" }, properties: props },
  });
  return page.id;
}

async function findPromo(env, code) {
  const data = await notion(env, `/databases/${DB.promos}/query`, {
    method: "POST",
    body: { page_size: 3, filter: { property: "Código", rich_text: { equals: code } } },
  });
  const p = (data.results || [])[0];
  if (!p) return null;
  const pr = p.properties;
  if (!pr["Activa"]?.checkbox) return null;
  const from = date(pr["Vigencia desde"]);
  if (from && from > localDate()) return null;
  const until = date(pr["Vigencia hasta"]);
  if (until && until < localDate()) return null;
  return {
    id: p.id,
    code,
    type: sel(pr["Tipo"]) || "",
    value: num(pr["Valor"]) || 0,
    category: sel(pr["Categoría objetivo"]) || "Todas",
    label: `${sel(pr["Tipo"]) || "Promo"} ${num(pr["Valor"]) || ""}`.trim(),
  };
}

function promoDiscount(promo, subtotal) {
  if (subtotal <= 0) return 0;
  if (promo.type === "% Descuento") return round((subtotal * promo.value) / 100);
  if (promo.type === "Monto fijo (S/)") return round(Math.min(promo.value, subtotal));
  if (promo.type === "2x1") return round(subtotal / 2);
  return 0;
}

function parseDetail(str) {
  if (!str) return [];
  return str.split("|").map((s) => {
    const m = s.trim().match(/^(.*?)\sx(\d+)\s*\(S\/\s*([\d.]+)\)$/);
    return m ? { name: m[1].trim(), qty: Number(m[2]), price: Number(m[3]) } : { name: s.trim(), qty: 1, price: 0 };
  });
}

function parseDays(plan) {
  const t = String(plan || "").toLowerCase();
  const m = t.match(/(\d+)\s*(d[ií]as?|mes|meses|año|años)/);
  if (!m) return 30;
  const n = Number(m[1]);
  if (/d[ií]a/.test(m[2])) return n;
  if (/mes/.test(m[2])) return n * 30;
  return n * 365;
}

const text = (p) => (p?.rich_text || p?.title || []).map((t) => t.plain_text).join("");
const phone = (p) => p?.phone_number || "";
const num = (p) => (p?.type === "formula" ? p.formula?.number ?? null : p?.number ?? null);
const sel = (p) => p?.select?.name || null;
const date = (p) => p?.date?.start || null;
const rt = (v) => ({ rich_text: [{ type: "text", text: { content: String(v ?? "").slice(0, 1900) } }] });
const title = (v) => ({ title: [{ type: "text", text: { content: String(v ?? "").slice(0, 1900) } }] });
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const safeName = (n) => String(n).replace(/[^\w.\- ]/g, "_").slice(-80) || "yape.png";

function appendNote(props, line) {
  const prev = text(props["Notas"]);
  return (prev ? prev + "\n" : "") + `[${localDateTime()}] ${line}`;
}
function localDate() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
function localDateTime() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
}
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
function randomCode(n) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}
function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/* ------------------------------ sesión admin ------------------------------ */

const enc = new TextEncoder();
async function signSession(env) {
  const payload = b64url(JSON.stringify({ role: "admin", exp: Date.now() + 8 * 3600 * 1000 }));
  return payload + "." + (await hmac(env, payload));
}
async function requireAdmin(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const [payload, sig] = token.split(".");
  if (!payload || !sig) fail(401, "Sesión requerida");
  const expected = await hmac(env, payload);
  if (!safeEqual(sig, expected)) fail(401, "Sesión inválida");
  let data;
  try { data = JSON.parse(atob(b64decode(payload))); } catch { fail(401, "Sesión inválida"); }
  if (!data.exp || data.exp < Date.now()) fail(401, "Sesión vencida, vuelve a entrar");
}
async function hmac(env, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(`${env.ADMIN_PASSWORD || "x"}::${env.NOTION_TOKEN || "y"}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}
function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64decode(str) {
  return str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
}

const attempts = new Map();
function rateLimit(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, reset: now + 10 * 60 * 1000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 10 * 60 * 1000; }
  rec.count++;
  attempts.set(key, rec);
  return rec.count <= 12;
}

/* --------------------------------- CORS ----------------------------------- */

function getAllowedOrigin(env, origin) {
  const list = String(env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length || list.includes("*")) return "*";
  if (origin && list.includes(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return list[0];
}
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/* -------------------------------- respuestas ------------------------------ */

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
