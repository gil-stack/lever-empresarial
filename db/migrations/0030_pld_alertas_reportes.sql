-- Ola R2. Alertas PLD, reportes regulatorios y conservación de 10 años.
--
-- Fuente normativa: Disposiciones de carácter general a que se refiere el
-- artículo 124 de la Ley de Ahorro y Crédito Popular (DCG), compilado oficial
-- 978376 de gob.mx con la última reforma del DOF del 09-09-2021. Formato de
-- reportes: resolución del DOF del 14-12-2004 y sus reformas (layout de 41
-- columnas). Integración del Comité: resolución del DOF del 20-05-2020 e
-- instructivo de la CNBV de enero de 2024. Días inhábiles: los dos
-- instrumentos del DOF del 10-12-2025. Cada regla cita su disposición.
--
-- Qué hace este archivo:
--   0. Utilidades: fecha en la Ciudad de México, rol del contexto, bitácora
--      obligatoria y registros inmutables.
--   1. Días inhábiles con su instrumento y el criterio conservador.
--   2. Celebración del contrato (27ª), en una sola función.
--   3. Perfil transaccional versionado y evaluaciones semestrales (25ª-27ª).
--   4. Parámetros de las reglas, versionados (54ª).
--   5. Registro de operaciones y reglas de alerta en la misma transacción
--      que la operación (2ª XXIX, 27ª, 41ª). Una alerta nunca bloquea.
--   6. Avisos del personal al área de Cumplimiento (54ª VIII, 60ª).
--   7. Casos, análisis, marca de 24 horas (40ª, 41ª, 44ª, 45ª).
--   8. Quién dictamina, Comité, sesiones, votos y actas (46ª-49ª).
--   9. Dictamen y reporte de inusuales e internas preocupantes (40ª-45ª).
--  10. Clave de la entidad y reportes periódicos (36ª, 38ª, 72ª-1).
--  11. Candado de activación: exige perfil transaccional (25ª).
--  12. Conservación de 10 años de las operaciones (61ª).
--  13. RLS, permisos y bitácora confidencial (55ª, 60ª).
--
-- Lever no transmite reportes a la UIF ni a la CNBV: arma su contenido y
-- registra el acuse que el Oficial de Cumplimiento obtiene en el SITI PLD/FT.
-- Nunca guarda la clave de acceso al SITI del Oficial (72ª-1).

SET search_path TO public;

-- 0. Utilidades ----------------------------------------------------------------

CREATE FUNCTION pld_fecha_mx(p_momento timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT (p_momento AT TIME ZONE 'America/Mexico_City')::date $$;

COMMENT ON FUNCTION pld_fecha_mx(timestamptz) IS 'Fecha calendario en la Ciudad de México de un instante. Los meses y plazos de PLD se miden con ella.';

-- r2-base-N14: lo que una identidad o un folio de PLD no admite, igual que INVISIBLE
-- de src/dominio/control.ts: controles (Cc), formato (Cf) y Default_Ignorable_Code_Point.
-- Postgres no tiene \p{}: la clase va explícita, generada desde el mismo INVISIBLE
-- (Unicode 17.0), y tests/pld/pld-postgres.test.ts compara las dos en todo Unicode.
CREATE FUNCTION pld_sin_invisibles(p_texto text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_texto IS NULL OR p_texto !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]'
$$;

-- ¿La persona del contexto tiene alguno de estos roles en su operador? Nunca NULL.
CREATE FUNCTION pld_rol(p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    app_operador() IS NOT NULL AND app_usuario() IS NOT NULL AND personal_tiene_rol(app_operador(), app_usuario(), p_roles),
    false
  )
$$;

REVOKE ALL ON FUNCTION pld_rol(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_rol(text[]) TO plataforma_sofipo;

-- 61ª y 54ª: lo de PLD es historial. Nada se reescribe, se borra ni se trunca.
CREATE FUNCTION pld_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'conservacion_no_se_borra';
  END IF;
  RAISE EXCEPTION 'pld_registro_inmutable';
END;
$$;

-- Cada escritura del personal deja su evento en la bitácora en la misma
-- transacción. Argumentos: acción (vacía: cualquiera), entidad del evento
-- (vacía: la tabla) y columna del identificador (vacía: id).
CREATE FUNCTION pld_exige_evento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  fila jsonb := to_jsonb(NEW);
  empresa uuid;
  identificador uuid;
BEGIN
  IF current_user <> 'plataforma_sofipo' THEN
    RETURN NULL;
  END IF;
  empresa := nullif(fila ->> 'company_id', '')::uuid;
  identificador := (fila ->> coalesce(nullif(TG_ARGV[2], ''), 'id'))::uuid;
  IF NOT bitacora_tiene_evento(
    empresa, nullif(TG_ARGV[0], ''), coalesce(nullif(TG_ARGV[1], ''), TG_TABLE_NAME), identificador
  ) THEN
    RAISE EXCEPTION 'pld_sin_auditoria';
  END IF;
  RETURN NULL;
END;
$$;

-- ¿Esta persona está en el personal activo del operador?
CREATE FUNCTION pld_es_personal(p_operador uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_staff s WHERE s.operator_id = p_operador AND s.user_id = p_user AND s.estado = 'activo'
  )
$$;

REVOKE ALL ON FUNCTION pld_es_personal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_es_personal(uuid, uuid) TO plataforma_sofipo;

-- 1. Días inhábiles --------------------------------------------------------------

-- La DCG no define «día hábil». Hay dos instrumentos oficiales del mismo día
-- (DOF 10-12-2025): el cierre de las entidades supervisadas y los días
-- inhábiles para trámites ante la CNBV. No coinciden. Mientras el Oficial no
-- diga cuál rige, un día cuenta como hábil si alguno de los dos lo considera
-- hábil: contar de menos nunca vence tarde. Sábado y domingo son inhábiles en
-- los dos. Un año sin sus dos calendarios cargados solo descuenta fines de semana.
CREATE TABLE pld_calendarios (
  anio integer NOT NULL,
  instrumento text NOT NULL,
  dof_publicado_el date NOT NULL,
  fuente_url text NOT NULL,
  cargado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_calendarios_pkey PRIMARY KEY (anio, instrumento),
  CONSTRAINT pld_calendarios_instrumento CHECK (instrumento IN ('cierre_entidades', 'tramites_cnbv')),
  CONSTRAINT pld_calendarios_anio CHECK (anio BETWEEN 2026 AND 2100),
  CONSTRAINT pld_calendarios_fuente CHECK (fuente_url ~ '^https://dof\.gob\.mx/nota_detalle\.php\?codigo=[0-9]+&fecha=[0-9/]+$')
);

COMMENT ON TABLE pld_calendarios IS
  'Calendarios oficiales de días inhábiles cargados, por año e instrumento. Un año sin sus dos instrumentos dice «Falta el calendario».';

CREATE TABLE pld_dias_inhabiles (
  fecha date NOT NULL,
  instrumento text NOT NULL,
  anio integer NOT NULL,
  fundamento text NOT NULL,
  CONSTRAINT pld_dias_inhabiles_pkey PRIMARY KEY (fecha, instrumento),
  CONSTRAINT pld_dias_inhabiles_calendario FOREIGN KEY (anio, instrumento) REFERENCES pld_calendarios (anio, instrumento) ON DELETE RESTRICT,
  CONSTRAINT pld_dias_inhabiles_anio CHECK (anio = extract(year FROM fecha)::integer),
  CONSTRAINT pld_dias_inhabiles_fundamento CHECK (texto_regulado(fundamento, 200))
);

COMMENT ON TABLE pld_dias_inhabiles IS
  'Días inhábiles entre semana, cada uno con su instrumento y su fracción del DOF. Los sábados y domingos no se cargan: siempre son inhábiles.';

INSERT INTO pld_calendarios (anio, instrumento, dof_publicado_el, fuente_url) VALUES
  (2026, 'cierre_entidades', DATE '2025-12-10', 'https://dof.gob.mx/nota_detalle.php?codigo=5775684&fecha=10/12/2025'),
  (2026, 'tramites_cnbv', DATE '2025-12-10', 'https://dof.gob.mx/nota_detalle.php?codigo=5775683&fecha=10/12/2025');

-- Cierre de entidades, art. 1 (DOF 10-12-2025). El 12 de diciembre cae en sábado.
INSERT INTO pld_dias_inhabiles (fecha, instrumento, anio, fundamento) VALUES
  (DATE '2026-01-01', 'cierre_entidades', 2026, 'Art. 1, fr. I: el 1o. de enero'),
  (DATE '2026-02-02', 'cierre_entidades', 2026, 'Art. 1, fr. II: el primer lunes de febrero'),
  (DATE '2026-03-16', 'cierre_entidades', 2026, 'Art. 1, fr. III: el tercer lunes de marzo'),
  (DATE '2026-04-02', 'cierre_entidades', 2026, 'Art. 1, fr. IV: el 2 de abril'),
  (DATE '2026-04-03', 'cierre_entidades', 2026, 'Art. 1, fr. IV: el 3 de abril'),
  (DATE '2026-05-01', 'cierre_entidades', 2026, 'Art. 1, fr. V: el 1o. de mayo'),
  (DATE '2026-09-16', 'cierre_entidades', 2026, 'Art. 1, fr. VI: el 16 de septiembre'),
  (DATE '2026-11-02', 'cierre_entidades', 2026, 'Art. 1, fr. VII: el 2 de noviembre'),
  (DATE '2026-11-16', 'cierre_entidades', 2026, 'Art. 1, fr. VII: el tercer lunes de noviembre'),
  (DATE '2026-12-25', 'cierre_entidades', 2026, 'Art. 1, fr. VIII: el 25 de diciembre');

-- Trámites ante la CNBV, artículo ÚNICO (DOF 10-12-2025). No incluye el 25 de diciembre de 2026.
INSERT INTO pld_dias_inhabiles (fecha, instrumento, anio, fundamento) VALUES
  (DATE '2026-01-01', 'tramites_cnbv', 2026, 'Fr. I: del 29 de diciembre de 2025 al 2 de enero de 2026'),
  (DATE '2026-01-02', 'tramites_cnbv', 2026, 'Fr. I: del 29 de diciembre de 2025 al 2 de enero de 2026'),
  (DATE '2026-01-05', 'tramites_cnbv', 2026, 'Fr. I: el 5 y 6 de enero de 2026'),
  (DATE '2026-01-06', 'tramites_cnbv', 2026, 'Fr. I: el 5 y 6 de enero de 2026'),
  (DATE '2026-02-02', 'tramites_cnbv', 2026, 'Fr. II: el primer lunes de febrero de 2026'),
  (DATE '2026-03-16', 'tramites_cnbv', 2026, 'Fr. III: el tercer lunes de marzo de 2026'),
  (DATE '2026-04-02', 'tramites_cnbv', 2026, 'Fr. IV: el 2 de abril de 2026'),
  (DATE '2026-04-03', 'tramites_cnbv', 2026, 'Fr. IV: el 3 de abril de 2026'),
  (DATE '2026-05-01', 'tramites_cnbv', 2026, 'Fr. V: el 1o. de mayo de 2026'),
  (DATE '2026-05-05', 'tramites_cnbv', 2026, 'Fr. VI: el 5 de mayo de 2026'),
  (DATE '2026-09-16', 'tramites_cnbv', 2026, 'Fr. VII: el 16 de septiembre de 2026'),
  (DATE '2026-11-02', 'tramites_cnbv', 2026, 'Fr. VIII: el 2 de noviembre de 2026'),
  (DATE '2026-11-16', 'tramites_cnbv', 2026, 'Fr. VIII: el tercer lunes de noviembre de 2026');

-- Criterio conservador: inhábil solo si es fin de semana o si los dos instrumentos lo dicen.
CREATE FUNCTION pld_dia_inhabil(p_dia date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT extract(isodow FROM p_dia) IN (6, 7)
      OR (SELECT count(DISTINCT d.instrumento) FROM pld_dias_inhabiles d WHERE d.fecha = p_dia) = 2
$$;

CREATE FUNCTION pld_calendario_cargado(p_anio integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT count(*) = 2 FROM pld_calendarios c WHERE c.anio = p_anio $$;

-- El día hábil número p_dias contado desde el siguiente a p_desde (40ª: «dentro
-- de los tres días hábiles siguientes a aquél en que concluya la sesión»).
CREATE FUNCTION pld_sumar_dias_habiles(p_desde date, p_dias integer)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dia date := p_desde;
  contados integer := 0;
BEGIN
  IF p_desde IS NULL OR p_dias IS NULL OR p_dias < 1 OR p_dias > 366 THEN
    RAISE EXCEPTION 'pld_dias_habiles_invalidos';
  END IF;
  WHILE contados < p_dias LOOP
    dia := dia + 1;
    IF NOT pld_dia_inhabil(dia) THEN
      contados := contados + 1;
    END IF;
  END LOOP;
  RETURN dia;
END;
$$;

-- El n-ésimo día hábil del mes, contando el día 1 (36ª: «dentro de los diez
-- primeros días hábiles de los meses de enero, abril, julio y octubre»).
CREATE FUNCTION pld_dia_habil_del_mes(p_mes date, p_n integer)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT pld_sumar_dias_habiles(date_trunc('month', p_mes)::date - 1, p_n) $$;

-- Último día hábil del mes (38ª: «siguientes al último día hábil del mes inmediato anterior»).
CREATE FUNCTION pld_ultimo_dia_habil(p_mes date)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dia date := (date_trunc('month', p_mes) + interval '1 month')::date - 1;
BEGIN
  WHILE pld_dia_inhabil(dia) LOOP
    dia := dia - 1;
  END LOOP;
  RETURN dia;
END;
$$;

-- Días hábiles en (p_desde, p_hasta]: lo que queda de un plazo. Cero si ya pasó.
-- Con enteros: generate_series de fechas con intervalo pasa por timestamptz y, con
-- un huso que cambia de horario a medianoche, se salta un día (r2-base-N13). El
-- tope es el de pld_sumar_dias_habiles: ningún plazo de PLD pasa de un año (N12).
CREATE FUNCTION pld_dias_habiles_entre(p_desde date, p_hasta date)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta - p_desde > 366 THEN
    RAISE EXCEPTION 'pld_dias_habiles_invalidos';
  END IF;
  RETURN (SELECT count(*)::integer FROM generate_series(1, p_hasta - p_desde) AS k WHERE NOT pld_dia_inhabil(p_desde + k));
END;
$$;

-- 2. Celebración del contrato ----------------------------------------------------

-- 27ª: las evaluaciones semestrales cubren a los Clientes «cuya apertura de
-- cuenta o celebración de contrato se hubiere realizado al menos con seis meses
-- de anticipación a la evaluación». En Lever es la fecha (Ciudad de México) de
-- la primera activación aprobada: antes de ella la empresa no opera. Es la única
-- definición; si el Oficial fija otra fecha (por ejemplo, la aceptación del
-- contrato en línea), se cambia aquí y las reglas no se tocan.
CREATE FUNCTION pld_celebracion_contrato(p_company uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pld_fecha_mx(min(r.decided_at))
  FROM company_activation_requests r
  WHERE r.company_id = p_company AND r.estado = 'aprobada'
$$;

REVOKE ALL ON FUNCTION pld_celebracion_contrato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_celebracion_contrato(uuid) TO plataforma_sofipo;

-- 3. Perfil transaccional y evaluaciones ----------------------------------------

-- 25ª y 26ª: el perfil transaccional con los montos máximos mensuales estimados
-- que declara el Cliente, por tipo de operación. Cada declaración es una versión;
-- vale la de número más alto. La captura Originación; Cumplimiento la cambia al
-- evaluar (27ª).
-- r2-base-N18 (decisión del líder): con la empresa activa o suspendida, el
-- cambio de perfil que pide Originación es una propuesta. El umbral
-- vigente no cambia hasta que Cumplimiento la aprueba: el perfil es contra lo que
-- vigila Cumplimiento y la 50ª separa esas áreas. En alta, Originación declara.
CREATE TABLE pld_perfil_propuestas (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  pagos_monto_mensual_centavos bigint NOT NULL,
  pagos_operaciones_mensuales integer NOT NULL,
  nomina_monto_mensual_centavos bigint NOT NULL,
  nomina_operaciones_mensuales integer NOT NULL,
  motivo text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_perfil_propuestas_company FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT pld_perfil_propuestas_montos CHECK (
    pagos_monto_mensual_centavos BETWEEN 0 AND 9007199254740991
    AND nomina_monto_mensual_centavos BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT pld_perfil_propuestas_operaciones CHECK (
    pagos_operaciones_mensuales BETWEEN 0 AND 1000000 AND nomina_operaciones_mensuales BETWEEN 0 AND 1000000
  ),
  CONSTRAINT pld_perfil_propuestas_motivo CHECK (texto_regulado(motivo, 500) AND char_length(motivo) >= 10)
);

CREATE INDEX pld_perfil_propuestas_company_idx ON pld_perfil_propuestas (company_id, registrado_en DESC);

CREATE TABLE pld_perfiles (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  numero integer NOT NULL DEFAULT 0,
  origen text NOT NULL,
  pagos_monto_mensual_centavos bigint NOT NULL,
  pagos_operaciones_mensuales integer NOT NULL,
  nomina_monto_mensual_centavos bigint NOT NULL,
  nomina_operaciones_mensuales integer NOT NULL,
  motivo text,
  -- La propuesta de Originación que Cumplimiento aprobó (origen «aprobacion»).
  propuesta_id uuid REFERENCES pld_perfil_propuestas (id) ON DELETE RESTRICT,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT pld_perfiles_company FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT pld_perfiles_numero_unico UNIQUE (company_id, numero),
  CONSTRAINT pld_perfiles_propuesta_unica UNIQUE (propuesta_id),
  CONSTRAINT pld_perfiles_origen CHECK (origen IN ('declaracion', 'evaluacion', 'aprobacion')),
  CONSTRAINT pld_perfiles_propuesta CHECK ((origen = 'aprobacion') = (propuesta_id IS NOT NULL)),
  CONSTRAINT pld_perfiles_montos CHECK (
    pagos_monto_mensual_centavos BETWEEN 0 AND 9007199254740991
    AND nomina_monto_mensual_centavos BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT pld_perfiles_operaciones CHECK (
    pagos_operaciones_mensuales BETWEEN 0 AND 1000000 AND nomina_operaciones_mensuales BETWEEN 0 AND 1000000
  ),
  -- El motivo de una declaración o de una propuesta aprobada (500, el de la bitácora) o la justificación de la
  -- evaluación semestral que cambia el perfil (2000).
  CONSTRAINT pld_perfiles_motivo CHECK (texto_regulado(motivo, 2000) AND (motivo IS NULL OR char_length(motivo) >= 10))
);

CREATE INDEX pld_perfiles_vigente_idx ON pld_perfiles (company_id, numero DESC);

COMMENT ON TABLE pld_perfiles IS
  'Perfil transaccional declarado (25ª-27ª): monto máximo mensual estimado y número estimado de operaciones al mes, por tipo. Solo inserción.';

CREATE FUNCTION pld_perfiles_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  estado_empresa text;
  propuesta pld_perfil_propuestas%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_perfiles:' || NEW.company_id::text, 0));
  SELECT c.estado INTO estado_empresa FROM companies c WHERE c.id = NEW.company_id;
  IF estado_empresa IS NULL THEN
    RAISE EXCEPTION 'cliente_ausente';
  END IF;
  IF estado_empresa = 'baja' THEN
    RAISE EXCEPTION 'cliente_de_baja';
  END IF;
  -- r2-base-N18: con la empresa activa o suspendida, Originación no declara: propone
  -- (pld_perfil_propuestas). De prospecto a en alta, declara como siempre. La dueña
  -- (migraciones y semillas) no pasa por aquí.
  IF NEW.origen = 'declaracion' AND estado_empresa IN ('activa', 'suspendida') AND current_user = 'plataforma_sofipo' THEN
    RAISE EXCEPTION 'perfil_requiere_aprobacion';
  END IF;
  -- La versión aprobada lleva los montos y el motivo de la propuesta pendiente, no otros.
  IF NEW.origen = 'aprobacion' THEN
    SELECT * INTO propuesta FROM pld_perfil_propuestas x WHERE x.id = NEW.propuesta_id AND x.company_id = NEW.company_id;
    IF propuesta.id IS NULL OR EXISTS (SELECT 1 FROM pld_perfil_resoluciones r WHERE r.propuesta_id = propuesta.id) THEN
      RAISE EXCEPTION 'propuesta_de_perfil_no_pendiente';
    END IF;
    NEW.pagos_monto_mensual_centavos := propuesta.pagos_monto_mensual_centavos;
    NEW.pagos_operaciones_mensuales := propuesta.pagos_operaciones_mensuales;
    NEW.nomina_monto_mensual_centavos := propuesta.nomina_monto_mensual_centavos;
    NEW.nomina_operaciones_mensuales := propuesta.nomina_operaciones_mensuales;
    NEW.motivo := propuesta.motivo;
  END IF;
  NEW.numero := coalesce((SELECT max(p.numero) FROM pld_perfiles p WHERE p.company_id = NEW.company_id), 0) + 1;
  -- Cambiar un perfil declarado se explica (la primera declaración no).
  IF NEW.numero > 1 AND NEW.motivo IS NULL THEN
    RAISE EXCEPTION 'motivo_invalido';
  END IF;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() THEN
      RAISE EXCEPTION 'sin_rol_para_perfil';
    END IF;
    IF NEW.origen = 'declaracion' AND NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['originacion']) THEN
      RAISE EXCEPTION 'sin_rol_para_perfil';
    END IF;
    IF NEW.origen IN ('evaluacion', 'aprobacion') AND NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_evaluar';
    END IF;
    NEW.registrado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_perfiles_revisar
BEFORE INSERT ON pld_perfiles
FOR EACH ROW EXECUTE FUNCTION pld_perfiles_revisar();

-- Cumplimiento resuelve cada propuesta una vez: la aprueba (y la versión aprobada
-- queda como vigente en la misma transacción) o la rechaza con su motivo.
CREATE TABLE pld_perfil_resoluciones (
  propuesta_id uuid PRIMARY KEY REFERENCES pld_perfil_propuestas (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  decision text NOT NULL,
  perfil_id uuid REFERENCES pld_perfiles (id) ON DELETE RESTRICT,
  motivo text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_perfil_resoluciones_decision CHECK (decision IN ('aprobada', 'rechazada')),
  CONSTRAINT pld_perfil_resoluciones_perfil CHECK ((decision = 'aprobada') = (perfil_id IS NOT NULL)),
  CONSTRAINT pld_perfil_resoluciones_motivo CHECK (texto_regulado(motivo, 500) AND char_length(motivo) >= 10)
);

CREATE FUNCTION pld_perfil_propuestas_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  estado_empresa text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_perfiles:' || NEW.company_id::text, 0));
  SELECT c.estado INTO estado_empresa FROM companies c WHERE c.id = NEW.company_id;
  IF estado_empresa IS NULL THEN
    RAISE EXCEPTION 'cliente_ausente';
  END IF;
  IF estado_empresa = 'baja' THEN
    RAISE EXCEPTION 'cliente_de_baja';
  END IF;
  -- Antes de activar no hay propuesta: Originación declara el perfil.
  IF estado_empresa NOT IN ('activa', 'suspendida') THEN
    RAISE EXCEPTION 'perfil_se_declara_en_alta';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pld_perfil_propuestas x
    WHERE x.company_id = NEW.company_id AND NOT EXISTS (SELECT 1 FROM pld_perfil_resoluciones r WHERE r.propuesta_id = x.id)
  ) THEN
    RAISE EXCEPTION 'propuesta_de_perfil_pendiente';
  END IF;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['originacion']) THEN
      RAISE EXCEPTION 'sin_rol_para_perfil';
    END IF;
    NEW.registrado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_perfil_propuestas_revisar
BEFORE INSERT ON pld_perfil_propuestas
FOR EACH ROW EXECUTE FUNCTION pld_perfil_propuestas_revisar();

CREATE FUNCTION pld_perfil_resoluciones_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  propuesta pld_perfil_propuestas%ROWTYPE;
BEGIN
  SELECT * INTO propuesta FROM pld_perfil_propuestas x WHERE x.id = NEW.propuesta_id;
  IF propuesta.id IS NULL THEN
    RAISE EXCEPTION 'propuesta_de_perfil_no_pendiente';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_perfiles:' || propuesta.company_id::text, 0));
  IF EXISTS (SELECT 1 FROM pld_perfil_resoluciones r WHERE r.propuesta_id = propuesta.id) THEN
    RAISE EXCEPTION 'propuesta_de_perfil_no_pendiente';
  END IF;
  NEW.operator_id := propuesta.operator_id;
  NEW.company_id := propuesta.company_id;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_evaluar';
    END IF;
    NEW.registrado_en := now();
  END IF;
  -- Aprobada: la versión con esta propuesta ya está escrita en la transacción.
  IF NEW.decision = 'aprobada' AND NOT EXISTS (
    SELECT 1 FROM pld_perfiles p WHERE p.id = NEW.perfil_id AND p.propuesta_id = propuesta.id
  ) THEN
    RAISE EXCEPTION 'propuesta_de_perfil_no_pendiente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_perfil_resoluciones_revisar
BEFORE INSERT ON pld_perfil_resoluciones
FOR EACH ROW EXECUTE FUNCTION pld_perfil_resoluciones_revisar();

-- Una versión aprobada sin su resolución no queda: al cerrar la transacción se revisa.
CREATE FUNCTION pld_perfil_aprobado_con_resolucion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.origen = 'aprobacion' AND NOT EXISTS (
    SELECT 1 FROM pld_perfil_resoluciones r WHERE r.propuesta_id = NEW.propuesta_id AND r.decision = 'aprobada' AND r.perfil_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'propuesta_de_perfil_no_pendiente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pld_perfil_aprobado_con_resolucion
AFTER INSERT ON pld_perfiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pld_perfil_aprobado_con_resolucion();

-- 27ª: «al menos, dos evaluaciones por año calendario» del perfil transaccional
-- y del grado de riesgo. Una evaluación queda en el semestre de su fecha. Mantiene
-- o cambia el perfil (el cambio es una versión nueva de esta misma transacción) y
-- liga la calificación de riesgo vigente: cambiar el grado es la calificación de la 0028.
CREATE TABLE pld_evaluaciones (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  anio integer NOT NULL DEFAULT 0,
  semestre smallint NOT NULL DEFAULT 1,
  perfil text NOT NULL,
  perfil_id uuid NOT NULL REFERENCES pld_perfiles (id) ON DELETE RESTRICT,
  calificacion_id uuid NOT NULL REFERENCES kyb_calificaciones_riesgo (id) ON DELETE RESTRICT,
  grado text NOT NULL DEFAULT 'bajo',
  justificacion text NOT NULL,
  evaluada_el date NOT NULL DEFAULT hoy_mexico(),
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_evaluaciones_company FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT pld_evaluaciones_perfil CHECK (perfil IN ('mantiene', 'cambia')),
  CONSTRAINT pld_evaluaciones_semestre CHECK (semestre IN (1, 2)),
  CONSTRAINT pld_evaluaciones_grado CHECK (grado IN ('bajo', 'medio', 'alto')),
  CONSTRAINT pld_evaluaciones_justificacion CHECK (texto_regulado(justificacion, 2000) AND char_length(justificacion) >= 10)
);

CREATE INDEX pld_evaluaciones_company_idx ON pld_evaluaciones (company_id, anio, semestre);

COMMENT ON TABLE pld_evaluaciones IS
  'Evaluaciones semestrales del perfil y del grado de riesgo (27ª). El pendiente se calcula al leer con pld_celebracion_contrato.';

CREATE FUNCTION pld_evaluaciones_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  vigente pld_perfiles%ROWTYPE;
  calificacion kyb_calificaciones_riesgo%ROWTYPE;
BEGIN
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_evaluar';
    END IF;
    NEW.evaluada_el := hoy_mexico();
    NEW.registrado_en := now();
  END IF;
  SELECT * INTO vigente FROM pld_perfiles p WHERE p.company_id = NEW.company_id ORDER BY p.numero DESC LIMIT 1;
  IF vigente.id IS NULL OR vigente.id <> NEW.perfil_id THEN
    RAISE EXCEPTION 'evaluacion_sobre_perfil_viejo';
  END IF;
  IF NEW.perfil = 'cambia' AND (vigente.origen <> 'evaluacion' OR vigente.txid <> txid_current()) THEN
    RAISE EXCEPTION 'evaluacion_sin_perfil_nuevo';
  END IF;
  IF NEW.perfil = 'mantiene' AND vigente.txid = txid_current() THEN
    RAISE EXCEPTION 'evaluacion_sin_perfil_nuevo';
  END IF;
  SELECT * INTO calificacion FROM kyb_calificaciones_riesgo k
  WHERE k.company_id = NEW.company_id ORDER BY k.calificada_en DESC, k.id DESC LIMIT 1;
  IF calificacion.id IS NULL OR calificacion.id <> NEW.calificacion_id THEN
    RAISE EXCEPTION 'evaluacion_sobre_grado_viejo';
  END IF;
  NEW.grado := calificacion.grado;
  NEW.anio := extract(year FROM NEW.evaluada_el)::integer;
  NEW.semestre := CASE WHEN extract(month FROM NEW.evaluada_el) <= 6 THEN 1 ELSE 2 END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_evaluaciones_revisar
BEFORE INSERT ON pld_evaluaciones
FOR EACH ROW EXECUTE FUNCTION pld_evaluaciones_revisar();

-- 4. Parámetros de las reglas ----------------------------------------------------

-- Una versión por cambio. La fila del operador vacío trae los valores iniciales
-- de esta migración; cada operador agrega las suyas con motivo y bitácora. Las
-- cifras son provisionales: las fija el Manual de Cumplimiento.
CREATE TABLE pld_parametros (
  id uuid PRIMARY KEY,
  operator_id uuid REFERENCES operators (id) ON DELETE RESTRICT,
  numero integer NOT NULL DEFAULT 0,
  -- 41ª fr. III: una operación supera k veces la mediana de los últimos 6 meses.
  atipico_k numeric(6, 2) NOT NULL,
  atipico_historial_minimo integer NOT NULL,
  -- 41ª fr. VIII: N o más instrucciones a la misma CLABE en la ventana, cada una bajo el umbral y juntas sobre él.
  fraccion_n integer NOT NULL,
  fraccion_ventana_dias integer NOT NULL,
  fraccion_umbral_centavos bigint NOT NULL,
  -- 41ª fr. II y III: las personas de un lote suben más de este porcentaje contra el promedio.
  nomina_personas_pct numeric(6, 2) NOT NULL,
  -- 27ª, primer párrafo: con grado alto cada umbral se multiplica por este factor (más estricto).
  factor_grado_alto numeric(4, 2) NOT NULL,
  fuentes jsonb NOT NULL,
  motivo text NOT NULL,
  registrado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_parametros_version UNIQUE NULLS NOT DISTINCT (operator_id, numero),
  CONSTRAINT pld_parametros_valores CHECK (
    atipico_k BETWEEN 1 AND 100 AND atipico_historial_minimo BETWEEN 1 AND 1000
    AND fraccion_n BETWEEN 2 AND 100 AND fraccion_ventana_dias BETWEEN 1 AND 90
    AND fraccion_umbral_centavos BETWEEN 100 AND 9007199254740991
    AND nomina_personas_pct BETWEEN 1 AND 1000 AND factor_grado_alto > 0 AND factor_grado_alto <= 1
  ),
  CONSTRAINT pld_parametros_fuentes CHECK (jsonb_typeof(fuentes) = 'object'),
  CONSTRAINT pld_parametros_motivo CHECK (texto_regulado(motivo, 500) AND char_length(motivo) >= 10),
  CONSTRAINT pld_parametros_autor CHECK ((operator_id IS NULL) = (registrado_por IS NULL))
);

COMMENT ON TABLE pld_parametros IS
  'Parámetros de las reglas de alerta (54ª), versionados. La fila sin operador son los valores iniciales, por confirmar con el Manual de Cumplimiento.';

INSERT INTO pld_parametros (
  id, operator_id, numero, atipico_k, atipico_historial_minimo, fraccion_n, fraccion_ventana_dias,
  fraccion_umbral_centavos, nomina_personas_pct, factor_grado_alto, fuentes, motivo
) VALUES (
  '00000000-0000-4000-8000-0000000000a2', NULL, 0, 3.00, 10, 3, 7, 10000000, 25.00, 0.80,
  jsonb_build_object(
    'atipico_k', 'Propuesta inicial de Lever para la 41ª fr. III. Por confirmar con el Manual de Cumplimiento.',
    'atipico_historial_minimo', 'Propuesta inicial de Lever: sin 10 operaciones previas la mediana no dice nada. Por confirmar con el Manual de Cumplimiento.',
    'fraccion_n', 'Propuesta inicial de Lever para la 41ª fr. VIII. Por confirmar con el Manual de Cumplimiento.',
    'fraccion_ventana_dias', 'Propuesta inicial de Lever para la 41ª fr. VIII. Por confirmar con el Manual de Cumplimiento.',
    'fraccion_umbral_centavos', 'Propuesta inicial de Lever ($100,000.00 MXN) para la 41ª fr. VIII. Sin cifra en la DCG. Por confirmar con el Manual de Cumplimiento.',
    'nomina_personas_pct', 'Propuesta inicial de Lever para la 41ª fr. II y III. Por confirmar con el Manual de Cumplimiento.',
    'factor_grado_alto', 'Propuesta inicial de Lever para la 27ª, primer párrafo (medidas reforzadas con grado alto). Por confirmar con el Manual de Cumplimiento.'
  ),
  'Valores iniciales de la Ola R2, por confirmar con el Manual de Cumplimiento.'
);

CREATE FUNCTION pld_parametros_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.operator_id IS NULL THEN
    RAISE EXCEPTION 'parametros_sin_operador';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_parametros:' || NEW.operator_id::text, 0));
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.operator_id IS DISTINCT FROM app_operador() OR NEW.registrado_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_parametros';
    END IF;
    NEW.registrado_en := now();
  END IF;
  NEW.numero := coalesce((SELECT max(p.numero) FROM pld_parametros p WHERE p.operator_id = NEW.operator_id), 0) + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_parametros_revisar
BEFORE INSERT ON pld_parametros
FOR EACH ROW EXECUTE FUNCTION pld_parametros_revisar();

CREATE FUNCTION pld_parametros_vigentes(p_operador uuid)
RETURNS pld_parametros
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.* FROM pld_parametros p
  WHERE p.operator_id = p_operador OR p.operator_id IS NULL
  ORDER BY (p.operator_id IS NULL), p.numero DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION pld_parametros_vigentes(uuid) FROM PUBLIC;

-- 5. Registro de operaciones y reglas ----------------------------------------------

-- 2ª fr. XXIX: Operación Inusual es la que el Cliente «realice o pretenda
-- realizar». Hoy Lever no mueve dinero: un pago termina en una instrucción
-- liberada y la nómina en un lote preparado. Cada instrucción entra aquí al
-- liberarse o prepararse, aunque después se cancele o regrese a revisión: el
-- cliente ya la pretendió. Si un pago regresa, se corrige (otro monto u otra CLABE)
-- y se vuelve a liberar, la instrucción nueva entra con su número (`instruccion`) y
-- `reemplaza` a la anterior: las reglas la evalúan y los acumulados cuentan solo la
-- vigente de cada pago, sin contarlo dos veces (r2-base-N1). Regresar con la misma
-- instrucción no la vuelve a registrar. Cuando llegue SPEI se agrega un disparador
-- que escriba aquí la operación ejecutada; las reglas no cambian.
CREATE TABLE pld_operaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL,
  tipo text NOT NULL,
  origen_tabla text NOT NULL,
  origen_id uuid NOT NULL,
  instruccion integer NOT NULL DEFAULT 1,
  reemplaza uuid REFERENCES pld_operaciones (id) ON DELETE RESTRICT,
  monto_centavos bigint NOT NULL,
  clabe text,
  personas integer,
  -- Sin valor por omisión: la pone pld_operaciones_antes con el candado ya tomado (r2-base-N8).
  ocurrida_en timestamptz NOT NULL,
  mes date GENERATED ALWAYS AS (date_trunc('month', ocurrida_en AT TIME ZONE 'America/Mexico_City')::date) STORED,
  CONSTRAINT pld_operaciones_company FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT pld_operaciones_instruccion_unica UNIQUE (origen_tabla, origen_id, instruccion),
  CONSTRAINT pld_operaciones_instruccion CHECK (instruccion >= 1 AND (reemplaza IS NULL OR tipo = 'pago_proveedor')),
  -- Solo canales nacionales y sin efectivo. Un tipo nuevo (efectivo, internacional)
  -- obliga a revisar los reportes de la 36ª, 37ª y 38ª: la prueba de los reportes
  -- periódicos lee esta lista y truena si cambia.
  CONSTRAINT pld_operaciones_tipo CHECK (tipo IN ('pago_proveedor', 'nomina')),
  CONSTRAINT pld_operaciones_origen CHECK (
    (tipo = 'pago_proveedor' AND origen_tabla = 'supplier_payment_requests')
    OR (tipo = 'nomina' AND origen_tabla = 'payroll_batches')
  ),
  CONSTRAINT pld_operaciones_monto CHECK (monto_centavos > 0),
  CONSTRAINT pld_operaciones_clabe CHECK ((tipo = 'pago_proveedor') = (clabe IS NOT NULL) AND (clabe IS NULL OR clabe ~ '^[0-9]{18}$')),
  CONSTRAINT pld_operaciones_personas CHECK ((tipo = 'nomina') = (personas IS NOT NULL) AND (personas IS NULL OR personas > 0))
);

-- Con `id` en INCLUDE las reglas leen solo el índice, también al excluir la operación
-- propia y las reemplazadas (r2-base-N11).
CREATE INDEX pld_operaciones_mes_idx ON pld_operaciones (company_id, tipo, mes) INCLUDE (monto_centavos, id);
CREATE INDEX pld_operaciones_tiempo_idx ON pld_operaciones (company_id, tipo, ocurrida_en) INCLUDE (monto_centavos, personas, id);
CREATE INDEX pld_operaciones_clabe_idx ON pld_operaciones (company_id, clabe, ocurrida_en) INCLUDE (monto_centavos, id) WHERE clabe IS NOT NULL;
-- Una instrucción se reemplaza a lo más una vez; los reemplazos son pocos y el índice, chico.
CREATE UNIQUE INDEX pld_operaciones_reemplazada ON pld_operaciones (reemplaza) WHERE reemplaza IS NOT NULL;

COMMENT ON TABLE pld_operaciones IS
  'Operaciones que vigilan las reglas de PLD: instrucciones liberadas y lotes preparados (2ª XXIX). Incluye las que después se cancelaron. Una corrección liberada otra vez reemplaza a la anterior. Solo inserción.';

-- r2-base-N8: el candado de la empresa y la hora van antes de escribir. Con la hora de
-- inicio de la transacción (now()), una liberación que empezó antes pero llegaba después
-- al candado quedaba fuera de las ventanas de la otra, y la otra tampoco la había visto.
-- Con el candado tomado aquí y clock_timestamp(), por empresa el orden de las horas es el
-- orden en que se confirman. Una hora explícita (las pruebas de frontera) se respeta.
-- C: una empresa de demostración no entra a PLD (0016: «recorre la interfaz y nunca se
-- activa para dinero»). Los registradores de abajo la saltan; aquí se cierra todo otro camino.
CREATE FUNCTION pld_operaciones_antes()
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

CREATE TRIGGER pld_operaciones_antes
BEFORE INSERT ON pld_operaciones
FOR EACH ROW EXECUTE FUNCTION pld_operaciones_antes();

-- Avisos del personal (sección 6): se crean antes de las alertas porque una alerta puede venir de un aviso.
CREATE TABLE pld_avisos (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  tipo text NOT NULL,
  descripcion text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_avisos_company FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT pld_avisos_tipo CHECK (tipo IN ('posible_inusual', 'posible_interna_preocupante')),
  CONSTRAINT pld_avisos_descripcion CHECK (texto_regulado(descripcion, 4000) AND char_length(descripcion) >= 20)
);

CREATE INDEX pld_avisos_autor_idx ON pld_avisos (operator_id, registrado_por, registrado_en DESC);

COMMENT ON TABLE pld_avisos IS
  'Aviso de cualquier persona del personal al área de Cumplimiento (54ª fr. VIII, 60ª último párrafo). Quien lo emite solo ve su acuse.';

CREATE TABLE pld_aviso_excluidos (
  aviso_id uuid NOT NULL REFERENCES pld_avisos (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  motivo text NOT NULL,
  CONSTRAINT pld_aviso_excluidos_pkey PRIMARY KEY (aviso_id, user_id),
  CONSTRAINT pld_aviso_excluidos_motivo CHECK (motivo IN ('mencionada', 'superior'))
);

COMMENT ON TABLE pld_aviso_excluidos IS
  '60ª: ni la persona mencionada ni el superior jerárquico de quien avisa ven el aviso ni su caso, aunque tengan rol de Cumplimiento.';

CREATE TABLE pld_alertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  regla text NOT NULL,
  disposicion text NOT NULL,
  operacion_id uuid REFERENCES pld_operaciones (id) ON DELETE RESTRICT,
  aviso_id uuid REFERENCES pld_avisos (id) ON DELETE RESTRICT,
  observado jsonb NOT NULL,
  parametros_id uuid REFERENCES pld_parametros (id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT now(),
  -- 40ª: «un periodo que no excederá de los sesenta días naturales contados a partir de que se genere la alerta».
  vence_el date GENERATED ALWAYS AS ((creada_en AT TIME ZONE 'America/Mexico_City')::date + 60) STORED,
  CONSTRAINT pld_alertas_company FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT pld_alertas_regla CHECK (regla IN ('excede_perfil', 'monto_atipico', 'fraccionamiento', 'nomina_atipica', 'aviso_manual')),
  CONSTRAINT pld_alertas_origen CHECK (
    (regla = 'aviso_manual' AND aviso_id IS NOT NULL AND operacion_id IS NULL)
    OR (regla <> 'aviso_manual' AND aviso_id IS NULL AND operacion_id IS NOT NULL AND company_id IS NOT NULL)
  ),
  CONSTRAINT pld_alertas_observado CHECK (jsonb_typeof(observado) = 'object'),
  CONSTRAINT pld_alertas_disposicion CHECK (texto_regulado(disposicion, 120))
);

-- Una alerta por regla y operación: reevaluar no duplica.
CREATE UNIQUE INDEX pld_alertas_regla_operacion ON pld_alertas (regla, operacion_id) WHERE operacion_id IS NOT NULL;
CREATE UNIQUE INDEX pld_alertas_un_aviso ON pld_alertas (aviso_id) WHERE aviso_id IS NOT NULL;
CREATE INDEX pld_alertas_operador_idx ON pld_alertas (operator_id, creada_en);
CREATE INDEX pld_alertas_company_idx ON pld_alertas (company_id, creada_en);
-- Una «Excede el perfil» por empresa, tipo y mes (r2-base-N7).
CREATE INDEX pld_alertas_excede_mes ON pld_alertas (company_id, (observado ->> 'operacion'), (observado ->> 'mes')) WHERE regla = 'excede_perfil';

COMMENT ON TABLE pld_alertas IS
  'Alertas de PLD (54ª): confidenciales (55ª). No son operational_alerts y no bloquean la operación. Solo inserción.';

-- Crea la alerta y su evento de sistema. La empresa nunca la ve (55ª).
CREATE FUNCTION pld_alertar(p_operacion pld_operaciones, p_parametros uuid, p_regla text, p_disposicion text, p_observado jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nueva uuid;
BEGIN
  INSERT INTO pld_alertas (operator_id, company_id, regla, disposicion, operacion_id, observado, parametros_id)
  VALUES (p_operacion.operator_id, p_operacion.company_id, p_regla, p_disposicion, p_operacion.id, p_observado, p_parametros)
  ON CONFLICT (regla, operacion_id) WHERE operacion_id IS NOT NULL DO NOTHING
  RETURNING id INTO nueva;
  IF nueva IS NOT NULL THEN
    INSERT INTO audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen, cambio)
    VALUES (p_operacion.operator_id, p_operacion.company_id, 'sistema', NULL, 'sistema', 'pld_alerta_generada', 'pld_alertas',
            nueva, 'pld', jsonb_build_object('regla', p_regla));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION pld_alertar(pld_operaciones, uuid, text, text, jsonb) FROM PUBLIC;

-- Las cuatro reglas iniciales. Corren en la transacción de la operación, con los
-- parámetros vigentes y el grado de riesgo vigente. Nunca lanzan: una alerta no
-- bloquea (la DCG no lo pide; el único bloqueo es el de la LPB de la 0028).
-- En el umbral exacto no alertan; un centavo arriba, sí.
CREATE FUNCTION pld_evaluar_operacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE TRIGGER pld_operaciones_evaluar
AFTER INSERT ON pld_operaciones
FOR EACH ROW EXECUTE FUNCTION pld_evaluar_operacion();

-- Pago a proveedor: la instrucción entra al pasar a «listo para pagar». El pago de una
-- empresa de demostración se libera igual y no entra (C).
CREATE FUNCTION pld_registrar_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE TRIGGER pld_registra_pago
AFTER UPDATE OF estado ON supplier_payment_requests
FOR EACH ROW WHEN (OLD.estado = 'por_autorizar' AND NEW.estado = 'listo_para_pagar')
EXECUTE FUNCTION pld_registrar_pago();

-- Nómina: el lote nace «preparada» y sus renglones llegan después en la misma
-- transacción; la regla corre al cerrarla, con el lote completo. El de una empresa de
-- demostración no entra (C).
CREATE FUNCTION pld_registrar_nomina()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE CONSTRAINT TRIGGER pld_registra_nomina
AFTER INSERT ON payroll_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pld_registrar_nomina();

-- 6. Avisos del personal ---------------------------------------------------------

-- C: el aviso puede no nombrar empresa; si la nombra, no es de demostración.
CREATE FUNCTION pld_avisos_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND EXISTS (SELECT 1 FROM companies c WHERE c.id = NEW.company_id AND c.demostracion) THEN
    RAISE EXCEPTION 'aviso_empresa_demostracion';
  END IF;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por,
        ARRAY['administracion_plataforma', 'originacion', 'aprobacion', 'cumplimiento', 'auditoria']) THEN
      RAISE EXCEPTION 'sin_permiso_para_avisar';
    END IF;
    NEW.registrado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_avisos_revisar
BEFORE INSERT ON pld_avisos
FOR EACH ROW EXECUTE FUNCTION pld_avisos_revisar();

-- El aviso es una alerta desde que se recibe: sus 60 días corren desde aquí
-- (40ª: «por el empleado de la Entidad»; 45ª: «detecte […] por […] cualquier empleado»).
CREATE FUNCTION pld_avisos_alertar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nueva uuid;
BEGIN
  INSERT INTO pld_alertas (operator_id, company_id, regla, disposicion, aviso_id, observado)
  VALUES (
    NEW.operator_id, NEW.company_id, 'aviso_manual',
    CASE NEW.tipo WHEN 'posible_inusual' THEN '40ª y 60ª, último párrafo' ELSE '45ª y 60ª, último párrafo' END,
    NEW.id,
    jsonb_build_object('tipo', NEW.tipo)
  )
  RETURNING id INTO nueva;
  INSERT INTO audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, origen, cambio)
  VALUES (NEW.operator_id, NEW.company_id, 'sistema', NULL, 'sistema', 'pld_alerta_generada', 'pld_alertas', nueva, 'pld',
          jsonb_build_object('regla', 'aviso_manual'));
  RETURN NULL;
END;
$$;

CREATE TRIGGER pld_avisos_alertar
AFTER INSERT ON pld_avisos
FOR EACH ROW EXECUTE FUNCTION pld_avisos_alertar();

-- Las exclusiones las marca quien avisa, en la misma transacción del aviso.
CREATE FUNCTION pld_aviso_excluidos_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aviso pld_avisos%ROWTYPE;
BEGIN
  SELECT * INTO aviso FROM pld_avisos a WHERE a.id = NEW.aviso_id;
  IF aviso.id IS NULL THEN
    RAISE EXCEPTION 'aviso_no_existe';
  END IF;
  NEW.operator_id := aviso.operator_id;
  -- Esta función es SECURITY DEFINER: current_user es la dueña. El rol que fijó la
  -- aplicación con SET ROLE sigue en el ajuste «role». Con el rol del personal y sin
  -- persona en el contexto, nadie avisa: se rechaza (r2-base-N17).
  IF current_setting('role') = 'plataforma_sofipo' AND app_usuario() IS NULL THEN
    RAISE EXCEPTION 'exclusion_fuera_del_aviso';
  END IF;
  -- Desde la aplicación (hay persona en el contexto): solo quien avisa, en la misma transacción.
  IF app_usuario() IS NOT NULL THEN
    IF aviso.registrado_por IS DISTINCT FROM app_usuario() OR aviso.registrado_en <> now()
      OR aviso.operator_id IS DISTINCT FROM app_operador() THEN
      RAISE EXCEPTION 'exclusion_fuera_del_aviso';
    END IF;
  END IF;
  IF NEW.user_id = aviso.registrado_por THEN
    RAISE EXCEPTION 'exclusion_propia';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform_staff s WHERE s.operator_id = aviso.operator_id AND s.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'exclusion_fuera_del_personal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_aviso_excluidos_revisar
BEFORE INSERT ON pld_aviso_excluidos
FOR EACH ROW EXECUTE FUNCTION pld_aviso_excluidos_revisar();

-- r2-base-N4: un aviso no excluye a todo Cumplimiento activo. Nadie lo analizaría y
-- los 60 días correrían en silencio (40ª). Al final de la transacción, con todas
-- las exclusiones del aviso ya escritas. A quién se escala cuando la persona
-- señalada es el Oficial lo define el Manual de Cumplimiento (pendiente de Gil).
CREATE FUNCTION pld_aviso_con_cumplimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- r2-fix-N2: el candado del personal de Cumplimiento del operador, el mismo que
  -- toma una suspensión, una baja o el retiro del rol. La consulta de abajo ve lo
  -- que la otra transacción confirmó mientras esta esperaba.
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_analistas:' || NEW.operator_id::text, 0));
  IF NOT EXISTS (
    SELECT 1
    FROM platform_staff s
    JOIN platform_staff_roles r ON r.operator_id = s.operator_id AND r.user_id = s.user_id
    WHERE s.operator_id = NEW.operator_id AND s.estado = 'activo' AND r.rol = 'cumplimiento'
      AND NOT EXISTS (SELECT 1 FROM pld_aviso_excluidos e WHERE e.aviso_id = NEW.aviso_id AND e.user_id = s.user_id)
  ) THEN
    RAISE EXCEPTION 'aviso_sin_cumplimiento';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pld_aviso_con_cumplimiento
AFTER INSERT ON pld_aviso_excluidos
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pld_aviso_con_cumplimiento();

-- 7. Casos y análisis ---------------------------------------------------------------

-- Un caso agrupa una o más alertas de la misma empresa: una serie relacionada va
-- en un solo reporte (40ª) y su plazo corre desde la alerta más antigua.
CREATE TABLE pld_casos (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_casos_company FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT
);

CREATE INDEX pld_casos_operador_idx ON pld_casos (operator_id, registrado_en);

CREATE TABLE pld_caso_alertas (
  caso_id uuid NOT NULL REFERENCES pld_casos (id) ON DELETE RESTRICT,
  alerta_id uuid NOT NULL REFERENCES pld_alertas (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_caso_alertas_pkey PRIMARY KEY (caso_id, alerta_id),
  CONSTRAINT pld_caso_alertas_una_vez UNIQUE (alerta_id)
);

COMMENT ON TABLE pld_casos IS 'Caso de análisis: una alerta o una serie relacionada del mismo cliente (40ª). Solo inserción.';

-- 44ª: con información de que los recursos pueden provenir de actividades ilícitas,
-- el reporte va en 24 horas desde que se conoce y lleva la leyenda «Reporte de 24 horas».
CREATE TABLE pld_casos_24h (
  caso_id uuid PRIMARY KEY REFERENCES pld_casos (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  motivo text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_casos_24h_motivo CHECK (texto_regulado(motivo, 1000) AND char_length(motivo) >= 10)
);

-- 41ª: los resultados del examen constan por escrito. Notas, documentos y propuesta.
CREATE TABLE pld_notas (
  id uuid PRIMARY KEY,
  caso_id uuid NOT NULL REFERENCES pld_casos (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  texto text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_notas_texto CHECK (texto_regulado(texto, 4000) AND char_length(texto) >= 2)
);

CREATE INDEX pld_notas_caso_idx ON pld_notas (caso_id, registrado_en);

CREATE TABLE pld_documentos (
  id uuid PRIMARY KEY,
  caso_id uuid NOT NULL REFERENCES pld_casos (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  nombre_archivo text NOT NULL,
  tipo_contenido text NOT NULL,
  tamano_bytes integer NOT NULL,
  sha256 text NOT NULL,
  clave_blob text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_documentos_contenido CHECK (tipo_contenido IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT pld_documentos_tamano CHECK (tamano_bytes BETWEEN 1 AND 4194304),
  CONSTRAINT pld_documentos_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pld_documentos_textos CHECK (texto_regulado(nombre_archivo, 200) AND texto_regulado(clave_blob, 512))
);

CREATE INDEX pld_documentos_caso_idx ON pld_documentos (caso_id, registrado_en);
CREATE INDEX pld_documentos_company_idx ON pld_documentos (company_id, registrado_en);

COMMENT ON COLUMN pld_documentos.clave_blob IS
  'Ruta en Blob privado. El personal no la lee directo: la entrega pld_documento_para_descarga, que deja el evento. Nunca se borra (61ª).';

CREATE TABLE pld_propuestas (
  id uuid PRIMARY KEY,
  caso_id uuid NOT NULL REFERENCES pld_casos (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  propuesta text NOT NULL,
  justificacion text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_propuestas_propuesta CHECK (propuesta IN ('reportar_inusual', 'reportar_interna', 'no_reportar')),
  CONSTRAINT pld_propuestas_justificacion CHECK (texto_regulado(justificacion, 4000) AND char_length(justificacion) >= 10)
);

CREATE INDEX pld_propuestas_caso_idx ON pld_propuestas (caso_id, registrado_en DESC);

-- 60ª: lo que la persona del contexto no ve por un aviso que la excluye (como
-- persona mencionada o como superior de quien avisa):
--   · los casos con una alerta de ese aviso;
--   · las alertas de ese aviso y las demás alertas de esos casos (r2-base-N3: verla
--     «sin caso» y no poder abrirle uno delataba el caso);
--   · el aviso mismo y los avisos cuyas alertas quedaron en esos casos.
-- Cada función devuelve el conjunto completo. Las políticas lo leen como
-- (SELECT …), que Postgres calcula una sola vez por consulta (InitPlan), y no una
-- función por renglón (r2-base-N10: 2.2 s con 19,000 alertas analizadas). Sin
-- exclusiones, cada una es una búsqueda vacía en pld_aviso_excluidos_persona.
CREATE INDEX pld_aviso_excluidos_persona ON pld_aviso_excluidos (user_id, aviso_id);

CREATE FUNCTION pld_casos_que_me_excluyen()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT ca.caso_id), '{}')
  FROM pld_aviso_excluidos e
  JOIN pld_alertas x ON x.aviso_id = e.aviso_id
  JOIN pld_caso_alertas ca ON ca.alerta_id = x.id
  WHERE e.user_id = app_usuario()
$$;

CREATE FUNCTION pld_alertas_que_me_excluyen()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT z.id), '{}')
  FROM (
    SELECT x.id FROM pld_aviso_excluidos e JOIN pld_alertas x ON x.aviso_id = e.aviso_id WHERE e.user_id = app_usuario()
    UNION ALL
    SELECT ca.alerta_id FROM pld_caso_alertas ca WHERE ca.caso_id = ANY ((SELECT pld_casos_que_me_excluyen())::uuid[])
  ) AS z
$$;

CREATE FUNCTION pld_avisos_que_me_excluyen()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT z.aviso_id), '{}')
  FROM (
    SELECT e.aviso_id FROM pld_aviso_excluidos e WHERE e.user_id = app_usuario()
    UNION ALL
    SELECT a.aviso_id FROM pld_alertas a WHERE a.aviso_id IS NOT NULL AND a.id = ANY ((SELECT pld_alertas_que_me_excluyen())::uuid[])
  ) AS z
$$;

-- Para una sola fila (descargas, disparadores, plazo del caso).
CREATE FUNCTION pld_caso_me_excluye(p_caso uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_caso = ANY (pld_casos_que_me_excluyen())
$$;

CREATE FUNCTION pld_alerta_me_excluye(p_alerta uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_alerta = ANY (pld_alertas_que_me_excluyen())
$$;

CREATE FUNCTION pld_aviso_me_excluye(p_aviso uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_aviso = ANY (pld_avisos_que_me_excluyen())
$$;

REVOKE ALL ON FUNCTION pld_casos_que_me_excluyen(), pld_alertas_que_me_excluyen(), pld_avisos_que_me_excluyen(),
  pld_caso_me_excluye(uuid), pld_alerta_me_excluye(uuid), pld_aviso_me_excluye(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_casos_que_me_excluyen(), pld_alertas_que_me_excluyen(), pld_avisos_que_me_excluyen(),
  pld_caso_me_excluye(uuid), pld_alerta_me_excluye(uuid), pld_aviso_me_excluye(uuid) TO plataforma_sofipo;

-- Plazo del caso: 60 días naturales desde la alerta más antigua («lo que ocurra primero», 40ª).
CREATE FUNCTION pld_caso_vence(p_caso uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Con el rol del personal, solo del operador del contexto y nunca de un caso que
  -- excluye a quien pregunta (60ª). El ajuste «role» es el que fijó SET ROLE: esta
  -- función es SECURITY DEFINER y current_user es la dueña.
  SELECT min(a.vence_el) FROM pld_caso_alertas ca JOIN pld_alertas a ON a.id = ca.alerta_id
  WHERE ca.caso_id = p_caso AND NOT pld_caso_me_excluye(p_caso)
    AND (current_setting('role') <> 'plataforma_sofipo' OR a.operator_id = app_operador())
$$;

REVOKE ALL ON FUNCTION pld_caso_vence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_caso_vence(uuid) TO plataforma_sofipo;

CREATE FUNCTION pld_casos_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_analizar';
    END IF;
    NEW.registrado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_casos_revisar
BEFORE INSERT ON pld_casos
FOR EACH ROW EXECUTE FUNCTION pld_casos_revisar();

-- Un caso nace con al menos una alerta (se revisa al cerrar la transacción).
CREATE FUNCTION pld_casos_con_alerta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pld_caso_alertas ca WHERE ca.caso_id = NEW.id) THEN
    RAISE EXCEPTION 'caso_sin_alertas';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pld_casos_con_alerta
AFTER INSERT ON pld_casos
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pld_casos_con_alerta();

-- Lo que cuelga de un caso: notas, documentos, propuestas, marca de 24 horas y
-- alertas de la serie. Lo escribe Cumplimiento; operador y empresa salen del caso.
CREATE FUNCTION pld_caso_hijo_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  caso pld_casos%ROWTYPE;
  alerta pld_alertas%ROWTYPE;
  votada uuid;
  choque text;
BEGIN
  -- r2-base-N9: el candado del caso, el mismo que toman los votos y el dictamen.
  -- Lo que llega mientras se dictamina espera y ve el dictamen (caso_ya_dictaminado).
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_caso:' || NEW.caso_id::text, 0));
  SELECT * INTO caso FROM pld_casos c WHERE c.id = NEW.caso_id;
  IF caso.id IS NULL THEN
    RAISE EXCEPTION 'caso_no_existe';
  END IF;
  NEW.operator_id := caso.operator_id;
  NEW.company_id := caso.company_id;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(caso.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_analizar';
    END IF;
    NEW.registrado_en := now();
  END IF;
  IF TG_TABLE_NAME IN ('pld_propuestas', 'pld_casos_24h', 'pld_caso_alertas')
    AND EXISTS (SELECT 1 FROM pld_dictamenes d WHERE d.caso_id = NEW.caso_id) THEN
    RAISE EXCEPTION 'caso_ya_dictaminado';
  END IF;
  IF TG_TABLE_NAME = 'pld_caso_alertas' THEN
    SELECT * INTO alerta FROM pld_alertas a WHERE a.id = NEW.alerta_id;
    IF alerta.id IS NULL THEN
      RAISE EXCEPTION 'alerta_no_existe';
    END IF;
    IF alerta.company_id IS DISTINCT FROM caso.company_id OR alerta.operator_id <> caso.operator_id THEN
      RAISE EXCEPTION 'serie_de_otra_empresa';
    END IF;
    -- 60ª (r2-base-N3): el aviso que excluye a alguien que ya trabajó en este caso
    -- no se suma: el caso le desaparecería a media análisis. Abre su propio caso.
    -- r2-fix2-N2: tampoco si excluye a alguien de una sesión que ya votó el caso: la
    -- sesión le desaparecería. Con los candados de esas sesiones, en orden, como los
    -- votos, el acta y el dictamen: lo que llegue a ellas mientras tanto espera.
    IF alerta.aviso_id IS NOT NULL THEN
      FOR votada IN SELECT DISTINCT v.sesion_id FROM pld_votos v WHERE v.caso_id = caso.id ORDER BY 1 LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended('pld_sesion:' || votada::text, 0));
      END LOOP;
      choque := pld_serie_choca(caso.id, alerta.aviso_id);
      IF choque IS NOT NULL THEN
        RAISE EXCEPTION '%', choque;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 8. Quién dictamina, Comité, sesiones y actas ------------------------------------

-- 47ª, último párrafo: con menos de 25 personas al servicio de la entidad no hay
-- Comité obligatorio y sus funciones las ejerce el Oficial de Cumplimiento. Lo
-- decide el operador; sin registro, Comité.
CREATE TABLE pld_modo_dictamen (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  modo text NOT NULL,
  oficial_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  motivo text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_modo_dictamen_modo CHECK (modo IN ('comite', 'oficial')),
  CONSTRAINT pld_modo_dictamen_oficial CHECK ((modo = 'oficial') = (oficial_user_id IS NOT NULL)),
  CONSTRAINT pld_modo_dictamen_motivo CHECK (texto_regulado(motivo, 500) AND char_length(motivo) >= 10)
);

CREATE INDEX pld_modo_dictamen_idx ON pld_modo_dictamen (operator_id, registrado_en DESC);

CREATE FUNCTION pld_modo_dictamen_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_comite';
    END IF;
    NEW.registrado_en := now();
  END IF;
  IF NEW.modo = 'oficial' AND NOT EXISTS (
    SELECT 1 FROM platform_staff s JOIN platform_staff_roles r ON r.operator_id = s.operator_id AND r.user_id = s.user_id
    WHERE s.operator_id = NEW.operator_id AND s.user_id = NEW.oficial_user_id AND s.estado = 'activo' AND r.rol = 'cumplimiento'
  ) THEN
    RAISE EXCEPTION 'oficial_sin_rol_de_cumplimiento';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_modo_dictamen_revisar
BEFORE INSERT ON pld_modo_dictamen
FOR EACH ROW EXECUTE FUNCTION pld_modo_dictamen_revisar();

CREATE FUNCTION pld_modo_vigente(p_operador uuid)
RETURNS TABLE (modo text, oficial_user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(m.modo, 'comite'), m.oficial_user_id
  FROM (SELECT 1) AS uno
  LEFT JOIN LATERAL (
    SELECT x.modo, x.oficial_user_id FROM pld_modo_dictamen x
    WHERE x.operator_id = p_operador ORDER BY x.registrado_en DESC, x.id DESC LIMIT 1
  ) AS m ON true
$$;

REVOKE ALL ON FUNCTION pld_modo_vigente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_modo_vigente(uuid) TO plataforma_sofipo;

-- 46ª-49ª e instructivo de la CNBV (enero de 2024), Apéndice A: los 14 campos del
-- aviso de integración. Mayúsculas, sin acentos ni abreviaturas. Solo inserción:
-- una baja o sustitución es un renglón de pld_comite_bajas (vigente = sin baja).
CREATE TABLE pld_comite_integrantes (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  area text NOT NULL,
  cargo text NOT NULL,
  titularidad text NOT NULL,
  suplente_de uuid REFERENCES pld_comite_integrantes (id) ON DELETE RESTRICT,
  nombres text NOT NULL,
  primer_apellido text NOT NULL,
  segundo_apellido text NOT NULL,
  rfc text NOT NULL,
  curp text NOT NULL,
  cargo_entidad text NOT NULL,
  es_oficial boolean NOT NULL,
  designado_el date NOT NULL,
  certificado text,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_comite_integrantes_cargo CHECK (cargo IN ('PRESIDENTE', 'SECRETARIO', 'INTEGRANTE')),
  CONSTRAINT pld_comite_integrantes_titularidad CHECK (titularidad IN ('TITULAR', 'SUPLENTE')),
  CONSTRAINT pld_comite_integrantes_suplente CHECK ((titularidad = 'SUPLENTE') = (suplente_de IS NOT NULL)),
  CONSTRAINT pld_comite_integrantes_area CHECK (texto_regulado(area, 120) AND area = upper(area) AND pld_sin_invisibles(area)),
  CONSTRAINT pld_comite_integrantes_cargo_entidad CHECK (
    texto_regulado(cargo_entidad, 120) AND cargo_entidad = upper(cargo_entidad) AND pld_sin_invisibles(cargo_entidad)
  ),
  CONSTRAINT pld_comite_integrantes_nombres CHECK (
    nombres ~ '^[A-ZÑ]+( [A-ZÑ]+)*$' AND char_length(nombres) <= 80
    AND primer_apellido ~ '^[A-ZÑ]+( [A-ZÑ]+)*$' AND char_length(primer_apellido) <= 80
    AND segundo_apellido ~ '^[A-ZÑ]+( [A-ZÑ]+)*$' AND char_length(segundo_apellido) <= 80
  ),
  CONSTRAINT pld_comite_integrantes_rfc CHECK (rfc ~ '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT pld_comite_integrantes_curp CHECK (curp ~ '^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9][0-9]$'),
  CONSTRAINT pld_comite_integrantes_certificado CHECK (certificado IS NULL OR certificado ~ '^[A-Z0-9/-]{1,22}$')
);

CREATE TABLE pld_comite_bajas (
  integrante_id uuid PRIMARY KEY REFERENCES pld_comite_integrantes (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  sustituido_el date NOT NULL,
  motivo text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_comite_bajas_motivo CHECK (texto_regulado(motivo, 500) AND char_length(motivo) >= 10)
);

COMMENT ON TABLE pld_comite_integrantes IS
  'Integrantes del Comité de Comunicación y Control (46ª-49ª) con los 14 campos del layout de la CNBV. El auditor no es integrante (47ª).';

-- Integrantes vigentes en un día: designados ese día o antes y sin baja hasta ese día.
CREATE FUNCTION pld_comite_vigentes(p_operador uuid, p_dia date)
RETURNS SETOF pld_comite_integrantes
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT i.* FROM pld_comite_integrantes i
  WHERE i.operator_id = p_operador AND i.designado_el <= p_dia
    AND NOT EXISTS (SELECT 1 FROM pld_comite_bajas b WHERE b.integrante_id = i.id AND b.sustituido_el <= p_dia)
$$;

-- r2-serv-N2 (47ª): el nombre completo de un integrante, comparable con el del auditor
-- (lpb_normalizar de la 0028: sin acentos, mayúsculas y las palabras en orden). «XXXX»
-- es el segundo apellido de quien no lo tiene, no un nombre.
CREATE FUNCTION pld_nombre_de_integrante(i pld_comite_integrantes)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT lpb_normalizar(concat_ws(' ', i.nombres, i.primer_apellido, nullif(i.segundo_apellido, 'XXXX'))) $$;

CREATE FUNCTION pld_comite_integrantes_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  titular pld_comite_integrantes%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_comite:' || NEW.operator_id::text, 0));
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_comite';
    END IF;
    NEW.registrado_en := now();
    IF NEW.designado_el > hoy_mexico() THEN
      RAISE EXCEPTION 'comite_fecha_futura';
    END IF;
  END IF;
  IF NEW.titularidad = 'SUPLENTE' THEN
    SELECT * INTO titular FROM pld_comite_integrantes t WHERE t.id = NEW.suplente_de;
    -- «No puede registrarse un SUPLENTE si no se ha designado un TITULAR» (instructivo, Apéndice A).
    IF titular.id IS NULL OR titular.titularidad <> 'TITULAR' OR titular.operator_id <> NEW.operator_id
      OR titular.cargo <> NEW.cargo
      OR EXISTS (SELECT 1 FROM pld_comite_bajas b WHERE b.integrante_id = titular.id) THEN
      RAISE EXCEPTION 'comite_suplente_sin_titular';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_comite_integrantes_revisar
BEFORE INSERT ON pld_comite_integrantes
FOR EACH ROW EXECUTE FUNCTION pld_comite_integrantes_revisar();

CREATE FUNCTION pld_comite_bajas_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  integrante pld_comite_integrantes%ROWTYPE;
BEGIN
  SELECT * INTO integrante FROM pld_comite_integrantes i WHERE i.id = NEW.integrante_id;
  IF integrante.id IS NULL THEN
    RAISE EXCEPTION 'comite_integrante_no_existe';
  END IF;
  NEW.operator_id := integrante.operator_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_comite:' || NEW.operator_id::text, 0));
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_comite';
    END IF;
    NEW.registrado_en := now();
    IF NEW.sustituido_el > hoy_mexico() THEN
      RAISE EXCEPTION 'comite_fecha_futura';
    END IF;
  END IF;
  -- Apéndice A, campo 13: la fecha de sustitución es mayor a la de designación.
  IF NEW.sustituido_el <= integrante.designado_el THEN
    RAISE EXCEPTION 'comite_sustitucion_antes_de_designacion';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_comite_bajas_revisar
BEFORE INSERT ON pld_comite_bajas
FOR EACH ROW EXECUTE FUNCTION pld_comite_bajas_revisar();

-- Al cerrar la transacción, la integración vigente cumple la 47ª y el instructivo:
-- al menos tres titulares, un solo presidente y un solo secretario titulares, como
-- máximo un suplente por titular, ningún suplente sin titular y el Oficial de
-- Cumplimiento como integrante. Sin integrantes vigentes no se revisa nada.
CREATE FUNCTION pld_comite_validar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  operador uuid := NEW.operator_id;
  vigentes integer;
  auditor_rfc text;
  auditor_curp text;
  auditor_nombre text;
BEGIN
  SELECT count(*) INTO vigentes FROM pld_comite_vigentes(operador, 'infinity'::date);
  IF vigentes = 0 THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM pld_comite_vigentes(operador, 'infinity'::date) v WHERE v.cargo = 'PRESIDENTE' AND v.titularidad = 'TITULAR') <> 1 THEN
    RAISE EXCEPTION 'comite_presidente_unico';
  END IF;
  IF (SELECT count(*) FROM pld_comite_vigentes(operador, 'infinity'::date) v WHERE v.cargo = 'SECRETARIO' AND v.titularidad = 'TITULAR') <> 1 THEN
    RAISE EXCEPTION 'comite_secretario_unico';
  END IF;
  IF (SELECT count(*) FROM pld_comite_vigentes(operador, 'infinity'::date) v WHERE v.titularidad = 'TITULAR') < 3 THEN
    RAISE EXCEPTION 'comite_minimo_tres_titulares';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pld_comite_vigentes(operador, 'infinity'::date) v WHERE v.titularidad = 'SUPLENTE'
    GROUP BY v.suplente_de HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'comite_un_suplente_por_titular';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pld_comite_vigentes(operador, 'infinity'::date) s
    WHERE s.titularidad = 'SUPLENTE'
      AND NOT EXISTS (SELECT 1 FROM pld_comite_vigentes(operador, 'infinity'::date) t WHERE t.id = s.suplente_de)
  ) THEN
    RAISE EXCEPTION 'comite_suplente_sin_titular';
  END IF;
  IF (SELECT count(*) FROM pld_comite_vigentes(operador, 'infinity'::date) v WHERE v.es_oficial) <> 1 THEN
    RAISE EXCEPTION 'comite_sin_oficial';
  END IF;
  -- r2-base-N5: una persona ocupa un solo lugar. Con el mismo RFC o la misma CURP
  -- valdría por varios titulares y haría quórum sola.
  IF EXISTS (SELECT 1 FROM pld_comite_vigentes(operador, 'infinity'::date) v GROUP BY v.rfc HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM pld_comite_vigentes(operador, 'infinity'::date) v GROUP BY v.curp HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'comite_persona_repetida';
  END IF;
  -- 47ª: el auditor interno no forma parte del Comité; el vigente es el último registrado.
  SELECT a.rfc, a.curp, a.nombre INTO auditor_rfc, auditor_curp, auditor_nombre
  FROM pld_comite_auditores a WHERE a.operator_id = operador ORDER BY a.registrado_en DESC, a.id DESC LIMIT 1;
  IF auditor_rfc IS NOT NULL AND EXISTS (
    SELECT 1 FROM pld_comite_vigentes(operador, 'infinity'::date) v
    WHERE v.rfc = auditor_rfc OR v.curp = auditor_curp OR pld_nombre_de_integrante(v) = lpb_normalizar(auditor_nombre)
  ) THEN
    RAISE EXCEPTION 'comite_auditor_integrante';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pld_comite_integrantes_validar
AFTER INSERT ON pld_comite_integrantes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pld_comite_validar();
CREATE CONSTRAINT TRIGGER pld_comite_bajas_validar
AFTER INSERT ON pld_comite_bajas
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pld_comite_validar();

-- 47ª: «El auditor interno […] no formará parte del Comité […] participará con voz,
-- pero sin voto». Va aparte: no cuenta para el quórum ni se comunica en la 49ª.
-- Vale el último registrado.
CREATE TABLE pld_comite_auditores (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  cargo_entidad text NOT NULL,
  -- Con qué compararlo contra los integrantes: el auditor no es integrante (r2-base-N5).
  rfc text NOT NULL,
  curp text NOT NULL,
  designado_el date NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_comite_auditores_textos CHECK (
    texto_regulado(nombre, 200) AND texto_regulado(cargo_entidad, 120) AND pld_sin_invisibles(nombre) AND pld_sin_invisibles(cargo_entidad)
  ),
  CONSTRAINT pld_comite_auditores_rfc CHECK (rfc ~ '^[A-Z&Ñ]{4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT pld_comite_auditores_curp CHECK (curp ~ '^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9][0-9]$')
);

-- 49ª: la designación, adición o sustitución se comunica «dentro de los quince días
-- hábiles siguientes a la fecha en que se haya realizado». Cada comunicación anota
-- su acuse del SITI y qué designaciones y bajas cubre. El pendiente se calcula al leer.
CREATE TABLE pld_comite_comunicaciones (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  folio text NOT NULL,
  recibido_en timestamptz NOT NULL,
  integrantes uuid[] NOT NULL,
  bajas uuid[] NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_comite_comunicaciones_folio CHECK (texto_regulado(folio, 40) AND pld_sin_invisibles(folio)),
  CONSTRAINT pld_comite_comunicaciones_folio_unico UNIQUE (operator_id, folio),
  CONSTRAINT pld_comite_comunicaciones_cubre CHECK (cardinality(integrantes) + cardinality(bajas) >= 1)
);

-- 47ª y 48ª: la sesión es válida con la mayoría de los miembros; un suplente
-- presente representa a su titular ausente. Miembros, representados, quórum y
-- quién preside los calcula la base. Sin quórum queda registrada y no admite votos.
CREATE TABLE pld_sesiones (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  celebrada_el date NOT NULL,
  presentes uuid[] NOT NULL,
  auditor_id uuid REFERENCES pld_comite_auditores (id) ON DELETE RESTRICT,
  miembros integer NOT NULL DEFAULT 0,
  representados integer NOT NULL DEFAULT 0,
  quorum boolean NOT NULL DEFAULT false,
  presidente_id uuid REFERENCES pld_comite_integrantes (id) ON DELETE RESTRICT,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pld_sesiones_operador_idx ON pld_sesiones (operator_id, celebrada_el DESC);

COMMENT ON TABLE pld_sesiones IS
  'Sesiones del Comité (47ª: al menos una al mes; quórum con la mayoría de los miembros). Solo inserción.';

CREATE FUNCTION pld_sesiones_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  modo text;
  ajenos integer;
BEGIN
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_comite';
    END IF;
    NEW.registrado_en := now();
    IF NEW.celebrada_el > hoy_mexico() THEN
      RAISE EXCEPTION 'sesion_fecha_futura';
    END IF;
  END IF;
  SELECT m.modo INTO modo FROM pld_modo_vigente(NEW.operator_id) m;
  IF modo <> 'comite' THEN
    RAISE EXCEPTION 'modo_oficial_sin_sesiones';
  END IF;
  IF NEW.presentes IS NULL OR cardinality(NEW.presentes) = 0
    OR cardinality(NEW.presentes) <> (SELECT count(DISTINCT x) FROM unnest(NEW.presentes) AS x) THEN
    RAISE EXCEPTION 'sesion_presentes_invalidos';
  END IF;
  SELECT count(*) INTO ajenos FROM unnest(NEW.presentes) AS x
  WHERE NOT EXISTS (SELECT 1 FROM pld_comite_vigentes(NEW.operator_id, NEW.celebrada_el) v WHERE v.id = x);
  IF ajenos > 0 THEN
    RAISE EXCEPTION 'sesion_presentes_invalidos';
  END IF;
  IF NEW.auditor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pld_comite_auditores a WHERE a.id = NEW.auditor_id AND a.operator_id = NEW.operator_id
  ) THEN
    RAISE EXCEPTION 'sesion_auditor_invalido';
  END IF;
  SELECT count(*) INTO NEW.miembros
  FROM pld_comite_vigentes(NEW.operator_id, NEW.celebrada_el) t WHERE t.titularidad = 'TITULAR';
  SELECT count(*) INTO NEW.representados
  FROM pld_comite_vigentes(NEW.operator_id, NEW.celebrada_el) t
  WHERE t.titularidad = 'TITULAR' AND (
    t.id = ANY (NEW.presentes)
    OR EXISTS (
      SELECT 1 FROM pld_comite_vigentes(NEW.operator_id, NEW.celebrada_el) s
      WHERE s.suplente_de = t.id AND s.id = ANY (NEW.presentes)
    )
  );
  -- 47ª: «se requerirá que se encuentre presente la mayoría de los miembros».
  NEW.quorum := NEW.miembros >= 3 AND NEW.representados * 2 > NEW.miembros;
  -- Preside el presidente titular; si falta, su suplente.
  SELECT coalesce(
    (SELECT t.id FROM pld_comite_vigentes(NEW.operator_id, NEW.celebrada_el) t
     WHERE t.cargo = 'PRESIDENTE' AND t.titularidad = 'TITULAR' AND t.id = ANY (NEW.presentes)),
    (SELECT s.id FROM pld_comite_vigentes(NEW.operator_id, NEW.celebrada_el) s
     WHERE s.cargo = 'PRESIDENTE' AND s.titularidad = 'SUPLENTE' AND s.id = ANY (NEW.presentes))
  ) INTO NEW.presidente_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_sesiones_revisar
BEFORE INSERT ON pld_sesiones
FOR EACH ROW EXECUTE FUNCTION pld_sesiones_revisar();

-- 48ª: decide el voto favorable de la mayoría de los miembros presentes; en
-- empate, el presidente tiene voto de calidad. Se vota la propuesta del caso.
CREATE TABLE pld_votos (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  sesion_id uuid NOT NULL REFERENCES pld_sesiones (id) ON DELETE RESTRICT,
  caso_id uuid NOT NULL REFERENCES pld_casos (id) ON DELETE RESTRICT,
  propuesta_id uuid NOT NULL REFERENCES pld_propuestas (id) ON DELETE RESTRICT,
  integrante_id uuid NOT NULL REFERENCES pld_comite_integrantes (id) ON DELETE RESTRICT,
  voto text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_votos_voto CHECK (voto IN ('a_favor', 'en_contra')),
  CONSTRAINT pld_votos_uno_por_miembro UNIQUE (sesion_id, propuesta_id, integrante_id)
);

CREATE FUNCTION pld_votos_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sesion pld_sesiones%ROWTYPE;
  integrante pld_comite_integrantes%ROWTYPE;
  propuesta pld_propuestas%ROWTYPE;
  caso pld_casos%ROWTYPE;
  choque text;
BEGIN
  SELECT * INTO sesion FROM pld_sesiones s WHERE s.id = NEW.sesion_id;
  IF sesion.id IS NULL THEN
    RAISE EXCEPTION 'sesion_no_existe';
  END IF;
  IF NOT sesion.quorum THEN
    RAISE EXCEPTION 'sesion_sin_quorum';
  END IF;
  SELECT * INTO propuesta FROM pld_propuestas p WHERE p.id = NEW.propuesta_id;
  SELECT * INTO caso FROM pld_casos c WHERE c.id = propuesta.caso_id;
  IF propuesta.id IS NULL OR caso.id IS NULL THEN
    RAISE EXCEPTION 'caso_no_existe';
  END IF;
  -- r2-base-N9: el candado del caso antes de revisar el dictamen y la propuesta vigente.
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_caso:' || caso.id::text, 0));
  -- r2-fix-N1 (48ª): el acta firmada cierra la sesión; un voto posterior no estaría en
  -- ella. Con el candado de la sesión, como la carga del acta: no se cruzan.
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_sesion:' || sesion.id::text, 0));
  IF EXISTS (SELECT 1 FROM pld_actas a WHERE a.sesion_id = sesion.id) THEN
    RAISE EXCEPTION 'sesion_con_acta';
  END IF;
  -- r2-fix2-N2 (60ª): ningún caso entra a una sesión de alguien a quien excluye. Con el
  -- candado de la sesión: otro voto, el acta, el dictamen o la suma de un aviso a la
  -- serie esperan y lo ven.
  choque := pld_voto_choca(sesion.id, caso.id, NEW.registrado_por);
  IF choque IS NOT NULL THEN
    RAISE EXCEPTION '%', choque;
  END IF;
  NEW.caso_id := caso.id;
  NEW.operator_id := sesion.operator_id;
  NEW.company_id := caso.company_id;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(sesion.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_comite';
    END IF;
    NEW.registrado_en := now();
  END IF;
  IF EXISTS (SELECT 1 FROM pld_dictamenes d WHERE d.caso_id = caso.id) THEN
    RAISE EXCEPTION 'caso_ya_dictaminado';
  END IF;
  -- Se vota la propuesta vigente del caso.
  IF propuesta.id <> (SELECT p.id FROM pld_propuestas p WHERE p.caso_id = caso.id ORDER BY p.registrado_en DESC, p.id DESC LIMIT 1) THEN
    RAISE EXCEPTION 'propuesta_no_vigente';
  END IF;
  -- Una sesión no vota lo que aún no existía el día en que se celebró: el dictamen
  -- toma la fecha de la sesión (40ª) y no puede ser anterior a la propuesta.
  IF pld_fecha_mx(propuesta.registrado_en) > sesion.celebrada_el THEN
    RAISE EXCEPTION 'propuesta_posterior_a_la_sesion';
  END IF;
  IF NOT NEW.integrante_id = ANY (sesion.presentes) THEN
    RAISE EXCEPTION 'voto_de_ausente';
  END IF;
  SELECT * INTO integrante FROM pld_comite_integrantes i WHERE i.id = NEW.integrante_id;
  -- 47ª: el suplente solo representa a su titular cuando éste falta.
  IF integrante.titularidad = 'SUPLENTE' AND integrante.suplente_de = ANY (sesion.presentes) THEN
    RAISE EXCEPTION 'suplente_con_titular_presente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_votos_revisar
BEFORE INSERT ON pld_votos
FOR EACH ROW EXECUTE FUNCTION pld_votos_revisar();

-- Resultado de la votación de una propuesta en una sesión: «aprobada» con el voto
-- favorable de la mayoría de los presentes con voto, «rechazada» con la mayoría en
-- contra, y en empate con todos los votos emitidos decide el presidente. Sin
-- mayoría ni empate completo, NULL (la votación no ha terminado).
CREATE FUNCTION pld_resultado_votacion(p_sesion uuid, p_propuesta uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  sesion pld_sesiones%ROWTYPE;
  favor integer;
  contra integer;
  del_presidente text;
BEGIN
  SELECT * INTO sesion FROM pld_sesiones s WHERE s.id = p_sesion;
  IF sesion.id IS NULL OR NOT sesion.quorum THEN
    RETURN NULL;
  END IF;
  SELECT count(*) FILTER (WHERE v.voto = 'a_favor'), count(*) FILTER (WHERE v.voto = 'en_contra')
  INTO favor, contra
  FROM pld_votos v WHERE v.sesion_id = p_sesion AND v.propuesta_id = p_propuesta;
  IF favor * 2 > sesion.representados THEN
    RETURN 'aprobada';
  END IF;
  IF contra * 2 > sesion.representados THEN
    RETURN 'rechazada';
  END IF;
  IF favor = contra AND favor + contra = sesion.representados AND favor > 0 THEN
    SELECT v.voto INTO del_presidente FROM pld_votos v
    WHERE v.sesion_id = p_sesion AND v.propuesta_id = p_propuesta AND v.integrante_id = sesion.presidente_id;
    RETURN CASE del_presidente WHEN 'a_favor' THEN 'aprobada' WHEN 'en_contra' THEN 'rechazada' END;
  END IF;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION pld_resultado_votacion(uuid, uuid) TO plataforma_sofipo;

-- 48ª: «De cada sesión se levantará un acta […] firmadas por el presidente y el
-- secretario». Lever genera el acta; aquí queda la firmada, con su SHA-256.
CREATE TABLE pld_actas (
  id uuid PRIMARY KEY,
  sesion_id uuid NOT NULL REFERENCES pld_sesiones (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  nombre_archivo text NOT NULL,
  tipo_contenido text NOT NULL,
  tamano_bytes integer NOT NULL,
  sha256 text NOT NULL,
  clave_blob text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_actas_una_por_sesion UNIQUE (sesion_id),
  CONSTRAINT pld_actas_contenido CHECK (tipo_contenido IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT pld_actas_tamano CHECK (tamano_bytes BETWEEN 1 AND 4194304),
  CONSTRAINT pld_actas_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pld_actas_textos CHECK (texto_regulado(nombre_archivo, 200) AND texto_regulado(clave_blob, 512))
);

CREATE FUNCTION pld_operador_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sesion pld_sesiones%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'pld_actas' THEN
    -- r2-fix-N1: la sesión que votó un caso que excluye a quien sube no existe para
    -- esa persona (su RLS la oculta): sesion_no_existe, como una inexistente.
    SELECT * INTO sesion FROM pld_sesiones s WHERE s.id = NEW.sesion_id;
    IF sesion.id IS NULL THEN
      RAISE EXCEPTION 'sesion_no_existe';
    END IF;
    -- El candado de la sesión, como los votos: el acta llega con la votación completa.
    PERFORM pg_advisory_xact_lock(hashtextextended('pld_sesion:' || sesion.id::text, 0));
    -- r2-fix2-N2: un voto que la ocultó mientras esperaba el candado ya está confirmado;
    -- la RLS de esta sentencia se leyó antes de esperarlo.
    IF pld_sesion_excluye_a(sesion.id, NEW.registrado_por) THEN
      RAISE EXCEPTION 'sesion_no_existe';
    END IF;
    NEW.operator_id := sesion.operator_id;
  END IF;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario() OR NEW.operator_id IS DISTINCT FROM app_operador()
      OR NOT personal_tiene_rol(NEW.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_comite';
    END IF;
    NEW.registrado_en := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_actas_revisar
BEFORE INSERT ON pld_actas
FOR EACH ROW EXECUTE FUNCTION pld_operador_revisar();
CREATE TRIGGER pld_comite_auditores_revisar
BEFORE INSERT ON pld_comite_auditores
FOR EACH ROW EXECUTE FUNCTION pld_operador_revisar();

-- 47ª (r2-base-N5): el auditor no es un integrante vigente. Con el candado del
-- Comité, como las altas y bajas: una alta en curso termina antes de comparar.
-- Corre después de pld_comite_auditores_revisar (orden alfabético), ya con el
-- operador revisado.
CREATE FUNCTION pld_comite_auditores_sin_integrante()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_comite:' || NEW.operator_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM pld_comite_vigentes(NEW.operator_id, 'infinity'::date) v
    WHERE v.rfc = NEW.rfc OR v.curp = NEW.curp OR pld_nombre_de_integrante(v) = lpb_normalizar(NEW.nombre)
  ) THEN
    RAISE EXCEPTION 'comite_auditor_integrante';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_comite_auditores_sin_integrante
BEFORE INSERT ON pld_comite_auditores
FOR EACH ROW EXECUTE FUNCTION pld_comite_auditores_sin_integrante();

CREATE FUNCTION pld_comite_comunicaciones_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.recibido_en > now() THEN
    RAISE EXCEPTION 'acuse_fecha_futura';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.integrantes) AS x
    WHERE NOT EXISTS (SELECT 1 FROM pld_comite_integrantes i WHERE i.id = x AND i.operator_id = NEW.operator_id)
  ) OR EXISTS (
    SELECT 1 FROM unnest(NEW.bajas) AS x
    WHERE NOT EXISTS (SELECT 1 FROM pld_comite_bajas b WHERE b.integrante_id = x AND b.operator_id = NEW.operator_id)
  ) THEN
    RAISE EXCEPTION 'comunicacion_cubre_ajenos';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_comite_comunicaciones_revisar
BEFORE INSERT ON pld_comite_comunicaciones
FOR EACH ROW EXECUTE FUNCTION pld_comite_comunicaciones_revisar();
CREATE TRIGGER pld_comite_comunicaciones_autor
BEFORE INSERT ON pld_comite_comunicaciones
FOR EACH ROW EXECUTE FUNCTION pld_operador_revisar();

-- 9. Dictamen y reporte -------------------------------------------------------------

-- 40ª y 45ª: el dictamen dentro de 60 días naturales y el reporte dentro de los
-- 3 días hábiles siguientes al día en que concluye la sesión. Un dictamen tardío
-- se registra marcado «fuera de plazo»: impedirlo escondería el incumplimiento.
CREATE TABLE pld_dictamenes (
  id uuid PRIMARY KEY,
  caso_id uuid NOT NULL REFERENCES pld_casos (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  resultado text NOT NULL,
  justificacion text NOT NULL,
  via text NOT NULL,
  sesion_id uuid REFERENCES pld_sesiones (id) ON DELETE RESTRICT,
  propuesta_id uuid REFERENCES pld_propuestas (id) ON DELETE RESTRICT,
  dictaminado_el date NOT NULL DEFAULT hoy_mexico(),
  vence_el date,
  vence_en timestamptz,
  fuera_de_plazo boolean NOT NULL DEFAULT false,
  reporte_vence_el date,
  reporte_vence_en timestamptz,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_dictamenes_uno_por_caso UNIQUE (caso_id),
  CONSTRAINT pld_dictamenes_resultado CHECK (resultado IN ('reportar_inusual', 'reportar_interna', 'no_reportar')),
  CONSTRAINT pld_dictamenes_justificacion CHECK (texto_regulado(justificacion, 4000) AND char_length(justificacion) >= 10),
  CONSTRAINT pld_dictamenes_via CHECK (
    (via = 'comite' AND sesion_id IS NOT NULL AND propuesta_id IS NOT NULL)
    OR (via = 'oficial' AND sesion_id IS NULL)
  )
);

CREATE INDEX pld_dictamenes_operador_idx ON pld_dictamenes (operator_id, dictaminado_el);

CREATE FUNCTION pld_dictamenes_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  caso pld_casos%ROWTYPE;
  vigente record;
  sesion pld_sesiones%ROWTYPE;
  propuesta pld_propuestas%ROWTYPE;
  marca pld_casos_24h%ROWTYPE;
BEGIN
  -- r2-base-N9: el candado del caso; las alertas, propuestas, marcas y votos que
  -- lleguen mientras tanto esperan y ven este dictamen.
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_caso:' || NEW.caso_id::text, 0));
  SELECT * INTO caso FROM pld_casos c WHERE c.id = NEW.caso_id;
  IF caso.id IS NULL THEN
    RAISE EXCEPTION 'caso_no_existe';
  END IF;
  NEW.operator_id := caso.operator_id;
  NEW.company_id := caso.company_id;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(caso.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_dictaminar';
    END IF;
    NEW.registrado_en := now();
    NEW.dictaminado_el := hoy_mexico();
  END IF;
  SELECT * INTO vigente FROM pld_modo_vigente(caso.operator_id);
  IF NEW.via <> vigente.modo THEN
    RAISE EXCEPTION 'dictamen_en_otro_modo';
  END IF;
  IF NEW.via = 'oficial' THEN
    -- 47ª, último párrafo: en este modo dictamina el Oficial de Cumplimiento.
    IF current_user = 'plataforma_sofipo' AND NEW.registrado_por IS DISTINCT FROM vigente.oficial_user_id THEN
      RAISE EXCEPTION 'solo_el_oficial_dictamina';
    END IF;
  ELSE
    SELECT * INTO sesion FROM pld_sesiones s WHERE s.id = NEW.sesion_id AND s.operator_id = caso.operator_id;
    -- r2-fix2-N2: la sesión que no ve quien dictamina no existe para esa persona, como
    -- con el acta (r2-fix-N1). Con el candado de la sesión, como los votos y el acta: un
    -- voto que la oculta mientras tanto ya está confirmado al revisar.
    IF sesion.id IS NULL THEN
      RAISE EXCEPTION 'sesion_no_existe';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('pld_sesion:' || sesion.id::text, 0));
    IF pld_sesion_excluye_a(sesion.id, NEW.registrado_por) THEN
      RAISE EXCEPTION 'sesion_no_existe';
    END IF;
    IF NOT sesion.quorum THEN
      RAISE EXCEPTION 'sesion_sin_quorum';
    END IF;
    SELECT * INTO propuesta FROM pld_propuestas p WHERE p.id = NEW.propuesta_id AND p.caso_id = caso.id;
    IF propuesta.id IS NULL THEN
      RAISE EXCEPTION 'propuesta_no_vigente';
    END IF;
    IF pld_resultado_votacion(sesion.id, propuesta.id) IS DISTINCT FROM 'aprobada' THEN
      RAISE EXCEPTION 'dictamen_sin_votacion_aprobada';
    END IF;
    NEW.resultado := propuesta.propuesta;
    -- El día en que concluye la sesión del Comité que lo dictamina (40ª).
    NEW.dictaminado_el := sesion.celebrada_el;
  END IF;
  SELECT * INTO marca FROM pld_casos_24h m WHERE m.caso_id = caso.id;
  IF marca.caso_id IS NOT NULL THEN
    -- 44ª: 24 horas desde que se conoce la información.
    NEW.vence_en := marca.registrado_en + interval '24 hours';
    NEW.fuera_de_plazo := now() > NEW.vence_en;
    IF NEW.resultado <> 'no_reportar' THEN
      NEW.reporte_vence_en := NEW.vence_en;
    END IF;
  ELSE
    NEW.vence_el := pld_caso_vence(caso.id);
    NEW.fuera_de_plazo := NEW.dictaminado_el > NEW.vence_el;
    -- r2-base-N6 (40ª): la fecha de la sesión manda para el dictamen y los 3 días
    -- hábiles, pero si la sesión o sus votos se registraron en Lever después del
    -- vencimiento, el dictamen queda marcado: una sesión con fecha atrasada no
    -- esconde el incumplimiento.
    IF NEW.via = 'comite' AND (
      pld_fecha_mx(sesion.registrado_en) > NEW.vence_el
      OR pld_fecha_mx((SELECT max(v.registrado_en) FROM pld_votos v WHERE v.sesion_id = sesion.id AND v.propuesta_id = propuesta.id)) > NEW.vence_el
    ) THEN
      NEW.fuera_de_plazo := true;
    END IF;
    IF NEW.resultado <> 'no_reportar' THEN
      NEW.reporte_vence_el := pld_sumar_dias_habiles(NEW.dictaminado_el, 3);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_dictamenes_revisar
BEFORE INSERT ON pld_dictamenes
FOR EACH ROW EXECUTE FUNCTION pld_dictamenes_revisar();

-- Acuse del SITI (art. 4 de la resolución de 2004): folio, tipo de reporte,
-- periodo, fecha y hora de recepción y número de registros. «No podrá ser
-- modificada»: el registro es inmutable.
CREATE TABLE pld_reportes (
  id uuid PRIMARY KEY,
  caso_id uuid NOT NULL REFERENCES pld_casos (id) ON DELETE RESTRICT,
  dictamen_id uuid NOT NULL REFERENCES pld_dictamenes (id) ON DELETE RESTRICT,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  company_id uuid,
  tipo_reporte text NOT NULL,
  folio text NOT NULL,
  periodo text NOT NULL,
  recibido_en timestamptz NOT NULL,
  registros integer NOT NULL,
  fuera_de_plazo boolean NOT NULL DEFAULT false,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_reportes_uno_por_caso UNIQUE (caso_id),
  CONSTRAINT pld_reportes_tipo CHECK (tipo_reporte IN ('2', '3')),
  CONSTRAINT pld_reportes_folio CHECK (texto_regulado(folio, 40) AND pld_sin_invisibles(folio)),
  CONSTRAINT pld_reportes_periodo CHECK (periodo ~ '^[0-9]{8}$'),
  CONSTRAINT pld_reportes_registros CHECK (registros BETWEEN 1 AND 100000)
);

CREATE FUNCTION pld_reportes_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  dictamen pld_dictamenes%ROWTYPE;
BEGIN
  SELECT * INTO dictamen FROM pld_dictamenes d WHERE d.caso_id = NEW.caso_id;
  IF dictamen.id IS NULL OR dictamen.resultado = 'no_reportar' THEN
    RAISE EXCEPTION 'reporte_sin_dictamen_de_reportar';
  END IF;
  NEW.dictamen_id := dictamen.id;
  NEW.operator_id := dictamen.operator_id;
  NEW.company_id := dictamen.company_id;
  -- Formato oficial, columna 1: 2 = Inusual, 3 = Preocupante.
  NEW.tipo_reporte := CASE dictamen.resultado WHEN 'reportar_inusual' THEN '2' ELSE '3' END;
  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.registrado_por IS DISTINCT FROM app_usuario()
      OR NOT personal_tiene_rol(dictamen.operator_id, NEW.registrado_por, ARRAY['cumplimiento']) THEN
      RAISE EXCEPTION 'sin_rol_para_reportar';
    END IF;
    NEW.registrado_en := now();
  END IF;
  IF NEW.recibido_en > now() THEN
    RAISE EXCEPTION 'acuse_fecha_futura';
  END IF;
  -- El reporte se presenta después de decidir reportarlo, nunca antes.
  IF pld_fecha_mx(NEW.recibido_en) < dictamen.dictaminado_el THEN
    RAISE EXCEPTION 'acuse_antes_del_dictamen';
  END IF;
  NEW.fuera_de_plazo := CASE
    WHEN dictamen.reporte_vence_en IS NOT NULL THEN NEW.recibido_en > dictamen.reporte_vence_en
    ELSE pld_fecha_mx(NEW.recibido_en) > dictamen.reporte_vence_el
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_reportes_revisar
BEFORE INSERT ON pld_reportes
FOR EACH ROW EXECUTE FUNCTION pld_reportes_revisar();

-- 10. Clave de la entidad y reportes periódicos ----------------------------------

-- Formato oficial, columnas 4 y 5: clave CASFIM del órgano supervisor y de la
-- entidad, de 6 dígitos sin guion y con un 0 al inicio. La clave de acceso al
-- SITI es personal del Oficial (72ª-1): Lever no tiene dónde guardarla. Vale el
-- último registro.
CREATE TABLE pld_entidad (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  clave_casfim text NOT NULL,
  clave_organo_supervisor text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_entidad_claves CHECK (clave_casfim ~ '^[0-9]{6}$' AND clave_organo_supervisor ~ '^[0-9]{6}$')
);

CREATE TRIGGER pld_entidad_revisar
BEFORE INSERT ON pld_entidad
FOR EACH ROW EXECUTE FUNCTION pld_operador_revisar();

-- 36ª: reporte trimestral de Relevantes (periodo AAAAMM, último mes del trimestre)
-- con su acuse del SITI. 38ª: constancia interna mensual en ceros (sin formato
-- público para SOFIPO), sin folio. Uno por reporte y periodo.
CREATE TABLE pld_periodicos (
  id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE RESTRICT,
  reporte text NOT NULL,
  periodo text NOT NULL,
  archivo_sha256 text NOT NULL,
  registros integer NOT NULL,
  folio text,
  recibido_en timestamptz,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pld_periodicos_unico UNIQUE (operator_id, reporte, periodo),
  CONSTRAINT pld_periodicos_reporte CHECK (reporte IN ('36', '38')),
  CONSTRAINT pld_periodicos_periodo CHECK (
    periodo ~ '^20[0-9]{2}(0[1-9]|1[0-2])$' AND (reporte <> '36' OR right(periodo, 2) IN ('03', '06', '09', '12'))
  ),
  CONSTRAINT pld_periodicos_sha256 CHECK (archivo_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pld_periodicos_registros CHECK (registros BETWEEN 0 AND 100000),
  CONSTRAINT pld_periodicos_acuse CHECK (
    (reporte = '36' AND folio IS NOT NULL AND texto_regulado(folio, 40) AND pld_sin_invisibles(folio) AND recibido_en IS NOT NULL)
    OR (reporte = '38' AND folio IS NULL AND recibido_en IS NULL)
  )
);

CREATE FUNCTION pld_periodicos_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  fin date := (to_date(NEW.periodo, 'YYYYMM') + interval '1 month - 1 day')::date;
BEGIN
  -- Un periodo se reporta cuando ya cerró: el trimestre o el mes completo.
  IF hoy_mexico() <= fin THEN
    RAISE EXCEPTION 'periodo_sin_cerrar';
  END IF;
  IF NEW.recibido_en IS NOT NULL AND NEW.recibido_en > now() THEN
    RAISE EXCEPTION 'acuse_fecha_futura';
  END IF;
  IF NEW.recibido_en IS NOT NULL AND pld_fecha_mx(NEW.recibido_en) <= fin THEN
    RAISE EXCEPTION 'acuse_antes_del_cierre';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pld_periodicos_revisar
BEFORE INSERT ON pld_periodicos
FOR EACH ROW EXECUTE FUNCTION pld_periodicos_revisar();
CREATE TRIGGER pld_periodicos_autor
BEFORE INSERT ON pld_periodicos
FOR EACH ROW EXECUTE FUNCTION pld_operador_revisar();

-- Triggers de lo que cuelga de un caso.
CREATE TRIGGER pld_caso_alertas_revisar BEFORE INSERT ON pld_caso_alertas
FOR EACH ROW EXECUTE FUNCTION pld_caso_hijo_revisar();
CREATE TRIGGER pld_casos_24h_revisar BEFORE INSERT ON pld_casos_24h
FOR EACH ROW EXECUTE FUNCTION pld_caso_hijo_revisar();
CREATE TRIGGER pld_notas_revisar BEFORE INSERT ON pld_notas
FOR EACH ROW EXECUTE FUNCTION pld_caso_hijo_revisar();
CREATE TRIGGER pld_documentos_revisar BEFORE INSERT ON pld_documentos
FOR EACH ROW EXECUTE FUNCTION pld_caso_hijo_revisar();
CREATE TRIGGER pld_propuestas_revisar BEFORE INSERT ON pld_propuestas
FOR EACH ROW EXECUTE FUNCTION pld_caso_hijo_revisar();

-- Descargas auditadas: el personal no lee la ruta del archivo; esta puerta la
-- entrega y deja el evento de quién, cuándo y qué en la misma transacción.
CREATE FUNCTION pld_documento_para_descarga(p_documento uuid, p_peticion uuid)
RETURNS TABLE (clave_blob text, nombre_archivo text, tipo_contenido text, sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  documento pld_documentos%ROWTYPE;
BEGIN
  IF NOT pld_rol(ARRAY['cumplimiento', 'auditoria']) THEN
    RAISE EXCEPTION 'sin_rol_para_pld';
  END IF;
  SELECT * INTO documento FROM pld_documentos d WHERE d.id = p_documento AND d.operator_id = app_operador();
  IF documento.id IS NULL OR pld_caso_me_excluye(documento.caso_id) THEN
    RAISE EXCEPTION 'documento_no_existe';
  END IF;
  INSERT INTO audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, peticion_id, origen)
  VALUES (documento.operator_id, documento.company_id, 'personal', app_usuario(), 'sofipo', 'pld_documento_descargado',
          'pld_documentos', documento.id, p_peticion, 'operacion');
  RETURN QUERY SELECT documento.clave_blob, documento.nombre_archivo, documento.tipo_contenido, documento.sha256;
END;
$$;

REVOKE ALL ON FUNCTION pld_documento_para_descarga(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_documento_para_descarga(uuid, uuid) TO plataforma_sofipo;

-- Las sesiones que votaron un caso que excluye a la persona del contexto (60ª). El
-- acta nombra cada caso votado, su empresa y los votos: para esa persona la sesión
-- no existe (r2-fix-N1). No la lee, no genera ni sube su acta, no vota en ella y
-- recibe lo mismo que con una sesión inexistente. Lee los votos por encima de su
-- RLS, que ya los oculta a esa persona. Un solo conjunto por consulta (r2-base-N10).
CREATE FUNCTION pld_sesiones_que_me_excluyen()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT v.sesion_id), '{}')
  FROM pld_votos v
  WHERE v.caso_id = ANY ((SELECT pld_casos_que_me_excluyen())::uuid[])
$$;

REVOKE ALL ON FUNCTION pld_sesiones_que_me_excluyen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_sesiones_que_me_excluyen() TO plataforma_sofipo;

CREATE FUNCTION pld_sesion_me_excluye(p_sesion uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_sesion = ANY (pld_sesiones_que_me_excluyen())
$$;

REVOKE ALL ON FUNCTION pld_sesion_me_excluye(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_sesion_me_excluye(uuid) TO plataforma_sofipo;

-- r2-fix2-N2 (60ª): una sesión es de quien la registró, votó en ella, subió su acta,
-- dictaminó con ella o trabaja en alguno de los casos que votó. Un caso que excluye a
-- cualquiera de esas personas no entra a la sesión, ni por un voto ni por sumarle un
-- aviso a un caso que ya votó: la sesión le desaparecería con su trabajo (r2-fix-N1),
-- como el caso en r2-base-N3. Ese caso se vota en una sesión aparte. Leen por encima
-- de la RLS y no se dan a nadie: solo las usan las funciones de abajo, que devuelven
-- un código o un sí/no y nunca a quién excluye cada caso.
CREATE FUNCTION pld_personas_del_caso(p_caso uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT z.u), '{}')
  FROM (
    SELECT c.registrado_por FROM pld_casos c WHERE c.id = p_caso
    UNION ALL SELECT x.registrado_por FROM pld_caso_alertas x WHERE x.caso_id = p_caso
    UNION ALL SELECT x.registrado_por FROM pld_notas x WHERE x.caso_id = p_caso
    UNION ALL SELECT x.registrado_por FROM pld_documentos x WHERE x.caso_id = p_caso
    UNION ALL SELECT x.registrado_por FROM pld_propuestas x WHERE x.caso_id = p_caso
    UNION ALL SELECT x.registrado_por FROM pld_casos_24h x WHERE x.caso_id = p_caso
    UNION ALL SELECT x.registrado_por FROM pld_votos x WHERE x.caso_id = p_caso
  ) z(u)
$$;

CREATE FUNCTION pld_excluidos_del_caso(p_caso uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT e.user_id), '{}')
  FROM pld_caso_alertas ca
  JOIN pld_alertas x ON x.id = ca.alerta_id
  JOIN pld_aviso_excluidos e ON e.aviso_id = x.aviso_id
  WHERE ca.caso_id = p_caso
$$;

CREATE FUNCTION pld_personas_de_la_sesion(p_sesion uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT z.u), '{}')
  FROM (
    SELECT s.registrado_por FROM pld_sesiones s WHERE s.id = p_sesion
    UNION ALL SELECT a.registrado_por FROM pld_actas a WHERE a.sesion_id = p_sesion
    UNION ALL SELECT d.registrado_por FROM pld_dictamenes d WHERE d.sesion_id = p_sesion
    UNION ALL SELECT unnest(pld_personas_del_caso(v.caso_id)) FROM (SELECT DISTINCT caso_id FROM pld_votos WHERE sesion_id = p_sesion) v
  ) z(u)
$$;

CREATE FUNCTION pld_excluidos_de_la_sesion(p_sesion uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT z.u), '{}')
  FROM (SELECT unnest(pld_excluidos_del_caso(v.caso_id)) FROM (SELECT DISTINCT caso_id FROM pld_votos WHERE sesion_id = p_sesion) v) z(u)
$$;

REVOKE ALL ON FUNCTION pld_personas_del_caso(uuid), pld_excluidos_del_caso(uuid), pld_personas_de_la_sesion(uuid),
  pld_excluidos_de_la_sesion(uuid) FROM PUBLIC;

-- Un voto de p_caso en p_sesion por p_persona. Con los candados del caso y de la
-- sesión ya tomados. sesion_no_existe si la sesión ya votó un caso que excluye a quien
-- vota (para esa persona no existe, r2-fix-N1); sesion_con_persona_excluida si el caso
-- excluye a alguien de la sesión, o si la sesión ya votó un caso que excluye a quien
-- trabaja en éste.
-- r2-fix3-N3 (60ª, decisión del líder): sesiones aparte de verdad. Un caso entra a una
-- sesión que ya votó algo solo si excluye exactamente a las mismas personas que los
-- casos que votó; un caso sin exclusiones, solo con casos sin exclusiones. Así quien ve
-- un caso ve todas las sesiones que lo votaron, su dictamen incluido. La primera
-- votación de la sesión fija su conjunto. sesion_con_otra_reserva va al final: la
-- regla de las personas de la sesión (r2-fix2-N2) sigue sosteniendo la sesión sin votos.
CREATE FUNCTION pld_voto_choca(p_sesion uuid, p_caso uuid, p_persona uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_persona = ANY (pld_excluidos_de_la_sesion(p_sesion)) THEN 'sesion_no_existe'
    WHEN (pld_personas_de_la_sesion(p_sesion) || pld_personas_del_caso(p_caso) || p_persona)
      && (pld_excluidos_de_la_sesion(p_sesion) || pld_excluidos_del_caso(p_caso)) THEN 'sesion_con_persona_excluida'
    WHEN EXISTS (SELECT 1 FROM pld_votos v WHERE v.sesion_id = p_sesion)
      AND NOT (pld_excluidos_del_caso(p_caso) <@ pld_excluidos_de_la_sesion(p_sesion)
        AND pld_excluidos_de_la_sesion(p_sesion) <@ pld_excluidos_del_caso(p_caso)) THEN 'sesion_con_otra_reserva'
  END
$$;

-- La sesión ya votó un caso que excluye a p_persona: para ella no existe. Para el acta
-- y el dictamen, ya con el candado de la sesión (su RLS se evaluó antes de esperarlo).
CREATE FUNCTION pld_sesion_excluye_a(p_sesion uuid, p_persona uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_persona = ANY (pld_excluidos_de_la_sesion(p_sesion))
$$;

-- Sumar a p_caso la alerta del aviso p_aviso: serie_con_persona_excluida si el aviso
-- excluye a alguien del caso (r2-base-N3) o de una sesión que ya votó el caso.
-- r2-fix3-N3: serie_con_otra_reserva si el caso ya se votó y el aviso excluye a alguien
-- que el caso aún no excluye: su sesión dejaría de ser aparte. Abre su propio caso y su
-- propio reporte (40ª, último párrafo: desviación aceptada por el líder, la confirma Gil).
-- Con los candados del caso y de esas sesiones ya tomados.
CREATE FUNCTION pld_serie_choca(p_caso uuid, p_aviso uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH aviso AS (SELECT coalesce(array_agg(e.user_id), '{}') AS excluidos FROM pld_aviso_excluidos e WHERE e.aviso_id = p_aviso)
  SELECT CASE
    WHEN (SELECT a.excluidos FROM aviso a)
      && (pld_personas_del_caso(p_caso) || coalesce((
        SELECT array_agg(z.u) FROM (
          SELECT unnest(pld_personas_de_la_sesion(v.sesion_id)) FROM (SELECT DISTINCT sesion_id FROM pld_votos WHERE caso_id = p_caso) v
        ) z(u)
      ), '{}')) THEN 'serie_con_persona_excluida'
    WHEN EXISTS (SELECT 1 FROM pld_votos v WHERE v.caso_id = p_caso)
      AND NOT ((SELECT a.excluidos FROM aviso a) <@ pld_excluidos_del_caso(p_caso)) THEN 'serie_con_otra_reserva'
  END
$$;

REVOKE ALL ON FUNCTION pld_voto_choca(uuid, uuid, uuid), pld_sesion_excluye_a(uuid, uuid), pld_serie_choca(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_voto_choca(uuid, uuid, uuid), pld_sesion_excluye_a(uuid, uuid), pld_serie_choca(uuid, uuid) TO plataforma_sofipo;

CREATE FUNCTION pld_acta_para_descarga(p_acta uuid, p_peticion uuid)
RETURNS TABLE (clave_blob text, nombre_archivo text, tipo_contenido text, sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acta pld_actas%ROWTYPE;
BEGIN
  IF NOT pld_rol(ARRAY['cumplimiento', 'auditoria']) THEN
    RAISE EXCEPTION 'sin_rol_para_pld';
  END IF;
  SELECT * INTO acta FROM pld_actas a WHERE a.id = p_acta AND a.operator_id = app_operador();
  IF acta.id IS NULL OR pld_sesion_me_excluye(acta.sesion_id) THEN
    RAISE EXCEPTION 'documento_no_existe';
  END IF;
  INSERT INTO audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, peticion_id, origen)
  VALUES (acta.operator_id, NULL, 'personal', app_usuario(), 'sofipo', 'pld_acta_descargada', 'pld_actas', acta.id, p_peticion, 'operacion');
  RETURN QUERY SELECT acta.clave_blob, acta.nombre_archivo, acta.tipo_contenido, acta.sha256;
END;
$$;

REVOKE ALL ON FUNCTION pld_acta_para_descarga(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_acta_para_descarga(uuid, uuid) TO plataforma_sofipo;

-- r2-fix-N2 (40ª y 60ª): ningún aviso abierto se queda sin quien lo analice. Lo que
-- r2-base-N4 revisa al emitir el aviso, aquí se revisa al cambiar al personal: una
-- suspensión, una baja o el retiro del rol de Cumplimiento que dejaría un aviso
-- abierto sin nadie de Cumplimiento activo que pueda verlo se rechaza. Abierto: sin
-- caso, con su caso sin dictamen o, si se reporta, sin el acuse del reporte. Si el
-- aviso ya va en un caso, cuentan las exclusiones de todos los avisos del caso.
CREATE FUNCTION pld_aviso_sin_analista(p_operador uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH avisos AS (
    SELECT x.aviso_id, ca.caso_id
    FROM pld_alertas x
    LEFT JOIN pld_caso_alertas ca ON ca.alerta_id = x.id
    WHERE x.operator_id = p_operador AND x.aviso_id IS NOT NULL
  ), abiertos AS (
    SELECT a.aviso_id, a.caso_id
    FROM avisos a
    LEFT JOIN pld_dictamenes d ON d.caso_id = a.caso_id
    WHERE d.id IS NULL
       OR (d.resultado <> 'no_reportar' AND NOT EXISTS (SELECT 1 FROM pld_reportes r WHERE r.caso_id = a.caso_id))
  )
  SELECT EXISTS (
    SELECT 1
    FROM abiertos u
    WHERE NOT EXISTS (
      SELECT 1
      FROM platform_staff s
      JOIN platform_staff_roles r ON r.operator_id = s.operator_id AND r.user_id = s.user_id
      WHERE s.operator_id = p_operador AND s.estado = 'activo' AND r.rol = 'cumplimiento'
        AND NOT EXISTS (
          SELECT 1
          FROM pld_aviso_excluidos e
          JOIN avisos b ON b.aviso_id = e.aviso_id
          WHERE e.user_id = s.user_id AND (b.aviso_id = u.aviso_id OR b.caso_id = u.caso_id)
        )
    )
  )
$$;

REVOKE ALL ON FUNCTION pld_aviso_sin_analista(uuid) FROM PUBLIC;

-- Al final de la transacción: quien da de alta a otra persona de Cumplimiento y
-- retira a la anterior en la misma transacción puede hacerlo. Con el candado del
-- personal de Cumplimiento del operador, el mismo del aviso con exclusiones
-- (base-N4) y de la alerta de un aviso que se suma a un caso: si corren a la vez,
-- la segunda en confirmar ve a la primera y se rechaza.
CREATE FUNCTION pld_personal_deja_analista()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operador uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- pld_caso_alertas: solo la alerta de un aviso cambia a quién excluye el caso.
    IF NOT EXISTS (SELECT 1 FROM pld_alertas x WHERE x.id = NEW.alerta_id AND x.aviso_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    operador := NEW.operator_id;
  ELSE
    operador := OLD.operator_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pld_analistas:' || operador::text, 0));
  IF pld_aviso_sin_analista(operador) THEN
    RAISE EXCEPTION 'aviso_sin_analista';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION pld_personal_deja_analista() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER pld_personal_suspendido_deja_analista
AFTER UPDATE OF estado ON platform_staff
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.estado = 'activo' AND NEW.estado IS DISTINCT FROM 'activo')
EXECUTE FUNCTION pld_personal_deja_analista();
CREATE CONSTRAINT TRIGGER pld_personal_baja_deja_analista
AFTER DELETE ON platform_staff
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.estado = 'activo')
EXECUTE FUNCTION pld_personal_deja_analista();
CREATE CONSTRAINT TRIGGER pld_rol_retirado_deja_analista
AFTER DELETE ON platform_staff_roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.rol = 'cumplimiento')
EXECUTE FUNCTION pld_personal_deja_analista();
CREATE CONSTRAINT TRIGGER pld_serie_deja_analista
AFTER INSERT ON pld_caso_alertas
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pld_personal_deja_analista();

-- 61ª: manifiesto de conservación por empresa y periodo. Conteos de las tablas
-- que registran operaciones, el expediente y lo de PLD, y la huella y la ruta de
-- cada documento. Cumplimiento y Auditoría; cada página deja su evento.
CREATE FUNCTION pld_manifiesto_conteos(p_company uuid, p_desde date, p_hasta date, p_peticion uuid, p_pagina integer)
RETURNS TABLE (tabla text, filas bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  empresa companies%ROWTYPE;
  desde timestamptz := (p_desde::timestamp AT TIME ZONE 'America/Mexico_City');
  hasta timestamptz := ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Mexico_City');
  -- 60ª: lo que excluye a quien pide, una sola vez (r2-base-N3 y N10).
  casos_ocultos uuid[];
  alertas_ocultas uuid[];
  ids_ocultos uuid[];
BEGIN
  IF NOT pld_rol(ARRAY['cumplimiento', 'auditoria']) THEN
    RAISE EXCEPTION 'sin_rol_para_pld';
  END IF;
  casos_ocultos := pld_casos_que_me_excluyen();
  alertas_ocultas := pld_alertas_que_me_excluyen();
  ids_ocultos := pld_ids_que_me_excluyen();
  SELECT * INTO empresa FROM companies c WHERE c.id = p_company AND c.operator_id = app_operador();
  IF empresa.id IS NULL THEN
    RAISE EXCEPTION 'cliente_ausente';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 3700 THEN
    RAISE EXCEPTION 'periodo_invalido';
  END IF;
  INSERT INTO audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, peticion_id, origen, cambio)
  VALUES (empresa.operator_id, empresa.id, 'personal', app_usuario(), 'sofipo', 'pld_manifiesto_descargado', 'companies', empresa.id,
          p_peticion, 'operacion', jsonb_build_object('desde', p_desde::text, 'hasta', p_hasta::text, 'pagina', p_pagina));
  RETURN QUERY
  SELECT 'supplier_payment_requests', count(*) FROM supplier_payment_requests x WHERE x.company_id = p_company AND x.creado_en >= desde AND x.creado_en < hasta
  UNION ALL SELECT 'supplier_payment_request_history', count(*) FROM supplier_payment_request_history x WHERE x.company_id = p_company AND x.cerrado_en >= desde AND x.cerrado_en < hasta
  UNION ALL SELECT 'payroll_batches', count(*) FROM payroll_batches x WHERE x.company_id = p_company AND x.preparada_en >= desde AND x.preparada_en < hasta
  UNION ALL SELECT 'payroll_batch_items', count(*) FROM payroll_batch_items i JOIN payroll_batches b ON b.id = i.batch_id AND b.company_id = i.company_id
    WHERE i.company_id = p_company AND b.preparada_en >= desde AND b.preparada_en < hasta
  UNION ALL SELECT 'postings', count(*) FROM postings x WHERE x.company_id = p_company AND x.ocurrido_en >= desde AND x.ocurrido_en < hasta
  UNION ALL SELECT 'expected_collections', count(*) FROM expected_collections x WHERE x.company_id = p_company AND x.creado_en >= desde AND x.creado_en < hasta
  UNION ALL SELECT 'kyb_versiones', count(*) FROM kyb_versiones x WHERE x.company_id = p_company AND x.creada_en >= desde AND x.creada_en < hasta
  UNION ALL SELECT 'kyb_documentos', count(*) FROM kyb_documentos x WHERE x.company_id = p_company AND x.cargado_en >= desde AND x.cargado_en < hasta
  UNION ALL SELECT 'kyb_calificaciones_riesgo', count(*) FROM kyb_calificaciones_riesgo x WHERE x.company_id = p_company AND x.calificada_en >= desde AND x.calificada_en < hasta
  UNION ALL SELECT 'pld_perfiles', count(*) FROM pld_perfiles x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
  UNION ALL SELECT 'pld_perfil_propuestas', count(*) FROM pld_perfil_propuestas x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
  UNION ALL SELECT 'pld_perfil_resoluciones', count(*) FROM pld_perfil_resoluciones x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
  UNION ALL SELECT 'pld_evaluaciones', count(*) FROM pld_evaluaciones x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
  UNION ALL SELECT 'pld_operaciones', count(*) FROM pld_operaciones x WHERE x.company_id = p_company AND x.ocurrida_en >= desde AND x.ocurrida_en < hasta
  -- Lo de PLD con el mismo filtro de exclusión que su política (60ª, r2-base-N3):
  -- la persona excluida no deduce el caso por la diferencia de conteos.
  UNION ALL SELECT 'pld_alertas', count(*) FROM pld_alertas x WHERE x.company_id = p_company AND x.creada_en >= desde AND x.creada_en < hasta
    AND NOT (x.id = ANY (alertas_ocultas))
  UNION ALL SELECT 'pld_casos', count(*) FROM pld_casos x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
    AND NOT (x.id = ANY (casos_ocultos))
  UNION ALL SELECT 'pld_notas', count(*) FROM pld_notas x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
    AND NOT (x.caso_id = ANY (casos_ocultos))
  UNION ALL SELECT 'pld_documentos', count(*) FROM pld_documentos x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
    AND NOT (x.caso_id = ANY (casos_ocultos))
  UNION ALL SELECT 'pld_propuestas', count(*) FROM pld_propuestas x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
    AND NOT (x.caso_id = ANY (casos_ocultos))
  UNION ALL SELECT 'pld_dictamenes', count(*) FROM pld_dictamenes x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
    AND NOT (x.caso_id = ANY (casos_ocultos))
  UNION ALL SELECT 'pld_reportes', count(*) FROM pld_reportes x WHERE x.company_id = p_company AND x.registrado_en >= desde AND x.registrado_en < hasta
    AND NOT (x.caso_id = ANY (casos_ocultos))
  UNION ALL SELECT 'audit_log', count(*) FROM audit_log x WHERE x.company_id = p_company AND x.ocurrido_en >= desde AND x.ocurrido_en < hasta
    AND NOT (x.accion LIKE 'pld\_%' AND coalesce(x.identificador = ANY (ids_ocultos), false));
END;
$$;

REVOKE ALL ON FUNCTION pld_manifiesto_conteos(uuid, date, date, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_manifiesto_conteos(uuid, date, date, uuid, integer) TO plataforma_sofipo;

-- Documentos de la empresa en el periodo, por páginas (orden estable por fecha e id).
CREATE FUNCTION pld_manifiesto_documentos(p_company uuid, p_desde date, p_hasta date, p_despues_en timestamptz, p_despues_id uuid, p_limite integer)
RETURNS TABLE (origen text, id uuid, cargado_en timestamptz, nombre_archivo text, sha256 text, clave_blob text, tamano_bytes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  desde timestamptz := (p_desde::timestamp AT TIME ZONE 'America/Mexico_City');
  hasta timestamptz := ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Mexico_City');
BEGIN
  IF NOT pld_rol(ARRAY['cumplimiento', 'auditoria']) THEN
    RAISE EXCEPTION 'sin_rol_para_pld';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = p_company AND c.operator_id = app_operador()) THEN
    RAISE EXCEPTION 'cliente_ausente';
  END IF;
  -- Una página es de 2,000 documentos; el servidor pide uno más para saber si hay otra.
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 2001 THEN
    RAISE EXCEPTION 'periodo_invalido';
  END IF;
  RETURN QUERY
  SELECT d.origen, d.id, d.cargado_en, d.nombre_archivo, d.sha256, d.clave_blob, d.tamano_bytes
  FROM (
    SELECT 'kyb_documentos'::text AS origen, k.id, k.cargado_en, k.nombre_archivo, k.sha256, k.clave_blob, k.tamano_bytes
    FROM kyb_documentos k WHERE k.company_id = p_company AND k.cargado_en >= desde AND k.cargado_en < hasta
    UNION ALL
    SELECT 'pld_documentos'::text, p.id, p.registrado_en, p.nombre_archivo, p.sha256, p.clave_blob, p.tamano_bytes
    FROM pld_documentos p WHERE p.company_id = p_company AND p.registrado_en >= desde AND p.registrado_en < hasta
      AND NOT (p.caso_id = ANY ((SELECT pld_casos_que_me_excluyen())::uuid[]))
  ) AS d
  WHERE p_despues_en IS NULL OR (d.cargado_en, d.id) > (p_despues_en, p_despues_id)
  ORDER BY d.cargado_en, d.id
  LIMIT p_limite;
END;
$$;

REVOKE ALL ON FUNCTION pld_manifiesto_documentos(uuid, date, date, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_manifiesto_documentos(uuid, date, date, timestamptz, uuid, integer) TO plataforma_sofipo;

-- 11. Candado de activación ----------------------------------------------------------

-- La misma regla de la 0028 y, al final de en_alta → activa, el perfil
-- transaccional declarado (25ª): sin montos ni operaciones estimados no hay
-- contra qué vigilar. La reactivación no cambia.
CREATE OR REPLACE FUNCTION companies_candado_regulado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  version kyb_versiones%ROWTYPE;
  riesgo kyb_calificaciones_riesgo%ROWTYPE;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF OLD.estado = 'en_alta' AND NEW.estado = 'activa' THEN
    SELECT * INTO version FROM kyb_versiones v
    WHERE v.company_id = NEW.id AND v.estado = 'enviada' ORDER BY v.numero DESC LIMIT 1;
    IF version.id IS NULL OR NOT EXISTS (
      SELECT 1 FROM kyb_dictamenes d WHERE d.version_id = version.id AND d.resultado = 'aprobado'
    ) THEN
      RAISE EXCEPTION 'activacion_sin_expediente_aprobado';
    END IF;
    IF kyb_documento_vencido(version.id) THEN
      RAISE EXCEPTION 'activacion_con_documento_vencido';
    END IF;
    IF lpb_coincidencias_abiertas(NEW.id) THEN
      RAISE EXCEPTION 'activacion_con_coincidencia_lpb';
    END IF;
    SELECT * INTO riesgo FROM kyb_calificaciones_riesgo k
    WHERE k.company_id = NEW.id ORDER BY k.calificada_en DESC, k.id DESC LIMIT 1;
    IF riesgo.id IS NULL OR riesgo.version_id <> version.id OR riesgo.revisar_antes_de < hoy_mexico() THEN
      RAISE EXCEPTION 'activacion_sin_riesgo_vigente';
    END IF;
    IF riesgo.grado <> 'bajo' AND NOT EXISTS (
      SELECT 1 FROM kyb_documentos_de_version(version.id) d WHERE d.tipo = 'estructura_corporativa'
    ) THEN
      RAISE EXCEPTION 'activacion_sin_estructura_corporativa';
    END IF;
    -- 0030 (25ª): perfil transaccional declarado.
    IF NOT EXISTS (SELECT 1 FROM pld_perfiles p WHERE p.company_id = NEW.id) THEN
      RAISE EXCEPTION 'activacion_sin_perfil_transaccional';
    END IF;
  ELSIF OLD.estado = 'suspendida' AND NEW.estado = 'activa' THEN
    IF lpb_coincidencias_abiertas(NEW.id) THEN
      RAISE EXCEPTION 'reactivacion_con_coincidencia_lpb';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- C: una empresa de demostración no entra a PLD; por eso la marca tampoco se pone
-- después. Una empresa real que pasara a demostración dejaría de vigilarse, y la
-- SOFIPO tiene UPDATE en companies. La 0020 ya impedía el sentido contrario. Solo
-- cambia la función: el disparador de la 0020 sigue igual y no se toma candado nuevo.
CREATE OR REPLACE FUNCTION companies_demostracion_no_dinero()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.demostracion IS TRUE AND NEW.demostracion IS FALSE THEN
    RAISE EXCEPTION 'demostracion_no_se_activa_para_dinero';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.demostracion IS FALSE AND NEW.demostracion IS TRUE THEN
    RAISE EXCEPTION 'empresa_real_no_pasa_a_demostracion';
  END IF;
  RETURN NEW;
END;
$$;

-- 12. Conservación de las operaciones (61ª) ---------------------------------------

-- 61ª: «conservar por un periodo no menor a diez años, contado a partir de la
-- ejecución de la Operación». supplier_payment_requests y su historial (0022) y
-- postings (0008) ya rechazaban DELETE y TRUNCATE; payroll_batches,
-- payroll_batch_items (0023) y expected_collections (0026) rechazaban DELETE
-- pero no TRUNCATE. Aquí las seis quedan con la marca de conservación.
DO $$
DECLARE
  tabla text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'supplier_payment_requests', 'supplier_payment_request_history', 'payroll_batches',
    'payroll_batch_items', 'postings', 'expected_collections'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION conservacion_no_se_borra()',
      tabla || '_conservacion', tabla
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION conservacion_no_se_borra()',
      tabla || '_conservacion_truncate', tabla
    );
  END LOOP;
END;
$$;

REVOKE DELETE, TRUNCATE ON supplier_payment_requests, supplier_payment_request_history, payroll_batches,
  payroll_batch_items, postings, expected_collections FROM PUBLIC, plataforma_cliente, plataforma_sofipo;

-- 13. RLS, permisos y bitácora confidencial -------------------------------------------

-- Lo de PLD no se reescribe, no se borra ni se trunca.
DO $$
DECLARE
  tabla text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'pld_calendarios', 'pld_dias_inhabiles', 'pld_perfil_propuestas', 'pld_perfiles', 'pld_perfil_resoluciones',
    'pld_evaluaciones', 'pld_parametros', 'pld_operaciones', 'pld_avisos', 'pld_aviso_excluidos', 'pld_alertas', 'pld_casos', 'pld_caso_alertas', 'pld_casos_24h', 'pld_notas',
    'pld_documentos', 'pld_propuestas', 'pld_modo_dictamen', 'pld_comite_integrantes', 'pld_comite_bajas',
    'pld_comite_auditores', 'pld_comite_comunicaciones', 'pld_sesiones', 'pld_votos', 'pld_actas', 'pld_dictamenes',
    'pld_reportes', 'pld_entidad', 'pld_periodicos'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION pld_inmutable()',
      tabla || '_inmutable', tabla
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION pld_inmutable()',
      tabla || '_no_truncate', tabla
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tabla);
  END LOOP;
END;
$$;

-- Bitácora obligatoria de cada escritura del personal.
CREATE CONSTRAINT TRIGGER pld_perfil_propuestas_exige_evento AFTER INSERT ON pld_perfil_propuestas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('expediente_perfil_propuesto', '', '');
CREATE CONSTRAINT TRIGGER pld_perfil_resoluciones_exige_evento AFTER INSERT ON pld_perfil_resoluciones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('', 'pld_perfil_propuestas', 'propuesta_id');
CREATE CONSTRAINT TRIGGER pld_perfiles_exige_evento AFTER INSERT ON pld_perfiles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('', '', '');
CREATE CONSTRAINT TRIGGER pld_evaluaciones_exige_evento AFTER INSERT ON pld_evaluaciones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_evaluacion_registrada', '', '');
CREATE CONSTRAINT TRIGGER pld_parametros_exige_evento AFTER INSERT ON pld_parametros
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_parametros_cambiados', '', '');
CREATE CONSTRAINT TRIGGER pld_avisos_exige_evento AFTER INSERT ON pld_avisos
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_aviso_emitido', '', '');
CREATE CONSTRAINT TRIGGER pld_casos_exige_evento AFTER INSERT ON pld_casos
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_caso_abierto', '', '');
CREATE CONSTRAINT TRIGGER pld_caso_alertas_exige_evento AFTER INSERT ON pld_caso_alertas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('', 'pld_casos', 'caso_id');
CREATE CONSTRAINT TRIGGER pld_casos_24h_exige_evento AFTER INSERT ON pld_casos_24h
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_caso_24_horas', 'pld_casos', 'caso_id');
CREATE CONSTRAINT TRIGGER pld_notas_exige_evento AFTER INSERT ON pld_notas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_nota_agregada', '', '');
CREATE CONSTRAINT TRIGGER pld_documentos_exige_evento AFTER INSERT ON pld_documentos
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_documento_cargado', '', '');
CREATE CONSTRAINT TRIGGER pld_propuestas_exige_evento AFTER INSERT ON pld_propuestas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_propuesta_registrada', '', '');
CREATE CONSTRAINT TRIGGER pld_votos_exige_evento AFTER INSERT ON pld_votos
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_voto_registrado', '', '');
CREATE CONSTRAINT TRIGGER pld_dictamenes_exige_evento AFTER INSERT ON pld_dictamenes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_dictamen_registrado', '', '');
CREATE CONSTRAINT TRIGGER pld_reportes_exige_evento AFTER INSERT ON pld_reportes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_reporte_registrado', '', '');
CREATE CONSTRAINT TRIGGER pld_modo_dictamen_exige_evento AFTER INSERT ON pld_modo_dictamen
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_modo_dictamen_cambiado', '', '');
CREATE CONSTRAINT TRIGGER pld_comite_integrantes_exige_evento AFTER INSERT ON pld_comite_integrantes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_comite_integrante_designado', '', '');
CREATE CONSTRAINT TRIGGER pld_comite_bajas_exige_evento AFTER INSERT ON pld_comite_bajas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_comite_integrante_sustituido', 'pld_comite_integrantes', 'integrante_id');
CREATE CONSTRAINT TRIGGER pld_comite_auditores_exige_evento AFTER INSERT ON pld_comite_auditores
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_comite_auditor_designado', '', '');
CREATE CONSTRAINT TRIGGER pld_comite_comunicaciones_exige_evento AFTER INSERT ON pld_comite_comunicaciones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_comite_comunicacion_registrada', '', '');
CREATE CONSTRAINT TRIGGER pld_sesiones_exige_evento AFTER INSERT ON pld_sesiones
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_sesion_registrada', '', '');
CREATE CONSTRAINT TRIGGER pld_actas_exige_evento AFTER INSERT ON pld_actas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_acta_cargada', '', '');
CREATE CONSTRAINT TRIGGER pld_entidad_exige_evento AFTER INSERT ON pld_entidad
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_entidad_registrada', '', '');
CREATE CONSTRAINT TRIGGER pld_periodicos_exige_evento AFTER INSERT ON pld_periodicos
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pld_exige_evento('pld_periodico_registrado', '', '');

-- Políticas. Lectura: Cumplimiento y Auditoría. Escritura: Cumplimiento (los
-- triggers revisan además el rol exacto). El portal del cliente no tiene permiso
-- sobre ninguna tabla de PLD (55ª). La persona excluida de un aviso no ve el
-- aviso, su alerta, su caso ni nada de él (60ª).
CREATE POLICY pld_calendarios_sofipo ON pld_calendarios FOR SELECT TO plataforma_sofipo USING (true);
CREATE POLICY pld_dias_inhabiles_sofipo ON pld_dias_inhabiles FOR SELECT TO plataforma_sofipo USING (true);

CREATE POLICY pld_perfiles_lectura ON pld_perfiles FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['originacion', 'aprobacion', 'cumplimiento', 'auditoria'])));
CREATE POLICY pld_perfiles_escritura ON pld_perfiles FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['originacion', 'cumplimiento'])));
CREATE POLICY pld_perfil_propuestas_lectura ON pld_perfil_propuestas FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['originacion', 'aprobacion', 'cumplimiento', 'auditoria'])));
CREATE POLICY pld_perfil_propuestas_escritura ON pld_perfil_propuestas FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['originacion'])));
CREATE POLICY pld_perfil_resoluciones_lectura ON pld_perfil_resoluciones FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['originacion', 'aprobacion', 'cumplimiento', 'auditoria'])));
CREATE POLICY pld_perfil_resoluciones_escritura ON pld_perfil_resoluciones FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento'])));

CREATE POLICY pld_parametros_lectura ON pld_parametros FOR SELECT TO plataforma_sofipo
  USING ((operator_id = app_operador() OR operator_id IS NULL) AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria'])));
CREATE POLICY pld_parametros_escritura ON pld_parametros FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento'])));

CREATE POLICY pld_operaciones_lectura ON pld_operaciones FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria'])));

CREATE POLICY pld_avisos_lectura ON pld_avisos FOR SELECT TO plataforma_sofipo
  USING (
    operator_id = app_operador()
    AND (registrado_por = app_usuario() OR ((SELECT pld_rol(ARRAY['cumplimiento', 'auditoria'])) AND NOT (id = ANY ((SELECT pld_avisos_que_me_excluyen())::uuid[]))))
  );
CREATE POLICY pld_avisos_escritura ON pld_avisos FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador() AND registrado_por = app_usuario());

CREATE POLICY pld_aviso_excluidos_lectura ON pld_aviso_excluidos FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria'])) AND NOT (aviso_id = ANY ((SELECT pld_avisos_que_me_excluyen())::uuid[])));
CREATE POLICY pld_aviso_excluidos_escritura ON pld_aviso_excluidos FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador());

CREATE POLICY pld_alertas_lectura ON pld_alertas FOR SELECT TO plataforma_sofipo
  USING (
    operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria']))
    AND NOT (id = ANY ((SELECT pld_alertas_que_me_excluyen())::uuid[]))
  );

CREATE POLICY pld_casos_lectura ON pld_casos FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria'])) AND NOT (id = ANY ((SELECT pld_casos_que_me_excluyen())::uuid[])));
CREATE POLICY pld_casos_escritura ON pld_casos FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento'])));

DO $$
DECLARE
  tabla text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'pld_caso_alertas', 'pld_casos_24h', 'pld_notas', 'pld_documentos', 'pld_propuestas', 'pld_votos',
    'pld_dictamenes', 'pld_reportes'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO plataforma_sofipo USING ('
      'operator_id = app_operador() AND (SELECT pld_rol(ARRAY[''cumplimiento'', ''auditoria''])) AND NOT (caso_id = ANY ((SELECT pld_casos_que_me_excluyen())::uuid[])))',
      tabla || '_lectura', tabla
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO plataforma_sofipo WITH CHECK ('
      'operator_id = app_operador() AND (SELECT pld_rol(ARRAY[''cumplimiento''])) AND NOT (caso_id = ANY ((SELECT pld_casos_que_me_excluyen())::uuid[])))',
      tabla || '_escritura', tabla
    );
  END LOOP;
  FOREACH tabla IN ARRAY ARRAY[
    'pld_evaluaciones', 'pld_modo_dictamen', 'pld_comite_integrantes', 'pld_comite_bajas', 'pld_comite_auditores',
    'pld_comite_comunicaciones', 'pld_entidad', 'pld_periodicos'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO plataforma_sofipo USING ('
      'operator_id = app_operador() AND (SELECT pld_rol(ARRAY[''cumplimiento'', ''auditoria''])))',
      tabla || '_lectura', tabla
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO plataforma_sofipo WITH CHECK ('
      'operator_id = app_operador() AND (SELECT pld_rol(ARRAY[''cumplimiento''])))',
      tabla || '_escritura', tabla
    );
  END LOOP;
END;
$$;

-- r2-fix3-N2 (60ª): los votos de una sesión que no existe para la persona tampoco se le
-- muestran, aunque sean de un caso que sí ve: delatarían la sesión. Con las sesiones
-- aparte (r2-fix3-N3) eso ya no se arma; queda como defensa ante datos de antes.
ALTER POLICY pld_votos_lectura ON pld_votos USING (
  operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria']))
  AND NOT (caso_id = ANY ((SELECT pld_casos_que_me_excluyen())::uuid[]))
  AND NOT (sesion_id = ANY ((SELECT pld_sesiones_que_me_excluyen())::uuid[])));

-- r2-fix-N1 (60ª): la sesión que votó un caso que excluye a la persona del contexto,
-- y su acta, no existen para ella: no las lee ni escribe en ellas.
CREATE POLICY pld_sesiones_lectura ON pld_sesiones FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria']))
    AND NOT (id = ANY ((SELECT pld_sesiones_que_me_excluyen())::uuid[])));
CREATE POLICY pld_sesiones_escritura ON pld_sesiones FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento'])));
CREATE POLICY pld_actas_lectura ON pld_actas FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria']))
    AND NOT (sesion_id = ANY ((SELECT pld_sesiones_que_me_excluyen())::uuid[])));
CREATE POLICY pld_actas_escritura ON pld_actas FOR INSERT TO plataforma_sofipo
  WITH CHECK (operator_id = app_operador() AND (SELECT pld_rol(ARRAY['cumplimiento']))
    AND NOT (sesion_id = ANY ((SELECT pld_sesiones_que_me_excluyen())::uuid[])));

GRANT SELECT ON pld_calendarios, pld_dias_inhabiles, pld_operaciones, pld_alertas TO plataforma_sofipo;
GRANT SELECT, INSERT ON pld_perfiles, pld_perfil_propuestas, pld_perfil_resoluciones, pld_evaluaciones, pld_parametros, pld_avisos, pld_casos, pld_caso_alertas,
  pld_casos_24h, pld_notas, pld_propuestas, pld_modo_dictamen, pld_comite_integrantes, pld_comite_bajas,
  pld_comite_auditores, pld_comite_comunicaciones, pld_sesiones, pld_votos, pld_dictamenes, pld_reportes,
  pld_entidad, pld_periodicos TO plataforma_sofipo;
GRANT SELECT, INSERT ON pld_aviso_excluidos TO plataforma_sofipo;
-- La ruta del archivo no se lee directo: la entregan las puertas de descarga.
GRANT SELECT (
  id, caso_id, operator_id, company_id, nombre_archivo, tipo_contenido, tamano_bytes, sha256, registrado_por, registrado_en
) ON pld_documentos TO plataforma_sofipo;
GRANT INSERT ON pld_documentos TO plataforma_sofipo;
GRANT SELECT (
  id, sesion_id, operator_id, nombre_archivo, tipo_contenido, tamano_bytes, sha256, registrado_por, registrado_en
) ON pld_actas TO plataforma_sofipo;
GRANT INSERT ON pld_actas TO plataforma_sofipo;

-- r2-base-N12: como las demás SECURITY DEFINER, nadie más que el personal las ejecuta.
REVOKE ALL ON FUNCTION pld_dia_inhabil(date), pld_calendario_cargado(integer), pld_sumar_dias_habiles(date, integer),
  pld_dia_habil_del_mes(date, integer), pld_ultimo_dia_habil(date), pld_dias_habiles_entre(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_dia_inhabil(date), pld_calendario_cargado(integer), pld_sumar_dias_habiles(date, integer),
  pld_dia_habil_del_mes(date, integer), pld_ultimo_dia_habil(date), pld_dias_habiles_entre(date, date),
  pld_comite_vigentes(uuid, date) TO plataforma_sofipo;

-- Los identificadores de lo que excluye a la persona del contexto (60ª) y de lo que
-- cuelga de esos casos, para la bitácora y el manifiesto: el evento de algo que no
-- ve tampoco se le muestra. Un solo conjunto por consulta (r2-base-N10).
CREATE FUNCTION pld_ids_que_me_excluyen()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH casos AS (SELECT unnest(pld_casos_que_me_excluyen()) AS id)
  SELECT coalesce(array_agg(z.id), '{}')
  FROM (
    SELECT unnest(pld_avisos_que_me_excluyen())
    UNION ALL SELECT unnest(pld_alertas_que_me_excluyen())
    UNION ALL SELECT c.id FROM casos c
    UNION ALL SELECT x.id FROM pld_notas x WHERE x.caso_id IN (SELECT c.id FROM casos c)
    UNION ALL SELECT x.id FROM pld_documentos x WHERE x.caso_id IN (SELECT c.id FROM casos c)
    UNION ALL SELECT x.id FROM pld_propuestas x WHERE x.caso_id IN (SELECT c.id FROM casos c)
    UNION ALL SELECT x.id FROM pld_votos x WHERE x.caso_id IN (SELECT c.id FROM casos c)
    UNION ALL SELECT x.id FROM pld_dictamenes x WHERE x.caso_id IN (SELECT c.id FROM casos c)
    UNION ALL SELECT x.id FROM pld_reportes x WHERE x.caso_id IN (SELECT c.id FROM casos c)
    -- r2-fix-N1: el registro de la sesión que votó el caso tampoco se le muestra.
    UNION ALL SELECT unnest(pld_sesiones_que_me_excluyen())
    -- r2-fix3-N2: ni los votos de esa sesión, aunque sean de un caso que sí ve.
    UNION ALL SELECT x.id FROM pld_votos x WHERE x.sesion_id = ANY (pld_sesiones_que_me_excluyen())
    UNION ALL SELECT a.id FROM pld_actas a WHERE EXISTS (
      SELECT 1 FROM pld_votos v WHERE v.sesion_id = a.sesion_id AND v.caso_id IN (SELECT c.id FROM casos c)
    )
  ) AS z(id)
$$;

REVOKE ALL ON FUNCTION pld_ids_que_me_excluyen() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pld_ids_que_me_excluyen() TO plataforma_sofipo;

-- El portal del cliente no lee nada de PLD en su bitácora (55ª), además de lo que ya ocultaba la 0028.
DROP POLICY audit_log_cliente_lectura ON audit_log;
CREATE POLICY audit_log_cliente_lectura ON audit_log FOR SELECT TO plataforma_cliente
  USING (
    company_id = app_empresa()
    AND entidad NOT LIKE 'kyb\_%' AND entidad NOT LIKE 'lpb\_%' AND entidad NOT LIKE 'pld\_%'
    AND entidad <> 'company_suspensions'
    AND accion NOT LIKE 'expediente\_%' AND accion NOT LIKE 'pld\_%'
  );

-- En el personal, los eventos de PLD los leen solo Cumplimiento y Auditoría, y
-- nunca la persona excluida de un aviso. Administración, Originación y Aprobación
-- no (55ª). Lo demás, como lo dejó la 0028.
DROP POLICY audit_log_sofipo_lectura ON audit_log;
CREATE POLICY audit_log_sofipo_lectura ON audit_log FOR SELECT TO plataforma_sofipo
  USING (
    operator_id = app_operador()
    AND (
      (
        accion LIKE 'pld\_%'
        AND (SELECT pld_rol(ARRAY['cumplimiento', 'auditoria']))
        AND NOT coalesce(identificador = ANY ((SELECT pld_ids_que_me_excluyen())::uuid[]), false)
      )
      OR (
        accion NOT LIKE 'pld\_%'
        AND (
          company_id IS NULL
          OR NOT (accion LIKE 'lpb\_%' OR accion = 'empresa_suspendida_lpb')
          OR (SELECT personal_tiene_rol(app_operador(), app_usuario(), ARRAY['cumplimiento', 'auditoria']))
        )
      )
    )
  );

-- Higiene de permisos: ninguna función de PLD se ejecuta por PUBLIC. Las de disparador
-- no necesitan EXECUTE para dispararse (Postgres solo lo revisa al crear el disparador).
-- De las demás, plataforma_sofipo conserva las que ya tenía y recibe las tres que
-- usan sus CHECK y sus disparadores de invocador; app, cliente y tarea, ninguna.
DO $$
DECLARE
  funcion regprocedure;
BEGIN
  FOR funcion IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'pld\_%' LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', funcion);
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION pld_fecha_mx(timestamptz), pld_sin_invisibles(text), pld_nombre_de_integrante(pld_comite_integrantes) TO plataforma_sofipo;
