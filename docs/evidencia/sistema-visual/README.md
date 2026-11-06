# Sistema visual de Lever Empresas: evidencia

Recorrido clicado con Playwright headless propio (no el navegador del MCP) contra `next dev` en 4802, Postgres 17 local en 5521 y el emulador de Blob en 4897. Tres temas (Oscuro, Claro, Lever) × dos tamaños (1440×900 y 390×844). Las capturas están en WebP (≈50 KB cada una).

Nombre de cada captura: `<paso>-<tema>-<ancho>.webp` (por ejemplo `10-inicio-lever-390.webp`); Apariencia: `A<n>-<paso>-apariencia.webp`.

## Datos del recorrido

- **Laura Méndez** (`laura@lever.test`): administradora de Altamar Logística (alta con `empresa:alta --demostracion --mostrar-enlace`) y de Taller del Cierre (semilla `tests/e2e/seed-pagos.sql`, con proveedores, pagos y lista 69-B). Aceptó su invitación en la pantalla real, puso contraseña e inscribió la app autenticadora (TOTP).
- En Altamar, Laura creó por la interfaz el área «Operación» y a «Operativo Nómina» (nómina quincenal, CLABE 002180701150123452) y «Tomás Tarjeta» (solo ficha).
- **op** (`op@lever.test`): personal SOFIPO; aceptó la invitación de personal e inscribió TOTP para Operación SOFIPO.
- Asientos de Inicio con `scripts/evidencia/inicio-pendientes-asientos.sql`.
- En la base local, Taller del Cierre se renombró a «Taller del Cierre y Servicios Logísticos del Bajío, S.A.P.I. de C.V.» para probar el menú de empresa con una razón social larga (`M1`, `M3`).
- «Confirma que eres tú» aparece cuando el segundo factor de la sesión tiene más de 5 minutos. Para no esperar, `seguridad.mjs` lo envejece 6 minutos con SQL de dueño en la base desechable (`ADMIN_URL`); el código TOTP que lo confirma se teclea en la pantalla real.

Cada entrada (consola y Operación) se hizo con contraseña y un código TOTP de un paso de 30 s no usado antes; el servidor rechaza pasos repetidos.

## Pasos clicados por tema y tamaño

| Paso | Captura | Qué se comprobó |
| --- | --- | --- |
| Entrada | `01-entrar`, `02-entrar-totp`, `03-empresas` | Contraseña → código TOTP → elige empresa. `data-tema` del `<html>` = tema de la cookie |
| Inicio | `10-inicio` | Sección con `aria-current="page"`, título de la barra en Sora 300 |
| Cajón móvil (390) | `11-cajon-abierto` | Abre; 25 Tab no sacan el foco del cajón; Escape lo cierra y regresa el foco a «Secciones»; navegar desde el cajón lo cierra |
| Pendientes | `12-pendientes`, `45-taller-pendientes` | Bandeja con el aspecto del diseño |
| Personas | `20-personas-directorio`, `21-personas-busqueda`, `22-personas-ficha`, `23-personas-ficha-scroll`, `24-nomina` | El buscador de la barra lleva a Personas con `?q=`; la ficha abre; al hacer scroll la barra toma `data-desplazada` (desenfoque) |
| Política, 69-B, Configuración | `30-politica`, `31-lista-69b`, `32-configuracion` | Navegación por el lateral |
| Menú de la persona | `40-menu-persona`, `41-seguridad`, `42-apariencia`, `43-empresas`, `80-salir` | Cuatro opciones (Mi perfil y seguridad, Apariencia, Cambiar de empresa, Salir), cada una clicada; Escape cierra el menú y regresa el foco al chip. En `/empresas`, sin empresa elegida, no aparece Apariencia |
| Teclado del menú (`marco.mjs`) | — | Las opciones llevan `tabindex="-1"`; al abrir, el foco va a la primera; Tab y Escape cierran el menú y regresan el foco al botón |
| Menú de empresa largo (1440) | `M1-menu-empresa-larga` | El menú sale del lateral (280 px sobre un lateral de 240 px) y la razón social larga se lee completa, encima de la página |
| Pie regulatorio en móvil (390) | `M2-pie-movil` | «El saldo vive con el participante de la CLABE. El plástico vive con el emisor.» al final de Inicio |
| Cajón sin `checkVisibility` (390) | `M3-cajon-menu-empresa` | Con el método borrado (Safari anterior a 17.4): el cajón abre, la página queda `inert`, Tab no sale; el primer Escape cierra el menú de empresa y deja el cajón abierto, el segundo cierra el cajón y regresa el foco a «Secciones»; tocar el velo hace lo mismo y quita el `inert` |
| Seguridad | `A7-seguridad`, `A8-seguridad-confirma`, `A9-seguridad-confirmada` | «Mi perfil y seguridad» abre `/entrar/seguridad` con «← Volver a la consola»; con el factor de hace 6 minutos pide «Confirma que eres tú» y el código TOTP lo cierra; el enlace regresa a `/consola`. Con sesión SOFIPO el enlace dice «Volver a Operación» y lleva a `/operacion` |
| Recuperación del segundo factor | `A10-recuperacion-pedida` | Laura la pide desde «Perdí el segundo factor»; la entrada muestra «Tu solicitud quedó en revisión. Antes de aprobarla, el equipo de Lever confirma que eres tú. Te avisamos por correo cuando quede aprobada.» |
| Recuperaciones en Operación | `A11-recuperaciones-confirma`, `A12-recuperaciones-solicitud`, `A13-recuperaciones-rechazada` | op entra a Recuperaciones, confirma con TOTP en «Confirma que eres tú», ve la solicitud de Laura y la rechaza; deja de aparecer en la lista |
| Apariencia | `42-apariencia`, `42-apariencia-completa` | Las 6 miniaturas pintadas por el motor real (`data-pintada="si"`) |
| Cambio de empresa | `43-empresas`, `44-taller-inicio` | Desde el menú: la tarjeta del lateral pasa a Taller del Cierre |
| Proveedores | `50-proveedores-mesa`, `51-proveedores-alta`, `52-busqueda-taller` | Mesa y alta de proveedor |
| Teléfono | `60-telefono` | Logotipo sin línea, enlace a Apariencia, escena detrás |
| 404 | `61-404` | Logotipo y botones del sistema |
| Muestrario (Oscuro 1440 y 390; los tres temas en 1440) | `70-muestrario-panel`, `71-muestrario-aviso`, `72-muestrario-dialogo` | Panel lateral abre y cierra con Escape; con el panel abierto el fondo no se desplaza, la vista tampoco (en móvil la rueda la movía y el panel se salía de la pantalla) y al cerrar vuelve a desplazarse; Escape avisa el cierre una sola vez (contador del muestrario en 1); «Archivar» muestra el aviso y «Deshacer» regresa la fila; el diálogo abre y se cierra tocando el velo, que también avisa una sola vez (contador en 2) |
| Operación SOFIPO | `90-operacion-entrar`, `91-operacion-totp`, `92-operacion-resumen`, `93-operacion-clientes` | Contraseña → TOTP → Abrir operación → resumen → Clientes → Salir |
| «Perdí el segundo factor» | `95-perdi-factor-boton`, `96-perdi-factor-hover`, `97-perdi-factor-recuperacion` | Es un `<button>` con aspecto de enlace: fondo transparente, borde de 0 px arriba, a la izquierda y a la derecha, línea de 1 px abajo, la misma fuente del texto y cursor de mano (antes se veía como un botón gris del navegador). Al pasar el cursor la línea toma el acento; al clicarlo abre «Recuperación» con el campo «Qué pasó» (`#motivo`) |

Resultado de la corrida final (`scripts/evidencia/sistema-visual/*.mjs` en los 3 temas × 1440 y 390, más Apariencia): **452 de 452 comprobaciones en verde**, incluida «sin errores de consola del navegador» en cada corrida.

| Guion | Por tema y tamaño | Total |
| --- | --- | --- |
| `recorrido.mjs` (consola) | 34 en 1440; 26 en 390 (37 en Oscuro 390, que suma el muestrario) | 191 |
| `operacion.mjs` | 5 | 30 |
| `marco.mjs` | 9 en 1440; 16 en 390 | 75 |
| `seguridad.mjs` | 17 | 102 |
| `perdi-factor.mjs` | 6 | 36 |
| `apariencia.mjs` | — | 18 |

El detalle de cada comprobación está en `datos/checks-*.json`.

### Apariencia: persiste al recargar

`A0`…`A6`, sobre la consola de Altamar:

1. Escena viva con el movimiento encendido (`data-estado="vivo"`).
2. Cambia a Claro, escena Halo, tono Arena, apaga «Fondo animado» y «La luz sigue al cursor»: el tema cambia al instante, se escribe la cookie `tema=claro` y la escena queda quieta.
3. Recarga: siguen Claro, Halo, Arena, fondo quieto y luz apagada (`A2`).
4. «Tu color» con `#3cc48f`: queda elegido (`aria-pressed="true"`) y el acento cambia (`A3`). Al elegir Arena deja de estar elegido, y al clicarlo otra vez se vuelve a elegir con el mismo color (antes el selector no avisaba si el color no cambiaba).
5. Inicio conserva el tema (`A4`); en Lever la paleta se oculta (`A5`).
6. Con «reducir movimiento» del sistema la escena queda quieta aunque la preferencia diga animado (`A6`).

18 de 18 comprobaciones en verde (`datos/checks-apariencia.json`).

### Primer cuadro con el acento elegido

Con un tono propio, el acento se calculaba en el navegador después de pintar, así que la página se veía unos cuadros en coral antes de tomar el tono. `destello.mjs` elige el tono Arena en Apariencia, abre Inicio 3 veces y registra el `--acc` de cada cuadro:

- Antes (`datos/destello-acento-antes.json`): el primer cuadro visible sale en `#ff5a4e` y 4 o 5 cuadros visibles llevan otro acento.
- Después (`datos/destello-acento-despues.json`): el primer cuadro ya trae `#E9DAC5` y 0 cuadros con otro acento. El acento calculado se guarda en la cookie `acento` (persona, tema y colores validados) y el servidor lo escribe en la primera respuesta.

## Comparación con el diseño

- `comparacion-inicio.webp`: `plat-00-resumen` del diseño junto a Inicio del producto (Oscuro, 1440×900).
- `comparacion-tabla.webp`: `plat-04-tarjetas` junto a la tabla del sistema (muestrario).

Lateral, tarjeta de la empresa, secciones con la barra coral, contadores, pie regulatorio, barra superior (título en Sora fina, búsqueda con línea, chip de la persona), paneles mate, cifra grande con centavos, tabla con barra de avance e insignias con punto: iguales al diseño. Lo que no quedó idéntico y por qué:

| Diferencia | Razón |
| --- | --- |
| La barra no tiene «WhatsApp» ni «Fondear cuenta» | Esos módulos no existen y la tarea prohíbe módulos nuevos. El marco ya recibe la acción de cada página como prop (`accion`); cada pantalla la pone cuando se rehaga su estructura |
| El lateral lista las secciones del producto (Inicio, Pendientes, Política, Proveedores, Lista 69-B, Personas, Póliza, Configuración, Teléfono), no las del diseño (Conciliación, Tarjetas, Crédito…) | Sin módulos ni secciones nuevas |
| Las páginas conservan su encabezado propio (rótulo, título y entrada) debajo del título de la barra | El copy y la estructura de cada pantalla no entran en esta tarea; solo el pie regulatorio y los textos del marco |
| El pie regulatorio no usa el texto del diseño («Sociedad Financiera Popular … razón social por definir») | Decisión de Gil: se queda el aviso anterior («El saldo vive con el participante de la CLABE. El plástico vive con el emisor.») hasta que legal apruebe el nuevo. Vive en una sola constante, `PIE_REGULATORIO` |
| La escena se ve un poco más calmada; `--tx2`, `--tx3`, `--warn` y `--danger` son un poco más claros (Oscuro, Lever) u oscuros (Claro) que en el diseño | Medidos contra la escena real (no solo contra `--void`), con los valores del diseño apenas ajustados contra el fondo liso aún quedaban bajo AA 46 textos en Oscuro, 40 en Claro y 45 en Lever (el más bajo, 2.16:1). Ver «Contraste» |
| La pestaña activa de Personas es marfil, no coral | Blanco sobre coral daba 3.08:1. El marfil es el segmentado activo del diseño («6 meses») |
| La vista previa de Apariencia muestra la empresa, no un saldo, y su texto sigue el tema | No se inventa un saldo; el texto blanco sobre la escena clara daba 1.56:1 |
| Apariencia muestra 6 tonos (Papel Lever, Tinta Lever, Coral Lever, Papel blanco, Arena y Tu color) | Igual que el diseño: Aluminio no se elige, es el Papel Lever del tema Claro |
| Sin tarjeta «Logo de tu empresa» en Apariencia | No hay dónde guardar un logo; un control que no hace nada no entra |
| El buscador busca personas (o proveedores, si no hay maestro), no «tarjeta o comercio» | No hay tarjetas ni comercios en el producto |
| La 404 y la landing no llevan escena | Son páginas públicas sin preferencias de persona |

## Contraste medido

Método (`scripts/evidencia/sistema-visual/contraste-textos.mjs`; salida en `datos/contraste-textos-*.json`): por cada texto visible se toma su color calculado por el navegador (con su opacidad), se oculta todo el texto, se captura la pantalla y se muestrean 35 puntos del fondo real detrás de su caja (escena, velo y panel mate). Se reporta el peor contraste. Umbral AA: 4.5:1, o 3:1 para texto grande. Escena Bruma, tono por omisión, «reducir movimiento» para que el cuadro sea estable.

Pantallas: Inicio, Pendientes, Proveedores, Personas, Nómina, Política, Lista 69-B, Configuración, Apariencia, Teléfono, Muestrario, Seguridad (`/entrar/seguridad`) y 404 con sesión de consola; resumen, Clientes, Recuperaciones, Aprobaciones, Alertas, Comisiones y Bitácora con sesión SOFIPO; entrada, entrada de Operación, recuperar contraseña, landing, precios y 404 sin sesión.

| Tema | Ancho | Textos medidos | Bajo AA | Peor contraste |
| --- | --- | --- | --- | --- |
| Consola, Oscuro | 1440 | 450 | 0 | 4.71 |
| Consola, Claro | 1440 | 450 | 0 | 4.96 |
| Consola, Lever | 1440 | 444 | 0 | 4.73 |
| Consola, Oscuro | 390 | 213 | 0 | 6.19 |
| Consola, Claro | 390 | 213 | 0 | 4.54 |
| Consola, Lever | 390 | 213 | 0 | 4.25 (texto grande; umbral 3) |
| Operación, Oscuro / Claro / Lever | 1440 | 260 por tema | 0 | 4.91 / 5.10 / 4.93 |
| Operación, Oscuro / Claro / Lever | 390 | 154 por tema | 0 | 7.59 / 4.86 / 6.24 |
| Páginas públicas, Oscuro / Claro / Lever | 1440 | 70 por tema | 0 | 5.34 / 5.21 / 4.93 |
| Páginas públicas, Oscuro / Claro / Lever | 390 | 64 por tema | 0 | 5.34 / 4.97 / 5.34 |

La primera medición de esta ronda encontró 4 textos bajo AA en Claro, corregidos en este PR:
- El rótulo del tema activo en el selector de Operación salía en gris tenue (4.47) porque la regla del rol «Personal de plataforma» alcanzaba todos los `span` de la cuenta. Ahora la regla solo toca el rol y el tema activo va en `--tx`.
- El pie regulatorio en móvil (4.29 y 4.38) y la entidad bajo cada acción de la Bitácora de Operación (4.29) van directo sobre la escena; pasan a `--tx2` (4.86).
- En Oscuro, 23 textos de `/consola/lista-69b` dieron alrededor de 1:1, con el fondo igual al color del texto: la muestra se tomó con el texto todavía visible, no es un color. En la medición final (los cambios de arriba no tocan esa página) dio 0.

Peor contraste por tipo de texto (1440):

| Texto | Oscuro | Claro | Lever |
| --- | --- | --- | --- |
| Principal `--tx` | #edf0ed · 8.83 | #141312 · 7.79 | #fff5f1 · 4.80 |
| Secundario `--tx2` | #bdbab8 · 5.56 | #4f4a45 · 5.66 | #f9d8d0 · 5.62 |
| Terciario `--tx3` | #aeaba9 · 4.71 | #57524d · 4.96 | #f0c8be · 4.73 |
| Acento como texto `--sello` | #ff5a4e · 5.38 | #a33a32 · 5.69 | #ffe4dd · 9.89 |
| Aviso `--danger` | #e8735f · 6.39 | #a93c29 · 5.38 | #ee998a · 6.60 |
| Advertencia `--warn` | #ddb45e · 6.71 | #6b500c · 5.05 | #ecc77e · 4.92 |
| Botón principal (`--ivk` sobre `--ivory`) | 17.48 | 17.93 | 17.48 |

Qué se cambió para llegar ahí, sobre el valor del diseño:

- `--tx2` Oscuro #a19e9c → #bdbab8; `--tx3` Oscuro #757270 → #aeaba9, Claro #7a736b → #57524d, Lever #e6b2a6 → #f0c8be.
- `--warn` Claro #9a7412 → #6b500c y Lever (heredaba #ddb45e) → #ecc77e; `--danger` Claro #c2452f → #a93c29 y Lever #e8735f → #ee998a.
- Velo de lectura en `escena.css`: una capa pareja del `--void` sobre la escena, 30 % en Oscuro, 50 % en Claro y 45 % en Lever. La escena conserva forma y movimiento; baja su contraste donde el texto va directo sobre ella (lateral y encabezados).
- La pestaña activa de Personas pasa a marfil, el texto de la vista previa de Apariencia sigue el tema, el pie de la entrada usa `--tx2` y los grises de la landing usan `--arco-suave`.

El correo usa los mismos valores (`src/server/correo/plantillas/marco.ts`; la prueba que los compara con `tokens.css` sigue igual).

## Cómo reproducirlo

Scripts en `scripts/evidencia/sistema-visual/`. Se corren desde la raíz del repositorio con el servidor arriba (`next dev -p 4802` con `DATABASE_URL`, `AUTENTICACION_LLAVE_TOTP`, `URL_APLICACION` y las variables del emulador de Blob de `tests/e2e/LEEME.md`).

```sh
export BASE=http://localhost:4802 SV=test-results/sistema-visual EMPRESA_ALTAMAR=<id de Altamar>
# ADMIN_URL: dueño de la base desechable; seguridad.mjs envejece con él el segundo factor de la sesión
export ADMIN_URL=postgres://<dueño>@127.0.0.1:5521/plataforma
# Una vez: invitaciones, TOTP, área y personas por la interfaz
TOKEN_LAURA=<token del enlace de alta> TOKEN_OP=<token de la invitación de personal> node scripts/evidencia/sistema-visual/preparar.mjs
# Corrida final: cada guion por tema y tamaño, y Apariencia
for tema in oscuro claro lever; do for forma in escritorio movil; do
  for guion in recorrido operacion marco seguridad perdi-factor; do
    node scripts/evidencia/sistema-visual/$guion.mjs $tema $forma
  done
done; done
node scripts/evidencia/sistema-visual/apariencia.mjs
# Destello del acento (salida JSON)
node scripts/evidencia/sistema-visual/destello.mjs $SV/destello.json
# Contraste: consola con la sesión sembrada de Laura en seed-pagos.sql, Operación con una sesión SOFIPO
# (SESION=<token de la cookie>) y páginas públicas sin sesión
CONSOLA=/consola,/consola/pendientes,/consola/proveedores,/consola/personas,/consola/personas/nomina,/consola/politica,/consola/lista-69b,/consola/configuracion,/consola/apariencia,/telefono,/muestrario,/entrar/seguridad,/esta-no-existe
OPERACION=/operacion,/operacion/clientes,/operacion/recuperaciones,/operacion/aprobaciones,/operacion/alertas,/operacion/comisiones,/operacion/bitacora
PUBLICAS=/entrar,/operacion/entrar,/recuperar,/,/precios,/esta-no-existe
for ancho in 1440 390; do
  RUTAS=$CONSOLA node scripts/evidencia/sistema-visual/contraste-textos.mjs $ancho
  SESION=<token SOFIPO> SUFIJO=-operacion RUTAS=$OPERACION node scripts/evidencia/sistema-visual/contraste-textos.mjs $ancho
  SIN_SESION=1 RUTAS=$PUBLICAS node scripts/evidencia/sistema-visual/contraste-textos.mjs $ancho
done
DISENO=<carpeta con plat-00-resumen.png y plat-04-tarjetas.png> node scripts/evidencia/sistema-visual/comparar.mjs
```

Local, sin correo: la invitación de personal no imprime su enlace, así que su token se fijó con SQL de dueño en la base desechable (`invitations.token_hash = sha256(<token>)`); la contraseña de las cuentas sembradas por `seed-pagos.sql` se limpió para que Laura y op la crearan al aceptar. Laura se agregó a Taller del Cierre con SQL de dueño y su asiento en la bitácora (`asignar_rol`), porque el producto todavía no invita a una segunda empresa desde la interfaz. Para medir el contraste de Operación se sembró con SQL de dueño una sesión SOFIPO de op (entrada verificada con TOTP y su sesión), y se renovó el último uso de las sesiones de medición para que no vencieran por inactividad.
