# Plataforma

Consola de control de gastos para una razón social mexicana.

## Desarrollo

```bash
npm install
npm run dev
```

`/salud` responde `ok` y no imprime configuración.

## Este corte

Fase 4, base multi-cliente. La SOFIPO es el operador y vive en la tabla `operators`. Su personal vive en `platform_staff`, no en una variable de entorno. Cada empresa cliente tiene su portal. Una persona puede pertenecer a varias empresas y tener varios roles en cada una.

Nadie crea una empresa desde `/`. Las da de alta el personal, con `scripts/plataforma.ts`, y el primer administrador entra por invitación. La invitación guarda solo el SHA-256 del enlace, caduca a las 72 horas y sirve una vez. Quien la acepta fija su propia contraseña.

La contraseña abre la cookie `sesion_parcial`. Ningún portal abre hasta que esa sesión queda marcada con el segundo factor (`sessions.segundo_factor_en`). El proxy exige esa cookie completa. Passkey y TOTP los construye otro frente, en `fase-4/autenticacion`, llamando a `completarSegundoFactor`.

Cada petición resuelve un contexto de tenant. Los repositorios reciben ese contexto y Postgres vuelve a filtrar con RLS, con `set_config` local a la transacción. La lista 69-B y el precio los escribe solo el personal de la plataforma.

La bitácora nueva es `audit_log`: tipo de actor, superficie y la transacción real (`txid`). `audit_events` queda como histórico.

El maestro de personas sigue en la consola: jefe, centro de costo, fecha de baja y CLABE con el dígito 3, 7 y 1. Hacen falta dos personas que puedan liberar. El contador no libera. No se dispersa dinero. El teléfono sigue vacío y no comparte el menú.

El servidor lee el connection string agrupado y no migra al arrancar. Las migraciones se aplican a mano:

```bash
export DATABASE_URL_UNPOOLED
./db/migrate.sh
```

`DATABASE_URL_UNPOOLED` es el string directo de la base `plataforma`. El valor no va en el repositorio. La rama de Neon para que preview no comparta el libro de production se crea con `./db/preview-branch.sh`. El detalle está en `db/README.md`.

## Política de comprobantes

La consola muestra los cuatro cajones —Viáticos, Proveedores, Impuestos y Nómina— con el saldo que sale de sus asientos. La política nace en cinco días y cinco comprobantes vencidos, y se puede escribir distinto para cada persona. Las categorías no traen tope. El umbral de proveedores no trae monto. No hay dispersión ni SPEI en este corte. La pantalla está en `/consola/politica`.

## Precios

`/precios` y la consola leen `platform_pricing.suscripcion_centavos`. Vacío, las dos dicen «cifra no publicada». Por persona, por tarjeta y de implementación se muestran en cero. No hay un monto sembrado.

Publicar el monto y aceptar la suscripción de una empresa son actos del personal de la plataforma. Un administrador de cliente no los escribe.

## Invitación

Otro frente envía el correo. El contrato está en `src/server/invitaciones`: `EnviarInvitacion` recibe `MensajeDeInvitacion` (`para`, `nombre`, `razonSocial`, `roles`, `enlace`, `expiraEn`). `enviarInvitacion` hoy no tiene proveedor y la invitación queda emitida para reenviar. El enlace se arma con `enlaceDeInvitacion` y `PLATAFORMA_URL_PUBLICA`.

## Pruebas

```bash
export AISLAMIENTO_DATABASE_URL=postgres://dueno@localhost:5432/postgres
npm test
```

`AISLAMIENTO_DATABASE_URL` es un Postgres desechable, nunca el libro. La suite crea una base, aplica las migraciones y la borra. En cada pull request corre el workflow `Pruebas`.

## Proveedores

El alta vive en la consola, en `/consola/proveedores`, con la barra de la izquierda. Pide RFC, razón social, CLABE de 18 dígitos y la constancia en PDF. El duplicado de RFC no entra. Cambiar la CLABE deja la anterior en el historial. Los dieciocho dígitos se ven completos. El nombre del banco solo aparece si los tres primeros están en el catálogo tradicional; si no, la institución queda pendiente del participante.

La lista del artículo 69-B está en `/consola/lista-69b`. Si el RFC aparece, o si todavía no hay archivo, el proveedor puede existir y no hay botón de pago. No se envía dinero.

`/telefono` no lleva proveedores, la CLABE ni la lista 69-B, y no usa el menú de la consola.
