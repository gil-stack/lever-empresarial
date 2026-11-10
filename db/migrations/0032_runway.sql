-- Runway a 12 meses y alertas de caja: el mínimo de meses que elige la
-- empresa, el estado de sus dos alertas, cada aviso con su correo y una foto
-- del runway por semana. Nada de esto mueve dinero ni afirma un saldo del
-- banco: se calcula con el saldo que declara la empresa y lo registrado.

SET search_path TO public;

-- Mínimo de meses -----------------------------------------------------------------
-- Sin fila, el mínimo es de 3 meses. Lo cambian administración y finanzas.

CREATE TABLE cash_runway_settings (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  meses_minimos smallint NOT NULL,
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_runway_meses CHECK (meses_minimos BETWEEN 1 AND 12)
);

COMMENT ON TABLE cash_runway_settings IS
  'Mínimo de meses de runway: el aviso sale cuando el runway conservador baja de este número. Sin fila: 3.';

CREATE FUNCTION cash_runway_settings_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'configuracion_no_se_borra';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'configuracion_inmutable';
  END IF;
  IF NOT flujo_editor(NEW.company_id) OR NEW.actualizado_por IS DISTINCT FROM app_usuario() THEN
    RAISE EXCEPTION 'sin_permiso_para_flujo';
  END IF;
  -- La hora la pone la base, no quien escribe (r64-base-N2).
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_runway_settings_revisar
BEFORE INSERT OR UPDATE OR DELETE ON cash_runway_settings
FOR EACH ROW EXECUTE FUNCTION cash_runway_settings_revisar();

-- Lo que escribe solo la tarea ---------------------------------------------------
-- Estado, avisos, entregas y fotos: sin persona en el contexto (app_usuario()
-- nulo) y con la empresa en el contexto. Nadie los borra.

CREATE FUNCTION caja_solo_del_sistema()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'alerta_no_se_borra';
  END IF;
  IF app_usuario() IS NOT NULL THEN
    RAISE EXCEPTION 'alerta_solo_del_sistema';
  END IF;
  RETURN NEW;
END;
$$;

-- Estado de las dos alertas por empresa. Solo se escribe cuando cambia.
-- Cada vez que una bandera pasa de apagada a prendida es un cruce nuevo, con su
-- número (r64-base-N3). La base lleva la cuenta: un aviso nace con el número del
-- cruce vigente y no puede haber dos avisos del mismo cruce, aunque dos
-- corridas escriban a la vez sin el candado del servidor.
--
-- La fila de estado nunca se borra (alerta_no_se_borra, y no hay DELETE): si se
-- borrara, la cuenta volvería a 1 y cada cruce siguiente chocaría con el aviso
-- viejo número 1, y la empresa quedaría trabada.
CREATE TABLE cash_alert_states (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  bajo_colchon boolean NOT NULL,
  runway_bajo boolean NOT NULL,
  cruces_colchon integer NOT NULL DEFAULT 0,
  cruces_runway integer NOT NULL DEFAULT 0,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cash_alert_states IS
  'Si la empresa está debajo de su colchón (proyección de 13 semanas) y si su runway conservador está debajo de su mínimo, con cuántas veces se ha encendido cada una. Un aviso por cada vez que una de las dos se enciende.';

-- Los contadores y la hora los pone la base, desde OLD; lo que mande quien
-- escribe se ignora.
CREATE FUNCTION cash_alert_states_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.cruces_colchon := CASE WHEN NEW.bajo_colchon THEN 1 ELSE 0 END;
    NEW.cruces_runway := CASE WHEN NEW.runway_bajo THEN 1 ELSE 0 END;
  ELSE
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'alerta_inmutable';
    END IF;
    NEW.cruces_colchon := OLD.cruces_colchon + CASE WHEN NEW.bajo_colchon AND NOT OLD.bajo_colchon THEN 1 ELSE 0 END;
    NEW.cruces_runway := OLD.cruces_runway + CASE WHEN NEW.runway_bajo AND NOT OLD.runway_bajo THEN 1 ELSE 0 END;
  END IF;
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_alert_states_sistema
BEFORE INSERT OR UPDATE OR DELETE ON cash_alert_states
FOR EACH ROW EXECUTE FUNCTION caja_solo_del_sistema();
CREATE TRIGGER cash_alert_states_revisar
BEFORE INSERT OR UPDATE ON cash_alert_states
FOR EACH ROW EXECUTE FUNCTION cash_alert_states_revisar();

-- Un aviso por cruce: las condiciones que se encendieron en la misma corrida
-- van juntas en un solo correo. Se aparta como «enviando» antes de mandar; una
-- segunda corrida no encuentra nada que apartar.
CREATE TABLE cash_alerts (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  colchon boolean NOT NULL,
  runway boolean NOT NULL,
  -- La semana con faltante de la proyección de 13 semanas, cuando cruzó el colchón.
  faltante_inicio date,
  faltante_saldo_centavos bigint,
  faltante_motivo text,
  colchon_centavos bigint NOT NULL,
  -- El runway conservador en semanas (horizonte = «12 meses o más»), cuando cruzó el mínimo.
  runway_semanas smallint,
  horizonte_semanas smallint NOT NULL,
  meses_minimos smallint NOT NULL,
  estado text NOT NULL,
  destinatarios integer NOT NULL DEFAULT 0,
  intentos smallint NOT NULL DEFAULT 1,
  codigo text,
  detectado_en timestamptz NOT NULL DEFAULT now(),
  intentado_en timestamptz NOT NULL DEFAULT now(),
  terminado_en timestamptz,
  -- El número del cruce de cada condición del aviso (r64-base-N3); nulo si el aviso no la lleva.
  cruce_colchon integer,
  cruce_runway integer,
  CONSTRAINT cash_alerts_id_empresa UNIQUE (id, company_id),
  CONSTRAINT cash_alerts_alguna CHECK (colchon OR runway),
  CONSTRAINT cash_alerts_cruce CHECK (colchon = (cruce_colchon IS NOT NULL) AND runway = (cruce_runway IS NOT NULL)),
  CONSTRAINT cash_alerts_faltante CHECK (
    (colchon AND faltante_inicio IS NOT NULL AND faltante_saldo_centavos IS NOT NULL AND faltante_motivo IN ('negativo', 'colchon')
      AND extract(isodow FROM faltante_inicio) = 1)
    OR (NOT colchon AND faltante_inicio IS NULL AND faltante_saldo_centavos IS NULL AND faltante_motivo IS NULL)
  ),
  CONSTRAINT cash_alerts_runway CHECK (
    (runway AND runway_semanas IS NOT NULL AND runway_semanas BETWEEN 0 AND horizonte_semanas)
    OR (NOT runway AND runway_semanas IS NULL)
  ),
  CONSTRAINT cash_alerts_colchon CHECK (colchon_centavos BETWEEN 0 AND 9000000000000000),
  CONSTRAINT cash_alerts_horizonte CHECK (horizonte_semanas BETWEEN 52 AND 56),
  CONSTRAINT cash_alerts_meses CHECK (meses_minimos BETWEEN 1 AND 12),
  CONSTRAINT cash_alerts_estado CHECK (estado IN ('enviando', 'enviado', 'fallido', 'simulado', 'sin_destinatarios', 'descartado')),
  CONSTRAINT cash_alerts_cierre CHECK ((estado = 'enviando') = (terminado_en IS NULL)),
  CONSTRAINT cash_alerts_destinatarios CHECK (destinatarios >= 0),
  CONSTRAINT cash_alerts_intentos CHECK (intentos BETWEEN 1 AND 5),
  CONSTRAINT cash_alerts_codigo CHECK (codigo IS NULL OR codigo ~ '^[a-z][a-z0-9_]{0,63}$')
);

CREATE INDEX cash_alerts_empresa ON cash_alerts (company_id, detectado_en DESC, id);
CREATE INDEX cash_alerts_reintento ON cash_alerts (company_id, estado, intentado_en) WHERE estado IN ('enviando', 'fallido');
-- Un solo aviso por cruce. Dos columnas porque un mismo correo puede llevar las dos condiciones. Una segunda
-- corrida concurrente de la misma empresa choca aquí (23505) y se cuenta como fallida; la siguiente corrida ya ve
-- la bandera prendida y no crea aviso. Un aviso viejo atorado en «enviando» no estorba: el cruce nuevo trae otro
-- número (por eso no es un UNIQUE por estado abierto).
CREATE UNIQUE INDEX cash_alerts_un_aviso_por_cruce_colchon ON cash_alerts (company_id, cruce_colchon) WHERE colchon;
CREATE UNIQUE INDEX cash_alerts_un_aviso_por_cruce_runway ON cash_alerts (company_id, cruce_runway) WHERE runway;

COMMENT ON TABLE cash_alerts IS
  'Aviso de caja: el cruce del colchón, del mínimo de meses o de los dos, con las cifras de ese momento y el estado de su correo. No guarda el correo.';

-- Al darlo de alta, la base pone el número del cruce vigente de cada condición y
-- exige que su bandera siga prendida; también pone las horas (r64-base-N2 y N3).
CREATE FUNCTION cash_alerts_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  vigente record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado NOT IN ('enviando', 'simulado') OR NEW.intentos <> 1 OR NEW.destinatarios <> 0 THEN
      RAISE EXCEPTION 'alerta_no_valida';
    END IF;
    SELECT s.bajo_colchon, s.runway_bajo, s.cruces_colchon, s.cruces_runway INTO vigente
      FROM public.cash_alert_states s WHERE s.company_id = NEW.company_id;
    IF NOT FOUND OR (NEW.colchon AND NOT vigente.bajo_colchon) OR (NEW.runway AND NOT vigente.runway_bajo) THEN
      RAISE EXCEPTION 'alerta_sin_cruce';
    END IF;
    NEW.cruce_colchon := CASE WHEN NEW.colchon THEN vigente.cruces_colchon END;
    NEW.cruce_runway := CASE WHEN NEW.runway THEN vigente.cruces_runway END;
    NEW.detectado_en := clock_timestamp();
    NEW.intentado_en := NEW.detectado_en;
    NEW.terminado_en := CASE WHEN NEW.estado = 'enviando' THEN NULL ELSE NEW.detectado_en END;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.colchon, NEW.runway, NEW.faltante_inicio, NEW.faltante_saldo_centavos, NEW.faltante_motivo,
      NEW.colchon_centavos, NEW.runway_semanas, NEW.horizonte_semanas, NEW.meses_minimos, NEW.detectado_en,
      NEW.cruce_colchon, NEW.cruce_runway)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.colchon, OLD.runway, OLD.faltante_inicio, OLD.faltante_saldo_centavos, OLD.faltante_motivo,
      OLD.colchon_centavos, OLD.runway_semanas, OLD.horizonte_semanas, OLD.meses_minimos, OLD.detectado_en,
      OLD.cruce_colchon, OLD.cruce_runway)
  THEN
    RAISE EXCEPTION 'alerta_inmutable';
  END IF;
  -- Apartar otra vez cuenta un intento nuevo desde ahora; cerrar pone la hora del cierre.
  IF NEW.estado = 'enviando' THEN
    NEW.intentado_en := clock_timestamp();
    NEW.terminado_en := NULL;
  ELSE
    NEW.intentado_en := OLD.intentado_en;
    NEW.terminado_en := clock_timestamp();
  END IF;
  -- enviando → enviado | fallido | sin_destinatarios; fallido → enviando (otro intento) | descartado.
  IF NOT (
    (OLD.estado = 'enviando' AND NEW.estado IN ('enviado', 'fallido', 'sin_destinatarios') AND NEW.intentos = OLD.intentos)
    OR (OLD.estado = 'fallido' AND NEW.estado = 'enviando' AND NEW.intentos = OLD.intentos + 1)
    OR (OLD.estado = 'fallido' AND NEW.estado = 'descartado' AND NEW.intentos = OLD.intentos)
  ) THEN
    RAISE EXCEPTION 'alerta_ya_cerrada';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_alerts_sistema
BEFORE INSERT OR UPDATE OR DELETE ON cash_alerts
FOR EACH ROW EXECUTE FUNCTION caja_solo_del_sistema();
CREATE TRIGGER cash_alerts_revisar
BEFORE INSERT OR UPDATE ON cash_alerts
FOR EACH ROW EXECUTE FUNCTION cash_alerts_revisar();

-- A quién ya le llegó el aviso. La llave del proveedor dura 24 horas; esta fila
-- no vence. No guarda la dirección.
CREATE TABLE cash_alert_deliveries (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  alert_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  entregado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_alert_deliveries_aviso
    FOREIGN KEY (alert_id, company_id) REFERENCES cash_alerts (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT cash_alert_deliveries_unica UNIQUE (alert_id, user_id)
);

COMMENT ON TABLE cash_alert_deliveries IS
  'A quién ya le llegó un aviso de caja. Lo escribe la tarea; solo inserción.';

CREATE FUNCTION caja_solo_insercion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'registro_no_se_reescribe';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_alert_deliveries_sistema
BEFORE INSERT OR UPDATE OR DELETE ON cash_alert_deliveries
FOR EACH ROW EXECUTE FUNCTION caja_solo_del_sistema();
CREATE TRIGGER cash_alert_deliveries_insercion
BEFORE UPDATE ON cash_alert_deliveries
FOR EACH ROW EXECUTE FUNCTION caja_solo_insercion();

-- Una foto del runway por empresa y semana (lunes, hora de México). La toma la
-- primera corrida de la semana; correr otra vez no crea ni reescribe nada.
CREATE TABLE cash_runway_snapshots (
  id uuid NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  semana date NOT NULL,
  -- Semanas de runway (horizonte = «12 meses o más»).
  semanas_conservador smallint NOT NULL,
  semanas_esperado smallint NOT NULL,
  horizonte_semanas smallint NOT NULL,
  saldo_centavos bigint NOT NULL,
  saldo_al_dia date NOT NULL,
  colchon_centavos bigint NOT NULL,
  meses_minimos smallint NOT NULL,
  tomada_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, semana),
  CONSTRAINT cash_runway_snapshots_lunes CHECK (extract(isodow FROM semana) = 1),
  CONSTRAINT cash_runway_snapshots_horizonte CHECK (horizonte_semanas BETWEEN 52 AND 56),
  CONSTRAINT cash_runway_snapshots_semanas CHECK (
    semanas_conservador BETWEEN 0 AND horizonte_semanas
    AND semanas_esperado BETWEEN semanas_conservador AND horizonte_semanas
  ),
  CONSTRAINT cash_runway_snapshots_saldo CHECK (saldo_centavos BETWEEN 0 AND 9000000000000000 AND saldo_al_dia >= DATE '2000-01-01'),
  CONSTRAINT cash_runway_snapshots_colchon CHECK (colchon_centavos BETWEEN 0 AND 9000000000000000),
  CONSTRAINT cash_runway_snapshots_meses CHECK (meses_minimos BETWEEN 1 AND 12)
);

COMMENT ON TABLE cash_runway_snapshots IS
  'Foto semanal del runway conservador y esperado con el saldo, el colchón y el mínimo de ese momento. Solo inserción.';

-- Hoy en la Ciudad de México, con el reloj de la base. Las fotos la usan para
-- saber qué semana es. Una prueba con fecha fija la reemplaza en su base
-- desechable (es su dueña); la aplicación no puede.
CREATE FUNCTION caja_hoy()
RETURNS date
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (timezone('America/Mexico_City', clock_timestamp()))::date
$$;

-- La semana de la foto es la de hoy (o, a lo más, la anterior: la corrida del
-- lunes temprano puede caer todavía en domingo) y la hora la pone la base
-- (r64-base-N2).
CREATE FUNCTION cash_runway_snapshots_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  hoy date := public.caja_hoy();
  lunes date := hoy - (extract(isodow FROM hoy)::integer - 1);
BEGIN
  IF NEW.semana IS DISTINCT FROM lunes AND NEW.semana IS DISTINCT FROM lunes - 7 THEN
    RAISE EXCEPTION 'foto_fuera_de_semana';
  END IF;
  NEW.tomada_en := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cash_runway_snapshots_sistema
BEFORE INSERT OR UPDATE OR DELETE ON cash_runway_snapshots
FOR EACH ROW EXECUTE FUNCTION caja_solo_del_sistema();
CREATE TRIGGER cash_runway_snapshots_insercion
BEFORE UPDATE ON cash_runway_snapshots
FOR EACH ROW EXECUTE FUNCTION caja_solo_insercion();
CREATE TRIGGER cash_runway_snapshots_revisar
BEFORE INSERT ON cash_runway_snapshots
FOR EACH ROW EXECUTE FUNCTION cash_runway_snapshots_revisar();

-- La puerta de la tarea ---------------------------------------------------------------
-- La tarea (plataforma_tarea, ya autenticada con CRON_SECRET) pide solo los ids
-- de las empresas activas con al menos un saldo declarado. Sin saldo no hay
-- runway, alerta ni foto. Lo demás lo lee empresa por empresa con su contexto.
CREATE FUNCTION empresas_para_alertas_de_caja()
RETURNS TABLE (company_id uuid, operator_id uuid, demostracion boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.operator_id, c.demostracion
  FROM companies c
  WHERE c.estado = 'activa'
    AND c.operator_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM cash_balance_declarations d WHERE d.company_id = c.id)
  ORDER BY c.id
$$;

REVOKE ALL ON FUNCTION empresas_para_alertas_de_caja() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION empresas_para_alertas_de_caja() TO plataforma_tarea;

-- Toda escritura deja su evento en la misma transacción ---------------------------
-- Apartar el correo de un aviso (enviando) no se audita: la transición del
-- estado ya dejó el suyo. Cerrarlo, sí.

CREATE FUNCTION caja_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  esperada text;
  fila_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'cash_runway_settings' THEN
    esperada := 'configurar_runway'; fila_id := NEW.company_id;
  ELSIF TG_TABLE_NAME = 'cash_alert_states' THEN
    esperada := 'estado_alerta_caja'; fila_id := NEW.company_id;
  ELSIF TG_TABLE_NAME = 'cash_alerts' THEN
    IF NEW.estado = 'enviando' THEN RETURN NULL; END IF;
    esperada := 'alerta_caja'; fila_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'cash_alert_deliveries' THEN
    esperada := 'alerta_caja_entregada'; fila_id := NEW.id;
  ELSE
    esperada := 'foto_runway'; fila_id := NEW.id;
  END IF;
  IF NOT bitacora_tiene_evento(NEW.company_id, esperada, TG_TABLE_NAME, fila_id) THEN
    RAISE EXCEPTION 'auditoria_de_flujo_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cash_runway_settings_auditoria
AFTER INSERT OR UPDATE ON cash_runway_settings DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_alert_states_auditoria
AFTER INSERT OR UPDATE ON cash_alert_states DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_alerts_auditoria
AFTER INSERT OR UPDATE ON cash_alerts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_alert_deliveries_auditoria
AFTER INSERT ON cash_alert_deliveries DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();
CREATE CONSTRAINT TRIGGER cash_runway_snapshots_auditoria
AFTER INSERT ON cash_runway_snapshots DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION caja_exige_auditoria();

-- Permisos mínimos y RLS --------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON cash_runway_settings TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON cash_alert_states TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON cash_alerts TO plataforma_cliente;
GRANT SELECT, INSERT ON cash_alert_deliveries TO plataforma_cliente;
GRANT SELECT, INSERT ON cash_runway_snapshots TO plataforma_cliente;

ALTER TABLE cash_runway_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_alert_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_alert_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_runway_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_runway_settings_cliente ON cash_runway_settings FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_alert_states_cliente ON cash_alert_states FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_alerts_cliente ON cash_alerts FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_alert_deliveries_cliente ON cash_alert_deliveries FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY cash_runway_snapshots_cliente ON cash_runway_snapshots FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());

ALTER TABLE cash_runway_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_alert_states FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_alert_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_runway_snapshots FORCE ROW LEVEL SECURITY;

-- Empresa suspendida (r64-base-N4): si la 0028 ya corrió, su ciclo no vio estas
-- tablas; se les pone su disparador aquí, con el mismo criterio que la 0028 y la
-- 0031 (tabla base con company_id y escritura de plataforma_cliente, salvo
-- audit_log). Si la 0028 corre después, este bloque no hace nada y ella lo pone.
DO $$
DECLARE
  tabla text;
BEGIN
  IF to_regprocedure('bloqueo_empresa_suspendida()') IS NOT NULL THEN
    FOR tabla IN
      SELECT DISTINCT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.role_table_grants g
          ON g.table_schema = c.table_schema AND g.table_name = c.table_name
         AND g.grantee = 'plataforma_cliente' AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND c.table_name <> 'audit_log'
         AND NOT EXISTS (
           SELECT 1 FROM pg_trigger x
            WHERE x.tgrelid = format('public.%I', c.table_name)::regclass
              AND x.tgname = 'bloqueo_empresa_suspendida' AND NOT x.tgisinternal
         )
       ORDER BY c.table_name
    LOOP
      EXECUTE format(
        'CREATE TRIGGER bloqueo_empresa_suspendida BEFORE INSERT OR UPDATE OR DELETE ON %I '
        'FOR EACH ROW EXECUTE FUNCTION bloqueo_empresa_suspendida()',
        tabla
      );
    END LOOP;
  END IF;
END;
$$;
