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
| **r63e-N1 (P1)** | La excepción de r63d-N1 solo vale cuando **todo** lo que identifica al abono dice el mismo cliente (`clienteSinDuda`: la CLABE propia, los clientes que pagaron desde la CLABE ordenante, el cargo de la referencia y el cargo o cliente elegido a mano). Con cualquier desacuerdo, por ejemplo la referencia de D desde la CLABE que antes usó U, se trata como sin cliente y cualquier parecido frena. Manda el cliente al que iría el dinero | Tres casos caen con el código de `442c21c`: la referencia de D desde la CLABE de U; la variante con el cliente elegido a mano; y estado de cuenta → Fintoc desde la CLABE de otro cliente (el `N1.ECaF` de la sonda del revisor). Además, **MF14** (un parecido sin cliente frena) y **MF6** (mismo cliente, referencias distintas: los dos se aplican) tienen su caso, y cada mutación lo tumba. Las sondas del revisor dan 11/11, 5/5 y 6/6 |
| r63d-N2 (P3) | Prueba nueva: un pago anulado o devuelto no frena un abono nuevo idéntico | Los dos casos caen con la mutación MF7 (anulados y devueltos como parecido) |
| r63b-N2 (P3) | Los 21 formularios de la consola de cobranza llevan `action` (la acción del servidor): sin JavaScript el navegador manda POST (multipart) y la página vuelve con su aviso; nunca un GET con la CLABE, el beneficiario o el contacto en la dirección. `useAccionDeFila` suma `useActionState` para pintar el resultado sin JavaScript. Con JavaScript, `onSubmit` sigue igual | e2e 17 sin JavaScript (cae en `247f0ef`: el formulario no tenía `method`) |
| r63b-N3 (P3) | Un archivo nuevo sin abonos nuevos responde «No había nada nuevo · Su único abono ya estaba en Lever: no se importó ni se duplicó nada.» (`avisoSinNuevos`), sin «Quedó asentado» | `src/dominio/cobranza/cobranza.test.ts` |
| r63c-N1 (P3) | El préstamo de TEMP de `reglas-base` se devuelve en un `finally` y después se vuelve a exigir el 42501 | Una sonda forzada a fallar no deja el permiso (`reglas-base`) |

## Ronda r63i: un abono de Fintoc a una empresa suspendida (decisión de Gil: retenerlo y avisar)

**Antes:** `atenderAviso` escribía el pago como `plataforma_cliente` y `bloqueo_empresa_suspendida` (0028) lo frenaba con `empresa_suspendida`. La ruta respondía 500 sin guardar nada (0 pagos, 0 «sin destino», 0 eventos) y, cuando Fintoc dejaba de reintentar, el abono se perdía sin que nadie se enterara.

**Ahora:**
- **Retener.** Con la empresa suspendida o de baja, el aviso (abono o devolución) se guarda **sin aplicarse a ningún cargo** en `collection_held_events`. Lo escribe la definer `cobranza_retener_aviso` (0031, `search_path = public, pg_temp`): solo el sistema y solo con la empresa suspendida o de baja.
  - Deja el evento `retener_aviso_cobranza` en la bitácora: proveedor, tipo y monto, sin datos del ordenante.
  - El log tampoco lleva datos: solo `aviso_retenido` con el id del evento.
  - La ruta responde 200 «retenido» solo después de guardarlo; si no se pudo, 500 y Fintoc reintenta.
  - El reintento idéntico responde 200 «repetido» y no duplica (llave única por evento).
- **La carrera.**
  - El aviso revisa el estado de la empresa con su candado tomado.
  - Si la suspensión confirma con el aviso a medio escribir, la base lo frena con `empresa_suspendida`; nada de lo anterior queda, y el aviso se retiene en su propia transacción con 200.
  - Si el aviso confirmó antes de la suspensión, queda aplicado como cualquier otro.
- **El aviso a Cumplimiento.** En su bandeja (`/operacion/cumplimiento`) aparecen la métrica «Abonos retenidos» y la sección «Abonos retenidos de empresas suspendidas»: empresa, abono o devolución, monto y fechas.
  - La lee la definer `cobranza_abonos_retenidos`, que solo abre a Cumplimiento y a Auditoría; Auditoría solo consulta, porque la sección no tiene botones.
  - Originación, Aprobación y Administración no abren la bandeja.
  - No se usó `operational_alerts`: exige una persona que la crea y otra responsable, y un aviso del sistema no tiene ninguna de las dos.
- **Reactivar.** Cuando Aprobación aprueba la reactivación (con el candado de la empresa, r63j-N2), la acción, después del commit, corre `procesarRetenidos` (hasta 50; el resto, la tarea diaria): cada retenido pasa por el **camino normal**, con el freno de duplicados (`pagosParecidosDeOtraFuente`), el cliente sin duda y el evento ya visto.
  - Va uno por transacción, con el candado de la empresa, y queda «procesado» con su efecto y el evento `procesar_retenido_cobranza`.
  - Nada se aplica dos veces: dos corridas a la vez, la tarea diaria y el reintento de Fintoc después de reactivar dan «repetido» o 0.
  - Si falla después de la reactivación, la tarea diaria lo vuelve a intentar.
- **Dada de baja.** El retenido se queda en la bandeja de Cumplimiento **indefinidamente**, con la marca «Empresa de baja», y nunca se aplica solo: no hay reactivación desde la baja. Cumplimiento y la plataforma resuelven fuera de Lever qué hacer con ese dinero.
- **La propia empresa suspendida no escribe** (lo de siempre, ahora probado):
  - el pago a mano y el estado de cuenta se rechazan;
  - la consola de cobranza dice «La empresa está suspendida · No se pueden hacer cambios mientras esté suspendida. Comunícate con Lever.»; antes decía «La base no respondió», lo encontró el recorrido.

**Pruebas que caen con el código de `36564ea`:**
- `tests/cobranza/retenidos-postgres.test.ts`, nueva en `test:db`:
  - retenido con 200, sin pago y con su evento sin datos del ordenante;
  - el reintento no duplica;
  - la bandeja para Cumplimiento y Auditoría, y no para Originación;
  - pago a mano y estado de cuenta rechazados;
  - la tarea diaria no toca a la suspendida;
  - al reactivar se aplica una vez, también con dos corridas a la vez;
  - la carrera en tres órdenes: el aviso antes de la suspensión; la suspensión mientras el aviso espera el candado; la suspensión con el aviso a medio escribir. Esta última pasa por el `catch`: quitarlo la tumba con `empresa_suspendida`.
- `tests/cobranza/reglas-base.test.ts`:
  - la tabla no tiene permisos de escritura para el cliente ni lleva `bloqueo_empresa_suspendida`, que de todos modos no frena a una definer;
  - el cliente no la escribe (42501);
  - no se retiene con la empresa activa ni lo hace una persona;
  - el evento del aviso es el de su renglón;
  - no se procesa con la empresa suspendida;
  - la empresa suspendida no registra pagos;
  - nadie la reescribe ni la borra, ni la dueña;
  - la bandeja es solo de Cumplimiento.

**Recorrido con clics** (`scripts/evidencia/cobranza/retenidos.spec.ts.txt`):
- No corre en el CI, para no mover el reparto. Se copia a `tests/e2e/zz-retenidos.spec.ts` y corre con `sh scripts/ci/pruebas-e2e.sh tests/e2e/zz-retenidos.spec.ts`.
- Recorre: configurar y dar de alta un cliente con clics; Originación pide la suspensión y Aprobación la aprueba; llega un aviso firmado («retenido») y su reintento («repetido»).
- Cumplimiento lo ve en su bandeja con el conteo y Originación no la abre. «Registrar pago» en la empresa suspendida muestra el mensaje de la suspensión y no deja pago.
- Cumplimiento pide reactivar y Aprobación lo aprueba: el abono queda aplicado una vez, el cargo pagado y la ficha con un pago; en la bandeja solo queda el envenenado (r63j), con su motivo.
- Capturas `retenidos-*.jpg`.

**Ronda r63j (re-verificación de `85acf30`): hallazgo → arreglo → prueba**

| id | Arreglo | Prueba (cae al revertir su arreglo: mutaciones sobre el head) |
|---|---|---|
| **r63j-N1 (P1)** Un retenido envenenado frenaba para siempre la cobranza de la empresa. Era la devolución de un duplicado que la empresa ya había descartado (`pago_anulado`): la reactivación no aplicaba los que venían detrás, y la tarea diaria marcaba la empresa como fallida y dejaba de generar cargos y recordatorios. Con la empresa activa, la misma devolución daba 500 | 1) `aplicarDevolucion`: la devolución de un pago anulado queda resuelta con su evento, 200 con efecto «anulado», sin error. 2) `procesarRetenidos`: cada retenido va aislado. Si falla, su transacción se deshace y queda **«fallido»** con el código del error (`cobranza_retenido_fallido`, evento `retenido_fallido_cobranza`, sin datos); Cumplimiento lo ve en su bandeja («No se pudo aplicar (código)») y los demás siguen. Si ni siquiera se puede marcar (la base no responde), sigue pendiente. 3) La tarea diaria: el paso de los retenidos lleva su propio `try` | `retenidos-postgres`: la devolución de un anulado (sin el arreglo, `pago_anulado`); un envenenado seguido de uno legítimo, que se aplica, con el fallido en la bandeja; la tarea con un envenenado genera los cargos y queda en 0 fallidas (sin el arreglo, `fallidas: 1`). `reglas-base`: el motivo es un código, un fallido no se vuelve a marcar y una persona no marca fallidos |
| **r63j-N2 (P2)** Un retenido podía quedar varado con la empresa ya activa (se revisaba en una transacción y se guardaba en otra, y la reactivación no tomaba el candado), y en ese hueco una devolución se adelantaba a su abono: el cargo quedaba pagado con dinero devuelto | 1) La suspensión y la reactivación (`suspensiones.ts`) toman `bloquearEmpresa`, el mismo candado de cada aviso. 2) El aviso revisa el estado y retiene **en la misma transacción**, bajo el candado: si la empresa ya está activa, va por el camino normal. Si una suspensión sin candado (la de la lista, dentro de la base) lo frena a medio escribir, la segunda vuelta lo retiene. 3) Cada aviso de una empresa activa procesa antes los retenidos pendientes, así una devolución nunca llega antes que su abono. La bandeja dice «Empresa activa: lo aplica la tarea diaria» si alguno queda pendiente con la empresa ya activa | La carrera aviso ↔ reactivación en los dos órdenes, con dos conexiones (sin el candado, el aviso no espera); el abono retenido y su devolución después de reactivar: la devolución lo encuentra y lo revierte, el cargo queda `emitido` y nada va a «sin destino» (sin el arreglo, el efecto no es «devuelto») |
| r63j-P3 | La acción de la reactivación procesa a lo más 50 retenidos; el resto lo aplica la tarea diaria y la bandeja lo cuenta | `procesarRetenidos` con tope 1 deja 1 pendiente, visible como «Empresa activa»; la tarea lo aplica (sin el tope, procesa los dos) |

**Ronda r63k (re-verificación de `c5626e3`): hallazgo → arreglo → prueba**

| id | Arreglo | Prueba (cae al revertir su arreglo) |
|---|---|---|
| **r63k-N1 (P2)** Interbloqueo entre la decisión de suspensión y el alta o edición de un proveedor: la decisión tomaba el candado de la empresa después de que el disparador de `company_suspensions` escribiera `companies`; el proveedor toma el candado y después escribe `companies` (`lpb_cotejar_empresa` con una coincidencia abierta) | `decidirCambioDeSuspension` toma `bloquearEmpresa` antes de cualquier escritura. Los demás caminos que lo toman (proveedores, pagos, nómina, personas, roles, política, cobranza) lo hacen al principio; solo `suspensiones.ts` escribe `companies` desde la aplicación | `retenidos-postgres`: con dos conexiones, la decisión contra el lado del proveedor (candado y `lpb_cotejar_empresa`) en los dos órdenes; sin el arreglo, la decisión cae con «deadlock» (`base_no_disponible`) |
| **r63k-N2 (P2)** Un error pasajero dejaba el retenido «fallido» para siempre | `base_no_disponible` y `auditoria_no_disponible` detienen la corrida y dejan el retenido pendiente con un intento más (`cobranza_retenido_reintento`). La base traduce también sus errores de datos a `base_no_disponible`, y un `TypeError` llega igual: por eso, al quinto intento queda fallido, así no frena para siempre a los que vienen detrás. Un aviso guardado sin abono ni devolución es `aviso_ilegible`, permanente | `retenidos-postgres`: la bitácora cae una vez, el retenido sigue pendiente con 1 intento y la siguiente corrida lo aplica (sin el arreglo: «Missing expected rejection», quedaba fallido); el día imposible se reintenta 4 veces y queda fallido al quinto. `reglas-base`: cinco intentos dejan el retenido fallido, no hay sexto y una persona no suma intentos |
| r63k-P3 | La bandeja dice el motivo en palabras («No se pudo aplicar: el aviso guardado no se pudo leer»), con un catálogo (`deCatalogo`); el código queda en la bitácora | El recorrido lo verifica |

**Ronda r63l (re-verificación de `4c4415b`) y decisión de Gil del 2026-11-11**

| id | Arreglo | Prueba (cae al revertir su arreglo) |
|---|---|---|
| **r63l-N1 (P2)** Los cinco intentos se quemaban en 50 s con una contención breve: un abono sin nada malo quedaba fallido para siempre | Se cuenta **un intento por hora** (`ultimo_intento_en`): dentro de esa hora el error pasajero detiene igual la corrida y deja el retenido pendiente, sin contar. Queda fallido tras al menos 4 h de falla persistente. La hora se lee de `cobranza_retenidos_ahora()`, que es `now()` y existe aparte para que las pruebas simulen el paso del tiempo. El disparador solo deja cambiar `ultimo_intento_en` junto con un intento contado, y un retenido nace pendiente, con 0 intentos y sin hora, también si lo inserta la dueña (r63l-P3) | `retenidos-postgres`: 5 avisos de la empresa seguidos, con la bitácora sin responder, dejan el retenido pendiente con 1 intento, y el siguiente aviso lo aplica. Sin la regla de la hora, «Expected 1». Cinco intentos con una hora entre cada uno lo dejan fallido. `reglas-base`: cinco en la misma hora no lo dejan fallido; un INSERT con intentos o ya procesado se rechaza |
| **Gil: un fallido se avisa por correo a administración y finanzas de la empresa**; sin botón de reintentar | Con cualquier fallido (de regla, al primer intento, o por el tope), `avisarAlEquipo` manda un correo solo a las personas activas de esa empresa con rol `administrador` o `finanzas`, con la llave `cobranza-retenido-fallido/<id>` (un retenido queda fallido una sola vez; si el envío falla, la tarea diaria lo reintenta con la misma llave, r63m-2). En lenguaje llano: el monto, la fecha del depósito, la referencia si la hay, que el dinero sí llegó pero no se registró solo y que lo registren a mano para que se detengan los recordatorios. No lleva datos del ordenante ni el código del error, y usa el pie de siempre. La bitácora deja `aviso_retenido_fallido_cobranza` con cuántos correos salieron, 0 si el envío falla; el fallido no se deshace | `retenidos-postgres`: el fallido de Alfa llega a su administrador y a su persona de finanzas, y a nadie más (ni a la contadora, ni a Beta). Sin datos del ordenante ni el código. La segunda corrida no lo reenvía. Con el proveedor de correo caído, el retenido sigue fallido y la bitácora dice 0. Sin el aviso, cae en los destinatarios. El recorrido verifica el correo y lo captura (`retenidos-correo-fallido.jpg`) |

**Pre-revisión de r63l (`27b1142`): tres P3 en el mismo PR**

| id | Arreglo | Prueba (cae al revertir su arreglo) |
|---|---|---|
| r63m-1 Un intento contado con una hora del pasado pasaba (solo la dueña) | El disparador exige que el intento contado lleve una hora al menos una hora después del anterior, la misma regla de `cobranza_retenido_reintento` | `reglas-base`: la dueña suma un intento con la hora de dos horas antes y con la de 59 minutos después: los dos se rechazan; con una hora exacta pasa. Sin el arreglo: «Missing expected exception» |
| r63m-2 Si el correo del fallido no salía, la empresa nunca se enteraba | La tarea diaria (paso 0b, con su propio try) vuelve a avisar los fallidos de la empresa sin un evento `aviso_retenido_fallido_cobranza` con `enviados > 0` (`cobranza_fallidos_sin_aviso`), con la misma llave `cobranza-retenido-fallido/<id>`; cada intento deja su evento en la bitácora | `retenidos-postgres`: con el proveedor caído, el aviso y la tarea dejan dos eventos con 0; con el proveedor de vuelta, la siguiente corrida lo manda una vez con la misma llave que el intento caído, y la tercera no lo reenvía. Sin el paso 0b: «Expected 2» |
| r63m-3 La tarjeta de retenidos quedaba pegada a las métricas de PLD | `operacion.css`: una tarjeta seguida de una fila de métricas lleva el mismo margen de 24 px que métricas → tarjeta. `tokens.css` no cambia | El recorrido mide 24 px a 1280 y a 390 y captura `retenidos-bandeja-con-fallido.jpg` y `retenidos-bandeja-con-fallido-390.jpg`. Contraprueba con el `operacion.css` de `27b1142`: 0 px a los dos anchos (`separacion-contraprueba.txt`) |
| r63n (decisión del líder) Una empresa sin nadie activo de administración o finanzas recibiría un reintento y un evento cada día | El reintento diario se limita a los envíos que fallaron: si no hay a quién mandarlo (o es de demostración), queda un solo evento con el motivo `sin_destinatarios` (o `demostracion`) y no se reintenta | `retenidos-postgres`: sin destinatarios, la tarea corrida dos veces deja un solo evento con `sin_destinatarios`; el envío que falló por el proveedor sí se reintentó. Sin la exclusión, cae |

**Pre-revisión de r63m y r63n (`6fd750c`): cinco P3 en el mismo PR (r63o)**

| id | Arreglo | Prueba (cae sin el arreglo) |
|---|---|---|
| r63n-1 La llave del correo de un fallido era la posición en la lista: si la lista cambiaba entre dos intentos, la llave de una persona pasaba a otra; y con un envío parcial, a quien le falló no se le reintentaba | La llave es `cobranza-retenido-fallido/<retenido>/<persona>` (id de la persona, solo `[A-Za-z0-9/_-]`). La fila guarda los ids de quienes ya lo recibieron (`aviso_recibieron`, ids, nunca correos) y el reintento va solo a quienes faltan. El evento dice `enviados`, `recibidos` y `pendientes`; los ids van en la fila porque la bitácora solo acepta valores sueltos de hasta 200 caracteres | `retenidos-postgres`: con un envío parcial y una persona que entra entre dos corridas, cada correo lleva la llave de su destinatario, la administradora no lo recibe dos veces y la fila guarda los tres ids. Con el código de `6fd750c`: `AssertionError` en la primera llave (`:399`) |
| r63n-2 El reintento diario no tenía tope | Hasta 7 días desde que quedó fallido (`cobranza_fallidos_sin_aviso` y `cobranza_tomar_aviso_fallido`, con el reloj de `cobranza_retenidos_ahora`). Cumplimiento lo sigue viendo en su bandeja | Con el proveedor caído: el día 7 hay intento y evento; el día 8, ni intento ni evento; la bandeja lo sigue mostrando |
| r63n-3 La bitácora exageraba lo enviado: un 409 `correo_ya_enviado` contaba, y en la carrera aviso ↔ tarea salían los dos con dos eventos | `enviados` cuenta solo correos nuevos; el 409 cuenta como recibido. Quien manda el correo lo reserva antes en una transacción corta (`cobranza_tomar_aviso_fallido`, el envío va fuera de ella; la reserva vence en una hora si quien la tomó se cayó) y la suelta con lo que resultó (`cobranza_soltar_aviso_fallido`) | El 409 deja `enviados 2, recibidos 3`. La carrera de -03 (el aviso se queda mandando mientras corre la tarea): la tarea ve la reserva y no manda nada; un solo evento y su suma es igual a los correos que salieron |
| r63n-4 (decisión del líder) `sin_destinatarios` no se volvía a intentar nunca | Durante los mismos 7 días, la tarea revisa en silencio los fallidos sin destinatarios: si ya hay alguien activo de administración o finanzas, le llega y queda su evento; si no, no queda nada. Una empresa de demostración queda cerrada sin correo | Sin nadie el día 1: ningún evento nuevo. Reactivada la administradora el día 3: le llega una vez, con su llave, y queda un solo evento más |
| `ultimo_intento_en = 'infinity'` (solo la dueña) dejaba pasar un intento y después la definer ya no contaba ninguno | `CHECK collection_held_events_intento_finito`. Las columnas nuevas del correo solo cambian en un fallido (quién lo recibió solo crece; cerrado no se reabre) y también son finitas (`collection_held_events_aviso`) | `reglas-base`: la dueña con `infinity` y con `-infinity` choca con el CHECK; un pendiente no lleva datos del correo; en un fallido no se borra quién lo recibió ni se reabre; una persona no reserva ni anota. Con `6fd750c`: «Missing expected exception» (`:487`) |

**Pre-revisión de r63o (`d876248`): un P3 en el mismo PR (r63p)**

| id | Arreglo | Prueba (cae sin el arreglo) |
|---|---|---|
| r63o-1 (decisión del líder) Si la persona a la que le falló el correo dejaba de estar activa, la tarea cerraba el aviso sin evento (la bitácora quedaba en «pendientes: 1») y, si volvía dentro de los 7 días, no le llegaba | La fila guarda también a quiénes se les intentó y no les llegó (`aviso_faltan`). `cobranza_soltar_aviso_fallido` lo cierra solo si en esa vuelta le llegó a todas las personas activas y ya no falta nadie; mientras falte alguien que hoy no está activo, la tarea sigue revisando en silencio hasta los 7 días, sin evento. El evento queda solo cuando hay un intento de envío. `collection_held_events_aviso`: un aviso cerrado no tiene a nadie pendiente | `retenidos-postgres`: a Zoe le falla el correo, se la suspende el día 2 (sin evento, el aviso sigue abierto con ella pendiente) y se la reactiva el día 4: le llega una vez, con su llave, y queda un solo evento más. Con `d876248`: «sigue abierto, con quien falta», `0 !== 1` (el aviso quedaba cerrado el día 2) |

**Pre-revisión de r63p (`75b78360`): dos P3 en el mismo PR (r63q)**

| id | Arreglo | Prueba (cae sin el arreglo) |
|---|---|---|
| r63q-1 Si a quien le falló el correo se le daba la baja efectiva (que no se puede cancelar: `baja_ya_efectiva`), seguía en `aviso_faltan` y el aviso quedaba abierto en silencio los 7 días y después para siempre | `cobranza_soltar_aviso_fallido` quita de faltan a quien tiene `employees.baja_en` <= hoy en México (con la misma fecha que usa la selección de destinatarios). La suspensión y quitar un rol se pueden revertir, así que a esas personas se les sigue esperando. No existe una membresía revocada: `memberships` solo admite «invitada», «activa» y «suspendida» | `retenidos-postgres`, empresa Rho: a Zoe le falla el correo, se le da la baja efectiva y la tarea del día 1 cierra el aviso con faltan vacío, sin correo para ella. Sin el arreglo: «con la baja efectiva, el aviso se cierra», `0 !== 1` (`:558`) |
| r63q-2 Ana y Bea fallan, se suspende a Bea y el día 1 a Ana le llega: el evento decía «pendientes: 0» con el aviso abierto y Bea en faltan | `soltar` devuelve cuántas personas siguen en faltan y corre antes del evento, en la misma transacción; el evento lleva ese número (más el envío que no se pudo preparar, si lo hubo) | `retenidos-postgres`, empresa Tau: el segundo evento dice `{enviados: 1, recibidos: 1, pendientes: 1}`. Sin el arreglo: «Bea sigue pendiente», `pendientes: '0'` (`:580`) |

| r63q-3 (decisión del líder) Cuando la baja efectiva cerraba el aviso en una revisión sin envío, no quedaba evento: la bitácora terminaba en «pendientes: 1» con la fila cerrada | `soltar` devuelve también si esta llamada cerró el aviso porque la baja dejó vacío faltan; ese cierre, que pasa una sola vez, deja un evento con `{enviados: 0, pendientes: 0, motivo: "baja_efectiva"}`, en la misma transacción y sin ids. Las demás revisiones sin envío siguen sin dejar evento | `retenidos-postgres`, Rho: dos eventos, el del intento y el de cierre; otra vuelta dos días después no agrega nada. Con `c478fac`, «un solo evento de cierre, con su motivo» cae en `:564` (solo estaba el de pendientes 1) |
| r63q-2b (P3, revisión de `c478fac`) Si el correo no se podía preparar, el evento sumaba ese 1 a quienes ya estaban en faltan | Sin preparar, `pendientes` = el mayor entre faltan y 1; preparado, `pendientes` = faltan | `retenidos-postgres`, Kappa: a Zoe le falla el correo y en el reintento no hay URL pública; el evento dice `{enviados: 0, recibidos: 0, pendientes: 1}`. Con `c478fac`, «solo falta Zoe» cae en `:606` con `pendientes: '2'` |
| r63q-3b (P3, revisión de `01d5072`; decisión del líder: sin cerrar) Zoe falla y luego tiene la baja; la administradora, la única que lo recibió, queda suspendida: la vuelta no tiene destinatarios y no quedaba evento; la bitácora se quedaba en «pendientes: 1» | `soltar` dice si la baja sacó a alguien de faltan (`quito_por_baja`), no solo si cerró; en una vuelta sin otro evento queda uno solo `{enviados: 0, pendientes: <faltan>, motivo: "baja_efectiva"}`. La vuelta sin destinatarios **no cierra** el aviso (r63n-4): si alguien aparece dentro de los 7 días, le llega | `retenidos-postgres`, Ocho: días 1, 3 y 8, un solo evento de la baja, faltan vacío y sin cerrar. Nueve: Lia (finanzas) aparece el día 3 y le llega una vez. Sigma sigue cubriendo r63n-4 (primer aviso sin destinatarios; la administradora vuelve el día 2 y le llega). Con `01d5072`, «un solo evento de la baja» cae en `:641` (solo el de pendientes 1) |

Gates de r63q, sobre la integración con el #66 y el #67 (Postgres 17 local en 5581): `typecheck` y `lint` limpios, `npm test` 689/689, `test:db` 131/131, `build`, el recorrido de retenidos (1/1, 16 s) y la parte 2 de la e2e, la de cobranza (27 pasan y 1 omitida, 58 s).

**Integración con el #66 y el #67 (en `main` desde `cca9d98` y `4542b40`):**
- **Merge del #66 (`b313a3d`):** chocó en `brillo-del-fondo.spec.ts`, que esta rama había borrado al reacomodar el fondo en 8 partes. La prueba de 40 ms vive en `velocidad-del-fondo.spec.ts`: ahí llevé los cambios del #66 (el nonce de la hoja, la medida de 8 px y `comprobarSinWebGl` a DPR 1 y 2). Esa prueba queda idéntica a la del #66, y las 22 llamadas a `pruebasDelFondo` son las mismas (23 pruebas del fondo).
- **Sabotajes de -10 (S9 y S2w2) sobre el árbol integrado,** con los cuatro archivos del fondo: la base da 23 ✓ (89 s); S9 da 22 ✓ y 1 ✘ (87 s), y S2w2 también 22 ✓ y 1 ✘ (93 s). En los dos, la que cae es la de 40 ms (`velocidad-del-fondo.spec.ts:23`).
- **Merge del #67 (`2a8dc69`):** sin conflictos. Suma una prueba: son 199 y el reparto real queda en 27, 28, 24, 24, 26, 22, 32 y 16 por parte. Con los máximos del CI, el modelo (`reparto-real.mjs`) da como peor la parte 6, con ~492 s (antes ~487), en la franja de documentar, y 38 pruebas normales después de una de GPU (antes 36).
- **Las 8 partes en local, sobre `2a8dc69`:** 44, 59, 113, 95, 58, 57, 86 y 50 s; 194 pasan y 5 se omiten (199).
- **Merge de `main` (`4542b40`) después de r63q:** `git diff 5a7aadc HEAD --stat` sale vacío.

Gates de r63p (Postgres 17 local en 5581): `typecheck` y `lint` limpios, `npm test` 669/669, `test:db` 130/130, `build` y el recorrido de retenidos (1/1, 31 s).

Gates de r63o (Postgres 17 local en 5581): `typecheck` y `lint` limpios, `npm test` 669/669, `test:db` 130/130 (la lista de `scripts/ci/pruebas-postgres.sh`, en serie), `build` y el recorrido de retenidos (1/1, 34 s).

**Por qué unas horas de 500 no pierden avisos** (documentación oficial de Fintoc, leída el 2026-11-12: https://docs.fintoc.com/guides/resources/webhooks-walkthrough/webhooks-creating-guide):
- En modo `live`, Fintoc reintenta un aviso hasta 17 veces en unos 3 días, con espera exponencial desde 3 s.
- No tiene reenvío manual ni cola de eventos fallidos.
- En modo `test` (el sandbox) son solo 3 intentos en 3 horas: una falla de más de 3 h en el sandbox sí perdería el aviso.

El recorrido suma el caso envenenado: un retenido sin abono ni devolución llega antes del legítimo; al reactivar, el legítimo se aplica y el envenenado queda en la bandeja con «No se pudo aplicar: el aviso guardado no se pudo leer» (`retenidos-bandeja-con-fallido.jpg`).

**Barrido de fechas de México contra UTC (a raíz de la falla de PLD en `main`, la primera hora del día en México).** No hay ninguna falla de esa clase en cobranza ni en runway:
- **Servidor:** Fintoc toma la fecha del abono con `hoyEnMexico(transaction_date)` (`fintoc.ts`). La tarea, el pagador y los cargos reciben `hoy` por sus dependencias y la calculan con `hoyEnMexico`. La 0032 usa `caja_hoy()` (`timezone('America/Mexico_City', clock_timestamp())`).
- **0031:** ninguna regla compara una fecha de México contra `now()` o `current_date`; solo hay sellos `timestamptz DEFAULT now()` y CHECK contra el año 2000.
- **Postgres:** las pruebas de cobranza usan fechas fijas (`HOY` = 2026-11-10 y `reloj(...)`). Los `current_date` de `reglas-base` quedan en transacciones que se revierten, y ninguna regla compara `pagado_el`. `runway-reglas-base` acepta el `caja_hoy()` de ahora o de hace un minuto.
- **e2e:** `hoy()` salía de `E2E_TODAY`, fijado al sembrar, mientras el servidor calcula el día en cada petición. Una corrida que cruzara la medianoche de México veía otro día que el servidor (`runway.spec`: la semana de la foto y la baja de ayer; `cobranza.spec:723`: la fecha del estado de cuenta, que con la tolerancia de ±1 día no fallaba). Ahora `hoy()` es `hoyEnMexico(new Date())`, calculado al momento de usarlo. La contraprueba está en el README de runway (#64).

**Lo que confirmó Gil:**
- **Un abono a una empresa suspendida se retiene y se avisa a Cumplimiento** (r63i-N1), como se describe arriba.
- **Los cobros recibidos quedan fuera de las reglas PLD** (r63i-N2):
  - El dinero llega a la cuenta Fintoc o al banco de la empresa, no a la SOFIPO.
  - Por eso `pld_operaciones` solo se alimenta de pagos a proveedores y nómina, y un cobro aplicado no genera operación ni alerta.
  - Si el Oficial de Cumplimiento pide vigilarlos, se agrega una regla.

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
