# Recorridos de navegador

`playwright.config.ts` corre todos los `*.spec.ts` de esta carpeta contra `next start`, con un Postgres desechable, el emulador de Blob y un proveedor de correo falso. Los mismos recorridos corren en local y en Vercel CI (tarea `test:e2e`). Ninguno toca Neon, Resend ni Blob reales, y ninguno mueve dinero.

| Spec | Qué recorre |
| --- | --- |
| `pagos-proveedores.spec.ts` | Mesa, alta de proveedor, CFDI, excepción, descarga privada, autorización por un segundo liberador, rechazo, corrección y cancelación. El alta, las solicitudes y la autorización se envían con doble clic y la prueba cuenta en la base que quedó una sola operación. |
| `personas.spec.ts` | Áreas, altas con nómina, tarjeta y acceso, lote, baja y volumen de 200 personas. |
| `nomina.spec.ts` | Alta con nómina, cambio de CLABE de nómina con reautenticación y preparación del lote vencido, todo con doble clic. |
| `flujo-de-caja.spec.ts` | Saldo declarado, cobro manual y con XML, obligación recurrente, presupuesto al 80 y al 100 %, «mover pago», faltante en Inicio y Pendientes y «Monto reservado» para Finanzas. |
| `entrada.spec.ts` | Entrada de cliente con contraseña y TOTP. El tope de intentos no revela si el correo tiene cuenta: mismo texto, marcado, dirección y tiempo. |
| `operacion.spec.ts` | Entrada SOFIPO con TOTP, prospecto → activación decidida por otra persona, «Perdí el segundo factor» con «Confirma que eres tú» en Recuperaciones y publicación del precio con reautenticación. |
| `invitacion.spec.ts` | Invitación del primer administrador desde Operación, «Reenviar invitación» con doble clic, cuenta con TOTP y recuperación de contraseña por correo. |
| `roles.spec.ts` | Lo que cada rol ve en el lateral y las rutas que no le abren aunque escriba la dirección. |
| `marco.spec.ts` | Menú de la persona, buscador, Apariencia y cajón móvil. |

## Correr en local

Hace falta un Postgres local desechable (nunca `plataforma` ni una base compartida) y el Chromium de Playwright (`npx playwright install chromium`).

```sh
E2E_ADMIN_URL=postgres://<usuario>@127.0.0.1:<puerto>/postgres npm run test:e2e
npm run test:e2e -- tests/e2e/nomina.spec.ts   # un solo spec
```

Sin `E2E_ADMIN_URL`, el script hace lo mismo que en CI: levanta `postgres:17` y el navegador en contenedores de Docker.

`npm run test:e2e` corre `scripts/ci/pruebas-e2e.sh`, que compila Next y llama a `playwright test`. Antes de las pruebas, `tests/e2e/global-setup.ts`:

1. crea una base con nombre aleatorio y le aplica todas las migraciones;
2. carga `seed-pagos.sql` (Taller del Cierre con las sesiones de Gil y Rosa) y la empresa de Personas;
3. siembra Altamar E2E, Bahía E2E y dos personas de Operación (`siembra.ts`);
4. levanta el emulador de Blob y `next start` en `E2E_PUERTO`, con el correo falso precargado.

Al terminar, `global-teardown.ts` detiene el servidor y el emulador y borra la base. En la máquina de desarrollo la suite completa tarda unos 2 minutos.

Variables:

- `E2E_ADMIN_URL`: Postgres administrador donde se crea y se borra la base. Puede venir sin base; entonces se usa `postgres`.
- `E2E_PUERTO` (3153 en el script, 3109 si se llama a Playwright directo) y `E2E_BLOB_PUERTO` (4896).
- `E2E_BASE_URL`: otro origen del portal, que debe coincidir con el de las Server Actions.
- `CHROME_PATH`: otro Chrome; sin ella se usa el Chromium de Playwright.
- `E2E_CAPTURAS`: carpeta de las capturas de evidencia de Pagos y Personas (`test-results/…`). En CI no se toman (`E2E_SIN_CAPTURAS=1`).

## En Vercel CI

`turbo.json` declara `test:e2e` con las etiquetas `ci` y `ci:cpus:8`, así que Vercel CI la corre en cada push junto con typecheck, lint, test, test:db, build y security. En CI:

- Postgres corre en un contenedor `postgres:17` (puerto 5553, el mismo dentro y fuera).
- Chromium corre en la imagen oficial `mcr.microsoft.com/playwright:v<versión>-noble` con `playwright run-server` y red del anfitrión. La imagen de la tarea no trae las bibliotecas del navegador. El corredor, la siembra, el emulador y `next start` siguen en la máquina de la tarea.
- `retries: 0`, sin video, con traza sin capturas y sin capturas de evidencia: así la tarea completa cabe en 12 minutos.
- Si algo falla, como Vercel CI no guarda archivos de una tarea fallida, el script imprime en la salida el contexto de cada falla (árbol accesible de la página), las últimas líneas del servidor y las capturas en base64.

Para revisar una corrida: `vercel ci list --git-branch <rama>` y `vercel ci logs <id> --task '//#test:e2e'`.

## Lo que sustituye a los servicios reales

- **Blob** (`blob-local/`): un servidor en memoria en 127.0.0.1 que habla el protocolo de `@vercel/blob` (put, del y get privado con token). `preload.mjs` desvía en `next start` solo el host del almacén privado. La aplicación no cambia.
- **Correo** (`correo-local/preload.mjs`): en `next start`, un `fetch` envuelto que intercepta solo `POST https://api.resend.com/emails`, anota cada mensaje en `test-results/correos-e2e.jsonl` (una vez por llave de idempotencia, como Resend) y responde como Resend. `apoyo.ts` lee los correos (`correosPara`) y sus enlaces (`enlaceDe`).
- **App autenticadora**: la siembra registra un TOTP confirmado para cada persona con una llave aleatoria por corrida (`AUTENTICACION_LLAVE_TOTP`) y deja las semillas en `E2E_SEMILLAS`. `codigoTotp(correo)` calcula un código que el servidor acepta y que nadie ha usado: lee `ultimo_paso` de la base y, si se agotaron los tres pasos válidos, espera a que llegue uno nuevo.
- **Sesiones**: `sesionDe(contexto, correo, { superficie, factorHaceMinutos })` abre una sesión con segundo factor como dueña de la base y la deja en la cookie `__Host-sesion`. `factorHaceMinutos` (o `envejecerFactor`) simula un factor viejo para probar «Confirma que eres tú» sin esperar 30 minutos.

## Agregar un spec

1. Usa `tests/e2e/apoyo.ts`: `sesionDe` para entrar, `dobleClic` para enviar (devuelve cuántos envíos salieron del navegador), `contar` y `consultar` para revisar la base como dueña, `codigoTotp` y `codigoDeSemilla` para los códigos, `correosPara` y `enlaceDe` para el correo, y `vigilarConsola` para exigir una consola sin errores.
2. Todo lo que cambia datos de la aplicación pasa por clics. La base solo se toca para abrir sesiones, leer lo que prueba cada paso y mover relojes que la prueba no puede esperar.
3. Después de cada envío de dinero o seguridad, cuenta en la base que quedó exactamente una operación y que la bitácora tiene su evento.
4. Nada de `waitForTimeout`. Espera la condición: una URL, un texto, una fila o `expect.poll`.
5. Cada spec debe pasar solo y dentro de la suite completa, en cualquier orden. Si necesitas una persona nueva, agrégala en `siembra.ts` (`CORREOS`) y no reuses la de otro spec para algo que la cambie, como su factor, su contraseña o su tope. Si las pruebas de un archivo dependen entre sí, usa `test.describe.configure({ mode: "serial" })`.
6. Corre la suite completa tres veces seguidas antes de abrir el PR. Una prueba que falla a veces se arregla en su causa: no hay reintentos.

## Revisar la semilla de Pagos a mano

`npm run test:e2e:reset` borra y recrea una base persistente (`lever_pagos_dev`, o la de `E2E_BASE_DATOS`) con la misma semilla, para abrirla con `npm start` y navegarla sin la suite. Usa `E2E_ADMIN_URL` sin base (por omisión, el usuario del sistema en `127.0.0.1:55432`).
