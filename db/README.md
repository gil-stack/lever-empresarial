# Migraciones de la fase 1

La fase 1 deja en Neon el cimiento de identidad: la cuenta de una razón social, la persona, la sesión mínima del alta, la membresía y la auditoría de ese alta. El dinero, los cajones y el resto de las fases entran en migraciones posteriores. Estas no se reescriben.

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
