# Evidencia de la Ola 2b: navegación del diseño, modo demostración y Aprobaciones

Recorrido con Playwright headless propio (`scripts/evidencia/ola-2b-navegacion.mjs`) contra `next build` + `next start` en el puerto 4812 y un Postgres 17 local en 5552, sembrado desde cero por `scripts/evidencia/ola-2b/preparar.ts`:

- **Taller del Cierre**, empresa **real** (`demostracion = false`): la semilla de Pagos a proveedores con tres pagos por autorizar que pidió Gil (uno es E-12, el de la prueba de atajos de los e2e), una nómina semanal vencida y sin lote, y una persona por rol (Ana administradora, Fernanda finanzas, Carla contadora, Rosa liberadora, Sergio solicitante).
- **Altamar Logística**, empresa de **demostración**, dada de alta por el personal del operador, con Laura (administradora) y Daniela (solicitante).

Corrida final del 2026-11-08 sobre el head del PR, en este orden: `lado`, `modulos`, `pantallas` (3 temas), `contraste` (3 temas), `cargando`, `flujos` y `caida`. Los flujos mueven datos de la base local, por eso van después de las capturas que necesitan los pagos por autorizar. En la ronda de `16c4265` se repitieron `modulos` y el modo nuevo `fondo`. Lo demás no cambió: esta ronda toca la barra de Movimientos y el fondo animado, y el recorrido abre el navegador con «reducir movimiento», con el que el fondo pinta igual que antes (sección «Ronda de 16c4265»).

| Modo | Qué revisa | Resultado |
| --- | --- | --- |
| `flujos` | Los flujos 1-6 del brief, clicados, con doble clic y conteo en la base | **185 de 185** |
| `lado` | Los 16 módulos junto a su captura del diseño; la DIOT de Fiscal medida contra la fuente del diseño a 1440 y 390; y la barra de filtros de Movimientos contra el diseño renderizado, control por control, en Claro, Oscuro y Lever, a 1440 (con la barra de desplazamiento oculta y visible) y a 390, sin y con un filtro puesto (`lado-a-lado/`) | **96 de 96** |
| `modulos` | Movimientos y Fiscal clicados en Claro, Oscuro y Lever, a 1440 y 390, contando las navegaciones en la red: cada selector, Enter y Tab en el monto, monto y toque (390) o clic lento (1440) en «7 días», Enter en el periodo «Hoy» y 5000 y Tab tras soltar el ratón o arrastrar el dedo fuera de «7 días», o tras un clic derecho, central o Ctrl + clic de macOS en él (1440), dan una navegación cada uno, estos últimos sin esperar; «Limpiar filtros» deja Persona, el monto y «Agrupar por» vacíos, filtrados a mano o llegados en la dirección, «Atrás» y «Adelante» los ponen como dice la dirección y el filtro siguiente no arrastra los de antes; «4000» en el monto y un toque (390) o clic sin pausa (1440) en «Limpiar filtros» o en el logotipo se quedan en el enlace; «1e» a medio escribir sigue en el monto cuando llega otro filtro; el botón oculto que usa Enter no recibe el foco con Tab ni con Shift+Tab; sin JavaScript el periodo lleva lo demás y «Filtrar» lo conserva; «Limpiar filtros» vuelve a las 34 compras, al desplazar la DIOT se ve la columna IVA y «Lista 69-B» deja el lateral en Fiscal (`modulos/`) | **171 de 171** |
| `fondo` | El fondo animado con movimiento, en Movimientos, en Claro, Oscuro y Lever. Sin GPU (Chromium headless tal cual, como Vercel CI), a 1440 y 390 con DPR 2: tras la primera pintura, a lo más un cuadro largo del fondo, se queda quieto, la barra filtra y, al recargar, pinta una vez sin cuadros largos. Con la GPU de la Mac (Metal) a 1440: sigue vivo, con unas 20 pinturas por segundo y sin cuadros largos (`fondo/`) | **30 de 30** |
| `pantallas` | 27 pantallas nuevas en Claro, Oscuro y Lever, a 1440 y 390: responde 200, un solo h1, campos y botones con nombre, errores ligados al campo, sin desplazamiento horizontal, consola limpia y, en Oscuro 1440, cada parada de Tab en orden y con foco visible | **851 de 851** |
| `contraste` | AA de cada texto contra la escena real (método del #50) | Oscuro 4.70 / 5.09 · Claro 4.97 / 4.50 · Lever 4.62 / 5.13 (mínimo a 1440 / 390, sobre 4.5) |
| `cargando` | «Cargando…» de una sección nueva mientras llega la página, con el marco quieto | **9 de 9** |
| `caida` | Con Postgres apagado, Aprobaciones, Perfil y un módulo demo dicen que no se pudo (o «Disponible pronto») dentro del marco, sin datos | **54 de 54** |

Los resultados de cada comprobación están en `datos/*.json`.

## Flujos (`flujos/`)

1. **Lateral por rol** en escritorio y en el cajón móvil (Ana, Fernanda, Carla, Rosa y Sergio): cada rol ve lo que su puerta abre y nada más, cada enlace responde 200, un clic en el último enlace navega y lo marca, y el cajón atrapa el foco (40 tabulaciones sin salir) y Escape lo cierra devolviendo el foco a «Secciones».
2. **Módulos de demostración** en Altamar: cada uno abre con el aviso «Demostración», ningún botón que mueva dinero está encendido, no hay formularios POST y un clic forzado en un botón marcado no envía nada. Lo que sí se mueve: «Presupuestos por área» en Tarjetas, elegir una persona en Movimientos (filtra al momento, sin botón, y deja solo sus compras; «Limpiar filtros» aparece y vuelve a todas; sin JavaScript, «Filtrar» deja las mismas compras) y «Lista 69-B» desde Fiscal (abre la lista real y el lateral sigue en Fiscal).
3. **Empresa real**: cada módulo dice «Disponible pronto», sin dígitos ni marca de demostración. El **HTML** y la **carga RSC** (`text/x-component`) de cada uno se revisan contra los 51 centinelas de `src/server/demo/centinelas.ts` y no traen ninguno. Control positivo: la misma prueba sobre Altamar sí encuentra el saldo de ejemplo en el HTML y en la RSC de Cuenta.
4. **Aprobaciones**:
   - Rosa autoriza el pago N-204 con **doble clic**: queda listo para pagar con **un solo evento** en la bitácora y la fila sale de la bandeja.
   - Rosa rechaza el otro con el atajo **R**, motivo y doble clic: rechazado con su motivo y un solo evento.
   - Con ese rechazo abierto, la tecla **A** con el foco en «Cancelar» y luego en el «Rechazar» del diálogo **no autoriza** el pago: sigue por autorizar, sin evento de autorización y con el diálogo abierto (`4c-atajo-a-en-dialogo`).
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
- **DIOT de Fiscal**: lleva las tres columnas de la fuente del diseño (`fPlat.script0.js`): Proveedor, Pagado sin IVA e IVA. La captura del diseño no enseña IVA porque su primera columna no se corta (`.tbl td:first-child`) y la tabla se desplaza a lo ancho dentro de `.tblWrap`. La app hace lo mismo, así que a 1440 la columna IVA también queda tras el desplazamiento. `lado` compara la app con la fuente a 1440 y 390: columnas, proveedor sin corte, caja que se desplaza, aire entre la nota y la tabla y alto de la cabecera. `plat-06-fiscal-diot-1440` y `-390` ponen las dos tarjetas desplazadas hasta el final, el diseño a la izquierda.
- **Tablas de demostración**: como `.tbl` del diseño, la primera columna no se corta y las cabeceras de cifras sí se parten. Las dos reglas valen para todas; hoy solo cambian la DIOT y, a 390, las cabeceras de Tarjetas, que el diseño también parte.
- **Movimientos**: la barra de filtros es la `mfBar` del diseño, en su orden, y se acomoda como el diseño renderizado (`fPlat.html`), que manda sobre la captura `plat-05`. Usa el mismo relleno (`14px 16px`) y sin corte forzado, así que cada control cae en el renglón del diseño. A 1440, Categoría va en el primer renglón y «Limpiar filtros», Excel y Póliza caben en el segundo con sus marcas, con y sin filtro puesto. En el teléfono la marca va debajo del texto, dentro del botón, para que Excel y Póliza compartan renglón como en el diseño. `lado` compara cada control con el diseño en los tres temas, a 1440 y 390, sin y con filtro; `plat-05-barra-*` pone las dos barras lado a lado, y las que terminan en `-antes` son de `b41e28b`, cuando Categoría caía al segundo renglón y Póliza a un tercero. A 1440 también mide con la barra de desplazamiento visible (`-con-barra`), que quita 15 px como un escritorio con barras clásicas: el diseño y la app dan 2 renglones, con y sin filtro. Sin filtro, el diseño baja Categoría al segundo renglón y la app la deja en el primero, porque los selectores de la app miden menos por dos razones. Sus opciones son más cortas: Mes trae un solo mes (123 contra 148 px) y Persona no lista a los proveedores de las tarjetas virtuales (129 contra 178 px). Además, su caja es unos 4 px más angosta con el mismo texto, porque la app dibuja su propia flecha (`appearance: none`) y el diseño usa la del sistema. Copiar las dos cosas baja Categoría, pero «Póliza contable» cae a un tercer renglón por la marca «Demostración», así que se queda así. «Limpiar filtros» sale solo con un filtro puesto. Filtra en cuanto cambia un campo, como el diseño. El botón «Filtrar» solo existe sin JavaScript (va en `<noscript>`): el filtro es un formulario GET que también funciona así, y el flujo 2 lo prueba con JavaScript apagado. El selector Mes trae solo octubre porque los datos de ejemplo son de un mes. La marca «Demostración» de Excel y Póliza va más compacta en esta barra. Enter en «Monto desde» filtra con una sola navegación, igual que salir con Tab. Los periodos son botones del formulario, como los `data-per` del diseño, con el elegido marcado (`aria-pressed`): un toque justo después de escribir el monto lleva los dos en una navegación. El mapa es esquemático (SVG propio), sin teselas de un tercero.
- **Resumen, Proveedores y Nómina** son los módulos reales con los datos de Altamar, no los del prototipo.

## Atajos de teclado desde un diálogo (`atajos/`)

La revisión del PR encontró que, con el diálogo «Rechazar» abierto y el foco en uno de sus botones, la tecla A autorizaba ese mismo pago: el `<dialog>` se pinta dentro de la fila y su tecla subía hasta los atajos de la bandeja. `Bandeja` ignora ahora las teclas que nacen dentro de un `dialog`, y eso cierra también el mismo caso en Operación.

- **Aprobaciones**: `tests/e2e/aprobaciones.spec.ts` (corre en CI), como liberadora con el pago E-12 de Taller del Cierre. A en «Cancelar», A en el «Rechazar» del diálogo y R ahí mismo no envían nada; el pago sigue por autorizar, sin eventos. Tras Escape y con el foco en la fila, A autoriza exactamente una vez. Sin el arreglo falla en el primer paso.
- **Operación**: `atajos/operacion.spec.ts.txt`, un spec temporal que no se sube a `operacion.spec.ts`. Sin el arreglo, A en «Cancelar» del rechazo de una activación **activó la empresa**; con el arreglo, ninguna tecla envía nada y el control positivo aprueba una vez.
- La salida cruda de las cuatro corridas (sin y con el arreglo, en los dos portales) está en `atajos/salida.txt`.

## Re-verificación de b38728e (R1, N1 y N2)

- **R1 · DIOT**: la columna IVA había salido por una comparación contra la captura del diseño y no contra su fuente. Regresó con su dato, y la tabla se comporta como la del diseño (sección anterior).
- **N1 · puertas**: `src/nucleo/capacidades.test.ts` afirma también quién abre Fiscal: administrador, solicitante, liberador y contador; no finanzas ni tarjetahabiente. Si su puerta abre además con el flujo de caja, la prueba falla (`datos/mutacion-fiscal.txt`).
- **N2 · Enter en «Monto desde»**: navegaba dos veces, porque el «change» enviaba el formulario y el navegador lo volvía a enviar con Enter. El envío del «change» ahora espera un turno y se cancela si el formulario ya salió. `tests/e2e/demostracion.spec.ts` cuenta una navegación con Enter y una con Tab, sin contar las precargas de los enlaces de periodo. Sin el arreglo falla con dos navegaciones (`datos/enter-monto.txt`).
- **N3 · periodo tras escribir el monto** (teléfono): tocar «7 días» sin salir de «Monto desde» navegaba dos veces y se quedaba con el monto y sin el periodo, porque el envío del monto pisaba al enlace. Los periodos son ahora botones del formulario. `next/form` arma la dirección sin el botón que envía, así que un campo oculto lleva el periodo; sin JavaScript va apagado y el botón lo lleva solo. Un primer botón oculto hace que Enter conserve el periodo. Si se está tocando un botón, el envío del monto espera a que ese botón lo cancele, y así un clic lento de escritorio también da una navegación. `demostracion.spec.ts` lo prueba en un teléfono emulado: falla con el código de `3b14c89` y pasa con el arreglo (`datos/periodo-telefono.txt`). Capturas en `modulos/movimientos-periodo-*`.
- **Carrera del cobro con XML** (Vercel CI de `479ff97`, `tests/flujo/flujo-postgres.test.ts`; es código de main que este PR no tocaba): si el mismo formulario se enviaba dos veces a la vez y el primero confirmaba entre `altaPrevia` y la búsqueda de la factura viva, el segundo veía su propia fila y respondía «cobro duplicado». La búsqueda ya no cuenta la fila de la misma alta: el segundo sigue al insert, choca con el id y `altaPrevia` le responde igual. `src/server/flujo/cobro-cfdi.test.ts` reproduce ese orden siempre, con una base falsa: el mismo formulario responde igual, dos formularios con la misma factura siguen rechazados y el mismo id con otra factura u otra fecha sigue «ya enviado». Sin el arreglo fallan dos de las tres; contra Postgres, la prueba de flujo pasó 20 de 20 veces (`datos/carrera-cobro.txt`).
- **N4 · la marca de «tocando un botón»** se quedaba puesta si el ratón bajaba en un periodo y se soltaba fuera: el siguiente cambio hecho con el teclado esperaba 500 ms. Ahora la marca se apaga al soltar fuera del botón o cuando el navegador cancela el gesto para desplazar la página. No se apaga al soltar encima, porque con el dedo el «change» del monto llega después de soltar (`datos/orden-de-eventos.txt`). `demostracion.spec.ts` arrastra el ratón fuera de «7 días» y luego escribe 5000 y Tab: con `f9b2460` el envío sale a los 502 ms y con el arreglo, de inmediato y con una navegación (`datos/soltar-fuera.txt`). `modulos` hace lo mismo con el ratón a 1440 y arrastrando el dedo a 390.
- **N5 · clic derecho o central en un periodo**: bajaba y soltaba encima del mismo botón sin hacer clic, así que la marca se quedaba puesta y el siguiente cambio esperaba 500 ms. Ahora solo el botón principal la pone. `demostracion.spec.ts` repite la prueba de N4 con clic derecho y central: con `9b883b5` el clic derecho da 517 ms y con el arreglo sale de inmediato (`datos/limpiar-y-clics.txt`).
- **N6 · «Limpiar filtros» dejaba los campos con los valores viejos** (desde `b38728e`): la tabla volvía a las 34 compras, pero Persona seguía diciendo el nombre de antes y el monto escrito se quedaba, y el filtro siguiente volvía a mandarlos. El formulario no se vuelve a montar al navegar, y React no aplica un `defaultValue` nuevo a un selector ya montado ni a un campo editado. Ahora los campos siguen a la dirección al limpiar, con «Atrás» y con «Adelante»; lo que se está escribiendo y aún no sale se queda. `demostracion.spec.ts` lo prueba con filtros puestos a mano y llegados en la dirección, con «Atrás», con «Adelante» y con el filtro siguiente. Además retiene una navegación mientras se escribe el monto, y comprueba que lo escrito no se borra. Con `9b883b5` falla: Persona se queda en «Ana Torres» (`datos/limpiar-y-clics.txt`). Capturas en `modulos/movimientos-limpiar-{antes,despues}-*`: las que terminan en `-sin-arreglo` son de `9b883b5`, con «Carlos Méndez» y 100 tras limpiar.

## Ronda de 16c4265: Vercel CI en rojo y la re-verificación

### El rojo de Vercel CI en `demostracion.spec.ts:111` (`datos/n5-ci-rojo.txt`)

`test:e2e:1` falló en `fb27af5` (soltar fuera, 864.5 ms) y en `16c4265` (clic central, 795.6 ms), contra un tope de 250 ms.

- **El arreglo de N5 funcionaba.** Envolví `setTimeout` en la página: al «change», el formulario pidió `setTimeout(0)` en todos los casos medidos (soltar fuera, clic derecho y central, con la CPU a 1x y 6x, y a DPR 1 y 2).
- **Lo que medía la prueba era el hilo principal ocupado.** Entre el cambio y el envío siempre cae un cuadro largo. Los Long Animation Frames lo atribuyen a la callback de `requestAnimationFrame` del fondo animado (`fondo-escena.tsx`, `cuadro`), que pinta con WebGL cada tres cuadros.
- **Sin GPU esa pintura cuesta caro.** Chromium headless pinta WebGL con la CPU: unos 57 ms por pintura a DPR 1 y de 300 a 500 ms a DPR 2. En Vercel CI el navegador corre en el contenedor de Playwright, sin GPU y con 4 CPU compartidas: 795 y 864 ms son una pintura del fondo. Falla el gesto al que le toca la pintura, por eso cambiaba de gesto entre corridas.
- **Dosis-respuesta a DPR 2:** con el fondo vivo, el cambio→envío llega a 503 ms y pasa de 250 en 10 de 18 casos. Con «reducir movimiento» da de 6 a 49 ms en 18 de 18. La prueba de `16c4265`, sin cambios, falla 5 de 5 a DPR 2.
- **La prueba ahora mide con el reloj de la página** (`page.clock`): lo detiene antes del Tab, lo avanza 100 ms y afirma que el formulario salió. Así cuenta lo que el formulario decide esperar (nada, o 500 ms si espera un clic), no lo que tarda la máquina. Pasa 10 de 10 a DPR 2. Contra un worktree en `9b883b5` falla 3 de 3 en el clic derecho, y contra uno en `f9b2460` (antes de N4) falla 2 de 2 al soltar fuera.

### Hallazgo → arreglo → prueba

| Hallazgo | Arreglo | Prueba (falla en `16c4265`, pasa con el arreglo) |
| --- | --- | --- |
| **CI rojo** · la prueba de N4 y N5 medía el reloj de pared | `demostracion.spec.ts`: el reloj de la página, detenido y avanzado 100 ms | La misma prueba. Falla con `9b883b5` (clic derecho) y con `f9b2460` (soltar fuera); 10 de 10 a DPR 2 (`datos/n5-ci-rojo.txt`) |
| **N5-resto · P3** · en macOS, Ctrl + clic en un periodo abre el menú contextual sin hacer clic, y el siguiente filtro esperaba 500 ms | `filtros-al-cambiar.tsx`: el menú contextual apaga la marca | Gesto nuevo en la prueba con reloj, con los eventos de macOS despachados en la página (en Linux, Ctrl + clic sí hace clic). En `16c4265`: «el formulario sale en los primeros 100 ms» = false |
| **N6-resto · P2** · «Agrupar por» no seguía a la dirección: al limpiar, o con Atrás a la página sin consulta, se quedaba en «Persona» y el filtro siguiente la volvía a mandar | `movimientos.tsx`: sin `agrupar` en la dirección, `leerFiltros` da «» y no `undefined` (que `JSON.stringify` descartaba) | Agrupar entra a la e2e de N6, que en `16c4265` falla con «tras limpiar: sin agrupar», recibido «persona». Además, una unitaria de `leerFiltros` en `vista.test.ts`, que en `16c4265` da `undefined` |
| **N7 · P2** (pedido por el líder; en main desde `e0040fc`) · sin GPU, el fondo pintaba hasta 80 cuadros en cada carga completa, cada uno de cientos de ms, antes de quedarse quieto | `fondo-escena.tsx`: un dibujo de más de 50 ms después de la primera pintura (que también compila el shader) deja el fondo quieto en ese cuadro, sin repintar. La decisión se guarda en `sessionStorage` (`lever-fondo-lento`, con try/catch), así que recargar no vuelve a medir. La regla de promedio sigue para los casos moderados | `marco.spec.ts`, «fondo animado en un navegador sin GPU», a DPR 2: cuenta los cuadros largos del fondo después de su primera pintura. En `16c4265` da 9; con el arreglo, a lo más 1 y, al recargar, 0, con «lento» y una pintura (`datos/n7-fondo.txt`) |
| **N8 · P3** (regresión de `479ff97`) · en el teléfono, escribir el monto y tocar «Limpiar filtros» o el logotipo terminaba en `…&desde=4000`: el envío aplazado del monto navegaba después del enlace | `filtros-al-cambiar.tsx`: un clic en un enlace que lleva a otra página cancela el envío pendiente. La escucha va en el documento, en captura. Un enlace con tecla modificadora, `target="_blank"` o `#ancla` deja salir el envío | Prueba nueva en el teléfono con los dos enlaces. En `16c4265`, los dos terminan en `/consola/movimientos?…&desde=4000` |
| **N9 · P3** · «1e» o «-» a medio escribir en el monto se borraban al llegar otra navegación, porque su valor es «», igual que el aplicado | `filtros-al-cambiar.tsx`: un campo con entrada inválida (`validity.badInput`) cuenta como «se está escribiendo» | Prueba nueva: «1e» + «3» y «-» + «5» mientras se retiene el filtro de Área. En `16c4265`, «1e» se borra |

Salida cruda de cada prueba en `16c4265` y con los arreglos: `datos/revision-16c4265.txt`.

### El fondo en un equipo capaz no cambia (`datos/n7-fondo.txt`, `fondo/`)

Chromium sin ventana con la GPU de la Mac (`--use-angle=metal`, «ANGLE Metal Renderer: Apple M5 Pro»), a 1440 y DPR 2, en Resumen:

| | Antes (`16c4265`) | Después |
| --- | --- | --- |
| Estado y pinturas en 5 s (carga y recarga) | vivo · 102 y 101 | vivo · 101 y 100 |
| Cuadros largos del fondo tras la primera pintura | 0 | 0 |
| Cuadro a los 5 s con el reloj de la página detenido | SHA-256 `4ab593d3…` | el mismo `4ab593d3…` (idéntico también entre dos corridas de antes) |
| «Reducir movimiento», con y sin GPU | quieto · 0 pinturas · captura `f7ffdeed…` / `456e54ff…` | igual, byte a byte |
| Sin GPU (SwiftShader), cuadros largos por carga | 10 y 12, de hasta 776 ms; vuelve a medir al recargar | 1 (468 ms) y, al recargar, 0 |

Capturas: `fondo/fondo-gpu-reloj-5s-{antes,despues}.webp`, `fondo/fondo-gpu-carga-{antes,despues}.webp`, `fondo/fondo-sin-gpu-carga-{antes,despues}.webp` y `fondo/fondo-gpu-reducir-{antes,despues}.webp`. El modo `fondo` del recorrido lo repite en Movimientos en los tres temas (`fondo/fondo-{sin-gpu,gpu}-movimientos-*.webp`). Con el pintor `--use-angle=swiftshader` que usan los demás modos, cada pintura cuesta menos de 50 ms: ese es el caso moderado, que sigue resolviendo la regla de promedio.

## Pendiente al cambiar de cuenta

| Punto | Estado | Gates que se corrieron |
| --- | --- | --- |
| **N6** y **N5** (`fb27af5`) | **Hecho** | Los de `fb27af5`: typecheck 0, lint 0, `npm test` 456/456, Postgres 38/38, `test:e2e` 42/42, build 0, security en verde y el recorrido completo |
| **CI rojo**, **N5-resto**, **N6-resto**, **N7**, **N8** y **N9** | **Hecho** en el commit que agrega esta sección | typecheck 0, lint 0, `npm test` 457/457, Postgres en serie 38/38 (0 omitidas), `test:e2e` en sus tres partes 18 + 14 + 13 = 45/45, build 0 y security en verde. Recorrido: `modulos` 171/171 y `fondo` 30/30. Cada prueba nueva falla en `16c4265` |

Falta:
- **Vercel CI:** el del commit que agrega esta sección; su estado terminal va en el PR.
- **Revisión:** el revisor no ha re-verificado esta ronda.
- **Merge:** el PR no se ha fusionado.

## Correr el recorrido

```sh
# Postgres 17 desechable en 5552 (LC_ALL=C para que arranque en macOS)
DUENO_URL=postgres://postgres@127.0.0.1:5552/postgres ./node_modules/.bin/tsx scripts/evidencia/ola-2b/preparar.ts > test-results/ola-2b/entorno.json
E2E_SERVER_ACTIONS=1 E2E_PUERTO=4812 ./node_modules/.bin/next build
DATABASE_URL=<la de entorno.json> E2E_SERVER_ACTIONS=1 E2E_PUERTO=4812 ./node_modules/.bin/next start -p 4812 -H 127.0.0.1
DISENO=<carpeta de capturas del diseño> node scripts/evidencia/ola-2b-navegacion.mjs lado   # fPlat.html va junto a esa carpeta
node scripts/evidencia/ola-2b-navegacion.mjs modulos
node scripts/evidencia/ola-2b-navegacion.mjs limpiar     # solo N6 (va también en modulos); SUFIJO_LIMPIAR nombra sus capturas
node scripts/evidencia/ola-2b-navegacion.mjs fondo       # el fondo con movimiento, sin GPU y con la GPU de la Mac
TEMAS=oscuro SUFIJO=-oscuro node scripts/evidencia/ola-2b-navegacion.mjs pantallas   # y claro, lever
TEMAS=oscuro SUFIJO=-oscuro node scripts/evidencia/ola-2b-navegacion.mjs contraste   # y claro, lever
node scripts/evidencia/ola-2b-navegacion.mjs cargando
node scripts/evidencia/ola-2b-navegacion.mjs flujos      # mueve datos: va al final
node scripts/evidencia/ola-2b-navegacion.mjs sesiones    # y luego, con Postgres apagado:
node scripts/evidencia/ola-2b-navegacion.mjs caida
```

`psql` tiene que estar en el `PATH`. El script solo acepta un Postgres en 127.0.0.1 o localhost.
