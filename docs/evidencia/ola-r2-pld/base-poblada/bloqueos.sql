\pset pager off
SET lock_timeout = '15s';
SET client_min_messages TO warning;
BEGIN;
SELECT clock_timestamp() AS t0 \gset
\i <scratchpad>/0030-a.sql
SELECT clock_timestamp() AS t1 \gset
\i <scratchpad>/0030-b.sql
SELECT clock_timestamp() AS t2 \gset
\echo == bloqueos que tiene la transacción sobre tablas que ya existían (no pld_)
SELECT c.relname, string_agg(l.mode, ', ' ORDER BY l.mode) AS modos
FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
WHERE l.pid = pg_backend_pid() AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relname NOT LIKE 'pld\_%'
GROUP BY c.relname ORDER BY c.relname;
\echo == tiempos
SELECT round(extract(epoch FROM (:'t1'::timestamptz - :'t0'::timestamptz)) * 1000) AS ms_hasta_audit_log,
       round(extract(epoch FROM (:'t2'::timestamptz - :'t1'::timestamptz)) * 1000) AS ms_con_audit_log_tomada,
       round(extract(epoch FROM (:'t2'::timestamptz - :'t0'::timestamptz)) * 1000) AS ms_total;
ROLLBACK;
