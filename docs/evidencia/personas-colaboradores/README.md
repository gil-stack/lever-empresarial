# Evidencia funcional — Personas como expediente laboral y nómina (PR #45)

Recorrido real con navegador (Playwright 1.64.1, Chromium headless) contra `next dev` en el puerto 4812 y Postgres 17 local en 5512, con las 22 migraciones aplicadas (última `0023_colaboradores_nomina`). Cada persona entra con su invitación real: contraseña, alta del segundo factor (TOTP) y códigos de respaldo. No se usaron bases remotas ni atajos de sesión; el correo quedó sin configurar a propósito para probar el aviso fallido.

## Flujos clicados

| Flujo | Qué se hizo en pantalla | Resultado observado | Capturas |
|---|---|---|---|
| Entrada | Laura (administradora) acepta la invitación, fija contraseña y segundo factor | Llega a la consola de Altamar Logística | `00` |
| (a) Áreas | Crea Operación y Tesorería con presupuesto | «El área quedó creada con su presupuesto.» | `01` |
| (a) Alta con nómina | Ana Ríos: neto $18,500 mensual, CLABE, rol Liberador | Expediente con nómina y CLABE | `02`, `03` |
| (a) Alta solo acceso | Carlos: «Solo acceso o ficha», rol Contador, sin nómina | Expediente sin nómina; 0 perfiles de nómina en la base | `04`, `05` |
| (a) Alta con tarjeta | Beto: nómina a tarjeta | Expediente con destino tarjeta | — |
| (b) Edición | Cambia el presupuesto de Ana de $3,000 a $3,500 | Bitácora `{"campos":"presupuesto","presupuesto_anterior":300000,"presupuesto_nuevo":350000}` | `06` |
| (c) CLABE con segundo factor viejo | Laura intenta cambiar la CLABE con un segundo factor de hace 45 min | «Confirma que eres tú…»; la CLABE sigue terminando en 3452 | `07` |
| (c) CLABE tras volver a entrar | Sale, entra con TOTP y repite el cambio | Historial con 2 renglones; bitácora `•••• 3452 → •••• 7899`; aviso registrado como `correo_no_configurado`; 0 eventos con la CLABE completa | `08`, `bitacora-clabe.json` |
| (d) Preparar nómina | Botón «Preparar nómina del 5 de noviembre de 2026» (fecha calculada en servidor) | Lote de $27,700.00, igual a la suma en SQL de los perfiles activos | `09`, `10` |
| (g) Contador | Carlos entra y abre el expediente de Ana y el lote | Ve `•••• 7899` (nunca los 18 dígitos), el neto «Reservado» y el total del lote sin renglones por persona | `15`, `16` |
| (e) Baja futura | Laura programa la baja de Ana al 12 de noviembre | Ana sigue dentro mientras la fecha no llega | `11` |
| (e) Baja que vence | Se adelanta la fecha en la base y Ana recarga | 404 en la ruta de la empresa; membresía suspendida, 0 sesiones, 1 evento `desprovisionar_persona` del sistema; al volver a entrar llega a «Todavía no hay empresa» | `12`, `12b`, `13` |
| (f) Última administradora | Laura intenta darse de baja a sí misma | «Es la única persona administradora…»; `baja_en` sigue nulo | `14` |
| (h) Móvil 390 px | Directorio en claro y oscuro | Márgenes de 20 px a cada lado, 0 px de desborde horizontal | `17`, `18` |
| (h) Lateral móvil | Abre el lateral y pulsa «Cerrar» | El botón recibe el clic (ver nota de `.velo`) | `19` |

La consola del navegador no registró advertencias ni errores durante el recorrido.

## Nota sobre `.velo`

El hallazgo pedía regresar `.velo` a `z-index: 25` salvo razón demostrada. Con 25 el velo tapa la barra móvil (`z-index: 20`), y el mismo botón que abrió el lateral —que pasa a decir «Cerrar»— deja de recibir el clic: Playwright lo reporta como «element intercepts pointer events». Por eso se queda en 15, con el comentario en `src/estilo/marco.css`. La captura `19` muestra el lateral abierto con el botón alcanzable.

## Gates corridos sobre el código final

| Gate | Resultado |
|---|---|
| `npm run typecheck` | 0 errores |
| `npm run lint` | 0 errores |
| `npm run test` | 204 de 204 |
| Suite Postgres (`--test-concurrency=1`, mismas 7 suites que `scripts/ci/pruebas-postgres.sh`) | 10 de 10 |
| `npm run build` | Compilación correcta, 36 páginas |
| `npm run security` | «Revisión de seguridad en verde» |
| `npm run test:e2e` (`E2E_PUERTO=4812`) | 1 de 1 |
