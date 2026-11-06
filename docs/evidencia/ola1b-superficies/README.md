# Ola 1B · superficies: evidencia

Recorrido clicado de Operación SOFIPO, la entrada de cliente, la invitación, recuperar contraseña, «Perdí el segundo factor», el teléfono, la landing, `/precios`, la 404 y las plantillas de correo.

- **Cómo se corrió:** Playwright headless desde node (no el navegador del MCP) contra `next build` + `next start` en 4808, sobre Postgres 17 local en 5543 recién migrado (0001-0025) y sembrado.
- **Temas y tamaños:** Oscuro, Claro y Lever, a 1440×900 y 390×844.
- **Script:** `scripts/evidencia/ola1b-superficies.mjs` (las plantillas de correo se renderizan con `scripts/evidencia/ola1b-correos.ts`).
- **Salida literal de la corrida final:** `salida-recorrido.txt`.
- **Detalle de cada comprobación:** `comprobaciones-flujos-publicas-capturas-correos-estados-comparacion.json`, con las comprobaciones, los pendientes y los errores de consola (lista vacía).

Nombre de cada captura: `<paso>-<pantalla>-<tema>-<ancho>.webp` (por ejemplo `13-operacion-aprobaciones-lever-390.webp`); correos: `correo-<plantilla>-<claro|oscuro>.webp`.

## Resultado

Corrida final sobre el head `5e4cf0b` (código del build `c8d83cd`; el commit siguiente solo toca el script del recorrido):

- **601 comprobaciones en verde** y ninguna falla. La última línea de `salida-recorrido.txt` es «601 comprobaciones en verde.».
- **0 errores de consola del navegador** en toda la corrida. En el estado de error provocado de Operación, se esperan 12 errores por el fallo que se provoca a propósito, y la corrida comprueba que no aparece ninguno más.
- **345 capturas** (`capturas/`), **6 plantillas de correo** con su HTML y su texto (`correos/`) y **3 láminas** de comparación con el diseño.
- **16 dobles clics** en envíos, contados en la base: cada uno deja una sola fila o un solo evento.
- **4 envíos retenidos** con un candado real de base: «Crear alerta», «Enviar el enlace», y Rechazar y Aprobar de Recuperaciones. Mientras la base retiene, el botón oprimido queda apagado y dice «Enviando…», con `aria-busy`. En Recuperaciones, el otro botón también se apaga, sin `aria-busy`, y conserva su texto.
- **1 pendiente**, fuera de esta zona: armarPaso (ver al final).

## Cómo repetirlo

1. **Base desechable en 5543.** Postgres 17 de Homebrew, sin Docker:

   ```sh
   initdb -D <carpeta> -U postgres --auth=trust
   pg_ctl -D <carpeta> -o "-p 5543 -k ''" start
   psql postgres://postgres@127.0.0.1:5543/postgres -c "create database plataforma"
   DATABASE_URL_UNPOOLED=postgres://postgres@127.0.0.1:5543/plataforma ./db/migrate.sh
   ```

   Después:
   - dale contraseña de entrada al rol `plataforma_app`;
   - siembra al personal SOFIPO con `OPERADORES_PLATAFORMA="op@lever.test,op2@lever.test" npx tsx scripts/plataforma.ts personal:migrar-variable`.

   Todo lo demás (Altamar Logística, Laura, alertas, comisiones, precios) lo crea el recorrido con clics.

2. **Servidor de producción en 4808.** `npm run build` y luego:

   ```sh
   E2E_SERVER_ACTIONS=1 E2E_PUERTO=4808 npx next start -p 4808
   ```

   Variables:
   - `DATABASE_URL` con el rol `plataforma_app`;
   - `AUTENTICACION_LLAVE_TOTP`;
   - `AUTENTICACION_DOMINIOS=localhost`;
   - `URL_APLICACION=http://localhost:4808`.

   El correo queda configurado pero sin salida, con un proxy local cerrado: cada envío falla y queda registrado, como pasaría si el proveedor no respondiera.

3. **Recorrido:**

   ```sh
   BASE=http://localhost:4808 \
   DUENO_URL=postgres://postgres@127.0.0.1:5543/plataforma \
   ESTADO=<archivo fuera del repo> \
   DISENO=<carpeta con plat-*.png y app-*.png del diseño> \
   node scripts/evidencia/ola1b-superficies.mjs
   ```

   - `ESTADO` guarda semillas TOTP y sesiones, por eso vive fuera del repositorio.
   - El script rechaza un `DUENO_URL` que no sea local.
   - `FASES=flujos,publicas,capturas,correos,estados,comparacion` permite correr solo una parte. `capturas`, `estados` y `comparacion` necesitan que `flujos` haya corrido antes sobre la misma base.

**Qué hace el script en la base como dueño** (nunca reemplaza un clic):
- fija el token de una invitación o de un enlace de recuperación, porque en local el correo no sale;
- envejece 6 minutos el segundo factor de una sesión para ver «Confirma que eres tú»;
- siembra la ficha de Laura y dos categorías de la política para el teléfono;
- cuenta las filas que prueban que un doble clic dejó una sola operación;
- provoca los estados de Operación: un candado de unos segundos para «cargando», y un permiso que retira y devuelve para «error».

## Personas del recorrido

- **op** y **op2** (`op@lever.test`, `op2@lever.test`): personal SOFIPO. Cada uno acepta su invitación en la pantalla real, pone contraseña, registra su app autenticadora (TOTP) y abre Operación.
- **Laura Méndez** (`laura@altamar.test`): primera administradora de Altamar Logística. op la invita desde la ficha del cliente, ella acepta, registra su app autenticadora y entra.

Cada entrada usa un código TOTP de un paso de 30 s que no se usó antes, porque el servidor rechaza pasos repetidos.

## Flujos

«Doble clic» es un doble clic real sobre el botón de envío; después el script cuenta en la base que quedó una sola operación.

Cada envío de la zona usa `BotonEnviar` (#51). En algunos el doble clic se hace mientras la base retiene la acción con un candado, para comprobar que el botón queda apagado, con `aria-busy` y «Enviando…», hasta que la base responde:
- «Crear alerta» (`16a`);
- «Enviar el enlace» (`40a`);
- Rechazar y Aprobar de Recuperaciones (`53a`). Comparten formulario: el que se oprimió dice «Enviando…» y el otro se apaga sin `aria-busy` y conserva su texto.

| # | Flujo | Capturas | Qué se comprobó |
| --- | --- | --- | --- |
| 3 | Invitación del personal hasta crear la cuenta | `30-op-invitacion`, `30-op-alta-factor`, `31-op2-*` | Doble clic en «Aceptar la invitación» deja una sola invitación usada; registra la app autenticadora y abre Operación en Resumen con un solo h1 |
| 1 | Entrada SOFIPO con segundo factor | `10-operacion-entrar`, `11-operacion-entrar-error`, `12-operacion-segundo-factor` | Contraseña equivocada: el error queda ligado al campo (`aria-describedby`) y el correo sigue escrito. Contraseña y código TOTP con doble clic en «Entrar con el código» |
| 1 | Operación vacía | `09a`…`09e` | Clientes «Todavía no hay clientes», Aprobaciones «Nada por decidir», Alertas «Sin alertas» y «Sin clientes», Comisiones «Sin versiones» y «Sin empresas activas», Recuperaciones «Sin solicitudes» |
| 1 | Clientes y ficha | `15-operacion-ficha-cliente` | Doble clic en «Registrar prospecto» = 1 empresa; en «Solicitar activación» = 1 solicitud; en «Enviar invitación» = 1 invitación |
| 1 | Aprobaciones | `13-operacion-aprobaciones`, `14-operacion-rechazar-dialogo` | Quien pidió la activación la ve sin botones («La pediste tú: decide otra persona.»). op2 aprueba con doble clic, que deja una sola transición a activa, y rechaza la otra con motivo desde el diálogo, que deja un solo rechazo |
| 1 | Alertas | `16-operacion-alertas`, `16a-operacion-crear-alerta-enviando` | Con la tabla de alertas retenida, «Crear alerta» queda apagado y dice «Enviando…». Doble clic en «Crear alerta» = 1 alerta; «Guardar responsable» la reasigna a op2; «Cerrar alerta» con motivo la cierra una vez |
| 1 | Comisiones | `17-operacion-comisiones` | Doble clic en «Pedir autorización» = 1 versión; op2 aprueba una (queda vigente) y rechaza otra con motivo |
| 1 | Bitácora, tema y seguridad | `87-operacion-bitacora`, `89-seguridad-sofipo` | La Bitácora lista los eventos del recorrido. El selector de tema del lateral cambia Operación a Claro. «Mi perfil y seguridad» abre `/entrar/seguridad` y «Volver a Operación» regresa |
| 1 | Precios | `18-precios-sofipo`, `19-precios-publicado` | `/precios` con sesión SOFIPO lleva a Precios dentro de Operación, marcado en la navegación. Doble clic en «Publicar el monto» deja 149 900 centavos y un solo evento en la bitácora |
| 2 | Entrada de cliente con contraseña y TOTP | `20-entrar`, `21-entrar-error`, `22-entrar-segundo-factor` | El error marca los campos con `aria-invalid` y `aria-describedby`, y el correo sigue escrito. Doble clic en «Continuar» abre una sola entrada; Laura entra con su código |
| 3 | Invitación del cliente | `33-laura-alta-factor`, `34-invitacion-inexistente` | Laura acepta (doble clic = 1 invitación usada), registra su app autenticadora y entra. Un enlace que no es invitación muestra un solo rótulo y su título |
| 6 | Teléfono | `35-telefono-sin-ficha`, `90`…`92` | Sin ficha en Personas lo dice y a quién pedirla. Con ficha: un solo h1 en Inicio; Topes muestra la categoría con tope y la que no tiene; Pedir factura muestra el RFC de la empresa y su QR; la barra de abajo y los accesos de Inicio llevan a Topes y Factura |
| 8 | `/precios` como cliente | `93-precios-cliente` | No ofrece publicar |
| 4 | Recuperar contraseña | `40-recuperar`, `40a-recuperar-enviando`, `41-recuperar-enviado`, `42-recuperar-nueva`, `43-recuperar-guardada`, `44-recuperar-enlace-usado` | Con la tabla de enlaces retenida, «Enviar el enlace» queda apagado y dice «Enviando…». Doble clic en «Enviar el enlace» = 1 enlace. Un correo sin cuenta recibe la misma respuesta y no crea enlace. Doble clic en «Guardar la contraseña» la restablece una vez; el enlace usado ya no sirve; Laura entra con la contraseña nueva y su segundo factor de siempre |
| 5 | «Perdí el segundo factor» | `50-perdi-factor`, `51-perdi-factor-en-revision`, `52-recuperaciones-confirma`, `53-recuperaciones-solicitud`, `53a-recuperaciones-rechazando` | Doble clic en «Pedir recuperación» = 1 solicitud. Con el factor de hace 6 minutos, Recuperaciones pide «Confirma que eres tú». op rechaza con nota (doble clic = 1 rechazo en la bitácora) y la solicitud sale de la lista. Laura vuelve a pedir. Con la página abierta, el factor de op se envejece 6 minutos y Aprobar no aprueba: `aviso=reautenticacion_factor`, la solicitud sigue abierta, 0 `recuperacion_aprobada` en la bitácora y vuelve «Confirma que eres tú». Con el valor del botón alterado (`aprobar-sin-permiso`) tampoco aprueba: cuenta como rechazo sin nota (`motivo_invalido`) y no decide. Con factor fresco, op aprueba (doble clic = 1 aprobación en la bitácora, con op como actor). Ver **Pendientes** |
| 1 | Salir | — | «Salir» del menú de la persona cierra la sesión de Operación |
| 8 | Landing y 404 | `60-404`, `70-landing`, `75-404` | Un solo h1. Cada enlace del menú lleva a su ancla. Cada pregunta frecuente abre y cierra con un clic. «Entrar» lleva a `/entrar`. En la 404, «Ir al inicio» y «Entrar a mi cuenta» llevan a su destino |
| 7 | Correos | `correo-*` | Ver **Correos** |

## Estados de Operación

| Estado | Capturas | Cómo se provoca y qué se comprobó |
| --- | --- | --- |
| Vacío | `09a`…`09e` | Plataforma recién creada: cada sección dice qué falta (tabla de flujos) |
| Cargando | `96-operacion-cargando-*` | La base sostiene un candado sobre las solicitudes de activación, que lee Clientes. Desde la Bitácora se pulsa «Clientes» y la página de antes sigue a la vista. En 1440, el enlace pedido muestra su progreso y anuncia «Cargando…» al lector de pantalla. En 390 el cajón se cierra al pulsar, y la barra de arriba muestra el progreso y «Cargando…» en un `role=status`; se mide el contraste AA en ese momento. Al soltar el candado llega Clientes y el progreso se va. Operación no tiene `loading.tsx` a propósito (f063a20, `tests/operacion/navegacion.test.ts`) |
| Cargando en la consola (390) | `96b-consola-cargando-*-390` | Laura pulsa «Personas» en el cajón, y el navegador retiene la respuesta de esa sección hasta comprobar la barra. Pendientes sigue a la vista y la barra muestra el progreso y «Cargando…», con contraste AA. Al llegar Personas, la barra deja de decirlo |
| Error | `97-operacion-error-*` | La base le niega a Operación la lectura de empresas. La sección lo dice dentro del marco, con la navegación a la mano, y «Reintentar» la vuelve a pedir al servidor: Clientes abre en cuanto la base responde. Los permisos quedan como estaban. Los únicos errores de consola son los del error provocado |
| Sin permiso | `98-operacion-sin-permiso-*` | Con sesión de cliente, `/operacion/clientes` lleva a la entrada de Operación |

## Capturas por pantalla (3 temas × 2 anchos)

Cada pantalla se abrió en Oscuro, Claro y Lever, a 1440 y a 390, y en cada combinación se midió el contraste. La consola del navegador se vigila durante todo el recorrido.

En Oscuro a 1440 se revisa además la accesibilidad de cada pantalla:
- tiene un solo h1;
- todos los campos tienen etiqueta;
- ningún elemento lleva tabindex positivo;
- con 25 pulsaciones de Tab, el foco avanza en el orden del documento y cada parada tiene foco visible (contorno, sombra o cambio en su caja).

| Grupo | Capturas |
| --- | --- |
| Sin sesión | `70-landing`, `71-entrar`, `72-operacion-entrar`, `73-recuperar`, `74-invitacion-inexistente`, `75-404`, `76-recuperar-enlace-invalido` |
| Personal SOFIPO | `80-operacion-resumen`, `81-operacion-clientes`, `82-operacion-ficha`, `83-operacion-aprobaciones`, `84-operacion-alertas`, `85-operacion-comisiones`, `86-operacion-recuperaciones`, `87-operacion-bitacora`, `88-precios-sofipo`, `89-seguridad-sofipo` |
| Cliente (Laura) | `90-telefono-inicio`, `91-telefono-topes`, `92-telefono-factura`, `93-precios-cliente`, `94-seguridad-cliente` |

## Contraste AA

Se usó el método del #50:
- se toma el color calculado de cada texto y se compara contra los píxeles reales de su fondo, con el texto oculto y la escena animada detrás;
- se mide la página completa, bajando pantalla por pantalla;
- el umbral es 4.5:1 para texto normal y 3:1 para texto grande.

El detalle está en `contraste.json`.

| Tema | Ancho | Textos medidos | Bajo AA | Mínimo |
|---|---|---|---|---|
| Oscuro | 1440 | 1108 | 0 | 4.86 |
| Oscuro | 390 | 743 | 0 | 4.86 |
| Claro | 1440 | 1108 | 0 | 4.86 |
| Claro | 390 | 743 | 0 | 4.81 |
| Lever | 1440 | 1108 | 0 | 4.86 |
| Lever | 390 | 743 | 0 | 4.86 |

También se midió a 390 la barra móvil mientras carga, en los 3 temas, sin fallas. En Operación se midieron 25 textos, con mínimos de 8.10 en Oscuro, 6.60 en Claro y 8.54 en Lever. En la consola se midieron 15 textos, con mínimos de 6.51, 5.25 y 5.55.

## Correos

Cada plantilla se renderiza a HTML (`scripts/evidencia/ola1b-correos.ts`) y se abre con el esquema claro y con el oscuro. El logo lo sirve este mismo `next start` (`public/lever-email.png`), y en cada una se comprueba que carga, con ancho natural mayor que 0 y alt «Lever Empresas».

Plantillas: `invitacion-empresa`, `invitacion-usuario`, `invitacion-personal`, `recuperar-contrasena`, `aviso-seguridad` y `aviso-clabe-nomina`. El HTML de cada una está en `correos/`.

## Comparación con el diseño

Láminas lado a lado: a la izquierda la captura del diseño de los socios y a la derecha la del producto, en Oscuro.

| Lámina | Diseño | Producto |
| --- | --- | --- |
| `comparacion-aprobaciones.webp` | `plat-02-aprobaciones` | Operación › Aprobaciones, 1440 |
| `comparacion-resumen.webp` | `plat-00-resumen` | Operación › Resumen, 1440 |
| `comparacion-telefono.webp` | `app-home` | Teléfono › Inicio, 390 |

Las cifras del diseño (saldos, tarjetas, gastos) no se copian: el producto muestra solo lo que existe en la base.

## Antes y después

El «antes» es la corrida del #50 en `docs/evidencia/sistema-visual/`, que ya traía tokens, tipografía y logotipo, pero no el trabajo de pantalla por pantalla:

| Pantalla | Antes | Después |
| --- | --- | --- |
| Entrada SOFIPO | `sistema-visual/90-operacion-entrar-oscuro-1440.webp` | `capturas/10-operacion-entrar-oscuro-1440.webp` |
| Segundo factor SOFIPO | `sistema-visual/91-operacion-totp-oscuro-1440.webp` | `capturas/12-operacion-segundo-factor-oscuro-1440.webp` |
| Resumen de Operación | `sistema-visual/92-operacion-resumen-oscuro-1440.webp` | `capturas/80-operacion-resumen-oscuro-1440.webp` |
| Clientes | `sistema-visual/93-operacion-clientes-oscuro-1440.webp` | `capturas/81-operacion-clientes-oscuro-1440.webp` |
| Recuperaciones | `sistema-visual/A12-recuperaciones-solicitud-oscuro-1440.webp` | `capturas/53-recuperaciones-solicitud-oscuro-1440.webp` |
| Entrada de cliente | `sistema-visual/01-entrar-oscuro-1440.webp` | `capturas/20-entrar-oscuro-1440.webp` |
| Teléfono | `sistema-visual/60-telefono-oscuro-1440.webp` | `capturas/90-telefono-inicio-oscuro-1440.webp` |
| 404 | `sistema-visual/61-404-oscuro-1440.webp` | `capturas/60-404-oscuro-1440.webp` |

## Pendientes que encontró el recorrido (fuera de esta zona)

- **La recuperación aprobada del segundo factor no deja registrar uno nuevo.** `armarPaso`, en `src/server/autenticacion/servicio.ts`, devuelve «verificar» mientras la persona conserve un factor. El recorrido lo marca como `PENDIENTE` y Laura entra con el factor que conserva. El líder lo confirmó en main y lo asignó a seguridad-cuentas en un PR aparte (`fix/recuperacion-factor-nuevo`).
