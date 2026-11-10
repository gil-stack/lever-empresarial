-- Cobranza: el directorio de clientes de la empresa, sus planes (fijo o
-- variable; mensual, bimestral, trimestral, semestral o anual), el cargo de
-- cada periodo, los correos de cobro con la CLABE de la empresa, los abonos
-- recibidos y su conciliación. Lever no mueve este dinero: va a la CLABE que
-- la empresa captura. Nada se borra; cancelar, omitir, archivar y anular
-- llevan motivo, y cada escritura deja su evento en la misma transacción.
--
-- No depende de 0028 ni de 0030: puede aplicarse antes o después de ellas.

SET search_path TO public;

-- Ayudantes ------------------------------------------------------------------------

-- Texto de una persona: sin espacios en las orillas, sin caracteres de control y con su largo.
CREATE FUNCTION cobranza_texto(p text, p_min integer, p_max integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p = btrim(p) AND char_length(p) BETWEEN p_min AND p_max AND p !~ '[[:cntrl:]]'
$$;

-- Un correo en minúsculas, sin espacios ni signos que rompan un encabezado.
CREATE FUNCTION cobranza_correo_valido(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p IS NOT NULL AND char_length(p) <= 254 AND p = lower(p)
    AND p ~ '^[^[:space:][:cntrl:]@<>",;:()\[\]\\]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
$$;

-- De uno a tres correos distintos.
CREATE FUNCTION cobranza_correos_validos(p text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p IS NOT NULL AND array_ndims(p) = 1 AND cardinality(p) BETWEEN 1 AND 3
    AND NOT EXISTS (SELECT 1 FROM unnest(p) AS c WHERE NOT cobranza_correo_valido(c))
    AND (SELECT count(DISTINCT c) FROM unnest(p) AS c) = cardinality(p)
$$;

-- Referencia numérica de 7 dígitos (el campo «referencia» de SPEI): 6 de un
-- consecutivo por empresa y un dígito de Luhn. Un dígito tecleado mal no cae
-- en el cargo de otro cliente.
CREATE FUNCTION cobranza_referencia_valida(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p ~ '^[0-9]{7}$' AND (
    SELECT sum(CASE WHEN i % 2 = 0 THEN d * 2 - CASE WHEN d * 2 > 9 THEN 9 ELSE 0 END ELSE d END) % 10 = 0
    FROM (SELECT i, substr(p, i, 1)::integer AS d FROM generate_series(1, 7) AS i) AS digitos
  )
$$;

-- Quién escribe: una persona de administración o finanzas de la empresa del
-- contexto (flujo_editor, 0026) y que firma como autor; o el sistema, una
-- tarea con la empresa en el contexto y sin persona (el cron con CRON_SECRET
-- o el enlace del pagador), que deja el autor vacío.
CREATE FUNCTION cobranza_autor_valido(p_company uuid, p_autor uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN app_usuario() IS NULL THEN p_autor IS NULL AND p_company = app_empresa()
    ELSE coalesce(p_autor = app_usuario(), false) AND flujo_editor(p_company)
  END
$$;

REVOKE ALL ON FUNCTION cobranza_autor_valido(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cobranza_autor_valido(uuid, uuid) TO plataforma_cliente;

CREATE FUNCTION cobranza_no_se_borra()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cobranza_no_se_borra';
END;
$$;

-- Configuración --------------------------------------------------------------------

CREATE TABLE collection_settings (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  origen_clabe text NOT NULL DEFAULT 'capturada',
  clabe text NOT NULL,
  beneficiario text NOT NULL,
  correo_contacto text,
  emitir_dias_antes smallint NOT NULL DEFAULT 7,
  antes_dias smallint NOT NULL DEFAULT 3,
  aviso_el_dia boolean NOT NULL DEFAULT true,
  despues_cada_dias smallint NOT NULL DEFAULT 7,
  despues_tope smallint NOT NULL DEFAULT 3,
  envio_automatico boolean NOT NULL DEFAULT true,
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  -- La cuenta de la empresa en la SOFIPO entra como otro origen, con su migración, cuando exista.
  CONSTRAINT collection_settings_origen CHECK (origen_clabe IN ('capturada')),
  CONSTRAINT collection_settings_clabe CHECK (clabe ~ '^[0-9]{18}$' AND clabe_digito_371(clabe)),
  CONSTRAINT collection_settings_beneficiario CHECK (cobranza_texto(beneficiario, 2, 120)),
  CONSTRAINT collection_settings_contacto CHECK (correo_contacto IS NULL OR cobranza_correo_valido(correo_contacto)),
  CONSTRAINT collection_settings_emitir CHECK (emitir_dias_antes BETWEEN 0 AND 30),
  -- 0 = sin recordatorio previo. El previo va después del cobro, nunca antes.
  CONSTRAINT collection_settings_antes CHECK (antes_dias BETWEEN 0 AND 15 AND (antes_dias = 0 OR antes_dias < emitir_dias_antes)),
  CONSTRAINT collection_settings_despues CHECK (despues_cada_dias BETWEEN 1 AND 30 AND despues_tope BETWEEN 0 AND 6)
);

COMMENT ON TABLE collection_settings IS
  'Cobranza de la empresa: la CLABE donde recibe los pagos de sus clientes (capturada y validada), su beneficiario, su contacto y el calendario de recordatorios.';

CREATE FUNCTION collection_settings_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF app_usuario() IS NULL OR NEW.actualizado_por IS DISTINCT FROM app_usuario() OR NOT flujo_editor(NEW.company_id) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_settings_revisar
BEFORE INSERT OR UPDATE ON collection_settings
FOR EACH ROW EXECUTE FUNCTION collection_settings_revisar();

-- Clientes -------------------------------------------------------------------------

CREATE TABLE collection_customers (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  rfc text,
  correos text[] NOT NULL,
  estado text NOT NULL DEFAULT 'activo',
  motivo_archivo text,
  -- Recordatorios: el cobro inicial siempre sale; los recordatorios se apagan por la empresa o a petición del pagador.
  recordatorios boolean NOT NULL DEFAULT true,
  recordatorios_por text,
  recordatorios_cambio_en timestamptz,
  creado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_customers_id_empresa UNIQUE (id, company_id),
  CONSTRAINT collection_customers_nombre CHECK (cobranza_texto(nombre, 1, 254)),
  CONSTRAINT collection_customers_rfc CHECK (rfc IS NULL OR rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT collection_customers_correos CHECK (cobranza_correos_validos(correos)),
  CONSTRAINT collection_customers_estado CHECK (
    (estado = 'activo' AND motivo_archivo IS NULL)
    OR (estado = 'archivado' AND motivo_archivo IS NOT NULL AND cobranza_texto(motivo_archivo, 5, 500))
  ),
  CONSTRAINT collection_customers_recordatorios CHECK (
    (recordatorios_por IS NULL) = (recordatorios_cambio_en IS NULL)
    AND (recordatorios_por IS NULL OR recordatorios_por IN ('empresa', 'pagador'))
    AND (recordatorios OR recordatorios_por IS NOT NULL)
  )
);

CREATE UNIQUE INDEX collection_customers_rfc_activo
  ON collection_customers (company_id, rfc) WHERE rfc IS NOT NULL AND estado = 'activo';
CREATE INDEX collection_customers_lista ON collection_customers (company_id, estado, lower(nombre), id);

COMMENT ON TABLE collection_customers IS
  'Clientes de la empresa a quienes les cobra. No son usuarios de Lever. Se archivan con motivo; nunca se borran.';

CREATE FUNCTION collection_customers_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF app_usuario() IS NULL OR NEW.creado_por IS DISTINCT FROM app_usuario() OR NEW.actualizado_por IS DISTINCT FROM app_usuario()
      OR NOT flujo_editor(NEW.company_id)
    THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
    IF NEW.estado <> 'activo' OR NOT NEW.recordatorios OR NEW.recordatorios_por IS NOT NULL THEN
      RAISE EXCEPTION 'cliente_no_valido';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.creado_por, NEW.creado_en) IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.creado_por, OLD.creado_en) THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF OLD.estado = 'archivado' THEN
    RAISE EXCEPTION 'cliente_archivado';
  END IF;
  IF app_usuario() IS NULL THEN
    -- Sin persona solo cabe un cambio: el pagador pide no recibir recordatorios desde su enlace.
    IF NEW.company_id IS DISTINCT FROM app_empresa()
      OR (NEW.nombre, NEW.rfc, NEW.correos, NEW.estado, NEW.motivo_archivo, NEW.actualizado_por, NEW.actualizado_en)
        IS DISTINCT FROM (OLD.nombre, OLD.rfc, OLD.correos, OLD.estado, OLD.motivo_archivo, OLD.actualizado_por, OLD.actualizado_en)
      OR NOT OLD.recordatorios OR NEW.recordatorios OR NEW.recordatorios_por IS DISTINCT FROM 'pagador'
    THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.actualizado_por IS DISTINCT FROM app_usuario() OR NOT flujo_editor(NEW.company_id) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  IF NEW.recordatorios IS DISTINCT FROM OLD.recordatorios AND NEW.recordatorios_por IS DISTINCT FROM 'empresa' THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_customers_revisar
BEFORE INSERT OR UPDATE ON collection_customers
FOR EACH ROW EXECUTE FUNCTION collection_customers_revisar();

-- Planes ---------------------------------------------------------------------------
-- El día ancla es el día del primer vencimiento: cada vencimiento se calcula
-- desde él (31 ene → 28 feb → 31 mar), nunca encadenando el anterior.

CREATE TABLE collection_plans (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  concepto text NOT NULL,
  tipo text NOT NULL,
  monto_centavos bigint,
  periodicidad text NOT NULL,
  primer_vencimiento date NOT NULL,
  fin date,
  estado text NOT NULL DEFAULT 'activo',
  -- Al reanudar: los periodos que vencieron durante la pausa quedan omitidos.
  reanudado_el date,
  motivo_cancelacion text,
  creado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  cancelado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  cancelado_en timestamptz,
  CONSTRAINT collection_plans_id_empresa UNIQUE (id, company_id),
  CONSTRAINT collection_plans_cliente
    FOREIGN KEY (customer_id, company_id) REFERENCES collection_customers (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_plans_concepto CHECK (cobranza_texto(concepto, 1, 200)),
  CONSTRAINT collection_plans_tipo CHECK (
    (tipo = 'fijo' AND monto_centavos BETWEEN 1 AND 9000000000000000)
    OR (tipo = 'variable' AND monto_centavos IS NULL)
  ),
  CONSTRAINT collection_plans_periodicidad CHECK (periodicidad IN ('mensual', 'bimestral', 'trimestral', 'semestral', 'anual')),
  CONSTRAINT collection_plans_fechas CHECK (
    primer_vencimiento >= DATE '2000-01-01' AND (fin IS NULL OR fin >= primer_vencimiento)
    AND (reanudado_el IS NULL OR reanudado_el >= DATE '2000-01-01')
  ),
  CONSTRAINT collection_plans_estado CHECK (
    (estado IN ('activo', 'pausado') AND motivo_cancelacion IS NULL AND cancelado_por IS NULL AND cancelado_en IS NULL)
    OR (estado = 'cancelado' AND cancelado_por IS NOT NULL AND cancelado_en IS NOT NULL
        AND motivo_cancelacion IS NOT NULL AND cobranza_texto(motivo_cancelacion, 5, 500))
  )
);

CREATE INDEX collection_plans_cliente_idx ON collection_plans (company_id, customer_id, estado);
CREATE INDEX collection_plans_activos ON collection_plans (company_id, estado, id);

COMMENT ON TABLE collection_plans IS
  'Plan de cobro de un cliente: fijo (monto por periodo) o variable (el monto se captura cada periodo). Cambiar la periodicidad es cancelar y crear otro.';

CREATE FUNCTION collection_plans_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF app_usuario() IS NULL OR NEW.actualizado_por IS DISTINCT FROM app_usuario() OR NOT flujo_editor(NEW.company_id) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.creado_por IS DISTINCT FROM app_usuario() OR NEW.estado <> 'activo' OR NEW.reanudado_el IS NOT NULL THEN
      RAISE EXCEPTION 'plan_no_valido';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.customer_id, NEW.tipo, NEW.periodicidad, NEW.primer_vencimiento, NEW.creado_por, NEW.creado_en)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.customer_id, OLD.tipo, OLD.periodicidad, OLD.primer_vencimiento, OLD.creado_por, OLD.creado_en)
  THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF OLD.estado = 'cancelado' THEN
    RAISE EXCEPTION 'plan_cancelado';
  END IF;
  IF NEW.estado = 'cancelado' AND NEW.cancelado_por IS DISTINCT FROM app_usuario() THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  -- Reanudar fija el día; pausar no lo toca.
  IF OLD.estado = 'pausado' AND NEW.estado = 'activo' AND NEW.reanudado_el IS NOT DISTINCT FROM OLD.reanudado_el THEN
    RAISE EXCEPTION 'plan_no_valido';
  END IF;
  IF NOT (OLD.estado = 'pausado' AND NEW.estado = 'activo') AND NEW.reanudado_el IS DISTINCT FROM OLD.reanudado_el THEN
    RAISE EXCEPTION 'plan_no_valido';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_plans_revisar
BEFORE INSERT OR UPDATE ON collection_plans
FOR EACH ROW EXECUTE FUNCTION collection_plans_revisar();

-- Cargos ---------------------------------------------------------------------------
-- por_emitir (variable sin monto) → emitido → pagado; por_emitir|emitido sin
-- pagos → cancelado (motivo); omitido: periodo que venció en pausa. Vencido no
-- es un estado: es un emitido cuyo vencimiento ya pasó.

CREATE TABLE collection_charges (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  plan_id uuid,
  periodo integer,
  concepto text NOT NULL,
  monto_centavos bigint,
  vencimiento date NOT NULL,
  referencia text NOT NULL,
  estado text NOT NULL,
  pagado_centavos bigint NOT NULL DEFAULT 0,
  pagado_el date,
  emitido_en timestamptz,
  emitido_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  motivo text,
  resuelto_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  resuelto_en timestamptz,
  -- Vacío: lo generó el sistema (cron).
  creado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_charges_id_empresa UNIQUE (id, company_id),
  CONSTRAINT collection_charges_cliente
    FOREIGN KEY (customer_id, company_id) REFERENCES collection_customers (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_charges_plan
    FOREIGN KEY (plan_id, company_id) REFERENCES collection_plans (id, company_id) ON DELETE RESTRICT,
  -- La llave del cron: un cargo por plan y periodo, aunque la tarea corra dos veces.
  CONSTRAINT collection_charges_periodo_unico UNIQUE (plan_id, periodo),
  CONSTRAINT collection_charges_referencia_unica UNIQUE (company_id, referencia),
  CONSTRAINT collection_charges_periodo CHECK ((plan_id IS NULL) = (periodo IS NULL) AND (periodo IS NULL OR periodo BETWEEN 0 AND 10000)),
  CONSTRAINT collection_charges_concepto CHECK (cobranza_texto(concepto, 1, 200)),
  CONSTRAINT collection_charges_referencia CHECK (cobranza_referencia_valida(referencia)),
  CONSTRAINT collection_charges_fecha CHECK (vencimiento >= DATE '2000-01-01'),
  CONSTRAINT collection_charges_monto CHECK (monto_centavos IS NULL OR monto_centavos BETWEEN 1 AND 9000000000000000),
  CONSTRAINT collection_charges_pagado CHECK (pagado_centavos >= 0 AND pagado_centavos <= coalesce(monto_centavos, 0)),
  CONSTRAINT collection_charges_estado CHECK (
    (estado = 'por_emitir' AND monto_centavos IS NULL AND emitido_en IS NULL AND emitido_por IS NULL AND pagado_el IS NULL
       AND motivo IS NULL AND resuelto_por IS NULL AND resuelto_en IS NULL)
    OR (estado = 'emitido' AND monto_centavos IS NOT NULL AND emitido_en IS NOT NULL AND pagado_centavos < monto_centavos
       AND pagado_el IS NULL AND motivo IS NULL AND resuelto_por IS NULL AND resuelto_en IS NULL)
    OR (estado = 'pagado' AND monto_centavos IS NOT NULL AND emitido_en IS NOT NULL AND pagado_centavos = monto_centavos
       AND pagado_el IS NOT NULL AND motivo IS NULL AND resuelto_por IS NULL AND resuelto_en IS NULL)
    OR (estado = 'cancelado' AND pagado_centavos = 0 AND pagado_el IS NULL AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL
       AND motivo IS NOT NULL AND cobranza_texto(motivo, 5, 500))
    OR (estado = 'omitido' AND plan_id IS NOT NULL AND pagado_centavos = 0 AND emitido_en IS NULL AND pagado_el IS NULL
       AND resuelto_en IS NOT NULL AND motivo IS NOT NULL AND cobranza_texto(motivo, 5, 500))
  )
);

CREATE INDEX collection_charges_agenda ON collection_charges (company_id, estado, vencimiento, id);
CREATE INDEX collection_charges_cliente_idx ON collection_charges (company_id, customer_id, vencimiento, id);

COMMENT ON TABLE collection_charges IS
  'Cargo de un periodo de un plan, o cargo único sin plan. La referencia de 7 dígitos identifica el pago. pagado_centavos es la suma de sus aplicaciones.';

CREATE FUNCTION collection_charges_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT cobranza_autor_valido(NEW.company_id, NEW.creado_por) THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
    IF NEW.estado NOT IN ('por_emitir', 'emitido', 'omitido') OR NEW.pagado_centavos <> 0
      OR (NEW.estado = 'emitido' AND NEW.emitido_por IS DISTINCT FROM NEW.creado_por)
      OR (NEW.estado = 'omitido' AND NEW.resuelto_por IS DISTINCT FROM NEW.creado_por)
    THEN
      RAISE EXCEPTION 'cargo_no_valido';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.customer_id, NEW.plan_id, NEW.periodo, NEW.concepto, NEW.vencimiento, NEW.referencia,
      NEW.creado_por, NEW.creado_en)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.customer_id, OLD.plan_id, OLD.periodo, OLD.concepto, OLD.vencimiento, OLD.referencia,
      OLD.creado_por, OLD.creado_en)
  THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF OLD.estado IN ('cancelado', 'omitido') THEN
    RAISE EXCEPTION 'cargo_ya_resuelto';
  END IF;
  IF OLD.estado <> 'por_emitir' AND (NEW.monto_centavos, NEW.emitido_en, NEW.emitido_por)
    IS DISTINCT FROM (OLD.monto_centavos, OLD.emitido_en, OLD.emitido_por)
  THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF NOT (
    (OLD.estado = 'por_emitir' AND NEW.estado IN ('emitido', 'cancelado'))
    OR (OLD.estado = 'emitido' AND NEW.estado IN ('emitido', 'pagado', 'cancelado'))
    OR (OLD.estado = 'pagado' AND NEW.estado IN ('emitido', 'pagado'))
  ) THEN
    RAISE EXCEPTION 'cargo_ya_resuelto';
  END IF;
  -- Emitir y cancelar son de una persona; un abono lo aplica una persona o el sistema.
  IF OLD.estado = 'por_emitir' AND NEW.estado = 'emitido' THEN
    IF NEW.emitido_por IS NULL OR NOT cobranza_autor_valido(NEW.company_id, NEW.emitido_por) THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
  ELSIF NEW.estado = 'cancelado' THEN
    IF NEW.resuelto_por IS NULL OR NOT cobranza_autor_valido(NEW.company_id, NEW.resuelto_por) THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
  ELSIF NOT cobranza_autor_valido(NEW.company_id, app_usuario()) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_charges_revisar
BEFORE INSERT OR UPDATE ON collection_charges
FOR EACH ROW EXECUTE FUNCTION collection_charges_revisar();

-- Pagos recibidos ------------------------------------------------------------------
-- abierto (algo sin aplicar: sin identificar o saldo a favor) → aplicado;
-- anulado solo un pago manual, con motivo y sus aplicaciones revertidas.

CREATE TABLE collection_payments (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  fuente text NOT NULL,
  id_externo text NOT NULL,
  monto_centavos bigint NOT NULL,
  recibido_el date NOT NULL,
  clave_rastreo text,
  referencia text,
  clabe_ordenante text,
  nombre_ordenante text,
  customer_id uuid,
  aplicado_centavos bigint NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'abierto',
  -- Llegó con la referencia de un cargo ya pagado: otra transferencia por lo mismo.
  posible_duplicado boolean NOT NULL DEFAULT false,
  document_id uuid,
  registrado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  motivo_anulacion text,
  anulado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  anulado_en timestamptz,
  CONSTRAINT collection_payments_id_empresa UNIQUE (id, company_id),
  -- Un aviso repetido de la misma fuente no crea otro pago.
  CONSTRAINT collection_payments_externo_unico UNIQUE (company_id, fuente, id_externo),
  CONSTRAINT collection_payments_cliente
    FOREIGN KEY (customer_id, company_id) REFERENCES collection_customers (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_payments_comprobante
    FOREIGN KEY (document_id, company_id) REFERENCES documents (id, company_id) ON DELETE RESTRICT,
  -- manual: una persona con su comprobante; demo: el simulador de una empresa de demostración;
  -- fintoc: el aviso del proveedor SPEI (lo registra el sistema); estado_cuenta: un renglón confirmado del estado de cuenta.
  CONSTRAINT collection_payments_fuente CHECK (fuente IN ('manual', 'demo', 'fintoc', 'estado_cuenta')),
  CONSTRAINT collection_payments_externo CHECK (id_externo ~ '^[A-Za-z0-9:_-]{1,120}$'),
  CONSTRAINT collection_payments_monto CHECK (monto_centavos BETWEEN 1 AND 9000000000000000),
  CONSTRAINT collection_payments_fecha CHECK (recibido_el >= DATE '2000-01-01'),
  CONSTRAINT collection_payments_rastreo CHECK (clave_rastreo IS NULL OR clave_rastreo ~ '^[A-Za-z0-9]{1,30}$'),
  CONSTRAINT collection_payments_referencia CHECK (referencia IS NULL OR referencia ~ '^[0-9]{1,7}$'),
  CONSTRAINT collection_payments_ordenante CHECK (clabe_ordenante IS NULL OR (clabe_ordenante ~ '^[0-9]{18}$' AND clabe_digito_371(clabe_ordenante))),
  CONSTRAINT collection_payments_nombre CHECK (nombre_ordenante IS NULL OR cobranza_texto(nombre_ordenante, 1, 120)),
  CONSTRAINT collection_payments_aplicado CHECK (aplicado_centavos BETWEEN 0 AND monto_centavos),
  CONSTRAINT collection_payments_estado CHECK (
    (estado = 'abierto' AND aplicado_centavos < monto_centavos AND motivo_anulacion IS NULL AND anulado_por IS NULL AND anulado_en IS NULL)
    OR (estado = 'aplicado' AND aplicado_centavos = monto_centavos AND motivo_anulacion IS NULL AND anulado_por IS NULL AND anulado_en IS NULL)
    OR (estado = 'anulado' AND fuente = 'manual' AND aplicado_centavos = 0 AND anulado_por IS NOT NULL AND anulado_en IS NOT NULL
        AND motivo_anulacion IS NOT NULL AND cobranza_texto(motivo_anulacion, 5, 500))
  )
);

CREATE INDEX collection_payments_bandeja ON collection_payments (company_id, estado, recibido_el DESC, id);
CREATE INDEX collection_payments_cliente_idx ON collection_payments (company_id, customer_id, recibido_el DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX collection_payments_ordenante ON collection_payments (company_id, clabe_ordenante) WHERE clabe_ordenante IS NOT NULL;

COMMENT ON TABLE collection_payments IS
  'Abono recibido por la empresa: manual con comprobante, aviso del proveedor SPEI, renglón del estado de cuenta o simulado en una empresa de demostración. Lo no aplicado es saldo a favor del cliente o queda sin identificar.';

CREATE FUNCTION collection_payments_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT cobranza_autor_valido(NEW.company_id, NEW.registrado_por) THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
    -- El aviso del proveedor lo registra el sistema; lo demás, una persona.
    -- El simulador solo existe en una empresa de demostración.
    IF (NEW.fuente = 'fintoc') <> (NEW.registrado_por IS NULL)
      OR (NEW.fuente = 'demo' AND NOT EXISTS (SELECT 1 FROM companies WHERE id = NEW.company_id AND demostracion))
    THEN
      RAISE EXCEPTION 'pago_no_valido';
    END IF;
    IF NEW.estado <> 'abierto' OR NEW.aplicado_centavos <> 0 THEN
      RAISE EXCEPTION 'pago_no_valido';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.fuente, NEW.id_externo, NEW.monto_centavos, NEW.recibido_el, NEW.clave_rastreo, NEW.referencia,
      NEW.clabe_ordenante, NEW.nombre_ordenante, NEW.posible_duplicado, NEW.document_id, NEW.registrado_por, NEW.registrado_en)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.fuente, OLD.id_externo, OLD.monto_centavos, OLD.recibido_el, OLD.clave_rastreo, OLD.referencia,
      OLD.clabe_ordenante, OLD.nombre_ordenante, OLD.posible_duplicado, OLD.document_id, OLD.registrado_por, OLD.registrado_en)
    OR (OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id)
  THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF OLD.estado = 'anulado' THEN
    RAISE EXCEPTION 'pago_anulado';
  END IF;
  IF NEW.estado = 'anulado' AND NEW.anulado_por IS DISTINCT FROM app_usuario() THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  IF NOT cobranza_autor_valido(NEW.company_id, app_usuario()) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_payments_revisar
BEFORE INSERT OR UPDATE ON collection_payments
FOR EACH ROW EXECUTE FUNCTION collection_payments_revisar();

-- Aplicaciones ---------------------------------------------------------------------
-- Cuánto de un pago cubre un cargo y con qué regla. Solo inserción: una
-- aplicación equivocada se revierte con otra fila negativa que la nombra.

CREATE TABLE collection_applications (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL,
  charge_id uuid NOT NULL,
  monto_centavos bigint NOT NULL,
  regla text NOT NULL,
  revierte_a uuid,
  aplicado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  aplicado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_applications_id_empresa UNIQUE (id, company_id),
  CONSTRAINT collection_applications_pago
    FOREIGN KEY (payment_id, company_id) REFERENCES collection_payments (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_applications_cargo
    FOREIGN KEY (charge_id, company_id) REFERENCES collection_charges (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_applications_reversion
    FOREIGN KEY (revierte_a, company_id) REFERENCES collection_applications (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_applications_una_reversion UNIQUE (revierte_a),
  CONSTRAINT collection_applications_monto CHECK (monto_centavos <> 0 AND abs(monto_centavos) <= 9000000000000000),
  CONSTRAINT collection_applications_regla CHECK (
    (regla IN ('referencia', 'clabe_y_monto', 'manual') AND revierte_a IS NULL AND monto_centavos > 0)
    OR (regla = 'reversion' AND revierte_a IS NOT NULL AND monto_centavos < 0)
  )
);

CREATE INDEX collection_applications_cargo_idx ON collection_applications (company_id, charge_id);
CREATE INDEX collection_applications_pago_idx ON collection_applications (company_id, payment_id);

COMMENT ON TABLE collection_applications IS
  'Aplicación de un pago a un cargo. Solo inserción; la reversión es una fila negativa que nombra la original.';

CREATE FUNCTION collection_applications_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  original collection_applications%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'aplicacion_no_se_reescribe';
  END IF;
  IF NOT cobranza_autor_valido(NEW.company_id, NEW.aplicado_por) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  IF NEW.regla = 'reversion' THEN
    SELECT * INTO original FROM collection_applications WHERE id = NEW.revierte_a AND company_id = NEW.company_id;
    IF NOT FOUND OR original.regla = 'reversion' OR original.payment_id <> NEW.payment_id OR original.charge_id <> NEW.charge_id
      OR original.monto_centavos <> -NEW.monto_centavos OR NEW.aplicado_por IS NULL
    THEN
      RAISE EXCEPTION 'aplicacion_no_valida';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_applications_revisar
BEFORE INSERT OR UPDATE ON collection_applications
FOR EACH ROW EXECUTE FUNCTION collection_applications_revisar();

-- Lo pagado de un cargo y lo aplicado de un pago son la suma de sus
-- aplicaciones al confirmar la transacción.
CREATE FUNCTION cobranza_sumas_cuadran()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Cada tabla nombra al cargo y al pago con su propia columna. PL/pgSQL resuelve
  -- NEW.<columna> aunque la rama no corra, así que cada una va en su IF.
  cargo_id uuid;
  pago_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'collection_charges' THEN
    cargo_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'collection_payments' THEN
    pago_id := NEW.id;
  ELSE
    cargo_id := NEW.charge_id;
    pago_id := NEW.payment_id;
  END IF;
  IF cargo_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM collection_charges c
       WHERE c.id = cargo_id
         AND c.pagado_centavos <> coalesce((SELECT sum(a.monto_centavos) FROM collection_applications a
                                             WHERE a.charge_id = c.id AND a.company_id = c.company_id), 0)
    ) THEN
      RAISE EXCEPTION 'cobranza_pagado_no_cuadra';
    END IF;
  END IF;
  IF pago_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM collection_payments p
       WHERE p.id = pago_id
         AND p.aplicado_centavos <> coalesce((SELECT sum(a.monto_centavos) FROM collection_applications a
                                               WHERE a.payment_id = p.id AND a.company_id = p.company_id), 0)
    ) THEN
      RAISE EXCEPTION 'cobranza_aplicado_no_cuadra';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER collection_charges_cuadra
AFTER INSERT OR UPDATE ON collection_charges DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_sumas_cuadran();
CREATE CONSTRAINT TRIGGER collection_payments_cuadra
AFTER INSERT OR UPDATE ON collection_payments DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_sumas_cuadran();
CREATE CONSTRAINT TRIGGER collection_applications_cuadra
AFTER INSERT ON collection_applications DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_sumas_cuadran();

-- Correos de cobro -----------------------------------------------------------------
-- Uno por cargo, tipo y secuencia: la tarea lo aparta antes de mandar y una
-- segunda corrida no encuentra nada que apartar. Cada intento lleva su propio
-- enlace del pagador (la base guarda solo el hash del token). En una empresa
-- de demostración no sale ningún correo: queda «simulado».

CREATE TABLE collection_emails (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  charge_id uuid NOT NULL,
  tipo text NOT NULL,
  secuencia smallint NOT NULL,
  estado text NOT NULL,
  destinatarios smallint NOT NULL DEFAULT 0,
  intentos smallint NOT NULL DEFAULT 1,
  codigo text,
  enlace_hash text NOT NULL,
  enlace_vence date NOT NULL,
  -- Vacío: lo mandó la tarea.
  solicitado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  intentado_en timestamptz NOT NULL DEFAULT now(),
  terminado_en timestamptz,
  CONSTRAINT collection_emails_id_empresa UNIQUE (id, company_id),
  CONSTRAINT collection_emails_cargo
    FOREIGN KEY (charge_id, company_id) REFERENCES collection_charges (id, company_id) ON DELETE RESTRICT,
  -- La llave del correo: la tarea repetida no lo manda dos veces.
  CONSTRAINT collection_emails_unico UNIQUE (charge_id, tipo, secuencia),
  CONSTRAINT collection_emails_enlace_unico UNIQUE (enlace_hash),
  CONSTRAINT collection_emails_tipo CHECK (
    (tipo IN ('cobro', 'antes', 'dia') AND secuencia = 1)
    OR (tipo IN ('despues', 'reenvio') AND secuencia BETWEEN 1 AND 6)
  ),
  CONSTRAINT collection_emails_estado CHECK (estado IN ('enviando', 'enviado', 'fallido', 'simulado')),
  CONSTRAINT collection_emails_cierre CHECK ((estado = 'enviando') = (terminado_en IS NULL)),
  CONSTRAINT collection_emails_destinatarios CHECK (destinatarios BETWEEN 0 AND 3),
  CONSTRAINT collection_emails_intentos CHECK (intentos BETWEEN 1 AND 5),
  CONSTRAINT collection_emails_codigo CHECK (codigo IS NULL OR codigo ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT collection_emails_enlace CHECK (enlace_hash ~ '^[0-9a-f]{64}$' AND enlace_vence >= DATE '2000-01-01')
);

CREATE INDEX collection_emails_cargo_idx ON collection_emails (company_id, charge_id, intentado_en DESC);
CREATE INDEX collection_emails_reintento ON collection_emails (company_id, estado, intentado_en) WHERE estado IN ('enviando', 'fallido');

COMMENT ON TABLE collection_emails IS
  'Correo de cobro o recordatorio de un cargo. No guarda el contenido ni el token del enlace: solo su hash.';

CREATE FUNCTION collection_emails_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT cobranza_autor_valido(NEW.company_id, NEW.solicitado_por) THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
    IF NEW.estado <> 'enviando' OR NEW.intentos <> 1 OR NEW.destinatarios <> 0 THEN
      RAISE EXCEPTION 'correo_no_valido';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.charge_id, NEW.tipo, NEW.secuencia, NEW.solicitado_por)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.charge_id, OLD.tipo, OLD.secuencia, OLD.solicitado_por)
  THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF NOT cobranza_autor_valido(NEW.company_id, app_usuario()) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  -- enviando → enviado | fallido | simulado; fallido → enviando (otro intento, con otro enlace).
  IF NOT (
    (OLD.estado = 'enviando' AND NEW.estado IN ('enviado', 'fallido', 'simulado')
      AND (NEW.intentos, NEW.enlace_hash, NEW.enlace_vence) IS NOT DISTINCT FROM (OLD.intentos, OLD.enlace_hash, OLD.enlace_vence))
    OR (OLD.estado = 'fallido' AND NEW.estado = 'enviando' AND NEW.intentos = OLD.intentos + 1 AND NEW.enlace_hash <> OLD.enlace_hash)
  ) THEN
    RAISE EXCEPTION 'correo_ya_cerrado';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_emails_revisar
BEFORE INSERT OR UPDATE ON collection_emails
FOR EACH ROW EXECUTE FUNCTION collection_emails_revisar();

-- A qué destinatario (0 a 2) ya le llegó. Después de las 24 horas de la llave
-- del proveedor, un reintento salta a quien ya lo recibió.
CREATE TABLE collection_email_deliveries (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  email_id uuid NOT NULL,
  indice smallint NOT NULL,
  entregado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_email_deliveries_correo
    FOREIGN KEY (email_id, company_id) REFERENCES collection_emails (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_email_deliveries_unica UNIQUE (email_id, indice),
  CONSTRAINT collection_email_deliveries_indice CHECK (indice BETWEEN 0 AND 2)
);

-- El tope diario por empresa cuenta aquí.
CREATE INDEX collection_email_deliveries_dia ON collection_email_deliveries (company_id, entregado_en);

COMMENT ON TABLE collection_email_deliveries IS
  'Entrega de un correo de cobro a uno de los correos del cliente (por índice; no guarda la dirección). Solo inserción.';

CREATE FUNCTION collection_email_deliveries_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'entrega_no_se_reescribe';
  END IF;
  IF NOT cobranza_autor_valido(NEW.company_id, app_usuario()) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_email_deliveries_revisar
BEFORE INSERT OR UPDATE ON collection_email_deliveries
FOR EACH ROW EXECUTE FUNCTION collection_email_deliveries_revisar();

-- Proveedor SPEI: CLABE por cliente a nombre de la empresa ----------------------------
-- La cuenta de la empresa en el proveedor (en Fintoc, el Account de su Entity)
-- la registra el personal de Lever; la empresa solo la lee. Cada cliente recibe
-- su propia CLABE en esa cuenta, así el abono dice quién pagó.

CREATE TABLE collection_provider_accounts (
  company_id uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,
  proveedor text NOT NULL,
  cuenta_id text NOT NULL,
  registrado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_provider_accounts_proveedor CHECK (proveedor IN ('fintoc')),
  CONSTRAINT collection_provider_accounts_cuenta CHECK (cuenta_id ~ '^acc_[A-Za-z0-9]{1,64}$'),
  CONSTRAINT collection_provider_accounts_unica UNIQUE (proveedor, cuenta_id)
);

COMMENT ON TABLE collection_provider_accounts IS
  'Cuenta de la empresa en el proveedor SPEI (Fintoc: el Account de la Entity de la empresa). La registra el personal de Lever, con su bitácora.';

-- Solo personal vigente de administración de la plataforma, del operador de la empresa.
CREATE FUNCTION cobranza_registrar_cuenta_proveedor(p_company uuid, p_proveedor text, p_cuenta text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF app_usuario() IS NULL OR NOT EXISTS (
    SELECT 1
      FROM platform_staff s
      JOIN platform_staff_roles r ON r.operator_id = s.operator_id AND r.user_id = s.user_id
      JOIN companies c ON c.operator_id = s.operator_id AND c.id = p_company
     WHERE s.user_id = app_usuario() AND s.operator_id = app_operador() AND s.estado = 'activo'
       AND r.rol = 'administracion_plataforma'
  ) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  INSERT INTO collection_provider_accounts (company_id, proveedor, cuenta_id, registrado_por)
  VALUES (p_company, p_proveedor, p_cuenta, app_usuario())
  ON CONFLICT (company_id) DO UPDATE
    SET proveedor = excluded.proveedor, cuenta_id = excluded.cuenta_id,
        registrado_por = excluded.registrado_por, registrado_en = now();
END;
$$;

REVOKE ALL ON FUNCTION cobranza_registrar_cuenta_proveedor(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cobranza_registrar_cuenta_proveedor(uuid, text, text) TO plataforma_sofipo;

-- Una CLABE por cliente y proveedor. Se crea con el cliente bloqueado: antes
-- de pedirla al proveedor se revisa aquí y se busca en el proveedor la que
-- lleve el id del cliente (por si un intento anterior se cayó después de que
-- el proveedor la creó). Ya guardada no cambia.
CREATE TABLE collection_virtual_accounts (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  proveedor text NOT NULL,
  cuenta_numero_id text NOT NULL,
  clabe text NOT NULL,
  creado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_virtual_accounts_id_empresa UNIQUE (id, company_id),
  CONSTRAINT collection_virtual_accounts_cliente
    FOREIGN KEY (customer_id, company_id) REFERENCES collection_customers (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_virtual_accounts_una UNIQUE (customer_id, proveedor),
  CONSTRAINT collection_virtual_accounts_numero_unico UNIQUE (proveedor, cuenta_numero_id),
  CONSTRAINT collection_virtual_accounts_clabe_unica UNIQUE (clabe),
  CONSTRAINT collection_virtual_accounts_proveedor CHECK (proveedor IN ('fintoc')),
  CONSTRAINT collection_virtual_accounts_numero CHECK (cuenta_numero_id ~ '^acno_[A-Za-z0-9]{1,64}$'),
  CONSTRAINT collection_virtual_accounts_clabe CHECK (clabe ~ '^[0-9]{18}$' AND clabe_digito_371(clabe))
);

COMMENT ON TABLE collection_virtual_accounts IS
  'CLABE propia de un cliente en el proveedor SPEI, a nombre de la empresa. Una por cliente y proveedor; no cambia.';

CREATE FUNCTION collection_virtual_accounts_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF NOT cobranza_autor_valido(NEW.company_id, NEW.creado_por) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_virtual_accounts_revisar
BEFORE INSERT OR UPDATE ON collection_virtual_accounts
FOR EACH ROW EXECUTE FUNCTION collection_virtual_accounts_revisar();

-- Avisos del proveedor ya procesados: el mismo evento no vuelve a tener efecto.
CREATE TABLE collection_provider_events (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  proveedor text NOT NULL,
  evento_id text NOT NULL,
  payment_id uuid,
  recibido_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_provider_events_unico UNIQUE (proveedor, evento_id),
  CONSTRAINT collection_provider_events_pago
    FOREIGN KEY (payment_id, company_id) REFERENCES collection_payments (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_provider_events_proveedor CHECK (proveedor IN ('fintoc')),
  CONSTRAINT collection_provider_events_evento CHECK (evento_id ~ '^evt_[A-Za-z0-9]{1,64}$')
);

COMMENT ON TABLE collection_provider_events IS 'Eventos del proveedor ya procesados, por su id. Solo inserción y solo del sistema.';

CREATE FUNCTION collection_provider_events_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF app_usuario() IS NOT NULL OR NEW.company_id IS DISTINCT FROM app_empresa() THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_provider_events_revisar
BEFORE INSERT OR UPDATE ON collection_provider_events
FOR EACH ROW EXECUTE FUNCTION collection_provider_events_revisar();

-- La ruta del aviso no tiene sesión ni empresa: con la cuenta y el número del
-- proveedor sabe de qué empresa (y de qué cliente, si es su CLABE) es el abono.
-- Lo demás lo hace ya con el contexto de esa empresa.
CREATE FUNCTION cobranza_destino_fintoc(p_cuenta text, p_cuenta_numero text)
RETURNS TABLE (company_id uuid, operator_id uuid, customer_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.company_id, c.operator_id,
         (SELECT v.customer_id FROM collection_virtual_accounts v
           WHERE v.company_id = a.company_id AND v.proveedor = 'fintoc' AND v.cuenta_numero_id = p_cuenta_numero)
    FROM collection_provider_accounts a
    JOIN companies c ON c.id = a.company_id
   WHERE a.proveedor = 'fintoc' AND a.cuenta_id = p_cuenta
$$;

REVOKE ALL ON FUNCTION cobranza_destino_fintoc(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cobranza_destino_fintoc(text, text) TO plataforma_cliente;

-- Estado de cuenta ---------------------------------------------------------------------
-- La empresa sube el archivo de su banco. El empate de columnas se recuerda por
-- banco; cada renglón lleva su huella y no se importa dos veces.

CREATE TABLE collection_statement_mappings (
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  banco text NOT NULL,
  -- {"fecha": 0, "abono": 3, "concepto": 1, "referencia": 2, "rastreo": null}: índice de columna desde 0.
  columnas jsonb NOT NULL,
  fila_encabezado smallint NOT NULL,
  actualizado_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, banco),
  CONSTRAINT collection_statement_mappings_banco CHECK (banco ~ '^[a-z][a-z0-9_]{1,30}$'),
  CONSTRAINT collection_statement_mappings_columnas CHECK (
    jsonb_typeof(columnas) = 'object'
    AND coalesce(jsonb_typeof(columnas -> 'fecha'), '') = 'number'
    AND coalesce(jsonb_typeof(columnas -> 'abono'), '') = 'number'
    AND NOT jsonb_path_exists(columnas, '$.keyvalue() ? (!(@.key like_regex "^(fecha|abono|concepto|referencia|rastreo)$"))')
    AND NOT jsonb_path_exists(columnas, '$.* ? (@.type() != "null" && (@.type() != "number" || @ < 0 || @ > 39 || @ != @.floor()))')
  ),
  CONSTRAINT collection_statement_mappings_fila CHECK (fila_encabezado BETWEEN 0 AND 50)
);

COMMENT ON TABLE collection_statement_mappings IS 'Qué columna del estado de cuenta de cada banco es la fecha, el abono, el concepto, la referencia y la clave de rastreo.';

CREATE TABLE collection_statement_imports (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  banco text NOT NULL,
  nombre_archivo text NOT NULL,
  huella_archivo text NOT NULL,
  renglones integer NOT NULL,
  abonos integer NOT NULL,
  nuevos integer NOT NULL,
  estado text NOT NULL DEFAULT 'propuesta',
  subido_por uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  subido_en timestamptz NOT NULL DEFAULT now(),
  confirmado_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  confirmado_en timestamptz,
  CONSTRAINT collection_statement_imports_id_empresa UNIQUE (id, company_id),
  CONSTRAINT collection_statement_imports_banco CHECK (banco ~ '^[a-z][a-z0-9_]{1,30}$'),
  CONSTRAINT collection_statement_imports_nombre CHECK (cobranza_texto(nombre_archivo, 1, 180) AND nombre_archivo !~ '[/\\]'),
  CONSTRAINT collection_statement_imports_huella CHECK (huella_archivo ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collection_statement_imports_cuentas CHECK (
    renglones BETWEEN 0 AND 5000 AND abonos BETWEEN 0 AND renglones AND nuevos BETWEEN 0 AND abonos
  ),
  CONSTRAINT collection_statement_imports_estado CHECK (
    (estado = 'propuesta' AND confirmado_por IS NULL AND confirmado_en IS NULL)
    OR (estado = 'confirmada' AND confirmado_por IS NOT NULL AND confirmado_en IS NOT NULL)
  )
);

CREATE INDEX collection_statement_imports_lista ON collection_statement_imports (company_id, subido_en DESC);

CREATE TABLE collection_statement_rows (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  import_id uuid NOT NULL,
  huella text NOT NULL,
  fecha date NOT NULL,
  monto_centavos bigint NOT NULL,
  concepto text,
  referencia text,
  clave_rastreo text,
  estado text NOT NULL DEFAULT 'pendiente',
  payment_id uuid,
  resuelto_por uuid REFERENCES users (id) ON DELETE RESTRICT,
  resuelto_en timestamptz,
  CONSTRAINT collection_statement_rows_importacion
    FOREIGN KEY (import_id, company_id) REFERENCES collection_statement_imports (id, company_id) ON DELETE RESTRICT,
  CONSTRAINT collection_statement_rows_pago
    FOREIGN KEY (payment_id, company_id) REFERENCES collection_payments (id, company_id) ON DELETE RESTRICT,
  -- Subir el mismo archivo, o uno que se traslapa, no duplica: la huella ya está.
  CONSTRAINT collection_statement_rows_huella_unica UNIQUE (company_id, huella),
  CONSTRAINT collection_statement_rows_huella CHECK (huella ~ '^[0-9a-f]{64}$'),
  CONSTRAINT collection_statement_rows_fecha CHECK (fecha >= DATE '2000-01-01'),
  CONSTRAINT collection_statement_rows_monto CHECK (monto_centavos BETWEEN 1 AND 9000000000000000),
  CONSTRAINT collection_statement_rows_textos CHECK (
    (concepto IS NULL OR cobranza_texto(concepto, 1, 500))
    AND (referencia IS NULL OR cobranza_texto(referencia, 1, 120))
    AND (clave_rastreo IS NULL OR clave_rastreo ~ '^[A-Za-z0-9]{1,30}$')
  ),
  -- aplicado / por_conciliar: el pago que creó; ya_registrado: el pago que ya existía con la misma clave de rastreo.
  CONSTRAINT collection_statement_rows_estado CHECK (
    (estado = 'pendiente' AND payment_id IS NULL AND resuelto_por IS NULL AND resuelto_en IS NULL)
    OR (estado IN ('aplicado', 'por_conciliar', 'ya_registrado') AND payment_id IS NOT NULL AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)
    OR (estado = 'descartado' AND payment_id IS NULL AND resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)
  )
);

CREATE INDEX collection_statement_rows_importacion_idx ON collection_statement_rows (company_id, import_id, estado, fecha);

COMMENT ON TABLE collection_statement_rows IS
  'Abono leído del estado de cuenta que subió la empresa. Al confirmarse se vuelve un pago (fuente estado_cuenta, id_externo = huella), se reconoce como ya registrado o se descarta.';

-- Lo escribe una persona de administración o finanzas. Nada se reescribe salvo
-- resolver un renglón pendiente o confirmar una importación en propuesta.
CREATE FUNCTION cobranza_estado_cuenta_revisar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF app_usuario() IS NULL OR NOT flujo_editor(NEW.company_id) THEN
    RAISE EXCEPTION 'sin_permiso_para_cobranza';
  END IF;
  IF TG_TABLE_NAME = 'collection_statement_mappings' THEN
    IF NEW.actualizado_por IS DISTINCT FROM app_usuario()
      OR (TG_OP = 'UPDATE' AND (NEW.company_id, NEW.banco) IS DISTINCT FROM (OLD.company_id, OLD.banco))
    THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'collection_statement_imports' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.subido_por IS DISTINCT FROM app_usuario() OR NEW.estado <> 'propuesta' THEN
        RAISE EXCEPTION 'sin_permiso_para_cobranza';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.id, NEW.company_id, NEW.banco, NEW.nombre_archivo, NEW.huella_archivo, NEW.renglones, NEW.abonos, NEW.nuevos, NEW.subido_por, NEW.subido_en)
      IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.banco, OLD.nombre_archivo, OLD.huella_archivo, OLD.renglones, OLD.abonos, OLD.nuevos, OLD.subido_por, OLD.subido_en)
    THEN
      RAISE EXCEPTION 'cobranza_inmutable';
    END IF;
    IF OLD.estado <> 'propuesta' OR NEW.confirmado_por IS DISTINCT FROM app_usuario() THEN
      RAISE EXCEPTION 'importacion_ya_confirmada';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'pendiente' THEN
      RAISE EXCEPTION 'sin_permiso_para_cobranza';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.company_id, NEW.import_id, NEW.huella, NEW.fecha, NEW.monto_centavos, NEW.concepto, NEW.referencia, NEW.clave_rastreo)
    IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.import_id, OLD.huella, OLD.fecha, OLD.monto_centavos, OLD.concepto, OLD.referencia, OLD.clave_rastreo)
  THEN
    RAISE EXCEPTION 'cobranza_inmutable';
  END IF;
  IF OLD.estado <> 'pendiente' OR NEW.resuelto_por IS DISTINCT FROM app_usuario() THEN
    RAISE EXCEPTION 'renglon_ya_resuelto';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collection_statement_mappings_revisar
BEFORE INSERT OR UPDATE ON collection_statement_mappings
FOR EACH ROW EXECUTE FUNCTION cobranza_estado_cuenta_revisar();
CREATE TRIGGER collection_statement_imports_revisar
BEFORE INSERT OR UPDATE ON collection_statement_imports
FOR EACH ROW EXECUTE FUNCTION cobranza_estado_cuenta_revisar();
CREATE TRIGGER collection_statement_rows_revisar
BEFORE INSERT OR UPDATE ON collection_statement_rows
FOR EACH ROW EXECUTE FUNCTION cobranza_estado_cuenta_revisar();

-- Nada se borra ---------------------------------------------------------------------

CREATE TRIGGER collection_settings_no_se_borra BEFORE DELETE ON collection_settings FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_customers_no_se_borra BEFORE DELETE ON collection_customers FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_plans_no_se_borra BEFORE DELETE ON collection_plans FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_charges_no_se_borra BEFORE DELETE ON collection_charges FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_payments_no_se_borra BEFORE DELETE ON collection_payments FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_applications_no_se_borra BEFORE DELETE ON collection_applications FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_emails_no_se_borra BEFORE DELETE ON collection_emails FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_email_deliveries_no_se_borra BEFORE DELETE ON collection_email_deliveries FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_provider_accounts_no_se_borra BEFORE DELETE ON collection_provider_accounts FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_virtual_accounts_no_se_borra BEFORE DELETE ON collection_virtual_accounts FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_provider_events_no_se_borra BEFORE DELETE ON collection_provider_events FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_statement_mappings_no_se_borra BEFORE DELETE ON collection_statement_mappings FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_statement_imports_no_se_borra BEFORE DELETE ON collection_statement_imports FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();
CREATE TRIGGER collection_statement_rows_no_se_borra BEFORE DELETE ON collection_statement_rows FOR EACH ROW EXECUTE FUNCTION cobranza_no_se_borra();

-- Toda escritura deja su evento en la misma transacción ---------------------------
-- Cualquier acción del catálogo sobre esa fila (src/server/bitacora/auditar.ts).
-- Apartar un correo (enviando) no se audita; cerrarlo, sí.

CREATE FUNCTION cobranza_exige_auditoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fila_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'collection_emails' THEN
    IF NEW.estado = 'enviando' THEN
      RETURN NULL;
    END IF;
  END IF;
  -- Sin CASE: PL/pgSQL resuelve NEW.id aunque la rama no corra, y la configuración no tiene id.
  IF TG_TABLE_NAME IN ('collection_settings', 'collection_provider_accounts', 'collection_statement_mappings') THEN
    fila_id := NEW.company_id;
  ELSE
    fila_id := NEW.id;
  END IF;
  IF NOT bitacora_tiene_evento(NEW.company_id, NULL, TG_TABLE_NAME, fila_id) THEN
    RAISE EXCEPTION 'auditoria_de_cobranza_ausente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER collection_settings_auditoria
AFTER INSERT OR UPDATE ON collection_settings DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_customers_auditoria
AFTER INSERT OR UPDATE ON collection_customers DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_plans_auditoria
AFTER INSERT OR UPDATE ON collection_plans DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_charges_auditoria
AFTER INSERT OR UPDATE ON collection_charges DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_payments_auditoria
AFTER INSERT OR UPDATE ON collection_payments DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_applications_auditoria
AFTER INSERT ON collection_applications DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_emails_auditoria
AFTER INSERT OR UPDATE ON collection_emails DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_email_deliveries_auditoria
AFTER INSERT ON collection_email_deliveries DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_provider_accounts_auditoria
AFTER INSERT OR UPDATE ON collection_provider_accounts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_virtual_accounts_auditoria
AFTER INSERT ON collection_virtual_accounts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_provider_events_auditoria
AFTER INSERT ON collection_provider_events DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_statement_mappings_auditoria
AFTER INSERT OR UPDATE ON collection_statement_mappings DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_statement_imports_auditoria
AFTER INSERT OR UPDATE ON collection_statement_imports DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();
CREATE CONSTRAINT TRIGGER collection_statement_rows_auditoria
AFTER INSERT OR UPDATE ON collection_statement_rows DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobranza_exige_auditoria();

-- Puertas sin empresa ----------------------------------------------------------------

-- La tarea (plataforma_tarea, ya autenticada con CRON_SECRET) pide solo los ids
-- de las empresas activas con cobranza configurada. Lo demás lo lee empresa
-- por empresa con su contexto y RLS normal.
CREATE FUNCTION empresas_con_cobranza()
RETURNS TABLE (company_id uuid, operator_id uuid, demostracion boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.company_id, c.operator_id, c.demostracion
  FROM collection_settings s
  JOIN companies c ON c.id = s.company_id
  WHERE c.estado = 'activa'
    AND EXISTS (SELECT 1 FROM collection_customers k WHERE k.company_id = s.company_id AND k.estado = 'activo')
  ORDER BY s.company_id
$$;

REVOKE ALL ON FUNCTION empresas_con_cobranza() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION empresas_con_cobranza() TO plataforma_tarea;

-- La página del pagador: con el hash del token del correo, solo lo que esa
-- página muestra. Sin sesión ni empresa en el contexto, como abrir una invitación.
CREATE FUNCTION cobranza_por_enlace(p_hash text)
RETURNS TABLE (
  company_id uuid,
  operator_id uuid,
  customer_id uuid,
  charge_id uuid,
  razon_social text,
  cliente text,
  concepto text,
  periodicidad text,
  monto_centavos bigint,
  pagado_centavos bigint,
  vencimiento date,
  referencia text,
  estado text,
  pagado_el date,
  clabe text,
  beneficiario text,
  correo_contacto text,
  recordatorios boolean,
  enlace_vence date,
  demostracion boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.company_id, e.operator_id, c.customer_id, c.id, e.razon_social, k.nombre, c.concepto, p.periodicidad,
         c.monto_centavos, c.pagado_centavos, c.vencimiento, c.referencia, c.estado, c.pagado_el,
         coalesce(v.clabe, s.clabe), CASE WHEN v.clabe IS NOT NULL THEN e.razon_social ELSE s.beneficiario END,
         s.correo_contacto, k.recordatorios, m.enlace_vence, e.demostracion
  FROM collection_emails m
  JOIN collection_charges c ON c.id = m.charge_id AND c.company_id = m.company_id
  JOIN collection_customers k ON k.id = c.customer_id AND k.company_id = c.company_id
  LEFT JOIN collection_plans p ON p.id = c.plan_id AND p.company_id = c.company_id
  JOIN collection_settings s ON s.company_id = c.company_id
  JOIN companies e ON e.id = c.company_id
  -- La CLABE propia del cliente en el proveedor SPEI va primero.
  LEFT JOIN collection_virtual_accounts v ON v.company_id = c.company_id AND v.customer_id = c.customer_id AND v.proveedor = 'fintoc'
  WHERE p_hash ~ '^[0-9a-f]{64}$' AND m.enlace_hash = p_hash
$$;

REVOKE ALL ON FUNCTION cobranza_por_enlace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cobranza_por_enlace(text) TO plataforma_cliente;

-- Permisos mínimos y RLS --------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON collection_settings TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON collection_customers TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON collection_plans TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON collection_charges TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON collection_payments TO plataforma_cliente;
GRANT SELECT, INSERT ON collection_applications TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON collection_emails TO plataforma_cliente;
GRANT SELECT, INSERT ON collection_email_deliveries TO plataforma_cliente;
-- La cuenta del proveedor solo se lee desde la empresa; la escribe cobranza_registrar_cuenta_proveedor.
GRANT SELECT ON collection_provider_accounts TO plataforma_cliente;
GRANT SELECT, INSERT ON collection_virtual_accounts TO plataforma_cliente;
GRANT SELECT, INSERT ON collection_provider_events TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON collection_statement_mappings TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON collection_statement_imports TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON collection_statement_rows TO plataforma_cliente;

ALTER TABLE collection_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_email_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_settings_cliente ON collection_settings FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_customers_cliente ON collection_customers FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_plans_cliente ON collection_plans FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_charges_cliente ON collection_charges FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_payments_cliente ON collection_payments FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_applications_cliente ON collection_applications FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_emails_cliente ON collection_emails FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_email_deliveries_cliente ON collection_email_deliveries FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());

ALTER TABLE collection_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_customers FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_emails FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_email_deliveries FORCE ROW LEVEL SECURITY;

ALTER TABLE collection_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_virtual_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_statement_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_statement_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_provider_accounts_cliente ON collection_provider_accounts FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_virtual_accounts_cliente ON collection_virtual_accounts FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_provider_events_cliente ON collection_provider_events FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_statement_mappings_cliente ON collection_statement_mappings FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_statement_imports_cliente ON collection_statement_imports FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY collection_statement_rows_cliente ON collection_statement_rows FOR ALL TO plataforma_cliente
  USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());

ALTER TABLE collection_provider_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_virtual_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_provider_events FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_statement_mappings FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_statement_imports FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_statement_rows FORCE ROW LEVEL SECURITY;
