/* =========================================================
   N3TFL1X Store · lógica de la tienda (frontend)
   ========================================================= */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const API = String(CFG.API_BASE || location.origin).replace(/\/+$/, "");
  const CUR = CFG.CURRENCY || "S/";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const state = {
    products: [],
    filter: "Todos",
    cart: readJSON("n3t_cart", []),
    order: null,
    orderKey: null,
    poll: null,
  };

  const EMOJI = {
    streaming: "🎬",
    ia: "🤖",
    libros: "📚",
    diseno: "🎨",
    musica: "🎧",
    otros: "✨",
  };

  /* ----------------------------- utilidades ----------------------------- */

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(n) {
    const v = Number(n) || 0;
    return `${CUR} ${v.toLocaleString("es-PE", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  }
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast show" + (isError ? " err" : "");
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = "toast"), 3200);
  }
  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label || "Copiado"} ✓`);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast(`${label || "Copiado"} ✓`);
    }
  }
  // La API de Vercel recibe todas las rutas en /api y la ruta lógica va en ?route=
  function apiUrl(path) {
    const [route, query] = String(path).split("?");
    return `${API}/api?route=${encodeURIComponent(route)}${query ? `&${query}` : ""}`;
  }
  async function api(path, opts = {}) {
    if (!API || API.includes("TU-API")) throw new Error("Falta configurar la URL de la API en assets/config.js");
    const res = await fetch(apiUrl(path), opts);
    const txt = await res.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { error: txt }; }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }
  const prettyDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
  };

  /* ------------------------------- arranque ----------------------------- */

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    $("#brandName").textContent = CFG.BRAND || "Tienda";
    $("#footerBrand").textContent = CFG.BRAND || "Tienda";
    if (CFG.TAGLINE) $("#heroSub").textContent = CFG.TAGLINE;
    document.title = `${CFG.BRAND || "Tienda"} · Streaming, IA y libros digitales`;
    if (CFG.WHATSAPP) {
      $("#waLink").href = `https://wa.me/${CFG.WHATSAPP}?text=${encodeURIComponent("Hola, quiero información sobre un producto")}`;
    }
    if (!API || API.includes("TU-API")) $("#setupBanner").hidden = false;

    bindUI();
    loadCatalog();
    updateCartCount();
    initMotion();
    handleRoute();
    window.addEventListener("hashchange", handleRoute);

    // Refresca el catálogo al volver a la pestaña (por si editaste Notion entretanto).
    let lastRefresh = Date.now();
    const refreshCatalog = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastRefresh < 5000) return;
      lastRefresh = Date.now();
      loadCatalog(true);
    };
    document.addEventListener("visibilitychange", refreshCatalog);
    window.addEventListener("focus", refreshCatalog);
    // Y también cada minuto, por si dejas la tienda abierta mientras editas Notion.
    setInterval(refreshCatalog, 60000);
  }

  function bindUI() {
    // Los errores de imagen no burbujean: capturarlos conserva la tarjeta y su distintivo.
    $("#productGrid").addEventListener("error", (event) => {
      const img = event.target;
      if (!img.matches?.("img[data-product-cover]")) return;
      img.hidden = true;
      const fallback = img.parentElement.querySelector(".p-placeholder");
      if (fallback) fallback.hidden = false;
    }, true);
    $("#cartBtn").addEventListener("click", openCart);
    $("#dockCart")?.addEventListener("click", openCart);
    $("#closeCart").addEventListener("click", closeCart);
    $("#cartBackdrop").addEventListener("click", closeCart);
    $("#checkoutBtn").addEventListener("click", openCheckout);
    $("#closeCheckout").addEventListener("click", closeCheckout);
    $("#checkoutBackdrop").addEventListener("click", (e) => { if (e.target.id === "checkoutBackdrop") closeCheckout(); });
    $("#checkoutForm").addEventListener("submit", submitOrder);
    $("#lookupForm").addEventListener("submit", onLookup);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeCart(); closeCheckout(); } });
  }

  /* ------------------------------ animaciones ---------------------------- */

  function initMotion() {
    const reveals = $$(".reveal");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!("IntersectionObserver" in window) || reduce) {
      reveals.forEach((el) => el.classList.add("in"));
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            e.target.classList.add("in");
            io.unobserve(e.target);
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
      );
      reveals.forEach((el) => io.observe(el));
    }

    // Halo que sigue al cursor sobre las tarjetas (delegado: el grid se re-renderiza)
    const grid = $("#productGrid");
    if (grid && !reduce) {
      grid.addEventListener(
        "pointermove",
        (e) => {
          const card = e.target.closest(".p-card");
          if (!card) return;
          const r = card.getBoundingClientRect();
          card.style.setProperty("--mx", `${e.clientX - r.left}px`);
          card.style.setProperty("--my", `${e.clientY - r.top}px`);
        },
        { passive: true }
      );
    }
  }

  /* ------------------------------- catálogo ----------------------------- */

  async function loadCatalog(silent) {
    const grid = $("#productGrid");
    try {
      // sello de tiempo para que ningún proxy/CDN sirva una copia vieja del catálogo
      const data = await api(`/api/catalog?t=${Date.now()}`);
      state.products = data.products || [];
      renderFilters();
      renderProducts();
    } catch (err) {
      if (silent) return; // un refresco en segundo plano no debe romper la vista
      grid.innerHTML = `<div class="empty"><strong>No se pudo cargar el catálogo</strong><br><span class="muted">${esc(err.message)}</span></div>`;
    }
  }

  function renderFilters() {
    const cats = ["Todos", ...Array.from(new Set(state.products.map((p) => p.category).filter(Boolean)))];
    const wrap = $("#filters");
    wrap.innerHTML = cats
      .map((c) => `<button type="button" class="chip ${state.filter === c ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join("");
    $$(".chip", wrap).forEach((b) =>
      b.addEventListener("click", () => {
        state.filter = b.dataset.cat;
        renderFilters();
        renderProducts();
      })
    );
  }

  function renderProducts() {
    const grid = $("#productGrid");
    const list = state.filter === "Todos" ? state.products : state.products.filter((p) => p.category === state.filter);
    if (!list.length) {
      grid.innerHTML = `<div class="empty">No hay productos disponibles en esta categoría.</div>`;
      return;
    }
    grid.innerHTML = list
      .map((p, i) => {
        const key = (p.category || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const emoji = EMOJI[key] || "✨";
        const stock = p.stock === null || p.stock === undefined ? "" : p.stock <= 0 ? "Agotado" : p.stock <= 3 ? `¡Quedan ${p.stock}!` : `${p.stock} disponibles`;
        const stockCls = p.stock !== null && p.stock !== undefined ? (p.stock <= 0 ? "out" : p.stock <= 3 ? "low" : "") : "";
        return `
        <article class="p-card" style="--i:${i}">
          <div class="p-media ${esc(key)}">
            ${p.highlighted ? `<span class="p-flag">Recomendado</span>` : ""}
            <span class="p-placeholder" aria-hidden="true" ${p.image ? "hidden" : ""}>${emoji}</span>
            ${p.image ? `<img data-product-cover src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ""}
          </div>
          <div class="p-body">
            <div class="p-top">
              <span class="chip-cat">${esc(p.category || "Producto")}</span>
              <span class="stock ${stockCls}">${esc(stock)}</span>
            </div>
            <h3>${esc(p.name)}</h3>
            <p class="p-meta">${esc(p.delivery || "")}${p.warranty ? ` · ${esc(p.warranty)}` : ""}</p>
            ${p.plan ? `<p class="p-meta">${esc(p.plan)}</p>` : ""}
            <div class="p-foot">
              <div class="price">${money(p.price)}<small>${p.plan ? "" : ""}</small></div>
              <button class="btn btn-primary" data-add="${esc(p.id)}" ${p.available === false ? "disabled" : ""}>
                ${p.available === false ? "Agotado" : "Pedir"}
              </button>
            </div>
          </div>
        </article>`;
      })
      .join("");

    $$("[data-add]", grid).forEach((btn) =>
      btn.addEventListener("click", () => addToCart(btn.dataset.add))
    );
  }

  /* -------------------------------- carrito ----------------------------- */

  function addToCart(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    const item = state.cart.find((x) => x.id === id);
    if (item) item.qty = Math.min(item.qty + 1, 10);
    else state.cart.push({ id, name: p.name, price: p.price, category: p.category, qty: 1 });
    writeJSON("n3t_cart", state.cart);
    updateCartCount();
    renderCart();
    openCart();
  }

  function changeQty(id, delta) {
    const item = state.cart.find((x) => x.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) state.cart = state.cart.filter((x) => x.id !== id);
    writeJSON("n3t_cart", state.cart);
    updateCartCount();
    renderCart();
  }

  function cartTotal() {
    return state.cart.reduce((a, i) => a + i.price * i.qty, 0);
  }
  function cartUnits() {
    return state.cart.reduce((a, i) => a + i.qty, 0);
  }

  function updateCartCount() {
    const units = cartUnits();
    $("#cartCount").textContent = units;
    const dock = $("#dockCount");
    if (dock) {
      dock.textContent = units;
      dock.hidden = units === 0;
    }
    $("#checkoutBtn").disabled = !state.cart.length;
  }

  function renderCart() {
    const wrap = $("#cartItems");
    if (!state.cart.length) {
      wrap.innerHTML = `<div class="cart-empty">Tu carrito está vacío.<br><span class="muted">Elige un producto del catálogo.</span></div>`;
    } else {
      wrap.innerHTML = state.cart
        .map((i) => {
          const key = (i.category || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          return `<div class="cart-item">
            <div class="ci-emoji">${EMOJI[key] || "✨"}</div>
            <div class="ci-body">
              <strong>${esc(i.name)}</strong>
              <small class="muted">${money(i.price)} c/u</small>
            </div>
            <div class="qty">
              <button type="button" data-qty="${esc(i.id)}" data-d="-1">−</button>
              <span>${i.qty}</span>
              <button type="button" data-qty="${esc(i.id)}" data-d="1">+</button>
            </div>
          </div>`;
        })
        .join("");
      $$("[data-qty]", wrap).forEach((b) =>
        b.addEventListener("click", () => changeQty(b.dataset.qty, Number(b.dataset.d)))
      );
    }
    $("#cartTotal").textContent = money(cartTotal());
  }

  function openCart() {
    renderCart();
    $("#cartDrawer").hidden = false;
    $("#cartBackdrop").hidden = false;
  }
  function closeCart() {
    $("#cartDrawer").hidden = true;
    $("#cartBackdrop").hidden = true;
  }

  /* ------------------------------- checkout ----------------------------- */

  function openCheckout() {
    if (!state.cart.length) return;
    closeCart();
    const rows = state.cart
      .map((i) => `<div class="row"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`)
      .join("");
    $("#checkoutSummary").innerHTML = `${rows}<div class="row total"><span>Total estimado</span><span>${money(cartTotal())}</span></div>`;
    $("#checkoutBackdrop").hidden = false;
    setTimeout(() => $("#checkoutForm [name=name]").focus(), 60);
  }
  function closeCheckout() {
    $("#checkoutBackdrop").hidden = true;
    $("#submitOrder").disabled = false;
    $("#submitOrder").textContent = "Enviar pedido";
  }

  async function submitOrder(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = $("#submitOrder");
    btn.disabled = true;
    btn.textContent = "Enviando…";
    const fd = new FormData(form);
    try {
      const data = await api("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          whatsapp: fd.get("whatsapp"),
          email: fd.get("email"),
          note: fd.get("note"),
          promoCode: fd.get("promoCode"),
          items: state.cart.map((i) => ({ id: i.id, qty: i.qty })),
        }),
      });
      state.cart = [];
      writeJSON("n3t_cart", state.cart);
      writeJSON("n3t_last_order", { tracking: data.tracking, token: data.token });
      updateCartCount();
      closeCheckout();
      form.reset();
      toast("Pedido enviado ✓ Te confirmaré el monto");
      location.hash = `#/pedido/${data.tracking}?k=${data.token}`;
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = "Enviar pedido";
    }
  }

  /* ------------------------------ mi pedido ----------------------------- */

  function handleRoute() {
    const hash = location.hash || "#/";
    stopPolling();
    closeCart(); // al cambiar de vista, el carrito no debe quedar abierto encima
    if (hash.startsWith("#/pedido")) {
      showView("order");
      const m = hash.match(/^#\/pedido\/([A-Z0-9]{4,12})(?:\?k=([a-f0-9]+))?/i);
      if (m) {
        loadOrder(m[1].toUpperCase(), m[2] || "");
      } else {
        const saved = readJSON("n3t_last_order", null);
        if (saved && saved.tracking && saved.token) {
          location.hash = `#/pedido/${saved.tracking}?k=${saved.token}`;
        } else {
          $("#orderPanel").innerHTML = "";
          $("#lookupCard").hidden = false;
        }
      }
    } else {
      showView("catalog");
    }
  }

  function showView(name) {
    $("#view-catalog").hidden = name !== "catalog";
    $("#view-order").hidden = name !== "order";
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function onLookup(e) {
    e.preventDefault();
    const raw = $("#lookupCode").value.trim();
    const key = $("#lookupKey").value.trim();
    let tracking = raw.toUpperCase();
    let token = key;
    const link = raw.match(/pedido\/([A-Z0-9]{4,12})(?:\?k=([a-f0-9]+))?/i);
    if (link) {
      tracking = link[1].toUpperCase();
      token = link[2] || token;
    }
    if (!tracking) return toast("Pega tu enlace o código", true);
    if (!token) return toast("Falta la clave privada del enlace", true);
    location.hash = `#/pedido/${tracking}?k=${token}`;
  }

  async function loadOrder(tracking, token) {
    $("#lookupCard").hidden = true;
    const panel = $("#orderPanel");
    panel.innerHTML = `<div class="card panel"><p class="muted">Cargando tu pedido…</p></div>`;
    try {
      const data = await api(`/api/orders/${encodeURIComponent(tracking)}?k=${encodeURIComponent(token)}`);
      state.order = data;
      state.orderKey = token;
      renderOrder(data);
      if (!["📦 Entregado", "❌ Cancelado", "↩️ Reembolsado", "🏁 Completado"].includes(data.state)) {
        startPolling(tracking, token);
      }
    } catch (err) {
      panel.innerHTML = `<div class="card panel"><div class="notice bad">⚠️ ${esc(err.message)}</div>
        <p class="hint" style="margin-top:12px">Verifica que el enlace esté completo (código + clave).</p></div>`;
    }
  }

  function startPolling(tracking, token) {
    stopPolling();
    state.poll = setInterval(async () => {
      if (document.hidden) return;
      try {
        const data = await api(`/api/orders/${encodeURIComponent(tracking)}?k=${encodeURIComponent(token)}`);
        if (data.state !== state.order?.state || data.payment?.status !== state.order?.payment?.status) {
          state.order = data;
          renderOrder(data);
          toast("Tu pedido se actualizó");
        }
      } catch {}
    }, 25000);
  }
  function stopPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  const STEP_INDEX = {
    "🟡 Esperando aprobación": 0,
    "✅ Aprobado · esperando pago": 1,
    "🔍 Pago en revisión": 2,
    "🔐 Pago validado · por entregar": 3,
    "📦 Entregado": 4,
    "🏁 Completado": 4,
    "🟡 Pendiente de pago": 1,
    "✅ Pagado · por entregar": 3,
    "🔐 Habilitado / entregado": 4,
  };
  const STEPS = ["Solicitud", "Aprobado", "Pago enviado", "Pago validado", "Entregado"];

  function pillClass(st) {
    if (/Entregado|Completado/.test(st)) return "ok";
    if (/Cancelado|Rechazado/.test(st)) return "bad";
    if (/Aprobado|revisión/.test(st)) return "warn";
    return "info";
  }

  function renderOrder(o) {
    const panel = $("#orderPanel");
    const idx = STEP_INDEX[o.state] ?? -1;
    const delivered = o.delivery && /Entregado|Completado|Habilitado/.test(o.state);
    const cancelled = /Cancelado|Reembolsado/.test(o.state);

    const stepsHtml = STEPS.map((label, i) => {
      const cls = idx < 0 ? "" : i < idx ? "done" : i === idx ? "current" : "";
      return `<div class="step ${cls}">${label}</div>`;
    }).join("");

    const itemsHtml = (o.items || [])
      .map((i) => `<div class="item-row"><span>${esc(i.name)} <small>× ${i.qty}</small></span><span>${money(i.price * i.qty)}</span></div>`)
      .join("");

    let body = "";

    if (cancelled) {
      body += `<div class="card panel"><div class="notice bad">Este pedido fue ${o.state.toLowerCase()}. Escríbeme por WhatsApp si crees que es un error.</div></div>`;
    } else if (idx === 0) {
      body += `<div class="card panel">
        <div class="notice info">⏳ <div><b>Estamos revisando tu pedido.</b><br>Te confirmaré el monto final por WhatsApp. Cuando esté aprobado, aquí aparecerá el número de Yape y podrás subir tu captura.</div></div>
      </div>`;
    }

    if (o.canPay) {
      body += `<div class="card panel">
        <h3>💜 Paga con Yape</h3>
        <div class="yape-box">
          <div><div style="font-size:12px;opacity:.92">Monto aprobado</div><div class="amount">${money(o.amount)}</div></div>
          <div class="yape-phone"><span>${esc(o.yape?.number || "Configura YAPE_NUMBER")}</span>
            <button type="button" data-copy="${esc(o.yape?.number || "")}">Copiar</button></div>
          <div style="font-size:12.5px;opacity:.92">Titular: ${esc(o.yape?.name || "—")}</div>
        </div>
        <form id="payForm" class="form-grid" style="margin-top:16px">
          <div class="field span2"><span>Captura de Yape *</span>
            <label class="upload-zone" id="uploadZone">
              <input type="file" id="payImage" accept="image/*,application/pdf" />
              <strong id="uploadTitle">Toca para adjuntar tu captura</strong>
              <span id="uploadSub">JPG, PNG, WEBP o PDF · máx. 4 MB</span>
            </label>
            <div class="preview" id="payPreview" hidden></div>
          </div>
          <label class="field"><span>Monto pagado (S/) *</span><input name="amount" inputmode="decimal" value="${o.amount}" required /></label>
          <label class="field"><span>N° de operación</span><input name="operation" maxlength="40" placeholder="Opcional" /></label>
          <label class="field span2"><span>Nota (opcional)</span><input name="note" maxlength="300" placeholder="Ej: pagué desde el número de mi mamá" /></label>
          <button class="btn btn-primary span2" type="submit" id="payBtn">Enviar comprobante</button>
          <p class="hint span2">Reviso el pago y luego se habilitan tus credenciales en este mismo enlace.</p>
        </form>
      </div>`;
    }

    if (o.state === "🔍 Pago en revisión") {
      body += paymentStatusCard(o, "warn", "🔍", "Comprobante recibido",
        "Estoy verificando tu pago. En cuanto lo valide verás tus credenciales aquí.");
    }

    if (o.state === "🔐 Pago validado · por entregar") {
      body += `<div class="card panel"><div class="notice ok">✅ <div><b>Pago validado.</b><br>Estoy preparando tu acceso. Actualiza en unos minutos o espera a que esta página se actualice sola.</div></div></div>`;
    }

    if (delivered) {
      body += `<div class="card panel">
        <h3>🔐 Tus datos de acceso</h3>
        <div class="creds">
          ${cred("Usuario / correo", o.delivery.usuario)}
          ${cred("Contraseña", o.delivery.password)}
          ${cred("Perfil", o.delivery.perfil)}
          ${cred("PIN", o.delivery.pin)}
          ${o.delivery.notas ? `<div class="cred wide"><span>Indicaciones</span><b>${esc(o.delivery.notas)}</b></div>` : ""}
        </div>
        <p class="warn-note">🔒 No compartas estos datos. Si tienes problemas, escríbeme por WhatsApp indicando tu código ${esc(o.code)}.
        ${o.delivery.expiresAt ? `<br>📅 Vigencia estimada hasta <b>${prettyDate(o.delivery.expiresAt)}</b>.` : ""}</p>
      </div>`;
    }

    body += `<div class="card panel">
      <h3>📝 Observaciones</h3>
      <div class="observations">${o.observations ? esc(o.observations) : "Sin observaciones por ahora."}</div>
      <form id="obsForm" class="form-grid" style="margin-top:12px">
        <label class="field span2"><span>Agregar una observación</span>
          <textarea name="message" rows="2" maxlength="800" placeholder="Ej: el perfil no abre, necesito cambiar la clave…"></textarea>
        </label>
        <button class="btn btn-ghost span2" type="submit">Enviar observación</button>
      </form>
    </div>`;

    panel.innerHTML = `
      <div class="order-wrap">
        <div class="card order-head">
          <div>
            <h2>${esc(o.code)}</h2>
            <div class="order-code">Actualizado ${prettyDate(o.updatedAt)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="state-pill ${pillClass(o.state)}">${esc(o.state)}</span>
            <button class="btn btn-ghost btn-sm" type="button" id="refreshOrder">↻ Actualizar</button>
          </div>
        </div>

        <div class="card"><div class="stepper">${stepsHtml}</div></div>

        <div class="card panel">
          <h3>🧾 Resumen</h3>
          <div class="items">${itemsHtml}</div>
          ${o.promo ? `<p class="hint" style="margin-top:8px">Promoción aplicada: <b>${esc(o.promo)}</b></p>` : ""}
          <div class="total-row"><span>Total${o.approvedAmount ? " aprobado" : " estimado"}</span><span>${money(o.amount)}</span></div>
          ${o.note ? `<p class="hint" style="margin-top:10px">Tu nota: ${esc(o.note)}</p>` : ""}
        </div>

        ${body}
      </div>`;

    $$("[data-copy]", panel).forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy, "Número copiado")));
    $("#refreshOrder")?.addEventListener("click", () => loadOrder(o.tracking, state.orderKey));
    bindPaymentForm();
    bindObservations(o);
  }

  function cred(label, value) {
    if (!value) return "";
    return `<div class="cred"><span>${esc(label)}</span><b>${esc(value)}</b><button type="button" data-copy="${esc(value)}">Copiar</button></div>`;
  }

  function paymentStatusCard(o, cls, icon, title, text) {
    const p = o.payment;
    return `<div class="card panel">
      <div class="notice ${cls}">${icon} <div><b>${esc(title)}</b><br>${esc(text)}</div></div>
      ${p ? `<p class="hint" style="margin-top:12px">Monto declarado: <b>${money(p.amount)}</b>
        ${p.operation ? ` · Operación: <b>${esc(p.operation)}</b>` : ""}
        ${p.date ? ` · Fecha: ${prettyDate(p.date)}` : ""}</p>
        ${p.imageUrl ? `<p class="hint"><a href="${esc(p.imageUrl)}" target="_blank" rel="noopener">Ver comprobante enviado ↗</a></p>` : ""}` : ""}
    </div>`;
  }

  function bindPaymentForm() {
    const form = $("#payForm");
    if (!form) return;
    const input = $("#payImage");
    const preview = $("#payPreview");
    const zone = $("#uploadZone");

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      $("#uploadTitle").textContent = file.name;
      $("#uploadSub").textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        preview.hidden = false;
        preview.innerHTML = `<img src="${url}" alt="Vista previa del comprobante" />`;
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = input.files?.[0];
      if (!file) return toast("Adjunta tu captura de Yape", true);
      const btn = $("#payBtn");
      btn.disabled = true;
      btn.textContent = "Subiendo…";
      try {
        const fd = new FormData();
        const upload = await compressImage(file);
        if (upload.size > 4 * 1024 * 1024) {
          throw new Error("El archivo supera los 4 MB. Toma una captura más liviana o envía un PDF más pequeño.");
        }
        fd.append("image", upload);
        fd.append("amount", form.amount.value);
        fd.append("operation", form.operation.value);
        fd.append("date", new Date().toISOString().slice(0, 10));
        fd.append("note", form.note.value);
        const tracking = state.order.tracking;
        await api(`/api/orders/${encodeURIComponent(tracking)}/payment?k=${encodeURIComponent(state.orderKey)}`, {
          method: "POST",
          body: fd,
        });
        toast("Comprobante enviado ✓");
        await loadOrder(tracking, state.orderKey);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = "Enviar comprobante";
      }
    });
    zone?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });
  }

  function bindObservations(o) {
    const form = $("#obsForm");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = form.message.value.trim();
      if (msg.length < 2) return toast("Escribe tu observación", true);
      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        await api(`/api/orders/${encodeURIComponent(o.tracking)}/observations?k=${encodeURIComponent(state.orderKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg }),
        });
        toast("Observación enviada ✓");
        await loadOrder(o.tracking, state.orderKey);
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    });
  }

  /* ---------------------------- compresión ------------------------------ */

  async function compressImage(file) {
    if (!file.type.startsWith("image/")) return file;
    if (file.size < 2.2 * 1024 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const max = 1800;
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      let quality = 0.9;
      let blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
      while (blob && blob.size > 3.6 * 1024 * 1024 && quality > 0.4) {
        quality -= 0.12;
        blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
      }
      if (!blob) return file;
      return new File([blob], (file.name || "yape").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch {
      return file;
    }
  }
})();
