# Evidencia funcional: Inicio y Pendientes

Recorrido del 6 de noviembre de 2026 con `next dev` en el puerto 4813 y un Postgres 17 desechable en el puerto 5513. Empresa, personas y asientos son datos locales de prueba; no se tocó Neon ni una base compartida. El recorrido es reproducible con `scripts/evidencia/inicio-pendientes.mjs` y terminó con `VALIDACION_FUNCIONAL_OK`.

| Captura | Flujo clicado | Comprobado |
| --- | --- | --- |
| `01-inicio-datos-claro.png` | La administradora entra por su invitación (contraseña + TOTP) y aterriza en Inicio. | Salidas del mes = $111,800.00; Salidas por categoría (Nómina, Proveedores, Impuestos) suma lo mismo y no incluye el cargo de Viáticos del 31-oct 20:00 hora de México, que cuenta en octubre ($151,250.00). Ejes a 12 px reales. |
| `02-contador-redirige-a-pendientes.png` | El contador entra por su invitación y abre `/c/<empresa>` y `/c/<empresa>/consola`. | Llega a `/consola/pendientes` con HTTP 200 en los tres casos; sin Inicio en el menú. |
| `03-liberador-redirige-a-pendientes.png` | Igual con la liberadora. | Igual: Pendientes, no 404. |
| `04-alta-solo-finanzas-rechazada.png` | Alta de una persona marcando solo «Ver Inicio financiero». | Aviso «Finanzas es un acceso adicional…»; la persona no se crea. |
| `05-finanzas-otorgado.png` | En la ficha de Tomás (solo tarjetahabiente) se marca la casilla y se guarda. | Aviso «La persona ya puede ver Inicio financiero.»; la base guarda `finanzas,tarjetahabiente` y Tomás abre Inicio. Luego se desmarca: «Se retiró el acceso…», la base vuelve a `tarjetahabiente` y `/consola` responde 404 para él. |
| `06-quitar-unico-rol-rechazado.png` | Membresía heredada con solo Finanzas: se desmarca la casilla y se guarda. | Aviso «No se quitó · Finanzas es su único rol…»; la casilla regresa a marcada (valor real de la base). |
| `07-finanzas-sin-telefono.png` | Tomás, con solo Finanzas, abre `/c/<empresa>/telefono`. | Se pinta la página 404, sin datos del teléfono. |
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

export DATABASE_URL=postgres://plataforma_app:local@127.0.0.1:5513/plataforma
OPERADORES_PLATAFORMA=op@lever.test npx tsx scripts/plataforma.ts personal:migrar-variable
psql postgres://dueno@127.0.0.1:5513/plataforma -c "update platform_staff set estado='activo'"
npx tsx scripts/plataforma.ts empresa:alta --personal op@lever.test --rfc ALO180312AB1 --razon "Altamar Logística" \
  --cp 06600 --regimen 601 --uso G03 --admin-nombre "Laura Méndez" --admin-correo laura@lever.test --demostracion --mostrar-enlace
psql postgres://dueno@127.0.0.1:5513/plataforma -v empresa=<uuid> -v ON_ERROR_STOP=1 -f scripts/evidencia/inicio-pendientes-asientos.sql

AUTENTICACION_LLAVE_TOTP=$(openssl rand -base64 32) URL_APLICACION=http://localhost:4813 \
  PLATAFORMA_URL_PUBLICA=http://localhost:4813 npx next dev -p 4813

# Playwright 1.64.1 instalado fuera del repositorio (npm i --prefix <dir> playwright@1.64.1)
PLAYWRIGHT_DESDE=<dir>/ BASE=http://localhost:4813 DUENO_URL=postgres://dueno@127.0.0.1:5513/plataforma \
  INVITACION_ADMIN=http://localhost:4813/invitacion/<token> node scripts/evidencia/inicio-pendientes.mjs
```

Dos atajos locales, ambos como dueño de la base desechable y documentados en el script:

- El correo no está configurado, así que las personas dadas de alta en la pantalla no reciben su enlace. El script emite para cada una una invitación de sistema con un token conocido; la persona entra por la pantalla real de invitación, contraseña y TOTP.
- La membresía con solo Finanzas ya no se puede crear desde la aplicación. Para comprobar el aviso de `ultimo_rol`, el script la simula con su evento de bitácora.
