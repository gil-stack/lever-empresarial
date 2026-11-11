# Reparto de la e2e con runway (8 partes)

- `reparto-8-partes-con-runway.txt`: el reparto real (`--list --shard=N/8`) con el plan elegido, peor parte ~448 s con el fijo de 90 s.
- `plan-del-fondo-8.json`: dónde va cada prueba del fondo; `generar.py.txt` escribe los archivos desde el plan.
- `tiempos-max-ci-con-runway.json`: los máximos de `docs/evidencia/cobranza/reparto/` más los de runway y flujo de caja (CI del #64). La e2e 10 de runway (evidencia, solo con E2E_CAPTURAS; en el CI se omite) cuenta 0.5 s.
- El optimizador es el de cobranza (`docs/evidencia/cobranza/reparto/optimizar.mjs.txt`) con un lugar más, `rueda-del-fondo`, entre roles y runway.
