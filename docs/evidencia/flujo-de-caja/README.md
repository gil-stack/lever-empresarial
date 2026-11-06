# Evidencia funcional: flujo de caja

Recorrido clicado con Playwright headless contra `next build` + `next start`, sobre una base recién migrada y sembrada por script. Cada paso del recorrido es una aserción: si falla, el recorrido se detiene. La salida literal de la última corrida, sobre el head con main integrado (#54 y #55), está en [recorrido.txt](recorrido.txt): 226 comprobaciones, todas OK. La medición de rendimiento con EXPLAIN está en [rendimiento.md](rendimiento.md) y la del correo semanal con 200 empresas, en [correo-200.md](correo-200.md).

## Entorno

| Pieza | Valor |
|---|---|
| Base | Postgres 17.9 local (Homebrew) en `127.0.0.1:5541`, base `plataforma` recreada en cada corrida, migraciones `0001`–`0027` con `db/migrate.sh`. La app entra como `plataforma_app` |
| Servidor | `next build` y `next start -p 4806` (Next 16.4.4), Node 26 |
| Navegador | Playwright 1.64.1 con Chromium headless, desde node (`scripts/evidencia/flujo-de-caja.mjs`), 1440×900 y 390×844, zona `America/Mexico_City` |
| Fecha | La del día de la corrida en hora de México (2026-11-06). La siembra pone las fechas relativas a ese día |
| Consola del navegador | Sin errores ni advertencias de la aplicación. Se vigilan `console.error`, `console.warning` y `pageerror` |

Lo que no es de producción:

- **Vercel Blob emulado** en `127.0.0.1:4891`, como en los recorridos de #44 y #49. `put` y `del` usan `VERCEL_BLOB_API_URL`, que `@vercel/blob` soporta; las lecturas privadas se redirigen con un `--import` de Node. Solo el alta de proveedor con constancia lo usa.
- **Correo falso.** `scripts/evidencia/flujo-de-caja-correo-falso.mjs` se carga con `--import` en el servidor e intercepta solo `POST https://api.resend.com/emails`. Anota cada mensaje en un archivo fuera del repositorio y respeta la llave de idempotencia igual que Resend. El código de la aplicación no cambia.
- **Sesiones.** El recorrido abre la sesión de cada persona insertando una entrada y una sesión como dueño de la base, como los e2e de #49. Todo lo que cambia datos pasa por clics.
- **Siembra.** Empresas, personas, nómina, áreas, cobros y la renta pasan por los servicios de la aplicación, con su bitácora. Proveedores, cargos y solicitudes se escriben como dueño, con el evento que cada trigger exige, como `tests/e2e/seed-pagos.sql`. Los asientos de la empresa de demostración se insertan como en `scripts/evidencia/inicio-pendientes-asientos.sql`.

### Datos sembrados

| Empresa | Tipo | Qué tiene |
|---|---|---|
| Altamar Logística (ALO180312AB1) | Cliente real | Laura (administración y liberadora), Rosa (liberadora), Diego (contador), Fernanda (finanzas, sin detalle de nómina), Ernesto (tarjetahabiente). Áreas Operación ($90,000.00) y Ventas ($40,000.00). Nómina: dos quincenales en Operación ($10,000.00 y $8,000.00) y una mensual en Ventas ($20,000.00). Cargos TN-501 $25,000.00 listo para pagar, PC-77 $15,000.00 por autorizar, PA-12 $12,000.00 sin solicitud y TN-498 $40,000.00 cancelado. Cobros: Cliente Mayorista $60,000.00 (en 19 días) y Distribuidora Sur $18,000.00 (hace 3 días). Renta de la bodega $30,000.00 mensual |
| Bahía Comercial (BCO190101CD2) | Cliente real | Bruno (administración), sin datos de flujo |
| Demostración Lever (DEM200101EF3) | Demostración | Diana (administración) y cuatro asientos en el libro |

## Flujos

| Flujo | Quién | Qué se clicó y qué se verificó | Captura |
|---|---|---|---|
| (a) Empresa sin datos | Bruno | Inicio dice «Sin saldo declarado», no un saldo de $0.00. Ya no aparece «Saldo en el libro» ni «Confirmado por el banco». «Declarar el saldo» lleva al formulario | [a](a-empresa-sin-datos.jpg) |
| (b) Saldo declarado | Laura | Saldo y alertas tiene un solo h1, para lector de pantalla, y no tiene encabezado grande. Declara $120,000.00 al día anterior y luego $150,000.00 al día de hoy. La segunda petición se reenvía byte por byte (mismo id del formulario): responde «El saldo quedó declarado» y la página ya trae otro id. El historial conserva las dos; la base tiene 2 declaraciones y 2 eventos `declarar_saldo`, aunque cada una se envió con doble clic y la segunda además se repitió. Inicio muestra «Declarado por tu empresa», la fecha, el autor y «No es un saldo confirmado por el banco.» | [b](b-saldo-historial.jpg) |
| (c) Proyección | Laura | Las 13 semanas (lunes a domingo) coinciden una por una con un cálculo a mano hecho en el script: saldo inicial, entradas, salidas y saldo final. El cargo cancelado TN-498 y el cobro vencido no cuentan; la cuenta a mano también pone en la primera semana los cargos sin pagar programados antes del saldo (atrasados) | [c](c-proyeccion-13-semanas.jpg) |
| (d) Faltante | Laura | La alerta marca la primera semana con saldo final negativo (28 dic, −$14,000.00) y dice qué la provoca. Un cobro nuevo de $150,000.00 la quita; cancelarlo con motivo la regresa a la misma semana. Con un colchón de $30,000.00 la alerta se adelanta a la semana del 14 dic | [d1](d1-faltante.jpg), [d2](d2-sin-faltante.jpg), [d3](d3-faltante-colchon.jpg) |
| (h) Escenario | Laura | Mover TN-501 a la semana siguiente baja las salidas de su semana y sube las de la siguiente; el saldo a 13 semanas no cambia. En la base `programada_el` sigue igual y la bitácora no tiene eventos nuevos. La fecha del escenario no pasa del último día de la ventana (`max`). «Quitar el escenario» regresa a la proyección real | [h](h-escenario.jpg) |
| (e) Cobros | Laura | «Registrar un cobro» de la barra lleva al formulario. El cobro con fecha pasada aparece vencido. Alta manual de $22,500.50 con doble clic y luego la misma petición reenviada byte por byte: un solo cobro y un solo evento. Un XML emitido por otro RFC se rechaza con «Esta factura la emitió el RFC XAX010101000, no ALO180312AB1…». El XML propio se registra con origen cfdi, el receptor, el monto y su UUID; el mismo formulario reenviado con su mismo id responde «Quedó asentado» (no «ya está registrada») y sigue una sola fila. «Marcar cobrado» guarda la fecha real. Cancelar con motivo desde el filtro «Esperados»: la fila sale de la lista y el aviso «Quedó asentado» se queda. Filtros y total por cobrar de $78,000.00 | [e1](e1-xml-ajeno-rechazado.jpg), [e2](e2-cobros.jpg) |
| (f) Calendario | Laura | «Nueva obligación» de la barra lleva al formulario, que avisa que lo que llega como factura ya cuenta en Pagos a proveedores y deja elegir el proveedor que la factura. El mes muestra nómina, pago a proveedor, cobro y renta; el clic en cada uno abre su detalle en el panel con origen y monto. La renta cae el día 20 y el cobro vencido sale marcado. La plantilla «Impuestos provisionales» llena el siguiente día 17; se registra con doble clic y se reenvía byte por byte (una sola obligación y un solo evento), se edita el monto a $19,250.00, aparece en el mes y «Desactivar» la saca | [f1](f1-detalle-nomina.jpg), [f2](f2-calendario.jpg) |
| (g) Presupuestos | Laura | Operación: $91,000.00 de $90,000.00, excedido. Ventas: $35,000.00 de $40,000.00 (87.5 %), en atención. Inicio y Pendientes avisan de los dos. Al asignar Papelería Central a Ventas, su cargo PA-12 entra al presupuesto (Ventas pasa a $47,000.00, excedido) con su evento `asignar_area_proveedor`. El alta de proveedor guarda el área opcional | [g1](g1-presupuestos.jpg), [g2](g2-pendientes.jpg), [g3](g3-alta-proveedor-area.jpg) |
| (i) Correo semanal | Laura, Diego, cron | Laura apaga y enciende su resumen; Diego (contador) lo enciende. Sin secreto y con otro secreto: 401. Con el secreto: 200 (la tarea pide las empresas como `plataforma_tarea`) y el proveedor falso anota 4 correos (Laura, Fernanda y Diego de Altamar; Bruno de Bahía), uno por persona y con su entrega registrada; Diana, de la empresa de demostración, no recibe nada. Ningún correo dice «1 persona». La segunda llamada de la semana no manda nada. El de Altamar trae su saldo declarado con su origen; el de Bahía, que no declaró saldo, explica que sin saldo no se sabe si alcanza e invita a declararlo, y no trae ningún dato de Altamar | [i](i-correo-semanal.jpg) |
| (j) Permisos | Diego, Fernanda, Ernesto, Laura, Bruno, Diana | El contador abre las cinco páginas y no ve ningún formulario ni la acción de la barra; el formulario del saldo enviado a mano por él responde «Sin permiso para cambiar el flujo» y la base no cambia. Sin el permiso de detalle de nómina, ni el contador (Calendario, Presupuestos) ni finanzas (Inicio, Calendario, Presupuestos) ven «1 persona»: en Inicio de Fernanda la semana con la nómina de Carla dice «Nómina», y en el calendario de diciembre el pago de Carla sola dice «Monto reservado». Laura sí ve «(1 persona)» y todos los montos. Ernesto (sin la capacidad) recibe 404 en las cuatro páginas. Laura en Bahía y Bruno en Altamar: 404. En la empresa de demostración el libro sale marcado «Confirmado por el banco · demostración»; en Altamar nunca | [j1](j1-contador-solo-lectura.jpg), [j2](j2-empleado-404.jpg), [j3](j3-demostracion-libro.jpg), [j4](j4-contador-nomina-reservada.jpg) |
| (k) Temas y tamaños | Laura | Inicio, Cobros, Calendario y Presupuestos en Claro, Oscuro y Lever, a 1440 y 390: 200 y sin desplazamiento horizontal. Cada página lleva el título en la barra, un solo h1 (para lector de pantalla) y ningún encabezado grande, como en la Ola 1B | `k-<página>-<tema>-<ancho>.jpg` (24) |

### Doble clic en los envíos

Los formularios del flujo envían con `BotonEnviar` (#51): mientras la acción corre, el botón queda desactivado, dice «Enviando…» y lleva `aria-busy`. El recorrido hace un doble clic real (`dblclick` de Playwright) en nueve envíos: las dos declaraciones de saldo, el alta manual de cobro, el alta con XML, «Marcar cobrado», «Cancelar el cobro», el alta de la obligación, «Desactivar» y el área del proveedor. En cada uno exige tres cosas:

- el botón se vio ocupado durante la acción;
- el navegador mandó una sola acción de servidor;
- la base tiene una sola fila y un solo evento de bitácora para ese registro.

Como control negativo, el mismo `dblclick` sobre un botón que no se desactiva produce dos envíos.

### Reenvío con el mismo id del formulario

El doble clic lo frena el botón; un reintento de red o una segunda pestaña con la página vieja no. Saldo, cobro, cobro con XML y obligación llevan un id (UUID) que se genera al pintar la página, y el servidor lo usa como id de la fila. El recorrido repite byte por byte la petición capturada del saldo, del cobro y de la obligación, y reenvía el formulario del XML con su mismo id (el navegador no deja copiar los bytes del archivo de la petición capturada). En los cuatro casos la respuesta es la misma del primer envío y la base sigue con una fila y un evento. Las pruebas Postgres cubren además dos envíos simultáneos y un tercero después.

El orden de ejecución es a, b, c, d, h, e, f, g, i, j, k: (h) va antes de (e) porque cuenta con los cargos tal como quedan después de (d).

### Lo que el recorrido encontró y se corrigió en este PR

- Al cancelar o marcar cobrado un cobro, o al desactivar una obligación, el aviso «Quedó asentado» desaparecía junto con la fila. Ahora vive arriba de la lista (`AvisosDeLista`).
- En Cobros a 390 px, el «Acciones» oculto para lector de pantalla ensanchaba la página a 574 px. La tabla ahora contiene lo que oculta.
- A 390 px la proyección y los cobros dejaban fuera de la vista el saldo final, el monto y las acciones. Las dos tablas se apilan en móvil, con roles explícitos para que el lector de pantalla las siga leyendo como tabla.
- El cuerpo del correo semanal no nombraba a la empresa. Quien administra varias recibe un correo por cada una, así que el título ahora la nombra.

### Mensajes de consola que no son de esta zona

- 4 avisos «GL Driver Message» del fondo WebGL (motor de #47) en Chromium headless.
- 11 mensajes en las páginas que (j) abre a propósito y que deben responder 404: el 404 del documento y la advertencia de Chromium por las hojas de estilo que Next precarga para la ruta y el 404 no usa.

## Cómo repetirlo

Requisitos: Postgres 17 local desechable, el Chromium de Playwright (`npx playwright install chromium`) y un emulador de Blob local (cualquier servidor que hable la API de `@vercel/blob`; solo lo usa el alta de proveedor con constancia). Los archivos de trabajo (semillas, correos, secreto) van fuera del repositorio: el script rechaza rutas dentro de `docs/`.

```sh
# 1. Base nueva, migraciones y contraseña local del rol de la app
psql "postgres://<dueño>@127.0.0.1:5541/postgres" -c "drop database if exists plataforma with (force)" -c "create database plataforma"
DATABASE_URL_UNPOOLED=postgres://<dueño>@127.0.0.1:5541/plataforma bash db/migrate.sh
psql "postgres://<dueño>@127.0.0.1:5541/plataforma" -c "alter role plataforma_app login password '<clave local>'"

# 2. Siembra (imprime el JSON con la fecha y los ids)
DUENO_URL=postgres://<dueño>@127.0.0.1:5541/plataforma \
DATABASE_URL=postgres://plataforma_app:<clave local>@127.0.0.1:5541/plataforma \
  npx tsx scripts/evidencia/flujo-de-caja-siembra.ts > /fuera/del/repo/semillas.json

# 3. Compilar y arrancar con el correo falso y el secreto del cron
E2E_SERVER_ACTIONS=1 E2E_PUERTO=4806 npx next build
DATABASE_URL=postgres://plataforma_app:<clave local>@127.0.0.1:5541/plataforma \
URL_APLICACION=http://localhost:4806 AUTENTICACION_DOMINIOS=localhost AUTENTICACION_LLAVE_TOTP=<llave local> \
E2E_SERVER_ACTIONS=1 E2E_PUERTO=4806 \
CRON_SECRET="$(cat /fuera/del/repo/cron-secreto)" RESEND_API_KEY=<cualquiera> CORREO_REMITENTE="Lever Empresas <avisos@lever.test>" \
CORREO_FALSO_ARCHIVO=/fuera/del/repo/correos.jsonl \
BLOB_READ_WRITE_TOKEN=<token del emulador> VERCEL_BLOB_API_URL=http://127.0.0.1:4891/api/blob \
NODE_OPTIONS="--import=<preload del emulador de Blob> --import=./scripts/evidencia/flujo-de-caja-correo-falso.mjs" \
  npx next start -p 4806

# 4. Recorrido (SOLO=a,b,... corre solo esos flujos; SALIDA cambia la carpeta de capturas)
BASE=http://localhost:4806 DUENO_URL=postgres://<dueño>@127.0.0.1:5541/plataforma \
SEMILLAS=/fuera/del/repo/semillas.json CORREO_FALSO_ARCHIVO=/fuera/del/repo/correos.jsonl \
CRON_SECRET_ARCHIVO=/fuera/del/repo/cron-secreto TEMPORAL=/fuera/del/repo/tmp \
  node scripts/evidencia/flujo-de-caja.mjs

# 5. Rendimiento y correo con 200 empresas (cada uno crea y borra su propia base)
MEDICION_ADMIN_URL=postgres://<dueño>@127.0.0.1:5541/postgres npx tsx scripts/evidencia/flujo-de-caja-medicion.ts
MEDICION_ADMIN_URL=postgres://<dueño>@127.0.0.1:5541/postgres npx tsx scripts/evidencia/flujo-de-caja-correo-200.ts
```

El recorrido imprime `VALIDACION_FUNCIONAL_OK` al final y sale con 1 en la primera aserción que falla. No imprime URLs de conexión, tokens ni el secreto del cron.
