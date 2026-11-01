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

La guía completa está en **[docs/README.md](docs/README.md)**:
configurar Notion, desplegar la API en Vercel, variables de entorno, publicar en
GitHub Pages y checklist de pruebas.

Resumen:

1. Importa este repo en Vercel y define `NOTION_TOKEN`, `ADMIN_PASSWORD`,
   `ALLOWED_ORIGIN`, `YAPE_NUMBER` y `YAPE_NAME`.
2. Copia la URL de Vercel en `docs/assets/config.js` (`API_BASE`).
3. Activa GitHub Pages con la carpeta `/docs`.

> Nunca subas `.env`: contiene secretos. El `.gitignore` ya lo protege.
