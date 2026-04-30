- [x] Implementar una Base de Datos y Backend Real: Reemplazar el store.js actual que guarda en memoria local, e integrar Supabase (que te otorga Base de datos Postgres y Autenticación).
- [ ] Implementar Pagos reales (Monetización): Ya tienes tu esquema de pricing (Free, Pro, Business). Tienes que enlazar Stripe de forma que cada usuario pueda actualizar su plan de verdad.
- [ ] Manejar las URL públicas (Status Pages): Construir la capa para las URL /status/:slug de forma que cualquiera, desde cualquier dispositivo de internet que no sea local, pueda interrogar la base de datos real para leer ese estado.
- [ ] Despliegue final: Comprar un dominio oficial (ej. upvane.com) y enlazar tu repositorio de Vercel para que suba la aplicación real a la red.
- [ ] Comunicaciones automatizadas: Configurar e integrar una herramienta de Emails (ej. Resend) para que cuando los usuarios pulsen "Registrar", les llegue un correo.
- [ ] Legales (Importantísimo): Como manejarás datos e incidentes, añadir tus "Terms of Service" y "Privacy Policy".


Para Resend:
1. Crear cuenta en Resend.
2. Verificar dominio en Resend.
3. Configurar DNS que te indiquen:
   - DKIM
   - SPF/Return-Path según te pidan
   - quizá DMARC recomendado
4. Crear API key.
5. Pasarnos/env configurar:
   - RESEND_API_KEY
   - ALERTS_EMAIL_FROM, por ejemplo:  
     Upvane <alerts@upvane.dev>
6. No usar onboarding@resend.dev en producción. Eso es solo test.
