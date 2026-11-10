# Evidencia funcional: runway y alertas de caja

Los 10 flujos del runway, clicados con Playwright contra `next build` + `next start`, sobre una base recién migrada y sembrada. Las aserciones de base van dentro de cada flujo: si una falla, la prueba se detiene. Son `tests/e2e/runway.spec.ts`, que también corre en CI en la parte que le toca de `test:e2e`.

- Ronda r64 (2026-11-10, con el #63 y `main` integrados): Chromium 11 de 11 y WebKit 11 de 11, con capturas (la 10 es la matriz de temas, que solo corre con capturas).

La salida literal de las tres corridas está en [corridas.txt](corridas.txt). El rendimiento (p95 de la página por HTTP y la tarea con 1,000 empresas, con EXPLAIN) está en [rendimiento.md](rendimiento.md).

## Entorno

| Pieza | Valor |
|---|---|
| Base | Postgres 17.9 local (Homebrew) en `127.0.0.1:5583`. Cada corrida crea una base desechable, aplica `0001`–`0032` y la borra al final. La app entra como `plataforma_app` |
| Servidor | `next build` y `next start -p 3183` (Next 16.4.4), Node 26.7, `NODE_ENV=production` |
| Navegadores | Playwright 1.64.1, Chromium y WebKit headless, 1440×1000. En la matriz de temas, 1440×1000 y 390×844 |
| Fecha | La del día de la corrida en hora de México (2026-11-10). La siembra pone las fechas relativas a ese día |
| Consola del navegador | Cada flujo vigila `console.error`, `console.warning` y `pageerror`, y falla con cualquiera. En WebKit se descarta solo la firma de las precargas RSC cortadas al navegar (ver `tests/e2e/cobranza.spec.ts`) |

Lo que no es de producción:

- **Correo falso.** `tests/e2e/correo-local/preload.mjs` se carga en `next start` con `--import`. Intercepta solo `POST https://api.resend.com/emails`, anota cada mensaje en un archivo de la corrida y responde lo mismo ante la misma llave de idempotencia, como Resend. Las aserciones de destinatarios, asunto y llave leen ese archivo.
- **Vercel Blob emulado** en `127.0.0.1:4883`. El runway no lo usa; lo pide el resto de la siembra de la e2e.
- **Sesiones.** `sesionDe` abre la sesión de cada persona insertando la entrada y la sesión como dueño de la base desechable. Todo lo que cambia datos pasa por clics.
- **La tarea.** El cron de Vercel no corre en local. La prueba llama a `GET /tareas/caja` con `Authorization: Bearer <CRON_SECRET>`, como lo hace Vercel. El secreto es aleatorio por corrida.
- **WebKit por https.** WebKit no manda la cookie `__Host-sesion` (Secure) por `http://localhost`. La corrida de WebKit va por `https://localhost:3184`: `scripts/evidencia/https-local.mjs` con un certificado autofirmado de un día, fuera del repositorio. El proxy escucha solo en 127.0.0.1 y no cambia el `Host`, así que el origen de las acciones de servidor coincide. Nada se intercepta.
- **Dos fotos de semanas pasadas.** La tendencia necesita fotos de lunes anteriores y la prueba no puede esperar dos lunes. El flujo 6 inserta como dueño, con `session_replication_role = replica` (la base solo admite la foto de esta semana o de la anterior, r64-base-N2), las fotos de hace 7 y 14 días, cada una con su evento `foto_runway` en la bitácora, como las deja la tarea. La foto de esta semana sí la toma la tarea, en el flujo 2.
- **La baja de Noé** (flujo 11) también la hace la dueña con `replica`: es preparación de datos; lo que se valida es lo que cada persona ve.

### Datos sembrados (`tests/e2e/siembra-runway.ts`)

| Empresa | Tipo | Qué tiene |
|---|---|---|
| Runway E2E (RUE200101AB1) | Real | Rita (administración), Fabio (tarjetahabiente y finanzas), Cora (contadora, no enciende los avisos) y Tito (tarjetahabiente, no ve el flujo). Saldo declarado ayer: $400,000.00. Nómina mensual de dos personas, $40,000.00 cada una. Renta de $30,000.00 al mes. Cobro esperado de $60,000.00 en 25 días y uno de $10,000.00 cobrado hoy. Pago a Insumos del Bajío (IB-77) de $50,000.00, sin solicitud, en 20 días. Cobranza: un plan fijo de $25,000.00 al mes (su primer cargo emitido), un plan variable con un cargo capturado de $18,000.00 y «Plan Nuevo SA», variable y sin historial |
| Sin Saldo Runway E2E (SSR200101AB2) | Real | Sergio (administración), sin saldo declarado |
| Demo Runway E2E (DRE200101AB3) | Demostración | Dora (administración). Saldo de $250,000.00 y renta de $100,000.00 al mes |

Las empresas, las personas, el saldo, los cobros, la renta y los planes pasan por los servicios de la aplicación, con su bitácora. El proveedor y su cargo se escriben como dueño, con el evento que exige cada trigger, igual que `tests/e2e/siembra.ts`.

## Flujos

Las capturas tienen el mismo número en los dos navegadores: `chromium-NN-…` y `webkit-NN-…`.

| # | Flujo | Quién | Qué se clicó y qué se vio | Qué verifica en la base | Captura |
|---|---|---|---|---|---|
| 1 | Runway a 12 meses con cada tipo de movimiento | Rita | Saldo y alertas muestra el runway conservador (entre 3 y 5 meses) y el esperado, que es mayor. El resumen de 12 meses suma por tipo: nómina $960,000.00, proveedor $50,000.00, renta $360,000.00, cobros $103,000.00 (esperado más los dos cargos emitidos), cobrado $10,000.00, plan fijo $275,000.00 y plan variable $198,000.00. Los dos planes van marcados como estimado. «Plan Nuevo SA» aparece en la lista de planes sin historial. La tabla tiene 12 meses. Inicio dice el mismo runway conservador | Cada cierre mensual se recalcula en la prueba desde el saldo de `cash_balance_declarations`: cierre anterior + entradas − salidas, y el esperado suma además lo estimado. Tienen que coincidir al centavo los 12 meses | [01 Chromium](chromium-01-runway-12-meses.jpg) · [01 WebKit](webkit-01-runway-12-meses.jpg) |
| 2 | Un pago grande cruza el colchón y manda un solo correo | Rita | Con una sola foto, la tendencia dice «aparece desde la segunda foto semanal» y no muestra cifras de ejemplo. En Calendario se registra el «Impuesto anual» de $300,000.00 con doble clic (un solo envío). Saldo y alertas pasa a «debajo del colchón» antes de la tarea. Tras la tarea, la página dice «Último aviso: … colchón y runway · enviado.» | Antes de la tarea, `cash_alert_states` no tiene fila. Después: `bajo_colchon` y `runway_bajo` encendidas, un `cash_alerts` en `enviado` con 2 destinatarios y las dos condiciones, 2 `cash_alert_deliveries`, la foto de la semana en `cash_runway_snapshots` y 1 evento `estado_alerta_caja`. Sale un correo a Rita y uno a Fabio, ninguno a Cora. El asunto es «Aviso de caja: debajo del colchón y runway corto · Runway E2E» y la llave, `alerta-caja/<aviso>/<persona>` | [02 Chromium](chromium-02-aviso-enviado.jpg) · [02 WebKit](webkit-02-aviso-enviado.jpg) |
| 3 | La tarea dos veces y dos a la vez | Cron | Sin secreto y con un secreto equivocado, la ruta responde 401. Después corre una vez, y luego dos a la vez | Las tres corridas devuelven 0 fotos y 0 correos. El archivo de correos no crece. Sigue habiendo 1 `cash_alerts` y 1 foto | Sin pantalla: es la ruta del cron. La 02 muestra el estado que se conserva |
| 4 | Sube, vuelve a cruzar y avisa otra vez, una sola vez | Rita | En Calendario se desactiva el impuesto, con su diálogo y doble clic (un envío). Tras la tarea, Saldo y alertas vuelve a «ok», sin correo. Se registra el impuesto otra vez y la tarea corre dos veces | Al subir, las dos banderas quedan apagadas y Rita no recibe correo. Al volver a cruzar, las dos se encienden, hay 2 `cash_alerts` en total y Rita recibe un solo correo más. Quedan 3 eventos `estado_alerta_caja`: encender, apagar y encender | [03 Chromium](chromium-03-aviso-otra-vez.jpg) · [03 WebKit](webkit-03-aviso-otra-vez.jpg) |
| 5 | Mínimo de meses con rechazo, con JavaScript y sin él | Rita | Empieza en 3, marcado «sugerido». Con JavaScript, 15 se rechaza con «Escribe un número entero de meses, de 1 a 12.»: el campo queda marcado (`aria-invalid`), con el foco y conserva lo escrito. Sin JavaScript, «dos» se rechaza igual y la página regresa con lo escrito. Sin JavaScript, 5 se guarda. Con JavaScript y doble clic, 4 se guarda con un solo envío y «sugerido» desaparece | Tras los rechazos, `cash_runway_settings` no tiene fila. Después queda 5 y luego 4, con 2 eventos `configurar_runway` | [04 con JS](chromium-04-minimo-rechazo-js.jpg) · [05 sin JS](chromium-05-minimo-rechazo-sin-js.jpg) · WebKit [04](webkit-04-minimo-rechazo-js.jpg) · [05](webkit-05-minimo-rechazo-sin-js.jpg) |
| 6 | Tendencia después de 3 fotos | Rita | La gráfica tiene 3 barras, la línea del mínimo y la leyenda «Tu mínimo: 4 meses». Su descripción para lector de pantalla dice «últimas 3 semanas: de 6.8 meses … Mínimo: 4 meses.» «Ver los datos en tabla» abre la tabla equivalente con 3 semanas | 3 filas en `cash_runway_snapshots`: dos insertadas con su evento y la de la tarea | [06 Chromium](chromium-06-tendencia.jpg) · [06 WebKit](webkit-06-tendencia.jpg) |
| 7 | Empresa sin saldo declarado | Sergio | La cifra dice «Sin saldo declarado» y el texto, «Sin saldo declarado no hay runway.» El estado de las alertas es «sin saldo» y la tabla de meses cierra en «Sin saldo». Inicio dice lo mismo | Tras la tarea, la empresa no tiene fila en `cash_alert_states` ni fotos: la tarea solo toma empresas con saldo declarado | [07 Chromium](chromium-07-sin-saldo.jpg) · [07 WebKit](webkit-07-sin-saldo.jpg) |
| 8 | Real sin cifras de ejemplo; demostración con ejemplo y aviso simulado | Dora y Rita | En demostración, la tendencia lleva la insignia «Ejemplo · demostración» y 8 barras de ejemplo. Tras la tarea, la página dice «simulado: en demostración no sale correo». En la empresa real de Rita, la tendencia es la real y no aparece ni la serie de ejemplo ni la insignia | En la demo hay 1 `cash_alerts` en `simulado` y Dora no recibe ningún correo | [08 Chromium](chromium-08-demo-ejemplo.jpg) · [08 WebKit](webkit-08-demo-ejemplo.jpg) |
| 9 | Permisos | Cora, Tito, Sergio y sin sesión | Cora, contadora, ve el runway sin el formulario: «Avisa si el runway conservador baja de 4 meses.» Tito, tarjetahabiente sin permiso de flujo, recibe 404. Sergio, de otra empresa, recibe 404 en la ruta de Runway E2E. Sin sesión, la página lleva a `/entrar` | La base vuelve a exigir el permiso: `cash_runway_settings` solo lo escribe `flujo_editor`, y las tablas de la tarea solo el sistema. Lo prueba `tests/flujo/runway-postgres.test.ts` | [09 Chromium](chromium-09-contadora-solo-lectura.jpg) · [09 WebKit](webkit-09-contadora-solo-lectura.jpg) |
| 11 | Nómina de una sola persona (r64-N3) | Cora y Rita | Como dueña de la base se da de baja a Noé (ayer): la nómina queda de una sola persona. Cora (contadora, sin detalle de nómina) ve en cada mes de «Mes por mes» «· incluye nómina reservada» junto al total de salidas, y en el resumen la nómina dice «Monto reservado» sin `data-centavos`; el monto de Nora ($480,000.00) no aparece en la página. Rita (administración, con detalle) no ve ninguna marca y el resumen trae el monto | `employees.baja_en` de Noé = ayer | [10 Chromium](chromium-10-nomina-reservada-contadora.jpg) · [10 WebKit](webkit-10-nomina-reservada-contadora.jpg) |

### Temas, anchos y accesibilidad (prueba 10)

Cuatro páginas, en los 3 temas (claro, oscuro y Lever) y en 1440 y 390 de ancho:

- Saldo y alertas de Runway E2E (`flujo`);
- Inicio de Runway E2E (`inicio`);
- Saldo y alertas de la demostración (`demo`);
- Saldo y alertas sin saldo declarado (`sin-saldo`).

Pasa en los dos navegadores:

- axe-core con las reglas WCAG 2.0 y 2.1 A y AA: sin violaciones;
- sin desplazamiento horizontal en ninguna de las 24 combinaciones.

Se excluye solo el enlace del logotipo del marco compartido (WCAG 2.5.3), que corrige el PR #60.

Las capturas son de Chromium: `tema-<tema>-<ancho>-<página>.jpg`. Por ejemplo, [claro 1440](tema-claro-1440-flujo.jpg), [oscuro 390](tema-oscuro-390-flujo.jpg) y [Lever 1440, demo](tema-lever-1440-demo.jpg).

En 390, los dos cierres de cada mes van primero. La tabla de meses y la del historial son regiones con foco (`role="region"`, `tabIndex=0` y su título), así que se desplazan con el teclado. axe lo exigía (`scrollable-region-focusable`).

## Ronda r64: hallazgo → arreglo → prueba

Revisión: `revision-64.md` y `hallazgos-64-para-6a.md` (head `504e9bc`). Antes de la ronda se integró el #63 (`47d4c34`) con merge. Cada arreglo tiene una prueba que cae si se revierte solo ese arreglo: los de base con `scripts/evidencia/runway/mutaciones.sh` (AR1-AR13) y los de servidor con `rojo-por-arreglo.sh` (N1-N3); resultados en `scripts/evidencia/runway/resultados-*.txt`.

| Hallazgo | Arreglo | Prueba | Rojo con el arreglo revertido |
|---|---|---|---|
| **r64-base-N4 (P1)** suspendida sin bloqueo si la 0028 entra antes | `DO` condicional al final de la 0032 | `tests/esquema/empresa-suspendida.test.ts` en los órdenes A, B y C, con la escritura de una suspendida en `cash_alert_states` | AR13 |
| r64-base-N3 sin llave propia del aviso de un cruce | `cruces_colchon`/`cruces_runway` en el estado (los calcula la base desde OLD), `cruce_colchon`/`cruce_runway` en el aviso, `CHECK` y un UNIQUE parcial por condición; `alerta_sin_cruce` | `runway-reglas-base.test.ts`: contadores que ignoran al cliente, número del cruce, segundo aviso → 23505, sin cruce, inmutable, dos conexiones sin candado → la segunda choca, y la tarea real (apagar, cruzar, dos a la vez y otra) → 1 aviso | AR8-AR12 |
| r64-base-N2 fechas del cliente | La base pone `actualizado_en`, `detectado_en`, `intentado_en`, `terminado_en` y `tomada_en`; la semana de la foto es la de `caja_hoy()` (hoy en México) o la anterior | `runway-reglas-base.test.ts` manda 2020/2001 y ve la hora real; semanas futura, de hace dos y de 2001 → `foto_fuera_de_semana` | AR2-AR7 |
| r64-base-N5 la prueba no protegía la base | `runway-reglas-base.test.ts` (Y1-Y19 de la sonda del revisor) | 19 mutaciones: 16 de 16 no equivalentes caen por aserción propia. MV16 es equivalente (sin grant de UPDATE); MV8 y MV18 ahora también, porque N2 solo admite lunes y la base sella `terminado_en` | — |
| r65-N1 en la 0032 | `public, pg_temp` en las 3 definers | Una tabla temporal `cash_balance_declarations` de la tarea no cuela a Beta en la puerta | AR1 |
| r64-N1 «tu dinero alcanza No alcanza…» | `fraseRunwayDelAviso`: la frase completa de cada caso | `tests/flujo/alertas-caja.test.ts` con el texto exacto de cada variante; `runway-postgres` | N1 |
| r64-N2 tabla y resumen con periodos distintos | El resumen cuenta los mismos 12 meses calendario que la tabla | `runway.test.ts` compara las sumas con un pago entre el 1 y el 10 del mes 13 | N2 |
| r64-N3 el mes con nómina de una persona no decía «reservado» | `nominaReservada` por mes, sin permiso de detalle; la fila dice «· incluye nómina reservada» | `runway.test.ts` y la e2e 11 en los dos navegadores | N3 |

**`caja_hoy()` y las pruebas con fecha fija.** La base usa el reloj real (como el resto del repositorio). `tests/flujo/runway-postgres.test.ts` y `runway-reglas-base.test.ts` corren con fechas fijas: como dueñas de su base desechable reemplazan `caja_hoy()` por su fecha, así no se vuelven una bomba de tiempo como el `invitacion_vencida` heredado. La aplicación no puede reemplazarla (no es dueña) y la llama con esquema. `runway-reglas-base` revisa primero que la de producción dé la fecha real de México.

**Gráfica de tendencia (pendiente del revisor de servidor).** La prueba 10 recorre Saldo y alertas con la tendencia de 3 fotos en los 3 temas, a 1440 y a 390: axe sin violaciones y sin desplazamiento horizontal, en Chromium y en WebKit; la tabla equivalente se abre en el flujo 6.

**Gates de la ronda** (en local, este turno, con el #63 y `main` con el #59 integrados): typecheck, lint, build y security en verde; test 590/590; test:db 86/86 (89/89 después de integrar el #63 con `main` y el #65: `definer-search-path` cubre las 3 definers de la 0032; la sonda de `pg_temp` comprueba primero el 42501 de la 0029 y presta el permiso temporal a `plataforma_tarea` solo para ella; AR1 la tumba a ella y a `definer-search-path`); e2e en sus 5 partes 22 + 15 + 24 + 15 + 17 = 93 y 2 omitidas (las matrices de evidencia); recorrido Chromium 11/11 y WebKit 11/11 (capturas regeneradas después del merge, con el `Referrer-Policy: same-origin` global en el flujo 5 sin JavaScript).

## Hallazgo: formularios sin JavaScript y `Referrer-Policy: no-referrer`

La primera corrida sin JavaScript del flujo 5 terminó en «Internal Server Error». El registro de `next start` decía que `x-forwarded-host` no coincidía con el encabezado `origin`, que llegaba con valor `null`.

La causa es la política global `Referrer-Policy: no-referrer`. Con ella, el navegador manda `Origin: null` en el envío nativo del formulario, y Next rechaza la acción de servidor, que es lo correcto: un origen opaco nunca se acepta.

La página de Saldo y alertas declaró `referrer: "same-origin"` en su metadata mientras tanto. **Con el #59 en `main`, el encabezado global es `Referrer-Policy: same-origin` y la página ya no lo declara** (se quitó al integrar). El envío a la propia aplicación lleva su origen y a otros sitios no sale nada. Así funciona sin JavaScript, como prueba el flujo 5 en los dos navegadores.

El mismo problema afecta a todos los formularios de la aplicación que se envían sin JavaScript. El encabezado global vive fuera de este cambio, así que se le reportó al líder.

## Rendimiento

La salida literal y el EXPLAIN están en [rendimiento.md](rendimiento.md), medidos otra vez en la ronda r64 (con el contador de cruces y las fechas que pone la base). Se midió con Postgres local, sin la latencia de red de Neon, así que el tiempo de base es un piso.

| Medición | Resultado | Meta del RFC |
|---|---|---|
| `GET /consola/flujo` por HTTP con `next start`, HTML completo. Volumen: nómina de 200 personas, 1,000 cuentas por pagar, 1,000 cargos de cobranza en 50 planes y 12 fotos | p50 31.5 ms · p95 37.1 ms · p99 39.8 ms | p95 < 400 ms |
| Sentencia del runway (fuentes y planes en una sola), como `plataforma_cliente` con RLS | 3.7 ms. Todas las tablas grandes entran por índice: `collection_charges_periodo_unico`, `collection_charges_agenda`, `supplier_payables_proveedor_idx` y `recurring_obligations_empresa` | Índices de 0026 y 0031, sin índices nuevos |
| Tarea con 1,000 empresas, primera corrida de la semana: 1,000 fotos, 500 avisos y 500 correos, sin pendientes ni fallos | 100.0 s, de los 240 s de presupuesto. El tope es el ritmo de correo (500 × 200 ms), no la base | Cabe en una corrida |
| Tarea con 1,000 empresas, 15 minutos después y sin cambios | 1.6 s, con 0 filas nuevas en la bitácora | Sin cambios no escribe |

La mitad de las empresas cruzando a la vez es el peor caso del ritmo de correo, no un día normal. El ritmo es por correo, no por empresa: en 240 s caben unos 1,100 correos. Lo que no quepa queda como pendiente y lo toma la siguiente corrida, 15 minutos después.

## Cómo reproducir

Necesitas un Postgres local desechable (en el ejemplo, en 5583), el build de esta rama (`npm run build`) y los puertos 3183, 3184 y 4883 libres.

```sh
# Chromium, con capturas
E2E_ADMIN_URL=postgres://postgres@127.0.0.1:5583/postgres E2E_PUERTO=3183 E2E_BLOB_PUERTO=4883 \
  E2E_CAPTURAS=docs/evidencia/runway npx playwright test tests/e2e/runway.spec.ts --browser=chromium

# WebKit por https (llave y certificado fuera del repositorio)
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost -keyout <fuera>/llave.pem -out <fuera>/cert.pem
LLAVE=<fuera>/llave.pem CERT=<fuera>/cert.pem DESDE=3184 HACIA=3183 node scripts/evidencia/https-local.mjs &
E2E_BASE_URL=https://localhost:3184 E2E_ADMIN_URL=postgres://postgres@127.0.0.1:5583/postgres E2E_PUERTO=3183 \
  E2E_BLOB_PUERTO=4883 E2E_CAPTURAS=docs/evidencia/runway npx playwright test tests/e2e/runway.spec.ts --browser=webkit

# Rendimiento
MEDICION_ADMIN_URL=postgres://postgres@127.0.0.1:5583/postgres npx tsx scripts/evidencia/runway-medicion.ts
```

Al terminar, detén el proxy y confirma con `lsof -nP -iTCP:3183 -iTCP:3184 -iTCP:4883 -sTCP:LISTEN` que no quede nada escuchando.
