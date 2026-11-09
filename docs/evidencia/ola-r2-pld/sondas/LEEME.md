# Sondas de la revisión del #61 como aceptación

Son las sondas que el revisor escribió contra 94303bc (`revision-61-base-scripts/`, con su `correr-sondas.sh`), vueltas a correr sobre **88cef58** (`head.txt`). Corrieron contra un Postgres 17 desechable en 127.0.0.1:5553: la base `plataforma` se crea desde cero, se migra con `db/migrate.sh` hasta la 0030 (`migracion.txt`) y se siembra con los servicios reales (`sembrar.out`). Nada toca Neon, Vercel ni Blob.

Después de 88cef58 solo cambiaron el marcado de tres pantallas, una regla de CSS y el script del recorrido; ni la 0030 ni `src/server/**`. Las sondas prueban la base y los servicios, así que valen para el head final.

## Qué muestra cada salida

| Salida | Hallazgos | Antes (94303bc) | Ahora |
| --- | --- | --- | --- |
| `sonda-reenvio.out` | base-N1 | El pago corregido y liberado otra vez no pasaba por las reglas | La versión 3 entra a `pld_operaciones` y da «Excede el perfil» con suma $900,000.00, lo liberado de verdad. La línea «suma del mes que ven las reglas: 90100000» es una suma de la sonda sin descontar la versión reemplazada; las reglas la descuentan (`0030:966`) |
| `sonda-60.out` | base-N2, base-N3, base-N4 | El acta de CUM2 mostraba el caso; CUM2 perdía un caso al sumarle un aviso que la excluye; un aviso podía excluir a todo Cumplimiento | A y B: el acta de CUM2 dice «No se votaron casos». C: CUM2 no ve la alerta del caso oculto (`alerta_no_existe`); la «sin caso» que sí ve es la de Gamma, ajena. D: `serie_con_persona_excluida` y el caso de CUM2 sigue suyo. E: `aviso_sin_cumplimiento` y 3 → 3 avisos |
| `excluidos.out` | base-N2, base-N3, serv-N3 | AUD y CUM2 bajaban el acta y el manifiesto contaba lo oculto | El acta les responde `documento_no_existe`; los conteos del manifiesto de AUD son menores que los de CUM (lo que su RLS le deja ver) |
| `sonda-50.out` | base-N5, serv-N2 | El auditor podía ser integrante, votar y dar quórum | `comite_auditor_integrante` al registrarlo; la sesión con él como presente da `sesion_presentes_invalidos` |
| `sonda-sesion-atrasada.out` | base-N6 | Un dictamen de sesión fechada atrás salía «a tiempo» | Las dos sesiones quedan `fuera_de_plazo` |
| `sonda-limite-exclusion.out` | base-N7, base-N17 | Zeta y Yota con la suma arriba del límite y 0 alertas; exclusión sin persona aceptada | 1 alerta cada una; la exclusión sin persona da `exclusion_fuera_del_aviso`, sin eventos |
| `sonda-carreras.out` | base-N8, base-N9 | C1 sin alerta por el cruce de relojes; la alerta B entraba al caso ya dictaminado | C1 y C2 con su alerta de fraccionamiento; la suma de CUM2 espera el candado del caso y sale `caso_ya_dictaminado` |
| `sonda-reportes.out` | base-N16 | La columna 41 empezaba con `=HYPERLINK(…)` | 41 columnas, «campos que empiezan con = + - @: []»; `campo41('@SUMA(1+1)')` = « @SUMA(1+1)» |
| `sonda-invisibles.out` | base-N14 | Los CHECK de folio y área aceptaban U+00AD, U+200B, U+FEFF y otros | El servidor rechaza todos con `invisible_<campo>` y los CHECK del head también (última columna) |

## Adaptaciones a las sondas (solo en la copia que corrió aquí)

Ninguna cambia lo que se mide. Las de las sondas están marcadas en su código con «Adaptación al head».

- **Rol de la tarea (entorno, no sonda).** En el clúster desechable de 5553 la dueña recibió `plataforma_tarea` con `ADMIN OPTION` antes de migrar; sin eso, `db/migrate.sh` se detenía con «must have ADMIN option on role "plataforma_tarea"». Los roles son del clúster, no de la base.
- **`sembrar.mts`, base-N18.** Beta ya está activa: Originación propone el perfil y Cumplimiento lo aprueba, en lugar de declararlo directo.
- **`sembrar.mts`, base-N5.** Cada integrante con su propio RFC y su propia CURP; antes compartían uno y la base ahora lo rechaza (`comite_persona_repetida`). El auditor se registra con el RFC y la CURP que usa `sonda-50` (AUIA700101AB1 y AUIA700101HDFRXXA1).
- **`sonda-reenvio.mts`, base-N18.** Gamma está activa: su perfil se propone y se aprueba.
- **`sonda-60.mts`, base-N3 y base-N4.** Los dos rechazos nuevos se anotan con `intento()` en vez de detener la sonda.
- **`sonda-carreras.mts`, base-N9.** La suma de CUM2 ahora espera el candado del caso mientras el dictamen no confirma: se lanza sin `await` para no bloquear a la propia sonda.
- **`sonda-invisibles.mts`, base-N14.** Agrega una columna con los CHECK del head (`pld_sin_invisibles`), además de la expresión vieja que medía el revisor.

## Límite que queda a la vista (serv-N2)

La comparación por nombre entre el auditor y los integrantes es exacta después de normalizar con `lpb_normalizar` (sin acentos, en mayúsculas y con las palabras ordenadas). Atrapa «Iván Núñez Peña», «IVAN NUNEZ PENA» y «Peña Núñez, Iván». Un apellido de más o de menos ya no coincide por nombre: en `sonda-50` el integrante «Aurelio Auditoría Interna» no es el auditor «Aurelio Auditoría» por nombre, y lo detienen el RFC y la CURP (base-N5).
