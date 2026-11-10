#!/usr/bin/env python3
"""Revierte UN arreglo de la ronda r63 en el worktree (reemplazo exacto con su conteo). Uso: revertir-arreglo.py <raíz del repositorio> <ID> (lo llama rojo-por-arreglo.sh).
Sale con 2 si el patrón no cuadra (reversión no aplicada). La restauración la hace rojo-por-arreglo.sh con git checkout."""
import sys, re
W, ID = sys.argv[1], sys.argv[2]

def exacto(ruta, viejo, nuevo, veces=1):
    return ("exacto", ruta, viejo, nuevo, veces)

def corte(ruta, desde, hasta, nuevo):
    """Reemplaza desde la primera aparición de `desde` hasta justo antes de `hasta` (o el final si es None)."""
    return ("corte", ruta, desde, hasta, nuevo)

SQL = "db/migrations/0031_cobranza.sql"
R = {
  # r63-N1: la huella del renglón vuelve a depender de qué columna se eligió para qué (el empate).
  "N1-huella": [exacto("src/dominio/cobranza/estado-cuenta.ts", 'const base = [fecha, monto, ...resto].join("\\u001f");',
                       'const base = [fecha, monto, JSON.stringify(columnas), ...resto].join("\\u001f");')],
  # r63-N1: el mismo archivo ya no se frena por su huella (ni de entrada ni con el candado).
  "N1-archivo": [exacto("src/server/cobranza/estado-cuenta.ts", "  if (dia) throw archivoYaImportado(dia);\n", ""),
                 exacto("src/server/cobranza/estado-cuenta.ts", '    if (diaPrevio) return { tipo: "ya_importado" as const, dia: diaPrevio };\n', "")],
  # r63-N2: lo corto se vuelve a rellenar con ceros.
  "N2": [exacto("src/dominio/cobranza/referencia.ts", "  return /^[1-9][0-9]{6}$/.test(limpia) ? limpia : null;\n}",
                '  return /^[0-9]{1,7}$/.test(limpia) ? limpia.padStart(7, "0") : null;\n}')],
  # r63-N3: el correo de contacto cambia sin segundo factor.
  "N3-factor": [exacto("src/server/cobranza/servicio.ts", "if (clabeCambio || beneficiarioCambio || contactoCambio) exigirAutenticacionRecienteCliente",
                       "if (clabeCambio || beneficiarioCambio) exigirAutenticacionRecienteCliente")],
  # r63-N3: el cambio de contacto o de beneficiario no avisa.
  "N3-aviso": [exacto("src/server/cobranza/servicio.ts", "const datos = previa && (beneficiarioCambio || contactoCambio)", "const datos = previa && false")],
  # r63-N4: sin la marca «pagado desde la cuenta de otro cliente».
  "N4": [exacto("src/dominio/cobranza/conciliacion.ts", "deOtroCliente: datos.clientesDeLaClabe.length > 0 && !datos.clientesDeLaClabe.includes(cargo.clienteId),",
                "deOtroCliente: false,")],
  # r63-N5: el comprobante sin su regla de descarga.
  "N5": [exacto("next.config.ts", '        "/consola/cobros/comprobante/:id",\n        "/c/:empresa/consola/cobros/comprobante/:id",\n', "")],
  # r63-N6: sin contar renglones, celdas ni textos antes del parser, y sin tope por parte.
  "N6": [exacto("src/server/cobranza/lector-estado-cuenta.ts", 'if (contarEtiquetas(textoHoja, "row") > TOPE_RENGLONES)', "if (false)"),
         exacto("src/server/cobranza/lector-estado-cuenta.ts", 'if (contarEtiquetas(textoHoja, "c") > TOPE_CELDAS)', "if (false)"),
         exacto("src/server/cobranza/lector-estado-cuenta.ts", 'if (textoCadenas !== null && contarEtiquetas(textoCadenas, "si") > TOPE_CADENAS)', "if (false)"),
         exacto("src/server/cobranza/lector-estado-cuenta.ts", "if (inflado > tope || infladoParte > topeParte)", "if (inflado > tope)")],
  # r63-N7: el aviso sin destino vuelve a «ignorado» y no queda en ningún lado.
  "N7": [exacto("src/server/cobranza/fintoc.ts", "async function guardarSinDestino(aviso: AvisoFintoc, t: AbonoFintoc | DevolucionFintoc): Promise<RespuestaAviso> {\n",
                'async function guardarSinDestino(aviso: AvisoFintoc, t: AbonoFintoc | DevolucionFintoc): Promise<RespuestaAviso> {\n  if (aviso) return { estado: 200, cuerpo: { ok: true, efecto: "ignorado" } };\n')],
  # r63-N8: transfer.inbound.returned se ignora.
  "N8": [exacto("src/server/cobranza/fintoc.ts", "  if (tipo === TIPO_DEVOLUCION) {\n", "  if (tipo === TIPO_DEVOLUCION && false) {\n")],
  # r63-N9: el salto de línea del concepto deja de volverse espacio. Desde el #59 lo hace sinControles para todo
  # texto libre (src/dominio/control.ts); se revierte ahí.
  "N9": [exacto("src/dominio/control.ts", '(control) => COMILLAS[control] ?? " ")', '(control) => COMILLAS[control] ?? "")')],
  # r63-N10: el cargo de otra empresa vuelve a decir «ya cambió».
  "N10": [exacto("src/server/cobranza/servicio.ts", '«no encontrado», no «ya cambió» (r63-N10).\n        if (!f) throw new ErrorDeDominio("cargo_ausente");',
                 '«no encontrado», no «ya cambió» (r63-N10).\n        if (!f) throw new ErrorDeDominio("cargo_ya_resuelto");')],
  # r63-base-N3: la empresa del aviso vuelve a salir solo de la cuenta (la CLABE del cliente no manda).
  "baseN3": [corte(SQL, "AS $$\n  SELECT v.company_id, c.operator_id, v.customer_id\n", "\n$$;\n\nREVOKE ALL ON FUNCTION cobranza_destino_fintoc",
                   "AS $$\n  SELECT a.company_id, c.operator_id,\n         (SELECT v.customer_id FROM collection_virtual_accounts v\n"
                   "           WHERE v.company_id = a.company_id AND v.proveedor = 'fintoc' AND v.cuenta_numero_id = p_cuenta_numero)\n"
                   "    FROM collection_provider_accounts a\n    JOIN companies c ON c.id = a.company_id\n"
                   "   WHERE a.proveedor = 'fintoc' AND a.cuenta_id = p_cuenta")],
  # r63-base-N5: sin el DO del final de la 0031 (si la 0028 entra antes, cobranza queda sin el bloqueo).
  "baseN5": [corte(SQL, "DO $$\nDECLARE\n  tabla text;\nBEGIN\n  IF to_regprocedure('bloqueo_empresa_suspendida()') IS NOT NULL THEN", None, "")],
}

for paso in R[ID]:
    tipo, ruta = paso[0], f"{W}/{paso[1]}"
    t = open(ruta, encoding="utf-8").read()
    if tipo == "exacto":
        _, _, viejo, nuevo, veces = paso
        n = t.count(viejo)
        if n != veces:
            print(f"{ID}: {paso[1]}: el patrón aparece {n} veces (esperado {veces}): {viejo[:80]!r}", file=sys.stderr); sys.exit(2)
        t = t.replace(viejo, nuevo)
    else:
        _, _, desde, hasta, nuevo = paso
        i = t.find(desde)
        j = len(t) if hasta is None else t.find(hasta, i)
        if i < 0 or j < 0 or t.count(desde) != 1:
            print(f"{ID}: {paso[1]}: no encontré el tramo {desde[:60]!r}", file=sys.stderr); sys.exit(2)
        t = t[:i] + nuevo + t[j:]
    open(ruta, "w", encoding="utf-8").write(t)
