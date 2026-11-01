# Tienda N3TFL1X · HTML + Notion + Vercel

Tienda de cuentas de streaming, cuentas de IA y libros digitales.
El **frontend es HTML puro** (se publica en GitHub Pages) y **toda la información vive en Notion**.
Las operaciones que necesitan el token de Notion pasan por una **Vercel Function** (gratis).

> El token de Notion **nunca** se coloca en el HTML: si estuviera ahí, cualquiera podría
> leerlo con F12 y acceder a todas tus ventas y credenciales. Por eso la API vive en Vercel,
> pero el código sigue estando en tu repositorio de GitHub.

---

## 1. Cómo funciona el flujo

```
Cliente elige producto
        │
        ▼
PEDIDO CREADO              🟡 Esperando aprobación
        │                  (el admin revisa stock y precio)
        ▼
ADMIN APRUEBA + MONTO      ✅ Aprobado · esperando pago
        │                  (el cliente ve el número de Yape)
        ▼
CLIENTE SUBE CAPTURA       🔍 Pago en revisión
        │                  (imagen subida a Notion)
        ▼
ADMIN VALIDA EL PAGO       🔐 Pago validado · por entregar
        │
        ▼
ADMIN ENTREGA ACCESO       📦 Entregado
                           (usuario, contraseña, perfil, PIN
                            visibles SOLO en el enlace privado)
```

- El cliente sigue su pedido en un **enlace privado**: `https://tu-sitio/#/pedido/<CODIGO>?k=<CLAVE>`
- Las **credenciales nunca se envían** hasta que el pago está validado y el acceso entregado.
- El cliente puede **registrar observaciones** en cualquier momento; quedan guardadas en Notion.
- Los precios **siempre se recalculan en la API desde Notion**. El navegador nunca envía precios.

---

## 2. Estructura del proyecto

```
/
├─ api/
│  └─ index.js              Punto de entrada de la Vercel Function
├─ lib/
│  └─ api-core.js           Toda la lógica de la API (rutas, Notion, sesiones)
├─ docs/                    ⬅️ esto es lo que publica GitHub Pages
│  ├─ index.html            Tienda pública + seguimiento del pedido
│  ├─ admin.html            Panel de administración
│  ├─ README.md             Este archivo
│  └─ assets/
│     ├─ config.js          ⚠️ URL de la API y datos de tu marca
│     ├─ styles.css         Diseño de la tienda
│     ├─ app.js             Lógica de la tienda
│     ├─ admin.css          Estilos del panel
│     └─ admin.js           Lógica del panel
├─ package.json             `"type": "module"` para la API
├─ vercel.json              Configuración de la función
└─ .env                     Secretos locales (NO se sube a GitHub)
```

---

## 3. Requisitos

1. Cuenta de **Notion** con las 5 bases de datos (ya creadas en tu workspace).
2. Cuenta gratuita de **Vercel** (se registra con GitHub).
3. Cuenta de **GitHub** para publicar el HTML.
4. Opcional: **Node.js 20+** si quieres probar la API en tu PC.

---

## 4. Configurar Notion

1. Crea una integración en <https://www.notion.so/my-integrations>.
2. Copia el **Internal Integration Secret** (`ntn_...`).
3. En Notion, abre el **Centro de Ventas Digitales** → `···` → **Conexiones** → agrega tu integración.
   Repite esto en cada base de datos (o en la página padre) para que la API pueda leer y escribir.
4. Verifica que las bases tengan estos nombres y campos clave:

| Base de datos | Campos usados por la API |
|---|---|
| **Productos** | `Producto`, `Categoría`, `Plataforma`, `Plan / Duración`, `Precio venta (S/)`, `Stock disponible`, `Estado`, `Tipo de entrega`, `Garantía`, `Descripción`, `Imagen (URL)`, `Destacado` |
| **Ventas** | `Pedido`, `Tracking ID`, `Token de seguimiento`, `Estado del pedido`, `Precio aprobado (S/)`, `Detalle del pedido`, `Usuario / Correo`, `Contraseña`, `Perfil`, `PIN`, `Observaciones del cliente`, `Nombre del cliente (texto)`, `WhatsApp (texto)`, `Notas`, `Código` (unique_id), `Cliente`, `Productos`, `Promoción`, `Promoción aplicada` |
| **Clientes** | `Cliente`, `WhatsApp`, `Email`, `Canal de captación`, `Estado` |
| **Comprobantes** | `Comprobante`, `Monto (S/)`, `Fecha de pago`, `N° de operación`, `Imagen Yape`, `Validación`, `Observación`, `Pedido`, `Cliente`, `Nombre del cliente (formulario)`, `Código de pedido (formulario)` |
| **Promociones** | `Código`, `Activa`, `Tipo`, `Valor`, `Categoría objetivo`, `Vigencia desde`, `Vigencia hasta` |

> Los estados del pedido deben existir tal cual:
> `🟡 Esperando aprobación`, `✅ Aprobado · esperando pago`, `🔍 Pago en revisión`,
> `🔐 Pago validado · por entregar`, `📦 Entregado`, `❌ Cancelado`, `↩️ Reembolsado`.

---

## 5. Desplegar la API en Vercel

### Opción A · Desde la web (la más fácil, sin instalar nada)

1. Sube primero el proyecto a GitHub (paso 7) **o** crea el repo ahora; Vercel lo necesita.
2. Entra a <https://vercel.com/new> → **Import Git Repository** → elige tu repositorio.
3. En la configuración del proyecto:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./` (la raíz del repo)
   - **Build Command** y **Output Directory:** déjalos vacíos.
   - No agregues dependencias: la API no usa ninguna.
4. En **Environment Variables** agrega (una por una):

   | Nombre | Valor | Entorno |
   |---|---|---|
   | `NOTION_TOKEN` | Tu token `ntn_...` | Production, Preview, Development |
   | `ADMIN_PASSWORD` | La contraseña que usarás en `admin.html` | Production, Preview, Development |
   | `ALLOWED_ORIGIN` | `https://TU-USUARIO.github.io` | Production |
   | `YAPE_NUMBER` | Tu número de Yape | Production, Preview, Development |
   | `YAPE_NAME` | Tu nombre tal como figura en Yape | Production, Preview, Development |

   > `ALLOWED_ORIGIN` es el **origen** de GitHub Pages (sin ruta de repo).
   > Si usas dominio propio o varios entornos, sepáralos con coma:
   > `https://TU-USUARIO.github.io,https://tudominio.com`.

5. Pulsa **Deploy** y espera ~1 minuto.
6. Copia el dominio del proyecto: `https://TU-PROYECTO.vercel.app`.
7. Prueba en el navegador:

   ```
   https://TU-PROYECTO.vercel.app/api?route=/api/health
   ```

   Debe responder `{"ok":true,"service":"n3tfl1x-store"}`.

   > ¿Por qué `?route=`? Todas las peticiones llegan a una sola función (`/api`) y la ruta
   > real viaja en el parámetro `route`. Así funcionan también las rutas con parámetros
   > (`/api/orders/ABC123?k=...`) sin depender de rewrites.

### Opción B · Con la CLI de Vercel (terminal)

```bash
npm i -g vercel        # o: npx vercel
vercel login
vercel link            # enlaza esta carpeta con el proyecto
vercel env add NOTION_TOKEN
vercel env add ADMIN_PASSWORD
vercel env add ALLOWED_ORIGIN
vercel env add YAPE_NUMBER
vercel env add YAPE_NAME
vercel --prod
```

> Si `npx`/`npm` está bloqueado por la política de PowerShell, usa la Opción A
> o ejecuta `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` en PowerShell.

---

## 6. Configurar el frontend

Edita **`docs/assets/config.js`**:

```js
window.APP_CONFIG = {
  API_BASE: "https://TU-PROYECTO.vercel.app",
  BRAND: "N3TFL1X Store",
  TAGLINE: "Cuentas de streaming, IA y libros digitales al mejor precio",
  WHATSAPP: "51987654321",
  INSTAGRAM: "",
  CURRENCY: "S/",
  SUPPORT_HOURS: "9:00 a 22:00",
};
```

- `API_BASE`: URL de Vercel **sin barra final** y sin `/api`.
- `WHATSAPP`: número con código de país, sin `+` ni espacios.
- Mientras `API_BASE` diga `TU-API`, la tienda mostrará un aviso de configuración.

---

## 7. Publicar en GitHub Pages

1. Crea un repositorio en GitHub (público, o privado con Pages según tu plan).
2. Sube el proyecto completo (la carpeta `docs/` es la que se publica).
   El `.gitignore` de la raíz evita subir `.env`:

   ```bash
   git init
   git add .
   git commit -m "Tienda HTML + Notion + Vercel"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```

3. En GitHub: **Settings → Pages** → *Source*: **Deploy from a branch** →
   Branch: `main` / carpeta **`/docs`** → **Save**.
4. Espera 1–2 minutos. Tu tienda quedará en:
   `https://TU-USUARIO.github.io/TU-REPO/`
   y el panel en:
   `https://TU-USUARIO.github.io/TU-REPO/admin.html`
5. Vuelve a Vercel → **Settings → Environment Variables** y actualiza `ALLOWED_ORIGIN`
   con el **origen** exacto (sin la ruta del repo), por ejemplo
   `https://TU-USUARIO.github.io`. Guarda y vuelve a desplegar (**Redeploy**).

> **Nota:** GitHub Pages solo publica desde la raíz del repo o desde `/docs`.
> Por eso el frontend ya está dentro de `docs/`. Si prefieres publicar desde la raíz,
> mueve el contenido de `docs/` a la raíz y elige `/ (root)`
> (en ese caso `api/` y `lib/` también se publicarían como archivos estáticos: no es peligroso,
> pero no tiene sentido; lo recomendable es dejar `/docs`).

> **Importante:** nunca subas el archivo `.env`. El `.gitignore` de la raíz ya lo protege.

---

## 8. Uso diario

### Como administrador (`admin.html`)

1. Entra con `ADMIN_PASSWORD`.
2. Verás los pedidos y contadores: pendientes, en cobranza, por entregar, entregados.
3. **Aprobar pedido:** revisa los productos, escribe el monto final y pulsa *Aprobar pedido*.
4. Copia el **enlace privado** y envíalo al cliente por WhatsApp
   (también puedes usar *Copiar enlace del cliente*).
5. Cuando el cliente sube su Yape, aparecerá el comprobante con su captura.
   Pulsa *Validar pago* o *Rechazar pago*.
6. Con el pago validado, escribe **usuario, contraseña, perfil, PIN e indicaciones**
   y pulsa *Entregar acceso*.
7. El cliente verá sus credenciales al instante en su enlace privado.

### Como cliente

1. Elige productos → carrito → completa nombre y WhatsApp.
2. Recibe su **enlace privado** de seguimiento.
3. Espera la aprobación del monto.
4. Paga por **Yape** y sube la captura (JPG/PNG/WEBP/PDF, máx. 4 MB).
5. Cuando el admin valide el pago y entregue el acceso, verá:
   usuario, contraseña, perfil, PIN e indicaciones.
6. Puede escribir observaciones en cualquier momento; quedan en Notion.

---

## 9. Seguridad

- El token de Notion **solo existe en Vercel** (nunca en el HTML).
- El panel admin usa una **sesión HMAC firmada de 8 horas**.
- Cada pedido tiene un **token privado aleatorio** (`?k=...`); sin él la API responde `403`.
- La API valida que el comprobante pertenezca al pedido antes de validarlo.
- Solo se entregan credenciales cuando el estado es `📦 Entregado`.
- Los archivos se suben con la API oficial de Notion (límite 5 MB en plan gratuito de Notion).
- `ADMIN_PASSWORD` debe ser larga y única. Rótala si se filtra.
- `NOTION_TOKEN` y `ADMIN_PASSWORD` deben ser **secretos** (nunca en `config.js` ni en el repo).

---

## 10. Límites de Vercel a tener en cuenta

| Límite | Valor | Qué significa para la tienda |
|---|---|---|
| Tamaño del body de una Function | **4.5 MB** | El comprobante de Yape admite hasta **4 MB** (la tienda comprime la captura antes de subirla) |
| Tiempo de ejecución | 60 s configurado en `vercel.json` | Suficiente: todo son llamadas a Notion |
| Ancho de banda / invocaciones | Plan gratuito Hobby | Alcanza para una tienda pequeña; revisa el panel de uso |
| Uso comercial | El plan **Hobby** es para proyectos personales | Si la tienda factura de forma seria, pasa a **Pro** (~$20/mes) para cumplir los términos |

> El plan gratuito de Notion limita los archivos a 5 MB. Como Vercel acepta 4.5 MB de body,
> el tope efectivo de los comprobantes es **4 MB**.

---

## 11. Prueba rápida (checklist)

- [ ] `https://TU-PROYECTO.vercel.app/api?route=/api/health` responde `ok`.
- [ ] La tienda muestra tus productos (los que estén `🟢 Activo` u `🟠 Últimos cupos`).
- [ ] Crear un pedido de prueba desde la tienda.
- [ ] El panel admin lo muestra como pendiente.
- [ ] Aprobarlo con un monto y abrir el enlace privado: aparece el número de Yape.
- [ ] Subir una captura: el pedido pasa a `🔍 Pago en revisión`.
- [ ] Validar el pago: pasa a `🔐 Pago validado · por entregar`.
- [ ] Entregar credenciales: el cliente las ve en su enlace.
- [ ] Escribir una observación y confirmarla en Notion.
- [ ] Borrar/archivar los datos de prueba.

---

## 12. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| “No se pudo cargar el catálogo” | `API_BASE` incorrecta o deploy fallido | Revisa `assets/config.js` y `/api?route=/api/health` |
| Error 404 en `/api` | El proyecto se desplegó sin la carpeta `api/` | Verifica que `api/index.js` esté en la raíz del repo |
| Error CORS | `ALLOWED_ORIGIN` no coincide | Pon el origen exacto de GitHub Pages y haz **Redeploy** |
| “Falta configurar NOTION_TOKEN” | Falta la variable de entorno | Vercel → Settings → Environment Variables |
| “Notion: Unauthorized” | La integración no tiene acceso | Conecta la integración a las bases en Notion |
| No aparecen productos | Estados distintos a `🟢 Activo` / `🟠 Últimos cupos` | Corrige el campo `Estado` |
| Error 413 al subir captura | Archivo > 4 MB | Comprime la captura (la tienda ya lo intenta) |
| “Enlace inválido o vencido” | Falta `?k=` o token erróneo | Envía el enlace completo copiado del panel |
| Sesión vencida | Pasaron 8 horas | Vuelve a entrar con la contraseña |

### Probar la API en tu PC (opcional)

```bash
# Crea .env.local con las mismas variables (nunca lo subas a GitHub)
vercel dev
# Luego: http://localhost:3000/api?route=/api/health
```

También puedes validar la sintaxis sin desplegar:

```bash
node --check lib/api-core.js
node --check api/index.js
```

---

## 13. Notas

- Notion es la **única fuente de verdad**: si editas un precio o stock ahí, la tienda lo refleja.
- Las imágenes de Yape se guardan como archivos adjuntos en la base **Comprobantes**.
- Si cambias `ADMIN_PASSWORD` en Vercel, las sesiones anteriores se invalidan automáticamente
  (la firma depende de esa variable). Recuerda hacer **Redeploy** solo si es necesario:
  Vercel aplica las variables nuevas en el siguiente deployment.
