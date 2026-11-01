import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv, isDeepStrictEqual } from 'node:util';

const apply = process.argv.includes('--apply');
const local = {};
for (const file of ['.env.local', '.env']) {
  try { Object.assign(local, parseEnv(readFileSync(file, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const env = { ...local, ...process.env };
if (!env.NOTION_TOKEN) throw new Error('Falta NOTION_TOKEN');
const backup = `.vercel/notion-backup/simplify-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(backup, { recursive: true });
const save = (name, data) => writeFileSync(`${backup}/${name}.json`, JSON.stringify(data, null, 2));
const rt = content => [{ type: 'text', text: { content } }];
const block = (type, content) => ({ object: 'block', type, [type]: { rich_text: rt(content) } });
const text = p => (p?.rich_text || p?.title || []).map(t => t.plain_text || t.text?.content || '').join('');
const source = readFileSync('lib/api-core.js', 'utf8');
const root = '40b13bcc-c7ed-81a4-a48b-ee4ae07c5210';
const manual = '40b13bcc-c7ed-81b7-9f01-ce8a0fefd74d';
const marker = 'Referencia histórica · condiciones no aplicadas por la web';
const databases = [
  { name: 'Productos', id: '40b13bcc-c7ed-81f5-b067-f44dc8d8a17a', remove: ['Notas internas', 'Promociones'], visible: ['Producto', 'Categoría', 'Precio venta (S/)', 'Plan / Duración', 'Cupos / Stock', 'Stock disponible', 'Estado', 'Destacado'], view: 'Catálogo · edición', sort: 'Producto' },
  { name: 'Clientes', id: '40b13bcc-c7ed-81bc-b912-e64bc871fbea', remove: [], visible: ['Cliente', 'WhatsApp', 'Email', 'Estado', 'Canal de captación', 'Ventas', 'Notas'], view: 'Clientes · contacto e historial', sort: 'Cliente' },
  { name: 'Promociones', id: '40b13bcc-c7ed-810e-9e61-d54be898a852', remove: ['Usos restantes', 'Usos máximos', 'Condición', 'Productos aplicables'], visible: ['Promoción', 'Código', 'Activa', 'Tipo', 'Valor', 'Categoría objetivo', 'Vigencia desde', 'Vigencia hasta'], view: 'Cupones · configuración web', sort: 'Promoción' },
  { name: 'Ventas y Pedidos', id: '40b13bcc-c7ed-8146-8e50-d0fe7e9e4725', remove: ['¿Se puede habilitar?'], visible: ['Pedido', 'Código', 'Estado del pedido', 'Cliente', 'Productos', 'Precio aprobado (S/)', 'Fecha de venta', 'Vence el'], view: 'Pedidos · seguimiento', sort: 'Fecha de venta' },
  { name: 'Comprobantes Yape', id: '40b13bcc-c7ed-81b9-bc91-c16a379633a6', remove: [], visible: ['Comprobante', 'Pedido', 'Monto (S/)', 'Fecha de pago', 'N° de operación', 'Imagen Yape', 'Validación', 'Observación'], view: 'Pagos · comprobantes', sort: 'Fecha de pago' },
];

async function notion(path, method = 'GET', body, version = '2022-06-28') {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      method, headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': version, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 429 && attempt < 3) {
      await new Promise(r => setTimeout(r, 1000 * Math.max(1, Number(response.headers.get('retry-after')) || 1)));
      continue;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data.code}`);
    return data;
  }
}
async function all(path, method = 'GET', version) {
  const rows = []; let cursor;
  do {
    const data = method === 'POST'
      ? await notion(path, method, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }, version)
      : await notion(`${path}${path.includes('?') ? '&' : '?'}page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, method, undefined, version);
    rows.push(...data.results); cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return rows;
}
const modern = (path, method, body) => notion(path, method, body, '2026-03-11');
const snapshots = [];
for (const db of databases) {
  const schema = await notion(`/databases/${db.id}`);
  const modernSchema = await modern(`/databases/${db.id}`);
  if (modernSchema.data_sources.length !== 1) throw new Error('Se esperaba una sola fuente por base');
  const refs = await all(`/views?data_source_id=${modernSchema.data_sources[0].id}`, 'GET', '2026-03-11');
  const views = [];
  for (const ref of refs) views.push(await modern(`/views/${ref.id}`));
  const rows = await all(`/databases/${db.id}/query`, 'POST');
  const pages = [];
  if (db.name === 'Promociones') for (const row of rows) pages.push({ id: row.id, blocks: await all(`/blocks/${row.id}/children`) });
  const snapshot = { ...db, schema, rows, views, pages, dataSource: modernSchema.data_sources[0].id };
  save(db.name, snapshot); snapshots.push(snapshot);
}
const rootBlocks = await all(`/blocks/${root}/children`);
const manualBlocks = await all(`/blocks/${manual}/children`);
save('pages', { rootBlocks, manualBlocks });

// Guardas conservadoras: código, datos, fórmulas, rollups, vistas y relaciones inversas.
for (const db of snapshots) for (const name of db.remove) {
  const property = db.schema.properties[name];
  if (!property) continue;
  if (source.includes(JSON.stringify(name))) throw new Error(`Campo utilizado por la API: ${db.name}.${name}`);
  const ids = [name, property.id, decodeURIComponent(property.id)];
  for (const other of snapshots) for (const [key, p] of Object.entries(other.schema.properties)) {
    if (other.remove.includes(key)) continue;
    if (other.id === db.id && p.formula?.expression.includes(`prop("${name}")`)) throw new Error(`Dependencia: ${key}`);
    if (p.rollup) {
      const relation = Object.values(other.schema.properties).find(x => x.id === p.rollup.relation_property_id || decodeURIComponent(x.id) === p.rollup.relation_property_id);
      if ((other.id === db.id && ids.includes(p.rollup.relation_property_id)) ||
          (relation?.relation?.database_id === db.id && (ids.includes(p.rollup.rollup_property_id) || p.rollup.rollup_property_name === name))) throw new Error(`Rollup dependiente: ${key}`);
    }
    if (p.relation?.database_id === db.id && ids.includes(p.relation.dual_property?.synced_property_id)) throw new Error(`Relación inversa fuera del plan: ${key}`);
  }
  for (const view of db.views) {
    const dependencies = JSON.stringify({ filter: view.filter, sorts: view.sorts, quick: view.quick_filters, config: view.configuration });
    if (ids.some(id => dependencies.includes(JSON.stringify(id)))) throw new Error(`Vista dependiente: ${view.name}.${name}`);
  }
  if (!['formula', 'rollup'].includes(property.type)) {
    const migrates = db.name === 'Promociones' && ['Condición', 'Usos máximos'].includes(name);
    for (const row of db.rows) {
      const value = row.properties[name]?.[property.type];
      const populated = Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '';
      if (populated && !migrates) throw new Error(`Campo con datos no migrados: ${db.name}.${name}`);
    }
  }
}

async function liveState() {
  const base = 'https://tienda-streaming-swart.vercel.app/api?route=';
  async function api(route, options) {
    const r = await fetch(base + encodeURIComponent(route), options);
    if (!r.ok) throw new Error(`Producción ${route}: ${r.status}`);
    return r.json();
  }
  const catalog = await api('/api/catalog');
  const session = await api('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: env.ADMIN_PASSWORD }) });
  const admin = await api('/api/admin/orders', { headers: { Authorization: `Bearer ${session.token}` } });
  const orders = [];
  for (const order of admin.orders) {
    const url = base + encodeURIComponent(`/api/orders/${order.tracking}`) + '&k=' + encodeURIComponent(order.token);
    const r = await fetch(url); if (!r.ok) throw new Error(`Seguimiento: ${r.status}`);
    orders.push(await r.json());
  }
  return { catalog, admin, orders };
}
const beforeLive = await liveState(); save('production-before', beforeLive);
console.log(JSON.stringify({ apply, backup, plan: snapshots.map(db => ({ database: db.name, records: db.rows.length, remove: db.remove.filter(n => db.schema.properties[n]), visible: db.visible })) }, null, 2));
if (!apply) process.exit(0);

const promos = snapshots.find(db => db.name === 'Promociones');
for (const row of promos.rows) {
  const maximum = row.properties['Usos máximos']?.number;
  const condition = text(row.properties['Condición']);
  if (maximum == null && !condition) continue;
  const existing = promos.pages.find(p => p.id === row.id).blocks;
  if (!existing.some(b => text(b[b.type]) === marker)) {
    const children = [block('heading_2', marker), block('paragraph', 'Estos valores se conservan como referencia histórica. La API no aplica límites de usos ni interpreta condiciones escritas; utiliza los campos de código, tipo, valor, categoría y vigencias.'), block('paragraph', `Usos máximos anteriores: ${maximum ?? 'Sin valor'}`), block('paragraph', `Condición anterior: ${condition || 'Sin texto'}`)];
    await notion(`/blocks/${row.id}/children`, 'PATCH', { children });
  }
  const current = await all(`/blocks/${row.id}/children`);
  const migrated = current.map(b => text(b[b.type]));
  if (!migrated.includes(`Usos máximos anteriores: ${maximum ?? 'Sin valor'}`) || !migrated.includes(`Condición anterior: ${condition || 'Sin texto'}`)) throw new Error('No se verificó la copia de condiciones');
}

// Retirar primero las fórmulas que dependen de campos que se eliminan después.
for (const db of snapshots) {
  const current = await notion(`/databases/${db.id}`);
  const properties = Object.fromEntries(db.remove.filter(n => current.properties[n]).map(n => [n, null]));
  if (Object.keys(properties).length) await notion(`/databases/${db.id}`, 'PATCH', { properties });
}

for (const db of snapshots) {
  const schema = await notion(`/databases/${db.id}`);
  const table = db.views.find(v => v.parent.database_id === db.id && (v.name === 'Default view' || v.name === db.view));
  if (!table || table.type !== 'table') throw new Error(`No se encontró la tabla esperada: ${db.name}`);
  const properties = [...db.visible, ...Object.keys(schema.properties).filter(n => !db.visible.includes(n))].map(name => ({ property_id: schema.properties[name].id, visible: db.visible.includes(name), ...(db.visible.includes(name) ? { width: schema.properties[name].type === 'title' ? 280 : 170 } : {}) }));
  await modern(`/views/${table.id}`, 'PATCH', { name: db.view, sorts: [{ property: db.sort, direction: db.sort.startsWith('Fecha') ? 'descending' : 'ascending' }], configuration: { type: 'table', properties, frozen_column_index: 1 } });
  const actual = await modern(`/views/${table.id}`);
  if (actual.name !== db.view || actual.configuration.properties.filter(p => p.visible).length !== db.visible.length) throw new Error(`Vista no verificada: ${db.name}`);
  if (db.name === 'Productos' && !db.views.some(v => v.name === 'Portadas')) {
    const gallery = await modern('/views', 'POST', { database_id: db.id, data_source_id: db.dataSource, name: 'Portadas', type: 'gallery', configuration: { type: 'gallery', cover: { type: 'page_cover' }, cover_size: 'medium', cover_aspect: 'cover', properties: Object.entries(schema.properties).map(([name, p]) => ({ property_id: p.id, visible: ['Producto', 'Precio venta (S/)', 'Estado'].includes(name) })) } });
    const actualGallery = await modern(`/views/${gallery.id}`);
    if (actualGallery.configuration.cover.type !== 'page_cover') throw new Error('Galería sin portada de página');
  }
}

await notion(`/databases/${snapshots[0].id}`, 'PATCH', { description: rt('Catálogo de la tienda. Usa Catálogo · edición para precios, disponibilidad y destacados; Portadas para revisar la imagen superior de cada producto. Costos y proveedor permanecen como datos internos. Las portadas se cambian dentro de la página del producto.') });
await notion(`/databases/${promos.id}`, 'PATCH', { description: rt('Cupones que utiliza la web: código, activación, tipo, valor, categoría y vigencias. Los límites y condiciones anteriores se conservaron como notas históricas dentro de cada promoción. No limitan los pedidos de la tienda.') });
for (const old of manualBlocks) {
  if (text(old[old.type]).startsWith('Promociones: código, activación')) {
    await notion(`/blocks/${old.id}`, 'PATCH', { [old.type]: { rich_text: rt('Promociones: código, activación, tipo, valor, categoría y fechas. Los límites de uso y las condiciones antiguas se conservan como notas históricas dentro de cada promoción; no se aplican en la web.') } });
  }
}
const viewHeading = 'Vistas simplificadas y campos conservados';
if (!manualBlocks.some(b => text(b[b.type]) === viewHeading)) {
  await notion(`/blocks/${manual}/children`, 'PATCH', { children: [
    block('heading_2', viewHeading),
    block('paragraph', 'Las vistas principales muestran solo los campos de trabajo diario. Los campos técnicos, tokens, credenciales y métricas permanecen en la base, ocultos en esas tablas; ocultarlos no cambia los permisos de acceso.'),
    block('bulleted_list_item', 'Productos: Catálogo · edición para precios y disponibilidad, y Portadas para ver la portada nativa de cada página.'),
    block('bulleted_list_item', 'Clientes · contacto e historial; Cupones · configuración web; Pedidos · seguimiento; Pagos · comprobantes. La aprobación, validación y entrega siguen en el panel de Vercel.'),
    block('bulleted_list_item', 'Retirados: Notas internas y Promociones en Productos; Productos aplicables, Usos máximos, Usos restantes y Condición en Promociones; ¿Se puede habilitar? en Pedidos. Los textos y límites anteriores de las promociones están dentro de sus páginas.'),
    block('paragraph', 'Se conservan todas las bases, registros y relaciones operativas, los campos utilizados por la API, el stock y las fórmulas de vencimiento. Los cambios se verificaron contra el catálogo, panel y seguimiento privado en producción.'),
  ] });
}
const rootNote = 'Vistas de trabajo simplificadas: edita productos y cupones en Notion; aprueba pedidos, valida pagos y entrega accesos en el panel de Vercel. Los campos técnicos permanecen guardados aunque no aparezcan en las tablas principales.';
for (const old of rootBlocks.filter(b => b.type === 'callout')) {
  if (text(old.callout).startsWith('Lee «Manual · Operar')) await notion(`/blocks/${old.id}`, 'PATCH', { callout: { rich_text: rt(rootNote) } });
}

// Las URLs firmadas y fechas de edición pueden renovarse sin cambiar los datos de negocio.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['expiry_time', 'updatedAt'].includes(key)).map(([key, val]) => [key, stable(val)]));
  if (typeof value === 'string' && /^https:\/\//.test(value)) { const url = new URL(value); if (/amazonaws\.com$/.test(url.hostname)) { url.search = ''; return url.href; } }
  return value;
}
for (const db of snapshots) {
  const schema = await notion(`/databases/${db.id}`);
  for (const [name, property] of Object.entries(db.schema.properties)) {
    if (db.remove.includes(name)) { if (schema.properties[name]) throw new Error(`Campo aún presente: ${name}`); }
    else if (!isDeepStrictEqual(property, schema.properties[name])) throw new Error(`Cambió campo conservado: ${db.name}.${name}`);
  }
  const rows = await all(`/databases/${db.id}/query`, 'POST'); save(`after-${db.name}`, { schema, rows });
  for (const old of db.rows) {
    const current = rows.find(r => r.id === old.id); if (!current) throw new Error(`Registro ausente en ${db.name}`);
    for (const [name, property] of Object.entries(old.properties)) {
      if (!db.remove.includes(name) && !isDeepStrictEqual(stable(property), stable(current.properties[name]))) throw new Error(`Valor modificado: ${db.name}.${name}`);
    }
    if (!isDeepStrictEqual(stable(old.cover), stable(current.cover))) throw new Error('Cambió una portada');
  }
}
const afterLive = await liveState(); save('production-after', afterLive);
if (!isDeepStrictEqual(stable(beforeLive), stable(afterLive))) throw new Error('La respuesta de producción cambió: revisar los respaldos privados');
save('result', { success: true, removed: snapshots.reduce((n, db) => n + db.remove.filter(k => db.schema.properties[k]).length, 0), checked: ['schema', 'records', 'views', 'catalog', 'admin', 'private-order'] });
console.log('Verificado: catálogo, panel y seguimiento conservan sus datos; esquemas y registros necesarios intactos. Respaldo: ' + backup);
