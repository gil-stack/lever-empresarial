# Lever

Lever: consola de control de gastos para una razón social mexicana. La guía corta del sistema visual está en `src/estilo/LEEME.md`.

## Desarrollo

```bash
npm install
npm run dev
```

## Comprobaciones

Vercel CI corre estas tareas en cada push, tanto en un pull request como en `main`. La instalación de dependencias la hace el arranque del CI, una vez por corrida; no es una tarea aparte.

```bash
npm run typecheck
npm run lint
npm run test
npm run test:db
npm run build
npm run security
npm run test:e2e
```

`test` corre la suite con `tsx --test` y deja fuera las pruebas que necesitan Postgres. `test:db` levanta un Postgres desechable en Docker, aplica las migraciones y borra la base. No usa `DATABASE_URL` ni la rama de preview. Hace falta Docker en la máquina local; en Vercel CI el daemon ya está encendido. En el CI corre en dos partes, `test:db:1` y `test:db:2`, cada una en su máquina. El reparto, por tiempo medido, está en `scripts/ci/pruebas-postgres.partes`. `npm run test:db` corre las dos en serie. Una prueba nueva que use Postgres va en una de las dos partes: `tests/ci/partes-postgres.test.ts`, que corre en `npm test`, falla si alguna queda fuera o repetida.

`test:e2e` compila, crea otra base desechable, siembra las empresas de Personas y de Pagos a proveedores con sus sesiones, levanta `next start` en el puerto 3109 (o el de `E2E_PUERTO`) y corre todos los recorridos de `tests/e2e` con Chromium. Antes hay que ejecutar `npx playwright install chromium` y definir `E2E_ADMIN_URL` con un Postgres local desechable; esa variable jamás debe apuntar a la base `plataforma`. Los detalles y las demás variables están en `tests/e2e/LEEME.md`. Las capturas de Personas quedan en `docs/evidencia/personas`.

`security` revisa vulnerabilidades de dependencias (`npm audit`), secretos en el código y en el paquete del navegador, y las rutas de servidor. Vercel CI no trae un revisor propio: Vercel Security Review pertenece a Vercel Agent y publica otro check.

`/salud` responde `ok` y no imprime configuración.

## Este corte

Fase 4, base multi-cliente. La SOFIPO es el operador y vive en la tabla `operators`. Su personal vive en `platform_staff`, no en una variable de entorno. Cada empresa cliente tiene su portal. Una persona puede pertenecer a varias empresas y tener varios roles en cada una.

Nadie crea una empresa desde `/`. Las da de alta el personal, con `scripts/plataforma.ts`, y el primer administrador entra por invitación. La invitación guarda solo el SHA-256 del enlace, caduca a las 72 horas y sirve una vez. Quien la acepta fija su propia contraseña.

La contraseña abre la cookie `sesion_parcial`. Ningún portal abre hasta que esa sesión queda marcada con el segundo factor (`sessions.segundo_factor_en`). El proxy exige esa cookie completa. Solo `src/server/autenticacion` marca el segundo factor, después de verificar la passkey o el código TOTP.

Cada petición resuelve un contexto de tenant. Los repositorios reciben ese contexto y Postgres vuelve a filtrar con RLS, con `set_config` local a la transacción. La lista 69-B y el precio los escribe solo el personal de la plataforma.

La bitácora nueva es `audit_log`: tipo de actor, superficie y la transacción real (`txid`). `audit_events` queda como histórico.

Personas reúne el expediente laboral, el área, los presupuestos mensuales y la nómina neta. Acceso a plataforma y tarjeta son independientes: una persona puede tener solo tarjeta, solo acceso o ambos. La tarjeta se registra como solicitud interna pendiente; no se afirma que un emisor la haya emitido. Las quincenas son 15 y último, y los cambios de sueldo no alteran un lote ya preparado. Preparar nómina congela personas, importes y destinos para revisión; no es una orden bancaria y no se dispersa dinero. La baja efectiva cierra acceso y sesiones, detiene nuevas nóminas y cancela solicitudes de tarjeta pendientes; una baja con fecha futura lo hace sola el día que llega (al resolver el contexto de esa persona o al abrir Personas), con evento del sistema en la bitácora. La empresa no se queda sin administrador por una baja. La CLABE de nómina tiene historial append-only (`employee_payroll_clabes`): cambiarla exige el permiso `cliente.personas.clabe.cambiar`, segundo factor de menos de 30 minutos, deja en la bitácora solo las terminaciones y avisa por correo a la persona si tiene usuario. Quien no puede cambiarla ve solo la terminación; el contador ve totales de nómina, no el neto por persona. El contador no libera y el teléfono no comparte el menú.

El servidor lee el connection string agrupado y no migra al arrancar. Las migraciones se aplican a mano:

```bash
export DATABASE_URL_UNPOOLED
./db/migrate.sh
```

`DATABASE_URL_UNPOOLED` es el string directo de la base `plataforma`. El valor no va en el repositorio. La rama de Neon para que preview no comparta el libro de production se crea con `./db/preview-branch.sh`. El detalle está en `db/README.md`.

## Invitaciones y correo

La persona entra por invitación y elige su propia contraseña en `/invitacion/<token>`. La contraseña olvidada se cambia desde `/recuperar`. Los dos enlaces sirven una sola vez y vencen (72 horas la invitación, una hora la recuperación). La base guarda el SHA-256 del token, nunca el token. Cambiar la contraseña cierra todas las sesiones de la persona.

Todos entran con correo, contraseña y segundo factor (passkey, o TOTP si no hay passkey). Aceptar la invitación no abre sesión: después de la contraseña, la persona sigue a registrar su segundo factor, o a verificarlo si ya tenía cuenta. Ese paso lo entrega la autenticación por `ContinuarConSegundoFactor` (`src/server/invitaciones/segundo-factor.ts`); mientras no esté, la contraseña queda guardada y nadie entra. La recuperación no abre sesión ni toca el segundo factor.

El correo sale por Resend, desde `src/server/correo`. Hacen falta tres variables, cuyos valores no van en el repositorio:

| Variable | Qué es |
| --- | --- |
| `RESEND_API_KEY` | Clave de envío de Resend. Basta una clave con permiso solo de envío |
| `CORREO_REMITENTE` | `Nombre <direccion@dominio>`. El dominio tiene que estar verificado en Resend |
| `URL_APLICACION` | Origen público de los enlaces, por ejemplo `https://app.dominio.mx`. Si falta, se usa el dominio que Vercel asigna al despliegue; nunca el encabezado `Host` de la petición |

Sin clave o sin remitente no se envía nada y la base no se escribe: el servicio responde `correo_no_configurado` con el nombre de la variable que falta, nunca su valor.

Las tablas están propuestas en `db/propuestas/fase-4-invitaciones.sql` hasta alinearlas con la tenencia.

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

`/telefono` no lleva proveedores, la CLABE ni la lista 69-B, y no usa el menú de la consola. Para verlo hace falta haber entrado con el segundo factor.

## Autenticación

Todo el mundo entra con correo, contraseña y un segundo factor: una passkey, o un código TOTP de una app autenticadora si no tiene passkey. Sin eso el portal no abre, ni la consola ni el teléfono. Al primer ingreso hay que registrar uno de los dos. Los códigos de respaldo se muestran una vez y se guardan como hash.

Perder el segundo factor no se resuelve con un correo. La persona lo pide y otra persona, de `OPERADORES_PLATAFORMA`, verifica su identidad y aprueba. Esa aprobación cierra las sesiones y quita los factores. La cuenta sigue cerrada hasta que, con la contraseña, se registra uno nuevo.

`AUTENTICACION_LLAVE_TOTP` es la llave de 32 bytes, en base64, con la que se cifra la semilla TOTP. No va en el repositorio. Se genera con `openssl rand -base64 32`. Sin ella se puede entrar con passkey y no con app autenticadora. `AUTENTICACION_DOMINIOS` lista, separada por comas, los dominios propios donde una passkey es válida. En Vercel se suman los dominios del despliegue. La migración es `0016_autenticacion_fuerte.sql`, con el mismo comando de siempre, y hay que aplicarla antes de servir este corte: borra las sesiones anteriores.
