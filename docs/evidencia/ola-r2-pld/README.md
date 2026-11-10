# Evidencia de la Ola R2: alertas PLD, reportes regulatorios y conservación de 10 años

Recorrido con clics reales de Playwright headless (`scripts/evidencia/ola-r2-pld.mjs`) contra `next build` + `next start`, sobre una base recién migrada (0001-0030, con la 0029 del #65) y sembrada por `scripts/evidencia/ola-r2-pld/preparar.ts`. Cada envío se hace con doble clic y la base confirma que quedó una sola operación. Corrida del 2026-11-10 (hora de la Ciudad de México) desde cero, con el código final: main con el #59 (ronda 13), el #65 y el #62 (CSP con nonce) integrados. Flujos y pantallas corren con la CSP real; solo el contraste abre su navegador con `bypassCSP`, porque tapa texto con estilos para medir el fondo.

| Fase | Resultado | Datos |
| --- | --- | --- |
| Flujos 1-7 | 164 comprobaciones en verde, 0 en rojo, consola limpia (231 s) | `datos/resultados-f1-f2-f3-f4-f5-f6-f7.json` |
| Flujos 8-14 | 198 comprobaciones en verde, 0 en rojo, consola limpia (217 s) | `datos/resultados-f8-f9-f10-f11-f12-f13-f14.json`, `datos/matriz-visibilidad.json`, `datos/manifiesto-taller.ndjson`, `datos/manifiesto-taller-aurelio.ndjson` |
| Flujo 15 (r2-fix-N1 y r2-fix-N2) | 32 comprobaciones en verde, 0 en rojo (128 s). La consola de Ciro solo trae los avisos de 404 de las visitas a propósito a la sesión oculta y a una inexistente | `datos/resultados-f15.json` |
| Flujo 16 (parámetros, «quién dictamina» y 24 horas que conservan lo capturado) | 19 comprobaciones en verde, 0 en rojo (120 s) | `datos/resultados-f16.json` |
| Flujo 17 (C: empresas de demostración) | 9 comprobaciones en verde, 0 en rojo (23 s) | `datos/resultados-f17.json` |
| Flujo 18 (B: activas sin perfil) | 16 comprobaciones en verde, 0 en rojo (41 s) | `datos/resultados-f18.json` |
| Pantallas: 10 pantallas × 3 temas × 1440/390 | 180 en verde: un solo h1, cada campo con etiqueta, ningún control ni texto fuera de su caja, el viewport de 390 no se ensancha, axe sin violaciones, consola limpia. Con la décima ronda del #59 el expediente a 390 ya no se ensancha y desaparecen las 63 notas de axe del logotipo y de la bandeja | `datos/resultados-pantallas.json` |
| Contraste AA medido (448 textos por tema a 1440 y 164 a 390) | 6 en verde; mínimo 4.96 (Lever 1440), Claro 5.01, Oscuro 5.06 | `datos/resultados-contraste.json`, `datos/contraste.json` |
| R1 completo con la 0030 (`scripts/evidencia/ola-r-alta.mjs`) | Sobre el head final (main con el #59, el #65 y el #62; la vuelta sin JavaScript por fragmento): flujos 157 y pantallas y contraste 60 en verde; regresiones (proceso aparte, tope de 20 min) 273 de 273 en 10 corridas seguidas desde cero. El rojo intermitente de la quinta vuelta quedó resuelto en la sexta | `r1/`, `sexta/r1-10-corridas.txt` |
| Sondas de los revisores del #61 (las de 7165f52 con sus cuatro nuevas, más `sonda-n2-acta` y N4 de 18d04ab), vueltas a correr en 3ca7449 | Todas del lado seguro | `sondas/LEEME.md` |
| `EXPLAIN ANALYZE` de las reglas con 10,000 instrucciones en el mes | Presupuesto de producto p95 ≤ 25 ms en local: 8.0 a 10.8 ms en cinco corridas de 300 muestras sobre el head final (6.87 con el código de 4147745). En el CI: guarda de planes determinista y topes p50 ≤ 40 / p95 ≤ 80 ms (red gruesa; la serie del CI dio p95 37.0, 29.2 y 38.6) | «Desempeño», `explain-reglas.txt` y `costo/guarda-y-tiempos.txt` |

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
5. `tsx scripts/evidencia/ola-r2-pld/preparar.ts`: migra desde cero y siembra Taller del Cierre con su perfil (pagos $50,000.00 al mes, nómina $15,000.00) y dos pagos por autorizar a la misma CLABE; Marta con nómina semanal de $18,500.00; Nogal Comercial en alta, sin perfil y con la activación pedida; Cobre Industrial activa, con la activación aprobada hace siete meses (celebración del contrato 2026-04-08); y al personal SOFIPO: Ofelia administra, Omar origina, Ana aprueba, Celia cumple y es la Oficial, Ciro también es de Cumplimiento (lo usa el flujo 15) y Aurelio audita. Cada quien con su app autenticadora y una sesión SOFIPO.
6. `next start -p 4813` con `DATABASE_URL` de la aplicación (la deja `ESTADO`), `NODE_ENV=production` y `NODE_OPTIONS="--import=tests/e2e/blob-local/preload.mjs --import=tests/pld/reloj-preload.mjs"`.
7. Sobre la misma base y en este orden: `FASES=f1,f2,f3,f4,f5,f6,f7`, `FASES=f8,f9,f10,f11,f12,f13,f14`, `FASES=f15`, `FASES=f16`, `FASES=pantallas` y `FASES=contraste`, cada uno con `node scripts/evidencia/ola-r2-pld.mjs`. `FASES=flujos,pantallas,contraste` corre todo de una vez.
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

Medido en la corrida de `test:db` del 2026-11-10, con el código de 4147745, en Postgres 17 local.

- **Reglas (r2-base-N11).** `tests/pld/reglas-postgres.test.ts` siembra 10,000 instrucciones de una empresa en el mes, el escenario del brief, y mide con `EXPLAIN ANALYZE` lo que las reglas le agregan a registrar una más (el disparador `pld_operaciones_evaluar`). Fueron 200 muestras: **p50 6.053 ms, p95 6.869 ms, p99 9.016 ms y máximo 9.319 ms**, contra el presupuesto de producto de p95 ≤ 25 ms, que se mide en local. «Excede el perfil» y «fraccionamiento» usan sus índices (`pld_operaciones_mes_idx`, `pld_operaciones_clabe_idx`). «Monto atípico» ya no recorre la tabla: lee solo el índice `pld_operaciones_tiempo_idx` (11,961 renglones en 2.25 ms). Las tres sumas descartan la versión que una corrección reemplazó (r2-base-N1). Los planes completos están en `explain-reglas.txt`.
- **Cómo lo comprueba el CI (decisión del líder).** El tope de 25 ms en la máquina del CI falló una vez (p95 30.73 ms en 10112ab) sin que cambiaran las reglas: esa máquina es unas 3 veces más lenta que la local (p50 de 20.4 a 21.3 ms contra 6.3; p95 de 21.0 a 30.7 en cuatro corridas). La prueba ahora tiene dos partes. (1) Una guarda determinista: con `plan_cache_mode = force_generic_plan`, como las ejecuta PL/pgSQL, el plan de cada una de las 8 consultas de `pld_evaluar_operacion` usa su índice y no hace Seq Scan sobre `pld_operaciones`, `pld_alertas`, `pld_perfiles`, `kyb_calificaciones_riesgo` ni `audit_log`; además revisa que esas consultas sigan en la función. Quitar cualquiera de los 6 índices la hace caer. (2) El tiempo con calentamiento y 300 muestras, con topes del CI de p50 ≤ 40 ms y p95 ≤ 80 ms, reportando p50, p95 y p99. La serie del CI con las mismas reglas: p50 21.0, 21.8 y 25.1 ms y p95 37.0, 29.2 y 38.6 ms en aea742b, f1711c5 y 798e4a5; la tercera rebasó el tope de p50 ≤ 25 sin que cambiara nada, así que (decisión del líder) la guarda de planes queda como la prueba de regresión y los topes del CI pasan a p50 ≤ 40 ms y p95 ≤ 80 ms como red gruesa. Cinco corridas seguidas en local con la Mac ocupada: p50 de 6.4 a 8.7 ms y p95 de 8.0 a 10.8 ms. El presupuesto de producto sigue siendo p95 ≤ 25 ms medido en local (`costo/guarda-y-tiempos.txt`).
- **Bandeja de alertas (r2-base-N10).** Con 20,000 alertas, la consulta elige primero las 500 que se muestran y después une. Sin casos: p50 2.08 ms y p95 3.50 ms; con una persona excluida, p95 2.92 ms. Con 19,500 alertas ya en casos, el peor caso para el anti-join: CUM p95 16.6 ms y CUM2 p95 18.4 ms. El presupuesto de producto es p95 ≤ 100 ms, medido en local sin carga. Antes del arreglo, la misma consulta tardaba 2,358 ms. En el CI (p95 de 74 a 76 ms con casos) la prueba exige la forma del plan como la ve la aplicación: las 500 se eligen con `pld_alertas_operador_idx`, `companies` y `pld_operaciones` se unen después del `Limit` y con índice, con casos el anti-join usa `pld_caso_alertas_una_vez`, y nada hace Seq Scan sobre lo que crece; quitar cualquiera de esos dos índices la hace caer. El tiempo lleva calentamiento y 200 muestras, con topes del CI de p50 ≤ 120 ms y p95 ≤ 200 ms. Cinco corridas seguidas en local con la Mac ocupada: con casos, p95 de 18.8 a 35.7 ms (`costo/guarda-y-tiempos.txt`).
- **Exclusión de la 60ª.** Las políticas evalúan una sola vez por consulta la lista de lo que excluye a quien lee (un InitPlan con `(SELECT f())::uuid[]`), no una función por renglón.

## Decisiones

- **Una alerta no bloquea la operación.** El único bloqueo es el de la LPB del #59. Nunca se avisa al cliente: la consola del cliente no muestra nada de PLD, ni en el HTML ni en la carga RSC (flujo 2).
- **Doble alerta de nómina.** Un lote que pasa el monto mensual declarado de nómina dispara «Excede el perfil» (27ª, por tipo) y «Nómina atípica» (41ª fr. II y III, el lote contra el perfil), como pide el brief. Son dos disposiciones distintas. En el flujo 6 el caso de Taller junta las 4 alertas de la serie.
- **Las canceladas cuentan.** `pld_operaciones` registra cada instrucción una sola vez: la primera vez que se libera un pago o se prepara un lote, aunque después se cancele o regrese a revisión. Si el pago regresa, se corrige el monto o la CLABE y se libera otra vez, la versión nueva entra como otra instrucción que **reemplaza** a la anterior (r2-base-N1): las reglas la evalúan y las sumas cuentan solo la vigente. Liberar otra vez sin cambiar monto ni CLABE no agrega nada. El cliente ya la pretendió realizar (2ª fr. XXIX, `0030:551`). Por eso las sumas de «Excede el perfil» y de «Fraccionamiento» incluyen instrucciones canceladas, y la alerta lo dice: «Incluye instrucciones canceladas.» (`src/components/operacion/pld/formato.ts:28` y `:32`).
- **El perfil de una empresa activa (r2-base-N18, decisión del líder).** En alta, Originación declara el perfil directo, como antes. Ya activa, el cambio de Originación queda como propuesta y solo se aplica cuando Cumplimiento lo aprueba; Cumplimiento también puede rechazarlo con motivo. Cada paso deja su evento en la bitácora y la bandeja de Cumplimiento cuenta las propuestas pendientes (flujo 1).
- **Siempre hay alguien de Cumplimiento que ve un aviso (r2-base-N4).** Un aviso que excluiría a todas las personas activas de Cumplimiento se rechaza (`aviso_sin_cumplimiento`); el texto de quien avisa vuelve con lo capturado.
- **La sesión que votó un caso oculto no existe para la persona excluida (r2-fix-N1, 60ª).** Las políticas de `pld_sesiones` y `pld_actas` la quitan con `pld_sesiones_que_me_excluyen`, un solo conjunto por consulta. Leerla, generar su acta, subir el acta firmada y votar en ella responden `sesion_no_existe`, lo mismo que con una sesión que no existe, aunque ya tenga acta; su evento de bitácora tampoco se le muestra. Los indicadores de la 47ª en la pantalla del Comité (sesión del mes, meses cerrados sin sesión con quórum y avisos de suplentes) cuentan solo las sesiones que ve quien los mira (decisión del líder): a la persona excluida, una sesión oculta no le cuenta y le puede salir «falta». `pld_sesiones_para_reglas` se quitó: no tenía consumidores y le devolvía fecha y presentes de la sesión oculta. Hoy ninguna regla de la base alerta por un mes sin sesión; si hace falta, se diseña con su propia regla de visibilidad.
- **El acta firmada cierra la sesión (48ª, r2-fix-N1).** Un voto después del acta se rechaza (`sesion_con_acta`): el acta firmada es la votación completa. Votos y acta toman el candado de la sesión, así que no se cruzan. La pantalla de la sesión ya no ofrece votar y dice «El acta firmada cerró la sesión: lo que falte por votar va en una sesión nueva».
- **Ningún caso entra a una sesión de alguien a quien excluye (r2-fix2-N2).** Las personas de una sesión son quien la registró, quien subió su acta, quien dictaminó con ella y quien trabaja un caso votado ahí. Votar en ella un caso que excluye a una de esas personas se rechaza (`sesion_con_persona_excluida`), y sumar a un caso votado ahí un aviso que excluye a una de ellas también (`serie_con_persona_excluida`): de lo contrario la sesión desaparecería para quien la trabajó. Si la sesión ya votó un caso que excluye a quien vota, para esa persona no existe (`sesion_no_existe`).
- **Un rechazo no pierde lo capturado (inventario de PLD, pedido del líder).** Cada formulario de PLD con texto, fechas o casillas responde con `useActionState`: un rechazo vuelve sin recargar, con lo capturado, el campo marcado, el foco y el mensaje junto al campo; sin JavaScript, el POST responde 200 con lo mismo. Nada capturado va en la dirección. Abrir caso, sumar alerta y votar son botones; el acta firmada y el documento del caso son solo un archivo, que el navegador no deja reponer: ahí no hay nada que perder.
- **Cada texto entra completo en su tope (barrido del motivo largo, pedido del líder).** `audit_log.motivo` admite 500 caracteres. Los motivos del perfil (declaración, cambio, propuesta y resolución) van a la bitácora, así que su tope es 500 en el servidor, en el formulario y en el CHECK de su columna. La justificación de la evaluación semestral (2,000) va a `pld_perfiles.motivo` con CHECK de 2,000 y no a la bitácora. Ningún motivo se recorta: si uno llegara más largo a la bitácora, `auditarPld` lo rechaza con `motivo_largo` antes de escribir. Los demás textos de PLD (aviso, nota, propuesta, dictamen y 24 horas) ya coincidían con su columna y no llegan a `audit_log.motivo`.
- **Ningún aviso abierto se queda sin quien lo analice (r2-fix-N2, decisión del líder).** Suspender, dar de baja o quitar Cumplimiento a alguien se rechaza si deja un aviso abierto sin nadie de Cumplimiento activo que pueda verlo. Abierto quiere decir sin caso, con el caso sin dictamen o con dictamen «reportar» y sin el acuse del SITI. Si en la misma transacción se da de alta a otra persona de Cumplimiento, sí se puede. La base lo revisa al confirmar (`aviso_sin_analista`) con un candado por operador, el mismo del aviso con exclusiones (r2-base-N4) y el de sumar a un caso la alerta de un aviso: si corren a la vez, la que confirma después ve a la otra y se rechaza. **El texto no nombra el aviso, su folio ni la empresa:** lo ve Administración, que no ve PLD (55ª). Dice «Antes da de alta a otra persona de Cumplimiento: un aviso del personal quedaría sin quien lo analice.»
- **Si el factor vence mientras se escribe el dictamen (r2-serv-N17).** Camino elegido: la acción vuelve con lo capturado, en lugar de redirigir, y vuelve a leer la página, que ya muestra «Confirma que eres tú» arriba del formulario. Al confirmar, `router.refresh` conserva la justificación. Nada del caso va en la dirección, y nada se guarda en `sessionStorage`: el texto de un caso confidencial no se queda en el navegador.
- **La fecha de la sesión manda, y el registro tardío también cuenta (r2-base-N6).** Un dictamen queda «fuera de plazo» si la sesión fue después del vencimiento o si se registró después. La pantalla del Comité lista los meses cerrados sin sesión con quórum mientras dictamina el Comité (40ª).
- **El SITI recibe área y cargo sin acentos (r2-base-N15, decisión del líder).** En el aviso de la 49ª, área y cargo salen en mayúsculas y sin acentos con `unaccent`; la Ñ se queda. En pantalla se ven como se capturaron. Los nombres ya iban así.
- **Ningún texto libre sale como fórmula (r2-base-N16, decisión del líder).** Nada se rechaza al capturar. Al exportar, un campo de texto libre que empieza con `=`, `+`, `-`, `@`, tabulador o retorno de carro lleva un espacio antes: las 41 columnas, la constancia de la 38ª, el reporte de 24 horas y el manifiesto. Los archivos siguen en UTF-8; **la codificación que acepta el SITI la confirma el Oficial de Cumplimiento.**
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
| 1. Perfil transaccional | Activar Nogal sin perfil: la base lo rechaza. Omar declara el perfil (doble clic = 1 perfil) y Ana aprueba la activación. Ya activa, Omar propone un cambio (doble clic = 1 propuesta) que no toca el vigente; la bandeja de Cumplimiento lo lista, Omar no ve «Aprobar el cambio» y Celia lo aprueba (doble clic = 1 resolución), cada paso con su evento (r2-base-N18). El perfil con «noventa mil» y la resolución con un motivo de puros invisibles se rechazan sin recargar y vuelven con lo capturado (inventario de PLD) | `01-f1` a `06-f1` |
| 2. Excede el perfil | El pago se autoriza sin bloqueo; aparece «Excede el perfil» con sus días restantes; la consola del cliente (HTML y RSC) no muestra nada de PLD | `07-f2` a `09-f2` |
| 3. Fraccionamiento | Tres instrucciones bajo el umbral a la misma CLABE en 7 días: alerta | `10-f3` |
| 4. Nómina atípica | Se prepara la nómina de Marta (doble clic = 1 lote): $18,500.00 contra $15,000.00 declarados; alerta «Nómina atípica» y la nómina del cliente no dice nada | `11-f4`, `12-f4` |
| 5. Aviso manual | Un aviso que el servidor rechaza vuelve sin recargar con la descripción, marcada y con el foco, sin texto en la dirección (r2-serv-N14). Omar avisa (doble clic = 1 aviso) y menciona a Aurelio, de Auditoría: Celia lo ve; Aurelio no lo ve, ni en su bitácora; Omar ve su acuse con folio y sin el texto; la bitácora de Administración no lo muestra, aunque el evento existe | `13-f5` a `17-f5` |
| 6. Análisis | Nota, documento de soporte (doble clic = 1 documento, con SHA-256) y propuesta. La propuesta rechazada conserva su justificación (r2-serv-N14) y la nota rechazada, su texto (inventario de PLD) | `18-f6`, `19-f6` |
| 7. Comité | La validación rechaza un segundo presidente, menos de 3 titulares y la falta del Oficial, con el campo marcado y el foco, sin guardar a nadie. Un RFC malo en el renglón 3 y un invisible en el renglón 2 marcan su campo; los 5 renglones vuelven con lo capturado (r2-serv-N1). 5 integrantes (doble clic = una vez) con su aviso de la 49ª al 20-nov (15 días hábiles sin el 2 ni el 16), sin acentos para el SITI (r2-base-N15); a 390 px el bloque del SITI se alcanza con Tab y se recorre con las flechas (r2-serv-N11). El auditor con el RFC o con el nombre de un integrante se rechaza (r2-base-N5, r2-serv-N2). Sesión sin presentes con el foco en la primera casilla (r2-serv-N6); sesión sin quórum sin botones de voto; empate 2-2 que decide el presidente; acta en PDF y firmada, también en PNG (r2-serv-N5); el dictamen con factor de hace 31 minutos pide «Confirma que eres tú»; si el factor vence mientras se escribe, al enviar lo pide y la justificación sigue escrita, también después de confirmar (r2-serv-N17); el dictamen rechazado conserva su justificación (r2-serv-N14); el otro caso «no reportar» sin reporte. La misma persona en los renglones 2 y 4 marca el RFC del 4 con el foco (r2-serv-N16). Sin recargar y con lo capturado (inventario de PLD): los dos auditores rechazados con el RFC marcado; la comunicación de la 49ª con un folio invisible y la primera casilla desmarcada; la sesión con la casilla del auditor marcada | `20-f7` a `38-f7` |
| 8. Plazo de 3 días hábiles | Sesión del viernes 30-oct; con el 2-nov inhábil el reporte vence el 5-nov (cálculo aparte); con el reloj en el 3-nov la bandeja dice «Quedan 2 días hábiles»; acuse a tiempo (doble clic = 1), después de un folio invisible que vuelve con lo capturado; borrador de 41 columnas | `01-f8`, `02-f8` |
| 9. Fuera de plazo | Día 60: «Vence hoy»; día 61: «Fuera de plazo»; modo Oficial con factor. En modo Oficial no hay «Registrar sesión», pero el historial de 3 sesiones y sus actas firmadas sigue a la vista (r2-serv-N13). El Oficial dictamina sin sesión y la base lo marca | `03-f9` a `05-f9` |
| 10. Relevantes (36ª) | Sin clave CASFIM la bandeja lo dice y no hay archivo; la clave del órgano supervisor rechazada queda marcada y con el foco (r2-serv-N6); con clave, el archivo de jul-sep en ceros (41 columnas, llenas 1, 2, 4 y 5); acuse con la huella del archivo, después de un folio invisible que vuelve con lo capturado; la 37ª «sin formato oficial para SOFIPO»; el trimestre en curso no ofrece archivo | `06-f10` a `08-f10` |
| 11. Constancia 38ª | Octubre vence el 24-nov (15 días hábiles sin el 2 ni el 16 de noviembre); constancia en ceros; con el reloj en el 4-ene-2027, «Falta el calendario 2027» en reportes y en la bandeja | `09-f11` a `11-f11` |
| 12. Evaluación semestral | Cobre (contrato de hace siete meses) aparece pendiente; un monto rechazado queda marcado y con el foco, y la opción, los montos y la justificación vuelven como se escribieron (r2-serv-N6, inventario de PLD); Celia la registra (doble clic = 1) y el pendiente desaparece | `12-f12` a `14-f12` |
| 13. Conservación | DELETE y TRUNCATE rechazados como aplicación (sin permiso) y como dueña (`conservacion_no_se_borra`); manifiesto con el conteo de pagos y la huella de cada documento, y su evento en la bitácora, que dice «Consultó un caso de análisis» al leerlo (r2-serv-N12). Las 6 descargas de PLD responden con la política aislada en `next start` (r2-serv-N8). Aurelio, mencionado en el aviso, baja el manifiesto: cada conteo es lo que su RLS le deja ver, sin la alerta ni el caso del aviso (r2-serv-N3) | `15-f13`, `datos/manifiesto-taller-aurelio.ndjson` |
| 14. Visibilidad | Los 5 roles en cada pantalla nueva, en avisos y en la bitácora; el cliente va a la entrada SOFIPO; Aprobación ve el perfil sin nada de PLD; Auditoría no encuentra el caso que lo menciona | `16-f14` a `22-f14`, `datos/matriz-visibilidad.json` |
| 15. Sesión oculta y personal | Omar avisa sobre Ciro (Cumplimiento); Celia regresa a modo Comité, abre el caso, propone y el Comité lo vota. Ciro no ve esa sesión en el Comité; su página, el acta generada y la subida del acta (el formulario de otra sesión apuntado a la oculta) le responden igual que con una sesión inexistente (404, «Acta no disponible», `sesion_no_existe`), antes y después de que Celia suba el acta completa, que nombra el caso. Con el acta, la sesión ya no ofrece votar. En Personal, quitarle Cumplimiento a Celia se rechaza con «Antes da de alta a otra persona de Cumplimiento…», sin evento; a Ciro sí se le quita y se le devuelve (r2-fix-N1, r2-fix-N2, r2-serv-N15) | `01-f15` a `06-f15` |
| 16. Parámetros, «quién dictamina» y 24 horas | Con el factor de hace 31 minutos, los parámetros nuevos y el motivo siguen escritos al pedir «Confirma que eres tú» y después de confirmar; un umbral de 50 centavos rechazado vuelve marcado y con el foco, con los 7 valores y el motivo como se escribieron, nada en la dirección ni en la base; doble clic = 1 versión con lo capturado. Lo mismo en «quién dictamina»: modo, persona y motivo siguen con el factor vencido; sin persona, la lista queda marcada y con el foco; doble clic = 1 cambio, y de regreso al Comité. En el caso abierto del aviso sobre Ciro, la marca de 24 horas rechazada conserva el motivo sin recargar; después, doble clic = 1 marca | `01-f16` a `05-f16` |

| 17. Empresa de demostración (C) | Fondo Demostración libera un pago de $250,000.00 sin perfil y PLD no registra nada: 0 operaciones y 0 alertas, mientras Taller, real, tiene las suyas. La bandeja de Cumplimiento nunca nombra a Fondo, y «Avisar a Cumplimiento» y el manifiesto no lo ofrecen. Su manifiesto pedido a mano dice «No encontramos esa empresa.» sin evento, y un aviso con su id puesto a mano en la lista se rechaza en el campo Empresa, con el foco, sin dejar aviso | `01-f17` a `03-f17` |
| 18. Empresa activa sin perfil (B) | Roble Antiguo, activa desde antes de la 0030 y sin perfil, aparece en «Empresas activas sin perfil transaccional (25ª)», sin Fondo (demostración), ni las que tienen perfil, ni la que está en alta; a 1440 y a 390 px. El enlace lleva al perfil del expediente, que dice que la empresa opera sin perfil. Omar propone (doble clic = 1 propuesta) y Roble pasa a «Por resolver»; la hoja desaparece. Celia aprueba (doble clic = 1 resolución): versión 1 con $180,000.00 de pagos, un evento de cada uno, y Roble ya no está en la bandeja | `01-f18` a `06-f18` |

Las 10 pantallas de la fase de pantallas son: bandeja de Cumplimiento, Alertas PLD, caso, parámetros, Comité, sesión, reportes, conservación, avisos y expediente (perfil).

## Revisión del #61: hallazgo → arreglo → prueba

La revisión de base (r2-base-N1 a N19) y la de servidor (r2-serv-N1 a N14) se hicieron contra 94303bc. La segunda vuelta (r2-fix-N1 y r2-fix-N2 de base; r2-serv-N15 a N17 de servidor) se hizo contra 18d04ab. La tercera (r2-fix2-N1 y r2-fix2-N2 de base; r2-serv-N18 y N19 de servidor) se hizo contra 7165f52; con ella van lo que pidió el líder en la misma ronda. Cada prueba de esta tabla se vio en rojo contra el commit revisado, o con el arreglo quitado, y en verde con el arreglo. Lo que es solo de pantalla se prueba con clics en el recorrido. Las sondas del revisor, vueltas a correr, están en `sondas/` con su `LEEME.md`.

Archivos de prueba: `pld-postgres` y `reglas-postgres` son `tests/pld/*.test.ts`; `pld.test` es `src/dominio/pld/pld.test.ts`.

### Base

| Hallazgo | Arreglo | Prueba | Recorrido o sonda |
| --- | --- | --- | --- |
| **N1 (P1)** Un pago corregido y liberado otra vez no pasaba por las reglas | `pld_operaciones` con `instruccion` y `reemplaza`: si cambió el monto o la CLABE, la versión nueva entra, se evalúa y reemplaza a la anterior en las sumas | `pld-postgres` «reenvío (r2-base-N1)…» | `sondas/sonda-reenvio.out` |
| **N2 (P1)** El acta firmada revelaba el caso a la persona excluida y al superior (60ª) | `pld_acta_para_descarga` y la política de `pld_actas` niegan con `documento_no_existe` si la sesión votó un caso que excluye a quien pide; el acta generada omite esos casos | `pld-postgres` «Comité: integración (47ª)…» | `sonda-60.out` A y B, `excluidos.out` |
| **N3 (P2)** 60ª: la alerta del caso oculto, el caso que desaparece y los conteos | `pld_alerta_me_excluye` en la política de alertas; `serie_con_persona_excluida` al sumar a un caso un aviso que excluye a quien ya lo trabaja; el manifiesto cuenta con el mismo filtro | `pld-postgres` «RLS cruzada…», «aviso del personal…», «manifiesto de conservación…» | `sonda-60.out` C y D, `excluidos.out` |
| **N4 (P2)** Un aviso podía excluir a todo Cumplimiento | Disparador diferido `aviso_sin_cumplimiento` | `pld-postgres` «aviso del personal…» | `sonda-60.out` E |
| **N5 (P2)** El auditor votaba y daba quórum; integrantes con el mismo RFC | RFC y CURP del auditor; `comite_persona_repetida` y `comite_auditor_integrante` en base y servidor, con aviso en el campo | `pld-postgres` «Comité…» y «análisis…» | `sonda-50.out`; flujo 7 |
| **N6 (P2)** Un dictamen de sesión fechada atrás salía a tiempo | `fuera_de_plazo` también por la fecha de registro de la sesión; los meses cerrados sin sesión con quórum se listan | `pld-postgres` «sesión con fecha atrasada (r2-base-N6)…» | `sonda-sesion-atrasada.out` |
| **N7 (P2)** Suma sobre un límite que bajó a mitad de mes y 0 alertas | Una alerta por empresa, tipo y mes con `NOT EXISTS` | `reglas-postgres` «excede el perfil (r2-base-N7)…» | `sonda-limite-exclusion.out` |
| **N8 (P2)** Carrera de reloj: la liberación que empezó antes no veía a la otra | `BEFORE INSERT` con el candado de la empresa y `ocurrida_en := clock_timestamp()` | `reglas-postgres` «carrera de reloj (r2-base-N8)…» | `sonda-carreras.out` C1 y C2 |
| **N9 (P2)** Una alerta entraba al caso mientras se dictaminaba | Candado por caso en lo que se agrega al caso (alertas, notas, documentos, propuestas, marca de 24 horas), en los votos y en el dictamen | `pld-postgres` «carrera (r2-base-N9)…» | `sonda-carreras.out` C3 |
| **N10 (P2)** Bandeja de 2,358 ms con 20,000 alertas | `NOT EXISTS` y `limit` antes de unir (`casos.ts`) | `reglas-postgres` «bandeja con 20,000 alertas (r2-base-N10)…», p95 ≤ 100 ms | «Desempeño» |
| **N11 (P3)** «Monto atípico» recorría la tabla; el escenario medido no era el del brief | Recorrido solo de índice; se mide con 10,000 instrucciones en el mes | `reglas-postgres` «costo: con 10,000 instrucciones en el mes…» | `explain-reglas.txt` |
| **N12 (P3)** El cliente podía ejecutar los cálculos de días hábiles sin tope | `REVOKE` a PUBLIC en los 6 definers y tope de rango | `pld-postgres` «días hábiles…» | |
| **N13 (P3)** 251 contra 252 días hábiles según el huso | `pld_dias_habiles_entre` con serie de enteros | `pld-postgres` «días hábiles…» | |
| **N14 (P3)** Los CHECK de folios, área y cargo aceptaban invisibles | `pld_sin_invisibles` en esos CHECK y en la identidad del auditor | `pld-postgres` «Comité…» | `sonda-invisibles.out` |
| **N15 (P3)** «DIRECCIÓN GENERAL» con acento para el SITI | Decisión del líder: `unaccent` en la salida; la Ñ se queda; en pantalla, con acentos | `pld.test` «r2-base-N15…»; `pld-postgres` «Comité…» | flujo 7 |
| **N16 (P3)** La columna 41 podía empezar con `=HYPERLINK(…)` | Decisión del líder: al exportar, espacio antes de `=`, `+`, `-`, `@`, tabulador o retorno de carro en todo texto libre; nada se rechaza al capturar | `pld.test` «r2-base-N16…»; `pld-postgres` «manifiesto…» | `sonda-reportes.out` |
| **N17 (P3)** Una exclusión sin persona en el contexto se aceptaba | Con el rol sofipo, `pld_aviso_excluidos_revisar` exige `app_usuario` (`exclusion_fuera_del_aviso`) | `pld-postgres` «aviso del personal…» | `sonda-limite-exclusion.out` |
| **N18 (P3)** Originación cambiaba el perfil de una empresa activa sin aprobación | Decisión del líder: ya activa, propuesta que Cumplimiento aprueba o rechaza, con evento | `pld-postgres` «perfil versionado y evaluaciones semestrales (27ª)» | flujo 1 |
| **N19 (P3)** «PEÑA ? PRESIDENTE» en el acta | `—`, `–`, comillas tipográficas, viñeta, `…` y `€` a sus bytes de WinAnsi (`pdf.ts`) | `pld.test` «r2-base-N19…» | flujo 7 (acta) |
| **fix-N1 (P1)** La persona excluida generaba el acta de la sesión que votó su caso («No se votaron casos») y la subía como firmada; después Cumplimiento ya no podía subir la completa. Con el acta oculta, su intento delataba `acta_ya_cargada` | La sesión y su acta no existen para ella: `pld_sesiones_lectura` y `pld_actas_escritura` con `pld_sesiones_que_me_excluyen`; leer, generar, subir y votar dan `sesion_no_existe`; su evento tampoco se le muestra. El acta firmada cierra la sesión (`sesion_con_acta`). Los indicadores de la 47ª cuentan después solo lo visible (ver «Tercera vuelta») | `pld-postgres` «Comité…» (en rojo contra 18d04ab en la línea 797: CUM2 generaba el acta) y «sesión oculta (r2-fix-N1)…» | flujo 15; `sondas/sonda-n2-acta.out` |
| **fix-N2 (P3)** Una baja posterior dejaba un aviso sin analista | Disparadores diferidos en `platform_staff` (suspensión y baja) y en `platform_staff_roles` (retiro de Cumplimiento) con `aviso_sin_analista`; candado `pld_analistas:` por operador, común con el aviso con exclusiones y con la alerta de un aviso que se suma a un caso | `pld-postgres` «personal (r2-fix-N2)…»: en rojo contra 18d04ab; tres carreras con dos conexiones; sin el candado, el aviso tardío se guarda sin analista; sin el disparador de la serie, la suma también | flujo 15 (Personal); `sondas/n4-baja.out` |

### Servidor

| Hallazgo | Arreglo | Prueba | Recorrido o sonda |
| --- | --- | --- | --- |
| **serv-N1 (P2)** Los errores de los renglones 2 a 5 de integrantes no marcaban su campo y se perdía lo capturado | `FormularioIntegrantes` con `useActionState`; `ErrorDeIntegrante` lleva el renglón; la acción devuelve el renglón y lo capturado, sin datos personales en la dirección | `pld-postgres` «Comité…» (renglón de cada error) | flujo 7: RFC malo en el renglón 3, invisible en el 2, los 5 renglones de vuelta |
| **serv-N2 (P2)** El auditor podía llevar el nombre de un integrante vigente | `pld_nombre_de_integrante` con `lpb_normalizar` en `pld_comite_validar` y en el registro del auditor | `pld-postgres` «Comité…» («Iván Núñez Peña», «IVAN NUNEZ PENA», «Peña Núñez, Iván» y al revés) | flujo 7; límite en `sondas/LEEME.md` |
| **serv-N3 (P2)** El manifiesto le contaba a la persona excluida lo que no puede ver | El arreglo de base-N3, probado también con Auditoría excluida | `pld-postgres` «manifiesto…» | flujo 13 (Aurelio); `excluidos.out` |
| **serv-N4 (P2, fuera de R2)** Sin JavaScript ningún formulario se envía (`Referrer-Policy: no-referrer` → `Origin: null`) | Llegó con la décima ronda del #59 (`Referrer-Policy: same-origin`). Al integrarla se conservó la excepción de las 6 descargas de PLD | `tests/e2e/pld.spec.ts` «sin JavaScript, agregar una nota al caso responde 303 con su aviso» | |
| **serv-N5 (P3)** El acta firmada solo aceptaba PDF | `tipoDeContenido` reconoce PDF, PNG y JPEG por sus bytes; se guarda el tipo detectado | `pld-postgres` «Comité…» (PNG, JPG y GIF rechazado) | flujo 7: acta en PNG |
| **serv-N6 (P3)** Campos sin marca o sin foco | Clave del órgano supervisor, montos de la evaluación y foco en la primera casilla de presentes. `campo-archivo.tsx` es del #59 y no se toca | Solo pantalla | flujos 7, 10 y 12 |
| **serv-N7 (P3)** «?» en el PDF del acta | Es base-N19 | | |
| **serv-N8 (P3)** Las 6 descargas de PLD perdían la política aislada | Las 6 rutas en la excepción de `next.config.ts` | `src/server/pld/descargas.test.ts` | flujo 13: las 6 en `next start` |
| **serv-N9 (P3)** Fórmula en la columna 41 | Es base-N16 | | |
| **serv-N10 (P3)** La sesión desbordaba a 390 px | Ya en 7ba925e | | pantallas: «sesión» a 390 sin desborde |
| **serv-N11 (P3)** El bloque del SITI no se alcanzaba con el teclado | `tabIndex={0}`, `role="region"` y `aria-label` en cada `.tabla-contenedor` de R2 | Solo pantalla | flujo 7: Tab y flechas a 390; axe sin `scrollable-region-focusable` |
| **serv-N12 (P3)** «Quedan 1 día»; «Abrió un caso» también al consultarlo | Singulares y «Consultó un caso de análisis» | `src/components/operacion/pld/formato.test.ts` | flujo 13 |
| **serv-N13 (P3)** En modo Oficial se ocultaba el historial de sesiones | Solo se oculta «Registrar sesión» | Solo pantalla | flujo 9 |
| **serv-N14 (P3)** El aviso, la propuesta y el dictamen rechazados volvían vacíos | `formularios-de-texto.tsx` con `useActionState`: vuelven con lo capturado, marcados y con el foco, sin texto en la dirección | Solo pantalla | flujos 5, 6 y 7 |
| **serv-N15 (P2)** Ana, excluida y con Cumplimiento, veía la sesión con «Sin acta firmada» y su formulario; al subir, «ya tiene su acta» delataba el acta oculta; el PDF quedaba huérfano en Blob | Lo oculta fix-N1, y la sesión y la exclusión se revisan antes de subir nada. Si el INSERT falla o un doble clic ya la registró, se borra lo subido, como en el expediente del #59; lo mismo en el documento del caso | `pld-postgres` «Comité…» (nada llega al almacén) y «subidas (r2-serv-N15)…»; sin el borrado, en rojo en la línea 1302 | flujo 15: página 404, «Acta no disponible», `sesion_no_existe` |
| **serv-N16 (P3)** La misma persona en los renglones 2 y 4 marcaba el RFC del 1 | El servidor detecta la repetición entre renglones y contra los integrantes vigentes, y marca el renglón que la repite | `pld-postgres` «Comité…»: en rojo contra 18d04ab en la línea 669 | flujo 7: el RFC del renglón 4 marcado y con el foco |
| **serv-N17 (P3)** Si el dictamen pedía el factor al enviar, se perdía la justificación | La acción vuelve con lo capturado y la página pide «Confirma que eres tú» (ver «Decisiones») | Solo pantalla | flujo 7: el factor vence mientras se escribe; el texto sigue antes y después de confirmar |

### Tercera vuelta (7165f52) y pedidos del líder en la misma ronda

| Hallazgo | Arreglo | Prueba | Recorrido o sonda |
| --- | --- | --- | --- |
| **fix2-N2 (P2)** CUM votaba, en la sesión que registró CUM2, un caso que la excluye: la sesión desaparecía para CUM2 y su caso ya no se dictaminaba con ella | `pld_voto_choca` y `pld_serie_choca` con las personas de la sesión: quien la registró, subió su acta, dictaminó con ella o trabaja un caso votado ahí (ver «Decisiones») | `pld-postgres` «sesión con persona excluida (r2-fix2-N2)…», en rojo contra 7165f52 (`sesion_con_persona_excluida` faltante); cinco carreras con dos conexiones; las 6 mutaciones de `pld_personas_de_la_sesion`, `pld_voto_choca` y `pld_serie_choca` caen (`mutaciones-fix2-n2.txt`). M2 (quien subió el acta) y M3 (quien dictaminó) pasaban hasta a39719d, que agrega sus dos casos | `sondas/sonda-sesion-propia.out` |
| **fix2-N1 (P3) y serv-N18 (P3)** «Revisar» + 13 × U+3164 pasaba como descripción de 20 y «a» + U+3164 como nota de 2 | La descripción del aviso y la nota cuentan solo caracteres visibles (`caracteresVisibles`), también U+2800 de la onceava ronda del #59 | `pld-postgres` «texto visible (r2-fix2-N1)…», en rojo contra 7165f52 (`dato_invalido_descripcion` faltante) | `sondas/sonda-visibles.out` |
| **serv-N19 (P3)** Sin JavaScript, un rechazo de un campo volvía con `#<hoja>-titulo` y el ancla le quitaba el foco al campo | `fallo()` y la ruta del manifiesto omiten el ancla cuando el aviso es de un campo | e2e «sin JavaScript, un rechazo de PLD conserva lo escrito…», en rojo con el ancla (`#entidad-titulo`) y sin el foco | |
| **47ª (decisión del líder)** A la persona excluida, «Sesión del mes» le salía cumplida por una sesión que no ve; `pld_sesiones_para_reglas` le devolvía su fecha y sus presentes | Los indicadores cuentan solo lo visible y la función se quitó (ver «Decisiones») | `pld-postgres` «sesión oculta (47ª, decisión del líder)…», en rojo contra 4bf0cd2 (CUM2 veía «sí»); `to_regprocedure` de la función es nulo | `sondas/sonda-regla-mensual.out` |
| **Parámetros y «quién dictamina»** Rechazados o con el factor vencido, volvían vacíos | `useActionState` con los 7 valores y el motivo; modo, persona y motivo | Solo pantalla | flujo 16 |
| **Llaves repetidas (líder)** `?aviso=a&aviso=b` en una página de PLD daba 500 sin `soloTexto` | Las páginas de PLD leen la dirección con `soloTexto` | e2e «una clave repetida en la dirección no tumba ninguna página de PLD», en rojo con la mutación (500 en `/operacion/pld`) | `llaves-repetidas/` |
| **Onceava ronda del #59** El mensaje del campo va junto al campo, con `aria-describedby` a `<aviso>-campo` | `MensajeDelCampo` en cada formulario de PLD que marca un campo | e2e sin JavaScript: el mensaje con id `aviso-entidad-campo`, `aviso-nota-campo` y `aviso-auditor-campo`, a 24 px o menos debajo del campo; `avisos.test.ts` espera `aviso-operacion-campo` (estaba en rojo desde el merge de 602af09) | flujos 1, 6, 7, 8, 10, 12 y 16 |
| **Inventario de PLD (líder)** 11 acciones redirigían en un rechazo y perdían lo capturado | Pasan a `useActionState` con `rechazado()`; las casillas vuelven como estaban (ver la tabla de abajo) | e2e «sin JavaScript, un rechazo de PLD conserva lo escrito…» (clave CASFIM, nota y RFC del auditor, a 1440 y 390), en rojo contra 4bf0cd2 (303 en lugar de 200); e2e «sin JavaScript, el manifiesto con un periodo al revés…», en rojo contra 4bf0cd2 (`#manifiesto-titulo`) | flujos 1, 6, 7, 8, 10 y 12 |
| **Barrido del motivo largo (líder)** La justificación de 2,000 de la evaluación chocaba con el CHECK de 1,000 de `pld_perfiles.motivo` (salía `motivo_corto`); los motivos del perfil (1,000) se recortaban a 500 en la bitácora; la primera declaración tiraba el motivo sin avisar | Motivos del perfil de 500 en servidor, formulario y CHECK; `pld_perfiles.motivo` con CHECK de 2,000; `auditarPld` rechaza con `motivo_largo` en lugar de recortar (ver «Decisiones») | `pld-postgres` «topes de texto (barrido del motivo largo)…»: el tope exacto entra completo y el tope + 1 se rechaza en aviso, nota, propuesta, 24 horas, quién dictamina, dictamen, parámetros, sustitución, perfil declarado, primera declaración, propuesta y resolución del perfil y evaluación; en rojo contra dd7329f (el perfil declarado de 501 se aceptaba) | |

#### Inventario de los formularios de PLD

| Formulario | Antes de esta ronda | Ahora |
| --- | --- | --- |
| Aviso, propuesta y dictamen | Conservaban (r2-serv-N14, N17) | Igual |
| Parámetros y «quién dictamina» | Redirigían | Conservan (flujo 16) |
| Integrantes del Comité | Conservaban (r2-serv-N1) | Igual |
| Perfil declarado o propuesto, resolución de la propuesta, evaluación semestral | Redirigían | Conservan (flujos 1 y 12) |
| Nota, marca de 24 horas, acuse del caso | Redirigían | Conservan (flujos 6, 16 y 8) |
| Auditor, comunicación de la 49ª (con sus casillas), sesión (con sus presentes) | Redirigían | Conservan (flujo 7) |
| Claves CASFIM, acuse de la 36ª y constancia de la 38ª | Redirigían | Conservan (flujo 10) |
| Abrir caso, sumar alerta, votar | Botones | Nada que perder |
| Acta firmada y documento del caso | Solo un archivo, que el navegador no deja reponer | Nada que perder |
| Manifiesto de conservación (GET) | Volvía sin empresa, fechas ni página | Vuelve con empresa, fechas, página y cursor, sin ancla en un aviso de campo |

### Hallado en el recorrido de cierre

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| Las casillas y opciones de R2 heredaban el estilo de un campo de texto (casilla de 40 px y el texto abajo); la CURP invadía la otra columna de la tabla de integrantes a 390 px | 4147745: `fieldset.opciones` con `label.confirmacion`; `data-rotulo` en la tabla y corte de claves largas en celdas mono angostas | Pantallas: «ningún control ni texto se sale de su caja», en rojo antes en Comité 390 y en la evaluación del expediente |
| El flujo 9 se detuvo en «Confirma que eres tú»: el servidor rechazó el código de Celia como ya usado (bitácora: `reautenticacion` a las 18:15:00 y `reautenticacion_fallida` a las 18:15:24, el mismo paso de 30 s), porque cada fase corre en su propio proceso y el recorrido solo recordaba en memoria el último paso. El rechazo es correcto | 4656f59: el recorrido lee también el último paso aceptado de `auth_totp` | El recorrido completo desde cero, en verde |

### Cuarta vuelta (3ff5e27) y pedidos del líder

| Hallazgo | Arreglo | Prueba | Recorrido o sonda |
| --- | --- | --- | --- |
| **C (líder)** Una empresa de demostración entraba a PLD: sus pagos y lotes eran operaciones y alertas, y aparecía en evaluaciones, en «Avisar a Cumplimiento» y en el manifiesto | Los registradores de pagos y nómina dejan fuera a las de demostración; `pld_operaciones_antes` rechaza `pld_empresa_de_demostracion` y el aviso, `aviso_empresa_demostracion`; la marca no cambia en ningún sentido (`companies_demostracion_no_dinero`, de la 0020); servidor y pantallas sin ellas (`empresasParaPld`, evaluaciones, manifiesto) | `pld-postgres` «empresas de demostración (C)…», en rojo con la 0030 de 7df4243 (`demostracion/01-…`) y con cada arreglo quitado (`demostracion/02-mutaciones.txt`) | flujo 17; base poblada 13 |
| **fix3-N2 (P2)** Quien la sesión oculta excluye veía, en la bitácora, el manifiesto y `pld_votos`, los votos que registró en esa sesión sobre un caso que sí ve | `pld_ids_que_me_excluyen` suma los votos de las sesiones que me excluyen y `pld_votos_lectura` filtra por sesión | `pld-postgres` «votos de la sesión oculta (r2-fix3-N2)…», en rojo contra 3ff5e27 y con cada mitad quitada (`fix3/n2-mutaciones.txt`) | |
| **fix3-N3 (P2), sesiones aparte (decisión del líder)** Un caso con reserva entraba a la sesión de un caso sin reserva o con otra, y una alerta nueva que señala a alguien del personal se sumaba a la serie de un caso ya votado | `pld_voto_choca`: un caso entra a una sesión solo con su misma reserva (`sesion_con_otra_reserva`); `pld_serie_choca` (`serie_con_otra_reserva`); el orden es `sesion_no_existe`, luego la persona y luego la reserva. Textos: «Este caso va en otra sesión del Comité.» y «Esta alerta va en su propio caso: el caso ya se votó en el Comité.» | `pld-postgres` «sesión con persona excluida (r2-fix2-N2) y sesiones aparte (r2-fix3-N3)…», con O9, S6 y S7 y siete mutaciones en rojo (`fix3/n3-mutaciones.txt`); e2e «Comité: un caso con reserva no se vota…», en rojo sin la regla (`fix3/n3-e2e.txt`) | sonda «aparte» del revisor: 32 de 33 (`fix3/sonda-aparte.out`; C2/s se queda como está, ver el punto 17) |
| **Higiene (P3)** 31 funciones de disparador y 5 de invocador de PLD tenían EXECUTE de PUBLIC | `REVOKE EXECUTE … FROM PUBLIC` en todas las `pld_` y `GRANT EXECUTE` explícito a `plataforma_sofipo` de las tres de invocador que solo tenía por PUBLIC | `pld-postgres` «permisos de las funciones de PLD…» (PUBLIC 0; app, cliente y tarea 0; la SOFIPO, las 32 que usa), en rojo sin el REVOKE y sin el GRANT (`fix3/higiene-execute.txt`) | base poblada 10 |
| **A (líder)** La 0030 podía esperar un candado hasta 15 s, y detrás de ella cualquier escritura normal | `SET LOCAL lock_timeout = '2s'` como primera sentencia; si falla, se reintenta (ver «Aplicación sobre base poblada») | `migracion-postgres`: lectura larga de `audit_log` y escritura larga en `companies`, en rojo sin el `SET LOCAL` (`fix3/a-lock-timeout.txt`) | base poblada 14 |
| **B (líder)** Las empresas activas desde antes de la 0030 no tienen perfil y nada lo pedía | Hoja «Empresas activas sin perfil transaccional (25ª)» en la bandeja de Cumplimiento, con enlace al perfil | `pld-postgres` «empresas activas sin perfil (B, 25ª)», con cuatro mutaciones en rojo (`fix3/b-sin-perfil.txt`) | flujo 18; base poblada 13 |

### Quinta vuelta: doceava y ronda 13 del #59 integradas, N20-N24, r65-N1 y pedidos del líder

| Hallazgo | Arreglo | Prueba | Evidencia |
| --- | --- | --- | --- |
| **CAMPOS_CON_AVISO_PLD (por la doceava del #59)** `AvisoOperacion` solo pinta un `dato_invalido_<campo>` de un campo de `CAMPOS_CON_AVISO`; nueve campos de PLD sin mensaje propio (los 7 parámetros, `claveCasfim` y `claveOrganoSupervisor`) dejaban de pintar su rechazo | 56f6aa1: `CAMPOS_CON_AVISO_PLD` los suma | `src/components/operacion/pld/avisos.test.ts` revisa cada código de PLD, también los que arman sus ayudantes; en rojo sin la lista (`dato_invalido_fraccionUmbral`) | commit 56f6aa1 |
| **r2-serv-N20 (P2)** Las redirecciones de PLD llevaban `#sección` y el aviso del envío anterior seguía visible | 58c5639: `listo()`, `fallo()` y las rutas del manifiesto y del archivo de reportes sin fragmento; los formularios usan `useAvisoVigente` del #59 | `pistas.test.ts` también sobre las acciones y rutas de PLD; e2e en `pld.spec.ts`; rojo por mutación de cada arreglo | `doceava/n20-n21-b5-rojo-verde.txt` |
| **r2-serv-N21 (P2)** Un rechazo de PLD no pasaba por el `rechazado()` del #59 | 58c5639: el código va en la cookie vencida y, si el formulario ya no se pinta, la página lo pinta arriba (`#aviso-rechazo`) | e2e en `pld.spec.ts` con su rojo por mutación | `doceava/n20-n21-b5-rojo-verde.txt` |
| **B5** Sin JavaScript el foco no llegaba al campo rechazado en perfil, evaluación, reporte del caso, alertas, sesiones, comunicaciones y periódicos | 58c5639: `idDeAncla` del #59 (sufijo en la respuesta sin JavaScript; con JavaScript, el id tal cual) | e2e sin JavaScript, roja por mutación | `doceava/n20-n21-b5-rojo-verde.txt`, `fix3/b-enlace-foco.txt` |
| **r2-serv-N22 (P3)** Con tope + 1 los avisos de nota, aviso, área, cargo, nombres y nombre del auditor decían el texto general | 9b3acb4: cada aviso dice su rango; el auditor lanza `auditor_nombre_invalido` («entre 1 y 200») | e2e sin JavaScript con tope + 1 en cada campo (sin el `maxlength` del navegador), roja con los textos de antes | `doceava/n22-rango-rojo-verde.txt` |
| **r2-serv-N23 (P2)** El cursor del manifiesto perdía los microsegundos: la página siguiente repetía documentos (3,003 líneas para 2,004 documentos) | e3e29fe: el cursor es el texto exacto de la base y vuelve como `timestamptz` | `pld-postgres` «manifiesto por páginas» y e2e, rojas por mutación | `doceava/n23-n24-manifiesto-rojo-verde.txt` |
| **r2-serv-N24 (P3)** Página y cursor del manifiesto llegaban a la base sin revisar | e3e29fe: `paginaYCursor` rechaza página fuera de 1..999,999,999, la 1 con cursor, y una fecha o un documento inválidos, con el aviso en su campo y sin evento | test:db y e2e sin JavaScript, rojas por mutación | `doceava/n23-n24-manifiesto-rojo-verde.txt` |
| **Llaves del prototipo (doce-N2 del #59)** `?aviso=constructor` tumbaba `/operacion/pld` con un 500 | El arreglo es del #59 (`deCatalogo` con `Object.hasOwn`, ronda 13). En PLD, 52dda2c pone la misma protección en `CAMPO_DE_INTEGRACION`; el resto de los catálogos de PLD se indexan con valores de la base o listas fijas, nunca con la dirección (revisado otra vez tras integrar la ronda 13) | e2e «una clave repetida en la dirección no tumba ninguna página de PLD» con `constructor`, `__proto__` y `toString` en las 8 páginas: roja contra 13eef23 (500) y verde con la ronda 13 | `llaves-repetidas/prototipo-rojo-verde.txt` |
| **r65-N1 (líder)** La prueba del #65 exige `pg_temp` en toda SECURITY DEFINER y el ALTER de la 0029 no cubre las de la 0030, que nacen después | 51faf5a: las **42** definers de la 0030 con `SET search_path = public, pg_temp`; las **29** invoker siguen con `public` | Con main y el #65 integrados, test:db 125/125, incluida `tests/esquema/definer-search-path.test.ts` | registro de test:db de este turno |
| **test:db rojo en el CI de 51faf5a (107/122)** Tres causas: (1) `pld-postgres:174` comparaba `companies_candado_regulado()` de la 0030 con la de la 0028, que sigue con `public` (las 11 siguientes eran cascada: `alfa` y `beta` quedaban en `""`); (2) «permisos de las funciones de PLD»: el mismo conjunto en otro orden, porque el contenedor ordena con `en_US.utf8`; (3) `migracion-postgres:107`: en el CI `psql` es `scripts/ci/bin/psql` (`docker exec`, `-w /work`) y no veía el guion escrito en el temporal del anfitrión | 4a93a7a: (1) la prueba exige `pg_temp` y que sea el único otro cambio; (2) `array_agg … collate "C"`; (3) el guion va por la entrada estándar y el `\i` es relativo a la raíz. Ninguno cambia la migración | Rojo idéntico al del CI y verde, con un `psql` que imita al contenedor; test:db 122/122 | `doceava/testdb-51faf5a-rojo-verde.txt`, `doceava/psql-como-contenedor.sh` |
| **Reparto de la e2e (líder)** `pld.spec.ts` es un grupo indivisible de 18 pruebas (dependen de los datos de las anteriores): con cinco partes caía entero junto a pagos-proveedores, ≈ 529 s en el modelo de máximos | ef72c1d: seis partes (`test:e2e:6`, `--shard=N/6`, `turbo.json` y `tests/e2e/LEEME.md`); quedan 17, 15, 15, 13, 21 y 6 pruebas | Modelo con el máximo observado de cada prueba en 19 registros de CI: peor parte ≈ 420 s; e2e local 87/87 en las seis partes; duración real en el CI en el cuerpo del PR | `reparto/modelo-5-contra-6.txt` |
| **Recorrido (no del producto)** Tras la ronda 13 del #59, f15 y f17 leían el título y el foco una sola vez, antes del repintado | 6bfa6eb: las dos comprobaciones esperan el estado con tope de 5 s | Recorrido completo desde cero en verde | `recorrido-trece/carreras-f15-f17.txt` |
| **Recorrido (no del producto), c43aeb7** `history.replaceState(history.state, …)` dejaba el router de Next sin actualizar; una hora fija del Comité chocaba con el `max` del campo; el `#aviso-rechazo` oculto del #59 duplicaba coincidencias y el contraste medía un `<details>` cerrado | `replaceState(null, …)`, el `max` del propio campo, contar solo lo visible y `checkVisibility()` | Recorrido completo desde cero en verde | commit c43aeb7 |
| **Prueba de tiempo inestable (líder), bandeja** «bandeja con 20,000 alertas» exigía p95 ≤ 100 ms en cualquier máquina: en el CI da 74–76 ms con casos y en local cargada llegó a 110.5 | Guarda determinista del plan como lo ve la aplicación (elige las 500 con `pld_alertas_operador_idx` y une después del `Limit`; anti-join con `pld_caso_alertas_una_vez`; sin Seq Scan en lo que crece) y tiempo con calentamiento y 200 muestras, topes del CI p50 ≤ 120 ms y p95 ≤ 200 ms. El p95 ≤ 100 ms queda como presupuesto de producto en local sin carga. Las demás pruebas de tiempo de test:db se revisaron con grep: la de enumeración es un requisito de seguridad relativo al piso y la de la migración mide el `lock_timeout`; se quedan | Quitar cualquiera de los dos índices hace caer la guarda; cinco corridas seguidas en local en verde | `costo/guarda-y-tiempos.txt` |
| **Prueba de tiempo inestable en el CI (líder)** «reglas de PLD: costo» falló en 10112ab con p95 30.73 ms contra 25: la máquina del CI es unas 3 veces más lenta (p50 20.4–21.3 ms contra 6.3 en local) y el tope no dejaba margen. Relanzar habría escondido una prueba inestable | La prueba se parte en dos: una guarda determinista del plan genérico de las 8 consultas de `pld_evaluar_operacion` (cada una con su índice, sin Seq Scan en las tablas que crecen) y el tiempo con calentamiento y 300 muestras, con topes del CI p50 ≤ 40 ms y p95 ≤ 80 ms (subidos desde 25/40 cuando 798e4a5 dio p50 25.10 ms con las mismas reglas). El presupuesto de producto (p95 ≤ 25 ms) se mide en local | Quitar cualquiera de los 6 índices hace caer la guarda; cinco corridas seguidas en local en verde (p95 de 8.0 a 10.8 ms con la Mac ocupada); test:db 125/125 | `costo/guarda-y-tiempos.txt` |
| **CSP del #62: descargas de PLD** `esDescarga` solo reconocía `…/documento/[id]` y `…/comprobante/[id]`: el reporte del caso, el acta generada, el acta firmada, el archivo de reportes y el manifiesto recibían además la CSP de página del proxy y un nonce, mezclados con su política aislada | `src/nucleo/csp.ts`: `DESCARGAS_PLD`, por nombre exacto para que ninguna página entre por accidente; sus fuentes en `next.config.ts` ya tenían `POLITICA_DESCARGA` | `tests/operacion/encabezados.test.ts`: todo `route.ts` de `src/app` que responde con `POLITICA_DESCARGA` debe ser `esDescarga` y estar en el registro; roja antes (`/operacion/conservacion/manifiesto`) y verde después; ninguna página de PLD es descarga. e2e `csp.spec.ts` en verde | `csp/esdescarga-rojo-verde.txt` |
| **CSP del #62: recorrido (no la app)** Con la CSP, la consola anotaba una violación de `style-src`: era el `<style>` que el guion inyectaba en cada captura (mismo hash `ggU06W4…`) | `foto()` ya no lo inyecta (con `next start` no hay overlay de desarrollo); solo el contraste usa `bypassCSP`; f15 también espera el primer título | Recorrido desde cero con la CSP en verde. El guion de R1 (del #59, sin tocar) tiene el mismo efecto: 156 en verde y «consola limpia» en rojo por su `<style>` inyectado | `csp/recorrido-r2-con-csp.txt` |
| **Reparto con el #62** `csp.spec.ts` suma 8 pruebas al principio del orden: con seis partes, el modelo de máximos daba ≈ 541 s en la de Operación y pagos | Siete partes (`test:e2e:7`, `--shard=N/7`, `turbo.json` y LEEME), sin cambiar el orden de `operacion.spec.ts`; el texto es el mismo que usa el #60 | Modelo: peor parte ≈ 455 s y la de PLD ≈ 412 s; e2e local en verde en las siete | `reparto/modelo-6-contra-7.txt` |
| **Rojo de R1: «doceava. riesgo, sin JavaScript a 1440»** El campo con el foco queda en y=11, bajo la barra fija de 84 px | **Superado: se reabrió y se resolvió en la sexta vuelta (abajo).** Lo que sigue es lo que se midió entonces. Sin cambio de código en esa vuelta. Es del #61 solo en el sentido de que la sección del perfil alarga la página: con el #59 solo (sin la 0030) las regresiones dan 273/273, porque el desplazamiento queda topado al final del documento y eso esconde el efecto. Causa: sin JavaScript, el navegador coloca el foco (autofocus, centrado) antes de terminar el cambio de fuentes, y con el Chromium de la prueba (`--use-angle=swiftshader`) el texto de arriba cambia de alto unos 419 px después; sin swiftshader el campo queda centrado en y=478. El N19 del #60 (`scroll-padding-top`) no lo cierra: solo mueve el centro la mitad del padding (y=59). Con JavaScript no hay salto: CLS 0 en Chromium y WebKit, a 1440 y 390, en el expediente, `/operacion`, `/operacion/pld` y la consola | Es intermitente: sobre el head final una corrida lo dio rojo (638 s) y otra desde cero, 273/273 (749 s). R1 sobre el #59 solo en verde; R1 con el diff de N19 sigue rojo; sonda del foco con y sin swiftshader; CLS con `PerformanceObserver` y alto antes y después de `document.fonts.ready` | `r1-foco/regresiones-r1.txt`, `r1-foco/cls-chromium.ndjson`, `r1-foco/cls-webkit.ndjson`, `r1-foco/foco.mjs.txt`, `r1-foco/cls.mjs.txt` |

### Sexta vuelta: revisión de -42 sobre aea742b, la vuelta sin JavaScript y la CSP en los guiones

**Cambio de criterio de la doceava sin JavaScript (decisión del líder).** La doceava del #59 pedía que, sin JavaScript, un formulario rechazado volviera con el foco en el campo (`autofocus`). El desplazamiento del `autofocus` depende del motor: con el Chromium de swiftshader que usa R1, el campo quedaba bajo la barra 3 de 4 veces a 1440; con GPU centraba bien. Regla nueva para la vuelta sin JavaScript de todos los formularios de Operación (con JavaScript no cambia: el foco va al campo):

- La respuesta lleva el fragmento del mensaje del error (`permalinkDelRechazo`: el `permalink` de `useActionState` es `#<idAviso>-campo`; si el error no es de un campo, el destino es un `span` al inicio del aviso del formulario). Las tres páginas de PLD que marcan el campo con `?aviso=…&en=…` lo llevan en la redirección (`fragmentoDelError`).
- El destino tiene `scroll-margin-top` igual al alto de las barras más un respiro: 84 + 16 px en escritorio y 172 + 16 a 960 o menos (`operacion.css`; `marco.css` y `tokens.css` no cambian).
- El mensaje va entre la etiqueta y el control (como en el #59): el destino es el inicio de la navegación con Tab y el primer Tab entra al campo con error. En PLD se movieron 58 mensajes que estaban después del control.
- Sin `autofocus` en ningún formulario de Operación (el navegador lo descarta cuando hay fragmento). Con JavaScript el foco lo dan los hooks y, en las páginas con `?aviso=`, `MensajeJuntoAlCampo` al montarse.
- La llave del estado del formulario pasa a ser ese permalink: cada formulario repetido en una página ya lleva su propio `idAviso` (folio, coincidencia, recuperación, cierre de alerta y periódico).

Inventario (grep): 30 formularios con `useFormularioConAviso` o `useConservaLoCapturado`, 3 con `useActionState` directo (accionista, representante e integrantes del Comité) y 3 páginas de PLD con `?aviso=&en=` (caso, sesión del Comité y conservación). No quedan `autoFocus` en `src`. `rechazar.tsx` (el diálogo de Aprobaciones) solo se abre con JavaScript; la entrada, el segundo factor y los formularios del portal del cliente no usaban `autofocus` y no cambian (`sexta/inventario-formularios.txt`).

**Validación.** Sonda dirigida al riesgo sin JavaScript, 30 veces a 390 y 30 a 1440 en cada motor: Chromium con swiftshader y reducir movimiento (como corre R1), WebKit, Chromium con GPU y movimiento normal, y WebKit con movimiento normal: 240 de 240 en verde (`sexta/sonda-30-resumen.txt`). R1 con la regla nueva, 10 corridas seguidas desde cero: flujos 157 y regresiones 273 de 273 en cada una, de 663 a 699 s (`sexta/r1-10-corridas.txt`). La e2e nueva, contra el código anterior con `autofocus`, sale roja: el mensaje quedaba debajo del control y no había fragmento (`sexta/e2e-rojo-con-autofocus.txt`). Con JavaScript no cambia: el foco va al campo (e2e con JavaScript y R1).

**Residuo medido.** En Chromium sin GPU (SwiftShader) y sin reducir movimiento, las transiciones de color y fondo al cargar provocan un salto de unos 419 px después de llegar al fragmento. Es del motor (no depende del mecanismo: pasa igual con `autofocus` y con fragmento). Afecta solo la vuelta sin JavaScript de un formulario rechazado en Operación. Mitigado con reducir movimiento (`@media (prefers-reduced-motion: reduce)` sin transiciones en `.operacion-pagina`, correcto en accesibilidad: las animaciones ya lo respetaban); el mensaje y el campo siguen en la página. Bisección con CSS inyectado en la respuesta: sin animaciones sigue el salto; sin transiciones en `main`, 3 de 3 en su lugar; ni las fuentes, ni la sección del perfil, ni la lateral, ni el lienzo del fondo, ni el anclaje lo explican (`sexta/`).

| Hallazgo | Arreglo | Prueba | Evidencia |
| --- | --- | --- | --- |
| **r61b-N1 (P3)** Si dos pestañas marcan el mismo caso como de 24 horas, la segunda recibía «quedó como de 24 horas» y su motivo se descartaba sin aviso (`casos.ts`) | El mismo envío (misma persona y mismo motivo) sale igual; cualquier otro recibe `caso_ya_marcado_24h` («Otra persona u otra pestaña ya marcó este caso…») y su motivo vuelve escrito | `pld-postgres`, junto a la marca de casoW: rojo antes («Missing expected rejection») y verde después | `sexta/r61b-n1-rojo-verde.txt` |
| **Guion de R1 con la CSP del #62** `ola-r-alta.mjs` inyectaba `<style>` en las capturas y en el QR del segundo factor: con la CSP, «consola limpia» en rojo y el QR habría salido sin tapar | Sin `<style>` en las capturas; el QR se tapa con `element.style` (CSSOM); `bypassCSP` solo en el contraste; `history.replaceState(null, …)` en los cuatro lugares (trampa de la pausa) | R1 con la CSP: flujos 157 con consola limpia y pantallas y contraste 60 | `csp/r1-con-csp.txt` |
| **Rojo de R1 «riesgo sin JavaScript» (reabierto por -42, también a 390)** El `autofocus` centraba el campo y, alrededor de `load`, un segundo desplazamiento lo dejaba bajo la barra | La regla nueva de arriba, más la regla de reducir movimiento | Línea de tiempo por CDP (sin JavaScript en la página) a 390 y 1440 y sondas de variantes; e2e sin JavaScript con `llegaSinScript` (fragmento, mensaje bajo las barras, campo a la vista, primer Tab, sin `autofocus`) en `pld.spec.ts` y `operacion.spec.ts`; R1 con la regla en `juntoAlCampo`; sonda dirigida 30 veces a 390 y 1440 | `sexta/` |

### Séptima vuelta: topes del CI de la prueba de costo y el #60 integrado

| Hallazgo | Arreglo | Prueba | Evidencia |
| --- | --- | --- | --- |
| **Prueba de tiempo sin margen en el CI (líder)** En 798e4a5, test:db cayó solo por «registrar una más: p50 = 25.10 ms» contra 25, sin que cambiaran las reglas. La serie del CI con las mismas reglas: p50 21.0, 21.8 y 25.1 ms y p95 37.0, 29.2 y 38.6 ms (aea742b, f1711c5 y 798e4a5) | Decisión del líder: la guarda de planes es la prueba de regresión, y los topes del CI pasan a p50 ≤ 40 ms y p95 ≤ 80 ms como red gruesa. El presupuesto de producto sigue siendo p95 ≤ 25 ms medido en local. La bandeja se queda en p50 ≤ 120 y p95 ≤ 200: su máximo en el CI fue p95 75.6 ms, con 2.6 veces de margen | test:db local 126/126 (local: registrar una más p50 6.45 ms y p95 7.56 ms; bandeja con 19,000 en casos, p95 18.1 ms) | `costo/guarda-y-tiempos.txt`, `tests/pld/reglas-postgres.test.ts` |
| **#60 en main (7b1fad6)** `src/app/operacion/busqueda.ts` desaparece y toda `.tabla-contenedor` lleva `aria-label` «Tabla de …» (guardia `tests/tablas-desplazables.test.ts`) | Las 8 páginas de PLD (avisos, Comité, sesión, conservación, bandeja, caso, parámetros y reportes) leen la dirección con `soloTexto`/`Parametros` de `@/nucleo/direccion`, que tiene el mismo contrato. Las dos regiones del Comité se llaman «Tabla de integrantes vigentes» y «Tabla del contenido para el SITI», y el recorrido R2 (`ola-r2-pld.mjs`) busca el nombre nuevo | Unitarias 591/591 con la guardia; `pld.spec` («una clave repetida no tumba ninguna página de PLD») en verde | — |
| **Reparto e2e con `pld.spec.ts` y el fondo del #60** Con las siete partes y el acomodo del #60, `pld.spec.ts` (serial, 18 pruebas, hasta 203 s en el CI) movía los cortes: según el orden real de `--list --shard=N/7` y los máximos del CI, la parte 6 llegaba a ≈ 735 s y 47 pruebas normales corrían después de una con GPU emulada | Ocho partes (`test:e2e:8`, `--shard=N/8`, `turbo.json` y LEEME). El fondo se reparte en `brillo-del-fondo.spec.ts` (después de aprobaciones), `optica-retina.spec.ts` (después de operacion) y `velocidad-del-fondo.spec.ts` (después de roles), con el optimizador del #60, más lugares posibles para esos archivos y la regla de GPU como restricción dura. El simulador del #60 lee el orden del reporte JSON, que junta los `describe` con el mismo nombre de un archivo; el resultado se comprueba con el orden real de `--list --shard=N/8` | Orden real: 133, 311, 313, 228, 256, 333, 374 y 372 s de pruebas por parte (≈ 464 s la peor con el fijo de 90 s); 0 pruebas normales después de una con GPU. Las de GPU cierran las partes 2, 6 y 8 y PLD va en la 7. Las 23 pruebas del fondo son las mismas antes y después (`--list`, diff ordenado vacío, ninguna repetida), con cuerpos idénticos y su navegador propio en `finally`. e2e local @@E2E@@ | `reparto/reparto-8-partes-real.txt`, `reparto/fondo-mismas-23-pruebas.txt`, `reparto/reparto-real.mjs.txt`, `reparto/reparto-optimizar-con-pld.mjs.txt`, `reparto/tiempos-max-ci-con-pld.json` |

## Aplicación sobre base poblada

La 0030 se aplicó como en producción: sobre una base que ya opera con el código del #59 y con el mismo comando, `./db/migrate.sh`. Toda la salida cruda está en `base-poblada/`. Del 05 al 14 se rehicieron con la 0030 final (C, N2, N3, higiene, A y B), desde la misma base poblada en 0028.

**Cómo se armó.** Es la base `plataforma` en el Postgres 17 desechable de 5553, cuya dueña es `duena`, sin superusuario (como la dueña de Neon).
1. Se migró hasta la 0028 con el `db/migrate.sh` del #59 (602af09), desde un worktree temporal (`01-migracion-hasta-0028.txt`).
2. Se sembró con el `preparar.ts base` del #59 y se corrió su recorrido de flujos 0 a 12 con `next build` + `next start` del #59: 147 comprobaciones en verde (`02-…json`). Así quedan empresas, expedientes con documentos, LPB, invitaciones, roles, pagos, nómina y bitácora.
3. A `audit_log`, la tabla más grande y la única que la 0030 bloquea en exclusiva, se le agregaron 492,252 filas con la forma de las reales. Quedaron 492,379 filas (348 MB), 164,084 con motivo de 500 caracteres, todas dentro de sus CHECK (`03-volumen-audit-log.txt`). Hoy son 492,380: la medición de la cola de la primera corrida dejó una escritura.

**Lo que la 0030 le hace a tablas que ya existían.** No agrega ningún CHECK, NOT NULL, UNIQUE ni FK a una tabla existente, ni lee o reescribe sus datos. Solo inserta datos fijos: calendarios, días inhábiles y la fila inicial de parámetros sin operador. Sobre lo existente:
- crea disparadores en pagos, nómina, personal, roles y las 6 tablas de conservación;
- revoca DELETE y TRUNCATE, que nadie tenía: los ACL no cambian;
- reemplaza `companies_candado_regulado`, que es idéntica a la de la 0028 más el bloque del perfil;
- reemplaza `companies_demostracion_no_dinero`, de la 0020, para que tampoco una empresa real pase a ser de demostración (C);
- recrea las dos políticas de lectura de `audit_log`, que ahora también ocultan `pld_%`.

**Bloqueos y tiempo** (`05-bloqueos-y-tiempos.txt`, en una copia con BEGIN … ROLLBACK):

```
 audit_log                        | AccessExclusiveLock, AccessShareLock
 companies                        | AccessShareLock, ShareRowExclusiveLock
 company_activation_requests      | AccessShareLock
 expected_collections             | ShareRowExclusiveLock
 kyb_calificaciones_riesgo        | AccessShareLock, ShareRowExclusiveLock
 operators                        | AccessShareLock, ShareRowExclusiveLock
 payroll_batch_items              | ShareRowExclusiveLock
 payroll_batches                  | ShareRowExclusiveLock
 platform_staff                   | AccessShareLock, ShareRowExclusiveLock
 platform_staff_roles             | AccessShareLock, ShareRowExclusiveLock
 postings                         | ShareRowExclusiveLock
 supplier_payment_request_history | ShareRowExclusiveLock
 supplier_payment_requests        | ShareRowExclusiveLock
 users                            | AccessShareLock, ShareRowExclusiveLock
 ms_hasta_audit_log | ms_con_audit_log_tomada | ms_total
                 65 |                       2 |       67
```

- El único ACCESS EXCLUSIVE sobre una tabla existente es el de `audit_log`. Se toma al final, en el `DROP POLICY`, y se sostiene 2 ms más el commit.
- Las demás toman SHARE ROW EXCLUSIVE, que frena escrituras pero no lecturas, durante los ~67 ms de la transacción.
- Con `migrate.sh`, la aplicación completa tardó 329 ms, contando el arranque de psql (`07-migrate-dos-veces.txt`).

**Una sola transacción y sin aplicar dos veces.**
- `migrate.sh` corre todo lo pendiente entre un BEGIN y un COMMIT, con `ON_ERROR_STOP` y el candado de aviso 814271.
- Con `SELECT 1 / 0;` al final de la 0030, salió con `rc=3` y la base quedó igual que antes (`06-falla-al-final-no-deja-nada.txt`): última migración 0028, 0 tablas y 0 funciones `pld_`, 0 disparadores nuevos, el candado sin el perfil, la marca de demostración de la 0020 como estaba, las 492,380 filas de `audit_log` y la foto de privilegios idéntica.
- Corrida dos veces, la primera dice «Aplicando 0030_pld_alertas_reportes» y la segunda solo «Listo.».

**Roles y dueños** (`04`, `08` y `09-foto.diff`; `\dp` en `11`, `\df+` en `12`; pruebas como cada rol en `10`):
- De lo que ya existía cambian solo las dos políticas de `audit_log`. Ningún ACL de tabla, columna o función existente cambió, y no hay membresías ni privilegios por omisión nuevos.
- Todo objeto nuevo es de `duena`. Las 29 tablas `pld_` tienen RLS con FORCE.
- `plataforma_sofipo` solo tiene SELECT e INSERT en PLD (0 privilegios de otro tipo). `plataforma_app`, `plataforma_cliente`, `plataforma_tarea` y PUBLIC tienen 0 privilegios en tablas `pld_`.
- Higiene: PUBLIC no ejecuta ninguna función `pld_`, ni de disparador ni de invocador. `plataforma_sofipo` ejecuta 32, entre ellas las cinco de invocador (`pld_fecha_mx`, `pld_sin_invisibles`, `pld_comite_vigentes`, `pld_nombre_de_integrante` y `pld_resultado_votacion`), que corren con sus privilegios. `plataforma_app`, `plataforma_cliente` y `plataforma_tarea` ejecutan 0. Como cada uno de esos roles, llamarlas da «permission denied for function».

**Los disparadores nuevos con datos viejos** (`13-disparadores-con-datos-viejos.txt`, todo con ROLLBACK):
- En esta base Taller es de demostración (la siembra del #59 la crea así), Ébano está suspendida y Lumbre es prospecto.
- Los dos pagos por autorizar de Taller se liberan como la aplicación: rol cliente, contexto de Taller y Rosa como liberadora, con su evento. Quedan 2 pagos listos y PLD no registra nada (0 operaciones y 0 alertas), porque las empresas de demostración no entran a PLD (C). Con la 0030 anterior eran 2 operaciones por $60,905.00. Para esta prueba se apagó el disparador de LPB del #59, que bloquea a Taller por su coincidencia abierta.
- La marca de demostración no cambia en ningún sentido: `demostracion_no_se_activa_para_dinero` y `empresa_real_no_pasa_a_demostracion` (C).
- La bandeja de Cumplimiento no lista a nadie sin perfil: Taller es de demostración y Ébano está suspendida. Reactivada Ébano, aparece (B; en modo réplica, porque la reactivación de verdad pasa por la solicitud aprobada del #59).
- Una empresa activa que cambia un dato que no es su estado pasa.
- Suspender a alguien de Cumplimiento sin avisos abiertos pasa.
- Borrar un pago viejo da `pago_proveedor_no_se_borra`.

**Si la 0030 falla por `lock_timeout`, se reintenta.** `migrate.sh` termina con «canceling statement due to lock timeout» y la base queda como estaba: sin tablas ni funciones de PLD y sin el renglón de `schema_migrations`. Se corre otra vez el mismo comando. Si vuelve a fallar, hay una transacción larga abierta; se ve con `select pid, now() - xact_start as abierta, state, left(query, 60) from pg_stat_activity where xact_start < now() - interval '5 seconds'`, se espera a que termine y se reintenta. `migrate.sh` no cambia.

**Dos hallazgos, resueltos por decisión del líder (A y B):**
1. **Cola detrás de `audit_log`**, resuelto con A. Con una lectura de `audit_log` abierta 25 s, la 0030 de entonces esperaba en el `DROP POLICY` los 15 s del `lock_timeout` de `migrate.sh`, y una escritura normal a la bitácora esperó 13,089 ms detrás de ella. Rehecho con la 0030 final (`14-cola-detras-de-audit-log.txt`, la escritura 0.5 s después de la migración): la migración cae por `lock_timeout` a los 2,111 ms y la escritura esperó 1,602 ms. Ahora la primera sentencia de la 0030 es `SET LOCAL lock_timeout = '2s'`, que vale para toda la migración y solo dentro de su transacción. `tests/pld/migracion-postgres.test.ts` mide los dos casos (`fix3/a-lock-timeout.txt`):
   - con una lectura larga de `audit_log`, la escritura normal a la bitácora esperó 2,012 ms;
   - con una escritura larga abierta en `companies`, la actualización de otra empresa esperó 1,999 ms;
   - en los dos, la migración falla por `lock_timeout`, no deja tablas, funciones ni renglón en `schema_migrations`, y el reintento entra completo;
   - sin el `SET LOCAL`, la escritura normal esperó 14,992 ms y la prueba cae.
2. **Empresas activas antes de la 0030 sin perfil**, resuelto con B. Sus pagos entraban a PLD sin «Excede el perfil», y nada pedía el perfil hasta la evaluación semestral, seis meses después del contrato. Ahora la bandeja de Cumplimiento tiene la hoja «Empresas activas sin perfil transaccional (25ª)» (`sinPerfil` en `src/server/pld/bandeja.ts`):
   - lista las empresas activas sin perfil y sin una propuesta por resolver, que ya aparece en «Por resolver»;
   - no incluye las de demostración, que no entran a PLD;
   - no incluye las suspendidas, que no operan; si se reactivan, aparecen;
   - cada una enlaza al perfil del expediente, donde Originación lo propone y Cumplimiento lo aprueba;
   - el expediente de una empresa activa sin perfil ya no dice «Sin perfil la empresa no se puede activar», sino que opera sin perfil y quién lo propone y quién lo aprueba.

   Prueba `pld-postgres` «empresas activas sin perfil (B, 25ª)», con cuatro mutaciones en rojo (`fix3/b-sin-perfil.txt`), y el flujo 18 por clics.

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
| Integrantes del Comité extranjeros sin CURP: hoy no se aceptan (r2-base-N15) | Gil |
| La codificación del archivo que acepta el SITI (hoy UTF-8, r2-base-N16) | Oficial de Cumplimiento |

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
13. Con la empresa ya activa, un cambio de perfil de Originación es una propuesta hasta que Cumplimiento la aprueba.
14. Por ahora no se aceptan integrantes del Comité sin CURP (extranjeros).
15. Al exportar, un texto libre que empieza como fórmula lleva un espacio antes; nada se rechaza al capturar.
16. El acta firmada cierra la sesión: lo que falte por votar va en una sesión nueva.
17. Para la persona excluida por un aviso, la sesión que votó ese caso no existe, ni su acta. Confírmalo antes de publicar R2:
    - Un aviso que señala a alguien del personal se vota en su propia sesión del Comité, y esa sesión no existe para esa persona.
    - Si el caso del cliente ya se votó, una alerta nueva que señala a alguien del personal abre su propio caso y su propio reporte, en lugar de sumarse al reporte único de la serie (40ª, último párrafo). Quien dictamina puede mencionar en el texto del reporte la relación con el otro caso.
18. Nadie se suspende, se da de baja ni pierde Cumplimiento si deja un aviso abierto sin quien lo analice; el mensaje no dice cuál.
19. Los indicadores del Comité (sesión del mes y meses sin sesión con quórum) cuentan solo las sesiones que ve cada persona: a quien está excluida de un caso le puede salir «falta». Hoy ninguna regla avisa por un mes sin sesión.
