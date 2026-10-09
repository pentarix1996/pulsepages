# Sistema de diseño de Upvane

Upvane lo usan equipos de DevOps y SRE en el peor momento de su día: algo se ha caído y tienen que entenderlo, decidir y
comunicarlo. El diseño sirve a ese momento. El panel es una **sala de control**: oscuro, denso, con los datos técnicos
en monoespaciada y el color reservado al estado de los servicios. La status page pública es lo contrario: **clara,
tranquila y legible por cualquiera**, con la marca del cliente y oscuro opcional. La landing cuenta una caída real de
principio a fin.

La referencia visual está en el lienzo *Upvane redesign* (landing, panel —resumen, incidencia, monitor— y status page
escritorio y móvil). Este documento es el contrato; el código vive en `styles/` y `components/ui/`.

---

## 1. Principios

1. **El color es estado.** Verde, ámbar, naranja, rojo y azul significan operativo, degradado, caída parcial, caída
   total y mantenimiento. No se usan como decoración. La marca (índigo) solo marca acciones primarias, foco y selección.
2. **La forma también es estado.** El color nunca va solo: cada estado lleva texto (`Major outage`), icono o posición.
3. **Datos técnicos en mono, personas en sans.** URLs, IDs, latencias, códigos HTTP, regiones y fragmentos de código
   van en JetBrains Mono con cifras tabulares. Títulos, mensajes y botones en Archivo.
4. **Un solo momento orquestado.** La única animación que corre sola es la historia de la caída en el hero de la
   landing. En el resto, el movimiento responde a datos (llega un check, cambia un estado) o a una acción (abrir,
   publicar, confirmar). Todo respeta `prefers-reduced-motion`.
5. **Densidad con jerarquía.** Mucha información por pantalla, pero una sola cosa grande: el estado actual o la
   incidencia abierta. Lo demás se lee en filas, no en tarjetas idénticas.
6. **Nada de diálogos del navegador.** Confirmaciones con `ConfirmDialog`, errores en línea y avisos con `Toast`.

---

## 2. Color

### Panel y landing (tema tinta, oscuro)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#0C1222` | Fondo de página |
| `--side` | `#0E1528` | Barra lateral |
| `--panel` | `#111A2E` | Tarjetas, tablas, paneles |
| `--raised` | `#17223A` | Menús, popovers, segmento activo, toasts |
| `--sunken` | `rgba(10,15,28,.6)` | Campos de formulario, bloques de código |
| `--line` | `rgba(148,170,210,.13)` | Separadores y bordes por defecto |
| `--line2` | `rgba(148,170,210,.24)` | Bordes de controles, bordes en hover |
| `--text` | `#E9EEF8` | Texto principal |
| `--muted` | `#A3AEC5` | Texto secundario |
| `--faint` | `#7D89A3` | Metadatos, placeholders (cumple 4.5:1 sobre `--panel`) |
| `--brand` | `#5B58E8` | Botón primario, interruptores activos |
| `--accent` | `#A9A6FF` | Foco, pestaña activa, enlaces sobre oscuro (`#B9B7FF` en hover de enlaces) |

### Estados (panel)

| Estado | Token | Valor | Texto sobre oscuro |
|---|---|---|---|
| Operational | `--up` | `#34D39A` | `#34D39A` |
| Degraded | `--deg` | `#F4B740` | `#F4B740` |
| Partial outage | `--part` | `#F28A3E` | `#F28A3E` |
| Major outage | `--major` | `#F0525D` | `#FF7A83` (más claro para contraste en texto) |
| Maintenance | `--maint` | `#5E9BFF` | `#5E9BFF` |
| Sin datos | `--none` | `#26324C` | — |

Fondos tintados: el color al 8–16 % (`rgba(240,82,93,.14)`) con borde al 35–45 %. El banner de incidencia activa usa un
degradado horizontal del 14 % al 5 %; es el único degradado del panel.

### Status page (tema claro por defecto, oscuro opcional)

| Token | Claro | Oscuro |
|---|---|---|
| `--bg` | `#F5F6F8` | `#0D1320` |
| `--surface` | `#FFFFFF` | `#131B2C` |
| `--line` / `--line2` | `#E3E6EC` / `#D3D8E1` | `rgba(148,170,210,.14)` / `.26` |
| `--text` / `--muted` / `--faint` | `#121826` / `#4F5A70` / `#677287` | `#E8EDF6` / `#A9B3C7` / `#8A96AD` |
| Barras up/deg/part/major/maint | `#14A06A` `#E0A21B` `#E8742A` `#DC3545` `#3B72E0` | `#34D39A` `#F4B740` `#F28A3E` `#FF6B76` `#6EA6FF` |
| Texto de estado | `#0F7E52` `#8F5E00` `#A84A0C` `#BC2534` `#2A5BC0` | `#4FE0A8` `#F7C766` `#F6A266` `#FF8B94` `#8DB8FF` |
| `--accent` | color de marca del proyecto (`brand_color`, por defecto `#0E7490`) | igual, con enlaces `#7CD3E6` si no hay marca |

El tema por defecto lo elige el proyecto (`theme_default`: light, dark o system) y el visitante puede cambiarlo; la
elección se guarda en `localStorage` por página.

---

## 3. Tipografía

- **Archivo** (variable, ejes `wght` 100–900 y `wdth` 62–125) para todo el texto. Cargada con `next/font/google`
  (`axes: ['wdth']`), variable CSS `--font-sans`.
- **JetBrains Mono** 400/500 solo para datos técnicos (`.mono`), variable `--font-mono`, sin ligaduras.
- Cifras: `font-variant-numeric: tabular-nums` (`.num`) en tablas, KPIs, latencias y horas.

| Rol | Tamaño / alto de línea | Peso | Anchura (`font-stretch`) | Tracking |
|---|---|---|---|---|
| Display (hero landing) | `clamp(52px, 8vw, 104px)` / .9 | 640 | 72 % | −0.022em |
| H1 de página del panel | 36 / 1 | 640 | 78 % | −0.015em |
| H2 de sección (landing) | `clamp(34px, 4.2vw, 52px)` / 1.02 | 630 | 80 % | −0.016em |
| KPI | 34 / 1 | 620 | 78 % | −0.01em |
| Título de tarjeta | 15 / 1.3 | 650 | 100 % | 0 |
| Cuerpo panel | 14 / 1.5 | 400–550 | 100 % | 0 |
| Cuerpo landing / status page | 16 / 1.55 y 15 / 1.55 | 400 | 100 % | 0 |
| Metadatos | 12.5 / 1.4 | 500 | 100 % | 0 |

Reglas: frases en *sentence case*; nada de etiquetas en mayúsculas con tracking; no se resalta una sola palabra del
titular con otro color o cursiva; líneas de texto por debajo de ~75 caracteres (`max-width: 56ch` en entradillas).

---

## 4. Espacio, forma y profundidad

- Escala de espacio (px): 4, 6, 8, 10, 12, 14, 16, 18, 22, 28, 32, 48, 64, 96. El panel usa 22 px entre bloques y
  18–20 px de padding interno; la landing 96 px entre secciones.
- Radios con jerarquía: 6 px etiquetas y códigos HTTP · 8–10 px botones, campos y filas de navegación · 14 px tarjetas
  del panel · 16–18 px tableros y tarjetas de la landing/status page · 999 px chips y segmentos.
- Profundidad por superficie, no por sombra: `--bg` → `--panel` → `--raised`. Solo llevan sombra los elementos que
  flotan (menús, popovers, toasts, diálogos): `0 18px 40px rgba(0,0,0,.35)` en oscuro, `0 24px 60px rgba(10,15,30,.2)`
  en claro.
- Objetivos táctiles de 44 px como mínimo (40 px en controles compactos del panel con escritorio como destino).

### Rejillas

- **Panel:** barra lateral de 248 px + contenido fluido (`padding: 28px 32px 48px`). Bajo 860 px la barra se convierte
  en cabecera con navegación horizontal desplazable.
- **Status page:** columna centrada de 880 px con 20 px de margen lateral.
- **Landing:** contenedor de 1200 px con 32 px de margen (16 px en móvil); el hero ocupa todo el ancho del contenedor.

---

## 5. Movimiento

| Tipo | Ejemplo | Duración / curva |
|---|---|---|
| Orquestado (único) | Historia de la caída en el hero: checks que llegan, confirmación en 3 regiones, alerta, borrador de incidencia, status page que cambia de verde a rojo y vuelve. Pasos clicables y pausa al pasar por encima | Pasos de 2.6 s; transiciones de .45–.6 s `cubic-bezier(.2,.7,.2,1)` |
| Llegada de datos | Fila nueva en "Live checks" o en el timeline: entra desde −8 px con un destello del acento al 12 % | .55 s |
| Cambio de estado | Barras y textos de estado cruzan color | .5–.6 s ease |
| Pulso | Punto verde "en vivo"; punto rojo de incidencia activa | 2 s y 1.6 s, infinito |
| Acción | Abrir popover (escala .98 → 1), desplegar grupo (grid-rows 0fr → 1fr), toast (−8 px) | .25–.4 s |

Prohibido: aparición en cascada de cada sección al hacer scroll, hover que mueve tarjetas, parallax. Con
`prefers-reduced-motion: reduce` se anulan animaciones y transiciones (`styles/base.css`).

---

## 6. Componentes (`components/ui/`)

| Componente | Notas |
|---|---|
| `Button` / `ButtonLink` | Variantes `primary` (marca), `ghost` (borde `--line2`), `danger` (rojo, solo acciones destructivas), `quiet` (sin borde). Tamaños `md` 40 px y `sm` 32 px. Estado `loading` con spinner y texto que no cambia de ancho. Hover: `filter: brightness(1.14)` o borde más claro; nunca desplazamiento |
| `Field` | Etiqueta arriba (13.5 px, 550), pista debajo en `--faint`, error en `#FF8189` con `aria-describedby` |
| `Input`, `Textarea`, `Select` | Fondo `--sunken`, borde `--line2`, radio 10 px, 40 px de alto. `Select` es nativo con chevron propio |
| `Switch` | Pista de 30×18, activo en `--brand`; siempre con texto visible |
| `Segmented` | Píldora con `--raised` en la opción activa; para filtros y vistas (`aria-pressed`) |
| `Chip` | Píldora con borde `--line2`; tonos `danger`, `warning`, `success`, `info` para impacto y visibilidad |
| `StatusDot`, `StatusPill` | Punto + etiqueta del estado; `pulse` para "en vivo" o incidencia abierta |
| `UptimeBars` | 1 barra por día (30–90). Tooltip con fecha, minutos por estado e incidencias; `role="img"` con resumen accesible |
| `Sparkline`, `LatencyChart` | SVG propio; latencia p50/p95 por región con umbral discontinuo |
| `Card`, `CardHeader` | Superficie `--panel`, radio 14 px, cabecera con título 15/650 y acciones a la derecha |
| `Kpi` | Etiqueta, cifra (34 px, 78 % de anchura) y nota; separadas por bordes, no por tarjetas |
| `Table` (`.tbl`) | Rejilla CSS por filas (`role="table"`), cabecera 12.5 px `--faint`, filas de 11 px de padding, hover `rgba(148,170,210,.04)` |
| `Timeline` | Eventos con hora mono, punto por tipo (público `--accent`, interno ámbar, sistema `--faint`) y etiqueta |
| `Dialog`, `ConfirmDialog` | `<dialog>` nativo con foco atrapado; la acción destructiva repite el verbo ("Delete monitor") |
| `Toast` | Arriba a la derecha, `--raised`, borde del color del resultado; se cierra solo a los 5 s |
| `CommandPalette` | ⌘K / Ctrl K: navegar, cambiar de proyecto, declarar incidencia, programar mantenimiento, crear monitor |
| `CodeBlock`, `CopyButton` | Mono 13.5/1.75, números de línea, botón copiar con confirmación "Copied" |
| `EmptyState` | Una frase de qué falta y la acción para crearlo; sin ilustraciones |
| `RelativeTime` | "3 min ago" con `<time dateTime>` y título con la fecha absoluta en la zona del usuario |

Iconos: trazos de 2 px, 16 px en navegación y 14 px en línea (`components/ui/icons.tsx`), sin librería externa.

---

## 7. Patrones de página

### Panel (`app/(panel)`)
- **Barra lateral:** logo, selector de organización/proyecto con su entorno, buscador ⌘K, navegación del proyecto
  (Overview, Incidents con contador, Monitors con fallos, Maintenance, Components, Alerts, Integrations, Status page,
  Reports) y pie con usuario y plan.
- **Cabecera de página:** H1 + una línea de contexto ("Live. Checks arrive every 30 seconds.") a la izquierda y las dos
  acciones principales a la derecha (secundaria `ghost`, principal `primary`).
- **Overview:** banner de incidencia activa (si la hay), franja de KPIs (uptime con presupuesto de error, incidencias
  abiertas, MTTR, monitores en verde, p95), tabla de componentes con barras de 90 días y columna de "Live checks".
- **Incidencia:** compositor arriba (etapas investigating → identified → monitoring → resolved, estado por componente,
  público/interno, notificar suscriptores) y timeline debajo; columna lateral con detalles, tiempos (detectada,
  reconocida, resuelta, MTTA/MTTR) y postmortem.
- **Monitor:** gráfica de latencia por región, losetas por región con su estado confirmado, configuración, enrutado de
  alertas y últimos checks.
- Listas: filtros en la URL (`searchParams`), nunca compartidos entre vistas.

### Status page (`app/status`)
- Cabecera con logo o nombre, suscribirse (popover: email, Slack, webhook, RSS/Atom) y cambio de tema.
- Bloque de estado general tintado del peor estado; incidencias activas con su última actualización; mantenimientos
  programados; grupos de componentes plegables con barras de 90 días y tooltip; historial de incidencias por día;
  selector de zona horaria (por defecto la del visitante). Pie con "Powered by Upvane" salvo en planes que lo ocultan.
- Permalinks para incidencias y mantenimientos, página de historial paginada, feeds RSS/Atom y JSON.

### Landing (`app/page.tsx`)
- Hero con "Outages happen. Silence is optional." y el tablero animado de la caída; secciones de monitorización,
  incidencias, status page, integraciones como código (pestañas Terraform, CLI, GitHub Action, curl), precios
  (Free, Pro 9/7 $, Business 29/24 $) y FAQ. Solo se promete lo que existe (B-11).

---

## 8. Texto

- UI en inglés, frases cortas, voz activa y verbos concretos: "Declare incident", "Post update", "Pin status",
  "Return to automatic". Un botón y su toast usan el mismo verbo ("Publish" → "Published").
- Los errores dicen qué pasó y cómo seguir ("Your Free plan checks every 180 seconds at most. Upgrade to check more
  often."); no piden perdón ni son vagos.
- Los estados vacíos invitan a actuar ("No monitors yet. Add one to start checking from 15 regions.").
- Nombres desde el punto de vista de quien usa el producto: "Alert routing", no "alert_rules".

---

## 9. Accesibilidad

- Contraste AA en todo el texto (los tokens `--faint` y de estado están calibrados para ello sobre su superficie).
- Foco visible: contorno de 2 px `--accent` con 2–3 px de separación en todos los controles.
- Navegación completa con teclado: ⌘K, `Esc` cierra diálogos y popovers, flechas en segmentos y paleta.
- Las barras de uptime y gráficas exponen un resumen textual (`aria-label`) y tablas equivalentes en Reports.
- Cambios en vivo (checks, incidencias) se anuncian con `aria-live="polite"` sin robar el foco.

---

## 10. Implementación

| Archivo | Contenido |
|---|---|
| `styles/tokens.css` | Variables de color, tipografía, radios y sombras (`:root` = tinta; `.sp` y `.sp.dark` = status page) |
| `styles/base.css` | Reset, tipografía base, foco, utilidades (`.mono`, `.num`, `.sr-only`), movimiento reducido |
| `styles/ui.css` | Estilos del kit de `components/ui` |
| `styles/panel.css` | Shell del panel y patrones de página |
| `styles/status.css` | Status page pública (claro/oscuro) |
| `styles/landing.css` | Landing |

Las fuentes se cargan en `app/layout.tsx` con `next/font/google` y se exponen como `--font-sans` y `--font-mono`.
Las páginas nuevas reutilizan el kit; un estilo nuevo solo entra en `ui.css` si se usa en dos o más páginas.
