# Payloads oficiales de Fintoc

Copiados sin cambios de la documentación oficial de Fintoc (versión de la API `v2026-02-01`), leída el 2026-11-10. Solo sirven como contrato en las pruebas. No contienen llaves: los ejemplos de la documentación traen llaves `sk_test_…` de muestra y aquí no se guarda ninguna.

| Archivo | Origen |
| --- | --- |
| `transfer-inbound-succeeded-mx.json` | Evento `transfer.inbound.succeeded` de México, bloque «Mexico» del paso 2 de https://docs.fintoc.com/guides/business-accounts/inbound-transfers.md |
| `account-number-create-response.json` | Respuesta de `POST /v2/account_numbers`, bloque «Response» del paso 1 de la misma página |
| `account-numbers-list-response.json` | Ejemplo `account_numbers_list` de la respuesta 200 de `GET /v2/account_numbers` (del YAML de OpenAPI, pasado a JSON sin cambiar valores), https://docs.fintoc.com/api/business-accounts-api/account-numbers/account-numbers-list.md |

La firma `Fintoc-Signature` (`t=<unix>,v1=<hex>`, HMAC-SHA256 de `"<t>.<cuerpo crudo>"` con el secreto del endpoint, tolerancia de 5 minutos) está en https://docs.fintoc.com/guides/resources/webhooks-walkthrough/webhooks-validating.md. Las pruebas firman los fixtures con un secreto generado al vuelo.

## Devoluciones (`transfer.inbound.returned`, r63-N8)

No hay un ejemplo de payload propio en la documentación; el contrato se confirmó el 2026-11-10 contra la doc oficial vigente:

- https://docs.fintoc.com/api/main-resources/events-reference/types-of-events: `transfer.inbound.returned` y `transfer.inbound.return_failed` (🇲🇽) traen como `data` el objeto [`transfer`](https://docs.fintoc.com/api/business-accounts-api/transfers/transfer-object), el mismo de `transfer.inbound.succeeded`.
- https://docs.fintoc.com/guides/business-accounts/inbound-transfers/returning-an-inbound-transfer: «For a successful return, expect the `transfer.inbound.returned` event and a transfer with `status` set to `returned`. For a failed return, expect the `transfer.inbound.return_failed` event and a transfer with `status` set to `succeeded`».
- El objeto `transfer` documenta `status` entre `pending`, `succeeded`, `rejected`, `failed`, `returned`, `return_pending`, … y `return_reason` (código SPEI) solo cuando `status` es `returned`.

Por eso las pruebas arman la devolución con el fixture de `succeeded`, `type: "transfer.inbound.returned"`, `status: "returned"` y `return_reason`. Cualquier otra forma (otro `status`, saliente, sin cuenta, otro `object`) no se lee: el aviso responde 500 `aviso_ilegible`, Fintoc reintenta y no se mueve dinero. Falta verlo con un evento real del sandbox de Fintoc cuando Gil abra la cuenta.
