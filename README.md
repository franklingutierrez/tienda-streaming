# Tienda N3TFL1X · Vercel + Notion

**Vercel sirve el frontend y la API**. **Notion guarda el catálogo, las portadas y
los registros privados**. GitHub versiona el código y activa el despliegue de `main`.

- [Tienda](https://tienda-streaming-swart.vercel.app)
- [Panel administrativo](https://tienda-streaming-swart.vercel.app/admin.html)
- [Gestión en Notion](https://www.notion.so/40b13bccc7ed81a4a48bee4ae07c5210)
- [Guía de operación y despliegue](docs/README.md)

## Cambiar una portada

En Notion, abre **01 · Catálogo de Productos**, entra al producto y pulsa
**Agregar portada / Cambiar portada**. Recarga la web o espera el refresco de un
minuto. No necesitas subir imágenes a GitHub ni volver a desplegar.
Sin portada, o si falla su carga, se muestra el icono de la categoría.

## Organización

| Componente | Responsabilidad |
|---|---|
| `docs/` | Tienda, seguimiento privado y panel publicados por Vercel |
| `api/index.js` | Entrada de la función de Vercel |
| `lib/api-core.js` | Catálogo, pedidos, pagos, sesiones y acceso privado a Notion |
| Cinco bases de Notion | Productos, Clientes, Promociones, Ventas y Pedidos, Comprobantes Yape |
| `scripts/restructure-notion.mjs` | Auditoría y migración de la estructura existente |
| `test/` | Pruebas del catálogo y las portadas |
| `.github/workflows/check.yml` | Validación; Vercel realiza el despliegue |

## Desarrollo

```sh
npm run check
npm test
# Con Vercel CLI y variables locales configuradas:
npm run dev
```

`API_BASE: ""` usa la API del mismo dominio, tanto en producción como en previews.
Configura los secretos en Vercel y en `.env` local (ver `.env.example`).
Nunca publiques tokens, contraseñas ni respaldos de Notion en GitHub.

## Reestructuración de Notion

```sh
npm run notion:plan   # Consulta, respalda y muestra cambios
npm run notion:apply  # Aplica cambios y verifica los registros
```

El script apunta a las cinco bases de esta tienda. Conserva registros, relaciones
y campos de la API. Retira solo los campos antiguos especificados que estén vacíos
y sin dependencias. Archiva los bloques del manual antiguo después de escribir el
nuevo. Guarda respaldos privados en `.vercel/notion-backup/`, excluido de Git y Vercel.
