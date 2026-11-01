/* =========================================================
   Panel de administración · lógica
   ========================================================= */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const API = String(CFG.API_BASE || location.origin).replace(/\/+$/, "");
  const CUR = CFG.CURRENCY || "S/";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = { token: sessionStorage.getItem("n3t_admin") || "", orders: [], stats: {}, filter: "all", q: "" };

  const FILTERS = [
    { key: "all", label: "Todos" },
    { key: "pending", label: "Pendientes" },
    { key: "approved", label: "Esperando pago" },
    { key: "review", label: "Por validar" },
    { key: "paid", label: "Por entregar" },
    { key: "delivered", label: "Entregados" },
  ];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!API || API.includes("TU-API")) $("#setupBanner").hidden = false;
    $("#loginForm").addEventListener("submit", login);
    $("#logoutBtn").addEventListener("click", logout);
    $("#refreshBtn").addEventListener("click", loadOrders);
    $("#searchInput").addEventListener("input", (e) => { state.q = e.target.value.toLowerCase().trim(); render(); });
    $("#ordersList").addEventListener("click", onListClick);
    $("#ordersList").addEventListener("submit", onListSubmit);
    if (state.token) showDash();
  }

  /* ------------------------------- sesión -------------------------------- */

  // La API de Vercel recibe todas las rutas en /api y la ruta lógica va en ?route=
  function apiUrl(path) {
    const [route, query] = String(path).split("?");
    return `${API}/api?route=${encodeURIComponent(route)}${query ? `&${query}` : ""}`;
  }
  async function api(path, opts = {}) {
    if (!API || API.includes("TU-API")) throw new Error("Configura la URL de la API en assets/config.js");
    const headers = { ...(opts.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(apiUrl(path), { ...opts, headers });
    const txt = await res.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch { data = { error: txt }; }
    if (res.status === 401) { logout(true); throw new Error(data.error || "Sesión vencida"); }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  async function login(e) {
    e.preventDefault();
    const btn = $("#loginForm button");
    btn.disabled = true;
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: e.target.password.value }),
      });
      state.token = data.token;
      sessionStorage.setItem("n3t_admin", data.token);
      $("#loginHint").textContent = "";
      e.target.reset();
      showDash();
    } catch (err) {
      $("#loginHint").textContent = err.message;
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function logout(silent) {
    state.token = "";
    sessionStorage.removeItem("n3t_admin");
    $("#dashView").hidden = true;
    $("#loginView").hidden = false;
    $("#logoutBtn").hidden = true;
    if (!silent) toast("Sesión cerrada");
  }

  function showDash() {
    $("#loginView").hidden = true;
    $("#dashView").hidden = false;
    $("#logoutBtn").hidden = false;
    renderFilters();
    loadOrders();
  }

  /* --------------------------- datos y render ---------------------------- */

  async function loadOrders() {
    try {
      const data = await api("/api/admin/orders");
      state.orders = data.orders || [];
      state.stats = data.stats || {};
      render();
    } catch (err) {
      if (state.token) toast(err.message, true);
    }
  }

  function renderFilters() {
    const wrap = $("#adminFilters");
    wrap.innerHTML = FILTERS.map(
      (f) => `<button type="button" class="chip ${state.filter === f.key ? "active" : ""}" data-filter="${f.key}">${f.label}</button>`
    ).join("");
    $$("[data-filter]", wrap).forEach((b) =>
      b.addEventListener("click", () => { state.filter = b.dataset.filter; renderFilters(); render(); })
    );
  }

  function clsOf(o) {
    if (/Entregado|Completado|Habilitado/.test(o.state)) return "delivered";
    if (/Cancelado|Reembolsado/.test(o.state)) return "cancelled";
    if (/revisión/.test(o.state)) return "review";
    if (/validado|Pagado .* por entregar/i.test(o.state)) return "paid";
    if (/Aprobado/.test(o.state)) return "approved";
    return "pending";
  }

  function render() {
    renderStats();
    let list = state.orders;
    if (state.filter !== "all") list = list.filter((o) => clsOf(o) === state.filter);
    if (state.q) {
      list = list.filter((o) =>
        [o.code, o.client.name, o.client.whatsapp, o.promo].join(" ").toLowerCase().includes(state.q)
      );
    }
    $("#ordersList").innerHTML = list.length
      ? list.map(cardHTML).join("")
      : `<div class="empty-admin">No hay pedidos en esta vista.</div>`;
  }

  function renderStats() {
    const s = state.stats || {};
    $("#stats").innerHTML = `
      <div class="stat"><b>${s.total || 0}</b><span>Total</span></div>
      <div class="stat warn"><b>${s.pending || 0}</b><span>Pendientes</span></div>
      <div class="stat info"><b>${(s.approved || 0) + (s.review || 0)}</b><span>En cobranza</span></div>
      <div class="stat"><b>${s.paid || 0}</b><span>Por entregar</span></div>
      <div class="stat ok"><b>${s.delivered || 0}</b><span>Entregados</span></div>`;
  }

  function money(n) {
    const v = Number(n) || 0;
    return `${CUR} ${v.toLocaleString("es-PE", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  }
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dateFmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  function cardHTML(o) {
    const cls = clsOf(o);
    const pay = o.payments?.[0];
    const items = (o.items || [])
      .map((i) => `<div class="line"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`)
      .join("");

    let actions = "";
    if (cls === "pending") {
      actions = `<div class="row">
        <label class="field"><span>Monto a aprobar (S/)</span>
          <input type="number" step="0.1" min="0" value="${Number(o.amount || o.subtotal || 0).toFixed(2)}" data-amount="${o.id}" />
        </label>
        <label class="field"><span>Nota para el cliente (opcional)</span>
          <input data-approve-note="${o.id}" placeholder="Ej: incluye 2 perfiles" />
        </label>
        <button class="btn btn-primary btn-sm" data-act="approve" data-id="${o.id}">✅ Aprobar pedido</button>
        <button class="btn btn-danger btn-sm" data-act="reject" data-id="${o.id}">Cancelar</button>
      </div>`;
    } else if (cls === "approved") {
      actions = `<div class="row">
        <span class="hint">Esperando que el cliente suba su comprobante de Yape.</span>
        <button class="btn btn-ghost btn-sm" data-copy-link="${o.id}">🔗 Copiar enlace del cliente</button>
        <button class="btn btn-danger btn-sm" data-act="reject" data-id="${o.id}">Cancelar</button>
      </div>`;
    } else if (cls === "review") {
      actions = `<div class="row">
        <label class="field"><span>Nota de validación (opcional)</span>
          <input data-validate-note="${o.id}" placeholder="Ej: monto correcto" />
        </label>
        <button class="btn btn-ok btn-sm" data-act="validate" data-id="${o.id}">✅ Validar pago</button>
        <button class="btn btn-danger btn-sm" data-act="reject-payment" data-id="${o.id}">❌ Rechazar pago</button>
      </div>`;
    } else if (cls === "paid") {
      actions = `<form class="inline-form" data-deliver-form="${o.id}">
        <label class="field"><span>Usuario / correo</span><input name="usuario" placeholder="cuenta@mail.com" required /></label>
        <label class="field"><span>Contraseña</span><input name="password" placeholder="Clave del acceso" required /></label>
        <label class="field"><span>Perfil</span><input name="perfil" placeholder="Perfil 2 / Individual" /></label>
        <label class="field"><span>PIN</span><input name="pin" placeholder="PIN si aplica" /></label>
        <label class="field full"><span>Indicaciones para el cliente</span><input name="notas" placeholder="Ej: no cambiar la contraseña; entrar desde Smart TV" /></label>
        <button class="btn btn-primary btn-sm" type="submit">🔐 Entregar acceso</button>
      </form>`;
    } else if (cls === "delivered") {
      actions = `<div class="creds-mini">
        ${o.credentials.usuario ? `<div><span>Usuario</span><b>${esc(o.credentials.usuario)}</b></div>` : ""}
        ${o.credentials.password ? `<div><span>Clave</span><b class="mask" data-reveal>${esc(o.credentials.password)}</b></div>` : ""}
        ${o.credentials.perfil ? `<div><span>Perfil</span><b>${esc(o.credentials.perfil)}</b></div>` : ""}
        ${o.credentials.pin ? `<div><span>PIN</span><b class="mask" data-reveal>${esc(o.credentials.pin)}</b></div>` : ""}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" data-copy-link="${o.id}">🔗 Copiar enlace del cliente</button>
        <span class="hint">Entregado el ${dateFmt(o.deliveredAt + "T00:00:00")}</span>
      </div>`;
    } else {
      actions = `<div class="row"><span class="hint">Pedido cancelado.</span></div>`;
    }

    return `<article class="o-card ${cls}">
      <header class="o-head">
        <h3>${esc(o.code || o.tracking)}</h3>
        <span class="state-pill ${/Entregado/.test(o.state) ? "ok" : /Cancelado/.test(o.state) ? "bad" : /Aprobado|revisión/.test(o.state) ? "warn" : "info"}">${esc(o.state)}</span>
        <span class="grow"></span>
        <span class="who">${dateFmt(o.createdAt)}</span>
        <a class="btn btn-ghost btn-sm" href="${esc(o.url)}" target="_blank" rel="noopener">Notion ↗</a>
      </header>
      <div class="o-body">
        <div>
          <div class="block">
            <h4>Cliente</h4>
            <div class="o-lines">
              <div class="line"><span>${esc(o.client.name || "—")}</span>
                <a href="https://wa.me/${esc(String(o.client.whatsapp || "").replace(/\D/g, ""))}" target="_blank" rel="noopener">${esc(o.client.whatsapp || "")}</a>
              </div>
            </div>
          </div>
          <div class="block">
            <h4>Productos</h4>
            <div class="o-lines">${items || '<span class="hint">—</span>'}</div>
            ${o.promo ? `<p class="hint" style="margin-top:6px">Promo: ${esc(o.promo)} · desc. ${o.discountPct || 0}%</p>` : ""}
            <div class="o-total"><span>Total</span><span>${money(o.amount)}</span></div>
          </div>
          ${o.note ? `<div class="block"><h4>Nota del cliente</h4><div class="o-note">${esc(o.note)}</div></div>` : ""}
          ${o.internalNotes ? `<div class="block"><h4>Historial interno</h4><div class="o-note">${esc(o.internalNotes)}</div></div>` : ""}
        </div>
        <div>
          <div class="block">
            <h4>Comprobante Yape</h4>
            ${pay ? `<div class="pay-row">
                <span class="pay-status ${/Validado/.test(pay.status) ? "ok" : /Rechazado/.test(pay.status) ? "bad" : ""}">${esc(pay.status)}</span>
                <b>${money(pay.amount)}</b>
                ${pay.operation ? `<span>Op. ${esc(pay.operation)}</span>` : ""}
                ${pay.imageUrl ? `<a href="${esc(pay.imageUrl)}" target="_blank" rel="noopener">Ver captura ↗</a>` : "<span>Sin imagen</span>"}
              </div>
              ${pay.observation ? `<p class="hint" style="margin-top:6px">${esc(pay.observation)}</p>` : ""}`
              : `<span class="hint">Aún no sube comprobante.</span>`}
          </div>
          <div class="block">
            <h4>Enlace privado del cliente</h4>
            <button class="btn btn-ghost btn-sm" data-copy-link="${o.id}">Copiar enlace</button>
          </div>
        </div>
      </div>
      <div class="o-actions">${actions}</div>
    </article>`;
  }

  /* ------------------------------- acciones ------------------------------ */

  async function onListClick(e) {
    const copyBtn = e.target.closest("[data-copy-link]");
    if (copyBtn) return copyLink(copyBtn.dataset.copyLink);

    const reveal = e.target.closest("[data-reveal]");
    if (reveal) { reveal.classList.toggle("mask"); return; }

    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    const order = state.orders.find((o) => o.id === id);
    if (!order) return;

    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Procesando…";

    try {
      if (act === "approve") {
        const amount = Number($(`[data-amount="${id}"]`)?.value);
        const note = $(`[data-approve-note="${id}"]`)?.value || "";
        if (!(amount > 0)) throw new Error("Ingresa un monto válido");
        await api(`/api/admin/orders/${id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, note }),
        });
        toast("Pedido aprobado ✓ Ahora comparte el enlace con el cliente");
      } else if (act === "reject") {
        const reason = prompt("Motivo de la cancelación (opcional):") || "";
        if (!confirm("¿Cancelar este pedido?")) return;
        await api(`/api/admin/orders/${id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        toast("Pedido cancelado");
      } else if (act === "validate" || act === "reject-payment") {
        const pay = order.payments?.[0];
        if (!pay) throw new Error("El pedido no tiene comprobante");
        const note = $(`[data-validate-note="${id}"]`)?.value || "";
        await api(`/api/admin/orders/${id}/validate-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId: pay.id, valid: act === "validate", note }),
        });
        toast(act === "validate" ? "Pago validado ✓" : "Pago rechazado");
      }
      await loadOrders();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = prev;
    }
  }

  async function onListSubmit(e) {
    const form = e.target.closest("[data-deliver-form]");
    if (!form) return;
    e.preventDefault();
    const id = form.dataset.deliverForm;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      await api(`/api/admin/orders/${id}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario: form.usuario.value,
          password: form.password.value,
          perfil: form.perfil.value,
          pin: form.pin.value,
          notas: form.notas.value,
        }),
      });
      toast("Acceso entregado ✓ El cliente ya puede ver sus credenciales");
      await loadOrders();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = "🔐 Entregar acceso";
    }
  }

  function copyLink(id) {
    const o = state.orders.find((x) => x.id === id);
    if (!o) return;
    const base = location.origin + location.pathname.replace(/admin\.html?$/i, "");
    const url = `${base}#/pedido/${o.tracking}?k=${o.token}`;
    navigator.clipboard?.writeText(url).then(
      () => toast("Enlace copiado ✓ Envíalo por WhatsApp"),
      () => prompt("Copia el enlace:", url)
    );
  }

  /* -------------------------------- toast -------------------------------- */

  let toastTimer;
  function toast(msg, isError) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast show" + (isError ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = "toast"), 3200);
  }
})();
