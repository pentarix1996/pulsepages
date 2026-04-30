# 🚀 Roadmap & TODOs de Upvane SaaS

## 🔒 1. Seguridad en Backend (PostgreSQL & Supabase)
- [ ] **Límite de Componentes**: Crear una función y un *Trigger* en PostgreSQL (similar al de la inserción de proyectos) que evite insertar nuevos componentes si se supera el cupo máximo asociado al \`plan\` del usuario en \`profiles\`.
- [ ] **Purga Histórica Diaria (Cron)**: Configurar \`pg_cron\` en Supabase o una Edge Function automatizada para ejecutarse diariamente (00:00). Debe eliminar de la tabla \`incidents\` e \`incident_updates\` los registros cuya fecha de creación (\`created_at\`) tenga mayor antigüedad que la que autoriza el plan (ej. > 7 días en Free, > 30 días en Pro).

## 🔑 2. Gestión de API Keys
- [X] **UI de Gestión de Tokens**: Añadir un nuevo apartado en el Dashboard interno (ej. en `/settings` o nueva pestaña `/api`) explícito para generar y revocar *API Keys*
- [X] **Generación Segura**: Programar el motor criptográfico para subir el *hash* de la key generada a nuestra tabla \`api_keys\` y enseñarle al usuario el secreto sin ofuscar una única vez.
- [X] **Revocación de API Keys**: Cuando pulsa en "Eliminar API Key", se eliminará de la base de datos, si se pulsa sobre "Regenerar" se eliminará de la base de datos también la vieja y se creará una nueva.
- [X] **Funcionalidades por API KEY** Revisa el archivo "supabase/functions/api/index.ts" por si hubiera que retocar algo. Lo que se quiere es que se pueda acceder via API por autenticación via API_TOKEN para poder realizar acciones en la API sobre los proyectos asociados a ese usuario. Tenemos una tabla en supabase de api_keys con el user_id asociado, token_hash, name y created_at. El objetivo final es que el usuario pueda hacer diferentes acciones via API, por ejemplo, crear incidencias, ver el estado de sus servicios, etc. Todos se devolverá en formato JSON.


## 📚 3. Documentación Técnica (Estilo Cursor / Stripe)
- [ ] **Sistema de Layout de Docs**: Crear la ruta `/docs`. Debe tener de un estilo gráfico diferencial y canónico (Sidebar a la izquierda con el índice en árbol, bloque grande central, modo oscuro nativo, y navegación limpia).
- [ ] **Documentación API**: Crear una documentación de la API completa, ver la mejor manera de hacer esto.
- [ ] **Contenido de API REST**: Reflejar fielmente la *base url* definitiva (ej. \`https://api.upvane.dev/v1/...\`), autenticación HTTP por \`Bearer\`, *Rate Limits* aplicables, y todos los ejemplos de CURLs y Snippets de NodeJS emulando una API real.
- [ ] **Enlaces de Accesibilidad**: Inyectar enlaces hacia este panel desde la Navbar del Landing original, el menú de navegación lateral del Dashboard y en el footer del Landing.

## 💳 4. Pagos Reales (Stripe)
- [ ] **Links de Pago (Checkout)**: Reemplazar la emulación de compra en `/settings` y `/pricing` invocando dinámicamente un Stripe Checkout.
- [ ] **Stripe Webhooks**: Crear una Edge Function secundaria (\`supabase/functions/stripe-webhook\`) para escuchar firmemente los pagos de Stripe y actualizar asíncronamente el campo \`plan\` de Supabase a 'pro' o 'business'.

## ✨ 5. Mejoras de Producto (Features Futuras)
- [X] **Métricas Reales (Uptimes)**: Cronometrar la vida cronológica exacta de un estado \`degraded\` o \`major_outage\` y construir calculadoras verdaderas de 99.99% de Uptime por cada mes del año para mostrar en la pestaña pública.
- [X] **Slug repetidos** Ahora mismo, si el usuario A crea el proyecto "Test Project" y el usuario B trata de crear el mismo proyecto desde su dashboard, le dará error porque ya existe el Slug en la base de datos. Debemos pensar de una manera limpia y escalable de que diferentes usuarios puedan crear el mismo nombre de proyecto. Pero un mismo usuario no pueda crear 2 veces el mismo Proyecto. Por ejemplo en el slug añadir un /uuid/slug_name (uuid corto) u otro mecanismo ideal que se utilice en estos casos.
- [X] **Monitorización Automática (Pingers)**: Completada con configuración por componente, modo manual por defecto, modo automático para planes Pro/Business, healthchecks HTTPS seguros mediante Supabase Cron + Edge Function cada minuto, reglas JSON case-insensitive para valores string, protección SSRF, historial de checks paginado y filtros por componente, estado del check y estado resultante.
- [ ] **Mejoras de rendimiento** Ahora mismo, los filtros de /incidents y los incidentes de un proyecto, cuando se cambia un filtro se hace una llamada nueva a la API, eso es overkill, hay que hacer que funcione igual que lo hace el "Recent Checks" del apartado monitoring de un proyecto. Para aliviar la carga de la API. Lo suyo sería traerse todo en una llamda y ya luego poder aplicar los filtros del lado del cliente.
- [ ] **Mantenimientos Programados**: Capacidad de programar en el calendario un incidente futuro de estado "Maintenance", con su banner de aviso preventivo en la Status Page.
- [X] **Notificaciones al equipo administrador del status page** Se podrá configurar un envío de alertas al correo electrónico del administrador cuando se genere una nueva incidencia.
- [ ] **Notificaciones para Suscriptores**: Una característica brutal donde los visitantes de la *Status Page* puedan darle a "Subscribe" con su email. Al actualizar/generar incidencias enviarles emails mediante integración con la API de Resend o Postmark o la mejor para este propósito.
- [ ] **Configurar visibilidad en proyectos** Se añadirá una nueva feature, dónde se podrán configurar los proyectos para que sean privados o públicos (privados por defecto). Los proyectos privados, no serán accesibles desde el esterior, salvo por el propio usuario de la cuenta o con un .get mediante la API_KEY del proyecto.

## ~~🐛 6. Bugs Críticos & UX Polish~~ ✅ RESUELTO
- [x] ~~**Congelación Modal Incidencias (Bug)**~~ → Resuelto con la migración a React (declarative modals)
- [x] ~~**Spinners de Espera Nativos (UX)**~~ → Componente `<Button loading>` con CSS spinner
- [x] ~~Redirección post-registro~~ → Muestra mensaje de confirmación de email
- [x] ~~**Carga inicial de la página (~20s)**~~ → Resuelto: Turbopack bundlea localmente (278ms startup)
- [x] **Bug entre pestañas** Cuando la pestaña de un proyecto y modifico el estado de un componente, se actualiza correctamente. Pero si voy al status-page y recargo, todo parece ir bien, hasta que vuelvo a la página de configuración (en otra pestaña) y veo que no me deja hacer nada (los cambios no surten efecto, no se lanzan lamadas a SupaBase) si no recargo previamente la página web.

## ~~🏗️ 7. Refactorización de Arquitectura y Stack~~ ✅ COMPLETADO
- [x] **Migración a Next.js 16 (React 19.2)**: Completada con App Router, Turbopack, React Compiler
- [x] **SSR para SEO**: Landing page y Status Pages renderizadas en servidor
- [x] **Suite de tests**: 81 unit tests (Vitest + Testing Library)
- [x] **TypeScript estricto**: Todo el código tipado
- [x] **Archivos Vanilla eliminados**: `js/`, `css/`, `index.html` borrados

## 🧪 8. Testing & QA (Próximo)
- [ ] **Tests E2E con Playwright**: Flujos críticos (registro, login, crear proyecto, gestionar incidentes)
- [ ] **Tests de componentes**: Renderizado y comportamiento de UI components con Testing Library
- [ ] **Cobertura 100%**: Ampliar tests unitarios a todos los providers (AuthProvider, StoreProvider)

## ~~✨ 9. Sistema de Severidades y Auto-Update de Componentes~~ ✅ COMPLETADO
- [x] ~~**Nuevo sistema de severidades**~~ → 4 niveles: `critical | high | medium | low` (reemplazó `info | warning | danger`)
- [x] ~~**Auto-update de componentes al crear incidencia**~~ → Componentes afectados se actualizan automáticamente según severidad
- [x] ~~**Auto-restore a Operational al resolver**~~ → Cuando se resuelve una incidencia, componentes vuelven a `operational` si no hay otras activas
- [x] ~~**Exclusión de maintenance**~~ → Incidentes `maintenance` no disparan auto-update

## ~~📄 10. Paginación y Filtros de Incidencias~~ ✅ COMPLETADO
- [x] ~~**Paginación de incidencias (10 por página)**~~ → Server-side pagination con `.range()` + `count: 'exact'`
- [x] ~~**Filtro por proyecto**~~ → FilterBar dropdown con proyectos del usuario
- [x] ~~**Filtro por componente**~~ → Deduplicación por nombre (mismo nombre en múltiples proyectos = 1 opción)
- [x] ~~**Filtro por rango de fechas**~~ → DateFrom/DateTo inputs con Supabase `gte`/`lt`
- [x] ~~**Componente FilterBar**~~ → Linear design, responsive (mobile stack)
- [x] ~~**Componente Pagination**~~ → Page pills (5 centrados), prev/next, mobile collapse
- [x] ~~**Integración en /incidents**~~ → FilterBar + Pagination + Spinner + EmptyState
- [x] ~~**Integración en /project/[id]**~~ → Misma integración pre-filtrada al proyecto
