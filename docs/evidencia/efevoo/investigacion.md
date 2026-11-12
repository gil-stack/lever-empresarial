# Efevoo Pay: investigación del sandbox (E1, 2026-11-12)

Llamadas reales a `POST https://test-intgapi.efevoopay.com/v1/apiservice` con los encabezados `X-API-USER` y `X-API-KEY` del archivo de credenciales del sandbox, desde el laboratorio de -06. Cada llamada quedó guardada en `crudo/<nombre>.json` como `{pedido, http, ms, cuerpo}`.

**Cómo se redactó:**
- Sin la llave ni el usuario de la API.
- Nombres, apellidos, correos, teléfonos, domicilios, razón social, RFC, CURP y la cuenta interna se reemplazaron por `<campo:largo>`.
- Toda secuencia de 12 a 19 dígitos o asteriscos se dejó como `****` más la terminación.

`tests/efevoo/contrato/` tiene la selección de esas respuestas que imita el Efevoo falso. **Nunca se llamó a `getCardData`.**

Se creó un solo cliente de prueba: **206** («Lever Investigacion E1», correo `@lever.test`). La tarjeta 560 (cliente 19, que no es de Lever) se usó solo al principio, con efecto neto cero. Desde la indicación del líder, solo se opera sobre lo propio.

## Resumen

| Tema | Resultado | Evidencia |
|---|---|---|
| `product` / `subproduct` | **16 / 19** (`EPCVC`) en todo el inventario. 19/20 (`EPBCC`) solo en dos tarjetas activas | `getCardsList-vacio` |
| Inventario asignable | `getCardsList` con `status: ["inStock"]` → 5 tarjetas: 557, 563, 564, 567 y 568. Con `status: []` salen todas (15); con los cuatro estados de la doc, solo 8 | `getCardsList-inStock`, `-vacio`, `-todas` |
| Estados reales | `inStock`, `active`, `blocked`, `cancelled` (con dos L; la doc dice `canceled`). Un estado desconocido no da error: devuelve 0 tarjetas | `getCardsList-*` |
| Saldo en inventario | La 567 está en `inStock` con saldo 60 352.34. El inventario puede traer saldo | `getCardsList-inStock` |
| Terminación | `bin` llega enmascarado (`primeros 8 + **** + últimos 4`). Lever solo conoce los últimos 4 | `getCardsList-vacio` |
| `createClient` | `response.id` = `idepCliente` (206). `status.code` llega como **número** 0 | `createClient` |
| `createClient` repetido | `status.code` 1 y `response` como **texto**: «Cliente previamente registrado». El correo es único en Efevoo | `createClient-duplicado` |
| Buscar un cliente | `getClientList` **ignora** el filtro `email`. Sí respeta `idepClientes: [id]` | `getClientList-email`, `-ids` |
| `clientBalance` (depósito de prueba) | **Bloqueado**: siempre `code` 1 «Ha ocurrido un error», con cualquier cliente (206, 21 o inexistente), cualquier monto y aun con `operation` inválida | `clientBalance-*` |
| `getCompanyBalance` | `code` "901" «PARABILIUM API CONSULTAR TARJETA ERROR» | `getCompanyBalance` |
| `balanceMovements` | Funciona. Sin `reference`. `registerDate` llega como `"4/1/2026 5:22:52 PM"`, no como en la doc. **No** incluye las cargas a tarjetas | `balanceMovements-19` |
| `assignCard` | **Bloqueado**: siempre `"101"` «ERROR: Hash incorrecto», con cualquier `card` (4, 8 o 16 dígitos, vacío, nulo o sin el campo), con y sin `subclient` y con `Idempotency-Key`. Con payload vacío: `"100"` «Error desconocido». La doc de `activateCard` dice que `card` va «encrypted with AES»; no hay llave ni algoritmo | `assignCard-*` |
| `activateCard` | **Bloqueado**: HTTP **401** `{"code":401,"message":"Unauthorized"}`, igual que un método inexistente. Este usuario no tiene ese método | `activateCard-*`, `metodo-inexistente` |
| `assignCards` | **No sirve con inventario**: `code` 1 «Ha ocurrido un error» con 557 y 563 hacia 206. Con `idepClientes` en lugar de `idepCliente`: `{"IdepCliente":"Campo obligatorio"}`. Hipótesis: solo mueve tarjetas que ya tienen titular | `assignCards-*` |
| `fundCard` / `unfundCard` | Funcionan: `response.id` y `finalCardBalance` | `fundCard-560`, `unfundCard-560` |
| `reference` | **Exactamente 7 dígitos numéricos**. Si no, la respuesta no tiene `status`: `{"Reference":"Debe contener exactamente 7 dígitos numéricos."}` | `fundCard-inexistente` |
| Referencia repetida | **No se rechaza**: dos `fundCard` con 9100002 pasaron. La idempotencia es solo de Lever | `fundCard-560-refrepetida` |
| Falso éxito | `fundCard` con un correo que no es el de la tarjeta → `code` 0, «Operación realizada correctamente», **`id` 0** y `finalCardBalance` 0, sin mover nada. **`id` 0 es un rechazo** | `fundCard-correo-malo` |
| Saldos | El sandbox **no valida saldos**: `unfundCard` de 999 999 dejó la tarjeta en −999 499 (se regresó enseguida a 500). El saldo del cliente 19 no cambió con las cargas. **Lever valida los saldos antes de operar** | `unfundCard-560-excede`, `fundCard-560-excede` |
| Encontrar por referencia | `getTransactionsCard` (`email`, `card`) devuelve `Referencia`, `ImporteMovimiento` (a veces número, a veces `"500.0000"`), `FechaHora` (hora de México), `IDMovimiento` y `ConceptoMovimiento` («PAGO A TARJETA») | `getTransactionsCard-560-b` |
| `cardBlocker` | `block`/`unblock` funcionan y `getCardsList` refleja `blocked`/`active`. Un correo equivocado → `"115"` «Cuenta no encontrada» | `cardBlocker-*` |
| `cancelCard` | Sin probar (es irreversible y no hay tarjeta propia). Con un id inexistente → `"115"` | `cancelCard-inexistente` |
| Método inexistente | HTTP 401, no el 400 de la doc | `metodo-inexistente` |

## Consecuencias para Lever

1. `status.code` se normaliza (número o texto). Éxito = HTTP 200 **y** `code` 0 **y**, en los métodos que devuelven `id`, un `id` positivo.
2. Una respuesta sin `status` (validación de campos) es un rechazo con el código `validacion`.
3. La referencia de Lever es numérica de 7 dígitos, única en Lever.
4. Conciliación:
   - carga o retiro → `getTransactionsCard` por `Referencia`, importe y concepto;
   - alta → `getClientList` + `getClient`, comparando el correo;
   - depósito de prueba → `balanceMovements` por monto, momento y saldo previo, porque no lleva referencia.
5. Antes de cargar se revisa el saldo de la empresa; antes de retirar, el de la tarjeta.

## Bloqueos del lado de Efevoo (el líder los llevó a Gil)

- **a)** `clientBalance` falla siempre.
- **b)** `assignCard`: «Hash incorrecto». Falta la llave AES o el formato de `card`. `assignCards` tampoco asigna inventario.
- **c)** `activateCard`: 401 para este usuario.
- **d)** ¿Se puede cancelar una tarjeta de inventario de prueba?

Por eso O2, O3 y O4 se construyen y se prueban contra el Efevoo falso, y su validación contra el sandbox queda pendiente de Efevoo.

## Agregado de la revisión del PC1 (-03, 2026-11-12)

- **Los retiros sí aparecen en `getTransactionsCard`** (lectura autorizada de la 560, `tests/efevoo/contrato/getTransactionsCard-560-tras-retiros.json`).
  - El importe llega sin signo y el signo lo da `TipoMovimientoCargoAbono`:
    - `Abono`: carga, «PAGO A TARJETA», `M09282600MXN484`;
    - `Cargo`: retiro, «DEVOLUCIÓN PAGO A TARJETA», `M09DT2600MXN484`.
  - El importe llega como texto `"x.0000"`; en capturas anteriores llegó como número.
  - Trae `SaldoDespuesMovimiento`.
- **El id de la respuesta y el `IDMovimiento` son series distintas:** fundCard responde 3060 a 3062, unfundCard 2664 y 2665, y los movimientos son 4526 a 4530. La conciliación guarda el `IDMovimiento` que encuentra.
- **Cómo se concilia ahora** una carga o un retiro incierto: misma referencia, importe exacto, tipo `Abono`/`Cargo` y `FechaHora` (hora de México) no anterior a la operación, con 2 minutos de margen. Con más de una coincidencia queda incierta para revisarla a mano. Efevoo repite referencias: en la 560 conviven dos `9100002` y una `1234567` de otro origen.
- **Solo son rechazo definitivo** `validacion`, `id_cero`, 115, 122, 101, 163, 112 y 401. Cualquier otro código (901, 1, 100…) deja la operación incierta: no prueba que el dinero no se movió.
- **Cloudflare:** el sandbox responde 403 «error code: 1010» a `urllib` de Python por su firma; con `fetch` de node funciona. Las sondas van con node.

## Desfase del reloj de Efevoo (pregunta de -03, 2026-11-12)

Una carga y un retiro de $0.01 sobre la tarjeta 560 del cliente 19, con efecto neto cero (excepción de Gil: saldo 500 y estado activo antes y después). Crudo en `desfase-del-reloj.json`.

- `FechaHora` (hora de México) va **1 s** después de la hora en que salió la llamada. La llamada misma tarda unos 2 s, así que no hay desfase medible. La ventana de −2 min de la conciliación tiene margen de sobra.
- Confirma E1-10 en vivo: recién hechos, los dos movimientos llegan **sin `TipoMovimientoCargoAbono`** y con el importe como **número**. El concepto sí viene («PAGO A TARJETA» y «DEVOLUCIÓN PAGO A TARJETA»), y de ahí sale el tipo.
- Confirma las series: fundCard respondió con el id 3065 y su movimiento es 4535; unfundCard respondió con 2668 y su movimiento es 4536.
