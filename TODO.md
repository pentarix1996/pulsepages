# 🚀 Roadmap & TODOs de PulsePages SaaS

## 🔒 1. Seguridad en Backend (PostgreSQL & Supabase)
- [ ] **Límite de Componentes**: Crear una función y un *Trigger* en PostgreSQL (similar al de la inserción de proyectos) que evite insertar nuevos componentes si se supera el cupo máximo asociado al \`plan\` del usuario en \`profiles\`.
- [ ] **Purga Histórica Diaria (Cron)**: Configurar \`pg_cron\` en Supabase o una Edge Function automatizada para ejecutarse diariamente (00:00). Debe eliminar de la tabla \`incidents\` e \`incident_updates\` los registros cuya fecha de creación (\`created_at\`) tenga mayor antigüedad que la que autoriza el plan (ej. > 7 días en Free, > 30 días en Pro).

## 🔑 2. Gestión de API Keys
- [ ] **UI de Gestión de Tokens**: Añadir un nuevo apartado en el Dashboard interno (ej. en `/settings` o nueva pestaña `/api`) explícito para generar y revocar *API Keys*. 
- [ ] **Generación Segura**: Programar el motor criptográfico para subir el *hash* de la key generada a nuestra tabla \`api_keys\` y enseñarle al usuario el secreto sin ofuscar una única vez.
- [ ] **Restringir Inclusión Core**: Ajustar la lógica del Edge Function actual (\`api/index.ts\`) si fuese necesario para que tire error \`403 Forbidden\` ante llamadas con Tokens pertenecientes a dueños en el plan 'free' o cuya API KEY no corresponda a sus proyectos.

## 📚 3. Documentación Técnica (Estilo Cursor / Stripe)
- [ ] **Sistema de Layout de Docs**: Crear la ruta `/docs`. Debe tener de un estilo gráfico diferencial y canónico (Sidebar a la izquierda con el índice en árbol, bloque grande central, modo oscuro nativo, y navegación limpia).
- [ ] **Contenido de API REST**: Reflejar fielmente la *base url* definitiva (ej. \`https://api.pulsepages.dev/v1/...\`), autenticación HTTP por \`Bearer\`, *Rate Limits* aplicables, y todos los ejemplos de CURLs y Snippets de NodeJS emulando una API real.
- [ ] **Enlaces de Accesibilidad**: Inyectar enlaces hacia este panel desde la Navbar del Landing original, el menú de navegación lateral del Dashboard y en el footer del Landing.

## 💳 4. Pagos Reales (Stripe)
- [ ] **Links de Pago (Checkout)**: Reemplazar la emulación de compra en `/settings` y `/pricing` invocando dinámicamente un Stripe Checkout.
- [ ] **Stripe Webhooks**: Crear una Edge Function secundaria (\`supabase/functions/stripe-webhook\`) para escuchar firmemente los pagos de Stripe y actualizar asíncronamente el campo \`plan\` de Supabase a 'pro' o 'business'.

## ✨ 5. Mejoras de Producto (Features Futuras)
- [ ] **Métricas Reales (Uptimes)**: Cronometrar la vida cronológica exacta de un estado \`degraded\` o \`major_outage\` y construir calculadoras verdaderas de 99.99% de Uptime por cada mes del año para mostrar en la pestaña pública.
- [ ] **Modo "Mantenimientos Programados"**: Permitir la creación de un incidente temporal en el futuro alertando en color Azul o Gris al visitante de que habrán cortes la próxima semana.
- [ ] **Monitorización Automática (Pingers)**: Que el usuario nos de una URL real de su web o API (healthcheck) y nuestros propios servidores de Supabase traten de hacer PING cada X tiempo (configurable, no menor a 15 segundos); si falla, abrimos una incidencia por ellos automáticamente. Se deberá añadir una sección de configuración para poder configurar. Esto solo estará disponible para el plan PRO y Business.
- [ ] **Mantenimientos Programados**: Capacidad de programar en el calendario un incidente futuro de estado "Maintenance", con su banner de aviso preventivo en la Status Page.
- [ ] **Notificaciones al equipo administrador del status page** Se podrá configurar un envío de alertas al correo electrónico del administrador cuando se genere una nueva incidencia.
- [ ] **Notificaciones para Suscriptores**: Una característica brutal donde los visitantes de la *Status Page* puedan darle a "Subscribe" con su email. Al actualizar/generar incidencias enviarles emails mediante integración con la API de Resend o Postmark o la mejor para este propósito.
- [ ] **Configurar visibilidad en proyectos** Se añadirá una nueva feature, dónde se podrán configurar los proyectos para que sean privados o públicos (privados por defecto). Los proyectos privados, no serán accesibles desde el esterior, salvo por el propio usuario de la cuenta o con un .get mediante la API_KEY del proyecto.

## ~~🐛 6. Bugs Críticos & UX Polish~~ ✅ RESUELTO
- [x] ~~**Congelación Modal Incidencias (Bug)**~~ → Resuelto con la migración a React (declarative modals)
- [x] ~~**Spinners de Espera Nativos (UX)**~~ → Componente `<Button loading>` con CSS spinner
- [x] ~~Redirección post-registro~~ → Muestra mensaje de confirmación de email
- [x] ~~**Carga inicial de la página (~20s)**~~ → Resuelto: Turbopack bundlea localmente (278ms startup)
- [ ] **Bug entre pestañas** Cuando la pestaña de un proyecto y modifico el estado de un componente, se actualiza correctamente. Pero si voy al status-page y recargo, todo parece ir bien, hasta que vuelvo a la página de configuración (en otra pestaña) y veo que no me deja hacer nada (los cambios no surten efecto, no se lanzan lamadas a SupaBase) si no recargo previamente la página web.

## ~~🏗️ 7. Refactorización de Arquitectura y Stack~~ ✅ COMPLETADO
- [x] **Migración a Next.js 16 (React 19.2)**: Completada con App Router, Turbopack, React Compiler
- [x] **SSR para SEO**: Landing page y Status Pages renderizadas en servidor
- [x] **Suite de tests**: 65 unit tests (Vitest + Testing Library)
- [x] **TypeScript estricto**: Todo el código tipado
- [x] **Archivos Vanilla eliminados**: `js/`, `css/`, `index.html` borrados

## 🧪 8. Testing & QA (Próximo)
- [ ] **Tests E2E con Playwright**: Flujos críticos (registro, login, crear proyecto, gestionar incidentes)
- [ ] **Tests de componentes**: Renderizado y comportamiento de UI components con Testing Library
- [ ] **Cobertura 100%**: Ampliar tests unitarios a todos los providers (AuthProvider, StoreProvider)
