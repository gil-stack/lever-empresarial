#!/usr/bin/env python3
"""K9 · Mutaciones de las reglas clave de la 0031 (adaptado a la 0031 de la ronda r63: MU11 con ^[1-9][0-9]{6}$ y MU16 sin el autor en la misma línea). Uso: mutar-0031.py <archivo 0031> <MU…>.
Cada mutación es un reemplazo exacto con su número de apariciones esperado; si no cuadra, sale con 2 (mutación no aplicada)."""
import sys

MUTACIONES = {
    # Transición prohibida: un cargo cancelado vuelve a emitido.
    "MU1": [("  IF OLD.estado IN ('cancelado', 'omitido') THEN\n    RAISE EXCEPTION 'cargo_ya_resuelto';\n  END IF;\n", "", 1),
            ("    OR (OLD.estado = 'pagado' AND NEW.estado IN ('emitido', 'pagado'))\n",
             "    OR (OLD.estado = 'pagado' AND NEW.estado IN ('emitido', 'pagado'))\n    OR (OLD.estado = 'cancelado' AND NEW.estado = 'emitido')\n", 1)],
    # La referencia del cargo deja de ser inmutable.
    "MU2": [("NEW.concepto, NEW.vencimiento, NEW.referencia,\n      NEW.creado_por", "NEW.concepto, NEW.vencimiento, OLD.referencia,\n      NEW.creado_por", 1)],
    # El monto de un cargo emitido se puede cambiar.
    "MU3": [("  IF OLD.estado <> 'por_emitir' AND (NEW.monto_centavos, NEW.emitido_en, NEW.emitido_por)", "  IF false AND (NEW.monto_centavos, NEW.emitido_en, NEW.emitido_por)", 1)],
    # Sin llave idempotente del cron.
    "MU4": [("  CONSTRAINT collection_charges_periodo_unico UNIQUE (plan_id, periodo),\n", "", 1)],
    # Sin referencia única por empresa.
    "MU5": [("  CONSTRAINT collection_charges_referencia_unica UNIQUE (company_id, referencia),\n", "", 1)],
    # pagado_centavos deja de cuadrar contra Σ aplicaciones.
    "MU6": [("      RAISE EXCEPTION 'cobranza_pagado_no_cuadra';", "      NULL;", 1)],
    # aplicado_centavos del pago deja de cuadrar.
    "MU7": [("      RAISE EXCEPTION 'cobranza_aplicado_no_cuadra';", "      NULL;", 1)],
    # Sin bitácora obligatoria.
    "MU8": [("    RAISE EXCEPTION 'auditoria_de_cobranza_ausente';", "    NULL;", 1)],
    # RLS de cargos abierta a todas las empresas (lectura).
    "MU9": [("CREATE POLICY collection_charges_cliente ON collection_charges FOR ALL TO plataforma_cliente\n  USING (company_id = app_empresa())",
             "CREATE POLICY collection_charges_cliente ON collection_charges FOR ALL TO plataforma_cliente\n  USING (true)", 1)],
    # FK simple en lugar de compuesta: una aplicación de una empresa al cargo de otra.
    "MU10": [("    FOREIGN KEY (charge_id, company_id) REFERENCES collection_charges (id, company_id) ON DELETE RESTRICT,\n  CONSTRAINT collection_applications_reversion",
              "    FOREIGN KEY (charge_id) REFERENCES collection_charges (id) ON DELETE RESTRICT,\n  CONSTRAINT collection_applications_reversion", 1)],
    # Sin dígito de Luhn.
    "MU11": [("  SELECT p ~ '^[1-9][0-9]{6}$' AND (\n    SELECT sum(", "  SELECT p ~ '^[1-9][0-9]{6}$' OR (\n    SELECT sum(", 1)],
    # Sin llave del evento de Fintoc.
    "MU12": [("  CONSTRAINT collection_provider_events_unico UNIQUE (proveedor, evento_id),", "  CONSTRAINT collection_provider_events_unico CHECK (true),", 1)],
    # Sin llave del correo.
    "MU13": [("  CONSTRAINT collection_emails_unico UNIQUE (charge_id, tipo, secuencia),\n", "", 1)],
    # Sin huella única del renglón.
    "MU14": [("  CONSTRAINT collection_statement_rows_huella_unica UNIQUE (company_id, huella),", "  CONSTRAINT collection_statement_rows_huella_unica CHECK (true),", 1)],
    # Sin llave (empresa, fuente, id_externo) del pago.
    "MU15": [("  CONSTRAINT collection_payments_externo_unico UNIQUE (company_id, fuente, id_externo),\n", "", 1)],
    # Reversión por otro monto que la original.
    "MU16": [(" OR original.charge_id <> NEW.charge_id\n      OR original.monto_centavos <> -NEW.monto_centavos\n",
              " OR original.charge_id <> NEW.charge_id\n", 1)],
    # Saldo a favor negativo: el pago se aplica de más.
    "MU17": [("  CONSTRAINT collection_payments_aplicado CHECK (aplicado_centavos BETWEEN 0 AND monto_centavos),",
              "  CONSTRAINT collection_payments_aplicado CHECK (aplicado_centavos >= 0),", 1),
             ("    (estado = 'abierto' AND aplicado_centavos < monto_centavos AND motivo_anulacion", "    (estado = 'abierto' AND motivo_anulacion", 1)],
    # Cualquier persona de la empresa escribe (el contador incluido).
    "MU18": [("    ELSE coalesce(p_autor = app_usuario(), false) AND flujo_editor(p_company)", "    ELSE coalesce(p_autor = app_usuario(), false)", 1)],
    # La aplicación se puede reescribir.
    "MU19": [("  IF TG_OP <> 'INSERT' THEN\n    RAISE EXCEPTION 'aplicacion_no_se_reescribe';\n  END IF;\n  IF NOT cobranza_autor_valido(NEW.company_id, NEW.aplicado_por)",
              "  IF TG_OP = 'DELETE' THEN\n    RAISE EXCEPTION 'aplicacion_no_se_reescribe';\n  END IF;\n  IF NOT cobranza_autor_valido(NEW.company_id, NEW.aplicado_por)", 1)],
    # --- Reversiones de los arreglos de la ronda r63 (evidencia de rojo) ---
    # base-N1: pagado_el se puede reescribir mientras el cargo sigue pagado.
    "AR1": [("  IF OLD.estado = 'pagado' AND NEW.estado = 'pagado' AND NEW.pagado_el IS DISTINCT FROM OLD.pagado_el THEN\n    RAISE EXCEPTION 'cobranza_inmutable';\n  END IF;\n", "", 1)],
    # base-N1: emitido_en y resuelto_en los pone quien escribe.
    "AR2": [("    IF NEW.estado = 'emitido' THEN\n      NEW.emitido_en := now();\n    ELSIF NEW.estado = 'omitido' THEN\n      NEW.resuelto_en := now();\n    END IF;\n", "", 1),
            ("  ELSIF NEW.estado = 'cancelado' THEN\n    NEW.resuelto_en := now();\n  END IF;\n", "  END IF;\n", 1)],
    # base-N4: las definers sin pg_temp al final.
    "AR3": [("SET search_path = public, pg_temp", "SET search_path = public", 21)],
    # Reenvío hasta 6.
    "AR4": [("(tipo = 'reenvio' AND secuencia BETWEEN 1 AND 5)", "(tipo = 'reenvio' AND secuencia BETWEEN 1 AND 6)", 1)],
    # r63-N2: referencias con 0 inicial.
    "AR5": [("referencia ~ '^[1-9][0-9]{6}$'", "referencia ~ '^[0-9]{7}$'", 1), ("  SELECT p ~ '^[1-9][0-9]{6}$' AND (", "  SELECT p ~ '^[0-9]{7}$' AND (", 1)],
    # Una persona marca un pago como devuelto.
    "AR6": [("    IF app_usuario() IS NOT NULL THEN\n      RAISE EXCEPTION 'sin_permiso_para_cobranza';\n    END IF;\n    NEW.anulado_en := now();", "    NEW.anulado_en := now();", 1)],
}

def main() -> int:
    archivo, clave = sys.argv[1], sys.argv[2]
    texto = open(archivo, encoding="utf-8").read()
    for viejo, nuevo, veces in MUTACIONES[clave]:
        n = texto.count(viejo)
        if n != veces:
            print(f"{clave}: el patrón aparece {n} veces (esperado {veces}): {viejo[:70]!r}", file=sys.stderr)
            return 2
        texto = texto.replace(viejo, nuevo)
    open(archivo, "w", encoding="utf-8").write(texto)
    return 0

if __name__ == "__main__":
    sys.exit(main())
