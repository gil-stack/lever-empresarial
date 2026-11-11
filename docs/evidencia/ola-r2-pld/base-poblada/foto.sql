\pset pager off
\echo == relaciones: dueño y ACL
select c.relname, c.relkind, pg_get_userbyid(c.relowner) as dueno, coalesce(c.relacl::text, '') as acl, c.relrowsecurity as rls, c.relforcerowsecurity as forzada
from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f') order by 1;
\echo == columnas con ACL
select c.relname, a.attname, a.attacl::text from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and a.attacl is not null order by 1, 2;
\echo == funciones: dueño, ACL y definer
select p.oid::regprocedure::text as funcion, pg_get_userbyid(p.proowner) as dueno, coalesce(p.proacl::text, '(por omisión: PUBLIC)') as acl, p.prosecdef as definer,
       coalesce(array_to_string(p.proconfig, ','), '') as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1;
\echo == tipos y dominios: dueño
select t.typname, pg_get_userbyid(t.typowner) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype in ('e','d','c') and t.typrelid = 0 or (n.nspname='public' and t.typtype in ('e','d')) order by 1;
\echo == políticas
select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2;
\echo == membresías de roles
select r.rolname as rol, m.rolname as miembro, am.admin_option from pg_auth_members am join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member
where r.rolname like 'plataforma%' or m.rolname like 'plataforma%' order by 1, 2;
\echo == privilegios por omisión
select pg_get_userbyid(defaclrole), defaclobjtype, defaclacl::text from pg_default_acl order by 1, 2;
\echo == esquema public
select nspname, pg_get_userbyid(nspowner), nspacl::text from pg_namespace where nspname = 'public';
\echo == extensiones
select extname, extversion, pg_get_userbyid(extowner) from pg_extension order by 1;
