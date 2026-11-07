# Ola 1B · consola: evidencia

Recorrido de la zona de la consola (Pendientes, Proveedores, Personas, Política, Lista 69-B, Configuración, Plan y Póliza) ya en el sistema visual de Lever, más Inicio con la nómina de una sola persona, el error de la consola y el correo del lunes. Se hizo con Playwright headless desde node, no con el navegador del MCP, contra `next start` en el puerto 4807. El servidor se compiló con `E2E_SERVER_ACTIONS=1 E2E_PUERTO=4807`, corre sobre Postgres 17 local en el puerto 5542 y usa el emulador de Blob en el puerto 4892. La evidencia es sobre main con #52 (flujo de caja) y #56 (superficies): el alta de proveedor lleva su campo de área, y Pendientes e Inicio, sus alertas. La sección siguiente dice qué corrió en cada head.

Las capturas están en WebP, en tres temas (Oscuro, Claro y Lever) y en dos tamaños: 1440×900 y 390×844 (móvil, con `isMobile`). Cada captura se llama `<clave>-<tema>-<ancho>.webp`.

## Qué corrió en cada head

| Head | Código | Qué corrió ahí |
| --- | --- | --- |
| `73d81c7` | main (`79f0673`) con #52, antes del faltante en Pendientes | Todas las corridas, más el flujo 9 con SAT simulado, que no se volvió a correr (ver abajo) |
| `9b5ffb9`, `b882178` | El faltante en Pendientes y la guarda de `recorridos.test.ts` | Pendientes y los 12 flujos; gates. Todo lo reemplaza la corrida de `ec9071e` |
| `ec9071e` | La ronda final con main integrado (#56 en `7ad4b68`): `reservado` en la nómina de una persona (dominio, correo y tabla de Inicio), Pendientes que se pinta aunque falle el faltante, `consola/error.tsx` con `retry`, `consola-vacia.tsx` sin descargos | Build nuevo y base sembrada de nuevo, con los guiones que luego quedaron en `80612ce`. Corridas completas: `pantallas` (36 pantallas, 1944 de 1944), `contraste` (6 de 6), `cargando`, `tablas`, `barra` y `caida`. En esa primera pasada, `flujos` se detuvo en el 14 y `correo` no encontró destinatarios; los dos se arreglaron en los guiones y se repitieron en la fila siguiente |
| `80612ce` | Igual a `ec9071e` en `src/`. Cambian solo los guiones de `scripts/evidencia` | Con el build de `ec9071e`: el flujo 14 en dos partes, la repetición completa de `flujos` (169 de 169) y `correo` con Bahía Comercial (4 de 4) |
| head final | Igual a `ec9071e` en `src/`. Agrega esta evidencia y este README | Gates completos una vez: typecheck, lint, test, security, Postgres local y en UTC, e2e y build. La salida está en el cuerpo del PR |

Toda la carpeta es de `ec9071e` y `80612ce`, menos el flujo 9 con SAT simulado (`09s-*`, `salida/flujos-sat-simulado-*.txt`, `salida/sat-simulado-bitacora.txt`), que es de `73d81c7`. Ese flujo no se repitió porque entre `73d81c7` y `ec9071e` no cambia nada de la carga de la 69-B: `git diff --stat 73d81c7 ec9071e -- src/server/lista-69b src/app/consola/lista-69b src/components/lista-69b scripts/evidencia/ola1b-consola/sat-simulado.mjs` sale vacío.

## Resultado de cada corrida

| Corrida | Qué comprueba | Resultado | Salida literal |
| --- | --- | --- | --- |
| `pantallas` | 36 pantallas × 3 temas × 2 tamaños. En cada una revisa: responde 200 en su propia ruta, sin redirigir; tiene un solo `h1`; todo campo tiene etiqueta; cada error está ligado a su campo con `aria-describedby`; no hay desplazamiento horizontal; cada cifra de una métrica cabe en su celda; la tabulación sigue el orden del documento; cada parada de Tab tiene foco visible; no hay errores de consola | **1944 de 1944** | `salida/pantallas.txt`, `datos/pantallas.json` |
| `contraste` | Contraste AA de cada texto visible contra la escena real (fondo WebGL). Con un diálogo modal abierto solo se mide el diálogo, porque lo de atrás queda inerte bajo el velo | **6 de 6** (ver la tabla siguiente) | `salida/contraste.txt`, `datos/contraste.json` |
| `cargando` | Con la respuesta de Política detenida: la sección del lateral muestra «Cargando…» con su indicador, la barra y la página actual se quedan, y al soltar la respuesta se pinta Política. En la mesa de Proveedores, con la respuesta detenida: la pestaña Agenda muestra su giro (`useLinkStatus`) y «Filtrar» dice «Filtrando…»; al soltarla llega la vista pedida | **24 de 24** | `salida/cargando.txt` |
| `tablas` | A 390, en 3 temas: la mesa de pagos, el detalle abierto, el directorio, el expediente abierto y la tabla del muestrario. Se clica cada «Abrir». Revisa que la página no se ensanche, tampoco con la tabla desplazada al final. Cada medida se repite sin `position: relative` en `.tabla-contenedor` para mostrar qué corrige | **21 de 21** | `salida/tablas.txt`, `tablas/` |
| `barra` | A 390, en 3 temas, en las pantallas cuyo marco lleva acción: Proveedores (Pagos, Proveedores y Agenda) y Personas. Revisa que título, acción y chip de la persona queden en una fila y que la página no se ensanche. Clica el chip (abre su menú, que se cierra con Escape; el botón conserva el nombre de la persona para el lector) y la acción (lleva a su alta) | **39 de 39** | `salida/barra.txt`, `barra/` |
| `caida` | Con Postgres apagado (`pg_ctl stop`), 9 pantallas × 3 temas × 2 tamaños. Cada una responde 200 en su ruta, con un solo `h1` y dentro del marco, dice «No se pudo…», no muestra cifras supuestas y no tiene errores de consola | **216 de 216** | `salida/caida.txt` |
| `flujos` | Los 11 flujos del brief, el 12 (alta de proveedor con área, de #52), el 13 (nómina de una sola persona en Inicio) y el 14 (faltante que no se puede calcular y error de la consola), clicados con doble clic en cada envío y verificación en la base. El 11 revisa además, en los 3 temas a 1440 y a 390, el faltante y el presupuesto en Pendientes con el clic a su destino, para Gil y para Fernanda, las alertas de Inicio y el caso sin permiso | **169 de 169** | `salida/flujos.txt`, `datos/flujos.json`, `salida/faltante-no-disponible-bitacora.txt` |
| `correo` | La tarea del lunes (`/tareas/correo-semanal` con `CRON_SECRET`) con el proveedor falso de Resend, sobre una base con Bahía Comercial (ver abajo) | **4 de 4** | `salida/correo.txt`, `datos/correo.json`, `correo/` |
| `flujos` con SAT simulado | Flujo 9 con el camino feliz de la 69-B y la negativa por IP privada (ver abajo) | **5 de 5** y **3 de 3** | `salida/flujos-sat-simulado-*.txt`, `salida/sat-simulado-bitacora.txt` |

Contraste por tema y tamaño (incluye Pendientes con la alerta de faltante e Inicio de administración, de finanzas y sin saldo):

| Tema | Ancho | Textos medidos | Contraste mínimo |
| --- | --- | --- | --- |
| Oscuro | 1440 | 1447 | 4.95 |
| Oscuro | 390 | 585 | 6.12 |
| Claro | 1440 | 1447 | 4.53 |
| Claro | 390 | 585 | 4.61 |
| Lever | 1440 | 1447 | 4.85 |
| Lever | 390 | 585 | 5.16 |

## Pantallas y estados

| Clave | Quién | Estado que muestra |
| --- | --- | --- |
| `12-inicio-administrador` | Gil (Taller) | Inicio con la proyección: «Nómina semanal (1 persona)» con su monto en los movimientos y en la alerta de faltante |
| `13-inicio-finanzas` | Fernanda (solo finanzas) | Inicio sin la cifra de la nómina: el renglón dice «Monto reservado» y la alerta, «Nómina (monto reservado)» |
| `14-inicio-sin-saldo` | Laura (Altamar) | **Inicio sin flujo**: sin saldo declarado, proyección en ceros y los pasos para empezar. `consola-vacia.tsx` no se pinta en ninguna ruta (ver «Componentes huérfanos») |
| `10-pendientes`, `11-pendientes-altamar` | Gil (Taller), Laura (Altamar) | Con pendientes; Taller con la alerta de faltante (nómina desglosada para Gil) y la de presupuesto; Altamar en su puesta en marcha |
| `20-proveedores-pagos`, `21-proveedores-directorio`, `22-proveedores-agenda` | Gil | Mesa de pagos, directorio y agenda |
| `23-proveedores-detalle-pago`, `24-proveedores-expediente` | Rosa, Gil | Panel lateral del pago y del expediente. A 390 el detalle se captura desplazado hasta «Rechazar» y «Autorizar para pagar» |
| `25-proveedores-alta`, `26-proveedores-nuevo-pago` | Gil | Formularios de alta |
| `27-proveedores-vacio` | Laura | **Vacío**: Altamar sin pagos ni proveedores |
| `30`…`33` (Personas) | Laura | Directorio, alta, áreas y nómina, todos vacíos al empezar |
| `35-personas-expediente` | Gil (Taller) | Expediente de Marta Ruiz: área Operación, nómina semanal y CLABE |
| `36-personas-lote` | Gil (Taller) | Lote de nómina preparado con su renglón |
| `37-personas-alta-con-areas` | Gil (Taller) | Alta de colaborador en una empresa con áreas |
| `34-personas-sin-permiso` | Rosa (liberadora) | **Sin permiso** |
| `40-politica`, `41-politica-altamar` | Gil, Laura | Política con datos y política recién creada («Todavía no hay personas») |
| `50-lista-69b`, `51-lista-69b-sofipo` | Gil, Ofelia (personal SOFIPO) | Consulta de RFC y carga del listado |
| `60-configuracion`, `61-configuracion-plan`, `70-poliza` | Gil | Configuración, plan y póliza (vacía: «Todavía no hay pólizas para exportar») |
| `80`…`86` (`*-sin-permiso-*`) | Fernanda (solo finanzas) | **Sin permiso** en Proveedores, Personas, Política, Lista 69-B, Configuración, Plan y Póliza |
| `87-pendientes-finanzas` | Fernanda | Pendientes con el rol de finanzas: la alerta de faltante dice «Nómina (monto reservado)» |
| `90-error-*` | Gil, con la base apagada | **Error** de Pendientes, Proveedores, Personas, Nómina, Política, Lista 69-B, Configuración, Plan y Póliza |
| `95-cargando` | Gil | **Cargando**: Política detenida mientras el lateral muestra su progreso |
| `96-mesa-pestana-cargando`, `96-mesa-filtrar-cargando` | Gil | **Cargando** en la mesa: giro en la pestaña Agenda y «Filtrando…», con la respuesta detenida (solo 1440) |

## Flujos clicados (`flujos/`)

Cada envío se hizo con **doble clic real** sobre `BotonEnviar`, y la base se consultó después con SQL de dueño.

| Flujo | Qué se clicó | Verificado en la base |
| --- | --- | --- |
| 1. Alta de proveedor con CLABE | «Alta de proveedor», formulario completo y doble clic en «Dar de alta». El botón se desactiva y dice «Enviando…» con `aria-busy` | 1 proveedor, 1 CLABE, 1 asiento en la bitácora; con «Sin área», el proveedor queda sin área |
| 2. Cuenta por pagar con XML | Se carga el XML y el PDF, y doble clic en «Revisar y solicitar» | 1 cuenta por pagar, 1 solicitud y 2 documentos; el XML se descarga del almacén privado (HTTP 200); quien solicita no puede autorizar |
| 3. Autorización por un segundo liberador | Rosa abre el pago desde Pendientes («Revisar pagos») y da doble clic en «Autorizar para pagar» | Estado `listo_para_pagar` con 1 autorización. Un `MutationObserver` sobre el formulario registra los dos botones en cada cambio: solo «Autorizar para pagar» dice «Enviando…» con `aria-busy`; «Rechazar» queda desactivado y sin anunciar |
| 4. Rechazo y cancelación con motivo | «Rechazar» sin motivo: el motivo queda `aria-invalid` y ligado al aviso con `aria-describedby`. Luego doble clic en «Rechazar» con su motivo (solo él anuncia «Enviando…»); sin motivo no se cancela; doble clic en «Confirmar cancelación» | 0 rechazos sin motivo; 1 rechazo y 1 cancelación con el motivo «Se reprograma con el proveedor» |
| 5. Alta de colaborador con nómina | Desde Pendientes: «Crear área», con un presupuesto inválido (el texto se queda y el error se liga al campo) y luego doble clic; después «Dar de alta» y doble clic en «Dar de alta colaborador» | 1 área; 1 persona, 1 nómina y 1 asiento `alta_persona` |
| 6. Cambio de CLABE de nómina | Con el segundo factor de hace 31 minutos, el cambio pide «Confirma que eres tú» y la CLABE no cambia. Luego se vuelve a entrar con contraseña y TOTP, y doble clic en «Cambiar CLABE de nómina» | CLABE vigente nueva, historial con 2 y 1 asiento `cambiar_clabe_nomina` |
| 7. Preparar el lote de nómina | Desde Pendientes, «Preparar nómina» y doble clic | 1 lote con 1 renglón, total 1,250,000 centavos |
| 8. Editar la política | Plazo «muchos»: el valor se queda y el error queda ligado al campo. Luego plazo válido con doble clic y categoría nueva con doble clic. Al final se escribe un umbral y se da doble clic en «Quitar el umbral»: solo ese botón dice «Quitando…» | 1 asiento `editar_politica`; 1 categoría, y la forma queda vacía para la siguiente; `umbral_proveedores_centavos` pasa de un monto a `NULL` |
| 9. Lista 69-B | Ofelia da doble clic en «Guardar el listado» («Descargando…»); Gil consulta `AAA010101AAA` | Sin copia doble; la consulta responde «No aparece en la lista 69-B.» |
| 9 con SAT simulado | Ofelia da doble clic en «Guardar el listado»; Gil consulta `PAL7202161U0` | 1 copia nueva (2026-10-31, 3 filas); el pago a ese RFC queda bloqueado. Con IP privada, 0 copias |
| 10. Configuración y plan | Plan, Póliza, Apariencia y Seguridad desde Configuración | Cada una abre con un solo `h1` |
| 11. Pendientes | Cada tipo de pendiente de Taller y de Altamar, con su acción clicada. Con #52, Gil en los 3 temas a 1440 y a 390: Pendientes muestra el faltante de Taller con «Nómina semanal (1 persona) ($18,500.00)», y «Ver la proyección» lleva a la proyección de Inicio (`/consola#proyeccion-titulo`). Muestra también «El presupuesto del área Operación está excedido» (la nómina de Marta rebasa los $80,000.00 del área), y «Ver presupuestos» lleva a Presupuestos. Inicio muestra las dos alertas. Quien no ve el detalle de la nómina: Fernanda (finanzas, en los 3 temas a 1440 y a 390) ve «Nómina (monto reservado)» y llega a la proyección; una contadora creada en el flujo (Lever 390) ve lo mismo, y «Revisar saldo y alertas» la lleva a `/consola/flujo`. Caso negativo: Rosa (liberadora, sin `cliente.flujo.ver`, Oscuro 1440 y Lever 390) no ve ninguna alerta | Cada acción lleva a la pantalla que lo resuelve; ninguna vista se ensancha y la consola queda limpia (`11-pendiente-faltante-*`, `11-pendiente-sin-faltante-liberadora-*`, `11-pendiente-presupuesto-*`, `11-inicio-alertas-*`) |
| 13. Nómina de una sola persona en Inicio | Gil y Fernanda abren Inicio en los 3 temas a 1440 y a 390 y despliegan todas las semanas de «Proyección a 13 semanas» | Gil ve «Nómina semanal (1 persona)» con −$18,500.00 y la alerta desglosada. Fernanda ve «· Nómina» con «Monto reservado» y la alerta «Nómina (monto reservado)»; ni los movimientos ni la alerta dicen 18,500 ni «1 persona» (`13-inicio-nomina-*`) |
| 14 (A). Faltante que no se puede calcular | Con SQL de dueño y su evento `registrar_obligacion` en la misma transacción, dos obligaciones de 9,000,000,000,000,000 centavos en la misma fecha: la suma pasa de `Number.MAX_SAFE_INTEGER` y la proyección lanza. Gil abre Inicio y Pendientes en los 3 temas a 1440 y a 390 | Inicio dice «No se pudo consultar el resumen.» dentro del marco: `conTransaccion` traduce cualquier error y no llega a `consola/error.tsx`. Pendientes se pinta con su bandeja y el aviso «No se pudo calcular si te alcanza el dinero. Revisa Saldo y alertas.», con enlace a `/consola/flujo`, sin errores de consola. El servidor deja 12 líneas `pendientes.faltante_no_disponible` sin datos de la empresa (`salida/faltante-no-disponible-bitacora.txt`). Las obligaciones se desactivan con `desactivar_obligacion` (`14-inicio-calculo-no-disponible-*`, `14-pendientes-faltante-no-disponible-*`) |
| 14 (B). Error de la consola | Con `error-forzado.mjs` (ver abajo) y su archivo bandera, se declara un saldo centinela de $42,424,242.42 con su evento `declarar_saldo`. Gil abre Inicio en los 3 temas a 1440 y a 390; luego se quita la bandera y se clica «Reintentar» | Inicio cae en `consola/error.tsx`: un solo `h1` «No se pudo abrir esta página.», «Vuelve a intentar» y «Reintentar» a la vista, sin «datos supuestos» y sin la cifra. «Reintentar» vuelve a pedir la página al servidor (`retry`) e Inicio abre con el saldo declarado (`14-error-consola-*`, `14-reintentar-inicio-oscuro-1440`) |
| 12. Alta de proveedor con área (#52) | «Alta de proveedor», formulario completo eligiendo el área «Operación» y doble clic en «Dar de alta» | 1 proveedor con `cost_center_id` del área Operación y 1 asiento `alta_proveedor` con `cambio.area = 'Operación'` |

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

### Error de la consola (`error-forzado.mjs`)

Ninguna lectura de la base llega a `src/app/consola/error.tsx`. `conTransaccion` (`src/nucleo/db.ts`) traduce cualquier error en `ErrorDeDominio`, y cada página lo pinta dentro del marco: lo muestran `caida` y el flujo 14 (A). Para ver ese límite de error en la aplicación real, el preload `scripts/evidencia/ola1b-consola/error-forzado.mjs` hace que dar formato a 42,424,242 pesos lance mientras exista `ERROR_FORZADO_ARCHIVO`. Esa cifra solo se formatea al pintar Inicio. Sin el archivo no cambia nada, y el preload vive solo en `scripts/evidencia`.

### Correo del lunes (`correo/`)

La tarea del lunes no escribe a empresas de demostración (`empresas_con_correo_semanal()`, S7), y Taller y Altamar lo son. Con `CORREO_SEMANAL=1`, `preparar.ts` da de alta con los servicios del producto a Bahía Comercial, una empresa real:
- Bruno, su administrador, entra por invitación.
- Felipe tiene solo el rol de finanzas.
- Sara Vidal es la única colaboradora con nómina: semanal, de $18,500.00.
- El saldo declarado es de $10,000.00.

La tarea corre con `RESEND_API_KEY` falsa, el proveedor falso `scripts/evidencia/flujo-de-caja-correo-falso.mjs` y un `CRON_SECRET` local fuera del repositorio.

| Comprobación | Resultado |
| --- | --- |
| La tarea responde 200 sin envíos fallidos | `{"semana":"2026-11-02","empresas":1,"enviados":1,"omitidos":0,"fallidos":0,"pendientes":0}` |
| Solo Bahía Comercial recibe el resumen, a administración y finanzas | `felipe@lever.test` y `bruno@lever.test` |
| El faltante nombra la nómina sin su monto, para los dos | «Atención: el saldo proyectado queda en -$8,500.00 la semana del 9 nov al 15 nov. Lo provoca: Nómina (monto reservado).» Ni el texto ni el HTML dicen 18,500 ni «1 persona» |

`correo/resumen-semanal-*.html` es el HTML que recibió el proveedor falso, y `correo/resumen-semanal-*.webp`, su captura a 640 px.

### Residuo conocido de la nómina de una persona

El renglón y las alertas ya no dicen el monto, pero los totales siguen como estaban, por decisión del líder:
- La columna Salidas de Inicio, en las semanas en que la nómina de una persona es la única salida, vale ese neto (`13-inicio-finanzas-*`: $18,500.00 de la semana del 16 nov en adelante).
- En el correo, «Sale en 4 semanas» es la suma de esas semanas: $55,500.00, es decir, 3 × $18,500.00.
- El monto también se puede despejar restando las demás salidas de la semana.

### Componentes huérfanos

Mi reestilo no dejó ningún componente sin uso. Un recorrido de importaciones (cierre transitivo, sin contar pruebas) da cuatro huérfanos en `src/components` sobre el head, y los cuatro ya lo eran en `81da672`, la base de la rama: `consola/consola-vacia.tsx`, `consola/relato.ts`, `proveedores/panel.tsx` y `proveedores/pantalla.tsx`. Allí había un quinto, `telefono/telefono-sin-flujo.tsx`, que #56 ya borró. No se borraron; se listan también en el cuerpo del PR. Entre ellos, `src/components/consola/consola-vacia.tsx` no se pinta en ninguna ruta desde `3e996d2`; de todos modos se le quitó el descargo de SPEI, y «emisor» y «participante» quedaron solo donde son verdad.

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

2. **Base y sesiones.** El script crea la base `ola1b_consola`, aplica `db/migrations` y carga `tests/e2e/seed-pagos.sql` (Taller del Cierre, con Gil y Rosa). En Taller crea con los servicios del producto el área «Operación», a Marta Ruiz con nómina semanal y su lote preparado (para el expediente, el lote y el alta con áreas), y declara un saldo de $20,000.00: con la nómina semanal la proyección cae bajo cero, e Inicio y Pendientes pintan la alerta de faltante. Después da de alta Altamar Logística con Laura, agrega a Fernanda (solo finanzas) y a Ofelia (personal SOFIPO), y deja sesiones con segundo factor:

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
   node scripts/evidencia/ola1b-consola.mjs tablas
   node scripts/evidencia/ola1b-consola.mjs barra
   node scripts/evidencia/ola1b-consola.mjs caida
   node scripts/evidencia/ola1b-consola.mjs flujos
   DISENO=<carpeta con plat-*.png> node scripts/evidencia/ola1b-consola/comparar.mjs
   ```

   - Para correr solo algunas pantallas: `SOLO=40,41`. Para algunos temas o tamaños: `TEMAS=oscuro`, `ANCHOS=390`. Para algunos flujos: `FLUJOS=8,9`.
   - `SUFIJO` nombra el `datos/<corrida><SUFIJO>.json`.
   - **Los flujos se corren justo después del paso 2.** Autorizar un pago exige un segundo factor de menos de 30 minutos, y el guion se detiene si las sesiones sembradas son más viejas.
   - Para el rechazo del flujo 6, el guion envejece el factor de Laura a 31 minutos con SQL de dueño, en la base desechable.

6. **Flujo 9 con SAT simulado.** Se vuelve al paso 2 y se arranca el servidor con el preload además del de Blob. Después se corre solo el flujo 9:

   ```sh
   NODE_OPTIONS="--import=<preload de Blob> --import=./scripts/evidencia/ola1b-consola/sat-simulado.mjs" \
     SAT_SIMULADO_IP=203.0.113.69 SAT_SIMULADO_BITACORA=<bitácora> npx next start -p 4807
   FLUJOS=9 SAT_SIMULADO=ok SUFIJO=-sat-simulado-ok node scripts/evidencia/ola1b-consola.mjs flujos
   ```

   Para la corrida negativa se repite con `SAT_SIMULADO_IP=10.0.0.5` y `SAT_SIMULADO=ip-privada`.

7. **Flujo 14.** El servidor arranca además con `--import=./scripts/evidencia/ola1b-consola/error-forzado.mjs` y `ERROR_FORZADO_ARCHIVO=<fuera del repositorio>/error-forzado`. La misma variable se le pasa al guion, que crea y borra el archivo. Sin el archivo, el preload no cambia nada; por eso los flujos 1 a 14 corren juntos sobre ese servidor.

8. **Correo del lunes.** Se vuelve al paso 2 con `CORREO_SEMANAL=1`. Luego se arranca el servidor con `RESEND_API_KEY=re_falso_local`, `CORREO_REMITENTE="Lever <avisos@lever.test>"`, `CRON_SECRET` y `CORREO_FALSO_ARCHIVO` (los dos fuera del repositorio), y con `--import=./scripts/evidencia/flujo-de-caja-correo-falso.mjs`:

   ```sh
   CORREO_FALSO_ARCHIVO=<archivo> CRON_SECRET=<secreto> node scripts/evidencia/ola1b-consola.mjs correo
   ```
