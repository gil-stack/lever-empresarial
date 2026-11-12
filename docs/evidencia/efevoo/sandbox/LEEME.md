# Validación con clics contra el sandbox real de Efevoo (E1, 2026-11-12)

Corrida con `tests/efevoo/sandbox/operacion.sandbox.ts`, que usa una configuración propia fuera de `tests/e2e` (no cuenta en el reparto):

- la misma siembra y el mismo `next start` de la e2e;
- con `E2E_EFEVOO_REAL=1`, Lever habla con `https://test-intgapi.efevoopay.com` usando las credenciales del sandbox, que nunca se imprimen ni se versionan;
- op1 (Administración de la plataforma) entra con su app autenticadora y opera la ficha de Ceiba E2E con clics, en Chromium headless.

Resultado completo en `resultado.json` y una captura por paso.

| Flujo | Con clics contra el sandbox | Qué dijo Efevoo | Qué hizo Lever |
|---|---|---|---|
| **O1: alta de la empresa** | ✅ | `createClient` → cliente **208**, `estatus` 1, saldo 0, correo de prueba `@lever.test`. Una corrida anterior dejó el 207 | Vínculo guardado; la sección muestra «Cliente en Efevoo 208» (`o1-alta-confirmada.png`) |
| **O2: depósito de prueba** | ⚠️ bloqueado del lado de Efevoo | `clientBalance` → `code` 1 «Ha ocurrido un error», como en la investigación | Quedó **incierta** (el código 1 no prueba que el dinero no se movió, E1-3) y la conciliación respondió «espera»: no se da por perdida antes de 10 minutos (`o2-deposito.png`, `o2-conciliacion.png`) |
| **O3: asignar y activar** | ⚠️ bloqueado del lado de Efevoo | El inventario real se lee bien: 1363, 0168, 3474, 7992 y 8182. `assignCard` → `"101"` «Hash incorrecto» | Quedó **fallida** con su código 101 (rechazo definitivo); la tarjeta no se crea en Lever (`o3-asignacion.png`) |
| **O4: cancelar** | ⛔ no se puede probar | Sin `assignCard` no hay tarjeta propia, y la de otro cliente no se cancela (es irreversible) | Probado con clics contra el falso (`../e2e/o4-*.png`, `../e2e/timeout-*.png`) |

Los bloqueos de O2 y O3 son los que el líder ya llevó a Gil y a Efevoo (investigacion.md): `clientBalance` falla siempre, y `assignCard` pide un `card` cifrado cuya llave no tenemos. Cuando Efevoo los resuelva, el mismo spec valida O2 a O4 sin cambios.
