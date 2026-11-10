# CSP estricta con `main` integrado (#59 y #65)

Recorrido del 2026-11-10 sobre el #62 con `main` (`dfe583e`) integrado, con la CSP estricta, contra `next build` + `next start` en 3181, Postgres 17.9 en 5581 (base nueva sembrada en cada corrida) y el emulador de Blob en 4881. «Un botón que no se validó clicándolo = trabajo no terminado.»

| Navegador | Origen | Resultado |
|---|---|---|
| Chromium | `http://localhost:3181` | 12 de 12 |
| WebKit | `https://localhost:3182` → `3181` (certificado autofirmado de un día, fuera del repositorio) | 12 de 12 |

WebKit va por https porque no manda la cookie `__Host-sesion` (Secure) por `http://localhost`; así nada se intercepta.

## Qué se recorrió

| Captura | Spec | Qué prueba |
|---|---|---|
| `*-csp-publicas`, `*-csp-consola`, `*-csp-telefono`, `*-csp-operacion` | `csp.spec.ts` | Cada ruta del registro de su superficie, incluidas las del #59 (Personal, Cumplimiento, Lista de Personas Bloqueadas `/operacion/lpb`, Clientes, ficha y expediente, Aprobaciones, Alertas, Comisiones, Precios, Recuperaciones y Bitácora): la política con nonce, 0 eventos `securitypolicyviolation` y ninguna etiqueta `<script>` o `<style>` sin el nonce de su respuesta |
| `*-csp-fuera-del-matcher` | `csp.spec.ts` | `/_nextfoo`, `/__next/…` y `/favicon.ico` responden la 404 con nonce; `_next/static` sigue fuera del proxy |
| `*-csp-sin-js-entrada` | `csp.spec.ts` | Sin JavaScript, el formulario de entrada se envía (`form-action 'self'` y `Referrer-Policy: same-origin`) y el navegador no anota nada |
| `*-01-entrada-cliente-totp` | `csp-evidencia.spec.ts` | Entrada del cliente clicada con contraseña y TOTP hasta la consola |
| `*-02-entrada-operacion-totp` | `csp-evidencia.spec.ts` | Entrada de Operación clicada con contraseña y TOTP hasta `/operacion` |
| `*-03-expediente-descarga` | `csp-evidencia.spec.ts` | En el expediente de Duna se sube un PDF y se hace clic en su enlace: el navegador lo descarga con su nombre y empieza con `%PDF-`; la dirección responde 200 con `sandbox; default-src 'none'; frame-ancestors 'none'` y `attachment`; la pantalla del expediente lleva la política estricta |
| `*-04` a `*-07-sin-js-…` | `csp-evidencia.spec.ts` | Sin JavaScript, una página de cada superficie (`/entrar`, `/consola`, `/telefono`, `/operacion`) responde 200 con la política estricta y 0 anotaciones en la consola |

En cada paso: 0 anotaciones de la política en la consola y, con JavaScript, 0 eventos de violación. Se mide antes de cada captura, porque al capturar el inspector de WebKit inserta un `<style>body {}</style>` y la política lo rechaza; es de la herramienta, no de la app. Por eso la prueba «sin JavaScript» de `csp.spec.ts` mide antes de su captura: sin capturas pasaba igual en WebKit.

En WebKit, la captura de página completa repite la barra fija encima del contenido. Es como la herramienta pinta lo `sticky`; en la página no pasa.

## Repetir

```sh
E2E_SERVER_ACTIONS=1 npx next build
E2E_ADMIN_URL=postgres://postgres@127.0.0.1:5581/postgres E2E_PUERTO=3181 E2E_BLOB_PUERTO=4881 E2E_CAPTURAS=<carpeta> \
  npx playwright test tests/e2e/csp.spec.ts tests/e2e/csp-evidencia.spec.ts --browser=chromium
# WebKit: el proxy https local del #63 (scripts/evidencia/https-local.mjs) con un certificado de un día fuera del repositorio
LLAVE=<fuera>/llave.pem CERT=<fuera>/cert.pem DESDE=3182 HACIA=3181 node scripts/evidencia/https-local.mjs &
E2E_BASE_URL=https://localhost:3182 E2E_ADMIN_URL=postgres://postgres@127.0.0.1:5581/postgres E2E_PUERTO=3181 \
  E2E_BLOB_PUERTO=4881 E2E_CAPTURAS=<carpeta> npx playwright test tests/e2e/csp.spec.ts tests/e2e/csp-evidencia.spec.ts --browser=webkit
```

`csp-evidencia.spec.ts` solo corre con `E2E_CAPTURAS`; en CI queda omitida.
