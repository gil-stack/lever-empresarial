# Evidencia funcional: cuentas por pagar de proveedores (PR #44)

Recorrido clicado en navegador con el código final de esta rama. Cada captura es el estado de la pantalla justo después de la acción descrita. Las aserciones de cada paso (textos, estados, valores de campos, encabezados) se verificaron en el mismo recorrido; si una fallaba, el recorrido se detenía.

## Entorno

| Pieza | Valor |
|---|---|
| Base | Postgres 17 local (Homebrew) en `127.0.0.1:5511`, base `plataforma`, migraciones `0001`–`0022` aplicadas, la app entra como `plataforma_app` |
| Servidor | `next dev -p 4811` (Next 16.4.4) |
| Navegador | `@playwright/test` 1.64 del repo con Chromium headless shell 1243, 1440×1000 (móvil: 390×844) |
| Empresa | Altamar Logística, RFC `ALO180312AB1`, dada de alta con `empresa:alta` |
| Personas | Laura Méndez (administradora), Sofía Ruiz (solicitante), Rocío Paredes y Mateo Ibarra (liberadores). Todas entran con contraseña y TOTP real |
| Consola del navegador | Sin errores en todos los flujos; se vigiló `console.error` y `pageerror` |

Dos cosas del entorno no son de producción:

- **Vercel Blob emulado.** No hay `BLOB_READ_WRITE_TOKEN` local y el código no tiene modo local. `put` y `del` usan `VERCEL_BLOB_API_URL`, que la propia librería `@vercel/blob` soporta, apuntado a un emulador local (`127.0.0.1:4899`). Las lecturas del almacén privado se redirigen al mismo emulador con un `--import` de Node que solo intercepta `*.blob.vercel-storage.com`. El código de la aplicación no se tocó para esto.
- **Invitaciones emitidas por servicio.** En esta rama no existe invitar desde Personas. Las invitaciones se emitieron con el mismo servicio que usa el portal de operación (`emitirEnTransaccion`); aceptar la invitación, definir contraseña y registrar el TOTP sí se hizo clicando.

## Flujos

| Flujo | Quién | Qué se clicó y qué se verificó | Captura |
|---|---|---|---|
| (a) Alta de proveedor | Laura | Alta de Combustibles del Bajío con constancia y **sin contrato**. Quedó asentado | [a-01](a-01-alta-proveedor.png) |
| (l) Alta rechazada | Laura | Alta con un RFC ya registrado: el servidor responde "Ese RFC ya es un proveedor" y el nombre comercial, el correo y la constancia elegida **se conservan** | [l-21](l-21-alta-rechazada-conserva-datos.png) |
| (b) Solicitud con CFDI | Sofía | Elige proveedor, sube el XML: se leen UUID, emisión, total y referencia. Sube el PDF, fija fechas y solicita | [b-02](b-02-solicitud-cfdi-leido.png), [b-03](b-03-solicitud-cfdi-enviada.png) |
| (c) XML malicioso | Sofía | Sube un CFDI con `<h:script>` XHTML en la addenda: "El XML trae HTML, SVG, scripts u hojas de estilo…" y el botón queda deshabilitado. En la base no quedó cargo ni documento con ese UUID ni en el almacén | [c-04](c-04-xml-malicioso-rechazado.png) |
| (d) Abrir documento | Laura | Clic en el XML del detalle: el navegador **descarga** el archivo (evento `download`), la página no navega y el archivo bajado es idéntico byte a byte al original. Encabezados abajo | [d-05](d-05-detalle-documentos.png) |
| (e) Rechazo, corrección y segunda firma | Sofía, Rocío, Mateo | Sofía solicita una excepción por $12,500.00. Rocío la rechaza con "Falta el desglose por maniobra". Sofía corrige a $13,750.00 sin evidencia: "Si cambias el importe… adjunta evidencia nueva" y **el importe tecleado se conserva**. Adjunta el desglose y reenvía. Mateo ve el historial (rechazo, quién, cuándo y motivo) y la diferencia $12,500.00 → $13,750.00, y autoriza | [e-06](e-06-liberador-1-rechaza.png), [e-07](e-07-correccion-sin-evidencia-rechazada.png), [e-08](e-08-correccion-con-evidencia-enviada.png), [e-09](e-09-liberador-2-ve-motivo-y-diferencia.png), [e-10](e-10-liberador-2-autoriza.png) |
| (f) Versión vieja abierta | Rocío, Mateo, Sofía | Rocío abre la factura en la versión 1. En otra sesión Mateo la rechaza y Sofía corrige la fecha (versión 2). Rocío pulsa "Autorizar para pagar" con la versión 1 en pantalla: "La solicitud cambió mientras la revisabas…". Recarga, ve la diferencia de fecha y autoriza la versión vigente | [f-11](f-11-version-vieja-rechazada.png), [f-12](f-12-autoriza-version-vigente.png) |
| (g) Cancelar un pago listo | Mateo | "Cancelar pago listo para pagar" con motivo "El proveedor pidió reprogramar a diciembre". Queda Cancelado; el motivo aparece en el detalle y en el historial como "Autorización retirada" | [g-13](g-13-pago-listo-cancelado-con-motivo.png) |
| (k) Cancelar una rechazada propia | Sofía, Rocío | Rocío rechaza una excepción; Sofía la cancela con motivo y el historial conserva el rechazo | [k-20](k-20-solicitante-cancela-rechazada.png) |
| (h) Cambio de CLABE | Laura, Rocío | Con la factura lista para pagar, Laura cambia la CLABE del proveedor: "Un pago listo para pagar regresó a revisión. No salió ningún correo de alerta…". Rocío ve el pago en Por autorizar con el aviso de CLABE cambiada, "Autorización retirada" con su motivo en el historial y **solo** el botón Rechazar | [h-14](h-14-cambio-clabe-regresa-pago.png), [h-15](h-15-liberador-ve-regreso-y-bloqueo.png) |
| (r) Recuperación | Rocío, Sofía, Mateo | La solicitud bloqueada se rechaza, Sofía la vuelve a solicitar y toma la CLABE vigente (la diferencia muestra el cambio de terminación); Mateo autoriza. Este paso dejó el pago listo para repetir (h) | [r-22](r-22-solicitud-rehecha-con-clabe-vigente.png) |
| (i) Solicitante sin datos del expediente | Sofía | El detalle muestra "•••• NNNN" y "Tu rol ve solo la terminación de la CLABE"; la página no contiene los 18 dígitos. El expediente no lista la constancia y pedir su URL directa responde **404** | [i-16](i-16-solicitante-clabe-enmascarada.png), [i-17](i-17-solicitante-expediente-sin-constancia.png) |
| (j) Móvil 390 px | Mateo | Mesa con detalle abierto en claro y en oscuro (preferencia del sistema). `scrollWidth` = 390 en ambos: sin desbordamiento horizontal | [j-18](j-18-movil-claro.png), [j-19](j-19-movil-oscuro.png) |

El orden de las letras es el del encargo; (k), (l) y (r) son recorridos adicionales.

## Encabezados de la descarga (flujo d)

Respuesta cruda del documento XML, pedida con la sesión de Laura:

```
GET /c/<id>/consola/proveedores/documento/<id> -> 200
content-type: application/octet-stream
content-length: 655
content-disposition: attachment; filename*=UTF-8''factura-C450.xml
x-frame-options: DENY
content-security-policy: sandbox; default-src 'none'; frame-ancestors 'none'
x-content-type-options: nosniff
cache-control: private, no-store
archivo descargado: factura-C450.xml
```

## Fallas que encontró este recorrido

Ninguna aparecía en las pruebas unitarias ni en la suite de Postgres; salieron al clicar. Todas se corrigieron en este PR y se volvió a recorrer el flujo.

| Falla | Causa | Corrección | Prueba |
|---|---|---|---|
| El alta sin contrato fallaba con "Ese PDF está vacío" | El navegador manda el campo de archivo vacío con `filename=""`; Next lo reconstruye como un archivo de 0 bytes llamado `undefined` y se trataba como contrato presente | Un archivo de 0 bytes cuenta como ausente (`src/app/consola/proveedores/archivos.ts`) | `archivos.test.ts`; e2e "alta sin contrato…" |
| La descarga salía con `frame-ancestors 'none'` y sin `sandbox` | La regla general de `next.config.ts` reemplazaba la política de la ruta | Regla específica posterior para la ruta de documentos con la misma política | `descarga.test.ts`; e2e revisa el encabezado |
| Error de React en consola al subir el XML | La lectura del XML se despachaba fuera de una transición; el estado "Leyendo y validando…" nunca se mostraba | `startTransition` en `formulario-pago.tsx` | e2e sin errores de consola |
| Tras un error, el importe corregido regresaba en silencio al original | React vacía los campos de un `<form action>` al terminar la acción aunque devuelva error; el reenvío guardaba $12,500.00 "sin cambio" | Envío sin reinicio (`src/components/proveedores/sin-reinicio.ts`) en pago, alta, decisión y cancelación | e2e "una corrección que falla conserva el importe…" y "alta…" |
| El historial no decía por qué se retiró una autorización al cancelar | La consulta solo leía el motivo de los regresos a revisión | También lee el motivo de `cancelar_pago_proveedor` de la misma transacción | Postgres: "un pago listo se cancela con motivo…" |
| Las etiquetas CONSTANCIA y EVIDENCIA tapaban el nombre del documento | Columna fija de 38 px | Columna de 4.6rem y etiqueta a su ancho | Capturas h-14 y k-20 |

## Observación sin cambio

Al abrir el detalle de un pago, la tabla se filtra a ese pago ("Pagos 1"). Viene del diseño original del módulo (el detalle siempre encuentra su pago aunque esté en otra página). No se cambió porque es una decisión de producto, no una falla.
