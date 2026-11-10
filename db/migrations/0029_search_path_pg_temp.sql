-- Las funciones SECURITY DEFINER buscan las tablas temporales al final, y los
-- roles de la aplicación ya no crean tablas temporales.
--
-- Una función SECURITY DEFINER corre con los privilegios de su dueña. Con
-- «SET search_path = public», Postgres busca primero en el esquema temporal de
-- quien llama: pg_temp va implícito al inicio cuando no se nombra. Una tabla
-- temporal con el nombre de una tabla real desvía la función. La documentación
-- de Postgres 17 («Writing SECURITY DEFINER Functions Safely», en CREATE
-- FUNCTION) pide nombrar pg_temp al final. El esquema temporal nunca se busca
-- para funciones ni operadores, solo para tablas, vistas, secuencias y tipos.
--
-- 1. Cada SECURITY DEFINER del esquema public pasa a «public, pg_temp». La lista
--    sale de pg_proc, no se escribe a mano. Si alguna trae otro search_path, la
--    migración se detiene para revisarla.
-- 2. TEMPORARY sobre la base viene de PUBLIC por omisión. Se le quita a PUBLIC y
--    a los roles de la aplicación; la dueña de la base lo conserva. Ni la
--    aplicación ni las migraciones crean tablas temporales con esos roles. La
--    migración se detiene si algún rol al que llega la aplicación por sus
--    membresías (plataforma_app entra con SET a cliente, sofipo y tarea) sigue
--    con TEMPORARY: pasa si quien migra no es dueña de la base o si un rol de la
--    aplicación es miembro de otro rol que lo tiene.
--
-- Toda función SECURITY DEFINER nueva lleva «SET search_path = public, pg_temp»:
-- tests/esquema/definer-search-path.test.ts lo exige. No toca datos.

DO $$
DECLARE
  funcion regprocedure;
  ruta text;
BEGIN
  FOR funcion, ruta IN
    SELECT p.oid::regprocedure,
      (SELECT substr(c, length('search_path=') + 1) FROM unnest(p.proconfig) AS c WHERE c LIKE 'search_path=%')
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend AS d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
    ORDER BY p.oid
  LOOP
    IF ruta = 'public' THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', funcion);
    ELSIF ruta IS DISTINCT FROM 'public, pg_temp' THEN
      RAISE EXCEPTION 'La función % es SECURITY DEFINER con search_path «%»: revísala antes de migrar',
        funcion, coalesce(ruta, 'sin fijar');
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  rol text;
  con_temp text;
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  FOR rol IN
    SELECT rolname FROM pg_roles
    WHERE rolname IN ('plataforma_app', 'plataforma_cliente', 'plataforma_sofipo', 'plataforma_tarea')
  LOOP
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), rol);
  END LOOP;
  -- has_database_privilege no ve las membresías con SET y sin INHERIT (así entra
  -- plataforma_app a cliente, sofipo y tarea): se recorren todas las membresías
  -- desde los roles de la aplicación y ninguno de los roles alcanzables puede
  -- tener TEMPORARY.
  WITH RECURSIVE alcanzables (oid) AS (
    SELECT oid FROM pg_roles
    WHERE rolname IN ('plataforma_app', 'plataforma_cliente', 'plataforma_sofipo', 'plataforma_tarea')
    UNION
    SELECT m.roleid FROM pg_auth_members AS m JOIN alcanzables AS a ON m.member = a.oid
  )
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO con_temp
  FROM alcanzables AS a JOIN pg_roles AS r ON r.oid = a.oid
  WHERE has_database_privilege(r.oid, current_database(), 'TEMPORARY');
  IF con_temp IS NOT NULL THEN
    RAISE EXCEPTION 'La aplicación todavía alcanza roles que crean tablas temporales (%): quien migra tiene que ser dueña de la base y ningún rol de la aplicación puede ser miembro de un rol con TEMPORARY', con_temp;
  END IF;
END
$$;
