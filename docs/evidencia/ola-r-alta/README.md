# Evidencia de la Ola R1: alta regulada de empresas

Recorrido con clics reales de Playwright headless (`scripts/evidencia/ola-r-alta.mjs`) contra `next build` + `next start`, sobre una base recién migrada (0001-0028) y sembrada. Cada envío se hace con doble clic y la base confirma que quedó una sola operación.

| Fase | Resultado | Datos |
| --- | --- | --- |
| Flujos 0-12 | 147 comprobaciones en verde, 0 en rojo, consola del navegador limpia | `datos/resultados-flujos.json` |
| Pantallas (3 temas × 1440/390) y contraste AA medido | 60 comprobaciones en verde, 0 en rojo; contraste mínimo 5.00 (Lever 1440) | `datos/resultados-pantallas-contraste.json` |
| Regresiones de las revisiones del PR (pago que regresa, doble envío, tope de 4 MB, lo que ve cada rol, descarga aislada; avisos sin la lista, pistas de Cumplimiento, socio extranjero, bitácora de Administración, contrato y 69-B por operador; socio extranjero física y moral con su rechazo, la misma persona con dos documentos, el grado de riesgo con los 5 roles, el formulario reusado, la pista con el error, la carga de un renglón y los comandos de la dueña) | 65 comprobaciones en verde, 0 en rojo, consola limpia | `datos/resultados-regresiones.json` |

Corrida del 2026-11-08 sobre el head de este PR, con los arreglos de las cuatro revisiones (H1-H12 y F1-F9; el resto de H2, N1-N3 y S5-S12 de la re-verificación sobre `57caa83`; N2-resto, N4-N14 de la re-verificación sobre `fd139bf`), sobre una base migrada de cero con la 0028 final.

## Cómo se corre

Puertos de esta línea: Postgres 5551, `next start` 4811, emulador de Blob 4894. Nada toca Neon, Blob ni Resend reales: la base es un Postgres 17 local y el almacén privado es el emulador de `tests/e2e/blob-local`, que el preload desvía solo en el servidor de la prueba.

1. Postgres 17 desechable en `127.0.0.1:5551` (Homebrew: `initdb` y `pg_ctl -o "-p 5551"`).
2. Emulador de Blob en 4894: `iniciarBlobLocal(4894, <token falso del almacén «e2elocal»>)` de `tests/e2e/blob-local/servidor.ts`.
3. Variables (sin valores reales, todos locales):
   - `ESTADO`: archivo fuera del repositorio. Guarda semillas TOTP, sesiones y el enlace de una invitación; nada de eso se imprime.
   - `DUENO_URL`: el Postgres administrador local; `preparar.ts` crea ahí la base `ola_r_alta`.
   - `AUTENTICACION_LLAVE_TOTP` (32 bytes en base64url), la misma para `preparar.ts` y para `next start`.
   - `AUTENTICACION_DOMINIOS=localhost`, `URL_APLICACION=http://localhost:4811`, `E2E_SERVER_ACTIONS=1`.
   - `BLOB_READ_WRITE_TOKEN` (el falso del emulador), `VERCEL_BLOB_API_URL`, `E2E_BLOB_LOCAL_URL` y `E2E_BLOB_LOCAL=1`.
4. `next build`.
5. `tsx scripts/evidencia/ola-r-alta/preparar.ts base`: migra desde cero, siembra Taller del Cierre (Gil y Rosa), Marta con nómina semanal que vence hoy, Iván con su invitación por aceptar y al personal SOFIPO (Ofelia administra; Omar, Ana, Celia y Aurelio sin rol).
6. `next start -p 4811` con `DATABASE_URL` de la aplicación (la deja `ESTADO`), `NODE_ENV=production` y `NODE_OPTIONS=--import=tests/e2e/blob-local/preload.mjs`.
7. `BASE=http://localhost:4811 FASES=flujos node scripts/evidencia/ola-r-alta.mjs`, después `FASES=pantallas,contraste` y al final `FASES=regresiones`, sobre la misma base. La fase `lumbre` de `preparar.ts` la llama el flujo 1. Las regresiones parten del estado que dejan los flujos y numeran sus capturas aparte (`rNN-…`).

## Reloj fijo

La aplicación no tiene un reloj falso: la base fecha con `now()` y con `hoy_mexico()` (zona `America/Mexico_City`). El recorrido fija lo que no puede esperar así:

- **Revisión periódica vencida (flujo 4).** La base solo deja a Cumplimiento calificar con la fecha de hoy. La fase `lumbre` escribe como dueña, con su evento, una calificación de Distribuidora Lumbre de hace siete meses. Su `revisar_antes_de` es esa fecha más seis meses (27ª: dos evaluaciones por año), así que ya venció. La bandeja lo calcula al leer, sin tarea programada.
- **Plazo de 24 horas (flujo 7).** La base fija `plazo_reporte_hasta = detectada_en + 24 horas` al detectar la coincidencia exacta. El recorrido comprueba que la diferencia es exactamente `interval '24 hours'`.
- **«Confirma que eres tú».** El recorrido mueve como dueña el segundo factor de Ofelia seis minutos atrás (vale cinco) para ver la confirmación sin esperar.
- **Sesiones sembradas.** Antes de cada flujo se renueva su `ultimo_uso`, para que no venzan por inactividad durante la corrida.

## Formato del CSV de la Lista de Personas Bloqueadas

Lo carga Cumplimiento en Operación → Lista de Personas Bloqueadas. Cada archivo es la lista vigente completa: la carga anterior pasa a «Anterior» y no se borra. Lo valida `src/dominio/operacion/lpb.ts`.

| Columna | Obligatoria | Regla |
| --- | --- | --- |
| `nombre` | Sí | Hasta 300 caracteres, sin caracteres de control. Los espacios repetidos se juntan. |
| `rfc` | No | 12 caracteres para persona moral o 13 para física. Se guarda en mayúsculas. |
| `curp` | No | 18 caracteres, solo para persona física. Se guarda en mayúsculas. |
| `tipo` | Sí | `fisica` o `moral` (también se acepta `física`). |
| `fecha` | No | `AAAA-MM-DD`: fecha de publicación o de notificación. |

- El encabezado es exactamente `nombre,rfc,curp,tipo,fecha`. Se acepta UTF-8 con o sin BOM, fin de línea LF o CRLF y campos entre comillas dobles (`""` dentro de comillas es una comilla).
- Hasta 50,000 renglones y 4 MB. Un archivo más pesado no sale del navegador: el aviso queda en el campo. Un renglón inválido rechaza el archivo completo y la pantalla dice qué línea revisar; no queda carga.
- Al cargar se cotejan todas las empresas del operador: la empresa, sus representantes, accionistas y propietarios reales del expediente vigente, y sus proveedores.
- RFC o CURP idéntico es **coincidencia**. El mismo nombre normalizado es **posible coincidencia**, que revisa Cumplimiento y nunca se descarta sola. Normalizar es: mayúsculas, sin acentos (también letras fuera del español, como ø, con `unaccent`), sin punto, coma ni apóstrofo («S.A. de C.V.» = «SA DE CV», «O'Brien» = «OBRIEN») y sin importar el orden de las palabras («RIOS PEREZ ROSA» = «Rosa Pérez Ríos»). Los EFOS definitivos de la Lista 69-B también cuentan como coincidencia.

### Cuándo se reabre un caso cerrado

Solo puede haber un caso abierto (pendiente o confirmado) por sujeto, lista y valor. Un caso cerrado no impide otro:

Al cerrar un caso (fuera de lista o falso positivo), la base anota la carga o copia del 69-B que estaba vigente en ese momento (`cerrada_con_carga_id`, `cerrada_con_snapshot_id`). Con esa no se reabre, aunque sea posterior a la de la detección y aunque se vuelva a cotejar por una versión nueva, una copia del 69-B o un proveedor nuevo.

| Caso cerrado | Con la carga (o copia del 69-B) vigente al cerrarlo | Carga o copia posterior con la misma persona |
| --- | --- | --- |
| Coincidencia exacta (RFC o CURP) «fuera de lista» | No se reabre | Caso nuevo pendiente y, si es la empresa, un representante o un propietario real, suspensión inmediata |
| Coincidencia exacta (RFC o CURP) «falso positivo» | No se reabre | Caso nuevo pendiente y suspensión inmediata, igual que arriba |
| Posible por nombre «falso positivo» | No se reabre | No se reabre por el mismo nombre: Cumplimiento ya dictaminó a esa persona. Si cambia el RFC o la CURP, cuenta como exacta |

En concurrencia vale lo mismo (N5). El cierre de un caso y el cotejo de una empresa toman el mismo candado (`estado_empresa:<empresa>`): si Cumplimiento cierra un caso mientras otra pestaña carga una lista nueva con la misma persona, quien llega segundo ve lo que el otro confirmó. Si el cierre fue primero, la carga nueva abre un caso nuevo; si la carga fue primero, el cierre anota la carga nueva y con ella no se reabre. Con REPEATABLE READ, el cierre y el cotejo de una empresa con un caso abierto escriben su fila: el que decidió con una foto vieja aborta y se repite.

La copia del 69-B es de cada operador: la carga su Administración y el cotejo, la validación de «fuera de lista», la relectura de proveedores y el portal usan la última de su operador. La copia de otro operador no coteja, no relee ni se ve aquí.

Ejemplo (el del flujo 5):

```csv
nombre,rfc,curp,tipo,fecha
Mariana Ébano Ruiz,EARM750404AB5,,fisica,2026-11-02
HECTOR LOZANO DIAZ,,,fisica,2026-11-02
Comercializadora Sin Relación SA de CV,CSR010101AB1,,moral,2026-11-02
```

## Socio extranjero y la misma persona por varios caminos

Lo que tiene una persona por varios caminos suma una vez (4ª fr. II c). Para eso cada socio lleva un identificador:

| Socio | Se identifica con | Suma por |
| --- | --- | --- |
| Persona física mexicana | CURP (obligatoria) | CURP |
| Persona moral mexicana | RFC (obligatorio) | (no suma: se desglosa hasta personas físicas) |
| Persona física extranjera | País (ISO 3166, no México), número de pasaporte o identificación oficial y fecha de nacimiento, siempre, aunque traiga CURP | País + documento |
| Persona moral extranjera | País y número de identificación fiscal o de registro en su país; el RFC es opcional | (se desglosa hasta personas físicas) |

El documento se guarda en mayúsculas, sin espacios, puntos, guiones ni diagonales (de 4 a 20 letras y números). El servidor no captura a una extranjera sin su documento (y, si es física, sin su fecha); la base tampoco deja enviar la versión (`expediente_accionista_sin_identificacion`).

Al enviar, la base rechaza dos personas físicas con el mismo nombre normalizado (como en la lista: sin orden de palabras, acentos ni puntuación) y la misma fecha de nacimiento (la capturada o la de su CURP, posiciones 5 a 10) que tengan identificadores distintos: `expediente_misma_persona_dos_identificadores`, con un aviso que dice qué corregir. Cubre la CURP en un camino y el pasaporte en otro, el mexicano que se declara extranjero y el extranjero con dos documentos.

**Límite que queda.** Un nombre escrito distinto (otra grafía, un apellido de menos o un segundo nombre) no se detecta. Ese caso depende de la declaración del representante sobre los propietarios reales y de la revisión de Cumplimiento.

El cotejo con la Lista de Personas Bloqueadas de un socio extranjero sin RFC ni CURP es por nombre (posible coincidencia): el CSV de la lista no trae documento extranjero.

## Conservación de 10 años (61ª)

- **Base.** Las tablas del expediente (versiones, documentos, representantes, accionistas, propietarios reales y dictámenes), las calificaciones de riesgo, las cargas y personas de la lista, las coincidencias y las suspensiones no admiten DELETE ni TRUNCATE: el trigger `conservacion_no_se_borra` (0028) los rechaza aun para la dueña de las tablas. Una versión enviada, un documento o un dictamen no se reescriben, y la bitácora (`audit_log`) solo acepta inserciones.
- **Archivos.** Los documentos del expediente van a Blob privado con su SHA-256 y la aplicación nunca borra uno que tenga su fila. La prueba Postgres lo exige (`almacen.borrados` vacío) y el flujo 12 compara la SHA-256 del archivo descargado con la guardada. Solo se borra el archivo de un envío cuya fila no entró (otro envío del mismo formulario ganó, o la transacción falló): no es un documento del expediente (S9).
- **Lo que el código no cubre.** Los respaldos de Neon y de Blob no son un archivo de 10 años, ni sobreviven a cerrar la cuenta. Falta definir y operar una exportación periódica (base y documentos) con su verificación. Dueño: Gil con el oficial de cumplimiento.

## Comando de roles iniciales

```sh
DATABASE_URL_UNPOOLED=<conexión directa de las migraciones> \
  npx tsx scripts/plataforma.ts personal:rol --quien-corre <tu correo> --correo <correo> --rol <rol> --motivo "<motivo>" [--quitar]
```

La primera Administración de un operador (una base nueva, como Preview, que tiene 0 personal) la invita la dueña de la base:

```sh
DATABASE_URL_UNPOOLED=<conexión directa de las migraciones> OPERADORES_PLATAFORMA=<correos> \
  npx tsx scripts/plataforma.ts personal:migrar-variable --quien-corre <tu correo> [--mostrar-enlace]
```

Corre con la conexión de la dueña (`scripts/personal-por-la-duena.ts`): desde la aplicación nadie sin usuario da roles ni registra personal (N3). Solo arranca: invita a todos los correos de la variable en una sola corrida y, si el operador ya tiene a alguien con Administración (activo o invitado), no invita a nadie (`personal_con_administracion`, N7). Con más de un operador no adivina (`operador_ambiguo`).

**Quién lo corrió (N8).** `personal:migrar-variable`, `personal:rol` y `empresa:alta` exigen `--quien-corre` con el correo de la persona que los corre. La bitácora guarda ese correo (`corrido_por`) junto con `ejecutado_por = session_user`. `session_user` es la conexión, no la persona: en Neon, quien use `DATABASE_URL_UNPOOLED` es siempre la dueña de la base (`neondb_owner`), así que por sí solo no dice qué persona corrió el comando.

`personal:rol` sirve cuando nadie más del personal administra al personal: nadie se da un rol a sí mismo por pantalla. La función `personal_rol_por_comando` (0028) solo la ejecuta la dueña de la base; la aplicación no puede llamarla con ningún rol. Deja el evento `rol_personal_asignado` o `rol_personal_retirado` en la bitácora, como acto del sistema con origen `comando` y el motivo escrito. Respeta la 50ª, no deja al personal sin administración y, si otra persona ya administra al personal, pide usar la pantalla Personal. El flujo 0 lo corre como se hará tras el despliegue.

## Revisión adversarial del PR: hallazgo → arreglo → prueba

Cada arreglo de la base va en la 0028. Las pruebas de la base están en `tests/operacion/alta-regulada-postgres.test.ts`, en la subprueba que se nombra. Con la 0028 del head anterior (`e1a534f`), las 12 subpruebas que tocan la base fallan, y cada una falla en el hueco que describe el hallazgo. Por ejemplo, en H1 Originación sí crea una empresa activa («Missing expected rejection»), en H9 la función responde `true` por otro operador y en H11 el portal lee 27 eventos regulados. Con la 0028 final pasa todo el archivo: 31 pruebas (el relleno de la 0028, la prueba principal y sus 29 subpruebas).

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **H1 (P0)** La app podía insertar una empresa `activa`, `en_alta`, `suspendida`, `baja` o de demostración | `companies_alta_por_rol`: para los roles de la app toda empresa nace `prospecto` y real (`empresa_nace_prospecto`). El servidor ya no tiene `darDeAltaEmpresa`. `empresa:alta` (solo `--demostracion`) y las siembras crean como dueña (`scripts/empresa-por-la-duena.ts`) | «H1»: Originación y Administración, cinco estados y demostración, con su evento `alta_empresa` → `empresa_nace_prospecto`, 0 filas. `tests/puerta-alta.test.ts`: el único insert de `src/` es el prospecto |
| **H2** Personal, 69-B, precio, invitaciones y membresías los escribía cualquier rol | `personal_solo_administracion` en las siete tablas; nadie cambia su propio registro (`personal_propio`), salvo quien acepta su invitación. La 69-B solo coteja al operador de quien la carga | «H2»: Originación, Aprobación, Cumplimiento y Auditoría → `sin_rol_de_administracion`; fila propia → `personal_propio`; la 69-B de Administración de otro operador con el RFC de Alfa no la suspende |
| **H3** La unicidad no dejaba reabrir un caso cerrado | Índice único parcial solo sobre casos abiertos; el cotejo reabre según la tabla «Cuándo se reabre un caso cerrado» | «H3 y H6»: escenario A (fuera de lista → carga nueva → caso y suspensión), escenario B (falso positivo exacto: misma carga no, nueva sí), nómina y pago rechazados, posible por nombre con un solo caso |
| **H4** El nombre dependía del orden y la puntuación dejaba espacios | `lpb_normalizar`: palabras en orden `COLLATE "C"`, quita `.`, `,` y `'`, `unaccent` con diccionario explícito (`lpb_sin_acentos`, IMMUTABLE); la columna generada se recrea | «H4»: «RIOS PEREZ ROSA» es posible coincidencia con la representante Rosa Pérez Ríos en una carga real; «S.A. de C.V.»; «Søren O'Brien Ødegård» |
| **H5** Un propietario real con CURP en un camino y solo RFC en otro se partía | `kyb_exigir_completo` exige CURP a toda física y RFC a toda moral; el cálculo agrupa por CURP | «H5 y H10»: sin CURP → `expediente_accionista_sin_curp`; sin RFC → `expediente_accionista_sin_rfc`; Ximena suma 25.0038 % por capital |
| **H6** En REPEATABLE READ la 50ª y la reactivación decidían con foto vieja | La 50ª escribe la fila de la persona antes de leer sus roles; la decisión de suspensión escribe la fila de la empresa antes de leer los casos; el cotejo con casos nuevos escribe la fila de la empresa. Es un UPDATE sin cambio: `FOR UPDATE` no aborta en REPEATABLE READ (probado en Postgres 17) | «H6, H7 y H8» (50ª) y «H3 y H6» (reactivación contra la carga nueva) → `could not serialize access due to concurrent update` |
| **H7** Sin usuario se daba Administración a personal existente | Primero, solo a quien nacía invitado en la misma transacción; en la tercera revisión (N3) la rama se retiró: sin usuario, nadie | «H6, H7, H8 y N3»: con el evento del alta del sistema, a Nora (ya existe) → `sin_permiso_roles`; a Rita (nace `activo` o `invitado`) → `sin_rol_de_administracion` |
| **H8** Los eventos de otra empresa, entidad o rol contaban | Evento con empresa, acción, entidad e id exactos; un evento por rol con el rol en `cambio`; `alta_personal` solo para quien nace en la transacción | «H6, H7 y H8»: dictamen con evento de otra empresa o entidad → `regulado_sin_auditoria`; alta para persona existente, un evento para dos roles, dos roles en un texto, otra entidad → `rol_personal_sin_auditoria` |
| **H9** Las funciones del sistema respondían por otro operador o sin contexto | `operador_del_contexto`: la dueña (por `session_user`) o el operador del contexto; responde `false`, nunca NULL. La usan `personal_tiene_rol`, `lpb_carga_vigente` y `lpb_coincidencias_abiertas` | «H9»: otro operador y sin contexto → `false`/`null`; la dueña sí responde. La suite encontró que sin contexto respondía NULL, y `IF NOT NULL` no lanza la excepción: se cerró con `coalesce` |
| **H10** Más de 10 capas pasaban como completas | `expediente_estructura_muy_profunda` al enviar | «H5 y H10»: 11 capas (10 morales y la dueña final) → rechazado |
| **H11** El portal leía los eventos de Cumplimiento | `audit_log_cliente_lectura` excluye `kyb_%`, `lpb_%`, `company_suspensions` y `expediente_%` | «H11»: el portal cuenta 0 eventos regulados y sigue viendo `suspendida` |
| **H12** Lo autorizado seguía «listo para pagar» tras suspender | `pagos_listos_regresan`: al suspender regresa todo; si la lista frena a un proveedor, solo lo de ese proveedor. Un evento del sistema por pago con su motivo; el historial lo muestra | «H12» (versión + 1, evento, solo el proveedor en la lista, se reautoriza tras reactivar) y capturas `r01`-`r02` |
| **F3** La descarga aceptaba otra empresa en la dirección | `kyb_documento_para_descarga(documento, empresa, petición)` filtra por empresa antes del evento | «RLS entre operadores…»: otra empresa → `documento_no_existe`, sin evento |
| **F7** El evento del comando no decía quién lo corrió | `cambio->>'ejecutado_por' = session_user` | «roles iniciales por comando» |
| **F1** Sin tope real: Vercel corta en 4.5 MB | `TOPE_ARCHIVO_BYTES` (4 MB, `src/dominio/archivos.ts`) citado por etiqueta, avisos y proveedores; `CampoArchivo` revisa en el navegador con el aviso ligado al campo; `bodySizeLimit: "4.5mb"`; proveedores suman constancia y contrato, XML y PDF | `src/dominio/archivos.test.ts`; e2e «limita archivos combinados» (0 proveedores); capturas `r04` y `r10` (0 filas) |
| **F2** La descarga del expediente perdía su `sandbox` | La ruta entra a la excepción de CSP de `next.config.ts` | `archivos.test.ts`; e2e «la descarga del expediente llega aislada»; recorrido: 200 con `sandbox; default-src 'none'` y su evento |
| **F4** Un doble envío simultáneo respondía «base no disponible» | Los índices únicos dicen su código (`expediente_con_borrador`, `dictamen_ya_registrado`, `suspension_pendiente`, `lpb_ya_cargada`); la llave primaria repetida se repite una vez y sale como el primero; «base no disponible» tiene su texto. La suite encontró que `kyb_versiones_revisar` le respondía `expediente_numero_invalido` a la segunda pestaña: ahora es «ya hay borrador» | «F4 y F5»: `Promise.allSettled` en ocho servicios → 1 fila y 1 evento, nunca `base_no_disponible`; captura `r03` (dos pestañas) |
| **F5** La idempotencia aceptaba un id de otra empresa o versión | Solo vale con la misma empresa y versión; si no, `expediente_ausente` (suspensiones: `formulario_invalido`) | «F4 y F5»: versión, representante, accionista, retiro, documento, dictamen, riesgo y suspensión; el representante ajeno sigue activo |
| **F6** El comando adivinaba banderas | Bandera repetida, con valor en una de sí o no, o desconocida es error; `empresa:alta` exige `--demostracion` | «F6»: `spawnSync`, salida 1, sin cambios en roles, empresas ni eventos |
| **F8** Originación y Aprobación veían el detalle de Cumplimiento | Solo Cumplimiento y Auditoría ven folio, plazo, nombre en la lista y motivos; los demás ven «En revisión de Cumplimiento». En la bitácora, Administración no ve los motivos de la lista ni del dictamen. El motivo del dictamen sigue a la vista de Originación en el expediente: lo necesita para corregir una versión observada | «F8» y capturas `r05`-`r09` |
| **F9** El servidor leía el archivo antes de revisar el rol | La capacidad se revisa antes de leer, en la lista y en los documentos | «F9»: sin rol, el archivo no se lee; uno de más de 4 MB tampoco |
| **invitaciones.ts:56** | Con la empresa suspendida, el aviso dice «empresa_suspendida» | «suspensión manual…» y flujo 7 |

### Tercera revisión (re-verificación sobre `57caa83`)

Quedaba abierto el resto de H2 y salieron N1-N3 (base) y S5-S12 (servidor). Todo va en este PR y en la misma 0028.

Verificación en rojo. La suite nueva contra la 0028 de `57caa83`, con solo las columnas nuevas agregadas (sin su lógica), falla en H2 (las dos subpruebas y el relleno), N1, N2, N3 y S6. Por ejemplo, la copia del otro operador relee 3 proveedores de Beta, el falso positivo se reabre con la misma carga y Ada lee 16 eventos de la lista. F4 cae en cascada porque Épsilon nace en la subprueba de N3. Para los puntos del servidor, cada archivo se cambió por su versión de `57caa83`. Así fallan S9 (sin borrado), S10 («Missing expected rejection»), S12, el tope (S8), las pistas (S11) y N2 en el servidor. Las dos e2e nuevas fallan con `aviso.tsx` y `acciones-pago.tsx` de `57caa83`: el aviso dice «…con la Lista de Personas Bloqueadas sin resolver» y el contrato no tiene aviso de tamaño.

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **H2 (P1, resto)** La copia del 69-B era global: la de otro operador cotejaba, validaba «fuera de lista» y releía proveedores de este | `lista_69b_snapshots.operator_id` `NOT NULL`. El relleno pasa las copias al único operador; con más de uno (o ninguno), `lista_69b_sin_operador`, sin dejar nada a medias. RLS por operador para el personal y el portal, y los renglones siguen a su copia. `lista_69b_vigente(operador)` en el cotejo y en «fuera de lista». La copia nueva coteja solo a su operador. `releer_proveedores_69b` y `suppliers_lectura_contra_copia` solo con empresas del operador de la copia. El repositorio de la 69-B lee y guarda con el operador | «H2»: Administración de otro operador carga una copia con Alfa y un proveedor de Beta en definitivo. No coteja, no relee y no la ven el personal ni el portal. Con ella como la más reciente, Cumplimiento carga su LPB y Alfa sigue activa, sin casos del 69-B. «H2: con su propia copia…»: sí suspende, y «fuera de lista» se rechaza mientras su copia la traiga, aunque otro operador cargue una más nueva. «H2 y N3: la 0028 sobre una base en la 0027…»: relleno con un operador y aborto con dos. `servicio.test.ts`: el portal no ve la copia de otro operador. Captura `r21` |
| **N1 (P2)** Un falso positivo exacto resuelto con una carga posterior a la detección se reabría con esa misma carga | `cerrada_con_carga_id` y `cerrada_con_snapshot_id`: los pone el trigger de resolución al cerrar (falso positivo o fuera de lista) con la carga o copia vigente. El cotejo compara con ellas (`coalesce` con la de detección) | «N1»: detecta con C1, C2 la trae, se resuelve con C2 vigente y se reactiva. Otro cotejo, un proveedor nuevo, una copia del 69-B y una versión nueva no abren caso. C3 sí, con suspensión |
| **N2 (P2)** Un socio extranjero sin CURP no podía enviarse | La persona física extranjera lleva país ISO 3166 (no México), pasaporte o identificación oficial (normalizado) y fecha de nacimiento. Suma por país + documento. Sin ellos, `expediente_accionista_sin_identificacion`, con su aviso. El mexicano sigue con CURP. El formulario cambia por nacionalidad. El cotejo con la lista es por nombre: el CSV de la lista no trae documento | «N2»: con 40 % se envía y es propietario real. Dos caminos con el mismo documento, escrito distinto, suman una vez (25.0038 %). Sin documento o sin fecha, `sin_identificacion`. Mexicano sin CURP, `sin_curp`. México no es país extranjero (servidor y SQL). Capturas `r15`-`r17` |
| **N3 (P3)** La rama sin usuario aún creaba Administración nueva | Se retiró de `platform_staff_roles_revisar` y de `personal_solo_administracion`: sin usuario nadie da roles ni registra personal. Algo sí dependía de ella: el primer arranque de un operador (Preview tiene 0 personal y `personal:rol` exige a alguien activo). Por eso `personal:migrar-variable` sigue, pero con la conexión de la dueña (`scripts/personal-por-la-duena.ts`) y con quién lo corrió en la bitácora. La siembra e2e usa ese camino | «H6, H7, H8 y N3»: sin usuario, tampoco a quien nace invitado → `sin_rol_de_administracion`. Con dos operadores el comando no adivina (`operador_ambiguo`). «H2 y N3…»: la dueña invita a la primera Administración con `ejecutado_por = session_user`; la segunda vez, `ya_era_personal` |
| **S5** Los avisos nombraban la Lista a Originación y Aprobación | «Cumplimiento tiene un caso abierto de esta empresa: no se puede activar (o reactivar) hasta que lo resuelva.» | e2e «un caso abierto de Cumplimiento no se le nombra…»: Aprobación con Brisa y Originación con Cima, sin «Lista» ni «bloquead». Capturas `r13`-`r14` |
| **S6** La bitácora de Administración mostraba los eventos de la lista por empresa | `audit_log_sofipo_lectura`: los eventos `lpb_%` y `empresa_suspendida_lpb` con empresa solo los leen Cumplimiento y Auditoría. La carga sin empresa la ve todo el personal | «S6»: Ada (solo Administración) lee 0, por la aplicación y por SQL; Auditoría y Cumplimiento sí. Capturas `r18`-`r19` |
| **S7** «Agregar contrato» no medía el archivo en el navegador | `CampoArchivo` con «El contrato debe ser un PDF de hasta 4 MB.» | e2e «Agregar contrato…»: con 4.6 MB, 0 envíos y aviso ligado al campo. Captura `r20` |
| **S8** El tope de 4 000 000 bytes dejaba fuera una lista de 50 000 renglones | `TOPE_ARCHIVO_BYTES = 4 * 1024 * 1024`; el texto sigue «4 MB». Quedan 512 KiB bajo `bodySizeLimit` "4.5mb" (4 718 592). Si los 4.5 MB de Vercel fueran decimales, quedan unos 298 KiB (la doc oficial dice «4.5 MB» sin precisar) | `src/dominio/archivos.test.ts`: tope exacto, márgenes y 50 000 renglones de 83 bytes, que suman 4 150 027 bytes y no cabían en 4 000 000 |
| **S9** El archivo quedaba en Blob si la fila no entraba | `cargarDocumento` borra el archivo si la fila no entró (`rowCount !== 1`) o si la transacción falló | «F4 y F5»: doble envío simultáneo de verdad (una barrera junta las dos subidas antes de escribir) → 2 subidas, 1 borrado, y se conserva el archivo de la fila. Con un error después de subir, también se borra |
| **S10** Un `formId` reutilizado con otro archivo respondía éxito | El mismo formulario con otro SHA-256 → `formulario_invalido`, sin carga nueva | «LPB: carga versionada…» |
| **S11** Cumplimiento podía nombrar la Lista en motivos que leen Originación y Aprobación | Pista bajo «Motivo» del dictamen y de la solicitud de suspensión o reactivación, solo para Cumplimiento: «Originación y Aprobación leen este motivo: no menciones la Lista ni el reporte.» | `tests/operacion/pistas.test.ts`. Capturas `r11`-`r12`: Cumplimiento la ve y Originación no |
| **S12** El alta por la dueña no decía quién corrió el comando, y faltaba la etiqueta de la coincidencia detectada | `ejecutado_por = session_user` en `alta_empresa`; «El sistema detectó una coincidencia» en la bitácora | «S12» |

### Cuarta revisión (re-verificación sobre `fd139bf`)

Los revisores cerraron H1-H12, el resto de H2, el relleno de la 0028, N1, N3, F8 y los N1-N8 del servidor. Salieron cuatro P2 (N2-resto, N5, N6 y N9) y ocho P3 (N4, N7, N8 y N10-N14). Todo va en este PR y en la misma 0028.

Verificación en rojo, con la suite y las e2e nuevas:

- **Base y servidor de `fd139bf`** (la 0028 de `fd139bf` más solo `kyb_fecha_de_curp`, que la prueba llama directo): fallan 8 de 31. El relleno (N8: `corrido_por_invalido` no se rechaza), el comando de roles (N8: la función no recibe el correo), N2 y N2-resto (el servidor captura a la extranjera sin documento), F4 y F5 (N10: el mismo formulario con otro archivo no se rechaza), S12 y N8, y N5 (sin caso nuevo con la carga nueva).
- **Solo la base de `fd139bf`, servidor nuevo**: fallan 5. El relleno (N4: `column "operator_id" … already exists` al volver a aplicar), el comando de roles (N8), N2-resto (la base deja enviar a la extranjera con CURP y sin documento) y N5.
- **Mutaciones del código nuevo** (quitar solo un arreglo): sin la revisión de N7, el relleno falla en `personal_con_administracion`; sin la regla de la misma persona, N2-resto falla en `expediente_misma_persona_dos_identificadores`; con el CHECK viejo, la LLC no se captura (N6).
- **e2e con la interfaz de `fd139bf`** (`page.tsx` del expediente, `expediente.tsx`, `identidad-socio.tsx`, `acciones-alta.ts` y `aviso.tsx`): N9 falla porque Originación lee «exacta · 3 puntos» y N11 porque el aviso es el genérico y el formulario vuelve en «Mexicana».

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **N2-resto (P2)** La misma persona capturada con dos identificadores se partía (CURP y pasaporte, mexicano declarado extranjero, dos documentos) | Con país, el documento y la fecha van siempre, aunque traiga CURP, y la extranjera suma por país + documento (`kyb_persona`). Al enviar, `expediente_misma_persona_dos_identificadores` si dos físicas comparten nombre normalizado y fecha de nacimiento (la capturada o la de la CURP, `kyb_fecha_de_curp`) con claves distintas. El servidor exige documento y fecha a la extranjera. Límite: nombres escritos distinto («Socio extranjero y la misma persona») | «N2-resto y N6»: (c) sin documento, el servidor no la captura y por SQL la base no la envía; con el mismo pasaporte y la CURP suma 30 % y es propietario real. (d) y (e) → rechazadas. Homónimos con otra fecha sí se envían. La fecha de la CURP con el siglo por la posición 17. Captura `r25` |
| **N5 (P2)** Cerrar un caso mientras otra pestaña carga una lista con la misma persona: no se reabría y la empresa se podía reactivar | `pg_advisory_xact_lock(hashtextextended('estado_empresa:'‖empresa, 0))` al cerrar (`lpb_coincidencias_revisar`) y al inicio de `lpb_cotejar_empresa`. Para REPEATABLE READ, el cierre escribe la fila de la empresa y el cotejo también cuando la empresa tiene un caso abierto (si solo escribiera el cierre, la carga con foto vieja no chocaría) | «N5»: READ COMMITTED en los dos órdenes (caso nuevo con la carga nueva; o cierre con `cerrada_con` = la carga nueva y sin reapertura) y REPEATABLE READ en los dos órdenes (el que decidió con foto vieja aborta con `could not serialize` y, al repetirlo, queda bien) |
| **N6 (P2)** Un socio extranjero persona moral no se podía enviar | La moral extranjera se identifica con país y número de identificación fiscal o de registro; con país el RFC es opcional (CHECK `kyb_accionistas_extranjero`, `sin_rfc` solo para la mexicana). Formulario: «Número de identificación fiscal o de registro en su país» y «RFC en México (si tiene)». En la lista se coteja por nombre | «N2-resto y N6»: una LLC de EE. UU. con 45 % se envía y su dueño final es propietario real (45 %); sin registro no se captura; la moral no lleva fecha de nacimiento. e2e «tras un rechazo del socio extranjero…»: entra sin RFC. Capturas `r23`-`r24` |
| **N9 (P2)** El grado de riesgo les decía a Originación y Aprobación «Coincidencias en listas · exacta · 3 puntos» | Para quien no ve la Lista, el factor se llama «Revisión de Cumplimiento» y dice «Lo ve Cumplimiento», sin puntos; tampoco ve el puntaje (lo delataría por diferencia). La hoja se titula «Revisión de Cumplimiento» | e2e «el grado de riesgo no le dice…» con Originación, Aprobación y Cumplimiento. Capturas `r28`-`r32` con los 5 roles (Administración no abre el expediente) |
| **N4 (P3)** La sugerencia del aborto del relleno no se podía seguir | `ADD COLUMN IF NOT EXISTS operator_id` y la llave foránea aparte (se quita y se vuelve a poner por nombre). La sugerencia dice cómo crear la columna, apartar el candado, asignar y volver a aplicar | «H2 y N3: la 0028 sobre una base en la 0027…»: con dos operadores, se sigue la sugerencia al pie de la letra y la 0028 aplica; queda asignada, `NOT NULL`, con su llave y el candado de solo inserción |
| **N7 (P3)** `personal:migrar-variable` creaba Administración aunque ya la hubiera | En la misma transacción y con el candado del personal, `personal_con_administracion` si hay alguien con Administración activo o invitado. Invita a todos los correos de una vez | «H2 y N3…»: la segunda corrida con otro correo, con la primera invitada y luego activa → rechazada, sin usuarios nuevos; varios correos en la primera corrida → todos invitados. La siembra e2e arranca así al operador |
| **N8 (P3)** `ejecutado_por = session_user` no dice qué persona corrió el comando (en Neon siempre es la dueña) | `--quien-corre <correo>` obligatorio en `personal:migrar-variable`, `personal:rol` y `empresa:alta`; se guarda en `cambio` como `corrido_por` junto a `ejecutado_por`. `personal_rol_por_comando` recibe el correo. README: `session_user` es la conexión | «roles iniciales por comando» (sin `--quien-corre`, repetido o sin formato de correo → no hace nada; con él, `corrido_por`), «H2 y N3…» y «S12 y N8». Recorrido: `personal:rol` sin `--quien-corre` y el `corrido_por` del flujo 0 |
| **N10 (P3)** Un documento del expediente con un `formId` usado y otro archivo respondía «Documento guardado» | Se compara el SHA-256 del documento ya guardado (como `lpb.ts`): otro archivo → `formulario_invalido`, y el archivo que sobra se borra | «F4 y F5»: de entrada no sube nada; en la carrera con otro archivo, uno `ok` y otro `formulario_invalido`, 1 evento, 1 borrado que no es el de la fila. Capturas `r26`-`r27` |
| **N11 (P3)** Tras rechazar un dato del socio extranjero, el formulario volvía en «Mexicana» sin el campo marcado | El formulario arranca en «Extranjera» si el error es de país, documento o fecha, y con el tipo de persona que se envió (`&tipo=moral`). Cada error tiene su texto | e2e «tras un rechazo del socio extranjero…» (física y moral). Capturas `r22`-`r23` |
| **N12 (P3)** La pista del dictamen se perdía cuando el motivo tenía error | `aria-describedby` une la pista y el aviso (también en la suspensión y en el documento del socio extranjero) | `tests/operacion/pistas.test.ts`; captura `r33` (`dictamen-motivo-pista aviso-operacion`) |
| **N13 (P3)** «1 coincidencias nuevas» | Singular y plural en renglones y coincidencias | Captura `r34`: «1 renglón; 1 coincidencia nueva.» |
| **N14 (P3)** El borrado del archivo huérfano fallaba en silencio | `console.error` estructurado (`origen: "blob.borrar"`, `evento: "huerfano_sin_borrar"`, la clave y la clase del error) | Revisión de código: sin red no se puede hacer fallar el borrado de Blob en el recorrido |

## Flujo → captura → qué verifica en la base

| Flujo | Captura | Qué verifica en la base |
| --- | --- | --- |
| 0. Roles iniciales por comando | `01-f0-personal-rol-por-comando` | Una sola persona con Administración; el comando le da Originación: 1 fila en `platform_staff_roles` y 1 evento `rol_personal_asignado` con `actor_tipo = 'sistema'` y `origen = 'comando'`. Correrlo dos veces no deja otro. |
| 0. | `02-f0-bitacora-rol-por-comando` | La bitácora lo muestra con su motivo. Quitarlo deja `rol_personal_retirado`; quitar Administración se rechaza. La salida no imprime el connection string. |
| 1. Asignar roles | `03-f1-personal-confirma-identidad` | Con el factor de hace 6 minutos, Personal pide «Confirma que eres tú». |
| 1. | `04-f1-personal-roles-asignados-y-rechazo-50a` | Doble clic en «Dar …» = 1 fila y 1 evento por persona. La base rechaza Cumplimiento para el auditor y para Originación (50ª). |
| 2. Prospecto y expediente | `05-f2-borrador-1-completo` | Doble clic = 1 empresa, 1 versión, 1 representante; 4 accionistas en dos capas; 6 documentos con SHA-256. Un representante y un socio capturados por error se quitan con doble clic en «Quitar»: la fila se conserva marcada, con un solo evento cada una, y la versión 2 no los hereda. |
| 2. | `06-f2-version-1-enviada-propietarios-reales` | Propietarios reales calculados en `kyb_beneficiarios`: 49 % y 30 %; el de 21 % no llega al 25 %. |
| 3. Dictamen | `07-f3-version-1-observada` | «Observado» exige motivo; doble clic = 1 dictamen sobre la versión 1. |
| 3. | `08-f3-version-2-aprobada` | La versión 2 hereda lo de la 1 y queda aprobada; el dictamen de la 1 no cambia. |
| 8 (a). Candado | `09-f8-activacion-rechazada-por-la-base` | Doble clic = 1 solicitud; quien pidió no decide; sin riesgo vigente la base rechaza y la empresa sigue `en_alta`. |
| 4. Riesgo | `10-f4-grado-de-riesgo-registrado` | Doble clic = 1 calificación; la matriz da grado medio. |
| 4. | `11-f4-bandeja-revision-vencida` | Lumbre aparece con «Revisión vencida» (reloj fijo); Ébano, vigente. Con riesgo vigente, otra persona aprueba la activación (8 b). |
| 5. Carga de la lista | `12-f5-lpb-cargada-coincidencias` | Un renglón inválido no deja carga; doble clic = 1 carga con 3 renglones. |
| 6. Posible coincidencia | `13-f6-posible-coincidencia-resuelta` | Coincide solo por nombre: «posible», sin plazo; queda «falso positivo» con motivo y 1 evento. |
| 7. Coincidencia exacta | `14-f7-bandeja-coincidencia-exacta-24h` | Propietaria real con RFC idéntico: empresa `suspendida` sin segunda firma, evento del sistema `empresa_suspendida_lpb` y plazo de 24 h. |
| 7. | `15-f7-folio-anotado` | Cumplimiento anota el folio que presentó por su vía; la pantalla dice que Lever no transmite a la UIF. |
| 7. | `16-f7-invitacion-bloqueada` | Con la empresa suspendida no se emite la invitación: 0 filas en `invitations`. |
| 9. Suspensión manual | `17-f9-pago-rechazado-empresa-suspendida` | Doble firma (pide Originación, aprueba Aprobación). En la página abierta ya suspendida, «Autorizar para pagar» sigue visible; doble clic: el pago sigue `por_autorizar` y no hay evento `autorizar_pago_proveedor`. |
| 9. | `18-f9-nomina-rechazada-empresa-suspendida` | «Preparar nómina» visible; doble clic: 0 lotes en `payroll_batches`. |
| 9. | `19-f9-area-rechazada-empresa-suspendida` | Personas: doble clic en «Crear área»: 0 áreas nuevas en `cost_centers`. |
| 9. | `20-f9-invitacion-rechazada-empresa-suspendida` | Doble clic en «Renovar y reenviar invitación»: el número de invitaciones de Iván no cambia. |
| 9. | `21-f9-aceptar-invitacion-empresa-suspendida` | Con contraseñas distintas el aviso marca los dos campos. Con la empresa suspendida, Iván no puede aceptar: la invitación sigue sin usar y no hay membresía activa; el aviso se titula «La empresa está suspendida» y no marca los campos de contraseña. Además, como rol cliente directo en la base, liberar, preparar lote y editar un proveedor se rechazan con `empresa_suspendida`. |
| 9. | `22` a `27-f9-consola-aviso-suspendida-<tema>-<ancho>` | El aviso de empresa suspendida en Oscuro, Claro y Lever, a 1440 y 390. |
| 10. Reactivar | `28-f10-reactivacion-bloqueada-por-lpb` | Suspendida por la lista y con coincidencia confirmada, no se pide la reactivación: 0 solicitudes. |
| 10. | `29-f10-reactivacion-aprobada` | Doble clic = 1 solicitud; otra persona aprueba; el historial guarda suspender y reactivar; la nómina se prepara otra vez (1 lote). |
| 11. Proveedor en la lista | `30-f11-lpb-segunda-carga` | La carga nueva se guarda aparte; la contraparte coincide sin suspender a la empresa; el falso positivo no se reabre. |
| 11. | `31-f11-pago-bloqueado-proveedor-en-lista` | Doble clic en «Autorizar para pagar»: el pago sigue `por_autorizar`; el mensaje no revela la lista. |
| 12. Lectura auditada | `32-f12-bitacora-lecturas-auditadas` | Abrir el expediente deja `expediente_consultado`; descargar deja `expediente_documento_descargado` y la SHA-256 coincide. |
| 12. | `33-f12-sin-permiso-personal` | Auditoría ve «Sin permiso» en Personal. |

### Regresiones (`FASES=regresiones`)

| Hallazgo | Captura | Qué verifica en la base |
| --- | --- | --- |
| H12 | `r01-h12-pago-regresa-por-autorizar` | El pago que Rosa autorizó antes del flujo 9 regresó a `por_autorizar` al suspender a Taller: 1 evento del sistema `regresar_pago_proveedor` con «La empresa quedó suspendida. La autorización anterior se retiró.», que el historial muestra. |
| H12 | `r02-h12-pago-autorizado-de-nuevo` | Con Taller reactivada, doble clic en «Autorizar para pagar» = 1 autorización nueva; queda `listo_para_pagar`. |
| F4 | `r03-f4-doble-envio-dos-pestanas` | Dos pestañas abren versión a la vez: 1 versión nueva; la otra pestaña dice «Ya hay un borrador abierto», no «base no disponible». |
| F1 | `r04-f1-documento-pasa-del-tope` | Al elegir un PDF de 4.6 MB aparece el aviso ligado al campo; el clic en «Guardar documento» no envía y hay 0 filas nuevas en `kyb_documentos`. |
| F8 | `r05-f8-originacion-ve-en-revision` | Originación ve «En revisión de Cumplimiento»; la página no trae el folio ni el motivo de Cumplimiento. |
| F8 | `r06-f8-ficha-originacion-sin-motivo` | En la ficha, la suspensión dice «en revisión de Cumplimiento», sin el motivo de la lista. |
| F8 | `r07-f8-cumplimiento-ve-el-detalle` | Cumplimiento ve el caso con su folio. |
| F8 | `r08-f8-bitacora-administracion-sin-motivo` | La bitácora de Administración no trae los motivos de la lista. |
| F8 | `r09-f8-bitacora-auditoria-con-motivo` | La de Auditoría sí. Después, la descarga del expediente responde 200 con `sandbox; default-src 'none'; frame-ancestors 'none'` y deja su evento (F2). |
| F1 | `r10-f1-lista-pasa-del-tope` | Una lista de 4.6 MB: aviso en el campo, el clic no envía y hay 0 cargas nuevas. |
| S11 | `r11-s11-pista-dictamen-cumplimiento` | Antes, Celia carga por pantalla una lista con Brisa Regresión (en alta, activación pedida): queda 1 caso abierto. En el dictamen de Cedro Regresión, bajo «Motivo», Cumplimiento lee la pista, ligada al campo. |
| S11 | `r12-s11-pista-reactivacion-cumplimiento` | En la ficha de Ébano (suspendida), la pista bajo «Motivo» de la reactivación. |
| S5 | `r13-s5-aprobacion-aviso-sin-la-lista` | Ana aprueba la activación de Brisa: `activacion_con_coincidencia_lpb` con «Cumplimiento tiene un caso abierto…», sin «Lista» ni «bloqueada»; Brisa sigue en alta. |
| S5 | `r14-s5-originacion-aviso-sin-la-lista` | Omar no ve la pista. Pide reactivar a Ébano: `reactivacion_con_coincidencia_lpb` con el aviso neutro y 0 solicitudes. |
| N2 | `r15-n2-formulario-socio-extranjero` | Con «Extranjera», el formulario pide país, pasaporte o identificación y fecha de nacimiento, y no CURP. |
| N2 | `r16-n2-documento-obligatorio` | Sin documento, el clic en «Agregar accionista» no envía: el campo es obligatorio (el servidor y la base también lo exigen). |
| N2 | `r17-n2-socio-extranjero-en-el-borrador` | Con «x12-345 678»: el borrador dice «Estados Unidos · identificación X12345678 · nació el…» y la base guarda `US X12345678 1980-05-01`. |
| S6 | `r18-s6-bitacora-administracion-sin-eventos-de-la-lista` | La bitácora de Ofelia (Administración) no trae coincidencias, resoluciones ni suspensiones por la lista; la carga, sí. |
| S6 | `r19-s6-bitacora-auditoria-con-eventos-de-la-lista` | La de Aurelio (Auditoría) sí trae las coincidencias detectadas. |
| S7 | `r20-s7-contrato-pasa-del-tope` | Gil elige un contrato de 4.6 MB en «Agregar contrato»: aviso ligado al campo, 0 envíos y 0 documentos nuevos. |
| H2 | `r21-h2-portal-consulta-la-copia-de-su-operador` | La dueña siembra otro operador con una copia más reciente que trae CSR010101AB1 en definitivo (sin red no hay SAT). El portal de Taller consulta ese RFC: «No aparece en la lista 69-B.», con la fecha de la copia de su operador. Antes, con un solo operador, el recorrido corre los comandos de la dueña: `personal:rol` sin `--quien-corre` no hace nada, `personal:migrar-variable` con Administración activa no invita a nadie (N7) y el rol del flujo 0 trae `corrido_por` (N8). |
| N11 | `r22-n11-rechazo-socio-extranjero-fisica` | Omar agrega a una persona física extranjera con documento «A1»: `dato_invalido_documentoExtranjero` con «…de 4 a 20 letras y números…». El formulario vuelve en «Persona física» y «Extranjera», con el documento `aria-invalid` y `aria-describedby="acc-documento-pista aviso-operacion"`. 0 socios nuevos. |
| N11 | `r23-n11-rechazo-socio-extranjero-moral` | Lo mismo con Delaware Holdings LLC (moral): vuelve en «Persona moral» y «Extranjera», con «Número de identificación fiscal o de registro en su país» marcado. |
| N6 | `r24-n6-moral-extranjera-en-el-borrador` | Con «12-3456789» y sin RFC («RFC en México (si tiene)»): el borrador dice «Estados Unidos · registro 123456789» y la base guarda `sin RFC US 123456789`. |
| N2 | `r25-n2-misma-persona-dos-identificadores` | «SMITH TAYLOR, John» con otro documento (D98765432) y la misma fecha que John Smith Taylor: se agrega, pero «Enviar versión» → `expediente_misma_persona_dos_identificadores`, con el aviso de qué corregir; la versión sigue en borrador. |
| N10 | `r26-n10-mismo-formulario-otro-archivo` | Se guarda la estructura corporativa; con el `formId` de ese envío (una segunda pestaña) y otro archivo: «El formulario caducó. Recarga la página.» y ningún documento nuevo. |
| N10 | `r27-n10-mismo-formulario-mismo-archivo` | El mismo `formId` con el mismo archivo: «Documento guardado» sin un documento de más. |
| N9 | `r28-n9-riesgo-omar` | Celia registra la revisión periódica de Brisa con su caso abierto. Originación ve «Grado alto» y los demás factores; «Revisión de Cumplimiento: Lo ve Cumplimiento», sin «lista», «exacta» ni «Puntaje»; la hoja se titula «Revisión de Cumplimiento». |
| N9 | `r29-n9-riesgo-ana` | Aprobación, igual. |
| N9 | `r30-n9-riesgo-celia` | Cumplimiento ve «Coincidencias en listas · exacta · 3 puntos» y el puntaje. |
| N9 | `r31-n9-riesgo-aurelio` | Auditoría, igual que Cumplimiento. |
| N9 | `r32-n9-riesgo-ofelia` | Administración no abre el expediente. |
| N12 | `r33-n12-dictamen-sin-motivo-pista-y-aviso` | Celia observa la versión de Cedro sin motivo: `motivo_invalido`; el motivo queda `aria-invalid` con `aria-describedby="dictamen-motivo-pista aviso-operacion"`. |
| N13 | `r34-n13-carga-un-renglon` | Celia carga una lista de un renglón (Cedro): «1 renglón; 1 coincidencia nueva.» |

Las capturas `NN-pantalla-<pantalla>-<tema>-<ancho>` son la fase de pantallas: un solo h1, campos con etiqueta, sin desborde horizontal y consola limpia en Personal, Cumplimiento, Lista, Expediente, Ficha, Aprobaciones, Clientes, Bitácora y Sin permiso.

## Salida literal

<details>
<summary>Flujos 0-12 (<code>FASES=flujos</code>)</summary>

```text

— Arranque: comando de roles iniciales cuando Ofelia es la única que administra al personal
OK    0. como en producción, una sola persona administra al personal y nadie puede darle un rol por pantalla
OK    0. el comando le da Originación a Ofelia
OK    0. correrlo dos veces no cambia nada
OK    0. una fila y un solo evento «rol_personal_asignado» del comando, con su motivo
OK    0. el comando no imprime el connection string
OK    0. Personal muestra a Ofelia con Originación
OK    0. la bitácora muestra «Asignó un rol del personal»
OK    0. quitarlo deja su propio evento
OK    0. el comando no deja al personal sin administración
OK    0. Ofelia vuelve a solo Administración: los flujos siguen como en producción

— Flujo 1: Administración asigna roles; el auditor no recibe Cumplimiento
OK    1. con el factor de hace 6 minutos, Personal pide «Confirma que eres tú» antes de tocar roles
OK    1. Ofelia confirmó con su app autenticadora y la pantalla deja asignar roles
OK    aviso «rol_asignado» tras la acción
OK    1. Omar Originación recibe Originación (doble clic = 1 fila)
OK    1. un solo evento «rol_personal_asignado» para Omar Originación
OK    aviso «rol_asignado» tras la acción
OK    1. Ana Aprobación recibe Aprobación (doble clic = 1 fila)
OK    1. un solo evento «rol_personal_asignado» para Ana Aprobación
OK    aviso «rol_asignado» tras la acción
OK    1. Celia Cumplimiento recibe Cumplimiento (doble clic = 1 fila)
OK    1. un solo evento «rol_personal_asignado» para Celia Cumplimiento
OK    aviso «rol_asignado» tras la acción
OK    1. Aurelio Auditoría recibe Auditoría (doble clic = 1 fila)
OK    1. un solo evento «rol_personal_asignado» para Aurelio Auditoría
OK    aviso «roles_incompatibles» tras la acción
OK    1. la pantalla explica la 50ª: Cumplimiento no se junta con Auditoría
OK    1. la base no dejó a Aurelio con Cumplimiento
OK    aviso «roles_incompatibles» tras la acción
OK    1. tampoco Originación con Cumplimiento (Omar)
OK    1. la fila de Ofelia no tiene botones: nadie se da roles a sí mismo
Distribuidora Lumbre lista: expediente aprobado y revisión de riesgo vencida el 2026-10-07.

— Flujo 2: Originación registra el prospecto y arma el expediente (2 capas, propietarios reales calculados)
OK    aviso «prospecto_registrado» tras la acción
OK    2. doble clic en «Registrar prospecto» = 1 empresa
OK    aviso «expediente_version_creada» tras la acción
OK    2. doble clic en «Abrir versión 1» = 1 versión
OK    aviso «expediente_datos_guardados» tras la acción
OK    aviso «expediente_representante_agregado» tras la acción
OK    2. doble clic en «Agregar representante» = 1 representante
OK    aviso «expediente_representante_agregado» tras la acción
OK    aviso «expediente_retirado» tras la acción
OK    2. doble clic en «Quitar» = 1 representante quitado del borrador, con un solo evento; la fila se conserva
OK    aviso «expediente_accionista_agregado» tras la acción
OK    aviso «expediente_accionista_agregado» tras la acción
OK    aviso «expediente_accionista_agregado» tras la acción
OK    aviso «expediente_accionista_agregado» tras la acción
OK    2. cuatro accionistas en dos capas, sin duplicados por doble clic
OK    aviso «expediente_accionista_agregado» tras la acción
OK    aviso «expediente_retirado» tras la acción
OK    2. doble clic en «Quitar» = 1 socio quitado con un solo evento; quedan los cuatro de la estructura
OK    aviso «expediente_documento_cargado» tras la acción
OK    aviso «expediente_documento_cargado» tras la acción
OK    aviso «expediente_documento_cargado» tras la acción
OK    aviso «expediente_documento_cargado» tras la acción
OK    aviso «expediente_documento_cargado» tras la acción
OK    aviso «expediente_documento_cargado» tras la acción
OK    2. seis documentos guardados, cada uno con su SHA-256
OK    aviso «expediente_enviado» tras la acción
OK    2. propietarios reales calculados: Mariana 49 % (70 % × 70 %) y Joaquín 30 %; Héctor (21 %) no llega al 25 %
OK    2. la vista de la versión enviada muestra la estructura y los propietarios reales

— Flujo 3: Cumplimiento observa la versión 1; Originación abre la 2; Cumplimiento aprueba
OK    3. la versión 1 aparece en «Expedientes por dictaminar»
OK    3. «observado» sin motivo no se registra
OK    aviso «expediente_dictaminado» tras la acción
OK    3. dictamen «observado» con motivo sobre la versión 1 (doble clic = 1)
OK    aviso «expediente_version_creada» tras la acción
OK    3. la versión 2 hereda accionistas, representantes y documentos de la 1
OK    aviso «expediente_documento_cargado» tras la acción
OK    aviso «expediente_enviado» tras la acción
OK    aviso «expediente_dictaminado» tras la acción
OK    3. la versión 2 queda aprobada por Cumplimiento
OK    3. el dictamen de la versión 1 no cambia (append-only)

— Flujo 8 (a): Originación pide la activación; la base la rechaza sin grado de riesgo
OK    aviso «activacion_solicitada» tras la acción
OK    8. doble clic en «Solicitar activación» = 1 solicitud
OK    8. Originación no decide su propia solicitud
OK    8. la base rechaza la activación: falta un grado de riesgo vigente
OK    8. Aprobación ve el mensaje propio del candado
OK    8. la empresa sigue en alta

— Flujo 4: Cumplimiento califica el riesgo; la revisión vencida aparece en la bandeja
OK    aviso «riesgo_calificado» tras la acción
OK    4. doble clic en «Registrar grado al alta» = 1 calificación
OK    4. matriz de factores: actividad media + dos capas + volumen = grado medio
OK    4. la bandeja marca «Revisión vencida» a Distribuidora Lumbre (calificada hace 7 meses; se calcula al leer)
OK    4. Grupo Ébano aparece «Vigente» con su fecha de revisión

— Flujo 8 (b): con todo en regla, otra persona aprueba la activación
OK    8. Aprobación aprueba y la base deja pasar en_alta → activa
OK    8. Grupo Ébano queda activa
OK    8. con la empresa activa, la ficha ofrece invitar al primer administrador

— Flujo 5: Cumplimiento carga la Lista de Personas Bloqueadas (CSV documentado)
OK    aviso «lpb_renglon_invalido» tras la acción
OK    5. un renglón inválido se rechaza diciendo qué línea revisar
OK    5. el archivo con error no deja carga
OK    aviso «lpb_cargada» tras la acción
OK    5. doble clic en «Cargar y cotejar» = 1 carga con 3 renglones
OK    5. el aviso dice cuántos renglones y coincidencias nuevas

— Flujo 6: posible coincidencia por nombre; nunca se descarta sola, la resuelve Cumplimiento con motivo
OK    6. Héctor (accionista) coincide solo por nombre: «posible», pendiente y sin plazo de reporte
OK    6. la fila dice «Nombre parecido»
OK    aviso «coincidencia_resuelta» tras la acción
OK    6. queda «falso positivo» con motivo y con quién lo resolvió
OK    6. un solo evento de resolución (doble clic)

— Flujo 7: coincidencia exacta de un propietario real → suspensión inmediata y pendiente de 24 horas
OK    7. la carga detectó a Mariana Ébano Ruiz (propietaria real) por RFC idéntico
OK    7. Grupo Ébano quedó suspendida de inmediato, sin segunda firma
OK    7. evento del sistema «empresa_suspendida_lpb»
OK    7. plazo de reporte: 24 horas desde la detección
OK    7. la bandeja muestra «RFC idéntico» con su plazo
OK    aviso «coincidencia_resuelta» tras la acción
OK    aviso «reporte_registrado» tras la acción
OK    7. Cumplimiento anota el folio que presentó por su vía (Lever no transmite)
OK    7. el texto dice la verdad: Lever no transmite a la UIF
OK    7. con la empresa suspendida, la invitación queda bloqueada
OK    7. no quedó ninguna invitación

— Flujo 9: suspensión manual con doble firma; la consola queda en solo lectura veraz
OK    aviso «suspension_solicitada» tras la acción
OK    9. doble clic en «Pedir suspensión» = 1 solicitud pendiente
OK    9. sin la segunda firma la empresa sigue activa
OK    9. quien pidió no decide
OK    9. Aprobación (otra persona) aprueba la suspensión
OK    9. Taller del Cierre queda suspendida
OK    9. el aviso de empresa suspendida se ve arriba de la consola
OK    9. Pagos sigue ofreciendo «Autorizar para pagar» a Rosa
OK    9. doble clic en «Autorizar para pagar»: la base lo rechaza, el pago sigue por autorizar y no hay evento
OK    9. Nómina sigue ofreciendo «Preparar nómina» a Gil
OK    9. doble clic en «Preparar nómina»: la base lo rechaza y no hay lote
OK    9. Personas: doble clic en «Crear área»: la base lo rechaza y no hay área
OK    9. Invitaciones: doble clic en «Renovar y reenviar invitación»: la base lo rechaza y no sale otra
OK    9. con contraseñas distintas, el aviso marca los dos campos de contraseña
OK    9. Iván no puede aceptar su invitación: la base lo rechaza y la pantalla dice que la empresa está suspendida
OK    9. el aviso de la suspensión no marca los campos de contraseña: el motivo es la empresa, no lo escrito
OK    9. directo en la base como rol cliente, liberar el pago: rechazado con «empresa_suspendida»
OK    9. directo en la base como rol cliente, preparar un lote: rechazado con «empresa_suspendida»
OK    9. directo en la base como rol cliente, editar un proveedor: rechazado con «empresa_suspendida»

— Flujo 10: reactivar con doble firma; tras la lista, primero el dictamen de falso positivo
OK    aviso «reactivacion_con_coincidencia_lpb» tras la acción
OK    10. Grupo Ébano (suspendida por la lista, coincidencia confirmada) no se puede reactivar sin dictamen de falso positivo
OK    aviso «reactivacion_solicitada» tras la acción
OK    10. doble clic en «Pedir reactivación» = 1 solicitud
OK    10. Aprobación aprueba y Taller vuelve a activa
OK    10. el historial guarda suspender y reactivar
OK    10. el aviso desaparece de la consola
OK    10. reactivada, la nómina se prepara otra vez

— Flujo 11: proveedor en la lista → ese pago queda bloqueado
OK    aviso «lpb_cargada» tras la acción
OK    11. la carga nueva se guarda aparte; la anterior no se borra
OK    11. la pantalla distingue la carga vigente de la anterior
OK    11. Servicios Norte Integrales coincide como contraparte de Taller
OK    11. una contraparte no suspende a la empresa
OK    11. el falso positivo dictaminado no se reabre con la carga nueva
OK    11. la base no libera el pago a un proveedor en la lista; el mensaje no revela la lista

— Flujo 12: lectura auditada (abrir el expediente y descargar un documento) en la bitácora
OK    12. abrir el expediente deja «expediente_consultado» con Aurelio, la hora y la empresa
OK    12. Auditoría consulta sin botones de captura ni dictamen
OK    12. la descarga entrega el PDF guardado
OK    12. la SHA-256 del archivo descargado coincide con la guardada en la base
OK    12. descargar deja «expediente_documento_descargado»
OK    12. la bitácora muestra las dos lecturas con su etiqueta
NOTA  f12-bitacora-lecturas-auditadas: la página mide 10882 px y no cabe en una captura completa; se guarda la ventana
OK    12. Auditoría ve «Sin permiso» en Personal
OK    consola del navegador limpia en todos los flujos

147 comprobaciones en verde, 0 en rojo.
```

</details>

<details>
<summary>Pantallas y contraste (<code>FASES=pantallas,contraste</code>)</summary>

```text

— Pantallas: 3 temas × 1440/390
OK    pantalla personal oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla personal oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla personal claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla personal claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla personal lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla personal lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla cumplimiento oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla cumplimiento oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla cumplimiento claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla cumplimiento claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla cumplimiento lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla cumplimiento lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla lpb oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla lpb oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla lpb claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla lpb claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla lpb lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla lpb lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla expediente oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla expediente oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla expediente claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla expediente claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla expediente lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla expediente lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla ficha oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla ficha oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla ficha claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla ficha claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla ficha lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla ficha lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla aprobaciones oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla aprobaciones oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla aprobaciones claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla aprobaciones claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla aprobaciones lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla aprobaciones lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla clientes oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla clientes oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla clientes claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla clientes claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla clientes lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla clientes lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-oscuro-1440: la página mide 11409 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-oscuro-390: la página mide 28494 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-claro-1440: la página mide 11409 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-claro-390: la página mide 28494 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-lever-1440: la página mide 11409 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-lever-390: la página mide 28494 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso lever 390: un h1, campos con etiqueta, sin desborde, consola limpia

— Contraste AA por texto
OK    contraste oscuro 1440: 370 textos, mínimo 5.08
OK    contraste oscuro 390: 168 textos, mínimo 6.12
OK    contraste claro 1440: 370 textos, mínimo 5.14
OK    contraste claro 390: 168 textos, mínimo 5.05
OK    contraste lever 1440: 370 textos, mínimo 5.00
OK    contraste lever 390: 168 textos, mínimo 5.89

60 comprobaciones en verde, 0 en rojo.
```

</details>

<details>
<summary>Regresiones (<code>FASES=regresiones</code>)</summary>

```text

— Regresiones: pago que regresa, doble envío en dos pestañas, aviso de tamaño y lo que ve cada rol
OK    H12. el pago que estaba listo para pagar regresó a «por autorizar» al suspender a Taller (flujo 9)
OK    H12. un solo evento del sistema, con el motivo
OK    H12. el historial del pago dice por qué regresó
OK    H12. la cabeza del pago dice «Por autorizar»
OK    H12. con Taller reactivada, doble clic en «Autorizar para pagar» = una autorización nueva
OK    F4. dos pestañas a la vez: una versión nueva; la otra pestaña dice «Ya hay un borrador abierto», no «base no disponible»
OK    F4. el aviso de la pestaña que llegó tarde
OK    F1. al elegir el PDF de 4.6 MB aparece el aviso, ligado al campo, antes de enviar
OK    F1. clic en «Guardar documento»: no sale la petición y hay 0 filas nuevas
OK    F8. Originación ve en el expediente «En revisión de Cumplimiento»
OK    F8. Originación no ve el folio ni el motivo de Cumplimiento
OK    F8. en la ficha, Originación ve la suspensión «en revisión de Cumplimiento», sin el motivo
OK    F8. Cumplimiento ve el detalle del caso con su folio
OK    F8. Administración no lee en la bitácora los motivos de la lista
OK    F8. Auditoría sí lee el motivo de Cumplimiento
OK    F2. la descarga del expediente llega con «sandbox; default-src 'none'» y deja su evento
OK    F1. al elegir la lista de 4.6 MB aparece el aviso ligado al campo
OK    F1. clic en «Cargar y cotejar»: no sale la petición y hay 0 cargas nuevas

— Tercera revisión: avisos sin la lista, pistas de Cumplimiento, socio extranjero, bitácora, contrato y 69-B por operador
Brisa Regresión en alta con la activación pedida; Cedro Regresión con su versión por dictaminar.
OK    N8. personal:rol sin --quien-corre no hace nada
OK    N7. personal:migrar-variable con Administración activa no invita a nadie
OK    N8. el rol que dio el comando queda en la bitácora con el correo de quien lo corrió (corrido_por) además de la conexión
OK    aviso «lpb_cargada» tras la acción
OK    S5. la carga deja un caso abierto de Brisa Regresión, que sigue en alta
OK    S11. bajo «Motivo» del dictamen, Cumplimiento lee la pista, ligada al campo
OK    S11. bajo «Motivo» de la reactivación, Cumplimiento lee la pista
OK    S5. Aprobación ve «Cumplimiento tiene un caso abierto…», sin «Lista» ni «bloqueada»
OK    S5. Brisa Regresión sigue en alta
OK    S11. Originación no ve la pista de Cumplimiento
OK    aviso «reactivacion_con_coincidencia_lpb» tras la acción
OK    S5. Originación ve «Cumplimiento tiene un caso abierto…», sin «Lista» ni «bloqueada»
OK    S5. no queda solicitud de reactivación
OK    N2. con «Extranjera» el formulario pide país, pasaporte o identificación y fecha de nacimiento, y no CURP
OK    N2. clic en «Agregar accionista» sin documento: el navegador no envía, el campo es obligatorio
OK    aviso «expediente_accionista_agregado» tras la acción
OK    N2. el socio extranjero queda en el borrador con su país, su documento normalizado y su fecha de nacimiento
OK    S6. la bitácora de Administración no trae coincidencias, resoluciones ni suspensiones por la lista; la carga, sí
OK    S6. Auditoría sí lee las coincidencias detectadas
OK    S7. clic en «Guardar el contrato» con 4.6 MB: aviso ligado al campo, 0 envíos y 0 documentos nuevos
OK    H2. el portal consulta la copia de su operador: el RFC en definitivo de otro operador no aparece y la fecha es la de su copia

— Cuarta revisión: socio extranjero física y moral, misma persona, grado de riesgo por rol, formulario reusado, pistas y carga
OK    aviso «dato_invalido_documentoExtranjero» tras la acción
OK    N11. tras el rechazo de la persona física extranjera, el formulario vuelve en «Extranjera» con el documento marcado y su texto
OK    aviso «dato_invalido_documentoExtranjero» tras la acción
OK    N11. tras el rechazo de la moral extranjera, vuelve como persona moral, en «Extranjera» y con el registro marcado
OK    N6. con «Extranjera» el RFC es opcional
OK    aviso «expediente_accionista_agregado» tras la acción
OK    N6. Delaware Holdings LLC queda en el borrador sin RFC, con su país y su registro normalizado
OK    aviso «expediente_accionista_agregado» tras la acción
OK    aviso «expediente_misma_persona_dos_identificadores» tras la acción
OK    N2. la misma persona con dos documentos no se envía; el aviso dice qué corregir y el borrador sigue abierto
OK    aviso «expediente_documento_cargado» tras la acción
OK    aviso «formulario_invalido» tras la acción
OK    N10. mismo formulario con otro archivo: «El formulario caducó» y ningún documento nuevo
OK    aviso «expediente_documento_cargado» tras la acción
OK    N10. mismo formulario con el mismo archivo: se da por guardado sin un documento de más
OK    aviso «riesgo_calificado» tras la acción
OK    N9. Originación ve el grado y los demás factores; el de listas dice «Lo ve Cumplimiento», sin puntos ni puntaje
OK    N9. Aprobación ve el grado y los demás factores; el de listas dice «Lo ve Cumplimiento», sin puntos ni puntaje
OK    N9. Cumplimiento ve el factor de listas con sus puntos
OK    N9. Auditoría ve el factor de listas con sus puntos
OK    N9. Administración no abre el expediente
OK    aviso «motivo_invalido» tras la acción
OK    N12. el motivo con error anuncia la pista y el aviso
OK    aviso «lpb_cargada» tras la acción
OK    N13. el detalle de la carga va en singular
OK    consola del navegador limpia en las regresiones

65 comprobaciones en verde, 0 en rojo.
```

</details>
