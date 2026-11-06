# Recorridos de navegador

Una sola configuración (`playwright.config.ts`) corre todos los `*.spec.ts` de esta carpeta: Personas y Pagos a proveedores.

Requisitos: el Chromium de Playwright (`npx playwright install chromium`), un Postgres local desechable y, para los recorridos que suben archivos de Pagos a proveedores, credenciales de un almacén privado de Blob que no sea de producción. Nunca usar una base de producción.

```sh
E2E_ADMIN_URL=postgres://<usuario>@127.0.0.1:<puerto>/postgres npm run test:e2e
```

`npm run test:e2e` compila y luego `tests/e2e/global-setup.ts`:

1. crea una base nueva con nombre aleatorio y le aplica todas las migraciones;
2. carga `seed-pagos.sql` (empresa Taller del Cierre, proveedores, cargos y las sesiones de Gil y Rosa);
3. da de alta la empresa de Personas con su administradora y una sesión;
4. levanta `next start` en el puerto de `E2E_PUERTO`.

Al terminar, `global-teardown.ts` detiene el servidor y borra la base.

- `E2E_ADMIN_URL` es el Postgres administrador donde se crea y se borra la base desechable. Puede venir sin base; entonces se usa `postgres`. Jamás debe apuntar a `plataforma`.
- `E2E_PUERTO` cambia el puerto del servidor (3109).
- `E2E_BASE_URL` cambia el origen del portal; debe coincidir con el origen de las Server Actions.
- `CHROME_PATH` permite usar otro ejecutable de Chrome; sin ella se usa el Chromium de Playwright.
- `E2E_CAPTURAS` cambia la carpeta de capturas de Pagos a proveedores (`test-results/pagos-proveedores`).

Las capturas de Personas se escriben en `docs/evidencia/personas/`; las de Pagos a proveedores, en `test-results/pagos-proveedores/` (la evidencia revisada de ese PR vive en `docs/evidencia/pagos-proveedores/`). Pagos a proveedores ejercita mesa, claro/oscuro, móvil, alta, CFDI, excepción, descarga privada, segunda firma, rechazo, corrección y cancelación. Ningún recorrido envía dinero ni escribe en producción.

## Revisar la semilla de Pagos a mano

`npm run test:e2e:reset` borra y recrea una base persistente (`lever_pagos_dev`, o la de `E2E_BASE_DATOS`) con la misma semilla, para abrirla con `npm start` y navegarla sin la suite. Usa `E2E_ADMIN_URL` sin base (por omisión, el usuario del sistema en `127.0.0.1:55432`).
