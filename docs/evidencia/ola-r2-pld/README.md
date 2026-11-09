# Evidencia de la Ola R2: alertas PLD, reportes regulatorios y conservación de 10 años

Recorrido con clics reales de Playwright headless (`scripts/evidencia/ola-r2-pld.mjs`) contra `next build` + `next start`, sobre una base recién migrada (0001-0030) y sembrada por `scripts/evidencia/ola-r2-pld/preparar.ts`. Cada envío se hace con doble clic y la base confirma que quedó una sola operación. Corrida del 2026-11-09 (hora de la Ciudad de México) desde cero, sin capturas ni datos previos.

| Fase | Resultado | Datos |
| --- | --- | --- |
| Flujos 1-7 | 107 comprobaciones en verde, 0 en rojo, consola limpia (97 s) | `datos/resultados-f1-f2-f3-f4-f5-f6-f7.json` |
| Flujos 8-14 | 165 comprobaciones en verde, 0 en rojo, consola limpia (134 s) | `datos/resultados-f8-f9-f10-f11-f12-f13-f14.json`, `datos/matriz-visibilidad.json`, `datos/manifiesto-taller.ndjson` |
| Pantallas: 10 pantallas × 3 temas × 1440/390 | 60 en verde: un solo h1, cada campo con etiqueta, sin desborde, el viewport de 390 no se ensancha, consola limpia | `datos/resultados-pantallas.json` |
| Contraste AA medido (100 textos por tema y ancho) | 6 en verde; mínimo 5.12 (Claro 390), Oscuro 7.49, Lever 6.73 | `datos/resultados-contraste.json`, `datos/contraste.json` |
| R1 completo con la 0030 (`scripts/evidencia/ola-r-alta.mjs`) | flujos 149, pantallas y contraste 60, regresiones 165: todo en verde | `r1/` |
| `EXPLAIN ANALYZE` de las reglas con 10,000 instrucciones | p95 3.513 ms (criterio ≤ 25 ms) | `explain-reglas.txt` |

Las capturas están en `capturas/`. Cada corrida numera las suyas desde 01: `NN-fX-…` para los flujos y `NN-pantalla-<pantalla>-<tema>-<ancho>` para las pantallas.

## Cómo se corre

Puertos de esta línea: Postgres 5553, `next start` 4813, emulador de Blob 4896 y 3153 para el segundo `next start` del arranque de R1. Nada toca Neon, Blob ni Resend reales.

1. Postgres 17 desechable en `127.0.0.1:5553` (Homebrew: `initdb` y `pg_ctl -o "-p 5553"`).
2. Emulador de Blob en 4896: `iniciarBlobLocal(4896, <token falso del almacén «e2elocal»>)` de `tests/e2e/blob-local/servidor.ts`. **Va antes de `preparar.ts`**: la siembra arma expedientes con documentos (`armarBorrador`) y, sin emulador, `@vercel/blob` reintenta sin fin.
3. Variables (sin valores reales, todas locales):
   - `ESTADO`: archivo fuera del repositorio. Guarda semillas TOTP y sesiones; nada de eso se imprime. El recorrido agrega `<ESTADO>.ids.json` con los ids de cada flujo.
   - `DUENO_URL`: el Postgres administrador local; `preparar.ts` crea ahí la base `ola_r2_pld`.
   - `AUTENTICACION_LLAVE_TOTP` (32 bytes en base64url), la misma para `preparar.ts` y para `next start`.
   - `AUTENTICACION_DOMINIOS=localhost`, `URL_APLICACION=http://localhost:4813`, `E2E_SERVER_ACTIONS=1`.
   - `BLOB_READ_WRITE_TOKEN` (el falso del emulador), `VERCEL_BLOB_API_URL`, `E2E_BLOB_LOCAL_URL` y `E2E_BLOB_LOCAL=1`.
   - `E2E_RELOJ_PLD`: archivo fuera del repositorio con el «hoy» de PLD (ver «Reloj fijo»). Vacío = hora real.
4. `next build`.
5. `tsx scripts/evidencia/ola-r2-pld/preparar.ts`: migra desde cero y siembra Taller del Cierre con su perfil (pagos $50,000.00 al mes, nómina $15,000.00) y dos pagos por autorizar a la misma CLABE; Marta con nómina semanal de $18,500.00; Nogal Comercial en alta, sin perfil y con la activación pedida; Cobre Industrial activa, con la activación aprobada hace siete meses (celebración del contrato 2026-04-08); y al personal SOFIPO: Ofelia administra, Omar origina, Ana aprueba, Celia cumple y es la Oficial, y Aurelio audita. Cada quien con su app autenticadora y una sesión SOFIPO.
6. `next start -p 4813` con `DATABASE_URL` de la aplicación (la deja `ESTADO`), `NODE_ENV=production` y `NODE_OPTIONS="--import=tests/e2e/blob-local/preload.mjs --import=tests/pld/reloj-preload.mjs"`.
7. Sobre la misma base y en este orden: `FASES=f1,f2,f3,f4,f5,f6,f7`, `FASES=f8,f9,f10,f11,f12,f13,f14`, `FASES=pantallas` y `FASES=contraste`, cada uno con `node scripts/evidencia/ola-r2-pld.mjs`. `FASES=flujos,pantallas,contraste` corre todo de una vez.
8. **R1 con la 0030** (sin pisar la evidencia del #59): `preparar.ts base` y `preparar.ts arranque` de `scripts/evidencia/ola-r-alta/` contra 5553, `next start -p 4813` con su `DATABASE_URL` y otro en 3153 con `DATABASE_URL_ARRANQUE` y `URL_APLICACION=http://localhost:3153`. Después `BASE=http://localhost:4813 DIR=<carpeta fuera del repositorio> FASES=flujos`, `FASES=pantallas,contraste` y `REGISTRO_SERVIDOR=<salida del next start de 4813> BASE_ARRANQUE=http://localhost:3153 FASES=regresiones`. En `r1/` se copian solo los JSON de resultados.

## Reloj fijo y lo que toca la dueña

La base fecha con `now()` y con `hoy_mexico()`. Para los plazos, la aplicación lee el «hoy» de PLD con `ahoraPld()`. `tests/pld/reloj-preload.mjs` cambia solo ese valor, y lo lee del archivo `E2E_RELOJ_PLD` en cada llamada, así que el recorrido lo mueve sin reiniciar el servidor. Se niega a cargar fuera de un entorno de prueba (`exigirEntornoDePrueba`) y tiene su prueba en `tests/pld/reloj-preload.test.ts`.

**Todo lo de esta sección corre solo contra la base desechable de evidencia** (`ola_r2_pld` en `127.0.0.1:5553`). El script se niega a correr si `DUENO_URL` no es un Postgres local. Como dueña, el recorrido solo hace esto, con el SQL exacto:

- **Renovar las sesiones sembradas** antes de cada flujo, para que no venzan por inactividad:
  ```sql
  update sessions set ultimo_uso = now() where expires_at > now();
  ```
- **El segundo factor de quien decide**: ahora (`<minutos>` = 0), o 31 minutos atrás para ver «Confirma que eres tú»:
  ```sql
  begin; set local session_replication_role = replica;
  update sessions set segundo_factor_en = now() - interval '<minutos> minutes' where user_id = '<persona>'; commit;
  ```
- **Flujo 8: fechar el caso del aviso del 27 al 29 de octubre de 2026**, para que la sesión del viernes 30 dictamine con el 2 de noviembre inhábil en medio:
  ```sql
  begin;
  set local session_replication_role = replica;
  update pld_avisos set registrado_en = timestamptz '2026-10-27 10:00:00-06' where id = '<aviso de Omar>';
  update pld_alertas set creada_en = timestamptz '2026-10-27 10:00:00-06' where id = '<alerta del aviso>';
  update pld_casos set registrado_en = timestamptz '2026-10-28 10:00:00-06' where id = '<caso>';
  update pld_caso_alertas set registrado_en = timestamptz '2026-10-28 10:00:00-06' where caso_id = '<caso>';
  update pld_propuestas set registrado_en = timestamptz '2026-10-29 10:00:00-06' where caso_id = '<caso>';
  commit;
  ```
- **Flujo 9: envejecer 61 días la alerta del aviso de Nogal**, para ver «Vence hoy» al día 60 y «Fuera de plazo» al 61:
  ```sql
  begin;
  set local session_replication_role = replica;
  update pld_alertas set creada_en = creada_en - interval '61 days' where id = '<alerta>';
  update pld_avisos set registrado_en = registrado_en - interval '61 days' where id = (select aviso_id from pld_alertas where id = '<alerta>');
  commit;
  ```
- **Flujo 13: intentar borrar.** Como aplicación, `delete from supplier_payment_requests where id = '…'` y `truncate payroll_batches`: la base niega el permiso. Como dueña, `delete from pld_alertas` y `truncate supplier_payment_requests cascade`: los disparadores los rechazan con `conservacion_no_se_borra`. Ninguno borra nada.

`session_replication_role = replica` apaga los disparadores de solo inserción en esa transacción. Lo demás, sin excepción, pasa por clics.

## Reglas → disposición → archivo:línea

Las líneas son del head de este PR. Cada regla codificada lleva un comentario con su disposición.

| Regla | Disposición | Dónde |
| --- | --- | --- |
| Perfil transaccional versionado y de solo inserción (montos máximos mensuales y operaciones estimadas por tipo) | 25ª-27ª | `db/migrations/0030_pld_alertas_reportes.sql:338` |
| Activar sin perfil transaccional: la base lo rechaza (`activacion_sin_perfil_transaccional`) | 25ª | `0030:2203-2205` (candado de la 0028 con `CREATE OR REPLACE`) |
| Celebración del contrato = primera activación aprobada (Ciudad de México) | 27ª | `0030:285` |
| Dos evaluaciones por año calendario con 6 meses o más desde la celebración | 27ª | `0030:409`, `src/server/pld/bandeja.ts` |
| Excede el perfil: la suma del mes calendario (CDMX), por tipo, supera el máximo declarado; una vez por mes | 27ª, párrafo tercero | `0030:722` |
| Monto atípico: una operación supera k veces la mediana de 6 meses, con historial mínimo | 41ª, fracción III | `0030:740` |
| Fraccionamiento: N o más instrucciones a la misma CLABE en la ventana, cada una bajo el umbral y juntas sobre él | 41ª, fracción VIII | `0030:766` |
| Nómina atípica: el lote supera el perfil o las personas suben más del porcentaje contra el promedio | 41ª, fracciones II y III | `0030:787` |
| Grado alto: cada umbral × 0.80 | 27ª, párrafo primero | `0030:471` (parámetro), aplicado en `0030:716` |
| Alertas en la misma transacción: al liberar un pago (`por_autorizar → listo_para_pagar`) y al preparar un lote de nómina | 54ª | `0030:836`, `0030:864` |
| Una alerta no bloquea la operación ni se avisa al cliente | 55ª | `0030:652` |
| Plazo de 60 días naturales por alerta | 40ª, 45ª | `0030:634` |
| Una serie del mismo cliente va en un caso; su plazo corre desde la alerta más antigua | 40ª | `0030:1084` |
| Reporte de 24 horas | 44ª | `0030:999`, `0030:1838` |
| Dictamen tardío: se registra marcado «fuera de plazo», nunca se impide | 40ª | `0030:1845` |
| Reporte dentro de los 3 días hábiles siguientes al dictamen | 40ª, 45ª | `0030:1847` |
| Días hábiles: sábado, domingo y los inhábiles que traen los dos instrumentos del DOF del 10-12-2025 (criterio conservador) | 40ª | `0030:191`, `0030:212` |
| «Falta el calendario 2027»: sin calendario del año solo cuentan sábados y domingos | 40ª | `0030:202` |
| Comité: al menos 3 titulares, un presidente, un secretario, un suplente por titular y el Oficial como integrante | 46ª-47ª | `0030:1381` |
| Quórum: la mayoría de los miembros; sin quórum la sesión no admite votos | 47ª | `0030:1534`, `0030:1583` |
| Mayoría de los presentes; en empate decide el presidente | 48ª | `0030:1632` |
| El auditor asiste con voz y sin voto; no cuenta para el quórum ni se comunica | 47ª | `0030:1432` |
| Suplente en más de 2 sesiones no continuas del semestre: aviso | 47ª | `src/server/pld/comite.ts:204` |
| Sesión del mes pendiente en modo Comité | 47ª | `src/server/pld/bandeja.ts:125` |
| Integración del Comité con los 14 campos y su comunicación en 15 días hábiles | 49ª | `0030:1244`, `src/server/pld/comite.ts:182` |
| Con menos de 25 personas dictamina el Oficial (ajuste por operador con bitácora) | 47ª, último párrafo | `0030:1199` |
| Aviso manual: ni la persona mencionada ni el superior que marca quien avisa lo ven, aunque tengan Cumplimiento | 60ª, último párrafo | `0030:610`, `0030:958` |
| Clave CASFIM de la entidad y del supervisor; la clave de acceso al SITI no tiene dónde guardarse | 36ª, 72ª-1 | `0030:1925-1931` |
| 36ª: archivo de 41 columnas del trimestre; en ceros, columnas 1, 2, 4 y 5 | 36ª | `src/server/pld/periodicos.ts:173` |
| 37ª: sin formato oficial para SOFIPO, no se presenta | 37ª, transitoria Séptima | `src/app/operacion/(portal)/reportes/page.tsx:168` |
| 38ª: constancia interna mensual en ceros, 15 días hábiles después del último hábil del mes | 38ª | `src/server/pld/periodicos.ts:203` |
| Si aparece un tipo de operación en efectivo o internacional, una prueba truena | 36ª-38ª | `tests/pld/pld-postgres.test.ts:663` |
| Conservación: DELETE y TRUNCATE rechazados en las 6 tablas de operaciones y en las de PLD | 61ª | `0030:2217-2240`, `0030:64` |
| **Nueva:** una propuesta registrada después del día de la sesión no se vota en esa sesión | 40ª, 48ª | `0030:1610`; la pantalla de la sesión solo ofrece las anteriores |
| **Nueva:** el acuse del SITI no puede ser anterior al dictamen | 40ª | `0030:1911` |
| **Nueva:** un reporte periódico solo se genera y registra con el periodo cerrado | 36ª, 38ª | `0030:1982`, `src/server/pld/periodicos.ts:182` y `:215` |
| **Nueva:** el acuse de un periodo no puede ser del periodo mismo | 36ª, 38ª | `0030:1988` |
| **Nueva:** el dictamen (también el del Oficial), los parámetros y «quién dictamina» piden el segundo factor de los últimos 30 minutos | 54ª | `src/server/pld/dictamen.ts:45`, `parametros.ts:82`, `comite.ts:60` |

## Parámetros iniciales

Viven en `pld_parametros` (`0030:491`), versionados y de solo inserción. Cumplimiento los cambia desde Operación → Alertas PLD → «Parámetros de las reglas», con motivo, bitácora y segundo factor. **Todos son propuesta de Lever, por confirmar con el Manual de Cumplimiento**; los confirma el Oficial de Cumplimiento y los aprueba Gil.

| Parámetro | Valor | Regla | Fuente |
| --- | --- | --- | --- |
| k (veces la mediana) | 3.00 | Monto atípico | Propuesta de Lever para la 41ª fr. III |
| Historial mínimo | 10 operaciones | Monto atípico | Propuesta de Lever: con menos de 10 operaciones la mediana no dice nada |
| N (instrucciones) | 3 | Fraccionamiento | Propuesta de Lever para la 41ª fr. VIII |
| Ventana | 7 días | Fraccionamiento | Propuesta de Lever para la 41ª fr. VIII |
| Umbral | $100,000.00 MXN | Fraccionamiento | Propuesta de Lever; la DCG no da cifra |
| Personas sobre el promedio | 25 % | Nómina atípica | Propuesta de Lever para la 41ª fr. II y III |
| Factor de grado alto | 0.80 | Todas | Propuesta de Lever para la 27ª, párrafo primero |

## Desempeño

`tests/pld/reglas-postgres.test.ts` siembra 10,000 instrucciones de una empresa en el mes y mide con `EXPLAIN ANALYZE` lo que las reglas le agregan a registrar una más (el disparador `pld_operaciones_evaluar`). Fueron 200 muestras: **p50 2.277 ms, p95 3.513 ms, p99 3.837 ms y máximo 3.912 ms**, contra un criterio de p95 ≤ 25 ms. «Excede el perfil» y «fraccionamiento» usan índices (`pld_operaciones_mes_idx`, `pld_operaciones_clabe_idx`). La mediana de «monto atípico» recorre las operaciones de 6 meses de la empresa (2 ms con 10,200 renglones). Los planes completos están en `explain-reglas.txt`.

## Decisiones

- **Una alerta no bloquea la operación.** El único bloqueo es el de la LPB del #59. Nunca se avisa al cliente: la consola del cliente no muestra nada de PLD, ni en el HTML ni en la carga RSC (flujo 2).
- **Doble alerta de nómina.** Un lote que pasa el monto mensual declarado de nómina dispara «Excede el perfil» (27ª, por tipo) y «Nómina atípica» (41ª fr. II y III, el lote contra el perfil), como pide el brief. Son dos disposiciones distintas. En el flujo 6 el caso de Taller junta las 4 alertas de la serie.
- **Las canceladas cuentan.** `pld_operaciones` registra cada instrucción una sola vez: la primera vez que se libera un pago o se prepara un lote, aunque después se cancele o regrese a revisión. El cliente ya la pretendió realizar (2ª fr. XXIX, `0030:551`). Por eso las sumas de «Excede el perfil» y de «Fraccionamiento» incluyen instrucciones canceladas, y la alerta lo dice: «Incluye instrucciones canceladas.» (`src/components/operacion/pld/formato.ts:28` y `:32`).
- **La nómina se evalúa al final de la transacción.** El disparador del lote es diferido (`0030:863`): corre cuando el lote ya tiene a todas sus personas.
- **Internas preocupantes (45ª).** En Lever el personal de la SOFIPO no ejecuta operaciones de clientes, así que la circunstancia II no tiene regla automática. Van por aviso manual (54ª VIII y 60ª), que puede emitir cualquier persona del personal.
- **Jerarquía.** Lever no modela quién es superior de quién: quien emite el aviso puede marcar a su superior como excluido, con el mismo mecanismo que la persona mencionada.
- **Celebración del contrato (27ª).** Es la fecha, en hora de la Ciudad de México, de la primera activación aprobada de la empresa: antes de ella la empresa no opera. Es una sola función (`pld_celebracion_contrato`). Si el Oficial fija otra fecha, como la aceptación del contrato en línea, se cambia ahí y las reglas no se tocan. **La confirma Gil.**
- **Segundo factor.** Lo que decide pide el segundo factor de los últimos 30 minutos, como las demás decisiones de Operación: el dictamen (también el del Oficial en modo «Oficial»), los parámetros y «quién dictamina». La pantalla ofrece «Confirma que eres tú» ahí mismo. **Lo que registra no lo pide:** el acuse del SITI, los integrantes, los votos, la propuesta y las notas. Igual que el folio de la LPB del #59, el registro solo deja constancia de algo que ya pasó fuera de Lever o que otra decisión con factor confirma.
- **Días hábiles.** Mientras el Oficial no confirme cuál de los dos calendarios del DOF rige, cuenta como hábil cualquier día que alguno de los dos considere hábil, y solo es inhábil lo que traen ambos. Contar de menos nunca vence tarde.
- **Avisos de PLD dentro de `aviso.tsx`.** PLD no da texto a un código que el resto del producto también lanza: se vería en las pantallas del #59. Solo se comparten `cliente_ausente`, `formulario_ya_aplicado` y `conservacion_no_se_borra`, que dicen lo mismo en todas. Lo comprueba `src/components/operacion/pld/avisos.test.ts`.
- **Estados de las pantallas.** «Cargando» es el progreso de cada enlace (`ProgresoEnlace`) más «Enviando…» de `BotonEnviar`, como en el #59. `tests/operacion/navegacion.test.ts` prohíbe un `loading.tsx` global en `(portal)`. El error es el `(portal)/error.tsx` compartido, vacío es `Vacio` y sin permiso es `SinPermiso`.

## Geolocalización (diseño; no se codifica en este PR)

El contrato y las operaciones de Lever son no presenciales (4ª Bis, 26ª y 2ª XVII). El estudio completo está en `investigacion-r2.md` §4.

- **Cuándo:** una vez por sesión (una captura ampara la sesión activa, 26ª párrafo 3) y al celebrar el contrato de forma no presencial, cuando el cliente acepta la invitación o el contrato (4ª Bis).
- **Cómo:** primero la API de ubicación del navegador, con su propio consentimiento previo. Si el dispositivo no da su ubicación, coordenadas por IP, también con consentimiento previo.
- **Qué se guarda:** la fuente («navegador» o «IP»), la precisión, la IP, la fecha y hora y la evidencia del consentimiento (texto y versión aceptados). En una tabla de solo inserción con RLS forzada.
- **Nunca se etiqueta como «GPS»:** el navegador no declara de dónde saca la ubicación.
- **No aplica** a las entidades del Anexo 1 con grado bajo (26ª, párrafo 4).
- **Pendiente de Gil:** el proveedor de IP (cabeceras de Vercel, MaxMind GeoLite local o el servicio de MaxMind) y el texto del consentimiento. Hasta que se decida no se codea.

## Conservación de 10 años (61ª)

| Tabla | DELETE | TRUNCATE |
| --- | --- | --- |
| `supplier_payment_requests`, `supplier_payment_request_history` | ya lo rechazaba la 0022; la 0030 agrega `conservacion_no_se_borra` | ya lo rechazaba la 0022; la 0030 lo cubre |
| `postings` | ya lo rechazaba la 0008; la 0030 agrega la marca | ya lo rechazaba la 0008; la 0030 lo cubre |
| `payroll_batches`, `payroll_batch_items` | lo rechazaba la 0023 | **nuevo en la 0030** |
| `expected_collections` | lo rechazaba la 0026 | **nuevo en la 0030** |
| Todas las tablas `pld_*` | solo inserción desde la 0030 (`pld_inmutable`) | rechazado desde la 0030 |

Antes de bloquear se buscó cada `DELETE FROM` de esas seis tablas en la aplicación y no hay ninguno. La aplicación nunca borra documentos de PLD en Blob.

El **manifiesto de conservación** (Operación → Conservación) lo descargan Cumplimiento y Auditoría por empresa y periodo. Sale en streaming como NDJSON: el conteo de filas por tabla y el SHA-256 y la ruta de cada documento. Deja el evento `pld_manifiesto_descargado` en la bitácora. Ejemplo real: `datos/manifiesto-taller.ndjson`.

**Lo que falta:** el destino de la exportación periódica, fuera de Neon y de Blob, lo decide Gil con el Oficial de Cumplimiento (HANDOFF §13). Este PR deja los datos sin borrar y el manifiesto verificable, pero no exporta.

## Flujos y su evidencia

| Flujo | Qué se comprobó con clics | Capturas |
| --- | --- | --- |
| 1. Perfil transaccional | Activar Nogal sin perfil: la base lo rechaza. Omar declara el perfil (doble clic = 1 perfil). Ana aprueba la activación | `01-f1`, `02-f1`, `03-f1` |
| 2. Excede el perfil | El pago se autoriza sin bloqueo; aparece «Excede el perfil» con sus días restantes; la consola del cliente (HTML y RSC) no muestra nada de PLD | `04-f2` a `06-f2` |
| 3. Fraccionamiento | Tres instrucciones bajo el umbral a la misma CLABE en 7 días: alerta | `07-f3` |
| 4. Nómina atípica | Se prepara la nómina de Marta (doble clic = 1 lote): $18,500.00 contra $15,000.00 declarados; alerta «Nómina atípica» y la nómina del cliente no dice nada | `08-f4`, `09-f4` |
| 5. Aviso manual | Omar avisa (doble clic = 1 aviso) y menciona a Aurelio, de Auditoría: Celia lo ve; Aurelio no lo ve, ni en su bitácora; Omar ve su acuse con folio y sin el texto; la bitácora de Administración no lo muestra, aunque el evento existe | `10-f5` a `13-f5` |
| 6. Análisis | Nota, documento de soporte (doble clic = 1 documento, con SHA-256) y propuesta | `14-f6` |
| 7. Comité | La validación rechaza un segundo presidente, menos de 3 titulares y la falta del Oficial sin guardar a nadie; 5 integrantes (doble clic = una vez) con su aviso de la 49ª al 20-nov (15 días hábiles sin el 2 ni el 16); auditor aparte; sesión sin quórum sin botones de voto; sesión con quórum, empate 2-2 que decide el presidente; acta en PDF y firmada; el dictamen con factor de hace 31 minutos pide «Confirma que eres tú»; el otro caso «no reportar» sin reporte | `15-f7` a `22-f7` |
| 8. Plazo de 3 días hábiles | Sesión del viernes 30-oct; con el 2-nov inhábil el reporte vence el 5-nov (cálculo aparte); con el reloj en el 3-nov la bandeja dice «Quedan 2 días hábiles»; acuse a tiempo (doble clic = 1); borrador de 41 columnas | `01-f8`, `02-f8` |
| 9. Fuera de plazo | Día 60: «Vence hoy»; día 61: «Fuera de plazo»; modo Oficial con factor; el Oficial dictamina sin sesión y la base lo marca | `03-f9` a `05-f9` |
| 10. Relevantes (36ª) | Sin clave CASFIM la bandeja lo dice y no hay archivo; con clave, el archivo de jul-sep en ceros (41 columnas, llenas 1, 2, 4 y 5); acuse con la huella del archivo; la 37ª «sin formato oficial para SOFIPO»; el trimestre en curso no ofrece archivo | `06-f10`, `07-f10` |
| 11. Constancia 38ª | Octubre vence el 24-nov (15 días hábiles sin el 2 ni el 16 de noviembre); constancia en ceros; con el reloj en el 4-ene-2027, «Falta el calendario 2027» en reportes y en la bandeja | `08-f11` a `10-f11` |
| 12. Evaluación semestral | Cobre (contrato de hace siete meses) aparece pendiente; Celia la registra (doble clic = 1) y el pendiente desaparece | `11-f12`, `12-f12` |
| 13. Conservación | DELETE y TRUNCATE rechazados como aplicación (sin permiso) y como dueña (`conservacion_no_se_borra`); manifiesto con el conteo de pagos y la huella de cada documento, y su evento en la bitácora | `13-f13` |
| 14. Visibilidad | Los 5 roles en cada pantalla nueva, en avisos y en la bitácora; el cliente va a la entrada SOFIPO; Aprobación ve el perfil sin nada de PLD; Auditoría no encuentra el caso que lo menciona | `14-f14` a `20-f14`, `datos/matriz-visibilidad.json` |

Las 10 pantallas de la fase de pantallas son: bandeja de Cumplimiento, Alertas PLD, caso, parámetros, Comité, sesión, reportes, conservación, avisos y expediente (perfil).

## Lo que falta y su dueño

| Pendiente | Dueño |
| --- | --- |
| El Manual de Cumplimiento y sus umbrales (los parámetros de arriba) | Gil con el Oficial de Cumplimiento |
| Si la SOFIPO tiene 25 personas o más (Comité u Oficial) y la integración real del Comité | Gil |
| La clave CASFIM de la entidad | Oficial de Cumplimiento (catálogo «Instituciones» del SITI) |
| La mecánica del reporte vacío de la 36ª en el SITI | Oficial de Cumplimiento |
| Si existe un formato de la 38ª para SOFIPO en el SITI | Oficial de Cumplimiento |
| El calendario de días inhábiles de 2027, cuando se publique, y cuál de los dos calendarios rige | Oficial de Cumplimiento; la carga, ingeniería |
| El proveedor de geolocalización por IP y el texto del consentimiento | Gil |
| El destino de la exportación de 10 años | Gil con el Oficial de Cumplimiento |
| La transmisión por el SITI PLD | El Oficial, a mano: Lever no transmite a la UIF ni a la CNBV |
| La celebración del contrato (hoy: primera activación aprobada) | Gil |

## Lo que confirma Gil antes de publicar

1. Una alerta PLD no bloquea la operación; solo bloquea la LPB.
2. Los umbrales iniciales son provisionales hasta que el Manual de Cumplimiento los fije. Cumplimiento los cambia con bitácora.
3. Lever arma los reportes y registra su envío, pero no los transmite.
4. La 36ª sale en ceros cada trimestre con el formato oficial. La 37ª no tiene formato para SOFIPO y no se presenta (transitoria Séptima). La 38ª queda como constancia interna en ceros hasta que el Oficial confirme el formato en el SITI.
5. El aviso manual nunca lo ven la persona mencionada ni el superior jerárquico de quien lo emite.
6. Mientras no se publique el calendario de 2027 y el Oficial no diga cuál rige, los plazos en días hábiles se cuentan con el criterio conservador.
7. Una propuesta registrada después del día de la sesión no se vota en esa sesión.
8. El acuse del SITI no puede ser anterior al dictamen.
9. Un reporte periódico solo se genera y registra con el periodo cerrado, y su acuse es posterior al cierre.
10. El dictamen, los parámetros y «quién dictamina» piden el segundo factor de los últimos 30 minutos; los registros (acuse, integrantes, votos, propuesta y notas), no.
11. La celebración del contrato es la primera activación aprobada.
12. Un lote de nómina que pasa el perfil da dos alertas («Excede el perfil» y «Nómina atípica»).
