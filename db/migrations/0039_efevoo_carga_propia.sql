-- Hallazgo de seguridad (MEDIO): quien administra o libera en la empresa podía
-- cargar saldo de la empresa a su propia tarjeta, sin segunda persona ni tope.
-- Arreglo mínimo, sin flujo de aprobación nuevo: la base rechaza una carga
-- («carga», saldo de la empresa → tarjeta) cuando la persona titular de la
-- tarjeta (efevoo_tarjetas.employee_id → employees.user_id) es la misma que la
-- asienta (app_usuario()). El reintento de una carga también es una carga y
-- pasa por la misma regla. El retiro (tarjeta → empresa) no cambia.
--
-- La regla no mira la membresía ni la baja del empleado: basta con que la
-- tarjeta esté ligada a ese usuario. El servicio hace la misma pregunta antes
-- de asentar, para dar el mensaje en pantalla.

-- ¿La tarjeta es de este usuario? El portal no lee employees de otras
-- personas: esta puerta solo responde sí o no.
CREATE FUNCTION efevoo_tarjeta_es_de_usuario(p_tarjeta uuid, p_usuario uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_tarjeta IS NOT NULL AND p_usuario IS NOT NULL AND EXISTS (
    SELECT 1
      FROM efevoo_tarjetas t
      JOIN employees e ON e.id = t.employee_id AND e.company_id = t.company_id
     WHERE t.id = p_tarjeta AND e.user_id = p_usuario
  )
$$;

REVOKE ALL ON FUNCTION efevoo_tarjeta_es_de_usuario(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION efevoo_tarjeta_es_de_usuario(uuid, uuid) TO plataforma_cliente, plataforma_sofipo;

-- La misma función de 0033, con la regla nueva después de encontrar la tarjeta.
CREATE OR REPLACE FUNCTION efevoo_operaciones_revisar()
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
    -- 0039: nadie se carga saldo de la empresa a su propia tarjeta.
    IF NEW.tipo = 'carga' AND efevoo_tarjeta_es_de_usuario(NEW.tarjeta_id, app_usuario()) THEN
      RAISE EXCEPTION 'carga_a_tarjeta_propia';
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
