# Migraciones de la fase 1

La fase 1 deja en Neon el cimiento de identidad: la cuenta de una razón social, la persona, la sesión mínima del alta, la membresía y la auditoría de ese alta. Esas migraciones no se reescriben. La fase 2 agrega el maestro, la política, los cajones y el precio, en archivos posteriores a `0006`. El dinero que se mueve y el SPEI quedan para migraciones posteriores.

El servidor de la aplicación lee solo `DATABASE_URL`. Ese valor es el connection string agrupado. El proceso del servidor no migra al arrancar: no hay hook de boot, ni `postinstall`, ni ruta que llame a `db/migrate.sh`.

## Comando

Las migraciones usan el connection string directo, en un comando que se corre a mano:

```bash
export DATABASE_URL_UNPOOLED
./db/migrate.sh
```

`DATABASE_URL_UNPOOLED` es el string directo de la base `plataforma`: el host no lleva `-pooler` y la URL no pide PgBouncer. El script rechaza el string agrupado y no lee `DATABASE_URL`, para no migrar por el pooler ni arrastrar el libro que usa el servidor. El valor se exporta en el entorno de quien opera. No se escribe en el repositorio, ni en la línea que queda en un log, ni en este archivo. Si `psql` falla, la salida se redacta antes de mostrarse.

El script aplica `db/migrations/` en orden numérico, dentro de una transacción, y anota cada archivo en `schema_migrations`. Volver a correrlo no repite una versión ya aplicada. Hace falta `psql` en el PATH.

En Vercel, `DATABASE_URL` es el string agrupado que lee el servidor. `DATABASE_URL_UNPOOLED` es el directo y solo lo usa este comando. Este corte no lo agrega a production ni migra ese libro. Cada rama de Neon se migra con su propio directo, a mano. Los valores se quedan en Vercel y no en el repositorio.

## Tablas

Coinciden con el contrato de la sesión. Los nombres no se renombran.

| Tabla | Columnas |
| --- | --- |
| `users` | `id` uuid, `nombre` text, `correo` text único, `password_hash` text |
| `sessions` | `id` uuid, `user_id` uuid, `token_hash` text único, `expires_at` timestamptz |
| `companies` | `id` uuid, `rfc` text único, `razon_social` text, `codigo_postal` text, `regimen` text, `uso_cfdi` text, `alta_at` timestamptz |
| `memberships` | `user_id` uuid, `company_id` uuid, `rol` text, primaria (`user_id`, `company_id`) y única en `user_id` |

La cuenta es la fila de `companies`. Tiene un solo RFC, de 12 caracteres (persona moral) o 13 (persona física), con el patrón `t_RFC` del SAT. El mismo RFC no puede repetirse en la plataforma. El RFC no se actualiza: un segundo RFC no cabe en la misma cuenta. `memberships_una_persona_una_empresa` impide una segunda empresa para la misma persona. No existe `grupo_id`. El código postal son cinco dígitos guardados como texto, para no perder el cero.

`password_hash` solo acepta un hash bcrypt. `token_hash` es el SHA-256 en hexadecimal del token de la cookie. La cookie no se guarda.

`rol` es `administrador`, `solicitante`, `liberador`, `tarjetahabiente` o `contador`. El alta del fundador usa `administrador`.

## Maestro de personas

`0007_maestro_personas.sql` agrega `cost_centers` y `employees`. La CLABE se guarda completa y solo si `clabe_digito_371` cierra con la ponderación 3, 7 y 1. La baja es una fecha. Esta migración no crea dispersión, SPEI ni tarjeta. El alta del centro y de la persona, y la baja, escriben en `audit_events` dentro de la misma transacción.

## Política y cajones

`0008_politica_categorias_cajones.sql` agrega la política de la fase 2. No reescribe las tablas de la fase 1. El servidor sigue sin migrar al arrancar.

| Tabla | Qué guarda |
| --- | --- |
| `policies` | Una por empresa. `dias_comprobante` y `max_vencidos` nacen en 5. `umbral_proveedores_centavos` nace vacío |
| `policy_persons` | Plazo propio de una persona del maestro, aunque no entre a la consola. Si no hay fila, usa el plazo de la empresa |
| `policy_categories` | Nombre y `tope_centavos`. El tope nace vacío. No se siembran categorías |
| `drawers` | Los cuatro códigos `viaticos`, `proveedores`, `impuestos`, `nomina`, con su nombre. No hay columna de saldo |
| `postings` | Centavos con signo, motivo y hora. `drawer_id` vacío es «sin cajón». Esta migración no inserta filas |

Al insertar una empresa, la misma transacción siembra la política y los cuatro cajones. El saldo que muestra la consola es `sum(postings.centavos)` por cajón. Con la tabla vacía esa suma es cero porque no hay filas: no hay un `CHECK` que imponga el cero, ni un asiento sembrado. No hay un monto de ejemplo en el umbral, en un tope ni en un asiento. Desde estas tablas no sale un SPEI.

`0011_firmas_plazo_baja.sql` crea `lotes_prueba`. Las dos firmas son dos usuarios y dos actos, y el `CHECK` rechaza el mismo uuid en las dos columnas. También deja el plazo propio en la persona del maestro y, si la baja ya es efectiva, quita el rol de liberador.

## Auditoría del alta

`registrarEvento(evento, consulta)` inserta en la misma transacción del alta. `consulta.query(sql, params)` ejecuta:

```sql
insert into audit_events (
  id,
  company_id,
  actor_id,
  accion,
  entidad,
  identificador,
  ocurrido_en
) values ($1, $2, $3, $4, $5, $6, $7)
```

Los parámetros salen del evento: un id nuevo, `companyId`, `actorId`, `alta_empresa`, `companies`, `identificador` y `ocurridoEn`. No hay columna de cuerpo, así que la fila no tiene sitio para un secreto ni para un PAN.

Abrir la cuenta confirma a la persona y su sesión en su propia transacción (`users` y `sessions`), antes de la empresa. Si esa persona se acaba de crear y el alta de la empresa no se guarda, el alta borra la cuenta y no deja la cookie: un RFC que ya es de otra cuenta no deja sesión ni persona sin empresa. Quien ya tenía empresa y repite el alta conserva la sesión. La transacción de la empresa es la fila, la membresía y después `registrarEvento`. `actor_id` apunta a la persona, y `company_id` a la empresa recién insertada.

La base confirma la empresa solo si esa fila existe en la misma transacción. `audit_events` rechaza `UPDATE`, `DELETE` y `TRUNCATE`. `company_id` puede ir vacío en un acto del operador de la plataforma; en el alta va la empresa recién creada.

## Rama de Neon para preview

La rama `main` del proyecto Neon `royal-heart-90586962` (base `plataforma`, región `aws-us-east-1`) es el libro de production. Una vista previa que apunte al mismo string lo escribe. Preview usa otra rama del mismo proyecto, con su propio cómputo.

Con el CLI de Neon ya autenticado (`neon auth`, el token no se guarda aquí):

```bash
./db/preview-branch.sh
```

El script crea la rama `preview` hija de `main` si todavía no existe. No imprime connection strings. Si la rama ya está, no crea otra ni la reinicia.

En la consola de Neon el mismo resultado es: proyecto `plataforma-administrativa`, rama hija de `main`, nombre `preview`.

Después, en Vercel, solo en el entorno preview:

- `DATABASE_URL` queda en el string agrupado de la rama `preview`.
- `DATABASE_URL_UNPOOLED` queda en el string directo de la rama `preview`, base `plataforma`.

Production conserva el string de la rama `main`. Este corte no migra ese libro. Development no debe apuntar a `main`: si va a escribir, necesita su propia rama y su propio directo. Hoy ese directo no está en development y no se inventa aquí.

El comando de migrar se corre una vez por rama, con el `DATABASE_URL_UNPOOLED` de esa rama. Migrar `preview` no toca `main`. El servidor no lo hace al desplegar.

## Fase 2. Precios y suscripción

`0009_platform_pricing.sql` crea una sola fila. `suscripcion_centavos` queda vacío: la cifra no está publicada y el archivo no siembra un monto. Publicar escribe los centavos una vez. La fila no se borra y el monto publicado no se reescribe.

`0010_subscriptions.sql` abre una suscripción por empresa, en `recorrido`, con `recorrido_inicio` en la hora de alta. Los treinta días se cuentan desde esa hora; no hay una segunda columna. El alta de una empresa nueva inserta la fila en la misma transacción. Pasar a `aceptada` exige que `platform_pricing.suscripcion_centavos` ya no sea vacío. Si lo está, la base rechaza el cambio.

La página `/precios` y la consola leen esa única fila. Quien publica el monto y registra la aceptación es el personal del operador, en `platform_staff` con rol `administracion_plataforma`. `OPERADORES_PLATAFORMA` ya no abre nada: solo la lee el comando `personal:migrar-variable`, que invita a esos correos. Hasta correr ese comando, no hay personal.

## Fase 3. Proveedores, listado 69-B y CLABE

Dos piezas nacieron las dos como `0012`. Quedan en orden, y no se pierde ninguna tabla. El servidor no las aplica al arrancar. Este corte no migra el libro de production.

| Archivo | Tablas |
| --- | --- |
| `0012_proveedores.sql` | `documents` y `suppliers`. Única por empresa y RFC. `boton_pago` solo si había archivo y el RFC no aparecía |
| `0013_lista_69b.sql` | `lista_69b_snapshots` y `lista_69b_rows`. Archivo público, sin `company_id`. Una copia nueva no borra la anterior |
| `0014_clabes_proveedor.sql` | `supplier_clabes`. Era la otra `0012`. 18 dígitos con el dígito 3, 7 y 1. Cambiar agrega una fila. También enlaza `suppliers.snapshot_id` con el listado |

La constancia es un PDF en el almacén privado. La clave no es una URL y no baja al navegador. La consulta del 69-B usa la copia más reciente, y si dos copias comparten hora manda también el id. Si no hay copia, no hay pago. Si el RFC está en la copia, el proveedor puede existir y el pago no. No hay envío de dinero.

`0015_releer_69b_y_clabe.sql` no crea tablas de dinero. Una copia nueva vuelve a leer a los proveedores ya guardados: si el RFC entra, la ficha deja la situación publicada y `boton_pago` queda en falso. Quien se dio de alta sin archivo sigue sin pago si esa copia no lo trae. La CLABE exige el proveedor de la misma empresa. Cerrar la única vigente, sin dejar otra abierta en la misma transacción, no pasa. El hash de la constancia no se reescribe. Este corte sigue sin migrar el libro de production.

## Fase 4. Tenencia, invitaciones y autenticación fuerte

`0016_tenencia.sql`, `0017_bitacora.sql` y `0018_rls.sql` cambian el libro. `0019_autenticacion_fuerte.sql` agrega la entrada de minutos, las passkeys, el TOTP, los códigos de respaldo y la solicitud de factor perdido. `0020_cierre_fase4.sql` obliga la seguridad de filas, crea el rol con el que entra la aplicación y la recuperación de contraseña.

La aplicación no conecta como dueña de las tablas. `DATABASE_URL` es el rol `plataforma_app`: no es dueño, no tiene `BYPASSRLS` y en cada transacción baja a `plataforma_cliente` o `plataforma_sofipo`. Quien migra sigue siendo el único dueño. Este corte no migra el libro de production.

La contraseña abre una entrada de minutos, no una sesión. La sesión nace cuando esa entrada se consume con passkey, TOTP o código de respaldo. Aprobar una recuperación de contraseña cambia la contraseña y cierra las sesiones. No revoca passkeys ni TOTP. Nadie aprueba la propia solicitud.

## Inicio financiero

`0024_rol_finanzas.sql` admite el rol combinable `finanzas` en `membership_roles`. Administración ve Inicio por su propio rol; Finanzas permite que otra persona de consola vea el resumen y Pendientes sin darle acceso a póliza, proveedores, política, configuración ni liberación. El resumen solo lee `postings`: los ingresos son asientos positivos y los gastos son el valor absoluto de los negativos. El índice por empresa y fecha sostiene esa lectura. Este archivo no inserta asientos ni migra production.

## Funciones SECURITY DEFINER y tablas temporales

Una función `SECURITY DEFINER` corre con los privilegios de su dueña. Si su `search_path` no nombra `pg_temp`, Postgres busca primero en las tablas temporales de quien llama, y una tabla temporal con el nombre de una tabla real desvía la función. `0029_search_path_pg_temp.sql` deja cada definer del esquema `public` con `search_path = public, pg_temp`, como pide la documentación de Postgres 17 («Writing SECURITY DEFINER Functions Safely»). También quita `TEMPORARY` sobre la base a `PUBLIC` y a los roles de la aplicación (`plataforma_app`, `plataforma_cliente`, `plataforma_sofipo` y `plataforma_tarea`): ese privilegio viene de `PUBLIC` por omisión, así que quitárselo solo a un rol no surte efecto. La dueña de la base lo conserva. Ni la aplicación ni las migraciones crean tablas temporales con esos roles.

Quien migra tiene que ser la dueña de la base `plataforma`. Si no lo es, el `REVOKE` no surte efecto y la migración se detiene con un mensaje claro.

Toda función `SECURITY DEFINER` nueva lleva `SET search_path = public, pg_temp`. `tests/esquema/definer-search-path.test.ts`, que corre en `test:db`, lo exige y comprueba que ningún rol de la aplicación tenga `TEMPORARY`. Las funciones `SECURITY INVOKER` conservan su `search_path`: corren con los privilegios de quien llama, y sin `TEMPORARY` los roles de la aplicación no pueden crear la tabla que las desviaría.

`auth_exige_evento` es definer y `PUBLIC` la puede ejecutar. Se queda así: la llaman tres disparadores invoker (`auth_recuperaciones_exige_rastro`, `auth_factor_exige_rastro` y `sessions_sello_exige_rastro`) que corren como el rol de la aplicación, y solo responde por la bitácora de la transacción de quien llama.
