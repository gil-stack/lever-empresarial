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
--    aplicación ni las migraciones crean tablas temporales con esos roles. Si
--    quien migra no es dueña de la base, el REVOKE no surte efecto y la
--    migración se detiene.
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
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  FOR rol IN
    SELECT rolname FROM pg_roles
    WHERE rolname IN ('plataforma_app', 'plataforma_cliente', 'plataforma_sofipo', 'plataforma_tarea')
  LOOP
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM %I', current_database(), rol);
    IF has_database_privilege(rol, current_database(), 'TEMPORARY') THEN
      RAISE EXCEPTION 'El rol % todavía crea tablas temporales: quien migra tiene que ser dueña de la base', rol;
    END IF;
  END LOOP;
END
$$;
