# Recorridos de pagos a proveedores

Requisitos: Chrome instalado, Postgres local en `127.0.0.1:55432`, `DATABASE_URL` apuntando a `lever_pagos_dev` con el rol `plataforma_app`, y las credenciales privadas de Blob en el entorno. Nunca usar una base de producción.

```sh
npm run test:e2e:reset
DATABASE_URL=postgres://plataforma_app:aplicacion-local@127.0.0.1:55432/lever_pagos_dev npm start -- --port 3109
# En otra terminal, con las mismas variables de base y Blob:
npm run test:e2e
```

- `E2E_ADMIN_URL` cambia el Postgres administrador usado por el seed.
- `E2E_BASE_URL` cambia el origen del portal; debe coincidir con el origen de las Server Actions.
- `CHROME_PATH` permite usar otro ejecutable de Chrome.

La suite crea capturas en `docs/evidence/pagos-proveedores/`. Ejercita mesa, claro/oscuro, móvil, alta, CFDI, excepción, descarga privada, segunda firma, rechazo, corrección y cancelación. No envía dinero ni escribe en producción.
