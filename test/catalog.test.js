import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../lib/api-core.js';

const product = (cover, extra = {}) => ({
  id: '40b13bcc-c7ed-817f-bdba-f66b4ef08eba', cover,
  properties: { Producto: { title: [{ plain_text: 'Producto de prueba' }] }, ...extra },
});
async function catalog(t, pages) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(url, /^https:\/\/api\.notion\.com\/v1\/databases\//);
    calls.push(JSON.parse(init.body));
    return Response.json(pages[calls.length - 1]);
  });
  const response = await handle(new Request('https://store.example/api?route=/api/catalog'), { NOTION_TOKEN: 'test-secret' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  return { data: await response.json(), calls };
}

test('la portada subida a Notion tiene prioridad y no expone campos privados', async t => {
  const image = 'https://s3.example/cover.png?signature=fresh';
  const { data } = await catalog(t, [{ results: [product({ type: 'file', file: { url: image } }, {
    'Imagen (URL)': { url: 'https://old.example/cover.jpg' },
    'Notas internas': { rich_text: [{ plain_text: 'private-value' }] },
  })] }]);
  assert.equal(data.products[0].image, image);
  assert.equal(JSON.stringify(data).includes('private-value'), false);
  assert.equal(JSON.stringify(data).includes('test-secret'), false);
});

test('acepta portada externa y productos sin portada ni columna antigua', async t => {
  const { data } = await catalog(t, [{ results: [
    product({ type: 'external', external: { url: 'https://images.example/cover.webp' } }),
    product(null),
    product(null, { 'Imagen (URL)': { url: 'https://legacy.example/cover.jpg' } }),
    product({ type: 'external', external: { url: 'javascript:alert(1)' } }),
    product({ type: 'external', external: { url: 'https://user:password@example.com/cover.jpg' } }),
  ] }]);
  assert.deepEqual(data.products.map(p => p.image), [
    'https://images.example/cover.webp', null, 'https://legacy.example/cover.jpg', null, null,
  ]);
});

test('consulta todas las páginas y mantiene el filtro de productos publicables', async t => {
  const { data, calls } = await catalog(t, [
    { results: [product(null)], has_more: true, next_cursor: 'next-page' },
    { results: [product(null)], has_more: false, next_cursor: null },
  ]);
  assert.equal(data.products.length, 2);
  assert.equal(calls[1].start_cursor, 'next-page');
  assert.deepEqual(calls[0].filter, calls[1].filter);
  assert.equal(calls[0].filter.or[0].select.equals, '🟢 Activo');
});

test('cada consulta obtiene la URL renovada de Notion', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results: [product({
    type: 'file', file: { url: `https://s3.example/cover.png?signature=${++count}` },
  })] }));
  const request = () => new Request('https://store.example/api?route=/api/catalog');
  const first = await (await handle(request(), { NOTION_TOKEN: 'test' })).json();
  const second = await (await handle(request(), { NOTION_TOKEN: 'test' })).json();
  assert.notEqual(first.products[0].image, second.products[0].image);
});
