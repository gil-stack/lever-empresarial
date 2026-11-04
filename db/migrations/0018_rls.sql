-- Fase 4. Segunda pared: roles de base de datos y seguridad a nivel de filas.
--
-- La aplicación no consulta como dueña de las tablas. Cada transacción baja a
-- un rol sin BYPASSRLS con SET LOCAL ROLE y fija su contexto con set_config
-- local a la transacción (Neon agrupa conexiones en modo transacción: un
-- ajuste de sesión podría pasar a la petición de otro cliente).
--
--   plataforma_cliente  Portal del cliente. Lee y escribe solo la empresa del
--                       contexto (app.company_id).
--   plataforma_sofipo   Personal del operador. Escribe lo de la plataforma:
--                       lista 69-B, precio, alta de empresas, invitaciones y
--                       personal. No tiene permiso sobre personas, proveedores,
--                       política ni lotes de un cliente.
--
-- El dueño (quien migra) sigue siendo el único dueño de las tablas. Las
-- funciones SECURITY DEFINER de abajo son las únicas puertas sin empresa:
-- entrar, leer la sesión y abrir una invitación.

SET search_path TO public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_cliente') THEN
    CREATE ROLE plataforma_cliente NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plataforma_sofipo') THEN
    CREATE ROLE plataforma_sofipo NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END;
$$;

COMMENT ON ROLE plataforma_cliente IS 'Portal del cliente. Sin BYPASSRLS. Solo la empresa de app.company_id.';
COMMENT ON ROLE plataforma_sofipo IS 'Personal del operador. Sin BYPASSRLS. Escribe solo datos de plataforma.';

-- Quien conecta con el connection string del dueño baja a estos roles en cada
-- transacción. Un connection string propio de cada rol también sirve.
GRANT plataforma_cliente TO CURRENT_USER;
GRANT plataforma_sofipo TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO plataforma_cliente, plataforma_sofipo;

-- Contexto de la transacción ------------------------------------------------------

CREATE FUNCTION app_empresa() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;

CREATE FUNCTION app_usuario() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_operador() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.operator_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_empresa() IS 'Empresa del contexto de la transacción. Vacía fuera de una empresa.';

-- Puertas sin empresa ------------------------------------------------------------

CREATE FUNCTION identidad_por_correo(p_correo text)
RETURNS TABLE (id uuid, nombre text, correo text, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.nombre, u.correo, u.password_hash
  FROM users AS u
  WHERE lower(u.correo) = lower(p_correo)
$$;

CREATE FUNCTION usuario_por_correo(p_correo text)
RETURNS TABLE (id uuid, nombre text, tiene_contrasena boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.nombre, u.password_hash IS NOT NULL
  FROM users AS u
  WHERE lower(u.correo) = lower(p_correo)
$$;

-- p_completa verdadero: solo sesiones con segundo factor verificado. Falso:
-- solo las parciales, que únicamente sirven para verificar ese factor.
CREATE FUNCTION sesion_por_token(p_token_hash text, p_ahora timestamptz, p_completa boolean)
RETURNS TABLE (
  sesion_id uuid,
  user_id uuid,
  nombre text,
  correo text,
  expires_at timestamptz,
  superficie text,
  segundo_factor_en timestamptz,
  segundo_factor_metodo text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, u.id, u.nombre, u.correo, s.expires_at, s.superficie,
         s.segundo_factor_en, s.segundo_factor_metodo
  FROM sessions AS s
  JOIN users AS u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash
    AND s.expires_at > p_ahora
    AND u.password_hash IS NOT NULL
    AND (s.segundo_factor_en IS NOT NULL) = p_completa
$$;

CREATE FUNCTION invitacion_por_token(p_token_hash text)
RETURNS TABLE (
  id uuid,
  operator_id uuid,
  company_id uuid,
  user_id uuid,
  nombre text,
  correo text,
  razon_social text,
  tiene_contrasena boolean,
  expira_en timestamptz,
  usada_en timestamptz,
  revocada_en timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.operator_id, i.company_id, i.user_id, u.nombre, u.correo, c.razon_social,
         u.password_hash IS NOT NULL, i.expira_en, i.usada_en, i.revocada_en
  FROM invitations AS i
  JOIN users AS u ON u.id = i.user_id
  LEFT JOIN companies AS c ON c.id = i.company_id
  WHERE i.token_hash = p_token_hash
$$;

REVOKE ALL ON FUNCTION identidad_por_correo(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION usuario_por_correo(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION sesion_por_token(text, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION invitacion_por_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identidad_por_correo(text) TO plataforma_cliente;
GRANT EXECUTE ON FUNCTION usuario_por_correo(text) TO plataforma_cliente, plataforma_sofipo;
GRANT EXECUTE ON FUNCTION sesion_por_token(text, timestamptz, boolean) TO plataforma_cliente;
GRANT EXECUTE ON FUNCTION invitacion_por_token(text) TO plataforma_cliente;

-- Lo que la plataforma hace por todos corre como su dueño: sembrar política,
-- cajones y suscripción de una empresa nueva, y releer a los proveedores
-- cuando entra una copia nueva de la 69-B.
ALTER FUNCTION companies_siembra_politica_y_cajones() SECURITY DEFINER;
ALTER FUNCTION companies_exige_politica_y_cajones() SECURITY DEFINER;
ALTER FUNCTION companies_abre_recorrido() SECURITY DEFINER;
ALTER FUNCTION releer_proveedores_69b(uuid, timestamptz) SECURITY DEFINER;
ALTER FUNCTION lista_69b_relee_al_cerrar() SECURITY DEFINER;

-- Releer toca proveedores de todas las empresas: solo la plataforma la llama.
REVOKE ALL ON FUNCTION releer_proveedores_69b(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION releer_proveedores_69b(uuid, timestamptz) TO plataforma_sofipo;
REVOKE ALL ON FUNCTION bitacora_tiene_evento(uuid, text, text, uuid) FROM PUBLIC;

-- Permisos por tabla -----------------------------------------------------------

GRANT SELECT ON operators TO plataforma_cliente, plataforma_sofipo;

GRANT SELECT ON companies TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON companies TO plataforma_sofipo;

GRANT SELECT, INSERT ON users TO plataforma_cliente, plataforma_sofipo;
GRANT UPDATE (nombre, password_hash, correo_verificado_en) ON users TO plataforma_cliente, plataforma_sofipo;

GRANT SELECT, INSERT, DELETE ON sessions TO plataforma_cliente;
GRANT UPDATE (token_hash, expires_at, segundo_factor_en, segundo_factor_metodo) ON sessions TO plataforma_cliente;

GRANT SELECT, INSERT, UPDATE ON memberships TO plataforma_cliente, plataforma_sofipo;
GRANT SELECT, INSERT, DELETE ON membership_roles TO plataforma_cliente;
GRANT SELECT, INSERT ON membership_roles TO plataforma_sofipo;

GRANT SELECT ON platform_staff, platform_staff_roles TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON platform_staff TO plataforma_sofipo;
GRANT SELECT, INSERT ON platform_staff_roles TO plataforma_sofipo;

GRANT SELECT, INSERT ON invitations TO plataforma_cliente, plataforma_sofipo;
GRANT UPDATE (usada_en, revocada_en) ON invitations TO plataforma_cliente, plataforma_sofipo;

GRANT SELECT, INSERT ON audit_log TO plataforma_cliente, plataforma_sofipo;
GRANT SELECT ON audit_events TO plataforma_cliente;

GRANT SELECT, INSERT ON cost_centers TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON employees TO plataforma_cliente;
GRANT SELECT, UPDATE ON policies TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE, DELETE ON policy_persons TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE, DELETE ON policy_categories TO plataforma_cliente;
GRANT SELECT ON drawers, postings TO plataforma_cliente;
GRANT SELECT ON subscriptions TO plataforma_cliente;
GRANT SELECT, UPDATE ON subscriptions TO plataforma_sofipo;
GRANT SELECT, INSERT, UPDATE ON lotes_prueba TO plataforma_cliente;
GRANT SELECT, INSERT ON documents TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON suppliers TO plataforma_cliente;
GRANT SELECT, INSERT, UPDATE ON supplier_clabes TO plataforma_cliente;

-- La lista 69-B y el precio son de la plataforma: el cliente solo los lee.
GRANT SELECT ON lista_69b_snapshots, lista_69b_rows, platform_pricing TO plataforma_cliente;
GRANT SELECT, INSERT ON lista_69b_snapshots, lista_69b_rows TO plataforma_sofipo;
GRANT SELECT, UPDATE ON platform_pricing TO plataforma_sofipo;

-- RLS en todas las tablas de la aplicación ------------------------------------------

ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawers ENABLE ROW LEVEL SECURITY;
ALTER TABLE postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes_prueba ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_clabes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lista_69b_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE lista_69b_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_pricing ENABLE ROW LEVEL SECURITY;

-- Cliente: la empresa del contexto -------------------------------------------------

CREATE POLICY operators_lectura ON operators FOR SELECT TO plataforma_cliente USING (true);

-- Con empresa en el contexto, solo esa. Sin empresa (al resolver quién entra),
-- solo las empresas donde la persona tiene membresía activa.
CREATE POLICY companies_cliente ON companies FOR SELECT TO plataforma_cliente
USING (
  CASE
    WHEN app_empresa() IS NOT NULL THEN id = app_empresa()
    ELSE EXISTS (
      SELECT 1 FROM memberships AS m
      WHERE m.company_id = companies.id AND m.user_id = app_usuario() AND m.estado = 'activa'
    )
  END
);

CREATE POLICY memberships_cliente ON memberships FOR ALL TO plataforma_cliente
USING (
  CASE WHEN app_empresa() IS NOT NULL THEN company_id = app_empresa() ELSE user_id = app_usuario() END
)
WITH CHECK (company_id = app_empresa());

CREATE POLICY membership_roles_cliente ON membership_roles FOR ALL TO plataforma_cliente
USING (
  CASE WHEN app_empresa() IS NOT NULL THEN company_id = app_empresa() ELSE user_id = app_usuario() END
)
WITH CHECK (company_id = app_empresa());

-- La persona se ve a sí misma y a quien tiene membresía en la empresa del contexto.
CREATE POLICY users_cliente_lectura ON users FOR SELECT TO plataforma_cliente
USING (
  id = app_usuario()
  OR EXISTS (
    SELECT 1 FROM memberships AS m WHERE m.user_id = users.id AND m.company_id = app_empresa()
  )
);
CREATE POLICY users_cliente_alta ON users FOR INSERT TO plataforma_cliente WITH CHECK (app_empresa() IS NOT NULL);
CREATE POLICY users_cliente_propia ON users FOR UPDATE TO plataforma_cliente
USING (id = app_usuario()) WITH CHECK (id = app_usuario());

CREATE POLICY sessions_cliente ON sessions FOR ALL TO plataforma_cliente
USING (user_id = app_usuario()) WITH CHECK (user_id = app_usuario());

CREATE POLICY platform_staff_propio ON platform_staff FOR SELECT TO plataforma_cliente
USING (user_id = app_usuario());
CREATE POLICY platform_staff_roles_propio ON platform_staff_roles FOR SELECT TO plataforma_cliente
USING (user_id = app_usuario());

CREATE POLICY invitations_cliente ON invitations FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());

-- El cliente no firma como personal del operador ni como otra persona.
CREATE POLICY audit_log_cliente_lectura ON audit_log FOR SELECT TO plataforma_cliente
USING (company_id = app_empresa());
CREATE POLICY audit_log_cliente_escritura ON audit_log FOR INSERT TO plataforma_cliente
WITH CHECK (
  (company_id = app_empresa() OR (company_id IS NULL AND app_empresa() IS NULL))
  AND actor_tipo IN ('miembro', 'sistema')
  AND actor_id IS NOT DISTINCT FROM app_usuario()
  AND superficie IN ('cliente', 'telefono')
);

CREATE POLICY audit_events_cliente ON audit_events FOR SELECT TO plataforma_cliente
USING (company_id = app_empresa());

CREATE POLICY cost_centers_cliente ON cost_centers FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY employees_cliente ON employees FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY policies_cliente ON policies FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY policy_persons_cliente ON policy_persons FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY policy_categories_cliente ON policy_categories FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY drawers_cliente ON drawers FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY postings_cliente ON postings FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY subscriptions_cliente ON subscriptions FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY lotes_prueba_cliente ON lotes_prueba FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY documents_cliente ON documents FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY suppliers_cliente ON suppliers FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());
CREATE POLICY supplier_clabes_cliente ON supplier_clabes FOR ALL TO plataforma_cliente
USING (company_id = app_empresa()) WITH CHECK (company_id = app_empresa());

CREATE POLICY lista_69b_snapshots_lectura ON lista_69b_snapshots FOR SELECT TO plataforma_cliente USING (true);
CREATE POLICY lista_69b_rows_lectura ON lista_69b_rows FOR SELECT TO plataforma_cliente USING (true);
CREATE POLICY platform_pricing_lectura ON platform_pricing FOR SELECT TO plataforma_cliente USING (true);

-- Personal del operador: solo su operador -------------------------------------------

CREATE POLICY operators_sofipo ON operators FOR SELECT TO plataforma_sofipo USING (id = app_operador());

CREATE POLICY companies_sofipo ON companies FOR ALL TO plataforma_sofipo
USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

CREATE POLICY users_sofipo_lectura ON users FOR SELECT TO plataforma_sofipo USING (id = app_usuario());
CREATE POLICY users_sofipo_alta ON users FOR INSERT TO plataforma_sofipo WITH CHECK (app_operador() IS NOT NULL);
CREATE POLICY users_sofipo_propia ON users FOR UPDATE TO plataforma_sofipo
USING (id = app_usuario()) WITH CHECK (id = app_usuario());

-- El personal invita al primer administrador de una empresa de su operador.
CREATE POLICY memberships_sofipo ON memberships FOR ALL TO plataforma_sofipo
USING (EXISTS (SELECT 1 FROM companies AS c WHERE c.id = memberships.company_id AND c.operator_id = app_operador()))
WITH CHECK (EXISTS (SELECT 1 FROM companies AS c WHERE c.id = memberships.company_id AND c.operator_id = app_operador()));
CREATE POLICY membership_roles_sofipo ON membership_roles FOR ALL TO plataforma_sofipo
USING (EXISTS (SELECT 1 FROM companies AS c WHERE c.id = membership_roles.company_id AND c.operator_id = app_operador()))
WITH CHECK (EXISTS (SELECT 1 FROM companies AS c WHERE c.id = membership_roles.company_id AND c.operator_id = app_operador()));

CREATE POLICY platform_staff_sofipo ON platform_staff FOR ALL TO plataforma_sofipo
USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());
CREATE POLICY platform_staff_roles_sofipo ON platform_staff_roles FOR ALL TO plataforma_sofipo
USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

CREATE POLICY invitations_sofipo ON invitations FOR ALL TO plataforma_sofipo
USING (operator_id = app_operador()) WITH CHECK (operator_id = app_operador());

CREATE POLICY subscriptions_sofipo ON subscriptions FOR ALL TO plataforma_sofipo
USING (EXISTS (SELECT 1 FROM companies AS c WHERE c.id = subscriptions.company_id AND c.operator_id = app_operador()))
WITH CHECK (EXISTS (SELECT 1 FROM companies AS c WHERE c.id = subscriptions.company_id AND c.operator_id = app_operador()));

CREATE POLICY audit_log_sofipo_lectura ON audit_log FOR SELECT TO plataforma_sofipo
USING (operator_id = app_operador());
CREATE POLICY audit_log_sofipo_escritura ON audit_log FOR INSERT TO plataforma_sofipo
WITH CHECK (
  operator_id = app_operador()
  AND actor_tipo IN ('personal', 'sistema')
  AND actor_id IS NOT DISTINCT FROM app_usuario()
  AND superficie IN ('sofipo', 'sistema')
);

CREATE POLICY lista_69b_snapshots_sofipo ON lista_69b_snapshots FOR ALL TO plataforma_sofipo
USING (true) WITH CHECK (true);
CREATE POLICY lista_69b_rows_sofipo ON lista_69b_rows FOR ALL TO plataforma_sofipo
USING (true) WITH CHECK (true);
CREATE POLICY platform_pricing_sofipo ON platform_pricing FOR ALL TO plataforma_sofipo
USING (true) WITH CHECK (true);
