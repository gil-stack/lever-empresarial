# Aviso de cambio de CLABE de proveedor (M-1)

## Qué fallaba

Cuando alguien cambiaba la CLABE de un proveedor, el correo de alerta a administradores y liberadores **nunca salía**.

La llave de idempotencia era `clabe-proveedor/<clabe>/<correo>`. Como lleva el correo, trae `@` y `.`, y `enviadorResend` solo acepta `[A-Za-z0-9/_-]` (`src/server/correo/resend.ts`). El enviador rechazaba el mensaje con `correo_no_disponible` antes de tocar la red. El cambio sí quedaba asentado, pero la pantalla decía «No salió ningún correo de alerta: avisa hoy mismo a administradores y liberadores por otro medio».

Lo encontró el revisor del #63 al probar la función real.

**Por qué no lo atrapó ninguna prueba:**
- La prueba de base pasaba un enviador falso que no validaba la llave.
- Ninguna e2e cambiaba la CLABE de un proveedor.

## Arreglo

`src/server/proveedores/avisos.ts`: cada destinatario lleva la llave `clabe-proveedor/<clabe>/<sha256 del correo en minúsculas>`.
- Es una llave por persona, estable entre reintentos: Resend no manda un segundo correo con la misma llave.
- Sin datos personales en la llave.
- Las demás llaves de la aplicación no llevan correos: `recuperacion/<id>`, `invitacion/<id>`, `seguridad/<cambio>/<usuario>/<ms>`, `clabe-nomina/<id>` y `correo-semanal/<empresa>/<fecha>/<persona>`.

## Pruebas, primero en rojo sobre main `dd24198`

| Prueba | Sin el arreglo | Con el arreglo |
|---|---|---|
| `tests/proveedores/pagos-proveedores.test.ts`, «el aviso de CLABE sale por el enviador real de Resend, una vez por persona» (test:db). Usa `enviadorResend` con un fetch falso: dos personas, dos llaves distintas sin el correo, y las mismas llaves en un reintento | 0 avisos de 2 | 30/30 |
| `tests/e2e/pagos-proveedores.spec.ts`, «cambio de CLABE de un proveedor: avisa por correo…». Alta de un proveedor propio, cambio de CLABE con clics, mensaje «Se avisó por correo a 2 personas.» y los dos correos en el buzón local con la terminación, sin la CLABE completa | La pantalla dice «No salió ningún correo de alerta» | La suite completa pasa: 8/8 |

Salidas: `prueba-postgres-rojo-verde.txt` y `e2e-rojo-verde.txt`.

## Evidencia funcional

- `cambio-clabe-con-aviso.png`: el expediente después de guardar la CLABE nueva («Quedó la CLABE nueva… Se avisó por correo a 2 personas.»).
- `correo-cambio-clabe.png`: el correo tal como llegó al buzón local, renderizado.
- `correos-enviados.txt`: los dos correos (destinatario, asunto, llave y texto), con datos de prueba `@ejemplo.mx`.
