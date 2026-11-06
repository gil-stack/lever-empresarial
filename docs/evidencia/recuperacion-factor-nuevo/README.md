# Evidencia: «Corrige la recuperación aprobada del segundo factor»

Este es un recorrido clicado con Playwright headless (el `playwright` del repo, no el navegador del MCP), hecho por `scripts/evidencia/recuperacion-factor-nuevo.mjs`.

Cada paso es un clic real en la interfaz. La base solo se toca como dueña para dos cosas:
- simular el paso del tiempo: el sello del factor del personal se mueve 6 minutos atrás, en una transacción con `session_replication_role = replica`;
- leer lo que prueba cada paso.

`recorrido.txt` es la salida literal de la corrida sobre una base nueva, con todas las aserciones en verde.

## La falla que corrige

Antes de este cambio, la recuperación aprobada no servía para volver a entrar:
1. Una persona con su app y sus códigos de respaldo pedía la recuperación.
2. Otra persona del personal la aprobaba.
3. Al volver a entrar con su contraseña, la puerta le pedía otra vez el factor perdido («verificar») porque seguía viendo los factores viejos.
4. Inscribir uno nuevo fallaba con `ya_tiene_segundo_factor`.

Mientras tanto, el correo le decía que ya podía registrar un factor nuevo.

## Entorno

| Pieza | Valor |
| --- | --- |
| Base | Postgres 17 local en `127.0.0.1:5531`. La base `plataforma` se recrea desde cero y se aplican las migraciones `0001`–`0025` y `0027` con `db/migrate.sh` (la `0026` es del PR #52, todavía sin integrar) |
| Personas | Personal de plataforma `op@lever.test` y `op2@lever.test`. Administradora `laura@demo.test` (Laura Méndez) de «Demo Recuperación SA de CV», dada de alta con `scripts/plataforma.ts empresa:alta --demostracion` |
| Servidor | `next build` y `next start -p 4805`, el build de producción, con cookies `__Host-` |
| Correo | `RESEND_API_KEY` ficticia y `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9`, así que ningún correo sale. El aviso falla, no deshace el cambio y queda registrado sin datos personales (`aviso-registrado.jsonl`) |
| TOTP | El script calcula el código con la semilla que muestra la pantalla y nunca repite un paso de 30 s |

## Cómo repetirlo

1. Recrea la base con las migraciones y siembra a las personas: `op` y `op2` con `personal:migrar-variable`, y Laura con `empresa:alta --admin-correo laura@demo.test --demostracion`. Acepta cada invitación con la contraseña `clave-segura-12`.
2. Corre `next build` y luego `next start -p 4805` con `DATABASE_URL` en la base local, `AUTENTICACION_LLAVE_TOTP`, `AUTENTICACION_DOMINIOS=localhost` y el correo bloqueado como en la tabla. Guarda la salida del servidor en un archivo fuera del repo.
3. Corre el recorrido:

   ```
   BASE=http://localhost:4805 DUENO_URL=postgres://dueno@127.0.0.1:5531/plataforma \
   SERVIDOR_LOG=/ruta/fuera/del/repo/prod.log node scripts/evidencia/recuperacion-factor-nuevo.mjs
   ```

## Pasos

| Paso | Qué se clicó | Resultado verificado | Captura |
| --- | --- | --- | --- |
| 1 | Laura entra por primera vez y registra su app. Su sesión queda abierta («otro equipo») | Tiene una app confirmada y diez códigos de respaldo | `01` |
| 2 | En otro navegador escribe su contraseña, elige «Perdí el segundo factor» y «Pedir recuperación» | La solicitud queda `solicitada` | `02` |
| 3 | `op` entra a Operación con su factor de hace 6 minutos, abre Recuperaciones, confirma con su código en «Confirma que eres tú» y aprueba | La página pide confirmar antes de aprobar, y la solicitud queda `aprobada` | `03`, `04` |
| 4 | Laura escribe su contraseña | Ve «Recuperación aprobada · Registra un factor nuevo», con el aviso de que lo anterior dejará de servir. La contraseña sola no abre sesión. La app nueva queda pendiente junto a la vieja, que sigue viva hasta confirmar | `05` |
| 5 | Escribe el código de la app nueva y hace **doble clic** en «Confirmar el código» | Queda **exactamente una** app confirmada vigente, la nueva, sin ninguna pendiente. La bitácora tiene una sola confirmación nueva. La app vieja queda revocada a nombre de Laura, solo valen los diez códigos nuevos y la recuperación queda `cumplida`. Laura queda con una sola sesión, la nueva. Tras el doble clic, los códigos nuevos siguen a la vista | `06`, `07` |
| 6 | El otro equipo recarga `/consola`. En un navegador nuevo, Laura prueba un código de la app vieja, luego un código de respaldo viejo y luego la app nueva | La sesión del otro equipo se cerró y la consola lo manda a `/entrar`. La app vieja y el código viejo no entran y cada intento queda como `segundo_factor_fallido`. La app nueva sí entra | `08`–`11` |
| 7 | Lectura de la bitácora y de la salida del servidor | Los seis eventos de la inscripción quedan en una sola transacción (`bitacora.txt`) y `totp_revocado` apunta a la app vieja. El aviso `factor_reinscrito` se intentó y quedó registrado sin el correo de la persona (`aviso-registrado.jsonl`) | — |

En `bitacora.txt`, la transacción de la inscripción tiene estos eventos:
- `totp_revocado`: la app vieja;
- `sesion_cerrada`: la sesión del otro equipo;
- `totp_confirmado`: la app nueva;
- `respaldo_generado`: los códigos viejos quedan invalidados y nacen los nuevos;
- `recuperacion_cumplida`;
- `entrada_completa`: la sesión nueva.

Laura no tenía passkey, así que no hay `passkey_revocada`. Ese caso lo cubre la prueba en Postgres.

## Lo que cubren las pruebas automáticas

`tests/autenticacion/recuperacion-factor-nuevo.test.ts` corre en un Postgres desechable y es parte de `scripts/ci/pruebas-postgres.sh`. Cubre lo que el recorrido no puede forzar con clics:
- Con app vieja, passkey vieja, códigos y una sesión abierta en otro equipo, se revocan la passkey y la app, se invalidan los códigos y se cierra la sesión. Los siete eventos quedan en un solo `txid`.
- **Rollback completo** en dos casos: cuando la app que se confirma no existe (falla después de revocar) y cuando la recuperación vence justo antes (falla al final, después de confirmar la nueva). En los dos, nada cambia.
- Con la recuperación vencida, la persona vuelve a «verificar» y no puede inscribir.
- Sin recuperación, quien tiene factores sigue en «verificar», y la base rechaza inscribir otro (`ya_tiene_segundo_factor`).
- El índice de `0027` rechaza dos apps confirmadas vigentes y dos pendientes.
- Con una passkey nueva, la vieja se revoca antes de guardar la nueva, y la nueva queda vigente.
- Dos confirmaciones enviadas a la vez dejan exactamente una app nueva: una entra y la otra se rechaza.
