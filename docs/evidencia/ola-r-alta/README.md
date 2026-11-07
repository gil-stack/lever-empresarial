# Evidencia de la Ola R1: alta regulada de empresas

Recorrido con clics reales de Playwright headless (`scripts/evidencia/ola-r-alta.mjs`) contra `next build` + `next start`, sobre una base recién migrada (0001-0028) y sembrada. Cada envío se hace con doble clic y la base confirma que quedó una sola operación.

| Fase | Resultado | Datos |
| --- | --- | --- |
| Flujos 0-12 | 145 comprobaciones en verde, 0 en rojo, consola del navegador limpia | `datos/resultados-flujos.json` |
| Pantallas (3 temas × 1440/390) y contraste AA medido | 60 comprobaciones en verde, 0 en rojo; contraste mínimo 5.00 (Lever 1440) | `datos/resultados-pantallas-contraste.json` |

Corrida del 2026-11-07 sobre el head de este PR, con el código de la consola suspendida en solo lectura veraz (R1-P5) y el comando de roles iniciales.

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
7. `BASE=http://localhost:4811 FASES=flujos node scripts/evidencia/ola-r-alta.mjs` y después `FASES=pantallas,contraste` sobre la misma base. La fase `lumbre` de `preparar.ts` la llama el flujo 1.

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
- Hasta 50,000 renglones. Un renglón inválido rechaza el archivo completo y la pantalla dice qué línea revisar; no queda carga.
- Al cargar se cotejan todas las empresas del operador: la empresa, sus representantes, accionistas y propietarios reales del expediente vigente, y sus proveedores.
- RFC o CURP idéntico es **coincidencia**. El mismo nombre normalizado (sin acentos, mayúsculas, puntuación ni orden de palabras) es **posible coincidencia**, que revisa Cumplimiento y nunca se descarta sola. Los EFOS definitivos de la Lista 69-B también cuentan como coincidencia.

Ejemplo (el del flujo 5):

```csv
nombre,rfc,curp,tipo,fecha
Mariana Ébano Ruiz,EARM750404AB5,,fisica,2026-11-02
HECTOR LOZANO DIAZ,,,fisica,2026-11-02
Comercializadora Sin Relación SA de CV,CSR010101AB1,,moral,2026-11-02
```

## Conservación de 10 años (61ª)

- **Base.** Las tablas del expediente (versiones, documentos, representantes, accionistas, propietarios reales y dictámenes), las calificaciones de riesgo, las cargas y personas de la lista, las coincidencias y las suspensiones no admiten DELETE ni TRUNCATE: el trigger `conservacion_no_se_borra` (0028) los rechaza aun para la dueña de las tablas. Una versión enviada, un documento o un dictamen no se reescriben, y la bitácora (`audit_log`) solo acepta inserciones.
- **Archivos.** Los documentos del expediente van a Blob privado con su SHA-256 y la aplicación nunca los borra. La prueba Postgres lo exige (`almacen.borrados` vacío) y el flujo 12 compara la SHA-256 del archivo descargado con la guardada.
- **Lo que el código no cubre.** Los respaldos de Neon y de Blob no son un archivo de 10 años, ni sobreviven a cerrar la cuenta. Falta definir y operar una exportación periódica (base y documentos) con su verificación. Dueño: Gil con el oficial de cumplimiento.

## Comando de roles iniciales

```sh
DATABASE_URL_UNPOOLED=<conexión directa de las migraciones> \
  npx tsx scripts/plataforma.ts personal:rol --correo <correo> --rol <rol> --motivo "<motivo>" [--quitar]
```

Sirve cuando nadie más del personal administra al personal: nadie se da un rol a sí mismo por pantalla. La función `personal_rol_por_comando` (0028) solo la ejecuta la dueña de la base; la aplicación no puede llamarla con ningún rol. Deja el evento `rol_personal_asignado` o `rol_personal_retirado` en la bitácora, como acto del sistema con origen `comando` y el motivo escrito. Respeta la 50ª, no deja al personal sin administración y, si otra persona ya administra al personal, pide usar la pantalla Personal. El flujo 0 lo corre como se hará tras el despliegue.

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
| 9. | `21-f9-aceptar-invitacion-empresa-suspendida` | Iván no puede aceptar: la invitación sigue sin usar y no hay membresía activa; la pantalla dice que la empresa está suspendida. Además, como rol cliente directo en la base, liberar, preparar lote y editar un proveedor se rechazan con `empresa_suspendida`. |
| 9. | `22` a `27-f9-consola-aviso-suspendida-<tema>-<ancho>` | El aviso de empresa suspendida en Oscuro, Claro y Lever, a 1440 y 390. |
| 10. Reactivar | `28-f10-reactivacion-bloqueada-por-lpb` | Suspendida por la lista y con coincidencia confirmada, no se pide la reactivación: 0 solicitudes. |
| 10. | `29-f10-reactivacion-aprobada` | Doble clic = 1 solicitud; otra persona aprueba; el historial guarda suspender y reactivar; la nómina se prepara otra vez (1 lote). |
| 11. Proveedor en la lista | `30-f11-lpb-segunda-carga` | La carga nueva se guarda aparte; la contraparte coincide sin suspender a la empresa; el falso positivo no se reabre. |
| 11. | `31-f11-pago-bloqueado-proveedor-en-lista` | Doble clic en «Autorizar para pagar»: el pago sigue `por_autorizar`; el mensaje no revela la lista. |
| 12. Lectura auditada | `32-f12-bitacora-lecturas-auditadas` | Abrir el expediente deja `expediente_consultado`; descargar deja `expediente_documento_descargado` y la SHA-256 coincide. |
| 12. | `33-f12-sin-permiso-personal` | Auditoría ve «Sin permiso» en Personal. |

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
OK    9. Iván no puede aceptar su invitación: la base lo rechaza y la pantalla dice que la empresa está suspendida
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
NOTA  f12-bitacora-lecturas-auditadas: la página mide 10797 px y no cabe en una captura completa; se guarda la ventana
OK    12. Auditoría ve «Sin permiso» en Personal
OK    consola del navegador limpia en todos los flujos

145 comprobaciones en verde, 0 en rojo.
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
NOTA  pantalla-bitacora-oscuro-1440: la página mide 11323 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora oscuro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-oscuro-390: la página mide 28226 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora oscuro 390: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-claro-1440: la página mide 11323 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora claro 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-claro-390: la página mide 28226 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora claro 390: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-lever-1440: la página mide 11323 px y no cabe en una captura completa; se guarda la ventana
OK    pantalla bitacora lever 1440: un h1, campos con etiqueta, sin desborde, consola limpia
NOTA  pantalla-bitacora-lever-390: la página mide 28226 px y no cabe en una captura completa; se guarda la ventana
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
