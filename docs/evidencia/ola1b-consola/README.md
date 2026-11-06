# Ola 1B · consola: evidencia

Recorrido de la zona de la consola (Pendientes, Proveedores, Personas, Política, Lista 69-B, Configuración, Plan y Póliza) ya en el sistema visual de Lever. Se hizo con Playwright headless desde node, no con el navegador del MCP, contra `next start` en el puerto 4807. El servidor se compiló con `E2E_SERVER_ACTIONS=1 E2E_PUERTO=4807`, corre sobre Postgres 17 local en el puerto 5542 y usa el emulador de Blob en el puerto 4892.

Las capturas están en WebP, en tres temas (Oscuro, Claro y Lever) y en dos tamaños: 1440×900 y 390×844 (móvil, con `isMobile`). Cada captura se llama `<clave>-<tema>-<ancho>.webp`.

## Resultado de la corrida final

| Corrida | Qué comprueba | Resultado | Salida literal |
| --- | --- | --- | --- |
| `pantallas` | 30 pantallas × 3 temas × 2 tamaños. En cada una revisa: responde 200 en su propia ruta, sin redirigir; tiene un solo `h1`; todo campo tiene etiqueta; cada error está ligado a su campo con `aria-describedby`; no hay desplazamiento horizontal; la tabulación sigue el orden del documento; cada parada de Tab tiene foco visible; no hay errores de consola | **1440 de 1440** | `salida/pantallas.txt`, `datos/pantallas.json` |
| `contraste` | Contraste AA de cada texto visible contra la escena real (fondo WebGL). Con un diálogo modal abierto solo se mide el diálogo, porque lo de atrás queda inerte bajo el velo | **6 de 6** (ver la tabla siguiente) | `salida/contraste.txt`, `datos/contraste.json` |
| `cargando` | Con la respuesta de Política detenida: la sección del lateral muestra «Cargando…» con su indicador, la barra y la página actual se quedan, y al soltar la respuesta se pinta Política | **12 de 12** | `salida/cargando.txt` |
| `caida` | Con Postgres apagado (`pg_ctl stop`), 9 pantallas × 3 temas × 2 tamaños. Cada una responde 200 en su ruta, con un solo `h1` y dentro del marco, dice «No se pudo…», no muestra cifras supuestas y no tiene errores de consola | **216 de 216** | `salida/caida.txt` |
| `flujos` | Los 11 flujos clicados, con doble clic en cada envío y verificación en la base | **62 de 62** | `salida/flujos.txt`, `datos/flujos.json` |
| `flujos` con SAT simulado | Flujo 9 con el camino feliz de la 69-B y la negativa por IP privada (ver abajo) | **5 de 5** y **3 de 3** | `salida/flujos-sat-simulado-*.txt`, `salida/sat-simulado-bitacora.txt` |

Contraste por tema y tamaño:

| Tema | Ancho | Textos medidos | Contraste mínimo |
| --- | --- | --- | --- |
| Oscuro | 1440 | 961 | 4.95 |
| Oscuro | 390 | 461 | 6.12 |
| Claro | 1440 | 961 | 4.96 |
| Claro | 390 | 461 | 4.55 |
| Lever | 1440 | 961 | 4.86 |
| Lever | 390 | 461 | 5.36 |

## Pantallas y estados

| Clave | Quién | Estado que muestra |
| --- | --- | --- |
| `10-pendientes`, `11-pendientes-altamar` | Gil (Taller), Laura (Altamar) | Con pendientes; Altamar en su puesta en marcha |
| `20-proveedores-pagos`, `21-proveedores-directorio`, `22-proveedores-agenda` | Gil | Mesa de pagos, directorio y agenda |
| `23-proveedores-detalle-pago`, `24-proveedores-expediente` | Rosa, Gil | Panel lateral del pago y del expediente |
| `25-proveedores-alta`, `26-proveedores-nuevo-pago` | Gil | Formularios de alta |
| `27-proveedores-vacio` | Laura | **Vacío**: Altamar sin pagos ni proveedores |
| `30`…`33` (Personas) | Laura | Directorio, alta, áreas y nómina, todos vacíos al empezar |
| `34-personas-sin-permiso` | Rosa (liberadora) | **Sin permiso** |
| `40-politica`, `41-politica-altamar` | Gil, Laura | Política con datos y política recién creada («Todavía no hay personas») |
| `50-lista-69b`, `51-lista-69b-sofipo` | Gil, Ofelia (personal SOFIPO) | Consulta de RFC y carga del listado |
| `60-configuracion`, `61-configuracion-plan`, `70-poliza` | Gil | Configuración, plan y póliza (vacía: «Todavía no hay pólizas para exportar») |
| `80`…`86` (`*-sin-permiso-*`) | Fernanda (solo finanzas) | **Sin permiso** en Proveedores, Personas, Política, Lista 69-B, Configuración, Plan y Póliza |
| `87-pendientes-finanzas` | Fernanda | Pendientes con el rol de finanzas |
| `90-error-*` | Gil, con la base apagada | **Error** de Pendientes, Proveedores, Personas, Nómina, Política, Lista 69-B, Configuración, Plan y Póliza |
| `95-cargando` | Gil | **Cargando**: Política detenida mientras el lateral muestra su progreso |

## Flujos clicados (`flujos/`)

Cada envío se hizo con **doble clic real** sobre `BotonEnviar`, y la base se consultó después con SQL de dueño.

| Flujo | Qué se clicó | Verificado en la base |
| --- | --- | --- |
| 1. Alta de proveedor con CLABE | «Alta de proveedor», formulario completo y doble clic en «Dar de alta». El botón se desactiva y dice «Enviando…» con `aria-busy` | 1 proveedor, 1 CLABE, 1 asiento en la bitácora |
| 2. Cuenta por pagar con XML | Se carga el XML y el PDF, y doble clic en «Revisar y solicitar» | 1 cuenta por pagar, 1 solicitud y 2 documentos; el XML se descarga del almacén privado (HTTP 200); quien solicita no puede autorizar |
| 3. Autorización por un segundo liberador | Rosa abre el pago desde Pendientes («Revisar pagos») y da doble clic en «Autorizar para pagar» | Estado `listo_para_pagar` con 1 autorización; «Rechazar» no anuncia que envía |
| 4. Rechazo y cancelación con motivo | Doble clic en «Rechazar» con su motivo; sin motivo no se cancela; doble clic en «Confirmar cancelación» | 1 rechazo y 1 cancelación con el motivo «Se reprograma con el proveedor» |
| 5. Alta de colaborador con nómina | Desde Pendientes: «Crear área», con un presupuesto inválido (el texto se queda y el error se liga al campo) y luego doble clic; después «Dar de alta» y doble clic en «Dar de alta colaborador» | 1 área; 1 persona, 1 nómina y 1 asiento `alta_persona` |
| 6. Cambio de CLABE de nómina | Con el segundo factor de hace 31 minutos, el cambio pide «Confirma que eres tú» y la CLABE no cambia. Luego se vuelve a entrar con contraseña y TOTP, y doble clic en «Cambiar CLABE de nómina» | CLABE vigente nueva, historial con 2 y 1 asiento `cambiar_clabe_nomina` |
| 7. Preparar el lote de nómina | Desde Pendientes, «Preparar nómina» y doble clic | 1 lote con 1 renglón, total 1,250,000 centavos |
| 8. Editar la política | Plazo «muchos»: el valor se queda y el error queda ligado al campo. Luego plazo válido con doble clic y categoría nueva con doble clic | 1 asiento `editar_politica`; 1 categoría, y la forma queda vacía para la siguiente |
| 9. Lista 69-B | Ofelia da doble clic en «Guardar el listado» («Descargando…»); Gil consulta `AAA010101AAA` | Sin copia doble; la consulta responde «No aparece en la lista 69-B.» |
| 9 con SAT simulado | Ofelia da doble clic en «Guardar el listado»; Gil consulta `PAL7202161U0` | 1 copia nueva (2026-10-31, 3 filas); el pago a ese RFC queda bloqueado. Con IP privada, 0 copias |
| 10. Configuración y plan | Plan, Póliza, Apariencia y Seguridad desde Configuración | Cada una abre con un solo `h1` |
| 11. Pendientes | Cada tipo de pendiente de Taller y de Altamar, con su acción clicada | Cada acción lleva a la pantalla que lo resuelve |

### Flujo 9 con el SAT real y con «SAT simulado»

El DNS local no resuelve los hosts del SAT: `dig omawww.sat.gob.mx` devuelve `SERVFAIL` y `curl https://www.sat.gob.mx/` responde `Could not resolve host`. Por eso el flujo 9 corre dos veces:

1. **SAT real** (dentro de `flujos`). Ofelia da doble clic en «Guardar el listado» y la pantalla dice «No se pudo leer el listado que publica el SAT. No quedó una copia nueva.». No se guardan dos copias. Gil consulta `AAA010101AAA` sobre la copia sembrada.
2. **SAT simulado**, con el visto bueno del líder. Las capturas `09s-*` llevan el rótulo amarillo «SAT simulado». El preload `scripts/evidencia/ola1b-consola/sat-simulado.mjs` vive solo en `scripts/evidencia` y no toca el código de la aplicación. Contesta por `*.sat.gob.mx` en dos niveles:
   - **DNS.** Los resuelve a `203.0.113.69`, una dirección pública de documentación. Así la aplicación sigue validando el host del SAT y que la IP no sea privada.
   - **HTTP.** Responde la página citada y el «Listado completo» con un salto 302 dentro del SAT, para que también corra la validación de cada redirección.

| Corrida | Qué pasa | Resultado | Salida literal |
| --- | --- | --- | --- |
| `SAT_SIMULADO=ok` | Doble clic en «Guardar el listado»: una sola copia nueva, del 31 de octubre de 2026, con 3 filas («Archivo del 31 de octubre de 2026, con 2 RFC.»). Después Gil consulta `PAL7202161U0`, que la copia nueva tiene como «Definitivo», y la pantalla responde «El proveedor puede existir. El pago no.» | **5 de 5** | `salida/flujos-sat-simulado-ok.txt` |
| `SAT_SIMULADO=ip-privada` | El mismo preload resuelve los hosts del SAT a `10.0.0.5`. La carga se niega con «No se pudo leer el listado…» y no guarda copia | **3 de 3** | `salida/flujos-sat-simulado-ip-privada.txt` |

`salida/sat-simulado-bitacora.txt` anota cada resolución y cada petición del preload:
- Con la IP pública, cada salto se resuelve antes de pedirse: la página, el enlace que responde 302 y el archivo final, siempre con `redirect=manual`.
- Con la IP privada solo hay una resolución y ninguna petición. La aplicación se niega antes de conectarse.

## Comparación con el diseño

Cada comparación pone tres paneles en Oscuro a 1440: el diseño de los socios, la pantalla antes (main en `81da672`) y la pantalla después.

- `comparacion-proveedores.webp`: `plat-09-proveedores` frente a Proveedores.
- `comparacion-nomina.webp`: `plat-10-no-mina` frente a Nómina.
- `comparacion-pendientes.webp`: `plat-02-aprobaciones` frente a Pendientes.

`antes/` guarda cada pantalla de la zona sobre main en `81da672`, en Oscuro a 1440 y a 390, con las mismas claves que `pantallas/`. Con eso cada pantalla se puede comparar antes y después.

## Cómo reproducirlo

1. **Postgres 17 de Homebrew**, en una carpeta propia. El socket va sin ruta porque la de la carpeta temporal es demasiado larga:

   ```sh
   initdb -U postgres --auth=trust -D <carpeta>
   pg_ctl -D <carpeta> -o "-p 5542 -k ''" start
   ```

2. **Base y sesiones.** El script crea la base `ola1b_consola`, aplica `db/migrations` y carga `tests/e2e/seed-pagos.sql` (Taller del Cierre, con Gil y Rosa). Después da de alta Altamar Logística con Laura usando los servicios del producto, agrega a Fernanda (solo finanzas) y a Ofelia (personal SOFIPO), y deja sesiones con segundo factor:

   ```sh
   DUENO_URL=postgres://postgres@127.0.0.1:5542/postgres \
     ./node_modules/.bin/tsx scripts/evidencia/ola1b-consola/preparar.ts \
     > <fuera del repositorio>/entorno.json
   export ENTORNO=<fuera del repositorio>/entorno.json
   ```

   El JSON lleva la contraseña local del rol de la aplicación. Debe quedar fuera del árbol del repositorio, porque `npm run security` revisa todos los archivos y lo marcaría.

3. **Blob local.** `@vercel/blob` acepta `VERCEL_BLOB_API_URL`, así que basta con apuntarlo a un emulador local en el puerto 4892. Las lecturas del almacén privado se desvían al mismo emulador con un `--import` de Node, que solo intercepta `*.blob.vercel-storage.com`. El código de la aplicación no cambia.

4. **Servidor.**

   ```sh
   E2E_SERVER_ACTIONS=1 E2E_PUERTO=4807 npx next build
   ```

   Después se arranca `npx next start -p 4807` con estas variables:
   - `DATABASE_URL` del `entorno.json`;
   - `URL_APLICACION=http://localhost:4807` y `AUTENTICACION_DOMINIOS=localhost`;
   - `AUTENTICACION_LLAVE_TOTP`, una llave local de 32 bytes en base64url;
   - las variables de Blob del paso 3.

5. **Corridas.** Todas escriben en `docs/evidencia/ola1b-consola`, o en la carpeta que diga `DIR`. Antes de `caida`, Postgres se apaga con `pg_ctl stop`.

   ```sh
   node scripts/evidencia/ola1b-consola.mjs pantallas
   node scripts/evidencia/ola1b-consola.mjs contraste
   node scripts/evidencia/ola1b-consola.mjs cargando
   node scripts/evidencia/ola1b-consola.mjs caida
   node scripts/evidencia/ola1b-consola.mjs flujos
   DISENO=<carpeta con plat-*.png> node scripts/evidencia/ola1b-consola/comparar.mjs
   ```

   - Para correr solo algunas pantallas: `SOLO=40,41`. Para algunos temas o tamaños: `TEMAS=oscuro`, `ANCHOS=390`. Para algunos flujos: `FLUJOS=8,9`.
   - **Los flujos se corren justo después del paso 2.** Autorizar un pago exige un segundo factor de menos de 30 minutos, y el guion se detiene si las sesiones sembradas son más viejas.
   - Para el rechazo del flujo 6, el guion envejece el factor de Laura a 31 minutos con SQL de dueño, en la base desechable.

6. **Flujo 9 con SAT simulado.** Se vuelve al paso 2 y se arranca el servidor con el preload además del de Blob. Después se corre solo el flujo 9:

   ```sh
   NODE_OPTIONS="--import=<preload de Blob> --import=./scripts/evidencia/ola1b-consola/sat-simulado.mjs" \
     SAT_SIMULADO_IP=203.0.113.69 SAT_SIMULADO_BITACORA=<bitácora> npx next start -p 4807
   FLUJOS=9 SAT_SIMULADO=ok SUFIJO=-sat-simulado-ok node scripts/evidencia/ola1b-consola.mjs flujos
   ```

   Para la corrida negativa se repite con `SAT_SIMULADO_IP=10.0.0.5` y `SAT_SIMULADO=ip-privada`.
