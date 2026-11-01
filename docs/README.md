# Operar la tienda con Vercel y Notion

La [tienda](https://tienda-streaming-swart.vercel.app) y el
[panel administrativo](https://tienda-streaming-swart.vercel.app/admin.html)
funcionan en Vercel. Notion es el catálogo y registro privado. GitHub conserva el
código y Vercel despliega los cambios enviados a `main`.

## Portadas desde Notion

1. Abre **01 · Catálogo de Productos** y entra a la página del producto.
2. Pulsa **Agregar portada** o **Cambiar portada**.
3. Sube una imagen o elige una portada en Notion. Usa una composición horizontal
   con el contenido importante centrado: la tarjeta recorta la imagen para llenarse.
4. Recarga la tienda. También se actualiza al volver a la pestaña o cada minuto
   mientras esté visible.

La portada es la imagen superior de la página, no su icono ni una imagen insertada
en el contenido. No hace falta una columna adicional. Los siete productos
existentes quedaron listos para que el administrador suba sus imágenes.

La API admite portadas subidas (`file`) y externas (`external`). No guarda sus
URLs en el repositorio ni en caché: [Notion entrega URLs válidas por una hora](https://developers.notion.com/reference/file-object),
que se renuevan al consultar el catálogo. Si no hay portada o falla su carga, la
tarjeta muestra el icono de su categoría. Se mantiene lectura compatible de
`Imagen (URL)` para instalaciones antiguas que todavía tengan ese campo.

## Qué se gestiona en cada lugar

| Lugar | Operaciones |
|---|---|
| Notion | Portadas, productos, precios, stock, estados, destacados, promociones e informes |
| Tienda en Vercel | Catálogo, carrito, registro, seguimiento privado y carga del comprobante |
| Panel en Vercel | Aprobar monto, validar pago y entregar credenciales |
| GitHub | Código, historial y comprobaciones automáticas |
| Configuración de Vercel | Variables privadas, dominios y despliegues |

## Bases que se conservan

Las cinco bases son necesarias. No se eliminan ni se recrean sus relaciones.

| Base | Datos y función |
|---|---|
| **01 · Catálogo de Productos** | Portada de página, Producto, Categoría, Plataforma, Plan / Duración, Precio venta (S/), Cupos / Stock, Stock disponible, Estado, Tipo de entrega, Garantía, Descripción y Destacado. Costos, proveedor y márgenes son internos. |
| **02 · Clientes** | Cliente, WhatsApp, Email, Canal de captación, Estado, Notas; relaciones, historial y segmentación automática. La web crea los clientes al recibir pedidos. |
| **03 · Promociones** | Código, Activa, Tipo, Valor, Categoría objetivo y vigencias; relaciones y métricas internas. |
| **04 · Ventas y Pedidos** | Detalle, cantidades, precios, descuento, estado, fechas, relaciones, observaciones, credenciales y campos técnicos de seguimiento. |
| **05 · Comprobantes Yape** | Archivo Imagen Yape, monto, fecha, operación, validación, observación y relaciones a pedido y cliente. |

Conserva `Tracking ID`, `Token de seguimiento`, `Precio aprobado (S/)`,
`Nombre del cliente (texto)`, `WhatsApp (texto)`, `Acceso habilitado` y las
credenciales del pedido. Conserva también `Nombre del cliente (formulario)` y
`Código de pedido (formulario)` en Comprobantes: la API los escribe.

### Componentes retirados del flujo

- Catálogo público y formulario de pagos de Notion: los reemplazan la tienda y el
  enlace privado del pedido. No es necesario publicar las bases.
- Instrucciones antiguas de registro manual y activación de formularios: el manual
  de Notion ahora explica el flujo web.
- Campos vacíos sin uso: `Imagen (URL)`, `Yape (número)`, `Titular Yape`,
  `Segmento` manual y `Enlace del comprobante (Drive / WhatsApp)`.
- Workflow automático de GitHub Pages: sustituido por validación de código y
  pruebas. Esto no despublica un sitio de Pages existente en la configuración de GitHub.

## Flujo de venta

1. El cliente compra en la web. La API toma precios de Notion y registra el pedido.
2. En el panel, revisa el pedido y aprueba el monto final.
3. El enlace privado del cliente muestra el monto y los datos de Yape.
4. El cliente sube su comprobante; se adjunta en Notion y pasa a revisión.
5. Verifica captura, monto y operación desde el panel. Valida o rechaza el pago.
6. Con pago validado, entrega usuario, contraseña, perfil, PIN e indicaciones.
   El cliente ve los datos en su enlace privado.

Estados usados por la API:

```
🟡 Esperando aprobación → ✅ Aprobado · esperando pago → 🔍 Pago en revisión
→ 🔐 Pago validado · por entregar → 📦 Entregado
❌ Cancelado / ↩️ Reembolsado
```

No compartas las bases privadas ni los enlaces de otros clientes. El seguimiento
requiere el token privado del pedido. La sesión del panel dura ocho horas.

## Configuración de Vercel

El proyecto `tienda-streaming` está enlazado a
`franklingutierrez/tienda-streaming`, rama de producción `main`.
`vercel.json` publica `docs/` y configura `api/index.js` con un máximo de 60 segundos.
El proyecto solicita Node.js `26.x` y no necesita dependencias de producción.

| Variable | Uso |
|---|---|
| `NOTION_TOKEN` | Secreto de integración con acceso a las cinco bases |
| `ADMIN_PASSWORD` | Contraseña del panel y firma de sesiones |
| `ALLOWED_ORIGIN` | Origen permitido: `https://tienda-streaming-swart.vercel.app` |
| `YAPE_NUMBER` | Número de cobro |
| `YAPE_NAME` | Titular de la cuenta de cobro |

Configura variables en los entornos de Vercel que utilices. Los secretos no van
en `docs/` ni GitHub. Los cambios de variables se aplican en el siguiente despliegue.
Mantén `API_BASE: ""` en `docs/assets/config.js`: producción, previews y desarrollo
usan `/api` del mismo origen. Solo necesitas una URL explícita si sirves el
frontend desde otro dominio.

Todas las rutas llegan a la misma función mediante `?route=`:

```
/api?route=/api/health
/api?route=/api/catalog
```

Para desarrollo local configura `.env.local`, instala Vercel CLI y ejecuta
`npm run dev`. Para comprobar el código: `npm run check` y `npm test`.

## Auditoría y migración

`npm run notion:plan` consulta y respalda las bases. `npm run notion:apply` aplica
la reorganización. Usan `NOTION_TOKEN` del entorno o de los archivos locales.
El script está configurado para los identificadores de esta tienda.

Cada ejecución guarda esquema, registros y páginas en `.vercel/notion-backup/`.
Contiene datos privados y está excluido de Git y Vercel. Los campos solo se retiran
si están vacíos, sin dependencias y fuera del contrato activo de la API. El manual
anterior se archiva después de escribir el nuevo. Se verifican todos los registros
originales. Si un campo antiguo contiene datos, la migración lo conserva.

## Límites actuales

- `Productos aplicables` y `Usos máximos` de promociones son informativos: la API
  no los impone. Sí lee activación, categoría, tipo, valor y vigencia.
- El stock usa la fórmula existente, que suma cantidades de pedidos relacionados.
  No es una reserva transaccional por línea: revisa disponibilidad antes de aprobar
  pedidos de varios productos.
- `Total (S/)` y `Saldo pendiente (S/)` usan el importe sugerido. El monto final
  está en `Precio aprobado (S/)`; compruébalo al validar el pago.
- Los comprobantes admiten hasta 4 MB. La web intenta comprimir imágenes.

## Comprobación tras desplegar

- Salud de API correcta y catálogo con todos los productos publicables.
- Portadas subidas y externas visibles; icono cuando no hay imagen.
- Panel accesible y pedidos existentes intactos.
- Los cambios de portada aparecen tras refrescar, sin commit ni despliegue.

Si falla el catálogo, revisa logs de Vercel, `NOTION_TOKEN` y permisos de las bases.
Si no ves una portada, confirma que está en la cabecera de la página y que el
producto tiene estado publicable (`🟢 Activo`, `🟠 Últimos cupos` o vacío).
