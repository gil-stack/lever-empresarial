# Recorridos de navegador en CI para cada flujo de dinero

Las tareas `test:e2e:1`, `test:e2e:2` y `test:e2e:3` de Vercel CI corren en cada push, en paralelo, los recorridos de `tests/e2e/` contra `next start`, con un Postgres desechable, el emulador de Blob y un proveedor de correo falso. Cada una corre un tercio de los specs (`playwright test --shard=N/3`) en su propia máquina. Si un flujo de dinero o de seguridad se rompe en el navegador, el check «Vercel CI» del PR se pone en rojo. La forma de correrlos y de agregar uno está en [`tests/e2e/LEEME.md`](../../../tests/e2e/LEEME.md).

## Flujos cubiertos

Cada envío marcado con «doble clic» se hace con `dblclick()` real y sin pausa. La prueba exige que del navegador haya salido un solo envío y que la base tenga una sola operación.

| Flujo | Spec | Qué verifica en la base |
| --- | --- | --- |
| Alta de proveedor | `pagos-proveedores.spec.ts` | Doble clic: 1 proveedor, 1 CLABE y 1 evento `alta_proveedor`. |
| Solicitud de pago con CFDI y con excepción | `pagos-proveedores.spec.ts` | Doble clic: 1 cargo con ese UUID y 1 solicitud; la excepción deja 1 solicitud del proveedor nuevo. |
| Autorización por un segundo liberador | `pagos-proveedores.spec.ts` | Doble clic: estado `listo_para_pagar`, `resuelto_por` distinto de `solicitado_por` y 1 renglón de historial con ese estado. |
| Rechazo, corrección, cancelación y descarga privada | `pagos-proveedores.spec.ts` | Historial de versiones, descarga con `sandbox` y `attachment`, y límites de archivos (pruebas previas a este PR, ahora en CI con el emulador de Blob). |
| Alta de persona con nómina | `nomina.spec.ts` | Doble clic: 1 ficha, perfil con neto, frecuencia y fecha, 1 CLABE en el historial y 1 `alta_persona`. |
| Cambio de CLABE de nómina con reautenticación | `nomina.spec.ts` | Con el factor de hace 31 min sale «Confirma que eres tú» y la CLABE, el historial y la bitácora no cambian. Tras salir y volver a entrar con contraseña y TOTP, el doble clic deja 1 cambio, el historial con un renglón más, una sola CLABE vigente y la bitácora sin los 18 dígitos. |
| Preparar el lote de nómina | `nomina.spec.ts` | Doble clic: 1 lote con la fecha vencida y el total de las personas elegibles, sus renglones, 1 `preparar_nomina` y el calendario avanzado. |
| Personas (áreas, altas, lote, baja, volumen) | `personas.spec.ts` | Fechas guardadas iguales a las del formulario, lote con el total visible, baja desaprovisionada y búsqueda entre 200 personas. |
| Saldo declarado | `flujo-de-caja.spec.ts` | Doble clic: 1 declaración y 1 `declarar_saldo`. Inicio dice «Declarado por tu empresa». |
| Cobro esperado manual y con XML | `flujo-de-caja.spec.ts` | Doble clic: 1 cobro por envío con monto y origen; un XML de otra empresa se rechaza. |
| Obligación recurrente y presupuesto al 80/100 % | `flujo-de-caja.spec.ts` | Doble clic: 1 obligación y 1 evento por alta. El área pasa de `en_rango` a `atencion` y a `excedido` en Presupuestos, Inicio y Pendientes. |
| «Mover pago» | `flujo-de-caja.spec.ts` | La proyección mueve el monto de semana y la base no cambia (`programada_el` y bitácora iguales). |
| Faltante | `flujo-de-caja.spec.ts` | Con poco saldo, Inicio y Pendientes avisan la semana y la causa, y el enlace lleva a la proyección. |
| Nómina de una sola persona | `flujo-de-caja.spec.ts` | Finanzas ve «Monto reservado» sin cifra y la administradora ve el monto. |
| Entrada de cliente con contraseña y TOTP | `entrada.spec.ts` | Doble clic: 1 entrada y 1 sesión. Un código malo no abre sesión. 1 `entrada_completa`. |
| Tope de intentos sin enumeración (#57) | `entrada.spec.ts` | 9 pares de intentos (correo real e inexistente, en orden alterno): mismo texto, marcado y dirección, tiempo de servidor ≥ 1.5 s y diferencia mediana ≤ 60 ms. La bitácora registra 8 `entrada_fallida` y la contraseña correcta en el tope no abre entrada. |
| Entrada SOFIPO con TOTP | `operacion.spec.ts` | Doble clic: 1 sesión `sofipo` nueva. Un código malo no abre sesión. |
| Prospecto → activación por otra persona | `operacion.spec.ts` | Doble clic: 1 empresa `prospecto` y 1 solicitud. Quien la pidió no ve «Aprobar». Con el factor de hace 31 min no se decide. Con factor reciente: solicitud `aprobada` por la otra persona, empresa `activa`, 1 `activacion_aprobada` y 1 cambio de estado. |
| «Perdí el segundo factor» y Recuperaciones | `operacion.spec.ts` | La clienta pide ayuda (1 solicitud). En Operación, con el factor de hace 6 min, se pide «Confirma que eres tú» y no se decide. Tras confirmar con TOTP: `aprobada` por la otra persona con «videollamada». La clienta registra un factor nuevo, el viejo queda revocado y la solicitud se cumple. |
| Publicar el precio | `operacion.spec.ts` | Con el factor de hace 31 min se rechaza y el precio sigue vacío. Tras volver a entrar, el doble clic publica 149900 centavos una sola vez (1 `publicar_precio`). |
| Invitación y «Reenviar invitación» | `invitacion.spec.ts` | Doble clic en «Enviar» y en «Reenviar»: 2 invitaciones en total, 1 vigente y 2 correos con llaves distintas. El enlace viejo dice «ya no sirve» y el nuevo crea la cuenta (1 usada, rol administrador, 1 TOTP). |
| Recuperar contraseña | `invitacion.spec.ts` | Doble clic: 1 restablecimiento y 1 correo. Al guardar, queda `usado_en` y no hay sesiones vivas. La contraseña vieja se rechaza y la nueva entra con el mismo factor. |
| Cada rol ve solo sus secciones | `roles.spec.ts` | Lateral exacto para administrador, finanzas, contador, liberador, solicitante y tarjetahabiente. Cada ruta fuera del lateral responde 404 o «Tu rol no abre…», nunca la pantalla. |
| Marco de la consola | `marco.spec.ts` | Menú de la persona, buscador, Apariencia y cajón móvil (pruebas previas a este PR, ahora en CI). |

Todas las pruebas exigen además una consola del navegador sin errores.

## Tiempos

| Dónde | Head | Resultado | Tarea completa | Recorridos |
| --- | --- | --- | --- | --- |
| Vercel CI, 4 CPU | `30a19c2` | 34 de 34 | 424 s | 6.1 min |
| Vercel CI, 4 CPU (corrida roja provocada) | `3d1de73` | 33 de 34, falla esperada | 643 s | 9.4 min |
| Vercel CI, 4 CPU (reversión) | `07c69c2` | 34 de 34 | 634 s | 9.3 min |
| Vercel CI, 8 CPU | `d7856a8` | 34 de 34 | 321 s | 4.3 min |
| Vercel CI, 8 CPU | `c967df6` | 34 de 34 | 464 s | 6.5 min |
| Vercel CI, 8 CPU | `eddd8ef` | 34 de 34 | 431 s | 5.9 min |
| Vercel CI, 8 CPU | `6450b6f` | 34 de 34 | 322 s | 4.4 min |
| Vercel CI, parte 1 de 3, 4 CPU | `ce748f8` | 14 de 14 | 212 s | 2.6 min |
| Vercel CI, parte 2 de 3, 4 CPU | `ce748f8` | 13 de 13 | 244 s | 3.0 min |
| Vercel CI, parte 3 de 3, 4 CPU | `ce748f8` | 7 de 7 | 134 s | 1.3 min |
| Local, parte 1, 2 y 3 seguidas | `ce748f8` | 14, 13 y 7 | 64, 43 y 24 s | 1.0, 0.7 y 0.4 min |
| Local (Chromium local) | `30a19c2` | 34 de 34, tres veces seguidas con base nueva | 120 s, 124 s y 126 s | 2.0 min |
| Local (Chromium local) | `d7856a8` | 34 de 34 | 119 s | 1.9 min |

Con una sola tarea de 4 CPU, el tiempo varió entre 424 y 643 s según la máquina que tocó. Con 8 CPU varió entre 321 y 464 s: los recorridos corren con un solo worker, así que más CPU casi solo acelera el build. Por eso la suite se parte en tres tareas de 4 CPU que corren en paralelo, cada una con su propio build, su propio Postgres y su propio `next start`. El tope de 12 minutos se mide por parte y el reloj total es el de la parte más larga: 244 s en `ce748f8`. Cada parte gasta unos 50 s en preparación (unos 23 s compilando, las imágenes de Postgres y Chromium, y el arranque).

Playwright reparte las partes por archivo, porque la suite no usa `fullyParallel`. Hoy la parte 1 lleva `entrada`, `flujo-de-caja`, `invitacion` y `marco`; la 2, `nomina`, `operacion` y `pagos-proveedores`; y la 3, `personas` y `roles`. Si una parte se acerca al tope, se divide el spec más largo o se agrega una cuarta parte.

Lo que bajó el tiempo de 556 s con 22 pruebas a 424 s con 34: sin video, traza solo con el DOM, sin capturas de evidencia en CI, el tope de intentos en un solo formulario y las rutas negadas de `roles.spec.ts` pedidas sin pintar.

## Guardas de los preloads

El desvío de Blob y el correo falso solo pueden cargar en el servidor de una prueba local. Al cargarse, cada uno truena con error, y el proceso sale con código distinto de 0, si `VERCEL_ENV` está definido, si `NODE_ENV=production` sin `E2E_SERVER_ACTIONS=1`, o si `DATABASE_URL` no apunta a 127.0.0.1 ni a localhost (`tests/e2e/guarda-preload.mjs`). El de Blob además exige `E2E_BLOB_LOCAL=1` y que ningún token del entorno sea de un almacén real. `tests/e2e/guardas-preload.test.ts` corre en `npm test` (14 casos) y `git grep` confirma que nada de `src/` los importa.

Comprobación en el flujo real: la parte 3 con `VERCEL_ENV=preview` no arranca el servidor:

```
Error: El desvío de Blob de los recorridos se niega a cargar: VERCEL_ENV está definido.
Error: Next terminó antes de abrir el puerto E2E.
```

En Vercel CI las tres partes pasan, así que la tarea no le pasa `VERCEL_ENV` a `next start`.

## Corrida roja provocada

1. `3d1de73` (temporal) agrega `onClick={(evento) => evento.preventDefault()}` a «Autorizar para pagar» en `src/components/proveedores/acciones-pago.tsx`. El botón se ve igual, pero no envía.
2. Vercel CI en rojo, corrida [`Xa0EK2Ty2GkGymTfPrklJ0ar`](https://vercel.com/gil-7364s-projects/~/ci/Xa0EK2Ty2GkGymTfPrklJ0ar): `test:e2e=failed` y el resto de las tareas en verde. La salida dice exactamente qué se rompió:

   ```
   ✘  23 tests/e2e/pagos-proveedores.spec.ts:90:5 › alta, factura, excepción, descarga y autorización con otra persona (51.4s)
       TimeoutError: page.waitForResponse: Timeout 30000ms exceeded while waiting for event "response"
           at dobleClic (/vercel/jobs/repo/tests/e2e/apoyo.ts:195:28)
           at /vercel/jobs/repo/tests/e2e/pagos-proveedores.spec.ts:163:21
     1 failed
     33 passed (9.4m)
   ```

   La línea 163 es el doble clic en «Autorizar para pagar». En ese momento la suite corría en una sola tarea, `test:e2e`; hoy la misma falla pondría en rojo la parte que lleva `pagos-proveedores.spec.ts` (la 2). La salida trae también el árbol accesible de la página, las últimas líneas del servidor y la captura en base64.
3. `07c69c2` revierte el commit. Vercel CI en verde, corrida [`CF6hYXNvxFqXInYCQkCSZaKS`](https://vercel.com/gil-7364s-projects/~/ci/CF6hYXNvxFqXInYCQkCSZaKS): 34 de 34. `src/` queda idéntico a `30a19c2`.

## Cómo repetirlo

```sh
# Suite completa en local con un Postgres desechable
E2E_ADMIN_URL=postgres://<usuario>@127.0.0.1:<puerto>/postgres npm run test:e2e

# Corrida roja: rompe un botón de dinero en una rama, sube y mira el check
git commit -am "TEMPORAL: rompe Autorizar" && git push
vercel ci list --git-branch <rama>
vercel ci logs <id> --task '//#test:e2e:2'   # la parte de pagos-proveedores
git revert --no-edit HEAD && git push
```

Para ver la falla en local basta con correr solo ese spec: `npm run test:e2e -- tests/e2e/pagos-proveedores.spec.ts`.
