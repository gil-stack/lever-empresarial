# Evidencia funcional: cobranza

Quince flujos clicados con Playwright contra `next build` + `next start`, sobre una base recién migrada (`0001`–`0031`) y sembrada en cada corrida. Es el mismo spec que corre en CI (`tests/e2e/cobranza.spec.ts`); con `E2E_CAPTURAS` además guarda estas capturas y corre la matriz de temas, anchos, axe y desborde (flujo 12). Cada paso es una aserción: un botón que no se clicó no cuenta.

Resultado de la última corrida (2026-11-10, ronda r63):

| Navegador | Origen | Resultado |
|---|---|---|
| Chromium 156 (Playwright 1.64.1) | `http://localhost:3181` | 18 de 18 |
| WebKit 27.2 (Playwright 1.64.1) | `https://localhost:3182` → `3181` | 18 de 18, más `csp.spec` 8 de 8 |
| Suite e2e completa (Chromium, como CI, en sus 3 partes) | `http://localhost:3181` | ver «Gates» en la sección de la ronda r63 |

## Entorno

| Pieza | Valor |
|---|---|
| Base | Postgres 17.9 (Homebrew) en `127.0.0.1:5581`. `tests/e2e/global-setup.ts` crea una base con nombre aleatorio, aplica todas las migraciones, siembra y la borra al terminar |
| Servidor | `E2E_SERVER_ACTIONS=1 next build` y `next start -p 3181` (Next 16.4.4, Node 26.7) |
| Blob | Emulador local en `127.0.0.1:4881` (`tests/e2e/blob-local`) |
| Correo | Proveedor falso (`tests/e2e/correo-local`): intercepta solo `POST https://api.resend.com/emails` y anota cada mensaje. Todos los destinatarios de cobranza son `@ejemplo.mx` |
| Tarea diaria | `CRON_SECRET` aleatorio por corrida (`tests/e2e/entorno.ts`) |
| Fintoc | Sin `FINTOC_*`: la empresa real ve «Detección automática: disponible pronto» y nada sale a `api.fintoc.com`. El flujo 13 manda sus avisos firmados con un secreto generado al vuelo directo a `atenderAviso`, la misma función de `/webhooks/fintoc` |
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
| 5 | Pago a mano desde la lista: «Registrar pago» con clave de rastreo y PDF, doble clic; en la ficha, «Comprobante» se descarga | `09-pago-con-comprobante` | 1 pago `manual` `aplicado` con su rastreo y documento; el cargo `pagado`; 1 evento `registrar_pago_cobranza`; el archivo descargado es byte a byte el PDF subido y deja 1 evento `descargar_documento`. La respuesta real del comprobante, con y sin `/c/<empresa>`, trae `Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'none'` y `attachment` (r63-N5) |
| 6 | Estado de cuenta: BBVA (los títulos no se reconocen: se elige el renglón 4 y las columnas a mano), Banorte (títulos reconocidos; el abono con fórmula se marca «No es de un cliente»), Santander XLSX; «Confirmar la importación» en cada uno; volver a subir el archivo de BBVA, ahora con el banco «Banorte» | `10-empatar-bbva`, `11-propuestas-bbva`, `12-propuestas-santander`, `13-resubir-sin-duplicar` | BBVA: 2 abonos nuevos, $7,250.00 «aplicar» (referencia en el concepto) y $3,333.33 «por conciliar»; tras confirmar, el cargo de Despacho Beta `pagado`. Banorte: $4,500.00 aplicado (Clínica Gamma `pagado`) y el renglón con `'=HYPERLINK…` guardado como texto y `descartado`. Santander: el depósito de $10,000.00 con la clave de rastreo del pago a mano queda «ya estaba registrado» y sigue habiendo 1 solo pago con ese rastreo. Al resubir el mismo archivo de BBVA eligiendo Banorte: el campo dice «Ese archivo ya se importó el 10 de noviembre de 2026. Sus abonos ya están en la lista; no se volvieron a aplicar.» (r63-N1), mismas filas y mismos pagos; 3 empates guardados (uno por banco) y 3 eventos `confirmar_estado_cuenta` |
| 7 | «Cargo único» de $3,333.33 a Colegio Alfa; en «Por conciliar» el pago de BBVA ya propone ese cargo → «Aplicar»; en la ficha, «Revertir» con motivo; «Registrar un pago sin cargo» de $500 y «Anular» con motivo | `14-por-conciliar` | El cargo único `pagado` tras aplicar y `emitido` tras revertir; el pago vuelve a `abierto`; el pago de $500 `anulado` con 1 evento `anular_pago_cobranza` |
| 8 | Plan anual: «Pausar», «Reanudar desde hoy», «Editar plan» a $4,800.00, «Cancelar plan» con motivo | `15-plan-cancelado` | Plan con 480,000 centavos; un evento de cada uno: `pausar_plan_cobranza`, `reanudar_plan_cobranza`, `editar_plan_cobranza`, `cancelar_plan_cobranza`; la ficha dice «Sin plan vivo.» |
| 9 | Tarea diaria por HTTP como el cron de Vercel | (sin pantalla) | Sin secreto y con otro secreto: 401. Con `Bearer CRON_SECRET` dos veces: 200, la segunda con 0 cargos y 0 correos, y el número de correos en `collection_emails` no cambia |
| 10 | Empresa de demostración: configurar, alta y «Simular abono» | `16-demostracion` | La ficha dice que el correo quedó simulado y no salió ningún correo al cliente; 1 pago `demo` `aplicado` y el cargo `pagado` |
| 11 | El contador abre Cobranza y el alta, y escribe la dirección de un cliente de otra empresa | (sin captura) | Ve «Tu rol puede ver la cobranza…», sin «Nuevo cliente» ni formularios; el alta no tiene formulario; el cliente de otra empresa da 404 |
| 12 | Matriz: lista, ficha, alta, estado de cuenta, configuración y página del pagador en claro, oscuro y Lever, a 1440 y 390 | `tema-<tema>-<ancho>-<página>` (de Chromium) | Cada página responde 200; sin desplazamiento horizontal; axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sin violaciones en Chromium y en WebKit. Se excluye solo el enlace del logotipo del marco compartido (ver abajo) |
| 13 | Alta de «Grupo Uno» y «Filial Dos» con clics; la misma CLABE ordenante paga $300.00 con la referencia de Uno y luego $200.00 con la de Dos (dos avisos de Fintoc firmados); se abre la ficha de Dos y la de Uno | `17-pagado-desde-otro-cliente` | Los dos pagos `aplicado` a su cliente; `de_otro_cliente` falso en el de Uno y verdadero en el de Dos. La ficha de Dos muestra «Pagado desde la cuenta de otro cliente» en ese pago; la de Uno no muestra ninguna marca (r63-N4) |
| 14 | En la ficha de Grupo Uno, «Registrar pago»; el id del cargo (campo oculto) se cambia por el de un cargo de la empresa de demostración; «Registrar el pago» | `18-pago-con-cargo-ajeno` | El diálogo dice «No encontrado / Recarga la lista.», no «Ese cargo ya cambió»; el número de pagos de toda la base no cambia (r63-N10) |
| 15 | Configuración: cambiar el correo de contacto con el factor de hace 31 minutos; después, con el factor recién probado | `19-contacto-pide-factor`, `20-contacto-guardado-y-avisado` | Con el factor viejo: «Confirma que eres tú… el correo de contacto exige un segundo factor de los últimos 30 minutos», el contacto no cambia y no sale aviso. Con el factor reciente: «Avisamos del cambio a administración y finanzas», el contacto queda guardado y sale 1 aviso «Cambió el correo de contacto de cobranza…» con el correo nuevo (r63-N3) |
| 16 | «Cargo único» de $2,468.00 a Colegio Alfa; «Registrar pago» a mano de $1,234.00; estado de cuenta de BBVA con ese mismo depósito y otro igual (otro concepto); «Confirmar la importación»; en «Por conciliar», «Descartar» el primero con motivo y «Aplicar» el segundo; la ficha del cliente | `21-duplicado-propuesta`, `22-duplicado-por-conciliar`, `23-duplicado-resuelto` | Los dos renglones proponen «A Por conciliar» con «Posible duplicado: ya está registrado a mano del …». Tras confirmar: «2 en Por conciliar», el cargo con 1 sola aplicación y dos pagos `posible_duplicado` con `parecido_a` = el pago a mano; cada tarjeta dice «Parece el mismo depósito que: Registrado a mano…». El descartado queda `anulado` con 1 evento `descartar_duplicado_cobranza` que nombra el pago parecido; el aplicado deja el cargo `pagado` con 2 aplicaciones; la ficha muestra «Posible duplicado descartado» (r63b-N1) |
| 17 | Sin JavaScript: configuración, otro contacto y beneficiario, «Guardar la configuración» | `24-sin-javascript-configuracion` | El formulario es `method="post"`; la navegación es un POST y la dirección no lleva la CLABE, el beneficiario ni el contacto; se guarda y la página vuelve con «Quedó asentado» (r63b-N2) |
| 18 | CSP estricta del #62, sin JavaScript: la lista, «Por conciliar», el alta, la ficha, la configuración, el estado de cuenta y la página real del pagador (desde el enlace del correo, sin sesión) | (sin captura) | Cada una responde 200 con `script-src 'self' 'nonce-…' 'strict-dynamic'`, todas sus etiquetas `<script>` y `<style>` llevan el nonce de su respuesta y la consola no anota nada de la política. Con JavaScript las recorre `csp.spec` (todas las rutas del registro, incluidas las de cobranza) y cada prueba de este archivo vigila la consola |

## Comando de Fintoc del personal

`scripts/cobranza-fintoc.ts cuenta:registrar` contra una base nueva en 5581 con las migraciones `0001`–`0031`, la app conectada como `plataforma_app`, una empresa real y una de demostración dadas de alta con los servicios. El id `acc_…` es inventado para la prueba (no viene de la documentación de Fintoc).

| Caso | Salida | En la base |
|---|---|---|
| Empresa real, `acc_PruebaReal0001` | «La cuenta de Fintoc quedó registrada…», código 0 | 1 fila en `collection_provider_accounts` (fintoc, `acc_PruebaReal0001`) y el evento `cuenta_proveedor_cobranza` con actor `personal`, superficie `sofipo`, origen `comando` |
| La misma otra vez | Igual, código 0 | Sigue 1 fila; queda un segundo evento (cada corrida del comando se anota) |
| Empresa de demostración | «No se hizo: solo_empresas_reales», código 1 | Nada |
| Id sin la forma `acc_…` | «No se hizo: entrada_invalida», código 1 | Nada |
| Correo que no es del personal | «No se hizo: no_es_operador», código 1 | Nada |

El mismo día, `avisos:sin-destino` (r63-N7) contra otra base nueva con el personal sembrado y dos avisos guardados con `cobranza_guardar_aviso_sin_destino` (salida completa en `scripts/evidencia/cobranza/resultados-avisos-sin-destino.txt`):

| Caso | Salida | Código |
|---|---|---|
| `--personal` del personal | Tabla con los dos avisos, el más reciente primero: tipo (abono o devolución), monto, fecha, cuenta, número, referencia y transferencia | 0 |
| `--limite 1` | Solo el más reciente | 0 |
| `--limite 0` | «--limite va de 1 a 500.» | 1 |
| Correo que no es del personal | «No se hizo: no_es_operador» | 1 |
| Orden desconocida | «Orden desconocida. Usa cuenta:registrar o avisos:sin-destino.» | 1 |

## Lo que encontró la validación y se corrigió en este PR

- La ficha del cliente caía en «No se pudo abrir esta página»: las acciones de la cabecera (editar, recordatorios, archivar) estaban fuera de su contenedor de avisos.
- Al confirmar una importación el aviso «La importación quedó confirmada…» desaparecía junto con el botón; ahora queda visible.
- La ficha desbordaba 20 px a 1440 y 75 px a 390 por la fecha larga en la métrica «Próximo vencimiento».
- A 390 px el título de la lista se cortaba a «C» con dos botones en la barra; la configuración se abre desde la línea de detección.
- Los radios «Recurrente fijo / Variable» salían del tamaño de un campo de texto; el texto del calendario terminaba en «..»; espaciados de la detección y de la importación; fechas que se partían en dos renglones; el historial repetía «Saldo del pago actualizado» en cada abono.

## Ronda r63: hallazgo → arreglo → prueba

Revisiones: `revision-63.md` (servidor y base, head `1340576`). Cada arreglo tiene una prueba que cae si se revierte solo ese arreglo; la columna «Rojo» es la salida de `scripts/evidencia/cobranza/rojo-por-arreglo.sh` (resultados en `resultados-rojo-por-arreglo.txt`).

| Hallazgo | Arreglo | Prueba | Rojo con el arreglo revertido |
|---|---|---|---|
| r63-N1 (P1) el mismo estado de cuenta con otro banco aplica dos veces | La huella del renglón ya no lleva el banco ni el empate; `UNIQUE (company_id, huella_archivo)` y «Ese archivo ya se importó el…» antes de leer el archivo | `estado-cuenta.test.ts` (la clave no depende del banco ni del empate), `cobranza-postgres` (mismo archivo con otro banco; otro archivo con el mismo renglón), e2e 6 | `N1-huella`, `N1-archivo` |
| r63-N2 (P1) una referencia corta ajena se rellena y se aplica | Consecutivo desde 100000, `CHECK (referencia ~ '^[1-9][0-9]{6}$')`, `normalizarReferencia` sin relleno; lo corto va a «Por conciliar» como `referencia_incompleta` | `cobranza.test.ts`, `estado-cuenta.test.ts`, `cobranza-postgres` (webhook con «número corto»), `reglas-base` (referencia con 0 inicial) | `N2`, `AR5` |
| r63-N3 el correo de contacto cambia sin factor ni aviso | Contacto y beneficiario exigen factor de 30 min y avisan a administración y finanzas | `cobranza-postgres`, e2e 15 | `N3-factor`, `N3-aviso` |
| r63-N4 la referencia de otro cliente desde una CLABE conocida | Se aplica (decisión de Gil) con la marca «Pagado desde la cuenta de otro cliente» | `cobranza.test.ts`, `cobranza-postgres`, e2e 13 | `N4` |
| r63-N5 el comprobante sin `sandbox` | Las dos rutas del comprobante en `next.config.ts` después de la regla general | `descarga.test.ts`, e2e 5 (respuesta real con y sin `/c/<empresa>`) | `N5` |
| r63-N6 un XLSX chico lleva el lector a ~1 GB | Tope por parte al inflar (10 MB hoja y textos, 1 MB el resto) y conteo de `<row>`, `<c>` y `<si>` antes del parser | `estado-cuenta.test.ts` (bomba, tres hojas, conteos) y la medición de abajo | `N6` |
| r63-N7 aviso a una cuenta no registrada se pierde | Queda en `collection_unrouted_events`; el personal lo lista con `avisos:sin-destino` | `cobranza-postgres` (guardado, repetido, lectura del personal, una empresa no lo lee), el comando arriba | `N7` |
| r63-N8 `transfer.inbound.returned` se ignora | Revierte la aplicación, regresa el cargo a emitido, el pago queda `devuelto` y avisa | `fintoc.test.ts` (forma de la doc y formas que no se leen), `cobranza-postgres` (devolución, repetida, `return_failed`, forma desconocida sin efecto) | `N8` |
| r63-N9 el CRLF del concepto pega el texto | CR/LF → espacio en el alta, el cargo único y el plan editado. Desde la integración del #59 lo hace `sinControles` para todo texto libre (cualquier control vale un espacio); la envoltura propia salió | `cobranza.test.ts` | `N9` (revierte `sinControles`) |
| r63-N10 cargo de otra empresa dice «ya cambió» | `cargo_ausente` → «No encontrado / Recarga la lista.» | `cobranza-postgres`, e2e 14 | `N10` |
| r63-base-N1 fechas que pone quien escribe | `pagado_el` fijo mientras siga pagado; `emitido_en` y `resuelto_en` los sella la base | `reglas-base` | `AR1`, `AR2` |
| r63-base-N3 cambiar la cuenta de Fintoc deja huérfanas las CLABEs | `cobranza_destino_fintoc` busca primero por la CLABE del cliente | `cobranza-postgres` | `baseN3` |
| r63-base-N4 / r65-N1 definers sin `pg_temp` | `SET search_path = public, pg_temp` en las 21 definers de la 0031 | `reglas-base` (tablas temporales `collection_provider_accounts` y `collection_emails`) | `AR3` |
| r63-base-N5 (P1) sin bloqueo de empresa suspendida si la 0028 entra antes | `DO` condicional al final de la 0031 con el criterio de la 0028 | `tests/esquema/empresa-suspendida.test.ts` en los dos órdenes | `baseN5` |
| r63-base-N6 la prueba de Postgres no protegía la base | `tests/cobranza/reglas-base.test.ts`: X1-X17, las llaves del cron y del correo, reenvío 5/6, las de arriba y el pago manual a `devuelto` | Mutaciones (abajo) | `AR4`, `AR6` |
| Reenvío de 1 a 5 (observación de base) | `collection_emails_tipo` con `reenvio` hasta 5 | `reglas-base` | `AR4` |

**Mutaciones de la 0031** (`mutaciones.sh` con `mutar-0031.py` del revisor, adaptado a la 0031 nueva: MU11 con `'^[1-9][0-9]{6}$'` y MU16 sin el autor en la misma línea; resultados en `resultados-mutaciones.txt`): contra `reglas-base.test.ts` caen 17 de 17 no equivalentes, cada una por su propia aserción (MU4 y MU13 por la aserción explícita de la llave en el catálogo, antes de sembrar). MU17 y MU19 sobreviven porque son equivalentes (lo frenan `collection_payments_estado` y la falta de grant de UPDATE). Las 6 reversiones de los arreglos de base (AR1-AR6) también caen.

**Memoria del lector de XLSX (r63-N6)** (`memoria-xlsx.mts`, un proceso por caso con `--expose-gc`; `resultados-memoria-xlsx.txt`, donde «head» es el lector de `79f602e` y «nuevo» el de este arreglo):

| Caso | Inflado | Antes: RSS · tiempo · resultado | Ahora: RSS · tiempo · resultado |
|---|---|---|---|
| `celdas` del revisor | 24 MB | 1006 MB · 1679 ms · «más de 40 columnas» | 164 MB · 41 ms · «Una parte del libro de Excel es demasiado grande por dentro» |
| `filas` del revisor | 24 MB | 820 MB · 1974 ms · «más de 5000 renglones» | 162 MB · 44 ms · igual que arriba |
| 262 000 celdas bajo el tope por parte | 9.5 MB | 479 MB · 672 ms | 145 MB · 88 ms · «más de 200,000 celdas» |
| 830 000 renglones bajo el tope | 9.5 MB | 396 MB · 764 ms | 133 MB · 59 ms · «más de 5000 renglones» |
| 590 000 textos compartidos | 9.5 MB | 601 MB · 966 ms · **se leía** | 136 MB · 65 ms · «demasiados textos» |
| Libro legítimo de 5000 × 40 con estilo y 9 000 textos | 7.9 MB | 362 MB · 663 ms · se lee | 357 MB · 602 ms · se lee |

Unos 120-130 MB son la base del proceso. El tope de RSS ahora lo pone un libro legítimo en el límite (200 000 celdas), no uno armado para inflarse.

**Forma de `transfer.inbound.returned` (r63-N8).** Confirmada este turno contra la documentación oficial vigente de Fintoc (fuentes y citas en `tests/cobranza/fixtures/fintoc/LEEME.md`): el evento lleva como `data` el objeto `transfer` con `status: "returned"` (y `return_reason`); `transfer.inbound.return_failed` lo regresa a `succeeded` y el dinero se queda. Una devolución con cualquier otra forma no se lee: responde 500 `aviso_ilegible`, Fintoc reintenta y no se mueve dinero (probado en Postgres). **Pendiente:** verlo con un evento real del sandbox de Fintoc cuando Gil abra la cuenta.

## Ronda r63b (re-verificación sobre c351463): hallazgo → arreglo → prueba

| id | Arreglo | Prueba (cae con el código de `247f0ef`: `scripts/evidencia/cobranza/resultados-r63b-N1.txt`) |
|---|---|---|
| r63b-N1 (P1) | **Una sola regla** en `src/server/cobranza/abonos.ts` (`pagosParecidosDeOtraFuente`), que usan `recibirAbono` (Fintoc, estado de cuenta y demo), el pago manual y la propuesta del estado de cuenta, dentro del candado de la empresa: un abono sin empate por rastreo que coincide con un pago vigente de **otra** fuente en monto, referencia y fecha (±1 día) va a «Por conciliar» como posible duplicado, con el pago parecido (`parecido_a`). **Decisión, sin referencia de un lado:** basta monto y fecha (ante la duda, a «Por conciliar»; nunca se aplica doble). Dos referencias distintas son dos pagos. La referencia de un pago es la que trajo o, si no trajo, la del cargo al que se aplicó (así un pago a mano tiene la de su cargo). **Descartar** = anular con motivo, que la base permite en un automático solo si es posible duplicado (evento `descartar_duplicado_cobranza` con el pago parecido). En la base: `parecido_a` solo en un posible duplicado, de la misma empresa, nunca a sí mismo e inmutable | `cobranza-postgres` (`revision63b`, con cargos que deben el doble: con saldo es cuando se aplicaba dos veces): caso D (Fintoc → estado de cuenta con el rastreo en el concepto), manual → estado de cuenta, estado de cuenta → Fintoc, Fintoc → manual, sin referencia (y aplicarlo a mano) y la carrera Fintoc contra estado de cuenta en dos conexiones (×3): **los seis caen en `247f0ef`**. Controles que se aplican en los dos códigos: a dos días, otro monto y otra referencia. `reglas-base`: seis reglas, y las mutaciones AR7-AR10 de la 0031 caen. e2e 16 clicada (cae en `247f0ef`: proponía «aplicar») |
| r63d-N1 (P3) | Si el abono ya sabe de qué cliente es (su CLABE propia, la ordenante de un solo cliente o el cargo de su referencia, o el cargo elegido a mano), un pago parecido de **otro** cliente no cuenta: son dos depósitos de dos clientes. Uno sin cliente o del mismo sí cuenta | `revision63b`: «otro cliente ya identificado» cae con el código de `09b40e0`; «mismo cliente, otra fuente: sigue frenado» pasa en los dos |
| r63d-N2 (P3) | Prueba nueva: un pago anulado o devuelto no frena un abono nuevo idéntico | Los dos casos caen con la mutación MF7 (anulados y devueltos como parecido) |
| r63b-N2 (P3) | Los 21 formularios de la consola de cobranza llevan `action` (la acción del servidor): sin JavaScript el navegador manda POST (multipart) y la página vuelve con su aviso; nunca un GET con la CLABE, el beneficiario o el contacto en la dirección. `useAccionDeFila` suma `useActionState` para pintar el resultado sin JavaScript. Con JavaScript, `onSubmit` sigue igual | e2e 17 sin JavaScript (cae en `247f0ef`: el formulario no tenía `method`) |
| r63b-N3 (P3) | Un archivo nuevo sin abonos nuevos responde «No había nada nuevo · Su único abono ya estaba en Lever: no se importó ni se duplicó nada.» (`avisoSinNuevos`), sin «Quedó asentado» | `src/dominio/cobranza/cobranza.test.ts` |
| r63c-N1 (P3) | El préstamo de TEMP de `reglas-base` se devuelve en un `finally` y después se vuelve a exigir el 42501 | Una sonda forzada a fallar no deja el permiso (`reglas-base`) |

## Con la CSP estricta del #62 (en `main` desde `9edb4e5`)

- **Merge de `main`** en `5644583`, sin conflictos. `next.config.ts` ya traía las dos fuentes del comprobante (`/consola/cobros/comprobante/:id` y `/c/:empresa/consola/cobros/comprobante/:id`) con `POLITICA_DESCARGA`, y `esDescarga` del #62 reconoce `…/comprobante/[id]`. `encabezados.test.ts` pasa con el registro de cobranza, y la e2e 5 comprueba la respuesta real del comprobante con y sin `/c/<empresa>`.
- **0 violaciones de la política en las rutas de cobranza**, en Chromium y WebKit:
  - con JavaScript: `csp.spec` (todas las rutas del registro, incluidas las de cobranza) y las 18 pruebas de este archivo, que vigilan la consola;
  - sin JavaScript: la e2e 18, más la 17 que guarda la configuración.
- **Capturas en WebKit:** al capturar, el inspector de WebKit inserta un `<style>body {}</style>` y la política lo rechaza (lo documenta el #62). `foto()` descarta solo esa anotación exacta, solo en WebKit y solo si apareció durante la captura. Sin capturas no aparece.

**Gates de la ronda** (este turno, en local):

| Gate | Resultado |
|---|---|
| `typecheck` / `lint` / `build` / `security` | Verde |
| `test` | 578/578 (con `main` integrado, #62 incluido, y la ronda r63b) |
| `test:db` (las 20 pruebas de `pruebas-postgres.sh`, en serie, Postgres 17.9 en 5581), con `main` (#59 y #65) integrado; `definer-search-path` cubre las 21 definers de la 0031 | **87/87** |
| base-N4 tras la 0029 (#65): la app ya no crea tablas temporales (42501, comprobado); la sonda presta el permiso solo a ella. AR3 (quitar `pg_temp` de las 21) la tumba a ella y a `definer-search-path` | atrapada por las dos |
| e2e en sus 5 partes (Chromium, como CI), con `main` integrado (#62 incluido) y la ronda r63b | 25 + 14 + 18 + 19 + 18 = 94 pasan, 5 omitidas (la matriz de cobranza y las 4 de `csp-evidencia`, que corren aparte) |
| Recorrido con capturas | Chromium 18/18, WebKit 18/18 más `csp.spec` 8/8 |

**Ojo con el Postgres local.** Un clúster creado con `initdb` y `LC_ALL=C` queda en `SQL_ASCII`; ahí `'DEPÓSITO' ~ '[[:cntrl:]]'` es verdadero y el CHECK `collection_statement_rows_textos` rechaza los conceptos con acentos (la e2e 6 cae con «La base no respondió»). El CI usa `postgres:17` en UTF-8. Para repetir: `initdb -E UTF8 --locale=en_US.UTF-8`.

## Hallazgos fuera de cobranza

- **Logotipo del marco compartido (WCAG 2.5.3, todas las páginas).** El enlace del logotipo lleva un `aria-label` que no contiene su texto visible (`label-content-name-mismatch`). Lo corrige el PR #60 (Ola 2b) en `logotipo.tsx`, `marco.tsx` y `marco-arco.tsx`; aquí no se toca y la revisión de axe excluye solo ese enlace. Al integrar #60 se quita la exclusión.
- **`test:db`: dos pruebas fallaban en `main` el 2026-11-10** (ya corregido: con el #59 integrado, `test:db` da 84/84) (`tests/flujo/flujo-postgres.test.ts` y `tests/personas/colaboradores-postgres.test.ts`, `invitacion_vencida`): emiten la invitación con un reloj fijo de principios de noviembre y la base la vence con su propio reloj. Lo corrige el PR #59 (emite con la hora real). La prueba de cobranza en Postgres pasa.

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

Antes de cada corrida: `E2E_SERVER_ACTIONS=1 npx next build`.

Ronda r63, desde la raíz y con un Postgres desechable en UTF-8:

```sh
export AISLAMIENTO_DATABASE_URL=postgres://postgres@127.0.0.1:5581/postgres
node_modules/.bin/tsx --test tests/cobranza/reglas-base.test.ts
sh scripts/evidencia/cobranza/mutaciones.sh tests/cobranza/reglas-base.test.ts MU1 MU2 MU3 MU4 MU5 MU6 MU7 MU8 MU9 MU10 MU11 MU12 MU13 MU14 MU15 MU16 MU17 MU18 MU19 AR1 AR2 AR3 AR4 AR5 AR6
P=tests/cobranza/cobranza-postgres.test.ts
sh scripts/evidencia/cobranza/rojo-por-arreglo.sh N1-huella:src/server/cobranza/estado-cuenta.test.ts N1-archivo:$P \
  N2:src/dominio/cobranza/cobranza.test.ts N3-factor:$P N3-aviso:$P N4:src/dominio/cobranza/cobranza.test.ts \
  N5:src/server/pagos-proveedores/descarga.test.ts N6:src/server/cobranza/estado-cuenta.test.ts N7:$P \
  N8:$P,src/server/cobranza/fintoc.test.ts N9:src/dominio/cobranza/cobranza.test.ts N10:$P baseN3:$P \
  baseN5:tests/esquema/empresa-suspendida.test.ts
node_modules/.bin/tsx --expose-gc scripts/evidencia/cobranza/memoria-xlsx.mts "$PWD/src/server/cobranza/lector-estado-cuenta.ts" celdas
``` Al terminar se apagan el proxy y los puertos 3181, 3182 y 4881.
