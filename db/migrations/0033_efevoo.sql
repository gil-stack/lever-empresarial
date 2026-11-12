-- Efevoo Pay: el emisor de las tarjetas. Tres tablas:
--   efevoo_clientes     el vínculo de la empresa con su cliente en Efevoo (idepCliente);
--   efevoo_tarjetas     las tarjetas de la empresa: el id de Efevoo, la terminación,
--                       el nombre en la tarjeta, el empleado (opcional) y su estado;
--   efevoo_operaciones  todo lo que se le pide a Efevoo: se asienta primero en
--                       `pendiente`, con su referencia de 7 dígitos y la llave de
--                       intento del formulario, y solo después se llama a Efevoo.
--
-- Efevoo no tiene idempotencia ni rechaza referencias repetidas (medido en el
-- sandbox, docs/evidencia/efevoo/investigacion.md): la idempotencia es de Lever.
-- Una operación solo se inserta; su estado cambia únicamente con
-- efevoo_resolver_operacion, y el vínculo y las tarjetas solo se escriben ahí.
-- Cada operación deja su evento en la bitácora en la misma transacción.
-- Nada se borra. No se guarda el número completo de la tarjeta, ni el CVV, ni
-- los datos personales del titular: solo la terminación y el nombre en la tarjeta.

SET search_path TO public;

-- Quién puede ---------------------------------------------------------------------

-- Personal vigente de administración de la plataforma, del operador del contexto.
CREATE FUNCTION efevoo_es_administracion(p_operador uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_usuario() IS NOT NULL AND p_operador = app_operador() AND EXISTS (
    SELECT 1
      FROM platform_staff s
      JOIN platform_staff_roles r ON r.operator_id = s.operator_id AND r.user_id = s.user_id
     WHERE s.operator_id = p_operador AND s.user_id = app_usuario() AND s.estado = 'activo'
       AND r.rol = 'administracion_plataforma'
  )
$$;

REVOKE ALL ON FUNCTION efevoo_es_administracion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efevoo_es_administracion(uuid) TO plataforma_sofipo, plataforma_cliente;

-- Miembro vigente de la empresa del contexto con alguno de los roles.
CREATE FUNCTION efevoo_miembro_con_rol(p_company uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_usuario() IS NOT NULL AND cliente_tiene_rol_operativo(p_company, app_usuario(), p_roles)
$$;

REVOKE ALL ON FUNCTION efevoo_miembro_con_rol(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efevoo_miembro_con_rol(uuid, text[]) TO plataforma_cliente, plataforma_sofipo;

-- Ve todas las tarjetas de la empresa quien abre Tarjetas en el portal:
-- administración, liberación y finanzas. El tarjetahabiente ve solo las suyas
-- (efevoo_tarjeta_del_titular); el contador y el solicitante, ninguna.
CREATE FUNCTION efevoo_ve_todas(p_company uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT efevoo_miembro_con_rol(p_company, ARRAY['administrador', 'liberador', 'finanzas'])
$$;

REVOKE ALL ON FUNCTION efevoo_ve_todas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efevoo_ve_todas(uuid) TO plataforma_cliente;

CREATE FUNCTION efevoo_no_se_borra()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'efevoo_no_se_borra';
END;
$$;

-- Vínculo empresa ↔ cliente de Efevoo -----------------------------------------------

CREATE TABLE efevoo_clientes (
  company_id uuid PRIMARY KEY,
  operator_id uuid NOT NULL,
  ambiente text NOT NULL,
  idep_cliente integer NOT NULL,
  operacion_id uuid NOT NULL,
  vinculado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  vinculado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT efevoo_clientes_empresa FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT efevoo_clientes_ambiente CHECK (ambiente IN ('sandbox', 'produccion')),
  CONSTRAINT efevoo_clientes_idep CHECK (idep_cliente > 0),
  CONSTRAINT efevoo_clientes_unico UNIQUE (ambiente, idep_cliente)
);

COMMENT ON TABLE efevoo_clientes IS
  'La empresa dada de alta en Efevoo Pay: su idepCliente y el ambiente. Lo escribe efevoo_resolver_operacion al confirmar el alta.';

-- Tarjetas -------------------------------------------------------------------------

CREATE TABLE efevoo_tarjetas (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  ambiente text NOT NULL,
  id_efevoo integer NOT NULL,
  employee_id uuid,
  terminacion text NOT NULL,
  nombre_tarjeta text NOT NULL,
  estado text NOT NULL,
  creada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  cancelada_en timestamptz,
  motivo_cancelacion text,
  CONSTRAINT efevoo_tarjetas_id_empresa UNIQUE (id, company_id),
  CONSTRAINT efevoo_tarjetas_empresa FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT efevoo_tarjetas_vinculo FOREIGN KEY (company_id) REFERENCES efevoo_clientes (company_id) ON DELETE RESTRICT,
  CONSTRAINT efevoo_tarjetas_empleado FOREIGN KEY (employee_id, company_id) REFERENCES employees (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT efevoo_tarjetas_ambiente CHECK (ambiente IN ('sandbox', 'produccion')),
  CONSTRAINT efevoo_tarjetas_id_efevoo CHECK (id_efevoo > 0),
  CONSTRAINT efevoo_tarjetas_unica UNIQUE (ambiente, id_efevoo),
  CONSTRAINT efevoo_tarjetas_terminacion CHECK (terminacion ~ '^[0-9]{4}$'),
  CONSTRAINT efevoo_tarjetas_nombre CHECK (nombre_tarjeta = btrim(nombre_tarjeta) AND char_length(nombre_tarjeta) BETWEEN 2 AND 26 AND nombre_tarjeta !~ '[[:cntrl:]]'),
  CONSTRAINT efevoo_tarjetas_estado CHECK (
    (estado IN ('asignada', 'activa', 'bloqueada') AND cancelada_en IS NULL AND motivo_cancelacion IS NULL)
    OR (estado = 'cancelada' AND cancelada_en IS NOT NULL AND motivo_cancelacion IS NOT NULL
        AND char_length(motivo_cancelacion) BETWEEN 5 AND 500 AND motivo_cancelacion !~ '[[:cntrl:]]')
  )
);

CREATE INDEX efevoo_tarjetas_empresa_idx ON efevoo_tarjetas (company_id, estado, creada_en);
CREATE INDEX efevoo_tarjetas_empleado_idx ON efevoo_tarjetas (employee_id) WHERE employee_id IS NOT NULL;
CREATE UNIQUE INDEX efevoo_tarjetas_una_por_activar ON efevoo_tarjetas (employee_id) WHERE estado = 'asignada' AND employee_id IS NOT NULL;

COMMENT ON TABLE efevoo_tarjetas IS
  'Tarjeta de Efevoo de la empresa. Solo la terminación y el nombre en la tarjeta; nunca el número completo, el CVV ni los datos del titular. La escribe efevoo_resolver_operacion.';

-- La tarjeta es del empleado ligado al usuario de la sesión, en la empresa del contexto.
CREATE FUNCTION efevoo_tarjeta_del_titular(p_tarjeta uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_usuario() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM efevoo_tarjetas t
      JOIN employees e ON e.id = t.employee_id AND e.company_id = t.company_id
      JOIN memberships m ON m.company_id = t.company_id AND m.user_id = e.user_id AND m.estado = 'activa'
     WHERE t.id = p_tarjeta AND t.company_id = app_empresa() AND e.user_id = app_usuario()
       AND (e.baja_en IS NULL OR e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
  )
$$;

-- Un empleado de la empresa sin baja vigente. El personal no lee employees:
-- esta puerta solo responde sí o no.
CREATE FUNCTION efevoo_empleado_activo(p_company uuid, p_employee uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees e
     WHERE e.id = p_employee AND e.company_id = p_company
       AND (e.baja_en IS NULL OR e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
  )
$$;

REVOKE ALL ON FUNCTION efevoo_empleado_activo(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efevoo_empleado_activo(uuid, uuid) TO plataforma_sofipo, plataforma_cliente;

-- Para asignar una tarjeta: los empleados activos de una empresa del operador,
-- solo id y nombre. Solo administración de la plataforma.
CREATE FUNCTION efevoo_empleados_asignables(p_company uuid)
RETURNS TABLE (id uuid, nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT efevoo_es_administracion((SELECT c.operator_id FROM companies c WHERE c.id = p_company)) THEN
    RAISE EXCEPTION 'sin_permiso_para_efevoo';
  END IF;
  RETURN QUERY
    SELECT e.id, e.nombre FROM employees e
     WHERE e.company_id = p_company
       AND (e.baja_en IS NULL OR e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
     ORDER BY lower(e.nombre), e.id;
END;
$$;

REVOKE ALL ON FUNCTION efevoo_empleados_asignables(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efevoo_empleados_asignables(uuid) TO plataforma_sofipo;

REVOKE ALL ON FUNCTION efevoo_tarjeta_del_titular(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efevoo_tarjeta_del_titular(uuid) TO plataforma_cliente;

-- Operaciones ------------------------------------------------------------------------

-- Referencia de Efevoo: exactamente 7 dígitos, única en Lever. Un consecutivo
-- que empieza en 1000001: nunca tiene ceros a la izquierda.
CREATE SEQUENCE efevoo_referencias AS integer MINVALUE 1000001 MAXVALUE 9999999 START 1000001 NO CYCLE;

CREATE TABLE efevoo_operaciones (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  ambiente text NOT NULL,
  tipo text NOT NULL,
  tarjeta_id uuid,
  -- Asignación: el id del plástico en el inventario de Efevoo, su terminación, el empleado y el nombre en la tarjeta.
  tarjeta_inventario integer,
  terminacion text,
  employee_id uuid,
  nombre_tarjeta text,
  monto_centavos bigint,
  referencia text NOT NULL DEFAULT (nextval('efevoo_referencias'::regclass))::text,
  llave_intento uuid NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  -- Depósito de prueba: el saldo de la empresa en Efevoo antes de pedirlo. clientBalance no lleva referencia y se concilia con él.
  saldo_previo_centavos bigint,
  motivo text,
  reintento_de uuid REFERENCES efevoo_operaciones (id) ON DELETE RESTRICT,
  -- El id que dio Efevoo al responder: el idepCliente del alta, el id de la tarjeta
  -- asignada, o el id de la respuesta de fundCard/unfundCard (su propia serie).
  id_efevoo text,
  -- El IDMovimiento de getTransactionsCard (otra serie) o el id del movimiento de
  -- balanceMovements, cuando la operación se encontró al conciliarla.
  id_movimiento_efevoo text,
  codigo_efevoo text,
  actor_tipo text NOT NULL,
  creada_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT now(),
  resuelta_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  resuelta_en timestamptz,
  CONSTRAINT efevoo_operaciones_id_empresa UNIQUE (id, company_id),
  CONSTRAINT efevoo_operaciones_empresa FOREIGN KEY (company_id, operator_id) REFERENCES companies (id, operator_id) ON DELETE RESTRICT,
  CONSTRAINT efevoo_operaciones_tarjeta FOREIGN KEY (tarjeta_id, company_id) REFERENCES efevoo_tarjetas (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT efevoo_operaciones_empleado FOREIGN KEY (employee_id, company_id) REFERENCES employees (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT efevoo_operaciones_referencia UNIQUE (referencia),
  CONSTRAINT efevoo_operaciones_referencia_forma CHECK (referencia ~ '^[1-9][0-9]{6}$'),
  CONSTRAINT efevoo_operaciones_intento UNIQUE (company_id, llave_intento),
  CONSTRAINT efevoo_operaciones_reintento_unico UNIQUE (reintento_de),
  CONSTRAINT efevoo_operaciones_ambiente CHECK (ambiente IN ('sandbox', 'produccion')),
  CONSTRAINT efevoo_operaciones_actor CHECK (actor_tipo IN ('personal', 'miembro')),
  CONSTRAINT efevoo_operaciones_tipo CHECK (tipo IN (
    'alta_cliente', 'deposito_prueba', 'asignacion', 'activacion', 'asignacion_cliente',
    'carga', 'retiro', 'bloqueo', 'desbloqueo', 'cancelacion'
  )),
  CONSTRAINT efevoo_operaciones_forma CHECK (
    CASE tipo
      WHEN 'alta_cliente' THEN tarjeta_id IS NULL AND monto_centavos IS NULL AND tarjeta_inventario IS NULL
      WHEN 'deposito_prueba' THEN tarjeta_id IS NULL AND tarjeta_inventario IS NULL AND ambiente = 'sandbox'
        AND monto_centavos BETWEEN 1 AND 999999999999
      WHEN 'asignacion' THEN tarjeta_id IS NULL AND monto_centavos IS NULL AND tarjeta_inventario > 0
        AND terminacion ~ '^[0-9]{4}$' AND nombre_tarjeta IS NOT NULL AND nombre_tarjeta = btrim(nombre_tarjeta)
        AND char_length(nombre_tarjeta) BETWEEN 2 AND 26 AND nombre_tarjeta !~ '[[:cntrl:]]'
      WHEN 'carga' THEN tarjeta_id IS NOT NULL AND tarjeta_inventario IS NULL AND monto_centavos BETWEEN 1 AND 999999999999
      WHEN 'retiro' THEN tarjeta_id IS NOT NULL AND tarjeta_inventario IS NULL AND monto_centavos BETWEEN 1 AND 999999999999
      WHEN 'cancelacion' THEN tarjeta_id IS NOT NULL AND tarjeta_inventario IS NULL AND monto_centavos IS NULL
        AND motivo IS NOT NULL AND char_length(motivo) BETWEEN 5 AND 500 AND motivo !~ '[[:cntrl:]]'
      ELSE tarjeta_id IS NOT NULL AND tarjeta_inventario IS NULL AND monto_centavos IS NULL
    END
    AND (tipo = 'asignacion' OR (terminacion IS NULL AND employee_id IS NULL AND nombre_tarjeta IS NULL))
    AND (tipo = 'cancelacion' OR motivo IS NULL)
    AND (tipo = 'deposito_prueba' OR saldo_previo_centavos IS NULL)
  ),
  CONSTRAINT efevoo_operaciones_estado CHECK (
    (estado = 'pendiente' AND resuelta_por IS NULL AND resuelta_en IS NULL AND id_efevoo IS NULL AND id_movimiento_efevoo IS NULL AND codigo_efevoo IS NULL)
    OR (estado IN ('confirmada', 'fallida', 'incierta') AND resuelta_en IS NOT NULL)
  ),
  CONSTRAINT efevoo_operaciones_id_efevoo CHECK (id_efevoo IS NULL OR id_efevoo ~ '^[0-9]{1,18}$'),
  CONSTRAINT efevoo_operaciones_id_movimiento CHECK (id_movimiento_efevoo IS NULL OR id_movimiento_efevoo ~ '^[1-9][0-9]{0,17}$'),
  CONSTRAINT efevoo_operaciones_codigo CHECK (codigo_efevoo IS NULL OR codigo_efevoo ~ '^[a-z0-9_]{1,32}$')
);

-- Una sola operación abierta (pendiente o incierta) a la vez: de dinero por
-- tarjeta (carga y retiro), de estado por tarjeta (activar, bloquear,
-- desbloquear y pasarla a la empresa), una cancelación por tarjeta, una por
-- plástico del inventario y, en el alta y el depósito, una por empresa. Un
-- segundo intento con otra llave espera a que se resuelva o se concilie el
-- primero. Van separadas para que una carga sin respuesta de Efevoo no impida
-- bloquear ni cancelar una tarjeta robada.
CREATE UNIQUE INDEX efevoo_operaciones_abierta_dinero ON efevoo_operaciones (tarjeta_id)
  WHERE estado IN ('pendiente', 'incierta') AND tipo IN ('carga', 'retiro');
CREATE UNIQUE INDEX efevoo_operaciones_abierta_estado ON efevoo_operaciones (tarjeta_id)
  WHERE estado IN ('pendiente', 'incierta') AND tipo IN ('activacion', 'asignacion_cliente', 'bloqueo', 'desbloqueo');
CREATE UNIQUE INDEX efevoo_operaciones_abierta_cancelacion ON efevoo_operaciones (tarjeta_id)
  WHERE estado IN ('pendiente', 'incierta') AND tipo = 'cancelacion';
-- Un empleado puede tener varias tarjetas (viáticos, combustible, virtuales), pero no recibe otra mientras
-- tenga una asignación abierta o una tarjeta asignada sin activar (decisión del líder, PC2-2).
CREATE UNIQUE INDEX efevoo_operaciones_asignacion_por_empleado ON efevoo_operaciones (employee_id)
  WHERE estado IN ('pendiente', 'incierta') AND tipo = 'asignacion' AND employee_id IS NOT NULL;
CREATE UNIQUE INDEX efevoo_operaciones_abierta_inventario ON efevoo_operaciones (ambiente, tarjeta_inventario)
  WHERE estado IN ('pendiente', 'incierta') AND tarjeta_inventario IS NOT NULL;
CREATE UNIQUE INDEX efevoo_operaciones_abierta_empresa ON efevoo_operaciones (company_id, tipo)
  WHERE estado IN ('pendiente', 'incierta') AND tipo IN ('alta_cliente', 'deposito_prueba');
CREATE INDEX efevoo_operaciones_lista ON efevoo_operaciones (company_id, creada_en DESC);
CREATE INDEX efevoo_operaciones_por_tarjeta ON efevoo_operaciones (tarjeta_id, creada_en DESC) WHERE tarjeta_id IS NOT NULL;

COMMENT ON TABLE efevoo_operaciones IS
  'Cada cosa que Lever le pide a Efevoo, asentada antes de llamarlo. Solo inserción; el estado cambia con efevoo_resolver_operacion. Referencia de 7 dígitos y llave de intento únicas.';

-- Quién asienta qué. Corre como quien inserta (no es definer): current_user
-- dice si es el portal del cliente o el personal; las preguntas de permiso son definers.
CREATE FUNCTION efevoo_operaciones_revisar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  previa efevoo_operaciones%ROWTYPE;
  empresa companies%ROWTYPE;
  vinculo efevoo_clientes%ROWTYPE;
  tarjeta efevoo_tarjetas%ROWTYPE;
  anterior efevoo_operaciones%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'efevoo_no_se_borra';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Solo la transición de efevoo_resolver_operacion, que marca la transacción.
    IF current_setting('efevoo.resolviendo', true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'efevoo_operacion_inmutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado <> 'pendiente' OR NEW.resuelta_por IS NOT NULL OR NEW.resuelta_en IS NOT NULL
     OR NEW.id_efevoo IS NOT NULL OR NEW.id_movimiento_efevoo IS NOT NULL OR NEW.codigo_efevoo IS NOT NULL THEN
    RAISE EXCEPTION 'efevoo_operacion_no_valida';
  END IF;
  IF app_usuario() IS NULL OR NEW.creada_por IS DISTINCT FROM app_usuario() THEN
    RAISE EXCEPTION 'sin_permiso_para_efevoo';
  END IF;
  SELECT * INTO empresa FROM companies c WHERE c.id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin_permiso_para_efevoo';
  END IF;
  -- La hora y el operador los pone la base.
  NEW.operator_id := empresa.operator_id;
  NEW.creada_en := now();
  IF NEW.referencia !~ '^[1-9][0-9]{6}$' OR NEW.referencia IS DISTINCT FROM (currval('efevoo_referencias'::regclass))::text THEN
    -- La referencia la da el consecutivo, nunca quien escribe.
    RAISE EXCEPTION 'efevoo_operacion_no_valida';
  END IF;

  IF current_user = 'plataforma_sofipo' THEN
    IF NEW.actor_tipo <> 'personal' OR NOT efevoo_es_administracion(empresa.operator_id) THEN
      RAISE EXCEPTION 'sin_permiso_para_efevoo';
    END IF;
    IF NEW.tipo NOT IN ('alta_cliente', 'deposito_prueba', 'asignacion', 'activacion', 'asignacion_cliente', 'cancelacion') THEN
      RAISE EXCEPTION 'sin_permiso_para_efevoo';
    END IF;
    -- Una empresa suspendida o dada de baja solo admite la cancelación de sus tarjetas.
    IF empresa.estado IN ('suspendida', 'baja') AND NEW.tipo <> 'cancelacion' THEN
      RAISE EXCEPTION 'empresa_suspendida';
    END IF;
  ELSIF current_user = 'plataforma_cliente' THEN
    IF NEW.actor_tipo <> 'miembro' OR NEW.company_id IS DISTINCT FROM app_empresa() THEN
      RAISE EXCEPTION 'sin_permiso_para_efevoo';
    END IF;
    IF NEW.tipo IN ('carga', 'retiro', 'bloqueo', 'desbloqueo') THEN
      IF NOT efevoo_miembro_con_rol(NEW.company_id, ARRAY['administrador', 'liberador']) THEN
        RAISE EXCEPTION 'sin_permiso_para_efevoo';
      END IF;
    ELSIF NEW.tipo = 'cancelacion' THEN
      IF NOT efevoo_miembro_con_rol(NEW.company_id, ARRAY['administrador']) THEN
        RAISE EXCEPTION 'sin_permiso_para_efevoo';
      END IF;
    ELSE
      RAISE EXCEPTION 'sin_permiso_para_efevoo';
    END IF;
  ELSE
    RAISE EXCEPTION 'sin_permiso_para_efevoo';
  END IF;

  IF empresa.demostracion THEN
    RAISE EXCEPTION 'solo_empresas_reales';
  END IF;

  -- Idempotencia, después de los permisos (quien no puede asentar no recibe
  -- «ok» por repetir una llave ajena): la misma llave, de la misma persona y
  -- con los mismos datos, no inserta otra (quien llama lee la que ya estaba);
  -- con otros datos es un error. El candado por (empresa, llave) hace esperar a
  -- un segundo envío simultáneo hasta que el primero confirme: entonces lo ve
  -- (cada consulta toma su foto en READ COMMITTED) y regresa sin insertar.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text || ':' || NEW.llave_intento::text, 334033));
  SELECT * INTO previa FROM efevoo_operaciones o WHERE o.company_id = NEW.company_id AND o.llave_intento = NEW.llave_intento;
  IF FOUND THEN
    IF (previa.tipo, previa.tarjeta_id, previa.tarjeta_inventario, previa.monto_centavos, previa.employee_id, previa.reintento_de, previa.creada_por)
       IS NOT DISTINCT FROM (NEW.tipo, NEW.tarjeta_id, NEW.tarjeta_inventario, NEW.monto_centavos, NEW.employee_id, NEW.reintento_de, NEW.creada_por) THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'intento_con_otros_datos';
  END IF;

  SELECT * INTO vinculo FROM efevoo_clientes v WHERE v.company_id = NEW.company_id;
  IF NEW.tipo = 'alta_cliente' THEN
    IF FOUND THEN
      RAISE EXCEPTION 'empresa_ya_vinculada';
    END IF;
  ELSIF NOT FOUND THEN
    RAISE EXCEPTION 'empresa_sin_vinculo';
  ELSIF vinculo.ambiente <> NEW.ambiente THEN
    RAISE EXCEPTION 'efevoo_operacion_no_valida';
  END IF;

  IF NEW.tarjeta_id IS NOT NULL THEN
    SELECT * INTO tarjeta FROM efevoo_tarjetas t WHERE t.id = NEW.tarjeta_id AND t.company_id = NEW.company_id;
    IF NOT FOUND OR tarjeta.ambiente <> NEW.ambiente THEN
      RAISE EXCEPTION 'tarjeta_no_encontrada';
    END IF;
    IF NOT (CASE NEW.tipo
      WHEN 'activacion' THEN tarjeta.estado = 'asignada'
      WHEN 'asignacion_cliente' THEN tarjeta.estado IN ('asignada', 'activa')
      WHEN 'carga' THEN tarjeta.estado = 'activa'
      WHEN 'retiro' THEN tarjeta.estado = 'activa'
      WHEN 'bloqueo' THEN tarjeta.estado = 'activa'
      WHEN 'desbloqueo' THEN tarjeta.estado = 'bloqueada'
      WHEN 'cancelacion' THEN tarjeta.estado <> 'cancelada'
      ELSE false
    END) THEN
      RAISE EXCEPTION 'tarjeta_en_otro_estado';
    END IF;
    IF NEW.tipo <> 'cancelacion' AND EXISTS (
      SELECT 1 FROM efevoo_operaciones o
       WHERE o.tarjeta_id = NEW.tarjeta_id AND o.tipo = 'cancelacion' AND o.estado IN ('pendiente', 'incierta')
    ) THEN
      RAISE EXCEPTION 'tarjeta_en_cancelacion';
    END IF;
  END IF;

  IF NEW.tipo = 'asignacion' THEN
    IF EXISTS (SELECT 1 FROM efevoo_tarjetas t WHERE t.ambiente = NEW.ambiente AND t.id_efevoo = NEW.tarjeta_inventario) THEN
      RAISE EXCEPTION 'tarjeta_ya_asignada';
    END IF;
    IF NEW.employee_id IS NOT NULL AND NOT efevoo_empleado_activo(NEW.company_id, NEW.employee_id) THEN
      RAISE EXCEPTION 'empleado_no_activo';
    END IF;
    IF NEW.employee_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM efevoo_tarjetas t WHERE t.employee_id = NEW.employee_id AND t.estado = 'asignada')
      OR EXISTS (SELECT 1 FROM efevoo_operaciones o WHERE o.employee_id = NEW.employee_id AND o.tipo = 'asignacion' AND o.estado IN ('pendiente', 'incierta'))
    ) THEN
      RAISE EXCEPTION 'empleado_con_tarjeta_por_activar';
    END IF;
  END IF;

  -- Un reintento sale de una operación fallida igual (tipo, tarjeta, plástico y monto).
  IF NEW.reintento_de IS NOT NULL THEN
    SELECT * INTO anterior FROM efevoo_operaciones o WHERE o.id = NEW.reintento_de AND o.company_id = NEW.company_id;
    IF NOT FOUND OR anterior.estado <> 'fallida' OR anterior.codigo_efevoo = 'cierre_manual'
       OR (anterior.tipo, anterior.tarjeta_id, anterior.tarjeta_inventario, anterior.monto_centavos)
          IS DISTINCT FROM (NEW.tipo, NEW.tarjeta_id, NEW.tarjeta_inventario, NEW.monto_centavos) THEN
      RAISE EXCEPTION 'reintento_no_valido';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER efevoo_operaciones_revisar
BEFORE INSERT OR UPDATE OR DELETE ON efevoo_operaciones
FOR EACH ROW EXECUTE FUNCTION efevoo_operaciones_revisar();

CREATE TRIGGER efevoo_clientes_no_se_borra BEFORE DELETE ON efevoo_clientes
FOR EACH ROW EXECUTE FUNCTION efevoo_no_se_borra();
CREATE TRIGGER efevoo_tarjetas_no_se_borra BEFORE DELETE ON efevoo_tarjetas
FOR EACH ROW EXECUTE FUNCTION efevoo_no_se_borra();

-- La transición --------------------------------------------------------------------
-- pendiente → confirmada | fallida | incierta; incierta → confirmada | fallida
-- (la conciliación). Al confirmar: el alta crea el vínculo, la asignación crea la
-- tarjeta, y activar, bloquear, desbloquear y cancelar cambian su estado. Puede
-- resolverla el personal de administración del operador, o en la empresa quien
-- puede asentar ese tipo. Quien llama deja el evento en la bitácora en la misma transacción.
CREATE FUNCTION efevoo_resolver_operacion(p_id uuid, p_estado text, p_id_efevoo text, p_codigo text, p_id_movimiento text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  op efevoo_operaciones%ROWTYPE;
  puede boolean;
BEGIN
  SELECT * INTO op FROM efevoo_operaciones o WHERE o.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operacion_no_encontrada';
  END IF;
  puede := efevoo_es_administracion(op.operator_id)
    OR (op.company_id = app_empresa() AND op.actor_tipo = 'miembro' AND CASE
          WHEN op.tipo IN ('carga', 'retiro', 'bloqueo', 'desbloqueo') THEN efevoo_miembro_con_rol(op.company_id, ARRAY['administrador', 'liberador'])
          WHEN op.tipo = 'cancelacion' THEN efevoo_miembro_con_rol(op.company_id, ARRAY['administrador'])
          ELSE false
        END);
  IF NOT coalesce(puede, false) THEN
    RAISE EXCEPTION 'sin_permiso_para_efevoo';
  END IF;
  IF NOT ((op.estado = 'pendiente' AND p_estado IN ('confirmada', 'fallida', 'incierta'))
          OR (op.estado = 'incierta' AND p_estado IN ('confirmada', 'fallida'))) THEN
    RAISE EXCEPTION 'transicion_no_valida';
  END IF;
  -- Una incierta solo falla porque no apareció en Efevoo, y eso solo se concluye
  -- 10 minutos después de asentarla: antes, Efevoo podría estar procesándola
  -- todavía y un reintento sería un doble cargo. Lo mismo para una pendiente que
  -- se quedó sin resolver (la llamada se cortó antes de anotar el resultado).
  IF op.estado = 'incierta' AND p_estado = 'fallida' AND p_codigo IS DISTINCT FROM 'no_aparecio' AND p_codigo IS DISTINCT FROM 'cierre_manual' THEN
    RAISE EXCEPTION 'transicion_no_valida';
  END IF;
  -- Cierre manual (PC2-4): una operación abierta sobre una tarjeta CANCELADA, que la conciliación ya no puede
  -- leer, la cierra Administración de la plataforma a los 10 minutos, con motivo (en su evento). El resultado en
  -- Efevoo queda desconocido: por eso no se puede reintentar (sería cargar dos veces lo que sí pasó).
  IF p_codigo = 'cierre_manual' AND (
    p_estado <> 'fallida' OR op.estado NOT IN ('pendiente', 'incierta') OR NOT efevoo_es_administracion(op.operator_id)
    OR clock_timestamp() < op.creada_en + interval '10 minutes'
    OR NOT EXISTS (SELECT 1 FROM efevoo_tarjetas t WHERE t.id = op.tarjeta_id AND t.estado = 'cancelada')
  ) THEN
    RAISE EXCEPTION 'cierre_manual_no_valido';
  END IF;
  IF p_codigo = 'no_aparecio' AND (p_estado <> 'fallida' OR clock_timestamp() < op.creada_en + interval '10 minutes') THEN
    RAISE EXCEPTION 'conciliacion_prematura';
  END IF;
  IF p_estado = 'confirmada' AND op.tipo IN ('alta_cliente', 'asignacion') AND (p_id_efevoo IS NULL OR p_id_efevoo !~ '^[1-9][0-9]{0,8}$') THEN
    RAISE EXCEPTION 'efevoo_operacion_no_valida';
  END IF;
  -- Una carga o un retiro confirmados llevan el id positivo de Efevoo: un id 0 es el falso éxito.
  IF p_estado = 'confirmada' AND op.tipo IN ('carga', 'retiro')
     AND coalesce(p_id_efevoo, '') !~ '^[1-9][0-9]{0,17}$' AND coalesce(p_id_movimiento, '') !~ '^[1-9][0-9]{0,17}$' THEN
    RAISE EXCEPTION 'efevoo_operacion_no_valida';
  END IF;
  -- Una pendiente solo falla por un rechazo que diga que Efevoo no hizo nada
  -- (los mismos del ciclo, RECHAZOS_DEFINITIVOS en src/server/efevoo/operaciones.ts)
  -- o porque no apareció a los 10 minutos. Cualquier otro código la deja incierta.
  IF op.estado = 'pendiente' AND p_estado = 'fallida' AND p_codigo IS DISTINCT FROM 'no_aparecio' AND p_codigo IS DISTINCT FROM 'cierre_manual'
     AND (p_codigo IS NULL OR NOT p_codigo = ANY (ARRAY[
       'validacion', 'id_cero', '115', '122', '101', '163', '112', '401',
       'saldo_insuficiente', 'sin_tarjeta', 'tarjeta_sin_titular', 'sin_vinculo', 'sin_monto'
     ])) THEN
    RAISE EXCEPTION 'transicion_no_valida';
  END IF;

  PERFORM set_config('efevoo.resolviendo', p_id::text, true);
  UPDATE efevoo_operaciones
     SET estado = p_estado, id_efevoo = p_id_efevoo, id_movimiento_efevoo = p_id_movimiento, codigo_efevoo = p_codigo,
         resuelta_por = app_usuario(), resuelta_en = now()
   WHERE id = p_id;
  PERFORM set_config('efevoo.resolviendo', '', true);

  IF p_estado <> 'confirmada' THEN
    RETURN;
  END IF;
  CASE op.tipo
    WHEN 'alta_cliente' THEN
      INSERT INTO efevoo_clientes (company_id, operator_id, ambiente, idep_cliente, operacion_id, vinculado_por)
      VALUES (op.company_id, op.operator_id, op.ambiente, p_id_efevoo::integer, op.id, op.creada_por);
    WHEN 'asignacion' THEN
      INSERT INTO efevoo_tarjetas (id, company_id, operator_id, ambiente, id_efevoo, employee_id, terminacion, nombre_tarjeta, estado, creada_por)
      VALUES (gen_random_uuid(), op.company_id, op.operator_id, op.ambiente, p_id_efevoo::integer, op.employee_id,
              op.terminacion, op.nombre_tarjeta, 'asignada', op.creada_por);
    WHEN 'activacion' THEN
      UPDATE efevoo_tarjetas SET estado = 'activa', actualizada_en = now() WHERE id = op.tarjeta_id;
    WHEN 'bloqueo' THEN
      UPDATE efevoo_tarjetas SET estado = 'bloqueada', actualizada_en = now() WHERE id = op.tarjeta_id;
    WHEN 'desbloqueo' THEN
      UPDATE efevoo_tarjetas SET estado = 'activa', actualizada_en = now() WHERE id = op.tarjeta_id;
    WHEN 'cancelacion' THEN
      UPDATE efevoo_tarjetas SET estado = 'cancelada', actualizada_en = now(), cancelada_en = now(), motivo_cancelacion = op.motivo
       WHERE id = op.tarjeta_id;
    ELSE
      NULL;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION efevoo_resolver_operacion(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efevoo_resolver_operacion(uuid, text, text, text, text) TO plataforma_sofipo, plataforma_cliente;

-- Bitácora en la misma transacción ---------------------------------------------------

CREATE FUNCTION efevoo_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT bitacora_tiene_evento(NEW.company_id, NULL, 'efevoo_operaciones', NEW.id) THEN
    RAISE EXCEPTION 'auditoria_de_efevoo_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER efevoo_operaciones_auditoria
AFTER INSERT OR UPDATE ON efevoo_operaciones DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION efevoo_exige_auditoria();

-- Permisos mínimos y RLS --------------------------------------------------------

GRANT SELECT ON efevoo_clientes, efevoo_tarjetas TO plataforma_cliente, plataforma_sofipo;
GRANT SELECT, INSERT ON efevoo_operaciones TO plataforma_cliente, plataforma_sofipo;
GRANT USAGE ON SEQUENCE efevoo_referencias TO plataforma_cliente, plataforma_sofipo;

ALTER TABLE efevoo_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE efevoo_tarjetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE efevoo_operaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE efevoo_clientes FORCE ROW LEVEL SECURITY;
ALTER TABLE efevoo_tarjetas FORCE ROW LEVEL SECURITY;
ALTER TABLE efevoo_operaciones FORCE ROW LEVEL SECURITY;

CREATE POLICY efevoo_clientes_cliente ON efevoo_clientes FOR SELECT TO plataforma_cliente
  USING (company_id = app_empresa());
CREATE POLICY efevoo_clientes_sofipo ON efevoo_clientes FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador());

-- El titular (tarjetahabiente) ve solo las tarjetas de su empleado; los demás roles, todas.
CREATE POLICY efevoo_tarjetas_cliente ON efevoo_tarjetas FOR SELECT TO plataforma_cliente
  USING (company_id = app_empresa() AND (efevoo_ve_todas(company_id) OR efevoo_tarjeta_del_titular(id)));
CREATE POLICY efevoo_tarjetas_sofipo ON efevoo_tarjetas FOR SELECT TO plataforma_sofipo
  USING (operator_id = app_operador());

CREATE POLICY efevoo_operaciones_cliente_lee ON efevoo_operaciones FOR SELECT TO plataforma_cliente
  USING (company_id = app_empresa() AND (efevoo_ve_todas(company_id) OR (tarjeta_id IS NOT NULL AND efevoo_tarjeta_del_titular(tarjeta_id))));
CREATE POLICY efevoo_operaciones_cliente_asienta ON efevoo_operaciones FOR INSERT TO plataforma_cliente
  WITH CHECK (company_id = app_empresa());
CREATE POLICY efevoo_operaciones_sofipo ON efevoo_operaciones FOR ALL TO plataforma_sofipo
  USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

-- Empresa suspendida -----------------------------------------------------------------
-- Mismo criterio que la 0031: bloqueo_empresa_suspendida a toda tabla con
-- company_id que plataforma_cliente escribe y que todavía no lo tenga.
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
