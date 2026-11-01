import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Sin --apply solo consulta y guarda un respaldo privado, fuera de Git.
const apply = process.argv.includes('--apply');
const local = {};
for (const file of ['.env.local', '.env']) {
  try { Object.assign(local, parseEnv(readFileSync(file, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const token = process.env.NOTION_TOKEN || local.NOTION_TOKEN || local.KEY_NOTION;
if (!token) throw new Error('Configura NOTION_TOKEN en el entorno o en .env');
const root = '40b13bcc-c7ed-81a4-a48b-ee4ae07c5210';
const manual = '40b13bcc-c7ed-81b7-9f01-ce8a0fefd74d';
const site = 'https://tienda-streaming-swart.vercel.app';
const revision = 'Operación con Vercel · portadas desde Notion · v1';
const backup = `.vercel/notion-backup/${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(backup, { recursive: true });
const rt = (content) => [{ type: 'text', text: { content } }];
const block = (type, content) => ({ object: 'block', type, [type]: { rich_text: rt(content) } });
const heading = (s) => block('heading_2', s);
const paragraph = (s) => block('paragraph', s);
const bullet = (s) => block('bulleted_list_item', s);
const step = (s) => block('numbered_list_item', s);
const bookmark = (url, caption) => ({ object: 'block', type: 'bookmark', bookmark: { url, caption: rt(caption) } });
const textOf = (b) => (b[b.type]?.rich_text || []).map(t => t.plain_text || t.text?.content || '').join('');

async function notion(path, method = 'GET', body, version = '2022-06-28') {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': version, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 429 && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, Math.max(1, Number(response.headers.get('retry-after')) || 1) * 1000));
      continue;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data.code}`);
    return data;
  }
}

async function all(path, method = 'GET') {
  const results = [];
  let cursor;
  do {
    const data = method === 'POST'
      ? await notion(path, method, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
      : await notion(`${path}?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

const databases = [
  { id: '40b13bcc-c7ed-81f5-b067-f44dc8d8a17a', name: 'Productos', remove: ['Imagen (URL)'], description: 'Catálogo de la tienda en Vercel. Abre cada producto y usa Agregar portada / Cambiar portada: esa imagen aparece en la web. Edita aquí precios, categorías, planes, stock, estado y destacados. Costos, proveedor y notas son internos. No es necesario publicar esta base.' },
  { id: '40b13bcc-c7ed-81bc-b912-e64bc871fbea', name: 'Clientes', remove: ['Yape (número)', 'Titular Yape', 'Segmento'], description: 'Clientes creados por la tienda al registrar pedidos. Conserva nombre, WhatsApp, email, canal y relaciones. Segmento automático y métricas sirven para seguimiento interno. No necesitas registrar cada cliente manualmente ni pedir sus datos de Yape.' },
  { id: '40b13bcc-c7ed-810e-9e61-d54be898a852', name: 'Promociones', remove: [], description: 'Cupones: Código, Activa, Tipo, Valor, Categoría objetivo y vigencias son leídos por la API. Condición, Productos aplicables y Usos máximos son referencias internas: la API actual no impone límites por producto ni por número de usos.' },
  { id: '40b13bcc-c7ed-8146-8e50-d0fe7e9e4725', name: 'Ventas y Pedidos', remove: [], description: 'Registro privado de pedidos. Aprueba el monto, valida el pago y entrega credenciales desde /admin.html en Vercel. Conserva relaciones, fórmulas, tokens, campos de seguimiento y credenciales: la API los utiliza. No compartas públicamente esta base.' },
  { id: '40b13bcc-c7ed-81b9-bc91-c16a379633a6', name: 'Comprobantes Yape', remove: ['Enlace del comprobante (Drive / WhatsApp)'], description: 'Capturas y datos de Yape recibidos desde el enlace privado del pedido en Vercel. Imagen Yape almacena el archivo. La validación se realiza en /admin.html. No necesitas un formulario público de Notion ni enlaces externos a comprobantes.' },
];

const snapshots = [];
for (const database of databases) {
  const schema = await notion(`/databases/${database.id}`);
  const rows = await all(`/databases/${database.id}/query`, 'POST');
  writeFileSync(`${backup}/${database.name}.json`, JSON.stringify({ schema, rows }, null, 2));
  snapshots.push({ ...database, schema, rows });
}
const rootBlocks = await all(`/blocks/${root}/children`);
const manualBlocks = await all(`/blocks/${manual}/children`);
writeFileSync(`${backup}/pages.json`, JSON.stringify({
  root: await notion(`/pages/${root}`), rootBlocks,
  manual: await notion(`/pages/${manual}`), manualBlocks,
}, null, 2));

// No eliminar una propiedad con datos, consumida por el código o referenciada por fórmulas/rollups.
const source = readFileSync('lib/api-core.js', 'utf8');
const report = snapshots.map(db => ({
  database: db.name,
  rows: db.rows.length,
  remove: db.remove.filter(name => {
    if (!db.schema.properties[name]) return false;
    const inCode = source.includes(`["${name}"]`);
    // Imagen (URL) permanece únicamente como lectura compatible para otras instalaciones.
    if (inCode && name !== 'Imagen (URL)') throw new Error(`Propiedad usada por la API: ${name}`);
    const referenced = snapshots.some(other => Object.values(other.schema.properties).some(p =>
      p.formula?.expression?.includes(`prop("${name}")`) ||
      (p.rollup && [p.rollup.rollup_property_name, p.rollup.relation_property_name].includes(name))
    ));
    if (referenced) throw new Error(`Propiedad referenciada por una fórmula o rollup: ${name}`);
    const hasData = db.rows.some(row => {
      const p = row.properties[name];
      if (!p) return false;
      const value = p[p.type];
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '';
    });
    if (hasData) console.log(`Conservar ${db.name}.${name}: contiene datos`);
    return !hasData;
  }),
}));
writeFileSync(`${backup}/plan.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', backup, databases: report }, null, 2));
if (!apply) process.exit(0);

for (const [index, db] of snapshots.entries()) {
  await notion(`/databases/${db.id}`, 'PATCH', {
    description: rt(db.description),
    properties: Object.fromEntries(report[index].remove.map(name => [name, null])),
  });
}

const manualContent = [
  paragraph(revision),
  heading('Dónde trabajar'),
  paragraph('Notion es el catálogo y registro privado de la tienda. Vercel sirve la web, el carrito, el seguimiento, la carga de Yape, el panel administrativo y la API. GitHub conserva el código y dispara el despliegue.'),
  bookmark(site, 'Tienda pública'),
  bookmark(`${site}/admin.html`, 'Administración: aprobación, pagos y entrega'),
  heading('Portada de cada producto'),
  step('Abre 01 · Catálogo de Productos y entra al producto como página.'),
  step('Pulsa Agregar portada o Cambiar portada y sube tu imagen, o elige una imagen desde Notion. No uses el icono de página como portada.'),
  step('Vuelve a la tienda: se actualiza al recargar, al regresar a la pestaña o cada minuto mientras esté visible. No necesitas un commit ni otro despliegue.'),
  paragraph('La portada pertenece a la página, no es una columna. Si no tiene portada o la imagen falla, aparece el icono de la categoría. Las imágenes firmadas de Notion se vuelven a consultar; no copies sus URLs temporales a otro campo.'),
  heading('Flujo de venta en Vercel'),
  step('El cliente elige productos y completa sus datos en la tienda. La API registra cliente y pedido en Notion.'),
  step('En /admin.html revisa el pedido y aprueba el monto. El enlace privado del cliente muestra los datos de Yape.'),
  step('El cliente paga y adjunta su captura en su enlace privado. La imagen se guarda en Comprobantes Yape y el pedido pasa a Pago en revisión.'),
  step('Compara monto, número de operación y captura. Valida o rechaza el comprobante desde el panel.'),
  step('Con el pago validado, entrega usuario, contraseña, perfil, PIN e indicaciones desde el panel. El cliente los ve en su enlace privado.'),
  heading('Qué se conserva en Notion'),
  bullet('Productos: portada nativa, Producto, Categoría, Plataforma, Plan / Duración, Tipo de entrega, Garantía, Precio venta (S/), Cupos / Stock, Stock disponible, Estado, Descripción y Destacado. Costos y márgenes son opcionales para tu gestión.'),
  bullet('Clientes: datos de contacto, historial de ventas y pagos, segmentación automática y notas internas.'),
  bullet('Promociones: código, activación, tipo, valor, categoría y fechas. La API actual no aplica Productos aplicables ni Usos máximos; son referencias internas.'),
  bullet('Ventas y Pedidos: relaciones, detalle, estados, precios, fechas, observaciones, tokens privados y credenciales. Los campos técnicos y las copias del nombre/WhatsApp sostienen el seguimiento web.'),
  bullet('Comprobantes Yape: Imagen Yape, monto, fecha, operación, validación y relaciones a cliente/pedido. Los campos con sufijo (formulario) también los escribe la web; se conservan.'),
  heading('Qué ya no hace falta'),
  bullet('Un catálogo público, checkout o formulario de comprobantes en Notion. Comparte la tienda de Vercel y el enlace privado de cada pedido.'),
  bullet('Registrar manualmente el cliente y duplicar pedidos creados por la web. Aprobar o entregar desde dos paneles diferentes.'),
  bullet('Imagen (URL), enlaces externos de comprobantes, Yape (número), Titular Yape y Segmento manual: se retiran solo si estaban vacíos. Los datos existentes se conservan.'),
  bullet('GitHub Pages como despliegue automático adicional. Vercel publica frontend y API; GitHub valida y versiona el código.'),
  heading('Mantenimiento y privacidad'),
  paragraph('No borres las cinco bases, sus relaciones ni los campos técnicos aunque no se editen a diario. No publiques las bases de pedidos, clientes o comprobantes: contienen datos privados. Las credenciales de integración permanecen en variables de entorno de Vercel.'),
  paragraph('Los rollups y fórmulas son herramientas de consulta. La aprobación usa Precio aprobado (S/) y el panel controla la entrega. Las cifras de Total (S/) y Saldo pendiente (S/) se basan en el cálculo sugerido; no reemplazan la revisión del monto aprobado.'),
];

if (!manualBlocks.some(b => textOf(b) === revision)) {
  // Primero escribir y verificar; después archivar las instrucciones antiguas (reversible en Notion).
  const added = await notion(`/blocks/${manual}/children`, 'PATCH', { children: manualContent });
  if (added.results.length !== manualContent.length) throw new Error('Manual incompleto; se conservó el anterior');
  for (const old of manualBlocks) await notion(`/blocks/${old.id}`, 'PATCH', { archived: true });
}
await notion(`/pages/${manual}`, 'PATCH', { properties: { title: { title: rt('Manual · Operar la tienda en Vercel') } } });
await notion(`/pages/${root}`, 'PATCH', { properties: { title: { title: rt('Centro de Ventas · Gestión en Notion') } } });

if (!rootBlocks.some(b => textOf(b) === revision)) {
  await notion(`/blocks/${root}/children`, 'PATCH', {
    children: [
      heading(revision),
      paragraph('Edita productos, portadas y promociones aquí. Gestiona aprobación, cobro y entrega desde el panel de Vercel. Las cinco bases siguientes conservan todos los registros y relaciones de la tienda.'),
      bookmark(site, 'Abrir tienda'),
      bookmark(`${site}/admin.html`, 'Abrir panel de administración'),
      heading('Bases de datos privadas'),
    ],
    position: { type: 'start' },
  }, '2026-03-11');
}
for (const old of rootBlocks.filter(b => b.type === 'callout' && textOf(b).includes('Antes de empezar'))) {
  await notion(`/blocks/${old.id}`, 'PATCH', { callout: { rich_text: rt('Lee «Manual · Operar la tienda en Vercel». Para cambiar la imagen de un producto, abre su página y usa Agregar portada. Los clientes compran y suben su Yape desde la web; ya no necesitas un formulario público de Notion.') } });
}

for (const [index, db] of snapshots.entries()) {
  const current = await notion(`/databases/${db.id}`);
  for (const name of report[index].remove) {
    if (current.properties[name]) throw new Error(`No se retiró ${db.name}.${name}`);
  }
  const rows = await all(`/databases/${db.id}/query`, 'POST');
  const ids = new Set(rows.map(row => row.id));
  if (db.rows.some(row => !ids.has(row.id))) throw new Error(`Faltan registros en ${db.name}`);
}
console.log('Notion actualizado. Verificados todos los registros originales. Respaldo privado: ' + backup);
