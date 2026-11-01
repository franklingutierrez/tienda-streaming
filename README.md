# Tienda N3TFL1X · HTML + Notion + Vercel

Tienda de cuentas de streaming, cuentas de IA y libros digitales.
Frontend en **HTML puro** publicado con **GitHub Pages** (`/docs`), datos en **Notion**
y una **Vercel Function** como API para que el token de Notion nunca llegue al navegador.

```
Cliente pide → admin aprueba monto → cliente paga por Yape y sube captura
→ admin valida → credenciales visibles en el enlace privado del pedido
```

## Estructura

| Ruta | Qué es |
|---|---|
| `docs/` | Frontend estático (GitHub Pages) |
| `docs/index.html` | Tienda y seguimiento del pedido |
| `docs/admin.html` | Panel de administración |
| `api/index.js` | Entrada de la Vercel Function |
| `lib/api-core.js` | Toda la lógica de la API (rutas, Notion, sesiones) |
| `vercel.json` | Configuración de la función |

## Puesta en marcha

**Ya está desplegado:** <https://tienda-streaming-swart.vercel.app>
· panel: `/admin.html`

La guía completa está en **[docs/README.md](docs/README.md)**:
configurar Notion, desplegar la API en Vercel, variables de entorno, publicar en
GitHub Pages (opcional) y checklist de pruebas.

Resumen del despliegue:

1. Proyecto de Vercel importado desde este repo.
2. Variables: `NOTION_TOKEN`, `ADMIN_PASSWORD`, `ALLOWED_ORIGIN`, `YAPE_NUMBER`, `YAPE_NAME`.
3. Vercel sirve el frontend desde `docs/` (`"outputDirectory": "docs"` en `vercel.json`).
4. La API vive en `/api` y recibe la ruta lógica en `?route=/api/...`.

> Nunca subas `.env`: contiene secretos. El `.gitignore` ya lo protege.
