# Recorridos de pagos a proveedores

Requisitos: el Chromium de Playwright (`npx playwright install chromium`), Postgres local (por omisión `127.0.0.1:55432`), `DATABASE_URL` apuntando a `lever_pagos_dev` con el rol `plataforma_app`, y las credenciales privadas de Blob en el entorno. Nunca usar una base de producción.

```sh
npm run test:e2e:reset
DATABASE_URL=<url-local-del-rol-de-aplicacion> npm start -- --port 3109
# En otra terminal, con las mismas variables de base y Blob:
npm run test:e2e
```

- `E2E_ADMIN_URL` cambia el Postgres administrador usado por el seed.
- `E2E_BASE_URL` cambia el origen del portal; debe coincidir con el origen de las Server Actions.
- `CHROME_PATH` permite usar otro ejecutable de Chrome; sin ella se usa el Chromium de Playwright.
- `E2E_PUERTO` cambia el puerto del servidor de desarrollo (3109).
- `E2E_BASE_DATOS` cambia el nombre de la base que se recrea (`lever_pagos_dev`).
- `E2E_CAPTURAS` cambia la carpeta de capturas (`test-results/pagos-proveedores`).

La suite crea capturas en `test-results/pagos-proveedores/`; la evidencia revisada del PR vive en `docs/evidencia/pagos-proveedores/`. Ejercita mesa, claro/oscuro, móvil, alta, CFDI, excepción, descarga privada, segunda firma, rechazo, corrección y cancelación. No envía dinero ni escribe en producción.
