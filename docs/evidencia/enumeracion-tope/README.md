# Evidencia: el tope de intentos ya no revela qué correos tienen cuenta

Recorrido clicado con Playwright headless (no el navegador del MCP) contra `next build` + `next start` en el puerto 4805, sobre un Postgres local (5531) recién migrado (0001–0027) y sembrado.

## Qué pasaba

El tope es de **8 contraseñas fallidas en 15 minutos** por persona. A partir del 9.º intento, un correo con cuenta respondía «Hubo demasiados intentos. Espera quince minutos.» y uno sin cuenta seguía con «El correo o la contraseña no coinciden.». Así se podía saber qué correos tienen cuenta, en `/entrar` y en `/operacion/entrar`, donde además el código salía en la dirección (`?aviso=entrada_bloqueada`).

Los tiempos también eran distintos: con la cuenta en el tope no se escribe en la bitácora, y con un correo sin cuenta no se cuentan fallos.

## Qué se recorrió

En cada entrada se hicieron diez contraseñas malas con un correo con cuenta y diez con uno sin cuenta. Luego vino un undécimo intento con la **contraseña correcta**, cuando la cuenta real ya estaba en el tope.

| Entrada | Correo con cuenta | Correo sin cuenta |
|---|---|---|
| `/entrar` | `laura@demo.test` | `nadie@demo.test` |
| `/operacion/entrar` | `op@lever.test` | `nadie@lever.test` |

Por cada respuesta se compara contra la del correo sin cuenta:

- el texto del aviso;
- el marcado HTML del aviso (`outerHTML`);
- la dirección final;
- el tiempo.

La base se consulta como dueña, solo para leer: se cuentan los eventos `entrada_fallida` de la persona y las entradas abiertas.

**Resultado: 126 de 126 comprobaciones OK.** La salida literal está en [`recorrido.txt`](recorrido.txt) y los tiempos de cada intento en [`tiempos.json`](tiempos.json).

- Las 44 respuestas usan el mismo texto: «El correo o la contraseña no coinciden. Si fallaste varias veces, espera quince minutos.». El texto, el marcado y la dirección coinciden en cada par.
- En Operación la dirección es `/operacion/entrar?aviso=credenciales_invalidas` en los tres casos.
- La bitácora anota 8 fallos por persona. Los intentos 9, 10 y 11, hechos con la cuenta en el tope, no se anotan.
- La contraseña correcta en el tope no abrió entrada.
- Control: `op2@lever.test`, sin fallos, entra con su contraseña en unos 700 ms. La entrada correcta no espera el piso.
- No hubo errores de consola.

## Tiempos (11 intentos por caso)

| Entrada | Medida | Con cuenta (mín–máx · mediana) | Sin cuenta (mín–máx · mediana) |
|---|---|---|---|
| `/entrar` | acción en el servidor | 1503–1512 · 1505 ms | 1502–1506 · 1504 ms |
| `/operacion/entrar` | acción en el servidor | 1503–1509 · 1505 ms | 1503–1522 · 1507 ms |
| `/operacion/entrar` | primer byte (acción + redirección) | 1510–2384 · 2122 ms | 1778–2109 · 1984 ms |
| ambas | en pantalla (informativo) | 1609–2858 ms | 1604–2562 ms |

- **Acción en el servidor:** va del envío del formulario al primer byte de la respuesta. Todo rechazo espera el piso de 1500 ms (`PISO_RECHAZO_MS`), y en cada intento la diferencia entre los dos correos fue de 100 ms o menos.
- **Redirección de Operación:** la acción de `/operacion/entrar` redirige, y Next arma la página de destino con un fetch interno a `localhost`. En local ese fetch tarda entre 5 y 1100 ms. Cuando reutiliza una conexión que estuvo inactiva, tarda unos 500 ms, y eso se repite con un proceso Node aparte, sin Next de por medio. La dirección de destino es idéntica para los tres casos, así que esa variación no depende de la cuenta. El recorrido la mide con la precarga [`scripts/evidencia/medir-fetch-interno.mjs`](../../../scripts/evidencia/medir-fetch-interno.mjs) y la resta.
- **En pantalla:** suma el pintado del navegador. Es informativo: la respuesta del servidor ya es igual en texto, marcado y tiempo.

La comprobación de tiempo más fina está en `tests/autenticacion/enumeracion-tope.test.ts`, con Postgres y bcrypt reales: tres rondas de los tres casos quedan todas entre 1499 y 1501 ms.

## Capturas

Cada intento tiene su captura de la tarjeta de entrada, en `<entrada>-<real|inexistente>-<NN>.jpg`. Por ejemplo, `cliente-real-09.jpg` y `cliente-inexistente-09.jpg`.

Las comparaciones lado a lado del 9.º intento (el primero con la cuenta en el tope) y del 11.º (contraseña correcta en el tope) son:

- [`lado-a-lado-cliente-09.png`](lado-a-lado-cliente-09.png)
- [`lado-a-lado-cliente-11.png`](lado-a-lado-cliente-11.png)
- [`lado-a-lado-operacion-09.png`](lado-a-lado-operacion-09.png)
- [`lado-a-lado-operacion-11.png`](lado-a-lado-operacion-11.png)

La entrada correcta de control está en [`control-op2-entra.jpg`](control-op2-entra.jpg).

## Cómo repetirlo

1. Prepara la base local, con el mismo procedimiento que en `docs/evidencia/recuperacion-factor-nuevo/README.md`:
   - Postgres local desechable;
   - `db/migrate.sh` hasta la 0027;
   - personal `op@lever.test` y `op2@lever.test`;
   - empresa de demostración con `laura@demo.test` como administradora;
   - todas con la contraseña `clave-segura-12`.
2. Haz `npx next build`.
3. Arranca el servidor con la precarga y guarda su salida fuera del repo:

   ```sh
   NODE_OPTIONS="--import ./scripts/evidencia/medir-fetch-interno.mjs" \
     DATABASE_URL=postgres://plataforma_app:…@127.0.0.1:5531/plataforma \
     ./node_modules/.bin/next start -p 4805 > /tmp/next-start.log 2>&1 &
   ```

4. Corre el recorrido:

   ```sh
   BASE=http://localhost:4805 \
     DUENO_URL=postgres://dueno@127.0.0.1:5531/plataforma \
     SERVIDOR_LOG=/tmp/next-start.log \
     node scripts/evidencia/enumeracion-tope.mjs
   ```

El recorrido exige que las personas empiecen sin fallos, así que cada corrida necesita una base nueva. Rechaza un `DUENO_URL` que no sea local.
