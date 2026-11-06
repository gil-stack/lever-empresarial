# Evidencia: «Endurece cuentas y separa superficies»

Recorrido clicado con Playwright headless (`playwright` del repo, sin el navegador del MCP) por `scripts/evidencia/seguridad-cuentas.mjs`. Cada paso es un clic real en la interfaz; la base solo se toca como dueño para simular el paso del tiempo, para dejar el enlace de recuperación que llegaría por correo y para leer la bitácora que prueba cada paso. `recorrido.txt` es la salida literal de la corrida que dejó estas capturas (todas las aserciones en verde).

## Entorno

| Pieza | Valor |
| --- | --- |
| Base | Postgres 17 local en `127.0.0.1:5531`, base `plataforma` recreada desde cero, migraciones `0001`–`0025` con `db/migrate.sh` |
| Personas | Personal de plataforma `op@lever.test` y `op2@lever.test`; administradora `ana@demo.test` (Ana Admin) de «Demo Seguridad SA de CV», dada de alta con `scripts/plataforma.ts empresa:alta --demostracion` |
| Servidor | `next build` y `next start -p 4805` (build de producción): las cookies llevan `__Host-` y todo lo demás corre como en Vercel |
| Passkeys | Autenticador de plataforma virtual de Chromium (CDP `WebAuthn.addVirtualAuthenticator`). En producción las passkeys solo valen en los dominios de `AUTENTICACION_DOMINIOS`; en local vale `localhost` |
| Correo | `RESEND_API_KEY` ficticia y `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9`: ningún correo sale. Cada aviso falla, no deshace el cambio y queda registrado (`avisos-registrados.jsonl`) |
| TOTP | El script calcula el código con la semilla que la pantalla muestra al inscribir y nunca repite un paso de 30 s |

Por qué la corrida final es sobre `next start` y no `next dev`: el worktree vive dentro del repositorio y Turbopack vigila la carpeta padre, donde otros agentes escriben en sus propios worktrees. Cada cambio ajeno recompilaba y recargaba `/entrar` sin fin. Los flujos (a)–(f) también pasaron sobre `next dev -p 4805` en corridas anteriores. El build de producción, además, es el que se publica.

## Flujos

| Flujo | Qué se clicó | Resultado verificado | Capturas |
| --- | --- | --- | --- |
| (a) Regenerar respaldos | Con el factor de hace 6 min: «Generar códigos nuevos», luego «Confirmar con el código» y otra vez «Generar códigos nuevos» | La página pide «Confirma que eres tú»; sin confirmar no se generan códigos (bitácora sin `respaldo_generado`); confirmar queda como `reautenticacion`; después sí se generan y quedan auditados | `a1`–`a4` |
| (b) Passkey y app autenticadora | Con el factor de hace 6 min: «Agregar una passkey», «Revocar la app», «Configurar la app autenticadora»; cada uno antes y después de confirmar (con código o con passkey) | Sin confirmar no se registra la passkey, no se quita la app y no se muestra un QR. Tras confirmar: passkey registrada, app quitada y app nueva activa, cada una auditada. Confirmar con passkey renueva el factor de la sesión | `b1`–`b5` |
| (c) Recuperación de segundo factor | Ana pide recuperación; el personal abre `/entrar/recuperaciones` y aprueba en `/operacion/recuperaciones` con el factor de hace 6 min, luego confirma y aprueba; el personal pide la suya e intenta aprobarla | La ruta vieja lleva a Operación; sin confirmar la solicitud sigue `solicitada`; tras confirmar queda `aprobada` y auditada a nombre del personal; nadie aprueba su propia solicitud (`misma_persona_en_recuperacion`) | `c1`–`c4` |
| (d) Superficies | El personal entra por `/entrar` (sesión cliente) y abre `/precios`, `/consola/lista-69b` y `/operacion/recuperaciones`; luego entra por la puerta SOFIPO e intenta publicar un precio con el factor de hace 31 min | Con sesión cliente no ve publicar precio ni cargar la 69-B, y Operación lo manda a su puerta. Con sesión SOFIPO ve el formulario, pero publicar exige factor de 30 min o menos y no se publica nada | `d1`–`d4` |
| (e) `/recuperar` | «Enviar el enlace» con `ana@demo.test` y con `nadie@demo.test` | Mismo texto y tiempos parecidos (`e-tiempos.json`: 1856 ms y 1832 ms; piso de 1.5 s) | `e-existente`, `e-inexistente` |
| (f) Inactividad | `ultimo_uso` de la sesión de Ana se mueve 31 min atrás | La consola manda a `/entrar`; al volver a entrar con su segundo factor abre otra vez | `f1`, `f2` |
| (g) Cookies `__Host-` | Contraseña y segundo factor contra el build de producción | `__Host-entrada` tras la contraseña y `__Host-sesion` tras el factor, ambas `Secure`, `HttpOnly`, `Path=/` y sin `Domain` (host-only); no queda ninguna cookie sin prefijo; el portal honra la sesión (`g-cookies.json`, sin valores) | `g1` |
| (h) Contraseña por correo | Con Ana dentro de la consola, otro navegador abre el enlace de recuperación y clica «Guardar la contraseña»; luego intenta entrar con la anterior y con la nueva | Se cierran todas las sesiones de Ana y no queda ninguna entrada a medias; el cambio queda auditado (`contrasena_restablecida`) y el aviso `contrasena_cambiada` se intenta; la sesión abierta ya no abre la consola; la contraseña anterior no entra; la nueva pide el segundo factor antes de crear sesión, y con su app de siempre entra | `h1`–`h4` |

## Avisos por correo

`avisos-registrados.jsonl` es la salida del servidor durante la corrida. Cada cambio de factor manda su aviso y, como el correo local no sale, queda registrado sin deshacer el cambio: `respaldo_regenerado`, `passkey_agregada`, `totp_quitado`, `totp_activado`, `recuperacion_aprobada` y `contrasena_cambiada` (dos veces: el cambio de (h) y la restauración de la contraseña al final). `recuperacion_correo_no_enviado` es el enlace de (e) que no salió; esa solicitud se anula y la persona ve lo mismo que todos.

## Índice de contraseñas fallidas

`fallos_de_contrasena` cuenta `entrada_fallida` por persona. Con `audit_log_entrada_fallida_idx` (0025) el plan es un Index Only Scan sobre el índice parcial. Este plan es de la base del recorrido, que tiene pocas filas, así que se pidió con `SET enable_seqscan = off`:

```
 Aggregate  (cost=8.17..8.18 rows=1 width=4)
   ->  Index Only Scan using audit_log_entrada_fallida_idx on audit_log  (cost=0.15..8.17 rows=1 width=0)
         Index Cond: ((identificador = '00000000-0000-4000-8000-000000000001'::uuid) AND (ocurrido_en >= (now() - '00:15:00'::interval)))
```

`tests/autenticacion/seguridad-cuentas.test.ts` lo exige sin ese ajuste: siembra 20,000 filas en `audit_log`, corre `ANALYZE` y falla si el plan no usa el índice o si hace un Seq Scan.

## Cómo repetirlo

```sh
# Base desechable local, nunca una remota.
DATABASE_URL_UNPOOLED=postgres://<dueño>@127.0.0.1:5531/plataforma ./db/migrate.sh
# Siembra: personal con `scripts/plataforma.ts personal:migrar-variable`, empresa con `empresa:alta --demostracion`.
npm run build
AUTENTICACION_DOMINIOS=localhost URL_APLICACION=http://localhost:4805 \
  DATABASE_URL=postgres://plataforma_app:<clave>@127.0.0.1:5531/plataforma \
  AUTENTICACION_LLAVE_TOTP=<base64 de 32 bytes> npx next start -p 4805
BASE=http://localhost:4805 \
  DUENO_URL=postgres://<dueño>@127.0.0.1:5531/plataforma \
  SEMILLAS=/ruta/fuera/del/repo/semillas.json \
  node scripts/evidencia/seguridad-cuentas.mjs
```

`SOLO=a,c` corre solo esos flujos. El script rechaza un `DUENO_URL` que no sea local y un archivo de semillas dentro del repositorio.
