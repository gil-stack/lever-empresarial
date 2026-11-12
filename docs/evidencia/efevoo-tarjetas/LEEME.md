# Evidencia de E2: Tarjetas de la empresa con Efevoo Pay

## Contra el Efevoo falso (la e2e del CI)

`tests/e2e/tarjetas.spec.ts`, 13 pruebas sobre la empresa «Tarjetas E2E» (`tests/e2e/siembra-tarjetas.ts`). Las capturas de `falso/` se tomaron a 1440 y a 390 px con `E2E_CAPTURAS`:

| Flujo | Qué se comprueba |
|---|---|
| T1 | Administración ve el saldo para tarjetas, cada tarjeta con su terminación, su titular y su saldo, y las acciones. El detalle trae los movimientos del emisor con el signo de su tipo. Un número de tarjeta en el concepto se pinta como «••1111». Una tarjeta que no existe da 404. Ni el HTML ni la carga RSC traen secuencias de 13 a 19 dígitos |
| Permisos | Finanzas ve todo sin botones. El contador no abre Tarjetas |
| T2 y T3 | Liberación carga $100.00 con doble clic y queda una sola operación. Luego retira $25.50 al centavo. Un retiro mayor al saldo lo rechaza Lever antes de llamar al emisor |
| T4 | Bloquear y desbloquear, en la lista y en el emisor |
| T5 | El titular ve solo su tarjeta en el teléfono. La consola y las tarjetas por dirección le dan 404. La barra del teléfono queda en una fila a 390 y a 320 px |
| T6 | Con un timeout con efecto, «Conciliar» la encuentra por su referencia y el saldo sube una sola vez. Sin efecto, espera 10 minutos, después «no apareció» y «Reintentar» la hace con una referencia nueva ligada |
| Empresa suspendida | No queda ninguna operación |

Las pruebas rojas, medidas antes de cada arreglo o con un sabotaje de un solo cambio, están en los archivos `rojo-*.txt`.

## Contra el sandbox real (cliente 19, tarjeta 560, terminación 6509)

Gil autorizó la excepción porque el sandbox no deja asignarle una tarjeta propia a la empresa de prueba. Cada operación se revirtió en el acto: la tarjeta empezó y terminó con $500.00 y en estado `active` (`antes-saldo560.json`, `despues-saldo560.json`). No se canceló ni se reasignó nada. El correo del titular de la 560 lo pidió la aplicación y solo vivió en memoria.

| Paso | Resultado (`sandbox-operaciones.json`) | Captura |
|---|---|---|
| 1. Ver las tarjetas | $500.00 del emisor | `sandbox-01-*` |
| 2. Cargar $100.00 | confirmada, referencia 1000001 | `sandbox-02-*` |
| 3. Retirar $100.00 | confirmada, 1000002 | `sandbox-03-*` |
| Cargar $25.50 | confirmada, 1000003 | `sandbox-04-*` |
| Retirar $25.50 | confirmada, 1000004 | `sandbox-05-*` |
| 4. Bloquear | confirmada, 1000005, «Bloqueada» | `sandbox-06-*` |
| Desbloquear | confirmada, 1000006, «Activa» | `sandbox-07-*` |
| 5. Movimientos en el emisor | «PAGO A TARJETA» con «+» y «DEVOLUCIÓN PAGO A TARJETA» con «−», en centavos | `sandbox-08-*` |
| 6. El titular | Solo su tarjeta, con $500.00 | `sandbox-09-*` |

**Cómo se corrió:** la spec `scripts/evidencia/efevoo-tarjetas/sandbox.spec.ts.txt` se copió a `tests/e2e/zz-efevoo-sandbox.spec.ts`. Las credenciales se cargaron de `~/.config/lever/efevoo-sandbox.env`, con `EFEVOO_URL=https://test-intgapi.efevoopay.com` y `EFEVOO_AMBIENTE=sandbox`. `tests/e2e/entorno.ts` lleva, solo en local y sin versionarse, esta línea al inicio de `levantarEfevooFalso`:

```ts
if (process.env.E2E_EFEVOO_SANDBOX === "1") return;
```

Esa línea hace que el servidor de la prueba use las credenciales del entorno en lugar de las del falso. En el repositorio, `entorno.ts` sigue garantizando que las llaves reales nunca llegan al servidor de la prueba. Después de la corrida se revirtió el parche y se borró la copia de la spec. Ni la salida (`corrida.txt`) ni los JSON traen la llave ni datos personales: los JSON los redacta `llamar.mjs`.
