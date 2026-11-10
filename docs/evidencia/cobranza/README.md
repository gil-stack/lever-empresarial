# Evidencia funcional: cobranza

Doce flujos clicados con Playwright contra `next build` + `next start`, sobre una base recién migrada (`0001`–`0031`) y sembrada en cada corrida. Es el mismo spec que corre en CI (`tests/e2e/cobranza.spec.ts`); con `E2E_CAPTURAS` además guarda estas capturas y corre la matriz de temas, anchos, axe y desborde (flujo 12). Cada paso es una aserción: un botón que no se clicó no cuenta.

Resultado de la última corrida (2026-11-10):

| Navegador | Origen | Resultado |
|---|---|---|
| Chromium 156 (Playwright 1.64.1) | `http://localhost:3181` | 12 de 12 |
| WebKit 27.2 (Playwright 1.64.1) | `https://localhost:3182` → `3181` | 12 de 12, dos corridas seguidas |
| Suite e2e completa (Chromium, como CI) | `http://localhost:3182` | 45 pasan, 1 omitida (la matriz de evidencia, que solo corre con `E2E_CAPTURAS`) |

## Entorno

| Pieza | Valor |
|---|---|
| Base | Postgres 17.9 (Homebrew) en `127.0.0.1:5581`. `tests/e2e/global-setup.ts` crea una base con nombre aleatorio, aplica todas las migraciones, siembra y la borra al terminar |
| Servidor | `E2E_SERVER_ACTIONS=1 next build` y `next start -p 3181` (Next 16.4.4, Node 26.7) |
| Blob | Emulador local en `127.0.0.1:4881` (`tests/e2e/blob-local`) |
| Correo | Proveedor falso (`tests/e2e/correo-local`): intercepta solo `POST https://api.resend.com/emails` y anota cada mensaje. Todos los destinatarios de cobranza son `@ejemplo.mx` |
| Tarea diaria | `CRON_SECRET` aleatorio por corrida (`tests/e2e/entorno.ts`) |
| Fintoc | Sin `FINTOC_*`: la empresa real ve «Detección automática: disponible pronto» |
| Siembra | `tests/e2e/siembra-cobranza.ts`: «Cobranza E2E» (real, RFC CEE200101AB1, Carla como administradora) y «Demo Cobranza E2E» (demostración, Darío). No tocan Altamar, así los totales del flujo de caja no cambian. El contador es Diego, de Altamar |
| Estados de cuenta | Los tres archivos ficticios de `tests/cobranza/fixtures/estados/` (BBVA CSV en Windows-1252 con `;`, Banorte CSV UTF-8 con BOM, Santander XLSX) |

### Por qué WebKit va por https

WebKit no manda la cookie `__Host-sesion` (Secure) por `http://localhost`. Desviarla con `page.route` funciona para casi todo, pero WebKit no entrega el contenido de los archivos a la intercepción: el pago con comprobante llegaba sin el PDF. Con un origen https local (`scripts/evidencia/https-local.mjs`, certificado autofirmado de un día fuera del repositorio) WebKit manda la cookie sola y nada se intercepta. El proxy solo escucha en 127.0.0.1 y no cambia el `Host`, así que el origen de las acciones de servidor coincide.

WebKit anota como `pageerror` cada precarga RSC de un enlace que se corta al navegar («…`?_rsc=`… due to access control checks»), aunque no haya CORS de por medio; Chromium no anota nada. El spec descarta solo esa firma exacta y solo en WebKit; cualquier otro error de consola o de página hace fallar el flujo.

## Flujos

Capturas `chromium-NN-…` y `webkit-NN-…` (mismo número en los dos navegadores).

| # | Flujo (clics) | Captura | Qué verifica en la base |
|---|---|---|---|
| 1 | Configurar dónde se recibe: «Configurar la cobranza», CLABE, beneficiario y contacto, «Guardar la configuración» con doble clic | `01-sin-configurar`, `02-configuracion` | Un solo envío; 1 fila en `collection_settings` con la CLABE; 1 evento `configurar_cobranza`; un correo de aviso a administración sin la CLABE completa |
| 2 | Alta fijo mensual ($10,000.00) con doble clic → ficha con «Quedó asentado» y calendario de 12 fechas. Página del pagador sin sesión desde el enlace del correo: monto, CLABE y referencia; «No quiero recibir recordatorios». De vuelta en la ficha, «Encender recordatorios» | `03-ficha-recien-dado-de-alta`, `04-pagador`, `05-pagador-sin-recordatorios` | 1 cliente, 1 plan mensual fijo, 1 cargo emitido de 1,000,000 centavos, 1 correo de cobro `enviado`, 1 evento `alta_cliente_cobranza`; el correo trae la CLABE, la referencia del cargo y el contacto de la empresa; tras el pagador, `recordatorios = false` con `recordatorios_por = 'pagador'` y un correo a la empresa; al encenderlos, 2 eventos `recordatorios_cliente_cobranza` |
| 3 | Alta variable trimestral: el cargo queda «Sin monto» y sin correo; «Capturar monto» $7,250.00 → «Emitir el cargo». Alta anual ($4,500.00) | `06-variable-emitido` | Cargo `por_emitir` sin correo; después `emitido` con 725,000 centavos y un correo al cliente; el anual con su cargo emitido de 450,000 |
| 4 | Lista: resumen, tramos de antigüedad que filtran («Por vencer», «1 a 30 días», «Quitar el filtro»), búsqueda, pestañas Clientes y Por conciliar | `07-lista`, `08-lista-clientes` | Por cobrar = 2,175,000 centavos (suma de los tres cargos), vencido 0; 3 cargos, 1 al buscar «Gamma», 3 clientes, nada por conciliar |
| 5 | Pago a mano desde la lista: «Registrar pago» con clave de rastreo y PDF, doble clic; en la ficha, «Comprobante» se descarga | `09-pago-con-comprobante` | 1 pago `manual` `aplicado` con su rastreo y documento; el cargo `pagado`; 1 evento `registrar_pago_cobranza`; el archivo descargado es byte a byte el PDF subido y deja 1 evento `descargar_documento` |
| 6 | Estado de cuenta: BBVA (los títulos no se reconocen: se elige el renglón 4 y las columnas a mano), Banorte (títulos reconocidos; el abono con fórmula se marca «No es de un cliente»), Santander XLSX; «Confirmar la importación» en cada uno; volver a subir el de BBVA | `10-empatar-bbva`, `11-propuestas-bbva`, `12-propuestas-santander`, `13-resubir-sin-duplicar` | BBVA: 2 abonos nuevos, $7,250.00 «aplicar» (referencia en el concepto) y $3,333.33 «por conciliar»; tras confirmar, el cargo de Despacho Beta `pagado`. Banorte: $4,500.00 aplicado (Clínica Gamma `pagado`) y el renglón con `'=HYPERLINK…` guardado como texto y `descartado`. Santander: el depósito de $10,000.00 con la clave de rastreo del pago a mano queda «ya estaba registrado» y sigue habiendo 1 solo pago con ese rastreo. Al resubir: «Este archivo ya estaba importado», mismas filas y mismos pagos; 3 empates guardados (uno por banco) y 3 eventos `confirmar_estado_cuenta` |
| 7 | «Cargo único» de $3,333.33 a Colegio Alfa; en «Por conciliar» el pago de BBVA ya propone ese cargo → «Aplicar»; en la ficha, «Revertir» con motivo; «Registrar un pago sin cargo» de $500 y «Anular» con motivo | `14-por-conciliar` | El cargo único `pagado` tras aplicar y `emitido` tras revertir; el pago vuelve a `abierto`; el pago de $500 `anulado` con 1 evento `anular_pago_cobranza` |
| 8 | Plan anual: «Pausar», «Reanudar desde hoy», «Editar plan» a $4,800.00, «Cancelar plan» con motivo | `15-plan-cancelado` | Plan con 480,000 centavos; un evento de cada uno: `pausar_plan_cobranza`, `reanudar_plan_cobranza`, `editar_plan_cobranza`, `cancelar_plan_cobranza`; la ficha dice «Sin plan vivo.» |
| 9 | Tarea diaria por HTTP como el cron de Vercel | (sin pantalla) | Sin secreto y con otro secreto: 401. Con `Bearer CRON_SECRET` dos veces: 200, la segunda con 0 cargos y 0 correos, y el número de correos en `collection_emails` no cambia |
| 10 | Empresa de demostración: configurar, alta y «Simular abono» | `16-demostracion` | La ficha dice que el correo quedó simulado y no salió ningún correo al cliente; 1 pago `demo` `aplicado` y el cargo `pagado` |
| 11 | El contador abre Cobranza y el alta, y escribe la dirección de un cliente de otra empresa | (sin captura) | Ve «Tu rol puede ver la cobranza…», sin «Nuevo cliente» ni formularios; el alta no tiene formulario; el cliente de otra empresa da 404 |
| 12 | Matriz: lista, ficha, alta, estado de cuenta, configuración y página del pagador en claro, oscuro y Lever, a 1440 y 390 | `tema-<tema>-<ancho>-<página>` (de Chromium) | Cada página responde 200; sin desplazamiento horizontal; axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sin violaciones en Chromium y en WebKit. Se excluye solo el enlace del logotipo del marco compartido (ver abajo) |

## Comando de Fintoc del personal

`scripts/cobranza-fintoc.ts cuenta:registrar` contra una base nueva en 5581 con las migraciones `0001`–`0031`, la app conectada como `plataforma_app`, una empresa real y una de demostración dadas de alta con los servicios. El id `acc_…` es inventado para la prueba (no viene de la documentación de Fintoc).

| Caso | Salida | En la base |
|---|---|---|
| Empresa real, `acc_PruebaReal0001` | «La cuenta de Fintoc quedó registrada…», código 0 | 1 fila en `collection_provider_accounts` (fintoc, `acc_PruebaReal0001`) y el evento `cuenta_proveedor_cobranza` con actor `personal`, superficie `sofipo`, origen `comando` |
| La misma otra vez | Igual, código 0 | Sigue 1 fila; queda un segundo evento (cada corrida del comando se anota) |
| Empresa de demostración | «No se hizo: solo_empresas_reales», código 1 | Nada |
| Id sin la forma `acc_…` | «No se hizo: entrada_invalida», código 1 | Nada |
| Correo que no es del personal | «No se hizo: no_es_operador», código 1 | Nada |

## Lo que encontró la validación y se corrigió en este PR

- La ficha del cliente caía en «No se pudo abrir esta página»: las acciones de la cabecera (editar, recordatorios, archivar) estaban fuera de su contenedor de avisos.
- Al confirmar una importación el aviso «La importación quedó confirmada…» desaparecía junto con el botón; ahora queda visible.
- La ficha desbordaba 20 px a 1440 y 75 px a 390 por la fecha larga en la métrica «Próximo vencimiento».
- A 390 px el título de la lista se cortaba a «C» con dos botones en la barra; la configuración se abre desde la línea de detección.
- Los radios «Recurrente fijo / Variable» salían del tamaño de un campo de texto; el texto del calendario terminaba en «..»; espaciados de la detección y de la importación; fechas que se partían en dos renglones; el historial repetía «Saldo del pago actualizado» en cada abono.

## Hallazgos fuera de cobranza

- **Logotipo del marco compartido (WCAG 2.5.3, todas las páginas).** El enlace del logotipo lleva un `aria-label` que no contiene su texto visible (`label-content-name-mismatch`). Lo corrige el PR #60 (Ola 2b) en `logotipo.tsx`, `marco.tsx` y `marco-arco.tsx`; aquí no se toca y la revisión de axe excluye solo ese enlace. Al integrar #60 se quita la exclusión.
- **`test:db`: dos pruebas fallan en `main` desde el 2026-11-10** (`tests/flujo/flujo-postgres.test.ts` y `tests/personas/colaboradores-postgres.test.ts`, `invitacion_vencida`): emiten la invitación con un reloj fijo de principios de noviembre y la base la vence con su propio reloj. Lo corrige el PR #59 (emite con la hora real). La prueba de cobranza en Postgres pasa.

## Repetir

```sh
# Postgres desechable en 5581 (nunca la base plataforma de nadie)
E2E_ADMIN_URL=postgres://postgres@127.0.0.1:5581/postgres E2E_PUERTO=3181 E2E_BLOB_PUERTO=4881 \
  E2E_CAPTURAS=docs/evidencia/cobranza npx playwright test tests/e2e/cobranza.spec.ts --browser=chromium

# WebKit: certificado de un día fuera del repositorio y el origen https local
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost -keyout <fuera>/llave.pem -out <fuera>/cert.pem
LLAVE=<fuera>/llave.pem CERT=<fuera>/cert.pem DESDE=3182 HACIA=3181 node scripts/evidencia/https-local.mjs &
E2E_BASE_URL=https://localhost:3182 E2E_ADMIN_URL=postgres://postgres@127.0.0.1:5581/postgres E2E_PUERTO=3181 \
  E2E_BLOB_PUERTO=4881 E2E_CAPTURAS=docs/evidencia/cobranza npx playwright test tests/e2e/cobranza.spec.ts --browser=webkit
```

Antes de cada corrida: `E2E_SERVER_ACTIONS=1 npx next build`. Al terminar se apagan el proxy y los puertos 3181, 3182 y 4881.
