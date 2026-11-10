#!/usr/bin/env python3
"""Revierte UN arreglo de servidor de la ronda r64 (reemplazo exacto con su conteo). Uso: revertir-arreglo.py <raíz> <ID>
(lo llama rojo-por-arreglo.sh, que restaura con git checkout). Sale con 2 si el patrón no cuadra."""
import sys
W, ID = sys.argv[1], sys.argv[2]
R = {
  # r64-N1: el correo vuelve a pegar «tu dinero alcanza» con el texto del runway.
  "N1": [("src/server/correo/plantillas/alerta-caja.ts", "import { fraseRunwayDelAviso, type AlcanceRunway }", "import { fraseRunwayDelAviso, textoRunway, type AlcanceRunway }", 1),
         ("src/server/correo/plantillas/alerta-caja.ts", "    ...(datos.runway ? [fraseRunwayDelAviso(datos.runway, datos.minimo)] : []),",
          "    ...(datos.runway ? [`Runway: con lo comprometido, tu dinero alcanza ${textoRunway(datos.runway)}, menos que tu mínimo de ${datos.minimo}.`] : []),", 1)],
  # r64-N2: el resumen vuelve a contar hasta hoy + 12 meses, no los meses de la tabla.
  "N2": [("src/dominio/flujo/runway.ts", "    if (mes) {\n      const tipo: TipoResumen", "    if (efectiva <= horizonte.limite) {\n      const tipo: TipoResumen", 1)],
  # r64-N3: el mes con nómina de una sola persona no dice reservado.
  "N3": [("src/dominio/flujo/runway.ts", "      if (!opciones.detalleNomina && nominaDeUnaPersona(movimiento)) mes.nominaReservada = true;\n", "", 1)],
}
for ruta, viejo, nuevo, veces in R[ID]:
    p = f"{W}/{ruta}"; t = open(p, encoding="utf-8").read()
    if t.count(viejo) != veces:
        print(f"{ID}: {ruta}: el patrón aparece {t.count(viejo)} veces (esperado {veces})", file=sys.stderr); sys.exit(2)
    open(p, "w", encoding="utf-8").write(t.replace(viejo, nuevo))
