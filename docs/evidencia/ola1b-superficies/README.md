# Ola 1B · superficies: evidencia

Recorrido clicado de Operación SOFIPO, la entrada de cliente, la invitación, recuperar contraseña, «Perdí el segundo factor», el teléfono, la landing, `/precios`, la 404 y las plantillas de correo.

- **Cómo se corrió:** Playwright headless desde node (no el navegador del MCP) contra `next build` + `next start` en 4808, sobre Postgres 17 local en 5543 recién migrado (0001-0027) y sembrado.
- **Temas y tamaños:** Oscuro, Claro y Lever, a 1440×900 y 390×844.
- **Script:** `scripts/evidencia/ola1b-superficies.mjs` (las plantillas de correo se renderizan con `scripts/evidencia/ola1b-correos.ts`).
- **Salida literal:** `salida-recorrido.txt` (corrida completa) y `salida-ronda.txt` (repetición parcial de la ronda del #56).
- **Detalle de cada comprobación:** `comprobaciones-flujos-publicas-capturas-correos-estados-comparacion.json` y `comprobaciones-ronda.json`, con las comprobaciones, los pendientes, los errores de consola y las vistas de contraste repetidas.

Nombre de cada captura: `<paso>-<pantalla>-<tema>-<ancho>.webp` (por ejemplo `13-operacion-aprobaciones-lever-390.webp`); correos: `correo-<plantilla>-<claro|oscuro>.webp`.

## Qué corrió en cada head

| Head | Qué cambió | Qué corrió |
| --- | --- | --- |
| `d115278` | Reenviar invitación solo reemplaza la invitación que se tenía en pantalla («vista») | Corrida completa: 653 comprobaciones (abajo, **Resultado**) |
| `5176abb` | Renglones alineados en su origen (`componentes.css`), prueba Postgres de la invitación sin previa y texto nuevo de `invitacion_ya_enviada` | Solo la prueba Postgres de Operación; su repetición visual va con el head siguiente |
| head de este commit | Ventana de 2 s contra el doble clic en Reenviar (además de «vista») y medición de renglones | Repetición parcial (fase `ronda`, abajo) sobre el build de este código, más los gates completos del cuerpo del PR |

**Por qué hubo un head más.** En la primera corrida de la fase `ronda`, sobre el build de `5176abb`, el doble clic en «Reenviar invitación» dejó 3 invitaciones (44.269 y 44.354 s, 85 ms entre clics). El primer envío terminaba y la ficha se refrescaba con la «vista» nueva antes del segundo clic, así que el segundo pasaba la guarda. En la corrida completa no se vio por cuestión de tiempos. Ahora el servidor tampoco emite otra si la última invitación de la empresa salió hace menos de 2 s, con o sin «vista». Lo cubre `tests/operacion/portal-postgres.test.ts` con reloj inyectado: con la «vista» vigente a 1 s se rechaza, sin «vista» a 1 s también, y a los 3 s emite. Con la ventana en 0, esa prueba falla.

**Lo que no volvió a correr.** El paso de Reenviar de `flujos` ahora espera 2.5 s antes del doble clic (`pasarVentanaDeDobleClic`) para que el reenvío a propósito no caiga en la ventana. La corrida completa no se repitió, porque el líder pidió repetir solo lo de abajo. El mismo paso, con la misma espera, sí corrió en la fase `ronda`.

## Repetición parcial: fase `ronda`

`FASES=ronda`, sobre la base de la corrida completa y con el build del head de este commit: **39 comprobaciones en verde** (25 aserciones y 14 capturas), 0 errores de consola del navegador, 0 vistas de contraste repetidas y 3 pendientes (la insignia, ver **Renglones**).

- **Reenvío con doble clic.** Bahía Oeste se registra y se activa con clics (op pide y op2 aprueba).
  - Sin invitación previa, el doble clic en «Enviar invitación» deja 1 invitación y 1 correo.
  - Pasada la ventana, el doble clic en «Reenviar invitación» deja 2 invitaciones (1 anulada y 1 vigente) y 2 correos.
  - Quien hizo el doble clic ve «Ya se había enviado una invitación más reciente. El enlace vigente es el de ese último correo.» porque su segundo clic sí llegó al servidor y fue rechazado (`15d-operacion-reenvio-doble-clic`).
  - Una ficha abierta antes del reenvío intenta reenviar y recibe el mismo texto como alerta (`role=alert`, sin `role=status`), sin otra invitación ni otro correo (`15b-operacion-invitacion-ya-enviada`, que reemplaza la de la corrida completa).
- **Ficha de cliente y Hoja de Operación** en 3 temas × 1440/390, con contraste AA: `15c-operacion-ficha-renglones-*` (384 textos) y `17b-operacion-comisiones-hoja-*` (183 textos), 0 bajo AA.
- **Renglones** medidos sobre el build (siguiente sección).

## Renglones: etiqueta y valor en la misma línea base

`.renglones > div` lleva `align-items: baseline` en `componentes.css` (fuera de zona, aprobado por el líder). Antes la etiqueta (0.9rem con 3 px de relleno arriba) quedaba 4 px más abajo que el valor (13.5 px).

**Cómo se mide.** En cada renglón con etiqueta y valor lado a lado se inserta un punto de alto 0 justo antes del primer texto de cada uno y se toma su borde inferior, que es la línea base. Si ese texto vive dentro de un flex o un grid, se envuelve en un span que ocupa su lugar. Se mide en los 3 temas a 1440 sobre `next start`.

| Pantalla | Renglones | Δ máximo |
| --- | --- | --- |
| Operación › ficha de Bahía Oeste | 4 | 0 px |
| Operación › ficha de Altamar Logística | 4 | 0 px |
| Consola › Configuración | 2 | 0 px |
| Consola › ficha de Laura en Personas | 4 | 0 px |
| Muestrario | 3 de 4 | 0 px |

**Muestrario › «Insignias»: Δ 1.3 px, fuera de la regla del renglón.** La regla sí alinea la línea base del valor con la de la etiqueta: la base de la etiqueta (962.39) coincide con el borde inferior del punto `::before` de la primera insignia (962.40). El texto dentro de la insignia queda 1.3 px abajo porque `.insignia` es flex con `align-items: center`, así que su línea base sale de ese punto, que no tiene texto. En el muestrario la insignia va dentro de un flex (`.fila-muestra`), donde el `vertical-align: 1px` de `.insignia` no aplica; una insignia suelta en un renglón no apareció en las pantallas medidas. Corregirlo toca `.insignia` en `componentes.css`, un componente del sistema fuera de esta zona: queda en **Pendientes**.

## Resultado

Corrida completa de la ronda del #56, con main integrado (#52), y build y script del commit `d115278`:

- **653 comprobaciones en verde** y ninguna falla. La última línea de `salida-recorrido.txt` es «653 comprobaciones en verde.». Se reparten así:
  - **289 aserciones**: lo que se comprueba en la página o en la base;
  - **361 capturas**: cada una cuenta como una comprobación al guardarse;
  - **3 láminas** de comparación con el diseño.
- **0 errores de consola del navegador** en toda la corrida. En el estado de error provocado de Operación, se esperan 12 errores por el fallo que se provoca a propósito, y la corrida comprueba que no aparece ninguno más.
- Las capturas están en `capturas/`; las **7 plantillas de correo**, con su HTML y su texto, en `correos/`; las láminas, junto a este README.
- **Dobles clics:** cada envío del recorrido se oprime con doble clic y la corrida cuenta en la base que quede una sola operación: una sola fila, un solo evento, un solo código gastado, un solo correo o una sola sesión cerrada. Están en `salida-recorrido.txt` como «doble clic…» o «…una sola…».
- **4 envíos retenidos** con un candado real de base: «Crear alerta», «Enviar el enlace», y Rechazar y Aprobar de Recuperaciones. Mientras la base retiene, el botón oprimido queda apagado y dice «Enviando…», con `aria-busy`. En Recuperaciones, el otro botón también se apaga, sin `aria-busy`, y conserva su texto.
- **0 pendientes** en la corrida completa.

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
   - `FASES=ronda` también corre sobre esa base y exige que la empresa de la ronda (Bahía Oeste, `BOE190101AB5`) todavía no exista.

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
| 1 | Entrada SOFIPO con segundo factor | `10-operacion-entrar`, `11-operacion-entrar-error`, `12-operacion-segundo-factor` | Contraseña equivocada: el error queda ligado al campo (`aria-describedby`) y el correo sigue escrito. Contraseña y código TOTP con doble clic en «Entrar con el código». Al final, op entra con un código de respaldo de los que vio al registrar su app (doble clic = 1 código gastado) |
| 1 | Operación vacía | `09a`…`09e` | Clientes «Todavía no hay clientes», Aprobaciones «Nada por decidir», Alertas «Sin alertas» y «Sin clientes», Comisiones «Sin versiones» y «Sin empresas activas», Recuperaciones «Sin solicitudes» |
| 1 | Clientes y ficha | `15-operacion-ficha-cliente` | Doble clic en «Registrar prospecto» = 1 empresa; en «Solicitar activación» = 1 solicitud; en «Enviar invitación» = 1 invitación. Doble clic en «Reenviar invitación» anula el enlace anterior, deja uno solo vigente y registra un solo correo. Desde una ficha abierta antes del reenvío, «Reenviar invitación» no emite otra y la base no cambia. En esta corrida (`d115278`) el aviso decía «La invitación ya había salido hace un momento…»; el texto vigente y la ventana de 2 s se comprobaron en la fase `ronda` (`15b`, `15d`) |
| 1 | Aprobaciones | `13-operacion-aprobaciones`, `14-operacion-rechazar-dialogo` | Quien pidió la activación la ve sin botones («La pediste tú: decide otra persona.»). op2 aprueba con doble clic, que deja una sola transición a activa, y rechaza la otra con motivo desde el diálogo, que deja un solo rechazo |
| 1 | Alertas | `16-operacion-alertas`, `16a-operacion-crear-alerta-enviando`, `16b-operacion-alerta-ya-cerrada` | Con la tabla de alertas retenida, «Crear alerta» queda apagado y dice «Enviando…». Doble clic en «Crear alerta» = 1 alerta; «Guardar responsable» la reasigna a op2; «Cerrar alerta» con motivo la cierra una vez y se anuncia como hecho (`role=status`). Otra pestaña que intenta cerrar la misma alerta recibe «La alerta ya estaba cerrada.» como alerta (`role=alert`) y la base no cambia |
| 1 | Comisiones | `17-operacion-comisiones` | Doble clic en «Pedir autorización» = 1 versión; op2 aprueba una (queda vigente) y rechaza otra con motivo |
| 1 | Bitácora, tema y seguridad | `87-operacion-bitacora`, `89-seguridad-sofipo` | La Bitácora lista los eventos del recorrido. El selector de tema del lateral cambia Operación a Claro. «Mi perfil y seguridad» abre `/entrar/seguridad` y «Volver a Operación» regresa |
| 1 | Precios | `18-precios-sofipo`, `19-precios-publicado` | `/precios` con sesión SOFIPO lleva a Precios dentro de Operación, marcado en la navegación. Doble clic en «Publicar el monto» deja 149 900 centavos y un solo evento en la bitácora |
| 2 | Entrada de cliente con contraseña y TOTP | `20-entrar`, `21-entrar-error`, `22-entrar-segundo-factor` | El error marca los campos con `aria-invalid` y `aria-describedby`, y el correo sigue escrito. Doble clic en «Continuar» abre una sola entrada; Laura entra con su código. Más adelante entra con un código de respaldo (doble clic = 1 código gastado) |
| 3 | Invitación del cliente | `33-laura-alta-factor`, `34-invitacion-inexistente` | Laura acepta (doble clic = 1 invitación usada) y registra su app autenticadora. Con los códigos a la vista se recarga la página: queda «Ya puedes entrar.» y «Entrar al portal» (doble clic) abre el portal. Un enlace que no es invitación muestra un solo rótulo y su título |
| 6 | Teléfono | `35-telefono-sin-ficha`, `90`…`92` | Sin ficha en Personas lo dice y a quién pedirla. Con ficha: un solo h1 en Inicio; Topes muestra la categoría con tope y la que no tiene; Pedir factura muestra el RFC de la empresa y su QR; la barra de abajo y los accesos de Inicio llevan a Topes y Factura. «Salir» (doble clic) cierra esa sesión: la base la borra y `/telefono` ya no abre |
| 8 | `/precios` como cliente | `93-precios-cliente` | No ofrece publicar |
| 4 | Recuperar contraseña | `40-recuperar`, `40a-recuperar-enviando`, `41-recuperar-enviado`, `42-recuperar-nueva`, `43-recuperar-guardada`, `44-recuperar-enlace-usado` | Con la tabla de enlaces retenida, «Enviar el enlace» queda apagado y dice «Enviando…». Doble clic en «Enviar el enlace» = 1 enlace. Un correo sin cuenta recibe la misma respuesta y no crea enlace. Doble clic en «Guardar la contraseña» la restablece una vez; el enlace usado ya no sirve; Laura entra con la contraseña nueva y su segundo factor de siempre |
| 5 | «Perdí el segundo factor» | `50-perdi-factor`, `51-perdi-factor-en-revision`, `52-recuperaciones-confirma`, `53-recuperaciones-solicitud`, `53a-recuperaciones-rechazando`, `53b-recuperaciones-sin-metodo`, `54-perdi-factor-registrar-nuevo` | «Perdí el segundo factor» dice que pedir ayuda no quita nada y que, al registrar el factor nuevo, los anteriores dejan de servir (3 temas × 2 anchos, con contraste). Doble clic en «Pedir recuperación» = 1 solicitud. Con el factor de hace 6 minutos, Recuperaciones pide «Confirma que eres tú». El método de verificación arranca vacío («Elige cómo verificaste»). Enter en la Nota escribe una línea y no decide: la solicitud sigue abierta. El atajo «A» sin método no aprueba (0 aprobaciones): el foco va al método, que queda con `aria-invalid` y su error ligado (`53b`); elegir el método quita el error. `motivo_invalido` marca la Nota y `verificacion_invalida` marca el método. op rechaza con nota (doble clic = 1 rechazo en la bitácora) y la solicitud sale de la lista. Laura vuelve a pedir. Con la página abierta, el factor de op se envejece 6 minutos y Aprobar no aprueba: `aviso=reautenticacion_factor`, la solicitud sigue abierta, 0 `recuperacion_aprobada` en la bitácora y vuelve «Confirma que eres tú». Con el valor del botón alterado (`aprobar-sin-permiso`) tampoco aprueba: cuenta como rechazo sin nota (`motivo_invalido`) y no decide. Con factor fresco, op aprueba (doble clic = 1 aprobación en la bitácora, con op como actor) y la página dice qué provoca aprobar. Laura entra y la entrada ofrece «Registra un factor nuevo.» (#55): registra la app nueva y en la base queda una sola activa y la recuperación cumplida |
| 1 | Salir | — | «Salir» del menú de la persona cierra la sesión de Operación |
| 2 | Seguridad de la cuenta (cliente) | `94-seguridad-cliente`, `94a-seguridad-codigos-nuevos` | «Agregar una passkey» con el autenticador virtual de Chromium. Doble clic en «Revocar la app» = 1 app revocada; «Configurar la app autenticadora» y doble clic en «Confirmar» = 1 app activa. «Generar códigos nuevos»: «Volver a Seguridad» espera la casilla y regresa a la misma página con la cuenta al día. Con el factor de hace 6 minutos, «Confirma que eres tú» con un código de respaldo (doble clic = 1 código gastado). Doble clic en «Revocar» de la passkey = 1 passkey revocada. Ninguno muestra error |
| 8 | Landing y 404 | `60-404`, `70-landing`, `75-404` | Un solo h1. Cada enlace del menú lleva a su ancla. Cada pregunta frecuente abre y cierra con un clic. «Entrar» lleva a `/entrar`. En la 404, «Ir al inicio» y «Entrar a mi cuenta» llevan a su destino |
| 7 | Correos | `correo-*` | Ver **Correos** |

## Estados de Operación

| Estado | Capturas | Cómo se provoca y qué se comprobó |
| --- | --- | --- |
| Vacío | `09a`…`09e` | Plataforma recién creada: cada sección dice qué falta (tabla de flujos) |
| Cargando | `96-operacion-cargando-*` | La base sostiene un candado sobre las solicitudes de activación, que lee Clientes. Desde la Bitácora se pulsa «Clientes» y la página de antes sigue a la vista. En 1440, el enlace pedido muestra su progreso y anuncia «Cargando…» al lector de pantalla. En 390 el cajón se cierra al pulsar, y la barra de arriba muestra el progreso y «Cargando…» en un `role=status`; con el cajón ya fuera, se mide el contraste AA en ese momento. Al soltar el candado llega Clientes y el progreso se va. Operación no tiene `loading.tsx` a propósito (f063a20, `tests/operacion/navegacion.test.ts`) |
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

Cada vista se comprueba antes de contarla. Antes y después de la captura, la regla que oculta el texto sigue puesta y ningún elemento conserva su color, y ningún texto cambió de lugar. Una vista que no lo cumple no cuenta: se anota, se recarga la página y se repite (hasta 3 veces; a la tercera es falla). En esta corrida no hubo que repetir ninguna. La regla también apaga las transiciones, para leer el color final y no uno a medio camino.

El detalle está en `contraste.json`.

| Tema | Ancho | Textos medidos | Bajo AA | Mínimo |
|---|---|---|---|---|
| Oscuro | 1440 | 1283 | 0 | 4.86 |
| Oscuro | 390 | 743 | 0 | 4.86 |
| Claro | 1440 | 1283 | 0 | 4.86 |
| Claro | 390 | 743 | 0 | 4.81 |
| Lever | 1440 | 1283 | 0 | 4.86 |
| Lever | 390 | 743 | 0 | 4.86 |

También se midió a 390 la barra móvil mientras carga, en los 3 temas, sin fallas. En Operación se midieron 25 textos, con mínimos de 8.10 en Oscuro, 6.60 en Claro y 8.54 en Lever. En la consola se midieron 15 textos, con mínimos de 6.51, 5.25 y 5.55.

## Correos

Cada plantilla se renderiza a HTML (`scripts/evidencia/ola1b-correos.ts`) y se abre con el esquema claro y con el oscuro. El logo lo sirve este mismo `next start` (`public/lever-email.png`), y en cada una se comprueba que carga, con ancho natural mayor que 0 y alt «Lever Empresas».

Plantillas: `invitacion-empresa`, `invitacion-usuario`, `invitacion-personal`, `recuperar-contrasena`, `aviso-seguridad`, `aviso-clabe-nomina` y `resumen-semanal` (la que trajo #52 para los lunes; sus cifras de ejemplo usan los mismos formateadores que el envío real). El HTML de cada una está en `correos/`.

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

- **Texto de la insignia 1.3 px abajo de la etiqueta** en el renglón «Insignias» del muestrario (ver **Renglones**). Está en `.insignia` de `componentes.css`, un componente del sistema. Una forma de corregirlo, sin probar: `align-items: baseline` en `.insignia` y `align-self: center` en su `::before`, y revisar el `vertical-align: 1px`. No se tocó porque solo se aprobó la regla del renglón.
- La recuperación aprobada que no dejaba registrar un factor nuevo (armarPaso) se corrigió en #55, ya integrado aquí, y el recorrido la recorre completa.
