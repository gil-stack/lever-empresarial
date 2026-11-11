# Reparto de la e2e con cobranza (8 partes)

- `reparto-8-partes-con-cobranza.txt`: el reparto real (`--list --shard=N/8`) con el plan elegido, peor parte ~445 s con el fijo de 90 s, y las alternativas medidas.
- `optimizar.mjs.txt`: el optimizador del #60/#61 con recocido, más lugares para los archivos del fondo (entre ellos `abanico-del-fondo`, antes de accesibilidad) y el peso de la regla de GPU por `PESO` (0.4 = preferencia; 1000 = restricción dura). Se corre con el simulador del #60 (`docs/evidencia/ola-2b-navegacion/datos/e2e-reparto-simulador.mjs.txt`).
- `generar.py.txt`: escribe los archivos del fondo desde `plan-del-fondo-8.json`.
- `tiempos-max-ci-con-cobranza.json`: los máximos del #61 más los de cobranza (CI del #63); la e2e 19 nueva cuenta 30 s, la 12 (evidencia, solo con E2E_CAPTURAS; en el CI se omite) 0.5 s, y las partes de `csp.spec` que cambian de título con las rutas de cobros, 45 s cada una (estimados).
