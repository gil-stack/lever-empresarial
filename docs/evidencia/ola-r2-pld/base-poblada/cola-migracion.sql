SET lock_timeout = '15s';
SET client_min_messages TO warning;
BEGIN;
\i <scratchpad>/0030-a.sql
SELECT clock_timestamp() AS antes_de_audit_log \gset
\i <scratchpad>/0030-b.sql
ROLLBACK;
