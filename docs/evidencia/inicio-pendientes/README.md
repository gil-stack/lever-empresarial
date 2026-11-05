# Evidencia funcional: Inicio y Pendientes

Validación del 5 de noviembre de 2026 con Next.js en puerto dedicado y Postgres desechable. Empresas, personas y movimientos son datos locales de prueba; no se usó Neon ni una base compartida.

| Captura | Flujo recorrido y comprobado |
| --- | --- |
| `01-inicio-vacio-claro.png` | Inicio sin asientos: ceros reales, explicación y accesos de configuración. |
| `02-pendientes-reales.png` | Pendientes derivados de la empresa, agrupación, prioridad y contadores laterales. |
| `03-alta-con-finanzas.png` | Alta de una persona con rol de trabajo y acceso adicional a Inicio financiero. |
| `04-inicio-con-movimientos-claro.png` | Saldo histórico, mes actual, gráfica mensual, categorías y movimientos recientes. |
| `05-inicio-12-meses-oscuro.png` | Selector funcional de 12 meses y tema oscuro. |
| `06-pendientes-vacio-oscuro.png` | Estado al corriente con accesos reales según permisos. |
| `07-finanzas-movil-oscuro.png` | Usuario Finanzas a 390 px, sin Política ni Proveedores, con gráfica navegable horizontalmente. |

El mismo recorrido creó una categoría y un centro de costo, comprobó la actualización de Pendientes, otorgó y revocó Finanzas desde la ficha de una persona existente, verificó el acceso posterior del contador y comprobó que los módulos restringidos no muestran datos ni formularios. La corrida terminó con `VALIDACION_VISUAL_OK` y sin errores de página ni hidratación.
