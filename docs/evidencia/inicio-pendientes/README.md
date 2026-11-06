# Evidencia funcional: Inicio y Pendientes

Recorrido del 6 de noviembre de 2026 sobre `main` integrado (#44 pagos a proveedores, #45 Personas y nómina, #46 estabilización), con `next dev` en el puerto 4813 y un Postgres 17 desechable en el puerto 5513. Empresa, personas, proveedor y asientos son datos locales de prueba; no se tocó Neon ni una base compartida. El recorrido es reproducible con `scripts/evidencia/inicio-pendientes.mjs`: 57 comprobaciones y `VALIDACION_FUNCIONAL_OK` (la última corrida, sobre la rama que reutiliza la consulta de `prepararNomina`, agrega la preparación del lote; las capturas no cambian). Los únicos errores de consola del navegador fueron los dos 404 buscados (Inicio sin Finanzas y el teléfono con solo Finanzas).

| Captura | Flujo clicado | Comprobado |
| --- | --- | --- |
| `01-inicio-datos-claro.png` | La administradora entra por su invitación (contraseña + TOTP) y aterriza en Inicio. | Salidas del mes = $111,800.00; Salidas por categoría (Nómina, Proveedores, Impuestos) suma lo mismo y no incluye el cargo de Viáticos del 31-oct 20:00 hora de México, que cuenta en octubre ($151,250.00). Ejes a 12 px reales. |
| `02-contador-pendientes.png` | El contador entra por su invitación, abre `/c/<empresa>` y `/c/<empresa>/consola`, y vuelve a Pendientes después de que se solicita el pago. | Llega a `/consola/pendientes` con HTTP 200 en los tres casos. El pago por autorizar no aparece como tarea suya: el contador no puede autorizar pagos (#44 solo deja autorizar a un liberador distinto de quien solicitó). |
| `03-liberadora-pendientes-pagos-nomina.png` | La liberadora entra por su invitación; antes de la solicitud no tiene pagos por autorizar. La administradora da de alta al proveedor «Diesel del Bajío» con su constancia y solicita un pago por excepción; la liberadora vuelve a Pendientes y pulsa «Revisar pagos». | Ve «Autoriza un pago a proveedor» y «Prepara el lote de nómina del 5 de noviembre» (la persona con nómina dada de alta ese día, sin lote). «Revisar pagos» abre la mesa de Proveedores con el pago de Diesel del Bajío. La administradora ve la nómina y no el pago (no es liberadora); pulsa «Preparar nómina», prepara el lote y su fecha es la que anunciaba Pendientes, que deja de mostrar la nómina. |
| `04-alta-nueva-solo-finanzas-rechazada.png` | En el alta nueva de Personas se marca solo «Ver Inicio financiero». | Aviso «Finanzas es un acceso adicional…»; la persona no se crea. Además, un alta con Tarjetahabiente + Finanzas y un correo que ya entra es rechazada por el servidor y las dos casillas siguen marcadas. Un alta con Tarjetahabiente + Finanzas guarda `finanzas,tarjetahabiente`. |
| `05-ficha-nueva-finanzas-otorgado.png` | En la ficha nueva de Tomás (bloque «Plataforma y tarjeta») se desmarca la casilla y se guarda; luego se marca y se guarda. | «Se retiró el acceso…», la base queda en `tarjetahabiente` y `/consola` responde 404 para Tomás. Al otorgar: «La persona ya puede ver Inicio financiero.», la casilla queda marcada, la base vuelve a `finanzas,tarjetahabiente` y Tomás abre Inicio. |
| `06-quitar-unico-rol-rechazado.png` | Membresía heredada con solo Finanzas: se desmarca la casilla y se guarda. | Aviso «No se quitó · Finanzas es su único rol…»; la casilla regresa a marcada (valor real de la base). |
| `07-finanzas-sin-telefono.png` | Tomás, con solo Finanzas, abre `/c/<empresa>/telefono`. | HTTP 404 con la página de la marca, sin datos del teléfono. |
| `08-grafica-movil-oscuro.png` | Tomás (solo Finanzas) en Inicio a 390 px, tema oscuro. | Últimos tres meses (Sep, Oct, Nov) con el mes actual, eje Y con sus cinco marcas, misma escala del periodo, sin desplazamiento horizontal, ejes a 12 px. Menú: solo Inicio y Pendientes. |
| `09-grafica-movil-claro.png` | La administradora en Inicio a 390 px, tema claro. | Igual que la anterior en claro. |
| `10-inicio-12-meses-oscuro.png` | La administradora elige «12 meses», tema oscuro. | Doce meses dibujados y etiquetas sin encimarse. |

## Cómo reproducir

```sh
# Postgres desechable (Homebrew, sin Docker)
initdb -D <tmp> -U dueno --auth=trust
pg_ctl -D <tmp> -o "-p 5513 -k '' -c listen_addresses=127.0.0.1" start
psql postgres://dueno@127.0.0.1:5513/postgres -c "create database plataforma"
# Aplicar db/migrations/*.sql en orden con psql -1 -v ON_ERROR_STOP=1 -f y registrar cada versión en schema_migrations.
psql postgres://dueno@127.0.0.1:5513/plataforma -c "alter role plataforma_app login password 'local'"

CLAVE_APP=local  # la clave que se acaba de fijar a plataforma_app, solo en esta base desechable
export DATABASE_URL=postgres://plataforma_app:${CLAVE_APP}@127.0.0.1:5513/plataforma
OPERADORES_PLATAFORMA=op@lever.test npx tsx scripts/plataforma.ts personal:migrar-variable
psql postgres://dueno@127.0.0.1:5513/plataforma -c "update platform_staff set estado='activo'"
npx tsx scripts/plataforma.ts empresa:alta --personal op@lever.test --rfc ALO180312AB1 --razon "Altamar Logística" \
  --cp 06600 --regimen 601 --uso G03 --admin-nombre "Laura Méndez" --admin-correo laura@lever.test --demostracion --mostrar-enlace
psql postgres://dueno@127.0.0.1:5513/plataforma -v empresa=<uuid> -v ON_ERROR_STOP=1 -f scripts/evidencia/inicio-pendientes-asientos.sql
# Lista 69-B cargada, como la deja el proceso del sistema: sin ella el alta de proveedor bloquea el pago.
# Insertar en una sola transacción una fila en lista_69b_snapshots y su evento cargar_lista_69b en audit_log
# (igual que tests/e2e/seed-pagos.sql).

AUTENTICACION_LLAVE_TOTP=$(openssl rand -base64 32) URL_APLICACION=http://localhost:4813 \
  PLATAFORMA_URL_PUBLICA=http://localhost:4813 <variables de Blob> npx next dev -p 4813

BASE=http://localhost:4813 DUENO_URL=postgres://dueno@127.0.0.1:5513/plataforma \
  INVITACION_ADMIN=http://localhost:4813/invitacion/<token> node scripts/evidencia/inicio-pendientes.mjs
```

`empresa:alta` imprime el enlace con el puerto 3000; se cambia a 4813 antes de pasarlo como `INVITACION_ADMIN`. Playwright se toma del repositorio; `PLAYWRIGHT_DESDE` solo hace falta para usar otra instalación.

**Vercel Blob emulado.** El alta del proveedor archiva su constancia en el almacén privado y no hay `BLOB_READ_WRITE_TOKEN` local. Como en `docs/evidencia/pagos-proveedores`, `put` y `del` usan `VERCEL_BLOB_API_URL` (que `@vercel/blob` soporta) apuntado a un emulador local en `127.0.0.1:4898`, y las lecturas del almacén privado se redirigen al mismo emulador con un `--import` de Node que solo intercepta `*.blob.vercel-storage.com`. El código de la aplicación no se tocó para esto.

Dos atajos locales, ambos como dueño de la base desechable y documentados en el script:

- El correo no está configurado, así que las personas dadas de alta en la pantalla no reciben su enlace. El script emite para cada una una invitación de sistema con un token conocido; la persona entra por la pantalla real de invitación, contraseña y TOTP.
- La membresía con solo Finanzas ya no se puede crear desde la aplicación. Para comprobar el aviso de `ultimo_rol`, el script la simula con su evento de bitácora.

Un pago solo se solicita con dos liberadores activos (#44), así que el contador y los dos liberadores entran antes de que la administradora lo solicite.
