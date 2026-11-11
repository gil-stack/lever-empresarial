# Inicio y Aprobaciones

Dos lecturas de la consola del cliente:

| Pantalla | Ruta | Permiso | Fuente |
| --- | --- | --- | --- |
| Inicio financiero | `/consola` | `cliente.resumen.ver` (administrador, finanzas) | `resumen-repositorio.ts` sobre `postings` y `drawers` |
| Aprobaciones (antes Pendientes) | `/consola/aprobaciones` | `cliente.consola.ver` (cualquier rol de consola) | `repositorio.ts` (conteos de configuración) |

Quien tiene consola pero no `cliente.resumen.ver` (contador, liberador, solicitante) y abre `/consola` o `/c/<empresa>` aterriza en Aprobaciones con un `redirect`, no en un 404. Pendientes se unió con Aprobaciones en la Ola 2b: `/consola/pendientes` revisa la misma puerta y redirige. La lectura del resumen vuelve a exigir el permiso en `resumen-servicio.ts`.

## Regla de signo

Las cifras de Inicio salen del signo de cada asiento de `postings.centavos`:

- **Entrada**: asiento con `centavos > 0`.
- **Salida**: asiento con `centavos < 0` (se muestra en positivo).
- **Neto del mes**: entradas menos salidas del mes actual.
- **Saldo en el libro**: suma histórica de todos los asientos de la empresa.
- **Salidas por categoría**: salidas del mes actual agrupadas por cajón (`drawers`); sin cajón cae en «Sin cajón».

Por eso la pantalla dice «Entradas» y «Salidas» del libro, no «Ingresos» ni «Gastos»: no hay clasificación fiscal ni contable detrás del signo.

## Mes en hora de México

Todos los meses se cortan en `America/Mexico_City`, sin depender de la zona de la sesión de Postgres (Neon y el contenedor de CI corren en UTC). El límite se arma con `date_trunc('month', $hoy::date::timestamp) at time zone 'America/Mexico_City'` y cada ventana tiene límite inferior y superior. Un asiento del 31 de octubre a las 20:00 (hora de México) es de octubre aunque en UTC ya sea 1 de noviembre. `tests/inicio/resumen-postgres.test.ts` lo prueba con la sesión en UTC y en UTC+14.

## Deuda conocida: reversas

Una reversa de un cargo (por ejemplo, la devolución de un pago a proveedor) se asienta con signo positivo y hoy cuenta como **entrada**, aunque no sea dinero nuevo. Lo mismo, al revés, para la reversa de un abono. Mientras `postings` no distinga el tipo de asiento:

- «Entradas» y «Salidas» pueden sobrestimar el flujo real cuando hay reversas.
- El neto y el saldo sí cuadran, porque la reversa anula al cargo original.

Hoy nadie escribe en `postings` desde la aplicación, así que Inicio sale vacío en producción. Cuando el primer flujo empiece a asentar (pagos a proveedores, nómina), ese flujo debe marcar el tipo de asiento (cargo, abono, reversa) y este repositorio debe excluir o compensar las reversas antes de llamar a una cifra «gasto» o «ingreso».
