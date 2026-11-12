# Reparto de la e2e con Tarjetas (8 partes)

- `reparto-8-partes-con-tarjetas.txt`: el reparto real (`--list --shard=N/8`) con el plan elegido y los máximos del CI: peor parte ~539 s con el fijo de 90 s y **0 pruebas normales después de una de GPU**.
- `plan-del-fondo-8.json`: dónde va cada prueba del fondo. `generar.py.txt` escribe los archivos desde el plan. Es la copia del de runway, y la prueba de 40 ms ahora importa `comprobarSinWebGl`.
- `optimizar.mjs.txt`: el optimizador de cobranza con los lugares de hoy: `rueda` después de roles, `velocidad` después de tarjetas y `sombra` entre runway y tarjetas (no se usó). Corre con `PESO=1000`, la regla dura, sobre el simulador del #60 (`docs/evidencia/ola-2b-navegacion/datos/e2e-reparto-simulador.mjs.txt`).
- `tiempos-max-ci-con-tarjetas.json`: los de runway, más los de `tarjetas.spec.ts` estimados desde la corrida local: 8 s cada prueba corta y 35 s las dos de T6, que esperan el timeout de 15 s del cliente. Se corrigen con los del primer CI.
- Antes, con `tarjetas.spec.ts` serial al final, el modelo daba ~615 s en la parte 8 y 80 pruebas normales después de una de GPU. Con la regla dura y el archivo serial, la peor quedaba en ~632 s. Con 9 partes, ~569 s.
