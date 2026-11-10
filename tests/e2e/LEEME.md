# Recorridos de navegador

`playwright.config.ts` corre todos los `*.spec.ts` de esta carpeta contra `next start`, con un Postgres desechable, el emulador de Blob y un proveedor de correo falso. Los mismos recorridos corren en local y en Vercel CI (tarea `test:e2e`). Ninguno toca Neon, Resend ni Blob reales, y ninguno mueve dinero.

| Spec | Qué recorre |
| --- | --- |
| `pagos-proveedores.spec.ts` | Mesa, alta de proveedor, CFDI, excepción, descarga privada, autorización por un segundo liberador, rechazo, corrección y cancelación. El alta, las solicitudes y la autorización se envían con doble clic y la prueba cuenta en la base que quedó una sola operación. |
| `personas.spec.ts` | Áreas, altas con nómina, tarjeta y acceso, lote, baja y volumen de 200 personas. |
| `nomina.spec.ts` | Alta con nómina, cambio de CLABE de nómina con reautenticación y preparación del lote vencido, todo con doble clic. |
| `flujo-de-caja.spec.ts` | Saldo declarado, cobro manual y con XML, obligación recurrente, presupuesto al 80 y al 100 %, «mover pago», faltante en Inicio y Aprobaciones (entrando por la dirección vieja de Pendientes) y «Monto reservado» para Finanzas. |
| `entrada.spec.ts` | Entrada de cliente con contraseña y TOTP. El tope de intentos no revela si el correo tiene cuenta: mismo texto, marcado, dirección y tiempo. |
| `operacion.spec.ts` | Entrada SOFIPO con TOTP; prospecto registrado y activación pedida por Originación: sin expediente aprobado la base no deja activar, y Faro E2E (en regla) la aprueba otra persona con Aprobación y factor reciente; «Perdí el segundo factor» con «Confirma que eres tú» en Recuperaciones y publicación del precio con reautenticación. |
| `passkeys.spec.ts` | Con el autenticador virtual de Chromium (CDP) y el `Permissions-Policy` de la aplicación: Lucía registra una passkey en `/entrar/seguridad` y entra con ella; la primera persona del personal la registra en su primer ingreso a Operación (`/operacion/continuar`) y entra con ella. El servidor corre con `AUTENTICACION_DOMINIOS=localhost`. |
| `invitacion.spec.ts` | Invitación del primer administrador desde Operación, «Reenviar invitación» con doble clic, cuenta con TOTP y recuperación de contraseña por correo. |
| `roles.spec.ts` | Lo que cada rol ve en el lateral y en «Más», las rutas que no le abren aunque escriba la dirección y la redirección de Pendientes a Aprobaciones. |
| `aprobaciones.spec.ts` | En Arrecife E2E (recién dada de alta), cada pendiente de puesta en marcha se resuelve en su módulo (área, categoría, proveedor con constancia, obligación de flujo de caja) y, al volver con un clic en el lateral, Aprobaciones ya no lo muestra o enciende el aviso nuevo. Sin JavaScript, «Rechazar» abre el motivo (aviso y campo marcado si el servidor no lo acepta) y rechaza; «Autorizar» decide con la acción del servidor; doble clic y F5 deciden una sola vez; con el segundo factor vencido, con o sin JavaScript, la fila pide el código de la app y conserva el motivo; `?rechazar=` con un pago ajeno se ve igual que con uno inexistente. |
| `demostracion.spec.ts` | Modo demostración: en la empresa real cada módulo sin proveedor dice «Disponible pronto» y ni el HTML ni la carga RSC traen cifras o nombres de ejemplo; en la de demostración, el aviso y los botones de dinero apagados. |
| `marco.spec.ts` | Menú de la persona, buscador, Apariencia y cajón móvil. |
| `accesibilidad.spec.ts` | El enlace del logotipo se nombra con lo que muestra (WCAG 2.5.3) y lleva a Resumen o a Aprobaciones; en el teléfono, la barra de arriba es la navegación «Menú» y el aviso regulatorio va en el pie, en el portal y en Operación; las tablas que se desplazan se alcanzan con Tab; los dos buscadores de Proveedores tienen nombre propio (axe `landmark-unique` a 1440 y 390); sin JavaScript, «Salir» está a la vista y cierra la sesión. |
| `claves-repetidas.spec.ts` | Cada página del portal que lee la dirección, pedida con todas sus claves repetidas (`?q=a&q=b`), responde 200: la clave repetida se descarta. |

## Correr en local

Hace falta un Postgres local desechable (nunca `plataforma` ni una base compartida) y el Chromium de Playwright (`npx playwright install chromium`).

```sh
E2E_ADMIN_URL=postgres://<usuario>@127.0.0.1:<puerto>/postgres npm run test:e2e
npm run test:e2e -- tests/e2e/nomina.spec.ts   # un solo spec
npm run test:e2e:2                              # solo la parte 2 de 7, como en CI
```

Sin `E2E_ADMIN_URL`, el script hace lo mismo que en CI: levanta `postgres:17` y el navegador en contenedores de Docker.

`npm run test:e2e` corre `scripts/ci/pruebas-e2e.sh`, que compila Next y llama a `playwright test`. Antes de las pruebas, `tests/e2e/global-setup.ts`:

1. crea una base con nombre aleatorio y le aplica todas las migraciones;
2. carga `seed-pagos.sql` (Taller del Cierre con las sesiones de Gil y Rosa) y la empresa de Personas;
3. siembra Altamar E2E, Bahía E2E, tres personas de Operación con los roles de la 0028 y Faro E2E (`siembra.ts`). Los roles se dan con el servicio de la pantalla Personal, una persona a otra: op1 Originación (registra prospectos y pide activaciones), op2 Aprobación (las decide) y op3 Cumplimiento (dictamina expedientes); las tres conservan Administración. Faro E2E queda en alta con expediente aprobado por op3, riesgo vigente y la activación pedida por op1, lo que exige el candado de la base para que op2 la apruebe; sus documentos van a un almacén en memoria porque la siembra corre antes del emulador de Blob;
4. levanta el emulador de Blob y `next start` en `E2E_PUERTO`, con el correo falso precargado.

Al terminar, `global-teardown.ts` detiene el servidor y el emulador y borra la base. En la máquina de desarrollo la suite completa tarda unos 2 minutos.

Variables:

- `E2E_ADMIN_URL`: Postgres administrador donde se crea y se borra la base. Puede venir sin base; entonces se usa `postgres`.
- `E2E_PUERTO` (3153 en el script, 3109 si se llama a Playwright directo) y `E2E_BLOB_PUERTO` (4896).
- `E2E_BASE_URL`: otro origen del portal, que debe coincidir con el de las Server Actions.
- `CHROME_PATH`: otro Chrome; sin ella se usa el Chromium de Playwright.
- `E2E_CAPTURAS`: carpeta de las capturas de evidencia de Pagos y Personas (`test-results/…`). En CI no se toman (`E2E_SIN_CAPTURAS=1`).

## En Vercel CI

`turbo.json` declara siete tareas, de `test:e2e:1` a `test:e2e:7`, con las etiquetas `ci` y `ci:cpus:4`. Vercel CI las corre en cada push en paralelo, cada una en su propia máquina, junto con typecheck, lint, test, test:db, build y security. Cada parte corre `playwright test --shard=N/7` con su propio build, su propio Postgres y su propio `next start`, y el tope de 12 minutos se mide por parte. En CI:

- Postgres corre en un contenedor `postgres:17` (puerto 5553, el mismo dentro y fuera).
- Chromium corre en la imagen oficial `mcr.microsoft.com/playwright:v<versión>-noble` con `playwright run-server` y red del anfitrión. La imagen de la tarea no trae las bibliotecas del navegador. El corredor, la siembra, el emulador y `next start` siguen en la máquina de la tarea.
- `retries: 0`, sin video, con traza sin capturas y sin capturas de evidencia.
- Playwright reparte las partes por grupo y por número de pruebas, no por tiempo: un spec sin `mode: "parallel"` es un solo grupo (los `describe` seriales de adentro viajan juntos), y un grupo va entero a la parte donde empieza. `operacion.spec.ts` es `parallel` solo para partirse en nueve `describe` seriales; su orden decide el reparto (lo explica el comentario de arriba del archivo). Con 156 pruebas en siete partes quedan 25, 23, 22, 23, 24, 18 y 21 (`--list --shard=N/7`). El orden sale de los tiempos de pruebas del CI, no de los locales: en el CI las de Operación tardan unas 6 veces más. Antecedentes:
  - Con tres partes y Duna en la 1, esa parte tardó 554 s, con 470 s de pruebas, contra 202 y 301 de las otras dos.
  - Con cuatro, el CI de `d2d56df` dio 444, 352, 351 y 289 s, con 360, 276, 264 y 222 s de pruebas y de 57 a 74 s fijos por parte. La parte 1 llevaba los 5 specs anteriores a `operacion.spec.ts`, 17 pruebas que tardaron 318 s.
  - Con cinco y coincidencias junto a pagos-proveedores en la parte 4, el CI de `0dc1a7a` dio 316, 226, 241, 473 y 168 s. La 4 tuvo 343 s de pruebas: pagos-proveedores tardó 170 s (87 a 99 en las corridas anteriores) y coincidencias, 121 s (80 a 104). Son los dos grupos que más varían, y ahora van en partes distintas.
  - El reparto se evalúa con el tiempo máximo observado de cada grupo, no con el promedio. Con el orden de hoy, el modelo da 263, 266, 264, 270 y 113 s de pruebas con los máximos, y 223, 250, 210, 183 y 108 con los típicos.
  - Con la ola 2b (#60), el fondo animado vivía en `marco.spec.ts`, un solo grupo: en el CI de `88278c4` la parte 3 tardó 743 s, con 456 s de las 5 pruebas con GPU emulada a DPR 2 (66 a 114 s cada una; de 8 a 19 s en local, por el WebGL por software del navegador remoto). Ahora `marco.spec.ts`, `fondo.spec.ts` (DPR 1), `optica-retina.spec.ts` (DPR 2) y `demostracion.spec.ts` son `parallel` solo para partirse: sus pruebas no comparten estado. Las del fondo se definen en `fondo-pruebas.ts`; el nombre `optica-retina` deja ese archivo justo después de `operacion.spec.ts`, donde cruza el corte entre las partes 6 y 7, y su orden pone tres de GPU (114, 78 y 66 s) en la 6 y las otras dos en la 7. Con los tiempos de pruebas del CI de `88278c4`, el modelo da 133, 283, 198, 207, 272, 323 y 334 s de pruebas por parte (sin las 4 de r60b-N1, nuevas y cortas, en la parte 4).
  - Si una parte se acerca a los 450 s, mueve un grupo de `operacion.spec.ts` (respetando G1 → G3 → G4 y «Brisa y Cima» antes de G4) o agrega otra parte (`test:e2e:8` y `--shard=N/8` en todas).
- El script cuenta las pruebas corridas en el reporte JSON (`test-results/e2e-resumen.json`) y falla si una corrida, o una parte, no corrió ninguna: Playwright termina en 0 con una parte vacía. Antes, la parte 2 quedaba vacía (49, 0 y 14) porque `operacion.spec.ts` entero caía en la 1.
- Si algo falla, como Vercel CI no guarda archivos de una tarea fallida, el script imprime en la salida el contexto de cada falla (árbol accesible de la página), las últimas líneas del servidor y las capturas en base64.

Para revisar una corrida: `vercel ci list --git-branch <rama>` y `vercel ci logs <id> --task '//#test:e2e'`.

## Lo que sustituye a los servicios reales

- **Blob** (`blob-local/`): un servidor en memoria en 127.0.0.1 que habla el protocolo de `@vercel/blob` (put, del y get privado con token). `preload.mjs` desvía en `next start` solo el host del almacén privado. La aplicación no cambia. Además de la guarda común, solo se activa con `E2E_BLOB_LOCAL=1` y sin ningún token de un almacén real en el entorno.
- **Correo** (`correo-local/preload.mjs`): en `next start`, un `fetch` envuelto que intercepta solo `POST https://api.resend.com/emails`, anota cada mensaje en `test-results/correos-e2e.jsonl` (una vez por llave de idempotencia, como Resend) y responde como Resend. `apoyo.ts` lee los correos (`correosPara`) y sus enlaces (`enlaceDe`).
- **Guarda de los dos preloads** (`guarda-preload.mjs`): al cargarse, cada preload truena con error, y el proceso sale con código distinto de 0, si `VERCEL_ENV` está definido, si `NODE_ENV=production` sin `E2E_SERVER_ACTIONS=1`, o si `DATABASE_URL` no apunta a 127.0.0.1 ni a localhost. Lo revisa antes de mirar su propia variable, así que copiar el `NODE_OPTIONS` de la prueba fuera de ella no arranca nada. `guardas-preload.test.ts` lo prueba en `npm test`, y nada de `src/` importa estos archivos.
- **App autenticadora**: la siembra registra un TOTP confirmado para cada persona con una llave aleatoria por corrida (`AUTENTICACION_LLAVE_TOTP`) y deja las semillas en `E2E_SEMILLAS`. `codigoTotp(correo)` calcula un código que el servidor acepta y que nadie ha usado: lee `ultimo_paso` de la base y, si se agotaron los tres pasos válidos, espera a que llegue uno nuevo.
- **Sesiones**: `sesionDe(contexto, correo, { superficie, factorHaceMinutos })` abre una sesión con segundo factor como dueña de la base y la deja en la cookie `__Host-sesion`. `factorHaceMinutos` (o `envejecerFactor`) simula un factor viejo para probar «Confirma que eres tú» sin esperar 30 minutos.

## Agregar un spec

1. Usa `tests/e2e/apoyo.ts`: `sesionDe` para entrar, `dobleClic` para enviar (devuelve cuántos envíos salieron del navegador), `contar` y `consultar` para revisar la base como dueña, `codigoTotp` y `codigoDeSemilla` para los códigos, `correosPara` y `enlaceDe` para el correo, y `vigilarConsola` para exigir una consola sin errores.
2. Todo lo que cambia datos de la aplicación pasa por clics. La base solo se toca para abrir sesiones, leer lo que prueba cada paso y mover relojes que la prueba no puede esperar.
3. Después de cada envío de dinero o seguridad, cuenta en la base que quedó exactamente una operación y que la bitácora tiene su evento.
4. Nada de `waitForTimeout`. Espera la condición: una URL, un texto, una fila o `expect.poll`.
5. Cada spec debe pasar solo y dentro de la suite completa, en cualquier orden. Si necesitas una persona nueva, agrégala en `siembra.ts` (`CORREOS`) y no reuses la de otro spec para algo que la cambie, como su factor, su contraseña o su tope. Si las pruebas de un archivo dependen entre sí, usa `test.describe.configure({ mode: "serial" })`. Si el archivo se parte en grupos (`parallel` con `describe` seriales, como `operacion.spec.ts`), cada grupo debe pasar solo, con la siembra recién hecha: es lo que corre su parte. Pruébalo con las siete partes (de `npm run test:e2e:1` a `:7`), no solo con la suite completa.
6. Corre la suite completa tres veces seguidas antes de abrir el PR. Una prueba que falla a veces se arregla en su causa: no hay reintentos.

## Revisar la semilla de Pagos a mano

`npm run test:e2e:reset` borra y recrea una base persistente (`lever_pagos_dev`, o la de `E2E_BASE_DATOS`) con la misma semilla, para abrirla con `npm start` y navegarla sin la suite. Usa `E2E_ADMIN_URL` sin base (por omisión, el usuario del sistema en `127.0.0.1:55432`).
