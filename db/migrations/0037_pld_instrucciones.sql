-- Instala los cambios de instrucciones PLD también cuando 0030 ya está registrada.
-- 0030 se modificó después de publicarse: no se vuelve a ejecutar en esas bases.
-- Conserva operaciones, alertas y bitácora. Las operaciones anteriores representan
-- la primera instrucción (1); solo las nuevas correcciones agregan reemplazos.
-- Compatible también con la 0030 actual y atómica dentro de db/migrate.sh.
SET LOCAL lock_timeout = '2s';
SET search_path TO public;

ALTER TABLE pld_operaciones
  ADD COLUMN IF NOT EXISTS instruccion integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reemplaza uuid REFERENCES pld_operaciones (id) ON DELETE RESTRICT;
ALTER TABLE pld_operaciones ALTER COLUMN ocurrida_en DROP DEFAULT;

-- Primero se instala la nueva unicidad; solo entonces se retira la histórica.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pld_operaciones'::regclass
                 AND conname = 'pld_operaciones_instruccion_unica') THEN
    ALTER TABLE pld_operaciones ADD CONSTRAINT pld_operaciones_instruccion_unica
      UNIQUE (origen_tabla, origen_id, instruccion);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pld_operaciones'::regclass
                 AND conname = 'pld_operaciones_instruccion') THEN
    ALTER TABLE pld_operaciones ADD CONSTRAINT pld_operaciones_instruccion
      CHECK (instruccion >= 1 AND (reemplaza IS NULL OR tipo = 'pago_proveedor'));
  END IF;
END;
$$;
ALTER TABLE pld_operaciones DROP CONSTRAINT IF EXISTS pld_operaciones_origen_unico;

-- El id permite descartar instrucciones reemplazadas desde los índices de las reglas.
DROP INDEX IF EXISTS pld_operaciones_mes_idx;
DROP INDEX IF EXISTS pld_operaciones_tiempo_idx;
DROP INDEX IF EXISTS pld_operaciones_clabe_idx;
CREATE INDEX pld_operaciones_mes_idx ON pld_operaciones (company_id, tipo, mes) INCLUDE (monto_centavos, id);
CREATE INDEX pld_operaciones_tiempo_idx ON pld_operaciones (company_id, tipo, ocurrida_en) INCLUDE (monto_centavos, personas, id);
CREATE INDEX pld_operaciones_clabe_idx ON pld_operaciones (company_id, clabe, ocurrida_en) INCLUDE (monto_centavos, id) WHERE clabe IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pld_operaciones_reemplazada ON pld_operaciones (reemplaza) WHERE reemplaza IS NOT NULL;
CREATE INDEX IF NOT EXISTS pld_alertas_excede_mes ON pld_alertas (company_id, (observado ->> 'operacion'), (observado ->> 'mes')) WHERE regla = 'excede_perfil';

COMMENT ON TABLE pld_operaciones IS
  'Operaciones que vigilan las reglas de PLD: instrucciones liberadas y lotes preparados (2ª XXIX). Incluye las que después se cancelaron. Una corrección liberada otra vez reemplaza a la anterior. Solo inserción.';

CREATE OR REPLACE FUNCTION pld_operaciones_antes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies c WHERE c.id = NEW.company_id AND c.demostracion) THEN
    RAISE EXCEPTION 'pld_empresa_de_demostracion';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_operaciones:' || NEW.company_id::text, 0));
  NEW.ocurrida_en := coalesce(NEW.ocurrida_en, clock_timestamp());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION pld_evaluar_operacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p pld_parametros%ROWTYPE;
  perfil pld_perfiles%ROWTYPE;
  grado text;
  factor numeric;
  declarado bigint;
  limite numeric;
  suma numeric;
  historial integer;
  mediana numeric;
  k numeric;
  umbral numeric;
  cuenta integer;
  suma_ventana numeric;
  lotes integer;
  promedio numeric;
  pct numeric;
  tope_personas numeric;
  sobre_perfil boolean := false;
  sobre_personas boolean := false;
  base jsonb;
  anterior pld_operaciones%ROWTYPE;
  previa boolean := false;
BEGIN
  -- El candado de la empresa ya lo tomó pld_operaciones_antes (r2-base-N8): dos
  -- liberaciones simultáneas no cruzan un umbral sin verse.
  p := pld_parametros_vigentes(NEW.operator_id);
  SELECT * INTO perfil FROM pld_perfiles x WHERE x.company_id = NEW.company_id ORDER BY x.numero DESC LIMIT 1;
  SELECT r.grado INTO grado FROM kyb_calificaciones_riesgo r
  WHERE r.company_id = NEW.company_id ORDER BY r.calificada_en DESC, r.id DESC LIMIT 1;
  factor := CASE WHEN grado = 'alto' THEN p.factor_grado_alto ELSE 1 END;
  base := jsonb_build_object(
    'operacion', NEW.tipo, 'monto_centavos', NEW.monto_centavos, 'grado', coalesce(grado, 'sin_calificar'),
    'factor_grado', factor, 'parametros_numero', p.numero
  );
  -- Una corrección liberada otra vez (r2-base-N1): la alerta dice qué instrucción reemplaza.
  IF NEW.reemplaza IS NOT NULL THEN
    SELECT * INTO anterior FROM pld_operaciones x WHERE x.id = NEW.reemplaza;
    base := base || jsonb_build_object(
      'instruccion', NEW.instruccion, 'reemplaza_monto_centavos', anterior.monto_centavos, 'reemplaza_clabe', anterior.clabe
    );
  END IF;

  -- Excede el perfil (27ª, tercer párrafo: alertas sobre cambios de comportamiento
  -- contra el perfil transaccional). La suma del mes calendario en la Ciudad de
  -- México, por tipo, incluidas las instrucciones canceladas, supera el monto máximo
  -- mensual declarado. Una alerta por empresa, tipo y mes: la da la primera operación
  -- que encuentra la suma arriba, también si el límite bajó a mitad de mes (un perfil
  -- nuevo o el grado alto) con la suma ya arriba (r2-base-N7). Cada pago cuenta una vez,
  -- con su instrucción vigente.
  IF perfil.id IS NOT NULL THEN
    declarado := CASE WHEN NEW.tipo = 'pago_proveedor' THEN perfil.pagos_monto_mensual_centavos ELSE perfil.nomina_monto_mensual_centavos END;
    limite := declarado * factor;
    SELECT coalesce(sum(o.monto_centavos), 0) INTO suma
    FROM pld_operaciones o
    WHERE o.company_id = NEW.company_id AND o.tipo = NEW.tipo AND o.mes = NEW.mes
      AND NOT EXISTS (SELECT 1 FROM pld_operaciones r WHERE r.reemplaza = o.id);
    IF suma > limite AND NOT EXISTS (
      SELECT 1 FROM pld_alertas a
      WHERE a.company_id = NEW.company_id AND a.regla = 'excede_perfil'
        AND a.observado ->> 'operacion' = NEW.tipo AND a.observado ->> 'mes' = to_char(NEW.mes, 'YYYY-MM')
    ) THEN
      PERFORM pld_alertar(NEW, p.id, 'excede_perfil', '27ª, párrafo tercero', base || jsonb_build_object(
        'mes', to_char(NEW.mes, 'YYYY-MM'), 'suma_mes_centavos', suma, 'declarado_centavos', declarado,
        'limite_centavos', limite, 'perfil_numero', perfil.numero, 'incluye_canceladas', true
      ));
    END IF;
  END IF;

  -- Monto atípico (41ª fr. III: montos que no corresponden a la actividad). La
  -- operación supera k veces la mediana del mismo tipo en los 6 meses anteriores,
  -- sin contarse a sí misma, si hay historial suficiente.
  SELECT count(*) INTO historial
  FROM pld_operaciones o
  WHERE o.company_id = NEW.company_id AND o.tipo = NEW.tipo AND o.id <> NEW.id
    AND o.ocurrida_en > NEW.ocurrida_en - interval '6 months' AND o.ocurrida_en <= NEW.ocurrida_en
    AND NOT EXISTS (SELECT 1 FROM pld_operaciones r WHERE r.reemplaza = o.id);
  IF historial >= p.atipico_historial_minimo THEN
    SELECT avg(x.monto) INTO mediana
    FROM (
      SELECT o.monto_centavos::numeric AS monto
      FROM pld_operaciones o
      WHERE o.company_id = NEW.company_id AND o.tipo = NEW.tipo AND o.id <> NEW.id
        AND o.ocurrida_en > NEW.ocurrida_en - interval '6 months' AND o.ocurrida_en <= NEW.ocurrida_en
        AND NOT EXISTS (SELECT 1 FROM pld_operaciones r WHERE r.reemplaza = o.id)
      ORDER BY o.monto_centavos
      LIMIT 2 - historial % 2 OFFSET (historial - 1) / 2
    ) AS x;
    k := p.atipico_k * factor;
    IF NEW.monto_centavos > k * mediana THEN
      PERFORM pld_alertar(NEW, p.id, 'monto_atipico', '41ª, fracción III', base || jsonb_build_object(
        'mediana_centavos', mediana, 'k', k, 'limite_centavos', k * mediana, 'historial_operaciones', historial,
        'ventana', '6 meses'
      ));
    END IF;
  END IF;

  -- Fraccionamiento (41ª fr. VIII: operaciones fraccionadas para eludir un umbral).
  -- N o más instrucciones a la misma CLABE dentro de la ventana, cada una por
  -- debajo del umbral, suman más que él. Alerta la instrucción que lo vuelve cierto.
  IF NEW.tipo = 'pago_proveedor' THEN
    umbral := p.fraccion_umbral_centavos * factor;
    IF NEW.monto_centavos < umbral THEN
      SELECT count(*), coalesce(sum(o.monto_centavos), 0) INTO cuenta, suma_ventana
      FROM pld_operaciones o
      WHERE o.company_id = NEW.company_id AND o.tipo = 'pago_proveedor' AND o.clabe = NEW.clabe
        AND o.ocurrida_en > NEW.ocurrida_en - make_interval(days => p.fraccion_ventana_dias)
        AND o.ocurrida_en <= NEW.ocurrida_en AND o.monto_centavos < umbral
        AND NOT EXISTS (SELECT 1 FROM pld_operaciones r WHERE r.reemplaza = o.id);
      -- Lo que había antes de esta operación: sin ella y, si reemplaza a otra, con la reemplazada.
      previa := anterior.id IS NOT NULL AND anterior.clabe = NEW.clabe AND anterior.monto_centavos < umbral
        AND anterior.ocurrida_en > NEW.ocurrida_en - make_interval(days => p.fraccion_ventana_dias);
      IF cuenta >= p.fraccion_n AND suma_ventana > umbral
        AND NOT (cuenta - 1 + previa::int >= p.fraccion_n
                 AND suma_ventana - NEW.monto_centavos + CASE WHEN previa THEN anterior.monto_centavos ELSE 0 END > umbral) THEN
        PERFORM pld_alertar(NEW, p.id, 'fraccionamiento', '41ª, fracción VIII', base || jsonb_build_object(
          'clabe', NEW.clabe, 'instrucciones', cuenta, 'suma_centavos', suma_ventana, 'umbral_centavos', umbral,
          'n', p.fraccion_n, 'ventana_dias', p.fraccion_ventana_dias
        ));
      END IF;
    END IF;
  END IF;

  -- Nómina atípica (41ª fr. II y III: cambios de comportamiento y montos fuera de
  -- lo normal). El lote supera el monto mensual de nómina declarado, o sus personas
  -- suben más del porcentaje contra el promedio de los lotes de los 6 meses anteriores.
  IF NEW.tipo = 'nomina' THEN
    IF perfil.id IS NOT NULL THEN
      sobre_perfil := NEW.monto_centavos > perfil.nomina_monto_mensual_centavos * factor;
    END IF;
    SELECT count(*), avg(o.personas) INTO lotes, promedio
    FROM pld_operaciones o
    WHERE o.company_id = NEW.company_id AND o.tipo = 'nomina' AND o.id <> NEW.id
      AND o.ocurrida_en > NEW.ocurrida_en - interval '6 months' AND o.ocurrida_en <= NEW.ocurrida_en;
    pct := p.nomina_personas_pct * factor;
    IF lotes >= 1 THEN
      tope_personas := promedio * (1 + pct / 100);
      sobre_personas := NEW.personas > tope_personas;
    END IF;
    IF sobre_perfil OR sobre_personas THEN
      PERFORM pld_alertar(NEW, p.id, 'nomina_atipica', '41ª, fracciones II y III', base || jsonb_build_object(
        'personas', NEW.personas, 'lote_sobre_perfil', sobre_perfil, 'personas_sobre_promedio', sobre_personas,
        'declarado_nomina_centavos', CASE WHEN perfil.id IS NULL THEN NULL ELSE perfil.nomina_monto_mensual_centavos END,
        'promedio_personas', promedio, 'lotes_previos', lotes, 'porcentaje', pct, 'tope_personas', tope_personas
      ));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pld_registrar_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  vigente pld_operaciones%ROWTYPE;
BEGIN
  -- r2-base-N1: un pago que regresa, se corrige y se libera otra vez entra con su
  -- instrucción nueva; si regresa con la misma (monto y CLABE), ya está registrado.
  SELECT o.* INTO vigente FROM pld_operaciones o
  WHERE o.origen_tabla = 'supplier_payment_requests' AND o.origen_id = NEW.id
  ORDER BY o.instruccion DESC LIMIT 1;
  IF vigente.id IS NOT NULL AND vigente.monto_centavos = NEW.total_centavos AND vigente.clabe = NEW.clabe THEN
    RETURN NULL;
  END IF;
  INSERT INTO pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, instruccion, reemplaza, monto_centavos, clabe)
  SELECT c.operator_id, NEW.company_id, 'pago_proveedor', 'supplier_payment_requests', NEW.id,
         greatest(NEW.version, coalesce(vigente.instruccion, 0) + 1), vigente.id, NEW.total_centavos, NEW.clabe
  FROM companies c WHERE c.id = NEW.company_id AND NOT c.demostracion;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION pld_registrar_nomina()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  personas integer;
BEGIN
  SELECT count(*) INTO personas FROM payroll_batch_items i WHERE i.batch_id = NEW.id AND i.company_id = NEW.company_id;
  IF personas = 0 OR NEW.total_centavos <= 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO pld_operaciones (operator_id, company_id, tipo, origen_tabla, origen_id, monto_centavos, personas)
  SELECT c.operator_id, NEW.company_id, 'nomina', 'payroll_batches', NEW.id, NEW.total_centavos, personas
  FROM companies c WHERE c.id = NEW.company_id AND NOT c.demostracion
  ON CONFLICT (origen_tabla, origen_id, instruccion) DO NOTHING;
  RETURN NULL;
END;
$$;

-- El disparador BEFORE es nuevo para la 0030 histórica. Se conservan los otros
-- disparadores, incluidas las defensas de inmutabilidad y conservación.
DROP TRIGGER IF EXISTS pld_operaciones_antes ON pld_operaciones;
CREATE TRIGGER pld_operaciones_antes
BEFORE INSERT ON pld_operaciones
FOR EACH ROW EXECUTE FUNCTION pld_operaciones_antes();

-- CREATE OR REPLACE conserva las ACL antiguas: se cierran también las bases que
-- instalaron 0030 antes de que se revocara EXECUTE a PUBLIC. Los triggers no lo requieren.
REVOKE ALL ON FUNCTION pld_operaciones_antes(), pld_evaluar_operacion(),
  pld_registrar_pago(), pld_registrar_nomina()
  FROM PUBLIC, plataforma_app, plataforma_cliente, plataforma_sofipo, plataforma_tarea;
