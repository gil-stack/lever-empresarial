#!/usr/bin/env python3
"""R8 · Mutaciones de las reglas clave de la 0032 (504e9bc; con las reversiones AR de la ronda r64). Uso: mutar-0032.py <archivo 0032> <MV…>.
Cada una es un reemplazo exacto con su número de apariciones; si no cuadra, sale con 2 (mutación no aplicada)."""
import sys

MUTACIONES = {
    # Una persona escribe lo que solo escribe el sistema.
    "MV1": [("  IF app_usuario() IS NOT NULL THEN\n    RAISE EXCEPTION 'alerta_solo_del_sistema';\n  END IF;\n", "", 1)],
    # Alta de un aviso en cualquier estado.
    "MV2": [("    IF NEW.estado NOT IN ('enviando', 'simulado') OR NEW.intentos <> 1 OR NEW.destinatarios <> 0 THEN",
             "    IF NEW.intentos <> 1 OR NEW.destinatarios <> 0 THEN", 1)],
    # Flecha prohibida: un aviso enviado se vuelve a apartar.
    "MV3": [("    OR (OLD.estado = 'fallido' AND NEW.estado = 'descartado' AND NEW.intentos = OLD.intentos)\n",
             "    OR (OLD.estado = 'fallido' AND NEW.estado = 'descartado' AND NEW.intentos = OLD.intentos)\n    OR (OLD.estado = 'enviado' AND NEW.estado = 'enviando')\n", 1)],
    # Las cifras del cruce dejan de ser inmutables.
    "MV4": [("  IF (NEW.id, NEW.company_id, NEW.colchon, NEW.runway, NEW.faltante_inicio, NEW.faltante_saldo_centavos, NEW.faltante_motivo,\n      NEW.colchon_centavos, NEW.runway_semanas,",
             "  IF (NEW.id, NEW.company_id, NEW.colchon, NEW.runway, NEW.faltante_inicio, NEW.faltante_saldo_centavos, NEW.faltante_motivo,\n      OLD.colchon_centavos, OLD.runway_semanas,", 1)],
    # Reintento sin contar el intento.
    "MV5": [("    OR (OLD.estado = 'fallido' AND NEW.estado = 'enviando' AND NEW.intentos = OLD.intentos + 1)",
             "    OR (OLD.estado = 'fallido' AND NEW.estado = 'enviando')", 1)],
    # Sin llave (aviso, persona) de la entrega.
    "MV6": [("  CONSTRAINT cash_alert_deliveries_unica UNIQUE (alert_id, user_id)\n", "  CONSTRAINT cash_alert_deliveries_unica CHECK (true)\n", 1)],
    # Sin llave (empresa, semana) de la foto.
    "MV7": [("  PRIMARY KEY (company_id, semana),\n", "", 1)],
    # La foto de cualquier día.
    "MV8": [("  CONSTRAINT cash_runway_snapshots_lunes CHECK (extract(isodow FROM semana) = 1),", "  CONSTRAINT cash_runway_snapshots_lunes CHECK (true),", 1)],
    # Sin bitácora obligatoria.
    "MV9": [("    RAISE EXCEPTION 'auditoria_de_flujo_ausente';", "    NULL;", 1)],
    # La bitácora deja de exigir la acción.
    "MV10": [("  IF NOT bitacora_tiene_evento(NEW.company_id, esperada, TG_TABLE_NAME, fila_id) THEN", "  IF NOT bitacora_tiene_evento(NEW.company_id, NULL, TG_TABLE_NAME, fila_id) THEN", 1)],
    # RLS de avisos abierta.
    "MV11": [("CREATE POLICY cash_alerts_cliente ON cash_alerts FOR ALL TO plataforma_cliente\n  USING (company_id = app_empresa())",
              "CREATE POLICY cash_alerts_cliente ON cash_alerts FOR ALL TO plataforma_cliente\n  USING (true)", 1)],
    # FK simple de la entrega al aviso.
    "MV12": [("    FOREIGN KEY (alert_id, company_id) REFERENCES cash_alerts (id, company_id) ON DELETE RESTRICT,",
              "    FOREIGN KEY (alert_id) REFERENCES cash_alerts (id) ON DELETE RESTRICT,", 1)],
    # Cualquier persona de la empresa cambia el mínimo (el contador incluido).
    "MV13": [("  IF NOT flujo_editor(NEW.company_id) OR NEW.actualizado_por IS DISTINCT FROM app_usuario() THEN",
              "  IF NEW.actualizado_por IS DISTINCT FROM app_usuario() THEN", 1)],
    # Se firma el cambio como otra persona.
    "MV14": [("  IF NOT flujo_editor(NEW.company_id) OR NEW.actualizado_por IS DISTINCT FROM app_usuario() THEN",
              "  IF NOT flujo_editor(NEW.company_id) THEN", 1)],
    # Mínimo fuera de 1-12.
    "MV15": [("  CONSTRAINT cash_runway_meses CHECK (meses_minimos BETWEEN 1 AND 12)", "  CONSTRAINT cash_runway_meses CHECK (meses_minimos BETWEEN 0 AND 99)", 1)],
    # Entregas y fotos reescribibles (el disparador; el GRANT sigue sin UPDATE).
    "MV16": [("  IF TG_OP <> 'INSERT' THEN\n    RAISE EXCEPTION 'registro_no_se_reescribe';", "  IF false THEN\n    RAISE EXCEPTION 'registro_no_se_reescribe';", 1)],
    # La puerta de la tarea para PUBLIC.
    "MV17": [("REVOKE ALL ON FUNCTION empresas_para_alertas_de_caja() FROM PUBLIC;\n", "", 1)],
    # Aviso cerrado sin terminado_en.
    "MV18": [("  CONSTRAINT cash_alerts_cierre CHECK ((estado = 'enviando') = (terminado_en IS NULL)),", "  CONSTRAINT cash_alerts_cierre CHECK (true),", 1)],
    # La tarea también evalúa empresas suspendidas.
    "MV19": [("  WHERE c.estado = 'activa'\n    AND c.operator_id IS NOT NULL", "  WHERE c.operator_id IS NOT NULL", 1)],
    # --- Reversiones de los arreglos de la ronda r64 (evidencia de rojo) ---
    # r65-N1: las 3 definers sin pg_temp.
    "AR1": [("SECURITY DEFINER\nSET search_path = public, pg_temp", "SECURITY DEFINER\nSET search_path = public", 3)],
    # N2: el mínimo guarda la hora que manda quien escribe.
    "AR2": [("  NEW.actualizado_en := now();\n  RETURN NEW;\nEND;\n$$;\n\nCREATE TRIGGER cash_runway_settings_revisar", "  RETURN NEW;\nEND;\n$$;\n\nCREATE TRIGGER cash_runway_settings_revisar", 1)],
    # N2: el aviso guarda las horas que manda quien escribe al darse de alta.
    "AR3": [("    NEW.detectado_en := clock_timestamp();\n    NEW.intentado_en := NEW.detectado_en;\n    NEW.terminado_en := CASE WHEN NEW.estado = 'enviando' THEN NULL ELSE NEW.detectado_en END;\n", "", 1)],
    # N2: el cierre guarda la hora que manda quien escribe.
    "AR4": [("  ELSE\n    NEW.intentado_en := OLD.intentado_en;\n    NEW.terminado_en := clock_timestamp();\n  END IF;", "  END IF;", 1)],
    # N2: la foto de cualquier semana.
    "AR5": [("    RAISE EXCEPTION 'foto_fuera_de_semana';", "    NULL;", 1)],
    # N2: la foto guarda la hora que manda quien escribe; el estado también.
    "AR6": [("  NEW.tomada_en := now();\n", "", 1)],
    "AR7": [("  NEW.actualizado_en := now();\n  RETURN NEW;\nEND;\n$$;\n\nCREATE TRIGGER cash_alert_states_sistema", "  RETURN NEW;\nEND;\n$$;\n\nCREATE TRIGGER cash_alert_states_sistema", 1)],
    # N3: los contadores los pone quien escribe.
    "AR8": [("  IF TG_OP = 'INSERT' THEN\n    NEW.cruces_colchon := CASE WHEN NEW.bajo_colchon THEN 1 ELSE 0 END;\n    NEW.cruces_runway := CASE WHEN NEW.runway_bajo THEN 1 ELSE 0 END;\n  ELSE\n    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN\n      RAISE EXCEPTION 'alerta_inmutable';\n    END IF;\n    NEW.cruces_colchon := OLD.cruces_colchon + CASE WHEN NEW.bajo_colchon AND NOT OLD.bajo_colchon THEN 1 ELSE 0 END;\n    NEW.cruces_runway := OLD.cruces_runway + CASE WHEN NEW.runway_bajo AND NOT OLD.runway_bajo THEN 1 ELSE 0 END;\n  END IF;",
             "  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN\n    RAISE EXCEPTION 'alerta_inmutable';\n  END IF;", 1)],
    # N3: sin la llave de un aviso por cruce.
    "AR9": [("CREATE UNIQUE INDEX cash_alerts_un_aviso_por_cruce_runway ON cash_alerts (company_id, cruce_runway) WHERE runway;\n", "", 1)],
    # N3: un aviso sin cruce vigente.
    "AR10": [("    IF NOT FOUND OR (NEW.colchon AND NOT vigente.bajo_colchon) OR (NEW.runway AND NOT vigente.runway_bajo) THEN\n      RAISE EXCEPTION 'alerta_sin_cruce';\n    END IF;\n", "", 1)],
    # N3: el número del cruce lo manda quien escribe.
    "AR11": [("    NEW.cruce_colchon := CASE WHEN NEW.colchon THEN vigente.cruces_colchon END;\n    NEW.cruce_runway := CASE WHEN NEW.runway THEN vigente.cruces_runway END;\n",
              "    NEW.cruce_colchon := CASE WHEN NEW.colchon THEN coalesce(NEW.cruce_colchon, vigente.cruces_colchon) END;\n    NEW.cruce_runway := CASE WHEN NEW.runway THEN coalesce(NEW.cruce_runway, vigente.cruces_runway) END;\n", 1)],
    # r64-base-N4: sin el DO del final (si la 0028 entró antes, las 5 tablas quedan sin el bloqueo).
    "AR13": [("  IF to_regprocedure('bloqueo_empresa_suspendida()') IS NOT NULL THEN", "  IF false THEN", 1)],
    # N3: el número del cruce se puede reescribir.
    "AR12": [("      NEW.colchon_centavos, NEW.runway_semanas, NEW.horizonte_semanas, NEW.meses_minimos, NEW.detectado_en,\n      NEW.cruce_colchon, NEW.cruce_runway)",
              "      NEW.colchon_centavos, NEW.runway_semanas, NEW.horizonte_semanas, NEW.meses_minimos, NEW.detectado_en,\n      OLD.cruce_colchon, OLD.cruce_runway)", 1)],
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
