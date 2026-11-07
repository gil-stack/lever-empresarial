# Evidencia de la Ola 2b: navegación del diseño, modo demostración y Aprobaciones

Recorrido con Playwright headless propio (`scripts/evidencia/ola-2b-navegacion.mjs`) contra `next build` + `next start` en el puerto 4812 y un Postgres 17 local en 5552, sembrado desde cero por `scripts/evidencia/ola-2b/preparar.ts`:

- **Taller del Cierre**, empresa **real** (`demostracion = false`): la semilla de Pagos a proveedores con dos pagos por autorizar que pidió Gil, una nómina semanal vencida y sin lote, y una persona por rol (Ana administradora, Fernanda finanzas, Carla contadora, Rosa liberadora, Sergio solicitante).
- **Altamar Logística**, empresa de **demostración**, dada de alta por el personal del operador, con Laura (administradora) y Daniela (solicitante).

Corrida final del 2026-11-07 sobre el head del PR, en este orden: `lado`, `pantallas` (3 temas), `contraste` (3 temas), `cargando`, `flujos` y `caida`. Los flujos mueven datos de la base local, por eso van después de las capturas que necesitan los pagos por autorizar.

| Modo | Qué revisa | Resultado |
| --- | --- | --- |
| `flujos` | Los flujos 1-6 del brief, clicados, con doble clic y conteo en la base | **180 de 180** |
| `lado` | Los 16 módulos junto a su captura del diseño (`lado-a-lado/`) | **32 de 32** |
| `pantallas` | 27 pantallas nuevas en Claro, Oscuro y Lever, a 1440 y 390: responde 200, un solo h1, campos y botones con nombre, errores ligados al campo, sin desplazamiento horizontal, consola limpia y, en Oscuro 1440, cada parada de Tab en orden y con foco visible | **851 de 851** |
| `contraste` | AA de cada texto contra la escena real (método del #50) | Oscuro 4.70 / 5.09 · Claro 4.97 / 4.50 · Lever 4.62 / 5.13 (mínimo a 1440 / 390, sobre 4.5) |
| `cargando` | «Cargando…» de una sección nueva mientras llega la página, con el marco quieto | **9 de 9** |
| `caida` | Con Postgres apagado, Aprobaciones, Perfil y un módulo demo dicen que no se pudo (o «Disponible pronto») dentro del marco, sin datos | **54 de 54** |

Los resultados de cada comprobación están en `datos/*.json`.

## Flujos (`flujos/`)

1. **Lateral por rol** en escritorio y en el cajón móvil (Ana, Fernanda, Carla, Rosa y Sergio): cada rol ve lo que su puerta abre y nada más, cada enlace responde 200, un clic en el último enlace navega y lo marca, y el cajón atrapa el foco (40 tabulaciones sin salir) y Escape lo cierra devolviendo el foco a «Secciones».
2. **Módulos de demostración** en Altamar: cada uno abre con el aviso «Demostración», ningún botón que mueva dinero está encendido, no hay formularios POST y un clic forzado en un botón marcado no envía nada. Lo que sí se mueve: «Presupuestos por área» en Tarjetas, «Filtrar» por persona en Movimientos (deja solo sus compras) y «Lista 69-B» desde Fiscal (abre la lista real y el lateral sigue en Fiscal).
3. **Empresa real**: cada módulo dice «Disponible pronto», sin dígitos ni marca de demostración. El **HTML** y la **carga RSC** (`text/x-component`) de cada uno se revisan contra los 51 centinelas de `src/server/demo/centinelas.ts` y no traen ninguno. Control positivo: la misma prueba sobre Altamar sí encuentra el saldo de ejemplo en el HTML y en la RSC de Cuenta.
4. **Aprobaciones**:
   - Rosa autoriza el pago N-204 con **doble clic**: queda listo para pagar con **un solo evento** en la bitácora y la fila sale de la bandeja.
   - Rosa rechaza el otro con el atajo **R**, motivo y doble clic: rechazado con su motivo y un solo evento.
   - Gil pidió los pagos: no se le ofrecen para autorizar.
   - Ana prepara la nómina con **doble clic**: un lote, un evento y la página abre el lote (`4e`). El contador del lateral es el mismo número que «Pendientes · N» y baja en uno.
   - Historial muestra la autorización, el rechazo y el lote.
   - `/consola/pendientes` responde **307 a Aprobaciones** y se llega con el mismo número. Con poco saldo declarado con clics en Saldo y alertas, la **alerta de faltante** aparece en Aprobaciones al entrar por la dirección vieja y su enlace lleva a la proyección (`4g`).
   - Sergio, sin nada que decidir, ve «Estás al corriente» con sus atajos.
5. **Rutas viejas**: Lista 69-B y Póliza abren y marcan Fiscal, Personas marca Nómina, el flujo de caja y Proveedores marcan lo suyo, Política, Configuración y Apariencia viven en «Más». La contadora, sin Resumen, aterriza en Aprobaciones al abrir `/consola`, y Tarjetas, que su rol no abre, responde 404 aunque escriba la dirección.
6. **«Más» y Perfil**: el menú de la tarjeta de la empresa trae Tú (Mi perfil, Apariencia, Teléfono) y Empresa (Configuración, Políticas, Integraciones). Mi perfil muestra nombre, correo, empresa y rol, y sus enlaces abren Seguridad y Apariencia. Integraciones, en la empresa real, dice «Disponible pronto».

## Lado a lado (`lado-a-lado/`)

A la izquierda la captura del diseño (`plat-00…15`), a la derecha la pantalla de Altamar en Oscuro a 1440. Diferencias que se quedan a propósito:

- **Barra superior**: el diseño trae «WhatsApp» y «Fondear cuenta» en todas las páginas. No se agregan: en los módulos reales nada promete un movimiento de dinero sin proveedor, y la búsqueda es la que ya existe por rol.
- **Lateral**: lleva el grupo **Flujo de caja** (Saldo y alertas, Cobros, Calendario y Presupuestos) justo debajo de la operación diaria. Gil decidió que el flujo de caja no pierde lugar.
- **Marca «Demostración»** en cada botón que movería dinero o crearía algo: hace los botones más anchos que en el diseño (Cuenta, Conciliación).
- **Aprobaciones** se compara con la bandeja real de Taller del Cierre vista por la liberadora. Las solicitudes del diseño (saldo con crédito, aumento de límite, reembolsos, tarjeta adicional) no existen como acciones, y la regla «arriba de $50,000.00 se requiere una segunda aprobación» tampoco: no se inventan reglas de dinero ni umbrales, así que la bandeja pinta lo que sí aplica (pagos a proveedores por autorizar y nómina por preparar).
- **Fiscal** agrega arriba los enlaces a la Lista 69-B y la Póliza reales, que ahora viven dentro de Fiscal.
- **Movimientos**: el mapa es esquemático (SVG propio), sin teselas de un tercero.
- **Resumen, Proveedores y Nómina** son los módulos reales con los datos de Altamar, no los del prototipo.

## Correr el recorrido

```sh
# Postgres 17 desechable en 5552 (LC_ALL=C para que arranque en macOS)
DUENO_URL=postgres://postgres@127.0.0.1:5552/postgres ./node_modules/.bin/tsx scripts/evidencia/ola-2b/preparar.ts > test-results/ola-2b/entorno.json
E2E_SERVER_ACTIONS=1 E2E_PUERTO=4812 ./node_modules/.bin/next build
DATABASE_URL=<la de entorno.json> E2E_SERVER_ACTIONS=1 E2E_PUERTO=4812 ./node_modules/.bin/next start -p 4812 -H 127.0.0.1
DISENO=<carpeta de capturas del diseño> node scripts/evidencia/ola-2b-navegacion.mjs lado
TEMAS=oscuro SUFIJO=-oscuro node scripts/evidencia/ola-2b-navegacion.mjs pantallas   # y claro, lever
TEMAS=oscuro SUFIJO=-oscuro node scripts/evidencia/ola-2b-navegacion.mjs contraste   # y claro, lever
node scripts/evidencia/ola-2b-navegacion.mjs cargando
node scripts/evidencia/ola-2b-navegacion.mjs flujos      # mueve datos: va al final
node scripts/evidencia/ola-2b-navegacion.mjs sesiones    # y luego, con Postgres apagado:
node scripts/evidencia/ola-2b-navegacion.mjs caida
```

`psql` tiene que estar en el `PATH`. El script solo acepta un Postgres en 127.0.0.1 o localhost.
