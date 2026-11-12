# Estados de cuenta de ejemplo

Archivos hechos a mano con la forma en que tres bancos exportan sus movimientos. **Son ficticios**: ninguna cuenta, CLABE, clave de rastreo ni monto es de una persona o empresa real. Los usa `tests/e2e/cobranza.spec.ts` (subir, empatar columnas, ver propuestas, confirmar y volver a subir sin duplicar).

| Archivo | Qué ejercita | Abonos |
| --- | --- | --- |
| `bbva-movimientos.csv` | Windows-1252 (acentos en «Día» y «DEPÓSITO»), separador `;`, tres renglones de cuenta antes de los títulos, fecha `dd/mm/aaaa`, montos `7,250.00`. Los títulos («Día», «Concepto / Referencia») no se reconocen solos: la primera vez se empatan las columnas a mano y Lever lo recuerda para el banco. La referencia de Lever viene dentro del concepto. | `{{REF_B}}` por $7,250.00 (se aplica) · $3,333.33 sin referencia (por conciliar) |
| `banorte-movimientos.csv` | UTF-8 con BOM, comillas en todo, fecha `06-NOV-2026`, títulos que se reconocen solos («FECHA», «DEPÓSITOS»). Un concepto que empieza con `=` (fórmula): se guarda como texto con `'` delante y nunca se evalúa. | `{{REF_C}}` por $4,500.00 (se aplica) · $1,000.00 con la fórmula (se descarta en la prueba) |
| `santander-movimientos.xlsx` | Libro de Excel: títulos en el renglón 3, fechas como número de serie (46332 = 6 nov 2026) con formato `dd/mm/yyyy`, textos compartidos (`sharedStrings.xml`) y en línea (`inlineStr`), columna «Clave de rastreo». | $10,000.00 con la clave de rastreo `BNET01002611060000123456` de un pago que ya se registró a mano (ya estaba registrado) · $820.50 sin referencia (por conciliar) |

`{{REF_B}}` y `{{REF_C}}` se reemplazan en la prueba por la referencia de 7 dígitos del cargo de cada cliente: Lever la asigna al dar de alta y no se conoce antes.

El libro de Santander se armó con `fflate` (`zipSync`) a partir de las partes XML mínimas de un `.xlsx` (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml` y sus relaciones, `xl/styles.xml`, `xl/sharedStrings.xml` y `xl/worksheets/sheet1.xml`); se abre en Excel y en Numbers.
