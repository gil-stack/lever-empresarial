# Evidencia de la Ola R1: alta regulada de empresas

Recorrido con clics reales de Playwright headless (`scripts/evidencia/ola-r-alta.mjs`) contra `next build` + `next start`, sobre una base recién migrada (0001-0028) y sembrada. Cada envío se hace con doble clic y la base confirma que quedó una sola operación.

| Fase | Resultado | Datos |
| --- | --- | --- |
| Flujos 0-12 | 147 comprobaciones en verde, 0 en rojo, consola del navegador limpia | `datos/resultados-flujos.json` |
| Pantallas (3 temas × 1440/390) y contraste AA medido | 60 comprobaciones en verde, 0 en rojo; contraste mínimo 5.00 (Lever 1440) | `datos/resultados-pantallas-contraste.json` |
| Regresiones de las revisiones del PR (pago que regresa, doble envío, tope de 4 MB, lo que ve cada rol, descarga aislada; avisos sin la lista, pistas de Cumplimiento, socio extranjero, bitácora de Administración, contrato y 69-B por operador; socio extranjero física y moral con su rechazo, la misma persona con dos documentos, el grado de riesgo con los 5 roles, el formulario reusado, la pista con el error, la carga de un renglón y los comandos de la dueña; el grado sin desglose con y sin caso, el socio extranjero tras el rechazo de otro campo, el motivo corto y el arranque de un operador sin personal; el motivo con emoji y con Enter, el diálogo de Aprobaciones que conserva el motivo, el socio extranjero que vuelve con todo lo capturado, el borrado con Blob caído, la vigencia invertida y, en la consola, el RFC con guion o de guiones, los motivos con emoji del cobro y del pago y el XML con un control y con «&amp;»; el representante, el socio y la razón social con un control, el giro y el cobro con el control como espacio, el RFC con tabulador, el alta y el área con su aviso y las fechas de Pagos en su campo; el aviso propio del carácter invisible en el socio, el representante, las razones sociales y el folio, el representante que conserva lo capturado, el documento extranjero y la Lista con tabulador, el motivo con un emoji compuesto y el contrato con «Vigente hasta»; el representante con un relleno hangul, el envío sin giro ni domicilio, las fechas del folio en su campo y la recuperación marcada en su tarjeta; sin JavaScript la entrada, el giro, el dictamen y el archivo, las claves repetidas en la dirección, el foco del archivo rechazado y los valores largos a 390; el mensaje del error junto al campo, el representante sin JavaScript y el motivo de la coincidencia, y en cada aviso un solo campo marcado) | 215 comprobaciones en verde, 0 en rojo, consola limpia | `datos/resultados-regresiones.json`, `datos/quinta-arranque.txt`, `datos/sexta-huerfanos.json` |

Corrida del 2026-11-09 sobre el head de este PR, con los arreglos de las once revisiones (H1-H12 y F1-F9; el resto de H2, N1-N3 y S5-S12 de la re-verificación sobre `57caa83`; N2-resto, N4-N14 de la re-verificación sobre `fd139bf`; serv-N9, serv-N15-N17 y base-N15-N18 de la re-verificación sobre `c67424a`; base-N19-N22, serv-N15-resto, serv-N16-resto, serv-N18, sexta-N1, líder-N1-N3, bar-1-bar-10 y serv-nuevo-1-3 de la re-verificación sobre `701bc25`; base-N23 = serv-nuevo-4 y dos P3 de avisos de la re-verificación sobre `98224e0`; la carrera de F4 y F5 del CI, serv-nuevo-5, base-N24, base-N25, el aviso propio del carácter invisible y dos P3 de la re-verificación sobre `b2db0b5`; la bomba de fechas de `test:db`, base-N26, base-N27, serv-nuevo-6b y serv-nuevo-6d de la re-verificación sobre `a75d5e4`; N5 del CI, base-N28, serv-nuevo-7, los textos que no se ven, el JSDoc, dos reglas de axe, el campo de archivo y el desborde a 390 de la re-verificación sobre `32e49b8`; el mensaje junto al campo, el P2 de los formularios sin JavaScript, el motivo de la coincidencia, U+2800 y los Cf, y la nota del dictamen aprobado de la re-verificación sobre `edefd2e`), sobre una base migrada de cero con la 0028 final. Las tres fases corrieron sobre el código final de la onceava revisión.

## Cómo se corre

Puertos de esta línea: Postgres 5551, `next start` 4811 (y 3151 para la base del arranque de la quinta revisión), emulador de Blob 4894. Nada toca Neon, Blob ni Resend reales: la base es un Postgres 17 local y el almacén privado es el emulador de `tests/e2e/blob-local`, que el preload desvía solo en el servidor de la prueba.

1. Postgres 17 desechable en `127.0.0.1:5551` (Homebrew: `initdb` y `pg_ctl -o "-p 5551"`).
2. Emulador de Blob en 4894: `iniciarBlobLocal(4894, <token falso del almacén «e2elocal»>)` de `tests/e2e/blob-local/servidor.ts`. La sexta revisión le pide con `POST /simular` que el borrado responda 503 o no responda, y lo regresa a la normalidad.
   - **Va encendido antes de `preparar.ts`.** Cada fase revisa el `/salud` del emulador con un tope de 3 segundos. Si no responde, termina con salida 1 y «El emulador de Blob no responde en …». Antes se colgaba sin salida, porque la subida de `@vercel/blob` reintenta en silencio.
3. Variables (sin valores reales, todos locales):
   - `ESTADO`: archivo fuera del repositorio. Guarda semillas TOTP, sesiones y el enlace de una invitación; nada de eso se imprime.
   - `DUENO_URL`: el Postgres administrador local; `preparar.ts` crea ahí la base `ola_r_alta`.
   - `AUTENTICACION_LLAVE_TOTP` (32 bytes en base64url), la misma para `preparar.ts` y para `next start`.
   - `AUTENTICACION_DOMINIOS=localhost`, `URL_APLICACION=http://localhost:4811`, `E2E_SERVER_ACTIONS=1`.
   - `BLOB_READ_WRITE_TOKEN` (el falso del emulador), `VERCEL_BLOB_API_URL`, `E2E_BLOB_LOCAL_URL` y `E2E_BLOB_LOCAL=1`.
   - `REGISTRO_SERVIDOR`, solo para `FASES=regresiones`: el archivo con la salida del `next start` de 4811. La sexta revisión lee ahí el registro `huerfano_sin_borrar`. Sin la variable, las regresiones se detienen con «Falta REGISTRO_SERVIDOR…».
   - `BASE_ARRANQUE`, solo para `FASES=regresiones`: la dirección del segundo `next start` (paso 8).
4. `next build`.
5. `tsx scripts/evidencia/ola-r-alta/preparar.ts base`: migra desde cero, siembra Taller del Cierre (Gil y Rosa), Marta con nómina semanal que vence hoy, Iván con su invitación por aceptar y al personal SOFIPO (Ofelia administra; Omar, Ana, Celia y Aurelio sin rol).
6. `next start -p 4811` con `DATABASE_URL` de la aplicación (la deja `ESTADO`), `NODE_ENV=production` y `NODE_OPTIONS=--import=tests/e2e/blob-local/preload.mjs`. Su salida va a un archivo: es el `REGISTRO_SERVIDOR` de las regresiones.
7. `BASE=http://localhost:4811 FASES=flujos node scripts/evidencia/ola-r-alta.mjs`, después `FASES=pantallas,contraste` y al final `FASES=regresiones` con `REGISTRO_SERVIDOR` y `BASE_ARRANQUE`, sobre la misma base. Las regresiones tardan más de 10 minutos. La fase `lumbre` de `preparar.ts` la llama el flujo 1. Las regresiones parten del estado que dejan los flujos y numeran sus capturas aparte (`rNN-…`).
8. Antes de `FASES=regresiones`: `preparar.ts arranque` crea la base aparte `ola_r_alta_arranque` (solo las migraciones: un operador y 0 personal, como Preview) y deja su conexión en `ESTADO`; un segundo `next start -p 3151` con esa `DATABASE_URL` y `URL_APLICACION=http://localhost:3151` sirve sus enlaces (`BASE_ARRANQUE`). La quinta revisión corre ahí el comando de arranque.
9. Con el mismo `next start` de 4811: `ESTADO=… BASE=http://localhost:4811 node scripts/evidencia/ola-r-alta/axe.mjs`. Corre las dos reglas de axe de la décima revisión con los 5 roles, a 1440 y 390, e imprime lo que oye un lector del logotipo y de la bandeja.

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

Al migrar, la 0028 pasa las copias que ya existían al único operador. Con más de uno se detiene (`lista_69b_sin_operador`) y la sugerencia dice cómo asignar cada copia a mano. Una copia que leían proveedores de empresas de dos operadores se duplica, una por operador con sus renglones (con la relectura apartada mientras se inserta, para que la copia nueva no se lleve a los proveedores de todos), y los proveedores de cada operador pasan a la suya. Al final del relleno, si algún proveedor quedó leído contra la copia de otro operador, la 0028 se detiene (`lista_69b_de_otro_operador`) sin dejar nada a medias (base-N17).

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

Al enviar, la base rechaza dos personas físicas con el mismo nombre normalizado (como en la lista: sin orden de palabras, acentos ni puntuación) y la misma fecha de nacimiento (la capturada o la de su CURP, posiciones 5 a 10) que tengan identificadores distintos, si a una de las dos le falta la CURP o las dos traen la misma: `expediente_misma_persona_dos_identificadores`, con un aviso que dice qué corregir. Cubre la CURP en un camino y el pasaporte en otro, el mexicano que se declara extranjero y el extranjero con dos documentos. Dos mexicanos homónimos nacidos el mismo día con CURP distinta (otra homoclave o entidad) son dos personas y se envían (base-N16).

**Límites que quedan.**

- Un nombre escrito distinto (otra grafía, un apellido de menos o un segundo nombre) no se detecta.
- Una fecha de nacimiento capturada distinta tampoco (base-N18): el pasaporte con un día de diferencia respecto de la fecha de la CURP no empata y la misma persona pasa como dos. Cumplimiento lo revisa al cotejar la fecha capturada contra el documento (el pasaporte o la identificación del expediente) antes de dictaminar.
- Una CURP alterada o inventada tampoco (base-N19). La regla confía en la CURP: si la misma persona aparece dos veces con CURP distintas (una con un carácter cambiado o inventada), la toma por dos mexicanos homónimos nacidos el mismo día y no la junta. La excepción no se limita a mexicanos, porque volvería a rechazar homónimos extranjeros reales. Cumplimiento coteja la CURP contra el documento de identidad o contra RENAPO antes de dictaminar.

Esos casos dependen de la declaración del representante sobre los propietarios reales y de la revisión de Cumplimiento.

El cotejo con la Lista de Personas Bloqueadas de un socio extranjero sin RFC ni CURP es por nombre (posible coincidencia): el CSV de la lista no trae documento extranjero.

**Homoglifos (límite que queda).** Una letra de otro alfabeto que se ve igual, como la «а» cirílica (U+0430) en lugar de la «a» latina, no es un carácter invisible: pasa la regla de las identidades y el cotejo por nombre no junta ese nombre con el de la Lista. Lo revisa Cumplimiento contra el documento de identidad. El RFC y la CURP, que solo admiten letras latinas y dígitos, siguen siendo la llave fuerte. Está anotado también en el comentario de `INVISIBLE` (`src/dominio/control.ts`).

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

Corre con la conexión de la dueña (`scripts/personal-por-la-duena.ts`): desde la aplicación nadie sin usuario da roles ni registra personal (N3). Solo arranca: invita a todos los correos de la variable en una sola corrida y, si el operador ya tiene a alguien con Administración activa, no invita a nadie (`personal_con_administracion`, N7). Con más de un operador no adivina (`operador_ambiguo`).

**Si la primera corrida no entregó el enlace (base-N15).** El correo no salió y no se pidió `--mostrar-enlace`, nadie lo guardó o la invitación venció: mientras la Administración del operador solo esté invitada (nadie activo), otra corrida con los mismos correos emite un enlace nuevo por persona y el anterior deja de servir. Un correo distinto, solo o junto a los mismos, no entra (`arranque_con_otros_correos`) y no emite nada. Es la misma transacción y el mismo candado del personal; cada enlace queda en la bitácora (`emitir_invitacion`) con `corrido_por` y `ejecutado_por`. Con Administración activa ya no reenvía: las demás personas se invitan desde la pantalla Personal. En Preview (0 personal) basta con volver a correrlo con `--mostrar-enlace`.

**Quién lo corrió (N8).** `personal:migrar-variable`, `personal:rol` y `empresa:alta` exigen `--quien-corre` con el correo de la persona que los corre. La bitácora guarda ese correo (`corrido_por`) junto con `ejecutado_por = session_user`. `session_user` es la conexión, no la persona: en Neon, quien use `DATABASE_URL_UNPOOLED` es siempre la dueña de la base (`plataforma_owner` en este proyecto), así que por sí solo no dice qué persona corrió el comando.

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

### Quinta revisión (re-verificación sobre `c67424a`)

Los revisores cerraron N2-resto, N4-N8, N10-N14 y los demás arreglos del servidor. Salieron dos P2 (serv-N9 y base-N15) y seis P3 (base-N16, base-N17, base-N18, serv-N15, serv-N16 y serv-N17). Todo va en este PR y en la misma 0028.

Verificación en rojo (cada regresión falla con `c67424a`):

- **Solo la 0028 de `c67424a`, servidor nuevo**: fallan 10 de 31. El relleno (base-N17: la primera sugerencia no dice que la copia compartida se duplica), N2-resto (base-N16: los homónimos reales se rechazan como la misma persona) y la suspensión (serv-N17: por SQL la base acepta «Revisar» como motivo); las demás, en cascada.
- **Servidor de `c67424a`, base nueva**: fallan 13 de 31. El relleno (base-N15: la segunda corrida responde `personal_con_administracion` en vez de emitir un enlace nuevo), el expediente y la suspensión (serv-N17: el servidor acepta «Falta» y «Revisar», y solo los para el CHECK nuevo de la base); las demás, en cascada. `constancia-borrar.test.ts` falla con «el borrado sigue colgado» y el proceso no termina hasta que lo corta el tope de 60 s (serv-N16).
- **Mutaciones del código nuevo** (quitar solo un arreglo): sin el aborto final del relleno, «H2 y N3» falla con «Missing expected rejection» (`lista_69b_de_otro_operador`); con el desglose para todos, «grado de riesgo» falla porque Originación recibe los factores (serv-N9); sin `abortSignal`, `constancia-borrar` falla a los 15 s.
- **e2e con la interfaz de `c67424a`** (`page.tsx` del expediente, `expediente.ts` del servidor, `expediente.tsx`, `identidad-socio.tsx` y `acciones-alta.ts`): N9 falla porque la hoja de riesgo de Originación todavía tiene renglones (`dl`); serv-N15, porque tras rechazar el RFC opcional la dirección no trae `extranjera=1` y el formulario vuelve en «Mexicana».

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **serv-N9 (P2)** El grado seguía delatando la coincidencia: Originación veía «Grado alto» con todos los factores visibles en 0 puntos | Quien no ve la Lista recibe del servidor (`leerExpediente`) solo el grado, la fecha de revisión y si venció (`desglose: null`): sin factores, puntaje ni quién calificó, así que tampoco viajan en la respuesta RSC. La hoja dice «El desglose de la calificación lo ven Cumplimiento y Auditoría.» Cumplimiento y Auditoría ven todo | «grado de riesgo…»: Originación y Aprobación reciben solo grado y fecha; Cumplimiento y Auditoría, los 7 factores. e2e «el grado de riesgo no le dice…»: sin renglones y la página, con su RSC, sin `antiguedad_meses`, `volumen_mensual`, `"coincidencias"` ni `puntaje`. Capturas `r35`-`r44`: los 5 roles con caso (Brisa) y sin caso (Lumbre) |
| **base-N15 (P2)** El arranque quedaba trabado si la primera corrida de `personal:migrar-variable` no entregó el enlace | Con la Administración del operador solo invitada, el comando emite un enlace nuevo a los mismos correos (`emitirToken` revoca el anterior), en la misma transacción y con el mismo candado. Un correo distinto, solo o junto a los mismos: `arranque_con_otros_correos`. Con Administración activa: `personal_con_administracion`. La reemisión deja `emitir_invitacion` con `corrido_por` y `ejecutado_por` | «H2 y N3…»: la primera corrida no entrega el enlace; otro correo se rechaza sin invitación nueva; con los mismos, enlace nuevo y el anterior revocado (la aceptación ya no lo cierra), en la bitácora con `corrido_por`; con la Administración activa, nada. Con las invitaciones vencidas, la misma variable las vuelve a emitir. Recorrido sobre una base con 0 personal: el comando seis veces, el enlace reemplazado «ya no sirve» y el nuevo se acepta. Capturas `r49`-`r50` y salida literal |
| **base-N16 (P3)** Dos mexicanos con el mismo nombre y fecha pero CURP distinta se rechazaban como la misma persona | La regla compara pares: dispara solo si a una de las dos filas le falta la CURP o las dos traen la misma | «N2-resto y N6»: dos «Juan Hernández García» nacidos el mismo día con CURP distinta se envían; con la misma CURP en dos caminos (uno declarado extranjero), rechazada; (d) y (e) siguen rechazadas |
| **base-N17 (P3)** Una copia del 69-B que usaban empresas de dos operadores dejaba, tras seguir la sugerencia, a los proveedores de B leídos contra la copia de A | Al final del relleno, `lista_69b_de_otro_operador` si algún proveedor queda leído contra la copia de otro operador. Las dos sugerencias dicen que esa copia se duplica, una por operador con sus renglones, con la relectura apartada al insertarla (si no, la copia nueva se lleva a los proveedores de todos los operadores) | «H2 y N3…»: con la copia compartida, la primera sugerencia ya habla de duplicarla; asignarla solo a A se detiene sin dejar nada a medias; duplicarla al pie de la letra termina con cada proveedor en la copia de su operador |
| **base-N18 (docs)** Una fecha de nacimiento capturada distinta también evade la regla de la misma persona | README «Socio extranjero y la misma persona…»: el límite queda declarado y Cumplimiento lo revisa al cotejar la fecha capturada contra el documento | — |
| **serv-N15 (P3)** Si se rechazaba otro campo del socio extranjero (RFC opcional, nombre o capital), el formulario volvía en «Mexicana» | La redirección lleva `&extranjera=1` cuando se envió país, como `&tipo=moral`, y el formulario arranca de ahí | e2e «tras un rechazo del socio extranjero…»: RFC opcional (física) y capital (moral) rechazados vuelven en «Extranjera» con el campo marcado. Capturas `r45`-`r46` |
| **serv-N16 (P3)** Si Blob no responde, borrar el huérfano bloqueaba la petición más de 90 s sin registro | `del` con `abortSignal` y tope de 5 s (`TOPE_BORRADO_MS`), con `AbortController` + `setTimeout` en vez de `AbortSignal.timeout(5000)` (ver «Decisiones»). El registro estructurado sale también en el tope (`causa: "tiempo_agotado"`, `tope_ms`). Es el único `del` del código | `tests/proveedores/constancia-borrar.test.ts`: con un Blob que no contesta, se rinde en 5.1 s y deja un renglón con la clave y la causa |
| **serv-N17 (P3)** «Pedir suspensión» aceptaba un motivo de una letra | `motivoEscrito`: de 10 caracteres al tope (500 o 1000); uno más corto, `motivo_corto` («El motivo lleva al menos 10 caracteres…»), ligado al campo. Mismo hueco en los otros motivos libres del flujo: rechazar una suspensión, una activación o una comisión (el mismo diálogo de Aprobaciones), observar o rechazar un dictamen y resolver una coincidencia. `minLength` en los campos siempre obligatorios y CHECK en la 0028 (`company_suspensions`, `kyb_dictamenes`, `lpb_coincidencias`) | «suspensión manual…»: «a», «Revisar» y 9 caracteres → `motivo_corto`; 501 → `motivo_invalido`; por SQL, `company_suspensions_textos`; rechazar con «No» → `motivo_corto`. «expediente…»: rechazar el dictamen con «Falta». «LPB…»: resolver con «Homónimo». Capturas `r47`-`r48`: el navegador no envía y, sin su mínimo, el servidor responde con el aviso en el campo |

**Decisiones de la quinta revisión.**

- serv-N9: además del desglose de factores, quien no ve la Lista tampoco recibe el puntaje ni quién calificó y cuándo: la instrucción fue «solo el grado y la fecha de revisión».
- serv-N16: `AbortSignal.timeout(5000)` no corta el borrado con `@vercel/blob` 2.8.2. La doc vigente (ctx7, `/vercel/storage`) confirma `abortSignal` en `BlobCommandOptions` de `del` y que solo el `AbortError` se convierte en `BlobRequestAbortedError` sin reintento. Medido contra un servidor que no contesta: con `AbortSignal.timeout(2000)` (`TimeoutError`) la biblioteca reintenta y seguía colgado a los 40 s; con `AbortController.abort()` cortó a los 2.0 s. Por eso el tope es un `AbortController` con `setTimeout`.
- serv-N17: el mínimo de 10 vale para todos los motivos libres que lee otra persona en el flujo (incluidos los rechazos de activación y comisión, que comparten el diálogo). Las tablas de activaciones y comisiones son de migraciones anteriores con datos: ahí el mínimo es solo del servidor y del formulario, sin CHECK nuevo. El motivo opcional de un dictamen aprobado sigue sin mínimo.
- base-N15: se reemite solo a correos que ya son Administración invitada; un subconjunto de esos correos vale (reemite solo a esos).

### Sexta revisión (re-verificación sobre `701bc25`)

Los revisores cerraron serv-N9, base-N15 a base-N18 y serv-N15 a serv-N17. Quedaban base-N19, base-N20 (= serv-N18), y el resto de serv-N15 y serv-N16. Salieron también un hallazgo propio (sexta-N1), tres del líder (líder-N1 a líder-N3) y un barrido de los mismos patrones en el resto del PR (bar-1 a bar-10). Sus arreglos abrieron cinco más: base-N21, base-N22 y serv-nuevo-1 a serv-nuevo-3. Todo va en este PR. La 0028 solo cambia en un comentario (base-N19).

Verificación en rojo. Cada regresión se corrió contra `701bc25`: un árbol aparte con el código de ese commit y las pruebas nuevas; para la base, una variante por cambio.

- **Unitarias**: fallan base-N20 («Revisar 😀» pasa el mínimo), sexta-N1, líder-N2, bar-3 a bar-10, serv-nuevo-2 y serv-nuevo-3. En serv-N16-resto el borrado vuelve a los 10.6 s con el 503 y a los 9.9 s con la conexión rechazada, con un tope de 5 s.
- **Postgres**: cada cambio falla solo, y con el error de la base que describe su hallazgo. base-N20 espera `motivo_corto` y recibe el CHECK 23514; bar-1 choca con `expected_collections_rfc`; bar-2, con `kyb_documentos_vigencia`; bar-3, con `kyb_versiones_textos`; bar-5, con `kyb_versiones_correo`; bar-4 da 22008 con el 30 de febrero o el año 0. En el portal fallan «Revisar 😀» y los renglones con CRLF.
- **e2e con la interfaz de `701bc25`**: fallan las dos pruebas cambiadas. En una, el diálogo de Aprobaciones se cierra y pierde el motivo; en la otra, el socio extranjero vuelve sin lo capturado.
- **bar-3**: con la regla vieja pasan 32 de los 64 controles que rechaza la base (U+0080 a U+009F).
- **base-N21, base-N22 y serv-nuevo-1 a serv-nuevo-3** salieron del código nuevo de esta ronda: sus pruebas fallan con la versión anterior de ese código. Por ejemplo, en base-N21 el RFC «-» llega a la base y vuelve con 23514.
- **líder-N3**: la ventana es rara. En `701bc25`, `flujo-postgres` dio 0 fallas en 30 corridas en reposo y 0 en 30 con 18 núcleos ocupados; con el arreglo, 0 en 30. La falla se vio una vez. Por eso el arreglo se trae idéntico al del #60 y no lleva una prueba propia.

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **base-N20 = serv-N18 (P2)** `motivoEscrito` contaba unidades UTF-16. «Revisar 😀» son 10 unidades: pasaba el navegador y el servidor, pero la base cuenta 9 caracteres (`char_length`) y el CHECK respondía «La base no respondió». Además, en Aprobaciones el diálogo de «Rechazar» se cerraba y el motivo se perdía | Cuenta caracteres (`[...texto].length`). `traducirErrorDeBase` traduce a `motivo_corto` los CHECK de motivo (`company_suspensions_textos`, `lpb_coincidencias_textos` y `kyb_dictamenes_motivo`). «Rechazar» (activación, comisión y suspensión) pasa por `rechazarConMotivoAccion` con `useActionState`: si el motivo no pasa, el diálogo sigue abierto con lo escrito, el aviso ligado al campo y el foco en él | `formulario.test.ts` «cuenta caracteres». `db.test.ts`: los tres CHECK dan `motivo_corto`. Postgres: suspensión, dictamen y caso de la Lista con «Revisar 😀» → `motivo_corto`; activación y comisión en `portal-postgres`. e2e «prospecto → pedir activación…» con el diálogo. Capturas `r51` a `r55` |
| **base-N19 (docs)** Una CURP alterada o inventada evade la regla de la misma persona | README «Límites que quedan» y un comentario sobre la regla en la 0028: la regla confía en la CURP, y Cumplimiento la coteja contra la identificación o RENAPO antes de dictaminar | — |
| **serv-N15-resto (P3)** Tras rechazar un dato del socio extranjero, el formulario volvía en «Extranjera» pero vacío. Devolver lo capturado por la dirección habría puesto datos personales en la URL | `agregarAccionistaAccion` pasa a `useActionState` (`formulario-accionista.tsx`): ante un rechazo, el servidor devuelve lo capturado (`CAMPOS_SOCIO`) y el aviso, sin redirigir. El formulario se vuelve a montar con todo, el campo marcado y el foco en él. La dirección ya no lleva `extranjera=1` ni `tipo=moral` | e2e «tras un rechazo del socio extranjero el formulario vuelve con todo lo capturado…». Recorrido: RFC «XX», nombre en blanco y capital «abc», en física y en moral; vuelve con país, documento, fecha, nombre y porcentajes, sin datos en la dirección; corregido, entra. Capturas `r56` a `r62` |
| **serv-N16-resto (P3)** Con Blob respondiendo 503 o rechazando la conexión, el borrado del huérfano tardaba unos 10 s. `@vercel/blob` 2.8 reintenta con espera creciente y solo nota el `abort()` al empezar el siguiente intento | El borrado compite con el reloj (`Promise.race` contra el tope de 5 s). Al agotarse, aborta y sigue; el registro sale con `causa: "tiempo_agotado"`. `Promise.race` maneja la promesa que pierde, así que no queda un rechazo sin atender | `constancia-borrar.test.ts` con 200, sin respuesta, conexión rechazada y 503: vuelve dentro del tope, deja su registro y ningún reloj colgado. Recorrido: el emulador simula el 503 y la falta de respuesta (`POST /simular`), y un documento con un representante ajeno hace que la fila no entre. La página vuelve en 5.1 s en los dos casos, sin documento y con la clave en el registro (`datos/sexta-huerfanos.json`). Capturas `r63` y `r64` |
| **sexta-N1 (P2, propio)** Un motivo escrito con Enter (el navegador manda CRLF) pasaba el servidor y la base lo rechazaba: ningún texto de la 0028 admite saltos de línea | `textoMultilinea` y `motivoEscrito` juntan los renglones en uno, con un espacio, y miden lo que se guarda | `formulario.test.ts` «junta los renglones…». Postgres: motivos con CRLF; en `portal-postgres`, el detalle de una alerta queda «Seguimiento operativo». Recorrido: el motivo con Enter entra y se guarda en un renglón |
| **líder-N1 (docs)** README: la dueña en Neon no es `neondb_owner` | «`plataforma_owner` en este proyecto» | — |
| **líder-N2 (P3)** `textoPago` (pagos) y `textoLimpio` (flujo) contaban unidades UTF-16: «Revisar 😀» como excepción y «ok 😀» al cancelar un cobro pasaban el servidor, y la base los rechazaba con un error genérico | Cuentan caracteres, en el mínimo y en el máximo | `conteo-de-caracteres.test.ts`. Pagos: «los motivos cuentan caracteres como la base…». Flujo: cancelar con «ok 😀». Capturas `r68`, `r71` y `r72` |
| **líder-N3 (P3)** `rechazarFacturaViva` podía tomar la fila de su propia alta como «otro cobro vivo» si el primer envío confirmaba entre `altaPrevia` y la lectura | `and id <> $3` y el id de la alta, copiado byte por byte del mismo arreglo del #60 (`3b14c89`), sin los cambios de `transaccion?` | Las 90 corridas de arriba |
| **bar-1 (P2)** El cobro manual guardaba el RFC como se escribió («EKU900317-3C9») y el CHECK `expected_collections_rfc` lo rechazaba | Se guarda el RFC normalizado, el mismo que se valida | `entradas.test.ts`. Flujo: queda «EKU9003173C9». Captura `r67` |
| **bar-2 (P2)** Un documento del expediente con «Vigente hasta» antes de «Emitido el» subía el archivo y el CHECK respondía «La base no respondió» | `dato_invalido_vigenteHasta` antes de subir nada, con el campo marcado | Postgres «expediente…»: rechazado sin subir el archivo ni dejar fila. Recorrido: el poder de Ébano del 1 de octubre que vence el 30 de septiembre, sin documento nuevo. Captura `r65` |
| **bar-3 (P3)** Catorce validadores tenían su propia regla de controles sin C1 (U+0080 a U+009F); el `[[:cntrl:]]` de la base (`pg_c_utf8`) sí los incluye | `src/dominio/control.ts`: una sola `CONTROL` (C0, DEL y C1), `CONTROL_SALVO_RENGLONES` y `sinControles`, en los catorce validadores y en `lista-69b.ts` | Postgres «caracteres de control…»: `CONTROL` coincide con `[[:cntrl:]] COLLATE "pg_c_utf8"` de U+0001 a U+FFFF. `control.test.ts`. Razón social del alta con U+0093 → `razon_social_invalida` |
| **bar-4 (P3)** Las fechas del #59 se validaban solo por su forma: el 30 de febrero o el año 0 llegaban a la base (22008) | `fechaDeCalendario`: año ≥ 1, meses y días reales y bisiestos. Aplica a la emisión, la vigencia, la constitución, el nacimiento, lo presentado, el aviso al cliente y la fecha del CSV de la Lista | `formulario.test.ts` «fecha de calendario». `alta-regulada.test.ts`: CSV con 0000-01-01. Postgres, una variante por fecha |
| **bar-5 (P3)** El correo del expediente se medía antes de pasarlo a minúsculas y no revisaba controles | Minúsculas primero, `!CONTROL` y `[...correo].length <= 254` | Postgres «expediente…»: un control y un correo con «İ» que en minúsculas pasa de 254 → `dato_invalido_correo`, sin llegar al CHECK `kyb_versiones_correo` |
| **bar-6 (P3)** El nombre de la constancia, cortado a 180, podía terminar en espacio (CHECK `documents_nombre_presente`) | Quita controles, corta y vuelve a recortar | `proveedores.test.ts` |
| **bar-7 (P3)** Un total del CFDI o un monto de pago de más de 9e15 centavos pasaba el servidor | Tope de 9e15, el del CHECK | `cfdi.test.ts`: el total y «el monto escrito de un pago cabe en la base» |
| **bar-8 (P3)** El RFC receptor del CFDI no se revisaba y la serie y el folio guardaban controles («&#x9;» literal) | El RFC receptor con la forma de un RFC; la serie y el folio con un control → `cfdi_datos_incompletos` | `cfdi.test.ts`. Flujo: serie `&#x9;` rechazada. Captura `r69` |
| **bar-9 (P3)** Con `processEntities: false`, «&amp;» quedaba literal en los nombres («PEREZ &amp; ASOCIADOS») | `decodificarReferencias` en una sola pasada (las cinco predefinidas y las numéricas), sin expandir el DOCTYPE. `&amp;amp;` da `&amp;` | `cfdi.test.ts`. Flujo: la base guarda «PEREZ & ASOCIADOS». Captura `r70` |
| **bar-10 (P3)** Las fechas del contrato y de la obligación de un pago aceptaban días que no existen | `fechaValida` con `fechaDeCalendario` → `fecha_invalida` | `cfdi.test.ts` «las fechas del pago existen en el calendario». Pagos: `agregarContratoProveedor` con una fecha imposible |
| **base-N21 (P2, regresión de bar-1)** Un RFC «-» o « - - » quedaba vacío al normalizarse y llegaba así a la base, que respondía «La base no respondió» | Vacío al escribirse → sin RFC. Lo escrito que no queda en un RFC → error en su campo | `entradas.test.ts`. Flujo: «-», « - - » y un RFC con U+0085. Captura `r66` |
| **base-N22 (P3)** El máximo de `textoMultilinea` y `textoOperativo` contaba unidades UTF-16: rechazaba textos que la base sí acepta | Cuenta caracteres | `formulario.test.ts`: 260 emojis caben en un motivo de 500 y 151 en un texto de 300 |
| **serv-nuevo-1 (P3)** Tras bar-3, un control invisible pegado en un texto libre rechazaba todo el formulario | Los textos libres quitan los controles al limpiar; los identificadores los siguen rechazando (ver «Decisiones») | `control.test.ts`. Postgres: un folio con U+0085 se guarda limpio. Flujo: un nombre partido con `&#x85;` queda «Comercializadora Uno» |
| **serv-nuevo-2 (P3)** Una entidad sin declarar en el CFDI («&x;») se guardaba literal | `referencia_no_declarada` → «El archivo no es un XML de CFDI válido.» | `cfdi.test.ts` «referencias de entidad». Flujo |
| **serv-nuevo-3 (P3, regresión de bar-8)** Un tab o un salto de línea literal en un atributo se rechazaba como control | Valen un espacio, como manda XML 1.0 §3.3.3. Escrito como referencia (`&#x9;`), el control sigue rechazándose en la serie | `cfdi.test.ts` «los saltos literales valen un espacio…» |

**Decisiones de la sexta revisión.**

- base-N20: además de contar caracteres, los CHECK de motivo se traducen a `motivo_corto`. Si el servidor y la base vuelven a diferir, la persona lee el aviso del campo y no «La base no respondió».
- sexta-N1: los renglones se juntan en el servidor; la base sigue sin admitir saltos de línea y la 0028 no cambia.
- bar-3 y serv-nuevo-1 (decisión del líder; la séptima revisión la cambia, ver abajo): los textos libres quitan los controles. Son los motivos, conceptos, referencias y detalles de Operación, pagos y flujo, y los nombres del CFDI. Los identificadores los rechazan: RFC, CURP, la serie y el folio del CFDI, la razón social del alta, los nombres de personas y áreas, el renglón de la Lista y el nombre de un PDF privado. `server/correo/configuracion.ts` conserva su regla: valida una variable de entorno que no llega a la base.
- bar-8: el RFC emisor no se revisa por forma: no se guarda y ya se compara con el de la empresa.
- bar-9: las referencias se decodifican a mano. Con `processEntities: true`, `fast-xml-parser` también expande las entidades del DOCTYPE (doc vigente por ctx7).
- líder-N3: solo los cambios de `rechazarFacturaViva` del #60, idénticos; los de `transaccion?` no.

### Séptima revisión (re-verificación sobre `98224e0`)

Los dos revisores cerraron base-N21, base-N22, bar-10 y serv-nuevo-1 a serv-nuevo-3. Encontraron el mismo hallazgo por los dos lados: base-N23 (base) y serv-nuevo-4 (servidor), un P2 que bloquea el merge. Además salieron dos P3 de avisos. Todo va en este PR. **La 0028 no cambia.**

El problema venía de serv-nuevo-1. `sinControles` borraba el control sin dejar nada en su lugar, y los nombres de los representantes y los socios, la razón social del expediente, los nombres del cobro y el del CFDI pasaban por ahí. Un control entre dos palabras las pegaba («PedroRuiz Sol»), y la Lista, cotejada por nombre (`lpb_normalizar`), ya no encontraba a la persona. Con 4 socios extranjeros sin RFC ni CURP, el nombre es su única llave, y salía 1 coincidencia de 4. Por decisión del líder, la regla queda así:

1. **Identidades e identificadores: rechazar, nunca transformar.** Con cualquier control, también un tabulador, se rechazan con el error de su campo. Solo se recortan los espacios de las orillas, como siempre.
   - Nombres que entran a un cotejo: representantes y socios (`dato_invalido_nombre`) y la razón social del expediente (`dato_invalido_razonSocial`). La razón social del alta y la de los proveedores ya rechazaban.
   - El folio del reporte a la UIF (`dato_invalido_folio`) y el teléfono del expediente.
   - RFC del alta, del proveedor y del cobro manual, y la CLABE. Al normalizar se quitaban los espacios, y con ellos el tabulador, U+000B y U+000C: un RFC con un tabulador dentro se aceptaba.
   - El correo de contacto del proveedor, que aceptaba U+0085 o U+001F dentro.
   - CURP, el correo de Personas y el del expediente, la serie de la e.firma, las áreas, los nombres de Personas y el renglón de la Lista ya rechazaban.
2. **Textos libres** (motivos, giro, concepto, notas, nombre del cliente del cobro, nombre del CFDI que no se coteja): cada control vale un espacio. U+0091 y U+0092 valen `'`, y U+0093 y U+0094 valen `"`: son las comillas de Windows-1252 mal decodificadas. Después se juntan los espacios y se recorta. `textoMultilinea` también junta los espacios dobles.

Verificación en rojo. Las pruebas nuevas, corridas con el código de `98224e0` (árbol aparte), fallan así:

- **Unitarias**, 6 pruebas:
  - `fecha_invalida` en lugar de `fecha_emision_invalida`;
  - «ComercializadoraUno»;
  - `razon_social_invalida` en lugar de `razon_social_control`;
  - el RFC con un tabulador se acepta;
  - `centro_nombre_invalido` en lugar de `centro_nombre_control`;
  - «concampana».
- **Postgres**, 8 pruebas:
  - base-N23: «Missing expected rejection: socio "Pedro\u000bRuiz Sol"»;
  - el folio con U+0085 se acepta;
  - `razon_social_control`;
  - `fecha_emision_invalida`;
  - «ComercializadoraUno» en el cobro desde el XML.

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **base-N23 = serv-nuevo-4 (P2)** Un control entre dos palabras se borraba y las pegaba. El cotejo por nombre contra la Lista perdía a la persona sin aviso (1 de 4 en vivo); el giro quedaba «Distribuciónde abarrotes» | Regla 1: `conControl` en `expediente.ts` (nombres, razón social y teléfono), el folio en `lpb.ts`, `validarRfcDeAlta` (`src/domain/rfc.ts`), el RFC del cobro (`entradas.ts`), `normalizarClabe` y `correoOpcional`. Regla 2: `sinControles` (`src/dominio/control.ts`). Auditados los sujetos de `lpb_cotejar_empresa`: la empresa, los beneficiarios (salen de los socios), los representantes, los socios y las contrapartes. Solo los representantes y los socios pasaban por `sinControles`. `CONTROL_SALVO_RENGLONES` se retira: quedó sin uso | Postgres «base-N23: un control entre dos palabras…». Nueve nombres con control (U+000B, U+0085, U+0096, U+0092, tabulador, U+000C, U+001F y U+0001) dan `dato_invalido_nombre` como socio y como representante. Los 4 socios extranjeros limpios dan 4 posibles por nombre. La razón social del expediente con U+0085 se rechaza y el giro con NEL se guarda con espacio. «LPB…»: el folio con U+0085 o con tabulador da `dato_invalido_folio`, sin guardar nada. Flujo: «Comercializadora&#x85;Uno», sin el salto que antes ponía el espacio, queda «Comercializadora Uno». `control.test.ts`: textos libres (también «O\u0092Brien» → «O'Brien») e identificadores (RFC, CLABE, correo y RFC del cobro con 6 controles). Capturas `r73` a `r80` |
| **P3 bar-10** Con la fecha forzada, el aviso marcaba «Vigente hasta» o el vencimiento aunque la fecha mala fuera otra | `validarFechasPago` devuelve un código por fecha: `fecha_emision_invalida` (fecha de la obligación), `fecha_invalida` (vencimiento) y `fecha_programada_invalida`. El contrato da `fecha_desde_invalida`. Cada código tiene su mensaje y su campo, y «Vigente desde» se liga al aviso | `cfdi.test.ts` «las fechas del pago existen…», con un caso por fecha. Pagos: el contrato con «Vigente desde» 2026-02-30 y con «Vigente hasta» 2026-13-01. Recorrido con la fecha forzada (una petición armada). Capturas `r82` y `r83` |
| **P3** El área con un control daba «Escribe el nombre del área.», y la razón social del alta el aviso genérico, sin campo marcado | `centro_nombre_control` («El nombre del área trae un carácter invisible…») y, por ser el mismo caso, `nombre_control` en Personas. En el alta, `razon_social_control`. Los demás rechazos del alta (`rfc_invalido`, `rfc_generico`, `razon_social_invalida`, `codigo_postal_invalido`, `regimen_invalido` y `uso_cfdi_invalido`) daban el aviso genérico, ya en `main`: ahora cada uno tiene su mensaje y marca su campo | `control.test.ts`. Postgres «F4 y F5…»: la razón social con U+0093/U+0094 da `razon_social_control`. Recorrido: el alta con U+0085 y con el código postal 17000, y el área «Ventas\u0085Norte». Capturas `r77`, `r78` y `r81` |

**Decisiones de la séptima revisión.**

- Los nombres y la razón social del expediente, el folio y los identificadores solo recortan los espacios de las orillas (también un tabulador o un salto), como el RFC y la CURP. Un control dentro se rechaza, también un tabulador: «Ana\tRuiz Sol» da `dato_invalido_nombre`. La razón social del alta, las áreas y los nombres de Personas, que ya rechazaban sin recortar, siguen rechazando también un tabulador en la orilla.
- El folio del reporte a la UIF pasa a ser un identificador. La prueba de serv-nuevo-1, que lo guardaba limpio, ahora espera el rechazo.
- `nombre_control` en Personas no lo pidió el líder. Es el mismo caso que el área, y antes el aviso decía «Escribe el nombre de la persona.».
- Siguen igual:
  - El nombre del archivo de una constancia (`nombreLimpio`) sigue quitando los controles: es un nombre de archivo, no una identidad, y no se coteja.
  - El alta de un proveedor sigue marcando «contrato» cuando falla su vigencia.

### Octava revisión (re-verificación sobre `b2db0b5`)

El CI de `b2db0b5` salió rojo en la suite de Postgres, en F4 y F5. Los revisores encontraron además:

- un P2 del servidor (serv-nuevo-5);
- dos P3 de la base (base-N24 y base-N25);
- dos P3 de pantalla;
- un límite que se documenta: los homoglifos.

El líder pidió también el aviso propio del carácter invisible. Todo va en este PR. **La 0028 no cambia.**

**La carrera de F4 y F5.**

- **Causa.** `crearVersion` leía primero su propio id y después buscaba un borrador abierto, en dos sentencias. En READ COMMITTED cada sentencia toma su propia foto. Si la otra pestaña confirmaba entre las dos lecturas, la primera no veía la fila propia y la segunda sí veía el borrador. La misma acción respondía entonces `expediente_con_borrador` en lugar de darse por hecha. `solicitarCambioDeSuspension` tenía el mismo patrón y respondía `suspension_pendiente`.
- **Arreglo.** Una sola sentencia, `where id = $1 or (company_id = $2 and estado = …)`, que ve un solo estado.
- **Auditoría.** Ningún otro servicio que lee por id y por estado tiene el patrón:
  - la carga de la Lista lee en una sola sentencia;
  - el dictamen, en una sola lectura por `version_id`;
  - la calificación no tiene índice por estado;
  - los representantes y los socios usan `on conflict` y `mismoBorrador`;
  - los documentos leen antes por id y usan `on conflict`.
- **Prueba determinista.** `crearVersion` y `solicitarCambioDeSuspension` reciben una envoltura de la transacción (`EnvolturaDeTransaccion`, en `formulario.ts`). Con ella, la prueba corre la otra pestaña completa justo después de la primera lectura. Con el código de `b2db0b5` falla siempre: con `expediente_con_borrador` en la versión y con `suspension_pendiente` en la suspensión.

Corridas seguidas de la suite completa `alta-regulada-postgres.test.ts` contra el Postgres 5551. «Con carga» son 18 procesos `yes`, uno por núcleo.

| Código | Condición | Corridas | Fallas de F4 y F5 | Otras fallas |
| --- | --- | --- | --- | --- |
| `b2db0b5` | en reposo | 50 | 0 | 0 |
| `b2db0b5` | con carga | 50 | 0 | 1 (H12, en la corrida 22) |
| final | en reposo | 50 | 0 | 0 |
| final | con carga | 50 | 0 | 0 |

En local, la carrera no salió en 100 corridas del código viejo. La ventana entre las dos sentencias es de milisegundos, y en CI coincidió. Por eso la prueba la fuerza en vez de esperarla.

**La falla de H12 en la corrida 22.** No venía de la carrera.

- **Causa.** La base de prueba usa la zona de la máquina (+07), y la corrida cruzó la medianoche: 01:00:05 en +08 son 00:00:05 en +07. La copia del 69-B se sembró con `current_date - 1` antes de medianoche, y el proveedor de H12 volvió a calcular `current_date - 1` después. El disparador `suppliers_lectura_contra_copia` rechazó la fecha distinta con `fecha_de_lista_distinta`.
- **Arreglo.** En la prueba, los proveedores toman la fecha de la copia (`select fecha_archivo … where id = $4`). Ninguna otra siembra calcula la fecha dos veces: las demás usan fechas fijas.

**serv-nuevo-5: lo invisible, no solo los controles.**

- **Regla.** `INVISIBLE = /[\p{Cc}\p{Cf}]/u`, en `control.ts`, junta los controles y los caracteres de formato: U+00AD, de U+200B a U+200F, U+2060, U+FEFF y los demás Cf. No se ven, pero cambian la identidad.
- **Dónde se usa.** En todos los rechazos de la regla 1:
  - los nombres de representantes y socios;
  - la razón social del expediente, la del alta y la de los proveedores;
  - el folio;
  - el RFC del alta, el del proveedor y el del cobro;
  - la CLABE, los correos y el teléfono;
  - la serie y el folio del CFDI;
  - los nombres y las áreas de Personas;
  - el renglón de la Lista y el documento extranjero.
- **Lo que no cambia.** `CONTROL` sigue siendo lo que la base cuenta como `[[:cntrl:]]`, y los textos libres siguen igual: un motivo con un emoji compuesto (unido con U+200D) se guarda tal cual.

**Aviso propio del carácter invisible.**

- **Textos.** Un nombre, una razón social o un folio con un carácter invisible tiene su propio código y su propio texto:
  - `invisible_nombre`: «El nombre trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano.»;
  - `invisible_razonSocial`: «La razón social trae…»;
  - `invisible_folio`: «El folio trae…».
- **Las otras razones sociales.** La del alta (`razon_social_control`) y la del proveedor (`razon_control`) usan el mismo texto.
- **Campo y foco.** `errorDelCampo` liga `invisible_<campo>` a su campo y le da el foco.
- **El folio.** El folio de la coincidencia rechazada queda marcado. En la dirección solo va el id de la coincidencia.
- **Formato.** Un nombre mal formado sin invisibles conserva «Revisa el campo marcado: el dato no tiene el formato esperado.».

**Verificación en rojo.** Las pruebas nuevas, corridas contra el código de `b2db0b5`, fallan así:

- **Unitarias**, 5 pruebas:
  - `errorDelCampo` no daba el foco;
  - `invisible_nombre` mostraba «No se pudo completar…»;
  - `validarAlta` aceptaba «Escuela­Kemper»;
  - la Lista aceptaba «EVA\tRUIZ SOL»;
  - el documento «X123\t4567» quedaba X1234567.
- **Postgres.** F4 y F5 forzadas fallan con `expediente_con_borrador`. Para ver cada caso nuevo, el código propio se aceptó igual que el viejo. Así, `b2db0b5` acepta:
  - el folio «UIF-2026-⁠0001»;
  - el socio «Pedro­Ruiz Sol»;
  - el documento «X123\t4567»;
  - la razón social «Laboratorio﻿Cotejo SA de CV»;
  - la Lista con «EVA\tRUIZ SOL».
- **Pagos.** «Vigente hasta» 2026-13-01 y 2026-10-31 daban `fecha_invalida`.
- **e2e:**
  - el socio «Juan\u0085Pérez López» mostraba «Revisa el campo marcado: el dato no tiene el formato esperado.»;
  - sin la parte del socio, el representante recargaba la página y no había `#aviso-representante`.

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **CI de `b2db0b5`: F4 y F5** El mismo formulario, enviado en dos pestañas, respondía `expediente_con_borrador` en una de ellas | `crearVersion` y `solicitarCambioDeSuspension` leen en una sola sentencia y reciben una envoltura de la transacción para la prueba | Postgres «F4 y F5…» con la otra pestaña forzada entre lecturas. Versión: el mismo formulario da ok, 1 versión y 1 evento; uno ajeno da `expediente_con_borrador`. Suspensión: el mismo da 1 pendiente y 1 evento; uno ajeno da `suspension_pendiente`. Más las 50 + 50 corridas de arriba |
| **H12 intermitente** Fallaba si la corrida cruzaba la medianoche | La siembra toma la fecha de la copia del 69-B | Las 100 corridas sobre el código final, sin falla |
| **serv-nuevo-5 (P2)** Un carácter de formato (U+00AD, U+200B, U+2060, U+FEFF) pasaba los rechazos de identidad y se guardaba | `INVISIBLE` (Cc + Cf) en todos los rechazos de la regla 1; los textos libres no cambian | `control.test.ts` «las identidades rechazan también los caracteres de formato (Cf)»: 6 Cf en `validarAlta`, proveedor, persona, área, RFC, CLABE, correo y RFC del cobro, y el motivo con un emoji compuesto, aceptado. Postgres: 5 Cf dan `invisible_nombre` como socio y como representante; la razón social con U+FEFF o U+00AD, el folio con U+2060 o U+200B y el alta con U+2060 se rechazan, y el motivo con el emoji se guarda tal cual. Capturas `r84`, `r86`, `r88`, `r90`, `r92` y `r94` |
| **Aviso propio (líder)** Con un carácter invisible, el aviso decía que el formato estaba mal y el nombre se veía bien | `invisible_nombre`, `invisible_razonSocial` e `invisible_folio`, cada uno con su texto; campo marcado y con el foco | `aviso.test.ts` y la e2e «un nombre con un carácter invisible da su propio aviso…». Capturas `r84`, `r85`, `r88` y `r92` |
| **base-N24 (P3)** La Lista juntaba los espacios antes de buscar el control, y «EVA\tRUIZ SOL» se guardaba «EVA RUIZ SOL» | `leerListaBloqueadas` revisa `INVISIBLE` en el nombre crudo antes de juntar los espacios | `control.test.ts` y Postgres «base-N23…»: con tabulador, U+00AD o U+200B, `lpb_renglon_invalido` y ninguna carga. Captura `r91` |
| **base-N25 (P3)** El documento extranjero borraba el tabulador, el salto, U+000B, U+000C y U+000D, y «X123\t4567» quedaba X1234567 | `documentoExtranjeroNormalizado` rechaza con `INVISIBLE` | `control.test.ts` y Postgres «base-N23…»: con tabulador, U+000B, `\r` o U+200B, `dato_invalido_documentoExtranjero`. Captura `r89` |
| **P3** El contrato con «Vigente hasta» inválido reutilizaba `fecha_invalida`, cuyo texto habla de la emisión y el vencimiento de un pago | `fecha_hasta_invalida`, con su texto y el campo «Vigente hasta», también cuando queda antes de «Vigente desde» | Pagos: 2026-13-01 y 2026-10-31. Captura `r93` |
| **P3** El formulario de representante perdía lo capturado tras un rechazo | `FormularioRepresentante` con `useActionState`, como el del socio, sin datos en la dirección | La e2e de arriba. Capturas `r86` y `r87` |
| **Límite de homoglifos (docs)** Una «а» cirílica no la detecta el cotejo por nombre | «Homoglifos» en este README y en el comentario de `INVISIBLE` | — |

**Decisiones de la octava revisión.**

- **Aviso propio en las razones sociales.** El texto propio se usa también en la razón social del alta y en la del proveedor, que ya tenían un código de control. Así, la misma persona ve el mismo aviso en las tres pantallas.
- **Los identificadores conservan el aviso de su campo.** El teléfono, el RFC, la CLABE y el correo con un carácter invisible siguen con el aviso de formato de su campo: solo admiten letras y dígitos, y ese aviso ya dice qué escribir.
- **El foco en todas las pantallas.** `errorDelCampo` da el foco (`autoFocus`) en todas las pantallas de Operación que marcan un campo, no solo en estas cuatro. Es como ya se portaba el formulario del socio.
- **El folio vuelve vacío.** El formulario del folio recarga, como antes. La dirección solo lleva el id de la coincidencia, nunca el folio.
- **Las orillas.** En las orillas se sigue recortando como siempre. JavaScript recorta también U+FEFF, así que «﻿Proveedor» entra como «Proveedor»: el carácter no se guarda.
- **Siguen con `CONTROL`.** El nombre de un archivo y el de una categoría del presupuesto no son identidades ni se cotejan.

### Novena revisión (re-verificación sobre `a75d5e4`)

El líder pidió cinco puntos en un solo push:

- la bomba de fechas de la suite de Postgres, que también revienta en main;
- base-N26: los demás invisibles de Unicode;
- base-N27: Recuperaciones con varias solicitudes;
- serv-nuevo-6b: las fechas del folio en su campo;
- serv-nuevo-6d: enviar una versión sin datos generales.

**La 0028 no cambia.**

**La bomba de fechas de `test:db`.**

- **Causa.** `colaboradores-postgres.test.ts` y `flujo-postgres.test.ts` fijan la fecha del alta (2026-11-05T18:00Z) y con esa misma fecha emitían la invitación, así que `expira_en` quedaba en esa fecha más 72 horas. La aceptación la vence la base con su propio reloj: `consumir` hace `update invitations … where … expira_en > now()`. Desde el 2026-11-08T18:00Z las dos suites fallaban:
  - «separa empresas…» y «colaboradores, nómina…» con `invitacion_vencida`;
  - «calendario y lotes» con `primer_pago_invalido`, porque la persona invitada no llegaba a existir.
- **Arreglo.** Las pruebas emiten la invitación con la hora real (`emitirConHoraReal`, que llama a `emitirEnTransaccion` con `ahora: new Date()`). La fecha de negocio del alta, la nómina y el calendario sigue fija. El código de la aplicación no cambia: en producción, emitir y aceptar ya usan el reloj real.
- **Por qué no aceptar con el mismo reloj fijo.** Fue la primera propuesta. Seguía fallando a +30 días con `invitacion_cerrada`: el `estadoDe` de JavaScript daba la invitación por vigente, pero el `update` de la base, con `now()`, no la consumía.
- **Barrido.** Cinco suites de Postgres aceptan invitaciones: `aislamiento`, `telefono`, `resumen-postgres`, `colaboradores-postgres` y `flujo-postgres`. Solo las dos últimas emitían con el reloj fijo. `resumen-postgres` usa su fecha fija solo para leer el resumen.

**Los tres relojes adelantados.** La suite de Postgres completa (los 17 archivos de `test:db`, una prueba a la vez) corrió con tres relojes adelantados:

- **Postgres.** El binario se lanza directo con `faketime -f +30d postgres -D <datos> -p 5551`, sin `pg_ctl`: `pg_ctl` pasa por `/bin/sh` y macOS le quita `DYLD_*`.
- **Node.** El proceso de las pruebas corre como `faketime -f +30d <node> node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 <archivos>`.
- **Los hijos de `.bin/tsx`.** Son los `spawnSync` de `alta-regulada-postgres.test.ts`. Durante la corrida, el enlace `.bin/tsx` se cambia por un lanzador con el `node` de Homebrew en el shebang, en lugar de `/usr/bin/env node`. Al salir se restauran el enlace y el Postgres con el reloj real.

Cada corrida imprime los tres relojes al empezar. La salida cruda está en `datos/reloj-30-dias-a75d5e4.txt`, `datos/reloj-30-dias-final.txt` y `datos/reloj-365-dias-final.txt`.

| Código | Adelanto | Postgres `now()` | Node `new Date()` | Hijo por `.bin/tsx` | Resultado |
| --- | --- | --- | --- | --- | --- |
| `a75d5e4` | +30 días | 2026-12-09 23:20:57+07 | 2026-12-09T16:20:57Z | 2026-12-09T16:20:57Z | 76/79: las 3 de arriba |
| final | +30 días | 2026-12-09 23:16:21+07 | 2026-12-09T16:16:21Z | 2026-12-09T16:16:21Z | 80/80 |
| final | +365 días | 2027-11-09 23:22:36+07 | 2027-11-09T16:22:36Z | 2027-11-09T16:22:36Z | 80/80 |

**base-N26: los demás invisibles de Unicode.**

- **Regla.** `INVISIBLE` suma `\p{Default_Ignorable_Code_Point}` a los controles y a los caracteres de formato. Entran:
  - los rellenos hangul U+3164, U+115F y U+FFA0;
  - los selectores de variación U+FE0F, U+180B y U+E0100;
  - la vocal muda jemer U+17B4.
- **Por qué importa.** Un nombre con uno se ve igual en pantalla, pero `lpb_normalizar` parte la palabra donde está: «Rodrㅤíguez» da «IGUEZ RODR» y ya no coincide con la Lista ni con el 69-B. Entre palabras, en cambio, «Ana​Ruiz» sí da «ANA RUIZ»; solo dentro de una palabra se rompe.
- **Lo que no cambia.** Los textos libres siguen aceptando el emoji con U+FE0F («❤️») y el compuesto con U+200D. Las letras de otros alfabetos no son invisibles: «Łukasz Żółć», «李小龍» y «محمد» pasan.

**base-N27: Recuperaciones con varias solicitudes.**

- **Causa.** Con varias solicitudes pendientes, el aviso de un rechazo sin nota marcaba la nota de todas las tarjetas, y el foco no caía en la que se envió.
- **Arreglo.** La acción agrega `&en=<id>` a la dirección, solo si el id tiene forma de uuid. La página liga el aviso solo a la tarjeta con ese id.

**serv-nuevo-6b: las fechas del folio en su campo.**

- **Causa.** En Coincidencias, una fecha de presentación o de aviso al cliente imposible marcaba el folio con un texto genérico.
- **Arreglo.**
  - `registrarReporteAccion` manda el campo que falló en `en=<campo>-<id>`: `presentado` o `aviso`, y si no, `folio`.
  - `FormularioFolio` marca y enfoca solo ese campo. Es un componente aparte de `coincidencias.tsx` para poder renderizarlo en la prueba unitaria, porque `coincidencias.tsx` importa `server-only`.
  - Las dos fechas tienen su propio texto: «Revisa la fecha de presentación del reporte…» y «Revisa la fecha del aviso al cliente… Déjala vacía si aún no avisas.».

**serv-nuevo-6d: enviar sin datos generales.**

- **Causa.** El CHECK `kyb_versiones_forma` rechazaba el `update` con 23514, y `traducirErrorDeBase` lo convertía en `base_no_disponible`: «La base no respondió…».
- **Arreglo.**
  - `enviarVersion` lee con `for update` las columnas que exige el CHECK (`DATOS_PARA_ENVIAR`, en `dominio/operacion/expediente.ts`). Si falta alguna, lanza `ExpedienteIncompleto` (`expediente_datos_incompletos`) con la lista, antes del `update` y sin evento.
  - La página dice qué falta en palabras: «Faltan el giro y el domicilio. Captura esos datos en «Datos generales» y vuelve a enviar.».
  - En la dirección viajan solo las claves de lo que falta, nunca un dato.
  - `traducirErrorDeBase` también traduce el nombre del CHECK al mismo código, por si otro camino llega a la base.
- **Columnas escritas a mano.** La revisión de seguridad marcó la lista de columnas interpolada en el `select`, así que va escrita literal. Si una columna faltara en esa lista, contaría como dato faltante y la versión completa no se enviaría. Lo cubre la prueba de Postgres.

**Verificación en rojo.** Las pruebas nuevas, corridas contra el código de `a75d5e4`, fallan así:

- **Unitarias**, 9 pruebas:
  - los dos textos de las fechas daban «Revisa el campo marcado…»;
  - `INVISIBLE` no reconocía U+3164;
  - `validarAlta` aceptaba «EscuelaᅟKemper»;
  - la Lista aceptaba «EVA RODRㅤIGUEZ»;
  - `FormularioFolio` no existía;
  - las tres de `datosQueFaltan`;
  - el CHECK de la forma se traducía a `base_no_disponible`.
- **Postgres:**
  - «Missing expected rejection: socio "Luis Rodrㅤíguez"»;
  - serv-nuevo-6d: sin la clase, el envío da `base_no_disponible`.
- **e2e de Recuperaciones:** `en` llegaba vacío. Sin esa comprobación, la nota de la tarjeta enviada no tenía el foco.
- **Reloj:** 76/79 con los tres relojes a +30 días (tabla de arriba).

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **Bomba de fechas (CI y main)** Desde el 2026-11-08T18:00Z, «separa empresas…» y «colaboradores, nómina…» daban `invitacion_vencida`, y «calendario y lotes» daba `primer_pago_invalido` | Las pruebas emiten con la hora real (`emitirConHoraReal`); la fecha de negocio sigue fija | La suite de Postgres con los tres relojes adelantados: `a75d5e4` 76/79 a +30 días; el final, 80/80 a +30 y a +365 días. `datos/reloj-*-dias-*.txt` |
| **base-N26** U+3164, U+115F, U+FFA0, U+FE0F, U+180B, U+E0100 o U+17B4 pasaban los rechazos de identidad | `INVISIBLE` con `\p{Default_Ignorable_Code_Point}` | `control.test.ts`: los 7 en las identidades, «❤️» aceptado en un motivo, «Łukasz Żółć», «李小龍» y «محمد» aceptados, y la Lista con «EVA RODRㅤIGUEZ» y «EVA RUIZ️ SOL» rechazada. Postgres «base-N23…»: los 7 como socio y representante, la razón social y la Lista. Captura `r95` |
| **base-N27** Con varias recuperaciones, el rechazo sin nota marcaba todas las notas | `&en=<id>`; la página liga el aviso solo a esa tarjeta | e2e «con tres recuperaciones pendientes…»: `en` es el id de la de en medio; solo su nota queda marcada, con `aria-describedby` y el foco; después se rechazan las tres. Captura `r99` |
| **serv-nuevo-6b** Una fecha imposible del reporte marcaba el folio | `en=presentado-<id>` o `en=aviso-<id>`; `FormularioFolio` marca y enfoca solo ese campo; un texto por fecha | `formulario-folio.test.ts` con cada código y con otro id; `aviso.test.ts` con los dos textos. Capturas `r97` y `r98` |
| **serv-nuevo-6d** Enviar una versión sin giro o sin domicilio decía «La base no respondió» | `ExpedienteIncompleto` antes del `update`, con la lista; el aviso dice qué falta; el CHECK también se traduce | `alta-regulada.test.ts` «lo que le falta a una versión para enviarse» (3); `db.test.ts`; Postgres «serv-nuevo-6d…»: faltan `giro` y `domicilio`, sigue en borrador y sin evento, y completa se envía con 1 evento. Captura `r96` |
| **Pedido del líder (lo encontró R2)** Con el emulador de Blob apagado, `preparar.ts` se colgaba sin salida, y «Cómo se corre» no nombraba `REGISTRO_SERVIDOR` | `preparar.ts` revisa el `/salud` del emulador con un tope de 3 segundos antes de cada fase. «Cómo se corre» pide el emulador antes de preparar y nombra `REGISTRO_SERVIDOR` y `BASE_ARRANQUE` | Corrido a mano, sin tocar ninguna base: con el puerto cerrado termina en 0.7 s con salida 1; con un servidor que acepta y no responde, en 3.3 s («sin respuesta en 3 segundos»); sin `VERCEL_BLOB_API_URL`, «Falta VERCEL_BLOB_API_URL…». Con el emulador encendido, la revisión pasa y la fase sigue |

**Decisiones de la novena revisión.**

- **El arreglo de la bomba está en las pruebas.** La aplicación siempre emite y acepta con el reloj real. Solo las pruebas mezclaban la fecha fija con el `now()` de la base.
- **El CHECK sigue siendo la última barrera.** La revisión en el servicio da el aviso claro, y el CHECK de la 0028 no cambia.
- **El aviso de lo que falta lo arma la página.** La acción manda solo las claves (`faltan=giro,domicilio`), y la página las convierte en palabras con `fraseDeLoQueFalta`. Las claves desconocidas se ignoran; si no se reconoce ninguna, queda solo el aviso general.
- **Un solo `en` en Recuperaciones.** Solo un id con forma de uuid llega a la dirección. Con cualquier otro valor no se marca nada.

### Décima revisión (re-verificación sobre `32e49b8`)

El CI de `32e49b8` cayó en N5. Los revisores cerraron la bomba de fechas, N26, N27, 6a, 6b y 6d, y encontraron además:

- base-N28: una clave repetida en la dirección;
- serv-nuevo-7 (P2), que viene de main y ya estaba en producción;
- los textos obligatorios hechos solo de invisibles (P3);
- el JSDoc de `enviarVersion`;
- dos reglas de axe que vienen de main;
- el desborde del SHA-256 a 390;
- el campo de archivo que no recibía el foco.

El recorrido sin JavaScript de esta ronda encontró dos más, que también van aquí:

- el fragmento de la dirección (`#documentos-titulo`) le quitaba el foco al campo con error;
- sin JavaScript, la barra superior quedaba transparente y se encimaba con el contenido (viene de main).

Todo va en este PR. **La 0028 no cambia.**

**CI de `32e49b8`: N5 en `test:db`.** La suite de Postgres cayó 78/80 en N5 (cierre de un caso mientras otra pestaña carga la Lista), con `could not serialize access due to concurrent update` (40001). El `where` era `UPDATE companies … ← lpb_cotejar_empresa ← lpb_cotejar_operador ← lpb_cargas_cotejar`. La prueba no cambió en esta ronda y pasó en el CI de `a75d5e4`.

- **Causa.** Las cuatro fases de N5 crean la promesa de la pestaña que espera el candado, hacen otros `await` y la revisan después. En las dos fases de REPEATABLE READ esa promesa debe rechazarse con 40001, y es lo que pasó: es la fase «el cierre primero», donde la carga aborta en su `commit`. Si el error de la carga llega por su socket antes que la respuesta del `commit` del cierre, la promesa se rechaza sin manejo. Node lo reporta como rechazo sin manejar y node:test lo cuenta como falla de la prueba en curso. Depende del orden en que llegan las respuestas de dos sockets; por eso salió en el CI y no en local.
- **No es un hallazgo de producto.** Ese 40001 solo sale con REPEATABLE READ o SERIALIZABLE: en READ COMMITTED, PostgreSQL espera y vuelve a evaluar la fila. Las dos fases de READ COMMITTED pasaron igual en las corridas.
- **Rojo determinista.** `yaRespondio` espera a que la otra pestaña termine su sentencia en la base (`pg_stat_activity.state` deja de ser `active`) y a que el cliente la lea. Así fuerza el orden del CI. Con el patrón viejo y ese orden, N5 falla en 3 de 3 corridas con el error del CI, el mismo `where` y `GetTupleForTrigger` (`datos/n5-rojo-fase3-orden-del-ci.txt`). Con la fase 3 arreglada, la fase 4 cae igual (2 de 2), ahora por el camino del cierre: `lpb_coincidencias_revisar` (`datos/n5-rojo-fase4-orden-del-ci.txt`).
- **Arreglo.** Las promesas que deben abortar nacen dentro de `assert.rejects`. Las que deben salir bien nacen con `enEspera`, que engancha su manejo al crearlas sin tragarse el error del `await` de abajo. `yaRespondio` se queda en las cuatro fases: la prueba corre siempre con el orden que tumbó el CI.
- **Barrido.** En las suites de Postgres solo N5 creaba promesas que se esperaban más tarde. H3/H6 (`:1162`), H6/H7 (`:1315`) y F4/F5 ya enganchan el rechazo al crear la promesa. Fuera de la zona, `tests/proveedores/pagos-proveedores.test.ts:364` tiene el mismo patrón en un `commit` que debe salir bien: si fallara, la prueba caería igual, solo que con otro reporte.
- **Validación.** Corridas seguidas de la suite completa `alta-regulada-postgres.test.ts` con los 18 núcleos ocupados (18 procesos `yes`): 100 corridas y 0 fallas (`datos/n5-100-corridas-con-carga.txt`). El revisor del servidor llegó al mismo arreglo, con una demora fija de 200 ms como mutación. Después, la suite de Postgres completa: 80/80.

**base-N28: una clave repetida en la dirección.**

- **Causa.** Next entrega una lista (`string[]`) cuando una clave se repite: `?aviso=a&aviso=b`. Con una lista, `codigo.startsWith` (`aviso.tsx`) tumbaba cualquier página de Operación con un 500. `faltan.split` hacía lo mismo en el expediente.
- **Arreglo.** Las 11 páginas de Operación que leen `searchParams` pasan por `soloTexto` (`src/app/operacion/busqueda.ts`): cada clave queda como texto, o fuera. El tipo `Parametros<…>` declara `string | string[]`, así que TypeScript obliga a pasar por ahí. Una clave repetida se descarta, como si no viniera.

**serv-nuevo-7 (P2): sin JavaScript, las acciones daban 500. Ya estaba en producción desde `c9ee947`.**

- **Causa.** `next.config.ts` ponía `Referrer-Policy: no-referrer` en todo el sitio. Según el estándar Fetch, el envío nativo de un formulario (un POST en modo `navigate`) con esa política lleva `Origin: null`, y Next rechaza la acción de servidor con un 500. Pasa sin JavaScript y al hacer clic antes de que la página hidrate. Con la página hidratada no pasa: la acción sale por `fetch` (modo `cors`) y lleva el origen real.
- **Arreglo.**
  - `Referrer-Policy: same-origin` en todo el sitio. Sigue sin mandar la dirección a otros sitios, así que un enlace con token no sale de aquí.
  - La página de la invitación ponía `referrer: "no-referrer"` en su metadata, y la etiqueta `<meta>` le gana al encabezado: también pasa a `same-origin`.
  - No queda otra regla con `no-referrer`.
- **Rojo.** En la e2e sin JavaScript, el `Origin` del POST llega como `"null"` y la respuesta es 500. Pasa en el alta de un prospecto en Operación y al aceptar la invitación (`datos/e2e-rojo-origen-null-32e49b8.txt`).

**Textos que no se ven.**

- **Causa.**
  - Un giro de puro U+3164 contaba como capturado: `datosQueFaltan` solo miraba `null`.
  - Diez U+3164 pasaban como motivo: el mínimo contaba puntos de código.
- **Arreglo.**
  - `tieneAlgoVisible` y `caracteresVisibles` (`control.ts`). Un texto sin nada que se vea (descontando espacios, controles y `\p{Default_Ignorable_Code_Point}`) está vacío:
    - `textoOperativo` y `textoMultilinea` devuelven `null`;
    - los textos libres opcionales del expediente se guardan vacíos (`libre`): giro, nacionalidad, domicilio, quién designó y el detalle del documento;
    - `datosQueFaltan` los cuenta como faltantes.
  - `motivoEscrito` cuenta solo lo que se ve: diez U+3164 dan `motivo_invalido`, y «Revisar» con tres U+3164 dan `motivo_corto`. Para la base son 10 caracteres y aquí son 7. El servidor es más estricto que la base, nunca al revés.
- **Lo que no cambia.**
  - `CONTROL` sigue igual.
  - Las identidades y los identificadores conservan el aviso de su campo: `INVISIBLE` se revisa antes.
  - El emoji con U+FE0F o unido con U+200D se queda tal cual en un texto con contenido («❤️» sí se ve).

**El JSDoc de `enviarVersion`** quedó encima de `ExpedienteIncompleto`; vuelve a su función.

**Dos reglas de axe que vienen de main.**

- **`aria-prohibited-attr`.** `.bandeja-cuenta` era un `<span>` sin rol con `aria-label`. Un lector puede ignorarlo y el número es `aria-hidden`, así que nadie oía cuántas decisiones hay pendientes. Ahora lleva dentro `<span className="solo-lector">N pendientes</span>`, sin coma: el título es flexible, y con la coma Chrome leía «Necesita tu decisión , 1 pendiente». Probé cuatro formas en Chromium con la consulta exacta de Playwright, y solo sin la coma el nombre queda limpio: «Necesita tu decisión 1 pendiente». Solo cambian las líneas del contador (90-97) de `bandeja.tsx`.
- **`label-content-name-mismatch` (WCAG 2.5.3).** El enlace del logotipo de Operación tenía un `aria-label` que no contenía el texto visible.
  - Ahora el logotipo va dentro de un `<span aria-hidden="true">` y el nombre lo lleva un solo texto `solo-lector`: «Lever Operación SOFIPO, ir al resumen».
  - Con el texto suelto junto al logotipo, que es flexible, el nombre quedaba con un espacio antes de la coma.
  - `cromo/logotipo.tsx` no cambia.
- **Verificación** (`scripts/evidencia/ola-r-alta/axe.mjs`: las dos reglas, 13 pantallas × 5 roles × 1440 y 390):
  - **axe.** `32e49b8` da 22 y 130 (`datos/axe-32e49b8.txt`); el final, 0 y 0 (`datos/axe-final.txt`).
  - **Lector** (consulta exacta de Playwright, `getByRole` con `exact`): el enlace del logotipo se llama «Lever Operación SOFIPO, ir al resumen» en las 130 vistas, y cada título de la bandeja se llama «Necesita tu decisión N pendiente(s)».
  - **Píxeles.** La zona del logotipo es idéntica: 3 temas × 2 anchos, 143×33 y 0 bytes distintos entre `32e49b8` y el final (`datos/logotipo-pixeles.txt`).

**El campo de archivo no recibía el foco.** `CampoArchivo` pasaba `aria-invalid` y `aria-describedby` del error del servidor a su `input`, pero no `autoFocus`. Un archivo rechazado (tamaño, tipo o sin archivo) dejaba el campo marcado sin el foco. Ahora el `input` recibe también `autoFocus`. React lo emite como `autofocus` en el HTML.

**El fragmento de la dirección le quitaba el foco al campo (hallado en el recorrido sin JavaScript).**

- **Causa.** Con `autoFocus` en su lugar, el recorrido sin JavaScript seguía sin foco: atributos bien, foco en 0. Las acciones del expediente redirigían con `?aviso=…&en=documentos-titulo#documentos-titulo`. Al cargar la página completa con un destino de fragmento, el navegador descarta el `autofocus` (estándar HTML: con un fragmento destino, no se procesan los candidatos de autofocus). La sonda lo probó en Chromium con la misma página: con `#documentos-titulo`, foco 0 con JavaScript y sin él; sin el fragmento, foco 1 (`datos/foco-con-fragmento.txt`). Con JavaScript no se notaba en el uso normal: tras la acción, la navegación es del lado del cliente y React da el foco.
- **Afectaba a todos los avisos de campo del expediente,** no solo al archivo: datos generales, documentos, dictamen, grado de riesgo, suspensión y el folio de Coincidencias, siempre que la página cargue completa (sin JavaScript o al recargar).
- **Arreglo.** `avisoDeCampo(codigo)` (`aviso.tsx`) dice si el aviso es de un campo: los mismos códigos que marca `errorDelCampo`. Si lo es, `fallo` (`acciones-alta.ts`) redirige sin el fragmento; `en=` se queda, así que el aviso y el campo marcado siguen en su sección, y el foco lleva la página al campo. Los avisos que no son de un campo conservan su fragmento. Revisé cada sección: todo código de campo que puede salir de sus acciones tiene su campo en esa sección.
- **Prueba.** Unitaria: `avisoDeCampo` coincide con `errorDelCampo` y descarta los avisos generales y las claves del prototipo. e2e sin JavaScript: Omar guarda la razón social de Duna con un U+200B; vuelve con 303, el campo marcado, ligado, con el foco y sin fragmento, y la base sin cambios. En rojo, con el `fallo` de `32e49b8`: foco 0 de 1 (`datos/e2e-rojo-foco-con-fragmento.txt`). En el recorrido, el archivo de 4 MiB sin JavaScript (`r106`).

**Sin JavaScript, la barra superior se encimaba con el contenido (hallado en el recorrido; viene de main, `0a1fb4f`).**

- **Causa.** `.barra-superior` es fija (`sticky`) y solo toma su fondo con `[data-desplazada]`, que pone `cromo/barra-superior.tsx` con JavaScript al desplazarse. Sin JavaScript, el título de la página quedaba transparente encima de la sección (la primera captura de `r106` lo mostró).
- **Arreglo.** En `marco.css`, `@media (scripting: none)` le da a la barra el mismo fondo, desenfoque y sombra. Con JavaScript no cambia nada: esa regla no aplica. Una sonda confirmó que Chromium activa `scripting: none` con JavaScript apagado.
- **Prueba.** La misma e2e sin JavaScript exige que la barra tenga fondo después de que el foco desplazó la página. En rojo, con el `marco.css` de `32e49b8`: `rgba(0, 0, 0, 0)` (`datos/e2e-rojo-barra-sin-js.txt`). Capturas sin JavaScript con la barra: `r102`, `r104` y `r106` (`r100` es la entrada, que no tiene barra).

**El SHA-256 ensanchaba la página a 390.**

- **Causa.** El SHA-256 de cada documento (64 caracteres sin espacios) no tenía dónde partirse. El expediente de Ébano medía 533 px a 390.
- **Por qué no lo vio la fase de pantallas.** Medía contra `window.innerWidth`, y en un teléfono (`isMobile`) la ventana de diseño crece hasta el ancho del contenido.
- **Arreglo.** `overflow-wrap: anywhere` en `.operacion-fila-cuerpo`, `.operacion-meta`, `.operacion-detalle` y `.operacion-mono`, en `operacion.css` (`tokens.css` no cambia). Así se parten también el nombre de un archivo, el folio, la acción con guiones bajos de la bitácora o un motivo con una dirección pegada. La fase de pantallas ahora mide contra el ancho pedido.
- **Prueba.** El recorrido sube a Laboratorio Novena un acta con un nombre de 136 caracteres sin espacios. A 390, con y sin JavaScript, la orilla derecha de cada SHA-256 y de cada nombre de archivo queda dentro de 390, en Ébano y en Novena. Se mide con las cajas de Playwright, que sirven también sin JavaScript.

**Verificación en rojo.** Las pruebas nuevas, corridas contra el código de `32e49b8`, fallan así:

- **N5:** con el orden del CI forzado, 3 de 3 en la fase 3 y 2 de 2 en la fase 4.
- **Unitarias:**
  - «un dato hecho solo de invisibles falta»: el resultado es `[]`, se esperaba `['giro', 'domicilio']`;
  - `textoOperativo("\u3164")` devolvía `'\u3164'`.
- **Postgres:** el dictamen observado con diez U+3164 se acepta («Missing expected rejection»), y lo demás cae en cascada.
- **e2e:**
  - la clave repetida da 500 en `/operacion/alertas`;
  - sin JavaScript, el alta de Operación y la invitación llevan `Origin: "null"` y dan 500. La prueba se detiene en el alta, antes de las entradas.
- **axe:** 22 y 130.
- **Desborde:** el expediente de Ébano mide 533 a 390.
- **Campo de archivo:** en `archivos.test.ts`, el `input` no trae `autofocus`.
- **Fragmento:** en la e2e sin JavaScript, foco 0 de 1 en la razón social.
- **Barra superior:** en la misma e2e, fondo `rgba(0, 0, 0, 0)`.

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **CI de `32e49b8`: N5** El 40001 esperado de REPEATABLE READ llegaba antes que su manejo y node:test lo contaba como falla | Las promesas nacen con su manejo: `assert.rejects` o `enEspera`. `yaRespondio` fuerza el orden del CI en las cuatro fases | Rojo determinista: 3/3 y 2/2. 100 corridas con 18 núcleos ocupados y 0 fallas. `test:db` completo: 80/80 |
| **base-N28 (P3)** `?aviso=a&aviso=b` y `?faltan=a&faltan=b` daban 500 | `soloTexto` en las 11 páginas que leen `searchParams` | `busqueda.test.ts`. e2e «una clave repetida…»: 10 pantallas con dos roles, `faltan` repetido con el aviso general, la Lista y la entrada. Recorrido con y sin JavaScript. Captura `r105` |
| **serv-nuevo-7 (P2, en producción)** Sin JavaScript, `Origin: null` y 500 en toda acción de servidor | `Referrer-Policy: same-origin`, también en la metadata de la invitación | e2e «sin JavaScript…»: el alta da 303 con su aviso y las dos entradas dan 200 con el suyo, todo con su `Origin`. La invitación sin JavaScript da 200 con «Las dos contraseñas no coinciden.». Recorrido: la entrada, el giro y el dictamen sin JavaScript. Capturas `r100`, `r102` y `r104` |
| **Textos que no se ven (P3)** Un giro de puro U+3164 contaba como capturado; diez U+3164 pasaban como motivo | `tieneAlgoVisible` y `caracteresVisibles`; `libre` en los textos opcionales del expediente; `motivoEscrito` cuenta lo que se ve | `formulario.test.ts`, `alta-regulada.test.ts` y Postgres (dictamen, suspensión y 6d). Recorrido con y sin JavaScript. Capturas `r101`-`r104` |
| **JSDoc (P3)** `enviarVersion` perdió su descripción | Vuelve a su función | — |
| **axe `aria-prohibited-attr`** `.bandeja-cuenta` con `aria-label` en un `<span>` sin rol | Texto `solo-lector` dentro | axe: 22 a 0. Lector: «Necesita tu decisión 1 pendiente», sin el espacio antes de la coma que leía Chrome |
| **axe `label-content-name-mismatch`** El nombre del logotipo no contenía su texto visible | Logotipo en `aria-hidden` y un solo texto `solo-lector` | axe: 130 a 0. Lector: «Lever Operación SOFIPO, ir al resumen». Píxeles idénticos en 3 temas × 2 anchos |
| **Campo de archivo** Un archivo rechazado por el servidor dejaba el control marcado sin el foco | `CampoArchivo` pasa también `autoFocus` | `archivos.test.ts`. Recorrido: sin JavaScript, un PDF de 4 MiB y 64 KiB; con JavaScript, un «PDF» que no lo es. Las dos veces da su aviso, el control marcado, ligado al aviso y con el foco, y ningún documento. Capturas `r106` y `r107` |
| **Fragmento que quita el foco (hallado en el recorrido)** Con `#seccion` en la dirección, el navegador descarta el `autofocus` al cargar la página completa | `avisoDeCampo`; `fallo` redirige sin fragmento cuando el aviso es de un campo y conserva `en=` | Unitaria en `aviso.test.ts`. e2e sin JavaScript: la razón social con U+200B vuelve marcada, con el foco y sin fragmento; en rojo, foco 0. Recorrido: `r106` |
| **Barra superior sin JavaScript (hallada en el recorrido, viene de main)** Transparente y encimada con el contenido al desplazarse | `@media (scripting: none)` con el fondo de la barra desplazada | La misma e2e: la barra con fondo; en rojo, `rgba(0, 0, 0, 0)`. Capturas sin JavaScript `r102`, `r104` y `r106` |
| **Desborde a 390** El SHA-256 ensanchaba el expediente a 533 px | `overflow-wrap: anywhere` en las clases de Operación; la fase de pantallas mide contra el ancho pedido | Recorrido: en Ébano (sus SHA-256) y en el borrador de Novena (un nombre de archivo de 136 caracteres), todo queda dentro de 390, con y sin JavaScript. Capturas `r108` y `r109` |

**Decisiones de la décima revisión.**

- **Los identificadores conservan su aviso.** Un RFC, un teléfono o un correo hecho de invisibles sigue dando el aviso de formato de su campo, como decidió la octava revisión. Solo los textos libres cuentan como vacíos.
- **Un texto libre opcional sin nada que se vea se guarda vacío.** No se rechaza al guardar. Al enviar, el aviso dice «Falta el giro.», que es lo que ve la persona: el campo se ve vacío.
- **La invitación con `same-origin`.** Como el resto del sitio, el enlace con el token no sale a otros sitios. Antes, con `no-referrer`, aceptar la invitación sin JavaScript daba 500.
- **Un aviso de campo vuelve sin fragmento.** Lleva la página al campo con el foco, no al título de la sección. El aviso sigue en su sección (`en=`).
- **La barra superior sin JavaScript lleva siempre su fondo.** Con JavaScript sigue transparente arriba y con fondo al desplazarse.
- **El recorrido sin JavaScript no corre código en la página.** Con JavaScript apagado, `page.evaluate` y `addStyleTag` de Playwright no terminan nunca, y la primera corrida se colgó ahí. Esas pasadas usan solo selectores (`:focus`), cajas y `scrollIntoViewIfNeeded`.
- **axe va como script de evidencia, no en la e2e.** `axe-core` llega con `eslint-config-next` (vía `eslint-plugin-jsx-a11y`), no como dependencia propia. La e2e no depende de él.

### Onceava revisión (re-verificación sobre `edefd2e`)

El revisor de la base y el de pantalla cerraron `edefd2e` sin bloqueos de su delta. La sesión líder pidió el mensaje del error junto al campo, y los revisores encontraron:

- un P2: sin JavaScript, «Agregar representante» y «Agregar accionista» volvían en blanco;
- tres P3: el motivo de la coincidencia sin ligar, U+2800 y los Cf visibles, y la nota del dictamen aprobado;
- el textarea de la suspensión con el foco, pero asomado al pie.

Todo va en este PR. **La 0028 no cambia.**

**El texto del error, junto al campo con el foco.**

- **Lo que pasaba** (`datos/mensaje-junto-al-campo-antes.txt`, medido con la e2e sobre el código de `edefd2e`):
  - **Con JavaScript, el campo quedaba fuera de la pantalla.** Después de la acción, el campo de archivo de los documentos tenía el foco en y=3119 de 900 (a 1440) y en 4950 de 844 (a 390). Solo se veía el aviso de arriba. Next sube la página al terminar de navegar: su `InnerScrollHandler` es un `useLayoutEffect` del segmento, corre después del autofocus y deja el foco donde está. Con JavaScript no había prueba que lo viera: `toBeFocused` no mira si el campo se ve.
  - **El socio con el foco en Capital.** El aviso de su formulario va arriba del formulario: quedaba en −32 (a 1440) y en −452 (a 390), fuera de la vista.
  - **Sin JavaScript, los documentos.** El campo quedaba a la vista y el aviso, arriba, en −2587.
- **Arreglo, en un solo lugar.**
  - `MensajeDelCampo` (`aviso.tsx`) usa la misma condición que `errorDelCampo` y el mismo texto que el aviso. Va justo después del control: `<p id="<idAviso>-campo" class="error-campo">`. Es el estilo de error de campo que ya usan Personas, Proveedores y Flujo, así que no hay CSS nuevo. Sin error no pinta nada.
  - `errorDelCampo` apunta `aria-describedby` a ese mensaje. El aviso de arriba queda como resumen y deja de ser la descripción del campo: el lector oye el texto una vez, al llegar al campo.
  - `MensajeJuntoAlCampo` (`mensaje-junto-al-campo.tsx`, de cliente) cubre el caso con JavaScript. Si el campo que describe tiene el foco y no se ve junto con su mensaje, lo centra en un `useEffect`, que corre después del de Next. Sin JavaScript, el autofocus ya lleva la página al campo.
  - Son 16 archivos de producto. Además de `aviso.tsx` y `mensaje-junto-al-campo.tsx` (nuevo):
    - el alta, la ficha, Comisiones y la Lista;
    - el expediente (página y componente), el campo de archivo, el folio y las coincidencias;
    - Recuperaciones (página y tarjeta);
    - el representante, el accionista con su identidad y el diálogo de rechazo.

    Ningún formulario de Operación que usa `errorDelCampo` queda fuera.
  - **Nunca dos campos marcados.** Cada página, o cada formulario con su propio aviso, marca un solo campo, así que el id del mensaje no se repite. La e2e lo exige en cada caso. El recorrido lo revisa en cada aviso de Operación: en los 71 avisos de las regresiones hubo 43 campos marcados, cada uno con su mensaje único junto a él.
- **Después** (`datos/mensaje-junto-al-campo-despues.txt`). A 1440 y 390, con JavaScript y sin él, el mensaje queda justo debajo del campo (de 8 a 14 px) y a la vista:
  - los documentos, en 478 de 900;
  - el socio a 390 con JavaScript, en 259-297 de 844;
  - la suspensión, en 511-550 de 900, donde el revisor la vio asomada en y=943;
  - la nota de la tercera tarjeta de Recuperaciones, a 390 sin JavaScript, en 547-567.
- **Sin error no cambia nada** (`datos/sin-error-sin-cambios.txt`). Comparé 10 pantallas con formularios × 1440 y 390, con el build de `edefd2e` y con el final, sobre la misma base.
  - **DOM normalizado:** idéntico en 20 de 20 vistas.
  - **Píxeles:** idénticos en 11 de las 12 capturas que el mismo build repite igual. La duodécima difiere en la franja del canvas fijo del fondo, con la misma cifra que da un solo build contra sí mismo; su DOM es idéntico.
  - **CSS:** la ronda no cambia ninguno.
- **Rojo** (`datos/e2e-rojo-mensaje-junto-al-campo.txt`):
  - contra `edefd2e`, el campo nombra el aviso de arriba;
  - con el mensaje nuevo pero sin centrar, el campo queda en y=3119 y el mensaje, fuera de la vista.
- **Probado y descartado:** devolver el foco al repetir el mismo error desde la misma dirección. La e2e repite el error, y el foco llega igual sin esa línea.

**P2 (revisor de pantalla): sin JavaScript, «Agregar representante» y «Agregar accionista» volvían en blanco.**

- **Causa.** `key={randomUUID()}` en `expediente.tsx`: la clave cambiaba en cada vista. Sin JavaScript, React le devuelve el estado de la acción solo al formulario con la misma clave. Por eso volvía con 200, sin aviso, sin marca y sin lo capturado. Pasaba también con un clic antes de hidratar.
- **Arreglo.** La clave es `${version.id}-${cuántos hay}` y cambia solo cuando entra uno: con JavaScript, tras agregar, el formulario empieza en blanco; tras un rechazo es el mismo formulario. No quedan otras claves aleatorias en formularios con `useActionState`.
- **Prueba.**
  - e2e sin JavaScript de los dos formularios con un U+200B en el nombre: su aviso, el campo marcado y con el foco, su mensaje a la vista y lo capturado de vuelta, sin nada en la base.
  - Recorrido: `r114`.
  - Rojo: en la medida «antes», el socio sin JavaScript no llegó a medirse, porque el formulario volvió en blanco.

**P3 (revisor de pantalla): el motivo de la coincidencia no se ligaba a su campo.**

- **Causa.** `resolverCoincidenciaAccion` llamaba a `fallo` sin ancla y `Coincidencias` no usaba `errorDelCampo`: sin `en=`, sin marca y con el foco en BODY.
- **Arreglo.** La acción manda `en=motivo-<id>`, o `resolucion-<id>` si el error es del dictamen. `Coincidencias` marca ese campo y pone su mensaje junto a él, como el folio.
- **Prueba.** Recorrido con JavaScript a 1440 y sin JavaScript a 390: `en=motivo-<caso>`, sin fragmento, el campo marcado y con el foco, y el caso sigue abierto. Capturas `r110` y `r111`.

**P3 (revisor de la base): U+2800 y 32 Cf que no son Default_Ignorable contaban como visibles.**

- **Arreglo.** `tieneAlgoVisible` y `caracteresVisibles` descuentan `\p{Cf}` y U+2800.
- **Prueba.**
  - Unitarias con U+2800, U+FFF9, U+0600, U+06DD, U+110BD y U+13430.
  - Postgres: un dictamen «observado» con diez U+2800 o diez U+FFF9 da `motivo_invalido`. Un giro de diez U+2800 y una colonia «U+FFF9 U+0600» se guardan vacíos.
  - Rojo: el dictamen con diez U+2800 se asentaba (`datos/rojo-u2800-y-nota-del-aprobado.txt`, línea 564).

**P3 (revisor de la base): un dictamen «aprobado» con una nota inválida se asentaba sin nota.**

- **Causa.** Viene de `07b5e8c`. `opcional(...) ?? null` convertía una nota inválida en `null`, por ejemplo una de más de 1,000 caracteres armada a mano.
- **Arreglo.** Una nota sin nada que se vea queda vacía; una inválida da `motivo_invalido`, y el aviso marca el motivo.
- **Prueba.** Postgres con la petición armada a mano:
  - 1,001 caracteres dan `motivo_invalido` y ningún dictamen;
  - «U+2800 U+3164» deja el aprobado con el motivo vacío.
  - Rojo: con 1,001 caracteres se asentaba (línea 584).

**Documentado, sin cambio: un archivo de más de 4.5 MB sin JavaScript.** Sin JavaScript no hay revisión de tamaño en el navegador. Un archivo de más de 4.5 MB lo corta la plataforma de Vercel con un 413 antes de llegar a la acción, así que la pantalla es la de la plataforma y no el aviso. `bodySizeLimit` no cambia. Entre 4 MiB y 4.5 MB, el servidor da su aviso (`r106`).

| Hallazgo | Arreglo | Prueba |
| --- | --- | --- |
| **Mensaje junto al campo (sesión líder)** El texto del error quedaba arriba de la página o del formulario. Con JavaScript, además, Next subía la página después del autofocus y el campo con el foco quedaba fuera de la pantalla | `MensajeDelCampo` justo después de cada control marcado, como su `aria-describedby`; el aviso de arriba queda como resumen. `MensajeJuntoAlCampo` centra el campo con JavaScript. 16 archivos | e2e con y sin JavaScript, a 1440 y 390: documentos (dos veces el mismo error), socio, reactivación y la tercera tarjeta de Recuperaciones; nunca dos campos marcados. Unitarias. Recorrido: 71 avisos y 43 campos, cada uno con su mensaje. Capturas `r112` y `r113`. Rojo: el campo en y=3119 |
| **P2 sin JavaScript: representante y accionista en blanco** | Clave estable: `${version.id}-${cuántos hay}` | e2e sin JavaScript de los dos con un invisible: aviso, marca, foco, mensaje y lo capturado. `r114` |
| **P3 motivo de la coincidencia** Sin `en=`, sin marca y con el foco en BODY | `en=motivo-<id>` o `resolucion-<id>`; `errorDelCampo` y su mensaje en `Coincidencias` | Recorrido con y sin JavaScript. `r110` y `r111` |
| **P3 U+2800 y 32 Cf visibles** | `\p{Cf}` y U+2800 fuera de lo que se ve | Unitarias y Postgres. Rojo: el dictamen con diez U+2800 se asentaba |
| **P3 nota del dictamen aprobado** Una nota inválida se asentaba como vacía | Sin nada visible, vacía; inválida, `motivo_invalido` | Postgres con la petición armada. Rojo: se asentaba |
| **Suspensión asomada (y=943 de 1000)** | El mismo mensaje junto al campo; con JavaScript se centra | e2e con y sin JavaScript, a 1440 y 390: el mensaje en 511-550 de 900 |
| **Más de 4.5 MB sin JavaScript** | Sin cambio: la plataforma corta con 413 | Documentado |

**Verificación en rojo.** Las pruebas nuevas, corridas contra el código de `edefd2e`, fallan así:

- **e2e:** el campo nombra el aviso de arriba; sin centrar, el campo queda en y=3119; sin JavaScript, el socio vuelve en blanco.
- **Unitarias:** `textoOperativo` devolvía diez U+2800 tal cual; `datosQueFaltan` no veía faltar el giro de U+2800.
- **Postgres:** el dictamen «observado» con diez U+2800 y el «aprobado» con 1,001 caracteres se asentaban.

**Decisiones de la onceava revisión.**

- **El mensaje junto al campo repite el texto del aviso.** Es el patrón de resumen arriba y mensaje en el campo. El lector lo oye una vez, porque solo el mensaje junto al campo es su descripción.
- **El mensaje va después del control, no entre la etiqueta y el control.** Así, en los formularios de dos columnas, las etiquetas y los controles de un renglón siguen alineados. En la tarjeta de una coincidencia con error, el motivo baja a su propio renglón por el largo del mensaje, y eso solo pasa con error.
- **La clave del formulario cuenta lo que hay, no la vista.** Con JavaScript, tras agregar uno, el formulario empieza en blanco, igual que antes.

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
| N9 | `r28-n9-riesgo-omar` | Celia registra la revisión periódica de Brisa con su caso abierto. Originación ve solo «Grado alto» y la fecha de revisión, sin renglones (serv-N9): «El desglose de la calificación lo ven Cumplimiento y Auditoría.», sin «lista», «exacta» ni «Puntaje»; la hoja de abajo se titula «Revisión de Cumplimiento». |
| N9 | `r29-n9-riesgo-ana` | Aprobación, igual. |
| N9 | `r30-n9-riesgo-celia` | Cumplimiento ve el desglose: «Coincidencias en listas · exacta · 3 puntos», el puntaje y quién calificó. |
| N9 | `r31-n9-riesgo-aurelio` | Auditoría, igual que Cumplimiento. |
| N9 | `r32-n9-riesgo-ofelia` | Administración no abre el expediente. |
| N12 | `r33-n12-dictamen-sin-motivo-pista-y-aviso` | Celia observa la versión de Cedro sin motivo: `motivo_invalido`; el motivo queda `aria-invalid` con `aria-describedby="dictamen-motivo-pista aviso-operacion"`. |
| N13 | `r34-n13-carga-un-renglon` | Celia carga una lista de un renglón (Cedro): «1 renglón; 1 coincidencia nueva.» |
| serv-N9 | `r35` a `r39-sn9-riesgo-con-caso-<persona>` | Brisa, con su caso abierto: Omar (Originación) y Ana (Aprobación) ven solo el grado y la fecha de revisión, sin renglones, y ni la página ni su respuesta RSC traen `antiguedad_meses`, `volumen_mensual`, `"coincidencias"` ni `puntaje`. Celia (Cumplimiento) y Aurelio (Auditoría) ven el desglose con «Coincidencias en listas», el puntaje y quién calificó. Ofelia (Administración) no abre el expediente. |
| serv-N9 | `r40` a `r44-sn9-riesgo-sin-caso-<persona>` | Lo mismo con Distribuidora Lumbre, sin caso (revisión vencida): «Revisión vencida» y el grado, sin desglose para Originación y Aprobación. |
| serv-N15 | `r45-sn15-rechazo-otro-campo-fisica-extranjera` | Omar agrega a Greta Lind Berg (física, Estados Unidos) con el RFC opcional «XX123»: `dato_invalido_rfc`, la dirección trae `extranjera=1` y el formulario vuelve en «Extranjera», como persona física y con el RFC marcado; ningún socio de más. |
| serv-N15 | `r46-sn15-rechazo-otro-campo-moral-extranjera` | Nordic Holdings LLC (moral) con capital «abc»: `dato_invalido_capital`, vuelve en «Extranjera» y «Persona moral», con el capital marcado. |
| serv-N17 | `r47-sn17-motivo-corto-en-el-navegador` | Omar escribe «Revisar» (7 caracteres) en el motivo de «Pedir suspensión» o «Pedir reactivación» (etiqueta «Motivo (de 10 a 500 caracteres)»): el navegador no envía (`tooShort`) y no hay solicitud nueva. |
| serv-N17 | `r48-sn17-motivo-corto-aviso-en-el-campo` | Sin el mínimo del navegador (una petición armada a mano), el servidor responde `motivo_corto`: «El motivo lleva al menos 10 caracteres…», con el campo `aria-invalid` y ligado al aviso; tampoco queda solicitud. |
| base-N15 | `r49-sn15b-enlace-anterior-ya-no-sirve` | Base aparte con un operador y 0 personal (como Preview). Primera corrida sin `--mostrar-enlace` (el correo no sale, no hay enlace); la segunda con los mismos correos emite un enlace nuevo por persona y revoca los de la primera; otro correo (solo o junto a los mismos) se rechaza; una tercera vuelve a emitir. El enlace de la segunda corrida: «Esta invitación ya no sirve.» |
| base-N15 | `r50-sn15b-acepta-con-el-enlace-nuevo` | Con el enlace de la tercera corrida, primera@lever.test fija su contraseña, su Administración queda activa y llega a «Registra tu segundo factor» (el QR y la semilla van tapados en la captura). Una corrida más se rechaza con «ya tiene Administración del personal activa». Salida de los seis comandos, con el enlace omitido, en «Salida literal». |
| serv-N18 | `r51-sn18-suspension-motivo-emoji` | En la ficha de una empresa activa, Omar pide la suspensión con «Revisar 😀» (10 unidades UTF-16: el navegador la deja pasar). El servidor responde `motivo_corto` con «El motivo lleva al menos 10 caracteres» en el campo, no «La base no respondió», y no queda solicitud. Con 10 caracteres o más (y su emoji) entra; escrito con Enter, se guarda en un renglón (sexta-N1). |
| serv-N18 | `r52-sn18-aprobaciones-dialogo-motivo-emoji` | Ana rechaza esa solicitud en Aprobaciones con «Revisar 😀»: el diálogo sigue abierto con lo escrito, el aviso ligado al campo y el foco en él; la solicitud sigue pendiente. |
| serv-N18 | `r53-sn18-aprobaciones-rechazo-registrado` | Corregido en el mismo diálogo, el rechazo queda con su motivo («decision_registrada»). |
| serv-N18 | `r54-sn18-dictamen-motivo-emoji` | Celia observa un dictamen con «Revisar 😀»: `motivo_corto` en el campo y ningún dictamen. |
| serv-N18 | `r55-sn18-caso-lpb-motivo-emoji` | Celia resuelve un caso de la Lista con «Revisar 😀»: `motivo_corto` y el caso sigue abierto. |
| serv-N15-resto | `r56` a `r58-sn15r-fisica-<campo>-conserva-lo-capturado` | Omar agrega a una física extranjera con el RFC «XX», con el nombre en blanco y con el capital «abc». Cada vez vuelve con país, documento, fecha, nombre y porcentajes, con el campo marcado y el foco en él; la dirección no trae datos del socio y no hay socio de más. |
| serv-N15-resto | `r59` a `r61-sn15r-moral-<campo>-conserva-lo-capturado` | Lo mismo con una moral extranjera: vuelve con país, registro, nombre y porcentajes. |
| serv-N15-resto | `r62-sn15r-corregido-entra` | Corregido el capital en el mismo formulario, la moral extranjera entra («expediente_accionista_agregado») y el formulario queda limpio. |
| serv-N16-resto | `r63-sn16r-blob-503-vuelve-al-tope` | El emulador responde 503 al borrar. Un documento con un representante de otro expediente sube el archivo y la fila no entra (`documento_sin_representante`). La página vuelve en 5.1 s, sin documento, y el registro `huerfano_sin_borrar` trae la clave con `causa: "tiempo_agotado"` (`datos/sexta-huerfanos.json`). |
| serv-N16-resto | `r64-sn16r-blob-sin_respuesta-vuelve-al-tope` | Lo mismo con un Blob que no responde: 5.1 s. Después, el borrado vuelve a la normalidad. |
| bar-2 | `r65-bar2-documento-vigencia-antes-de-emision` | Un poder de Ébano emitido el 1 de octubre y «Vigente hasta» el 30 de septiembre: `dato_invalido_vigenteHasta` con el campo marcado, sin documento nuevo y sin «La base no respondió». |
| base-N21 | `r66-baseN21-cobro-rfc-de-guiones` | Gil registra un cobro manual con el RFC « - - »: «Ese RFC no tiene la forma de un RFC. Déjalo vacío si no lo tienes.» en su campo, con lo demás capturado, y ningún cobro. |
| bar-1 | `r67-bar1-cobro-rfc-con-guion-registrado` | Con «EKU900317-3C9», el cobro queda registrado y la base guarda «EKU9003173C9» (antes, «La base no respondió»). |
| líder-N2 | `r68-lider2-cancelar-cobro-motivo-emoji` | Cancelar ese cobro con «ok 😀»: «Explica el motivo en al menos 5 caracteres» en el campo y el cobro sigue esperado. Con «ok 😀!» (5 caracteres) se cancela y la base guarda 5 caracteres. |
| bar-8 | `r69-bar8-xml-con-control-rechazado` | Un XML con «&#x9;» en la serie: «Al XML le faltan datos…» en el campo y ningún cobro (antes se guardaba). |
| bar-9 | `r70-bar9-cobro-xml-ampersand` | Un XML con «PEREZ &amp;&#x85; ASOCIADOS»: el cobro se registra, la base guarda «PEREZ & ASOCIADOS» (sin el control, serv-nuevo-1) y la lista lo muestra así. |
| líder-N2 | `r71-lider2-pago-excepcion-motivo-emoji` | Un pago por excepción con «Revisar 😀» (pasa el mínimo de 10 del navegador): «No se guardó» con el aviso del motivo en el campo y ningún pago. |
| líder-N2 | `r72-lider2-pago-excepcion-en-autorizacion` | Con «Pago 😀 ya!» (10 caracteres) queda en autorización y la base guarda 10 caracteres. |
| base-N23 | `r73-n23-representante-con-control` | Omar agrega a «Pedro\u000bRuiz Sol» como representante de Ébano: el aviso del carácter invisible (desde la octava revisión, sin recargar) con el campo marcado y ningún representante de más (antes se guardaba «PedroRuiz Sol»). |
| base-N23 | `r74-n23-socio-con-control` | El socio extranjero «Luis\u0085Gómez Paz» (Suecia, sin RFC ni CURP): el aviso del carácter invisible en su campo; el formulario conserva país, documento y fecha, y no hay socio de más. |
| base-N23 | `r75-n23-razon-social-expediente-con-control` | La razón social del expediente con U+0085: `invisible_razonSocial` (desde la octava revisión) en su campo y la guardada no cambia. |
| serv-nuevo-4 | `r76-sn4-giro-con-nel-guardado` | El giro «Distribución\u0085de abarrotes» se guarda «Distribución de abarrotes» (antes, «Distribuciónde abarrotes»). |
| P3 | `r77-p3-prospecto-razon-social-con-control` | Alta del prospecto con «Empresa\u0085Uno SA de CV»: «La razón social trae un carácter invisible, algo común al copiar y pegar. Escríbela de nuevo a mano.», con el campo marcado y sin empresa (antes, «No se pudo completar…» sin campo). |
| P3 | `r78-p3-prospecto-codigo-postal` | Con el código postal 17000: «Ese código postal no existe…», con el campo marcado. Ya pasaba en `main`: el alta solo marcaba el RFC, y ni eso con su código. |
| serv-nuevo-4 | `r79-sn4-cobro-con-control-vale-espacio` | Gil registra un cobro manual a «Comercializadora\u0085Uno» por «Servicio\u000bde la séptima revisión»: la base guarda «Comercializadora Uno» y «Servicio de la séptima revisión». |
| Regla 1 | `r80-regla1-cobro-rfc-con-tabulador` | El RFC «EKU900317\t3C9» se rechaza en su campo y no hay cobro (antes, normalizar borraba el tabulador y se aceptaba). |
| P3 | `r81-p3-area-con-control` | El área «Ventas\u0085Norte»: «El nombre del área trae un carácter invisible…» en su campo y ningún área (antes, «Escribe el nombre del área.»). |
| P3 bar-10 | `r82-p3-contrato-vigente-desde` | Contrato con «Vigente desde» 2026-02-30 (petición armada: se escribe una fecha válida y se cambia en la petición que sale): «Esa fecha de «Vigente desde» no existe…» y el campo marcado es «Vigente desde», no «Vigente hasta»; ningún documento. |
| P3 bar-10 | `r83-p3-excepcion-fecha-de-la-obligacion` | Pago por excepción con «Fecha de la obligación» 0000-01-01 (petición armada): el aviso marca esa fecha y no el vencimiento; ningún pago. |
| Aviso propio | `r84-r8-socio-caracter-invisible` | Omar agrega al socio mexicano «Juan\u0085Pérez López»: «El nombre trae un carácter invisible, algo común al copiar y pegar. Escríbelo de nuevo a mano.», con el nombre marcado y con el foco, lo capturado sigue ahí, la dirección va sin datos y no hay socio. Con «Ana​Ruiz Sol» (espacio de ancho cero, serv-nuevo-5), el mismo aviso. |
| Aviso propio | `r85-r8-socio-nombre-con-formato` | Un nombre en blanco, sin invisibles, conserva «Revisa el campo marcado: el dato no tiene el formato esperado.», con el nombre marcado y el foco. |
| P3 y serv-nuevo-5 | `r86-r8-representante-conserva-lo-capturado` | El representante «Pedro­Ruiz Sol» (guion suave): el aviso propio con el nombre marcado y el foco. El formulario vuelve sin recargar con RFC, CURP, cargo, PEP, quién lo designó y «Administra la empresa» (antes recargaba y lo perdía). Con la CURP «XX», el aviso de formato marca la CURP y lo demás sigue ahí. |
| P3 | `r87-r8-representante-agregado` | Corregido en el mismo formulario, doble clic en «Agregar representante»: un representante con todo lo capturado. |
| serv-nuevo-5 | `r88-r8-razon-social-caracter-invisible` | La razón social del expediente con U+FEFF: «La razón social trae un carácter invisible…», con el campo marcado y con el foco al volver la página; la guardada no cambia. |
| base-N25 | `r89-r8-documento-extranjero-con-tabulador` | El socio extranjero con el documento «X123\t4567»: el aviso del documento en su campo y ningún socio (antes se guardaba X1234567). |
| serv-nuevo-5 | `r90-r8-prospecto-razon-social-u2060` | El alta con «Empresa⁠Dos SA de CV» (unión de palabras): `razon_social_control`, con el campo marcado y con el foco, sin empresa. |
| base-N24 | `r91-r8-lista-con-tabulador` | Celia carga la Lista con un renglón «EVA\tRUIZ SOL»: «Revisa la línea 6…» y ninguna carga (antes se guardaba «EVA RUIZ SOL»). |
| serv-nuevo-5 | `r92-r8-folio-caracter-invisible` | Celia confirma la coincidencia de Brisa con un motivo que trae un emoji compuesto (👨‍👩‍👧, U+200D), y se guarda tal cual. El folio «UIF-2026-⁠0007»: «El folio trae un carácter invisible…», con el folio de esa coincidencia marcado y con el foco, y ningún folio guardado. |
| P3 | `r93-r8-contrato-vigente-hasta` | Contrato con «Vigente hasta» 2026-10-31 y «Vigente desde» 2026-11-01: «Revisa «Vigente hasta»: debe existir en el calendario y no puede ser anterior a «Vigente desde».», con «Vigente hasta» marcado y ningún documento (antes, el texto de la emisión y el vencimiento de un pago). |
| serv-nuevo-5 | `r94-r8-proveedor-razon-social-ufeff` | El alta de un proveedor con «Escuela﻿Kemper Urgate»: «La razón social trae un carácter invisible…» en su campo y ningún proveedor. |
| base-N26 | `r95-r9-representante-relleno-hangul` | Omar agrega al representante «Luis Rodrㅤíguez» (relleno hangul, que no es Cc ni Cf): «El nombre trae un carácter invisible…», con el nombre marcado y con el foco, y ningún representante de más (antes se guardaba y la Lista lo partía en «IGUEZ RODR»). |
| serv-nuevo-6d | `r96-r9-enviar-sin-giro-ni-domicilio` | Omar registra a Laboratorio Novena, abre la versión 1 y guarda los datos generales sin giro ni domicilio. «Enviar versión 1»: «Faltan datos generales para enviar la versión…» y «Faltan el giro y el domicilio. Captura esos datos en «Datos generales» y vuelve a enviar.», con `en=enviar-titulo`. La versión sigue en borrador y no hay evento `expediente_enviado` (antes, «La base no respondió…»). |
| serv-nuevo-6b | `r97-r9-folio-fecha-presentado-imposible` | Celia anota el folio de Brisa con «Presentado el» 2026-02-30 (petición armada): «Revisa la fecha de presentación del reporte…», con `en=presentado-<id>`. Solo «Presentado el» queda marcado y con el foco, no el folio, y no se guarda folio. La captura muestra el aviso y el campo juntos. |
| serv-nuevo-6b | `r98-r9-folio-fecha-aviso-imposible` | Lo mismo con «Aviso por escrito al cliente» 2026-13-01: «Revisa la fecha del aviso al cliente… Déjala vacía si aún no avisas.». Solo ese campo queda marcado y con el foco, y no se guarda folio. |
| base-N27 | `r99-r9-recuperacion-nota-en-su-tarjeta` | Hay tres recuperaciones pendientes: Gil, Rosa y Aurelio. Ofelia confirma su identidad y rechaza sin nota la de en medio, la de Rosa: `en` es el id de Rosa y solo su nota queda marcada y con el foco; las tres siguen pendientes. Con su nota, las tres se rechazan. |
| serv-nuevo-7 | `r100-r10-sin-js-entrada-operacion` | Sin JavaScript, la entrada de Operación con una contraseña equivocada: el POST lleva su `Origin` y responde 200 con «El correo o la contraseña no coinciden…». Antes, con `no-referrer`, llevaba `Origin: null` y daba 500. Con JavaScript, lo mismo. |
| Textos que no se ven | `r101-r10-giro-invisible-con-js` | Omar guarda los datos de Laboratorio Novena con el giro «\u3164» y el domicilio completo: el giro queda vacío. «Enviar versión 1»: «Falta el giro. Captura ese dato en «Datos generales» y vuelve a enviar.»; sigue en borrador y sin evento. |
| serv-nuevo-7 y textos que no se ven | `r102-r10-giro-invisible-sin-js` | Lo mismo sin JavaScript: guardar y enviar responden 303 con su `Origin` y el mismo aviso. |
| Textos que no se ven | `r103-r10-dictamen-motivo-invisible-con-js` | Celia observa el expediente de Cedro con «Revisar» y tres U+3164 (10 para la base, 7 que se ven): «El motivo lleva al menos 10 caracteres…» en el motivo marcado y ningún dictamen. |
| serv-nuevo-7 y textos que no se ven | `r104-r10-dictamen-motivo-invisible-sin-js` | Sin JavaScript, con doce U+3164: 303, «Escribe un motivo breve y claro.» en el motivo marcado y ningún dictamen. |
| base-N28 | `r105-r10-clave-repetida-en-la-direccion` | Con y sin JavaScript, el expediente y la ficha de Novena y Clientes con `?aviso=a&aviso=b&en=x&en=y` responden 200 con su página. Con `faltan=giro&faltan=domicilio`, queda el aviso general sin detalle. Antes, 500. |
| Campo de archivo y fragmento | `r106-r10-archivo-de-mas-de-4-mib-sin-js` | Sin JavaScript (sin la revisión del navegador), Omar sube a Novena un PDF de 4 MiB y 64 KiB: 303 a la dirección sin fragmento, «El archivo pasa de 4 MB. Sube uno más ligero.», el control del archivo marcado, ligado al aviso y con el foco; ningún documento. Captura de página completa: el aviso va arriba y el campo, en su sección. La barra superior lleva su fondo. |
| Campo de archivo | `r107-r10-archivo-no-admitido-con-js` | Con JavaScript, un «PDF» que no lo es: «Sube un PDF, PNG o JPG legible.», el control del archivo marcado y con el foco (antes, marcado sin foco). Página completa; la captura quita el foco antes de tomarla, como todas las del recorrido con JavaScript. |
| Desborde a 390 | `r108-r10-sha-a-390-ebano` | El expediente de Ébano a 390 con sus documentos: cada SHA-256 se parte dentro de su renglón y su orilla queda dentro de 390 (antes, la página medía 533). Con y sin JavaScript. |
| Desborde a 390 | `r109-r10-nombre-largo-a-390-novena` | El borrador de Laboratorio Novena con un acta de nombre de 136 caracteres sin espacios: el nombre se parte y queda dentro de 390, con y sin JavaScript. En el borrador, la lista muestra el nombre; el SHA-256 aparece en las versiones enviadas, como en Ébano. |
| P3 coincidencia | `r110-r11-coincidencia-motivo-con-js-1440` | Celia dictamina la coincidencia de Cedro con «Revisar 😀» en el motivo, con JavaScript: `en=motivo-<caso>`, sin fragmento; el motivo marcado y con el foco, y «El motivo lleva al menos 10 caracteres…» justo debajo; el aviso de arriba queda como resumen; el caso sigue abierto. |
| P3 coincidencia | `r111-r11-coincidencia-motivo-sin-js-390` | Lo mismo sin JavaScript, a 390. |
| Mensaje junto al campo | `r112-r11-documento-sin-js-390` | Sin JavaScript a 390, un «PDF» que no lo es en el borrador de Laboratorio Novena: «Sube un PDF, PNG o JPG legible.» justo debajo del control, que tiene el foco; ningún documento. |
| Mensaje junto al campo | `r113-r11-socio-capital-con-js-390` | Con JavaScript a 390, un capital «abc»: el mensaje justo debajo de Capital, que tiene el foco y conserva «abc». Antes, el aviso del formulario quedaba en −452, fuera de la vista. |
| P2 sin JavaScript | `r114-r11-representante-invisible-sin-js` | Sin JavaScript, «Agregar representante» con un U+200B en el nombre: 200 con su aviso, el nombre marcado y con el foco, su mensaje junto a él y todo lo capturado de vuelta. Antes volvía en blanco. |

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
Distribuidora Lumbre lista: expediente aprobado y revisión de riesgo vencida el 2026-10-09.

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
NOTA  f12-bitacora-lecturas-auditadas: la página mide 10123 px y no cabe en una captura completa; se guarda la ventana
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
NOTA  pantalla-bitacora-oscuro-1440: la página mide 10532 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-oscuro-390: la página mide 29444 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-claro-1440: la página mide 10532 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-claro-390: la página mide 29444 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-lever-1440: la página mide 10532 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-lever-390: la página mide 29444 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora lever 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
OK    pantalla sin-permiso lever 390: un h1, campos con etiqueta, sin desborde, consola limpia

— Contraste AA por texto
OK    contraste oscuro 1440: 381 textos, mínimo 5.08
OK    contraste oscuro 390: 162 textos, mínimo 6.23
OK    contraste claro 1440: 384 textos, mínimo 5.14
OK    contraste claro 390: 162 textos, mínimo 5.05
OK    contraste lever 1440: 387 textos, mínimo 5.00
OK    contraste lever 390: 162 textos, mínimo 5.91

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
OK    N11. tras el rechazo de la persona física extranjera, el formulario vuelve en «Extranjera» con el documento marcado y su texto
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
OK    N9. Originación ve solo el grado y la fecha de revisión, sin factores ni puntaje
OK    N9. Aprobación ve solo el grado y la fecha de revisión, sin factores ni puntaje
OK    N9. Cumplimiento ve el factor de listas con sus puntos
OK    N9. Auditoría ve el factor de listas con sus puntos
OK    N9. Administración no abre el expediente
OK    aviso «motivo_invalido» tras la acción
OK    N12. el motivo con error anuncia la pista y el aviso
OK    aviso «lpb_cargada» tras la acción
OK    N13. el detalle de la carga va en singular

— Quinta revisión: grado sin desglose con y sin caso, socio extranjero tras otro rechazo, motivo corto y arranque sin personal
OK    serv-N9 (con-caso). Originación ve solo el grado y la fecha de revisión; ni la página ni su respuesta RSC traen los factores
OK    serv-N9 (con-caso). Aprobación ve solo el grado y la fecha de revisión; ni la página ni su respuesta RSC traen los factores
OK    serv-N9 (con-caso). Cumplimiento ve el desglose completo
OK    serv-N9 (con-caso). Auditoría ve el desglose completo
OK    serv-N9 (con-caso). Administración no abre el expediente
OK    serv-N9 (sin-caso). Originación ve solo el grado y la fecha de revisión; ni la página ni su respuesta RSC traen los factores
OK    serv-N9 (sin-caso). Aprobación ve solo el grado y la fecha de revisión; ni la página ni su respuesta RSC traen los factores
OK    serv-N9 (sin-caso). Cumplimiento ve el desglose completo
OK    serv-N9 (sin-caso). Auditoría ve el desglose completo
OK    serv-N9 (sin-caso). Administración no abre el expediente
OK    serv-N15. rechazado el RFC opcional de la física extranjera (dato_invalido_rfc), vuelve en «Extranjera» con ese campo marcado y sin socio de más
OK    serv-N15. rechazado el capital de la moral extranjera (dato_invalido_capital), vuelve en «Extranjera» con ese campo marcado y sin socio de más
OK    serv-N17. con «Revisar» (7 caracteres) el navegador no envía la solicitud: el campo pide de 10 a 500
OK    aviso «motivo_corto» tras la acción
OK    serv-N17. sin el mínimo del navegador, el servidor rechaza el motivo corto con el aviso ligado al campo y no queda solicitud
OK    base-N15. la base del arranque tiene un operador y 0 personal, como Preview
OK    base-N15. primera corrida: las dos quedan invitadas, el correo no sale y sin --mostrar-enlace no hay enlace
OK    base-N15. segunda corrida con los mismos correos y --mostrar-enlace: un enlace nuevo por persona
OK    base-N15. las invitaciones de la primera corrida quedan revocadas y el personal sigue siendo el mismo
OK    base-N15. cada enlace (los de la primera corrida y los nuevos) queda en la bitácora con quién corrió el comando y la conexión
OK    base-N15. un correo distinto, solo o junto a los mismos, se rechaza y no emite nada
OK    base-N15. otra corrida con los mismos correos vuelve a emitir
OK    base-N15. el enlace que reemplazó la corrida siguiente ya no sirve
OK    base-N15. con el enlace nuevo, primera acepta y su Administración queda activa
OK    base-N15. con Administración activa, el comando ya no invita ni reenvía

— Sexta revisión: motivo con emoji, socio extranjero que conserva lo capturado y borrado con Blob caído
OK    serv-N18. «Revisar 😀» pasa el mínimo de 10 del navegador (cuenta unidades UTF-16)
OK    aviso «motivo_corto» tras la acción
OK    serv-N18. suspensión con «Revisar 😀»: «El motivo lleva al menos 10 caracteres» en el campo, no «La base no respondió», y no queda solicitud
OK    serv-N18. con un motivo de 10 o más caracteres (y su emoji) la solicitud entra
OK    sexta-N1. el motivo escrito con Enter entra y se guarda en un renglón
OK    serv-N18. Aprobaciones: el diálogo sigue abierto con «Revisar 😀», el aviso ligado al campo y el foco en él; la solicitud sigue pendiente
OK    aviso «decision_registrada» tras la acción
OK    serv-N18. corregido en el mismo diálogo, el rechazo queda con su motivo
OK    aviso «motivo_corto» tras la acción
OK    serv-N18. dictamen observado con «Revisar 😀»: «motivo_corto» en el campo y ningún dictamen
OK    aviso «motivo_corto» tras la acción
OK    serv-N18. caso de la Lista con «Revisar 😀»: «motivo_corto» y el caso sigue abierto
OK    serv-N15. el RFC «XX» de la física extranjera: vuelve con país, documento, fecha, nombre y porcentajes, el campo marcado y con el foco, sin datos en la dirección
OK    serv-N15. el nombre en blanco de la física extranjera: vuelve con país, documento, fecha, nombre y porcentajes, el campo marcado y con el foco, sin datos en la dirección
OK    serv-N15. el capital «abc» de la física extranjera: vuelve con país, documento, fecha, nombre y porcentajes, el campo marcado y con el foco, sin datos en la dirección
OK    serv-N15. el RFC «XX» de la moral extranjera: vuelve con país, documento, nombre y porcentajes, el campo marcado y con el foco, sin datos en la dirección
OK    serv-N15. el nombre en blanco de la moral extranjera: vuelve con país, documento, nombre y porcentajes, el campo marcado y con el foco, sin datos en la dirección
OK    serv-N15. el capital «abc» de la moral extranjera: vuelve con país, documento, nombre y porcentajes, el campo marcado y con el foco, sin datos en la dirección
OK    aviso «expediente_accionista_agregado» tras la acción
OK    serv-N15. corregido el capital en el mismo formulario, la moral extranjera entra y el formulario queda limpio
OK    emulador de Blob: borrado «503»
OK    aviso «documento_sin_representante» tras la acción
OK    emulador de Blob: borrado «normal»
OK    serv-N16. Blob responde 503 al borrar el huérfano: la página vuelve en 5.1 s (tope de 5 s más la página), sin documento, y la clave queda en el registro
OK    emulador de Blob: borrado «sin_respuesta»
OK    aviso «documento_sin_representante» tras la acción
OK    emulador de Blob: borrado «normal»
OK    serv-N16. Blob no responde al borrar el huérfano: la página vuelve en 5.1 s (tope de 5 s más la página), sin documento, y la clave queda en el registro
OK    aviso «dato_invalido_vigenteHasta» tras la acción
OK    bar-2. «Vigente hasta» 30 sep antes de «Emitido el» 1 oct: el campo queda marcado, sin documento nuevo y sin «La base no respondió»
OK    base-N21. cobro manual con el RFC « - - »: «Ese RFC no tiene la forma de un RFC» en su campo y sin cobro
OK    bar-1. cobro manual con el RFC «EKU900317-3C9»: queda registrado con «EKU9003173C9» (antes, «La base no respondió»)
OK    líder-N2. cancelar con «ok 😀»: «Explica el motivo en al menos 5 caracteres» en el campo y el cobro sigue esperado
OK    líder-N2. con «ok 😀!» (5 caracteres) el cobro se cancela y la base guarda 5 caracteres
OK    bar-8. XML con «&#x9;» en la serie: «Al XML le faltan datos» en el campo, sin cobro (antes se guardaba «&#x9;» literal)
OK    bar-9. XML con «PEREZ &amp;&#x85; ASOCIADOS»: el cobro se registra y la base guarda «PEREZ & ASOCIADOS» (sin el control)
OK    bar-9. la lista de cobros muestra «PEREZ & ASOCIADOS»
OK    líder-N2. hay un proveedor para el pago por excepción
OK    líder-N2. «Revisar 😀» pasa el mínimo de 10 del navegador
OK    líder-N2. pago por excepción con «Revisar 😀»: «No se guardó» con el aviso del motivo, sin pago (antes, el CHECK lo rechazaba con un error genérico)
OK    líder-N2. con «Pago 😀 ya!» (10 caracteres) queda en autorización y la base guarda 10 caracteres

— Séptima revisión: identidades con un control, textos libres con espacio y avisos en su campo
OK    base-N23. el representante «Pedro\u000bRuiz Sol» se rechaza en su campo y no se guarda (antes, «PedroRuiz Sol»)
OK    base-N23. el socio extranjero «Luis\u0085Gómez Paz» se rechaza en su campo, sin socio de más y con lo capturado
OK    aviso «invisible_razonSocial» tras la acción
OK    base-N23. la razón social del expediente con U+0085 se rechaza en su campo y no cambia
OK    aviso «expediente_datos_guardados» tras la acción
OK    serv-nuevo-4. el giro «Distribución\u0085de abarrotes» se guarda «Distribución de abarrotes»
OK    aviso «razon_social_control» tras la acción
OK    P3. la razón social del alta con U+0085: «trae un carácter invisible», con el campo marcado y sin empresa
OK    aviso «codigo_postal_invalido» tras la acción
OK    P3. el código postal 17000 del alta: su aviso, con el campo marcado y sin empresa
OK    serv-nuevo-4. cobro con «Comercializadora\u0085Uno» y «Servicio\u000bde la séptima revisión»: se guardan con espacio
OK    regla 1. el RFC «EKU900317\t3C9» del cobro se rechaza en su campo y no hay cobro (antes, el tabulador se borraba)
OK    P3. el área «Ventas\u0085Norte»: «trae un carácter invisible» en su campo y sin área
OK    P3 bar-10. contrato con «Vigente desde» 2026-02-30: el aviso marca «Vigente desde» y no hay documento
OK    P3 bar-10. excepción con «Fecha de la obligación» 0000-01-01: el aviso marca esa fecha, no el vencimiento, y no hay pago

— Octava revisión: caracteres invisibles con su propio aviso, representante que conserva lo capturado, Lista y documento extranjero
OK    aviso propio. el socio «Juan\u0085Pérez López»: «El nombre trae un carácter invisible…», nombre marcado y con el foco, sin socio
OK    serv-nuevo-5. el socio «Ana\u200bRuiz Sol» (espacio de ancho cero): el mismo aviso y sin socio
OK    aviso propio. un nombre en blanco, sin invisibles, conserva «Revisa el campo marcado: el dato no tiene el formato esperado.»
OK    P3 y serv-nuevo-5. el representante «Pedro\u00adRuiz Sol» (guion suave): aviso propio, nombre marcado y con el foco, y vuelve con RFC, CURP, cargo, PEP, quién lo designó y «Administra»
OK    P3. con la CURP «XX» el aviso de formato marca la CURP y todo lo demás sigue capturado
OK    aviso «expediente_representante_agregado» tras la acción
OK    P3. corregido en el mismo formulario, doble clic en «Agregar representante» = un representante con todo lo capturado
OK    aviso «invisible_razonSocial» tras la acción
OK    serv-nuevo-5. la razón social del expediente con U+FEFF: aviso propio, campo marcado y con el foco, y no cambia
OK    base-N25. el documento extranjero «X123\t4567» se rechaza en su campo; no se guarda X1234567
OK    aviso «razon_social_control» tras la acción
OK    serv-nuevo-5. la razón social del alta con U+2060: su aviso, campo marcado y con el foco, sin empresa
OK    aviso «lpb_renglon_invalido» tras la acción
OK    base-N24. la Lista con «EVA\tRUIZ SOL» se rechaza en la línea 6 y no deja carga (antes se guardaba «EVA RUIZ SOL»)
OK    octava. hay una coincidencia pendiente para confirmar y anotar su folio
OK    aviso «coincidencia_resuelta» tras la acción
OK    serv-nuevo-5. el motivo con un emoji compuesto (U+200D) se guarda tal cual: los textos libres no cambian
OK    aviso «invisible_folio» tras la acción
OK    serv-nuevo-5. el folio «UIF-2026-\u20600007»: aviso propio, el folio de esa coincidencia marcado y con el foco, sin folio guardado
OK    P3. el contrato con «Vigente hasta» antes de «Vigente desde»: su propio aviso (no el de la emisión del pago), «Vigente hasta» marcado y sin documento
OK    serv-nuevo-5. el alta del proveedor con U+FEFF en la razón social: su aviso, campo marcado y sin proveedor

— Novena revisión: invisibles de Unicode, recuperación en su tarjeta, fechas del folio y envío sin datos generales
OK    base-N26. el representante «Luis Rodr\u3164íguez» (relleno hangul): aviso propio, nombre marcado y con el foco, sin representante
OK    aviso «prospecto_registrado» tras la acción
OK    aviso «expediente_version_creada» tras la acción
OK    aviso «expediente_datos_guardados» tras la acción
OK    aviso «expediente_datos_incompletos» tras la acción
OK    serv-nuevo-6d. enviar sin giro ni domicilio: «Faltan el giro y el domicilio…», la versión sigue en borrador y sin evento «expediente_enviado»
OK    novena. hay una coincidencia confirmada sin folio para anotarlo
OK    aviso «dato_invalido_presentadoEl» tras la acción
OK    serv-nuevo-6b. «Presentado el» 2026-02-30: su aviso, solo ese campo marcado y con el foco (no el folio), sin folio guardado
OK    serv-nuevo-6b. la captura muestra el aviso y «presentado» marcado
OK    aviso «dato_invalido_avisoClienteEl» tras la acción
OK    serv-nuevo-6b. «Aviso al cliente» 2026-13-01: su aviso, solo ese campo marcado y con el foco (no el folio), sin folio guardado
OK    serv-nuevo-6b. la captura muestra el aviso y «aviso» marcado
OK    base-N27. tres recuperaciones pendientes en la bandeja
OK    aviso «motivo_invalido» tras la acción
OK    base-N27. rechazar sin nota la recuperación de en medio: «en» es su id y solo su nota queda marcada y con el foco; las tres siguen pendientes
OK    base-N27. la captura muestra el aviso y la nota marcada de la tarjeta de en medio
OK    aviso «decision_registrada» tras la acción
OK    aviso «decision_registrada» tras la acción
OK    aviso «decision_registrada» tras la acción
OK    base-N27. con su nota, las tres se rechazan: ninguna queda abierta

— Décima revisión: sin JavaScript, claves repetidas en la dirección, textos que no se ven y valores largos a 390
OK    serv-nuevo-7. con JavaScript, la entrada de Operación con la contraseña equivocada: 200, su Origin y su aviso
OK    serv-nuevo-7. sin JavaScript, la entrada de Operación con la contraseña equivocada: 200, su Origin y su aviso
OK    textos invisibles. con JavaScript, el giro «\u3164» se guarda vacío y «Enviar versión 1» dice «Falta el giro.»; sigue en borrador y sin evento
OK    textos invisibles. sin JavaScript, el giro «\u3164» se guarda vacío y «Enviar versión 1» dice «Falta el giro.»; sigue en borrador y sin evento
OK    textos invisibles. con JavaScript, el dictamen observado con «Revisar» y tres U+3164 (10 para la base, 7 que se ven): motivo_corto en el motivo y sin dictamen
OK    textos invisibles. sin JavaScript, el dictamen observado con doce U+3164: motivo_invalido en el motivo y sin dictamen
OK    base-N28. con JavaScript, /operacion/clientes/<novena>/expediente?aviso=a&aviso=b&en=x&en=y responde 200 con su página
OK    base-N28. con JavaScript, /operacion/clientes?aviso=a&aviso=b responde 200 con su página
OK    base-N28. con JavaScript, /operacion/clientes/<novena>?aviso=a&aviso=b responde 200 con su página
OK    base-N28. con JavaScript, /operacion/clientes/<novena>/expediente?aviso=expediente_datos_incompletos&faltan=giro&faltan=domicilio responde 200 con su página
OK    base-N28. con JavaScript, con «faltan» repetido queda el aviso general, sin detalle
OK    base-N28. sin JavaScript, /operacion/clientes/<novena>/expediente?aviso=a&aviso=b&en=x&en=y responde 200 con su página
OK    base-N28. sin JavaScript, /operacion/clientes?aviso=a&aviso=b responde 200 con su página
OK    base-N28. sin JavaScript, /operacion/clientes/<novena>?aviso=a&aviso=b responde 200 con su página
OK    base-N28. sin JavaScript, /operacion/clientes/<novena>/expediente?aviso=expediente_datos_incompletos&faltan=giro&faltan=domicilio responde 200 con su página
OK    base-N28. sin JavaScript, con «faltan» repetido queda el aviso general, sin detalle
OK    campo de archivo. sin JavaScript, archivo_demasiado_grande: aviso, el control del archivo marcado, ligado al aviso y con el foco; ningún documento
OK    campo de archivo. con JavaScript, archivo_no_admitido: aviso, el control del archivo marcado, ligado al aviso y con el foco; ningún documento
OK    aviso «expediente_documento_cargado» tras la acción
OK    desborde. con JavaScript, en el expediente de Ébano (7 SHA-256) la orilla de los SHA-256 y los nombres de archivo llega a 349 px de 390 (antes, 533)
OK    desborde. con JavaScript, en el expediente de Laboratorio Novena (el nombre de archivo de 136 caracteres) la orilla de los SHA-256 y los nombres de archivo llega a 349 px de 390 (antes, 533)
OK    desborde. sin JavaScript, en el expediente de Ébano (7 SHA-256) la orilla de los SHA-256 y los nombres de archivo llega a 349 px de 390 (antes, 533)
OK    desborde. sin JavaScript, en el expediente de Laboratorio Novena (el nombre de archivo de 136 caracteres) la orilla de los SHA-256 y los nombres de archivo llega a 349 px de 390 (antes, 533)

— Onceava revisión: el mensaje del error junto al campo, los formularios del expediente sin JavaScript y el motivo de la coincidencia
OK    P3 coincidencia. con JavaScript a 1440, «Revisar 😀» en el motivo: en=motivo-<caso>, el campo marcado y con el foco, y el mensaje junto a él a la vista; el caso sigue abierto
OK    P3 coincidencia. sin JavaScript a 390, «Revisar 😀» en el motivo: en=motivo-<caso>, el campo marcado y con el foco, y el mensaje junto a él a la vista; el caso sigue abierto
OK    mensaje junto al campo. sin JavaScript a 390, un «PDF» que no lo es: «Sube un PDF, PNG o JPG legible.» justo debajo del control, que tiene el foco; el aviso de arriba queda como resumen; ningún documento
OK    mensaje junto al campo. con JavaScript a 390, el capital «abc» del socio: el mensaje justo debajo de Capital, que tiene el foco y conserva lo capturado; ningún socio
OK    P2 sin JavaScript. «Agregar representante» con un U+200B en el nombre: 200 con su aviso, el nombre marcado, con el foco y su mensaje junto a él, y todo lo capturado de vuelta; ningún representante
OK    onceava revisión: en los 71 avisos de las regresiones nunca hubo dos campos marcados; 43 campos marcados, cada uno con su mensaje único junto a él
OK    consola del navegador limpia en las regresiones

215 comprobaciones en verde, 0 en rojo.
```

</details>

<details>
<summary>Comando de arranque de la quinta revisión (base con un operador y 0 personal; el enlace se omite)</summary>

```text
$ OPERADORES_PLATAFORMA=primera@lever.test,segunda@lever.test tsx scripts/plataforma.ts personal:migrar-variable --quien-corre evidencia@lever.test
primera@lever.test: invitada
  La invitación a primera@lever.test quedó emitida y el correo no salió (correo_no_configurado). Vence 2026-11-12T22:51:46.934Z.
segunda@lever.test: invitada
  La invitación a segunda@lever.test quedó emitida y el correo no salió (correo_no_configurado). Vence 2026-11-12T22:51:46.940Z.
Cuando cada persona acepte, borra OPERADORES_PLATAFORMA de las variables del proyecto.
(salida 0)

$ OPERADORES_PLATAFORMA=primera@lever.test,segunda@lever.test tsx scripts/plataforma.ts personal:migrar-variable --quien-corre evidencia@lever.test --mostrar-enlace
primera@lever.test: invitación nueva; el enlace anterior ya no sirve
  La invitación a primera@lever.test quedó emitida y el correo no salió (correo_no_configurado). Vence 2026-11-12T22:51:47.071Z.
  Entrega este enlace solo a esa persona: <enlace omitido>
segunda@lever.test: invitación nueva; el enlace anterior ya no sirve
  La invitación a segunda@lever.test quedó emitida y el correo no salió (correo_no_configurado). Vence 2026-11-12T22:51:47.074Z.
  Entrega este enlace solo a esa persona: <enlace omitido>
Cuando cada persona acepte, borra OPERADORES_PLATAFORMA de las variables del proyecto.
(salida 0)

$ OPERADORES_PLATAFORMA=tercera@lever.test tsx scripts/plataforma.ts personal:migrar-variable --quien-corre evidencia@lever.test --mostrar-enlace
No se hizo: El operador ya tiene Administración invitada con otros correos. Para un enlace nuevo, corre el comando con los mismos correos de la primera vez.
(salida 1)

$ OPERADORES_PLATAFORMA=primera@lever.test,tercera@lever.test tsx scripts/plataforma.ts personal:migrar-variable --quien-corre evidencia@lever.test --mostrar-enlace
No se hizo: El operador ya tiene Administración invitada con otros correos. Para un enlace nuevo, corre el comando con los mismos correos de la primera vez.
(salida 1)

$ OPERADORES_PLATAFORMA=primera@lever.test,segunda@lever.test tsx scripts/plataforma.ts personal:migrar-variable --quien-corre evidencia@lever.test --mostrar-enlace
primera@lever.test: invitación nueva; el enlace anterior ya no sirve
  La invitación a primera@lever.test quedó emitida y el correo no salió (correo_no_configurado). Vence 2026-11-12T22:51:47.553Z.
  Entrega este enlace solo a esa persona: <enlace omitido>
segunda@lever.test: invitación nueva; el enlace anterior ya no sirve
  La invitación a segunda@lever.test quedó emitida y el correo no salió (correo_no_configurado). Vence 2026-11-12T22:51:47.557Z.
  Entrega este enlace solo a esa persona: <enlace omitido>
Cuando cada persona acepte, borra OPERADORES_PLATAFORMA de las variables del proyecto.
(salida 0)

$ OPERADORES_PLATAFORMA=primera@lever.test,segunda@lever.test tsx scripts/plataforma.ts personal:migrar-variable --quien-corre evidencia@lever.test --mostrar-enlace
No se hizo: El operador ya tiene Administración del personal activa. Las demás personas se invitan desde la pantalla Personal.
(salida 1)
```

</details>
