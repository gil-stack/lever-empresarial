# Evidencia: estabilización de la entrada SOFIPO

Recorrido hecho el 6 de noviembre de 2026 con Playwright contra `next dev` en el puerto 4793 y un Postgres 17 local desechable con las 21 migraciones. No se usó Neon production.

| Captura | Flujo |
| --- | --- |
| `03-operacion-portal-abierto.png` | Personal SOFIPO en un navegador limpio: correo y contraseña en `/operacion/entrar`, registro de TOTP en `/operacion/continuar`, códigos de respaldo y apertura de `/operacion`. Antes del cambio, `/operacion/continuar` regresaba a `/operacion/entrar` (307) porque el proxy no reconocía `entrada_operacion` |
| `04-cliente-entra-a-consola.png` | Regresión del cliente: contraseña en `/entrar`, TOTP y llegada a `/c/<empresa>/consola` |
| `05-pagina-no-encontrada.png` | Ruta inexistente: responde 404 con la marca y en español |
| `06-landing-ver-la-demo.png` | «Ver la demo» de la portada lleva a la sección Producto en lugar de `/muestrario`, que responde 404 en producción |

Las capturas de la semilla TOTP y de los códigos de respaldo no se suben al repositorio.

Además se comprobó que `/c/<empresa ajena>/telefono` responde 404 real (antes 200 por el `loading.tsx` del teléfono).
