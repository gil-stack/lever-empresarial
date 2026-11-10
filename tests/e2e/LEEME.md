# Recorridos de navegador

`playwright.config.ts` corre todos los `*.spec.ts` de esta carpeta contra `next start`, con un Postgres desechable, el emulador de Blob y un proveedor de correo falso. Los mismos recorridos corren en local y en Vercel CI (tarea `test:e2e`). Ninguno toca Neon, Resend ni Blob reales, y ninguno mueve dinero.

| Spec | Qué recorre |
| --- | --- |
| `pagos-proveedores.spec.ts` | Mesa, alta de proveedor, CFDI, excepción, descarga privada, autorización por un segundo liberador, rechazo, corrección y cancelación. El alta, las solicitudes y la autorización se envían con doble clic y la prueba cuenta en la base que quedó una sola operación. |
| `personas.spec.ts` | Áreas, altas con nómina, tarjeta y acceso, lote, baja y volumen de 200 personas. |
| `nomina.spec.ts` | Alta con nómina, cambio de CLABE de nómina con reautenticación y preparación del lote vencido, todo con doble clic. |
| `flujo-de-caja.spec.ts` | Saldo declarado, cobro manual y con XML, obligación recurrente, presupuesto al 80 y al 100 %, «mover pago», faltante en Inicio y Pendientes y «Monto reservado» para Finanzas. |
| `entrada.spec.ts` | Entrada de cliente con contraseña y TOTP. El tope de intentos no revela si el correo tiene cuenta: mismo texto, marcado, dirección y tiempo. |
| `operacion.spec.ts` | Entrada SOFIPO con TOTP; prospecto registrado y activación pedida por Originación: sin expediente aprobado la base no deja activar, y Faro E2E (en regla) la aprueba otra persona con Aprobación y factor reciente; «Perdí el segundo factor» con «Confirma que eres tú» en Recuperaciones y publicación del precio con reautenticación. |
| `passkeys.spec.ts` | Con el autenticador virtual de Chromium (CDP) y el `Permissions-Policy` de la aplicación: Lucía registra una passkey en `/entrar/seguridad` y entra con ella; la primera persona del personal la registra en su primer ingreso a Operación (`/operacion/continuar`) y entra con ella. El servidor corre con `AUTENTICACION_DOMINIOS=localhost`. |
| `invitacion.spec.ts` | Invitación del primer administrador desde Operación, «Reenviar invitación» con doble clic, cuenta con TOTP y recuperación de contraseña por correo. |
| `roles.spec.ts` | Lo que cada rol ve en el lateral y las rutas que no le abren aunque escriba la dirección. |
| `marco.spec.ts` | Menú de la persona, buscador, Apariencia y cajón móvil. |
| `pld.spec.ts` | PLD (Ola R2): Originación declara el perfil transaccional de un prospecto y Aprobación lo ve sin alertas ni casos; un aviso del personal que menciona a op2 llega a Cumplimiento, que abre el caso y agrega una nota, y op2 no ve el menú ni la pantalla de PLD. Todo con doble clic y conteo en la base. Además, ninguna página de PLD se cae con una clave repetida en la dirección y, sin JavaScript, agregar una nota responde 303 con su aviso. Por último, el Comité: con tres integrantes y una sesión que ya votó un caso sin reserva, votar ahí el caso que menciona a op2 dice «Este caso va en otra sesión del Comité.» y no deja el voto (r2-fix3-N3). |

## Correr en local

Hace falta un Postgres local desechable (nunca `plataforma` ni una base compartida) y el Chromium de Playwright (`npx playwright install chromium`).

```sh
E2E_ADMIN_URL=postgres://<usuario>@127.0.0.1:<puerto>/postgres npm run test:e2e
npm run test:e2e -- tests/e2e/nomina.spec.ts   # un solo spec
npm run test:e2e:2                              # solo la parte 2 de 6, como en CI
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

`turbo.json` declara seis tareas, de `test:e2e:1` a `test:e2e:6`, con las etiquetas `ci` y `ci:cpus:4`. Vercel CI las corre en cada push en paralelo, cada una en su propia máquina, junto con typecheck, lint, test, test:db, build y security. Cada parte corre `playwright test --shard=N/6` con su propio build, su propio Postgres y su propio `next start`, y el tope de 12 minutos se mide por parte. En CI:

- Postgres corre en un contenedor `postgres:17` (puerto 5553, el mismo dentro y fuera).
- Chromium corre en la imagen oficial `mcr.microsoft.com/playwright:v<versión>-noble` con `playwright run-server` y red del anfitrión. La imagen de la tarea no trae las bibliotecas del navegador. El corredor, la siembra, el emulador y `next start` siguen en la máquina de la tarea.
- `retries: 0`, sin video, con traza sin capturas y sin capturas de evidencia.
- Playwright reparte las partes por grupo y por número de pruebas, no por tiempo: un spec sin `mode: "parallel"` es un solo grupo (los `describe` seriales de adentro viajan juntos), y un grupo va entero a la parte donde empieza. `operacion.spec.ts` es `parallel` solo para partirse en nueve `describe` seriales; su orden decide el reparto (lo explica el comentario de arriba del archivo). Con 87 pruebas en seis partes quedan 17, 15, 15, 13, 21 y 6 (`--list --shard=N/6`). El orden sale de los tiempos de pruebas del CI, no de los locales: en el CI las de Operación tardan unas 6 veces más. Antecedentes:
  - Con tres partes y Duna en la 1, esa parte tardó 554 s, con 470 s de pruebas, contra 202 y 301 de las otras dos.
  - Con cuatro, el CI de `d2d56df` dio 444, 352, 351 y 289 s, con 360, 276, 264 y 222 s de pruebas y de 57 a 74 s fijos por parte. La parte 1 llevaba los 5 specs anteriores a `operacion.spec.ts`, 17 pruebas que tardaron 318 s.
  - Con cinco y coincidencias junto a pagos-proveedores en la parte 4, el CI de `0dc1a7a` dio 316, 226, 241, 473 y 168 s. La 4 tuvo 343 s de pruebas: pagos-proveedores tardó 170 s (87 a 99 en las corridas anteriores) y coincidencias, 121 s (80 a 104). Son los dos grupos que más varían, y ahora van en partes distintas.
  - El reparto se evalúa con el tiempo máximo observado de cada grupo, no con el promedio. Con el orden de hoy, el modelo da 263, 266, 264, 270 y 113 s de pruebas con los máximos, y 223, 250, 210, 183 y 108 con los típicos.
  - Con PLD (#61), `pld.spec.ts` suma un grupo indivisible de 18 pruebas: con cinco partes caía entero junto a pagos-proveedores y el modelo de máximos daba 396 s de pruebas en esa parte (≈ 529 s de tarea). Con seis quedan 17, 15, 15, 13, 21 y 6 pruebas, y el modelo de máximos da 287, 232, 278, 280, 226 y 31 s de pruebas (≈ 420 s la peor, con 88 s fijos y 45 de cierre).
  - Si una parte se acerca a los 450 s, mueve un grupo de `operacion.spec.ts` o agrega otra parte (`test:e2e:7` y `--shard=N/7` en todas).
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
5. Cada spec debe pasar solo y dentro de la suite completa, en cualquier orden. Si necesitas una persona nueva, agrégala en `siembra.ts` (`CORREOS`) y no reuses la de otro spec para algo que la cambie, como su factor, su contraseña o su tope. Si las pruebas de un archivo dependen entre sí, usa `test.describe.configure({ mode: "serial" })`. Si el archivo se parte en grupos (`parallel` con `describe` seriales, como `operacion.spec.ts`), cada grupo debe pasar solo, con la siembra recién hecha: es lo que corre su parte. Pruébalo con las seis partes (de `npm run test:e2e:1` a `:6`), no solo con la suite completa.
6. Corre la suite completa tres veces seguidas antes de abrir el PR. Una prueba que falla a veces se arregla en su causa: no hay reintentos.

## Revisar la semilla de Pagos a mano

`npm run test:e2e:reset` borra y recrea una base persistente (`lever_pagos_dev`, o la de `E2E_BASE_DATOS`) con la misma semilla, para abrirla con `npm start` y navegarla sin la suite. Usa `E2E_ADMIN_URL` sin base (por omisión, el usuario del sistema en `127.0.0.1:55432`).
