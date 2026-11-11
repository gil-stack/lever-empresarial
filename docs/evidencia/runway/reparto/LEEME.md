# Reparto de la e2e con runway (8 partes)

- `reparto-8-partes-con-runway.txt`: el reparto real (`--list --shard=N/8`) con el plan elegido, peor parte ~448 s con el fijo de 90 s.
- `plan-del-fondo-8.json`: dónde va cada prueba del fondo; `generar.py.txt` escribe los archivos desde el plan.
- `tiempos-max-ci-con-runway.json`: los máximos de `docs/evidencia/cobranza/reparto/` más los de runway y flujo de caja (CI del #64). La e2e 10 de runway (evidencia, solo con E2E_CAPTURAS; en el CI se omite) cuenta 0.5 s.
- El optimizador es el de cobranza (`docs/evidencia/cobranza/reparto/optimizar.mjs.txt`) con un lugar más, `rueda-del-fondo`, entre roles y runway.

- **Corrección r64-rep-N1:** el JSON tenía como «máximo» de las pruebas con GPU emulada la mediana del CI (el lienzo a DPR 2, 114 s). Con los máximos reales de las últimas 50 corridas (`vercel ci grep "con GPU rápida (emulado) a DPR" --all-branches --runs 50`: lienzo a DPR 2 162 s, tarea ajena 144 s, estable 150 s, arrastrar 132 s), el **mismo reparto** predice **~491 s en la parte 6** y ~484 s en la 8 (antes ~448 s en la peor). Coincide con el CI real (513 s en la parte 6 de `220dc08`), queda en la franja de documentar (450–540 s) y el reparto no cambia (decisión del líder). La tabla completa está al final de `reparto-8-partes-con-runway.txt`.
