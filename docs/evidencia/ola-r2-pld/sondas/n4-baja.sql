\echo == N4 en el head: avisos abiertos que excluyen a CUM2 (sin caso, sin dictamen o «reportar» sin acuse); ¿se puede suspender o quitarle Cumplimiento a CUM?
select count(*) as avisos_abiertos_que_excluyen_a_cum2 from pld_alertas x
  join pld_aviso_excluidos e on e.aviso_id = x.aviso_id and e.user_id = 'e0000000-0000-4000-8000-000000000005'
  left join pld_caso_alertas ca on ca.alerta_id = x.id left join pld_dictamenes d on d.caso_id = ca.caso_id
  where d.id is null or (d.resultado <> 'no_reportar' and not exists (select 1 from pld_reportes r where r.caso_id = ca.caso_id));
\echo -- suspender a CUM (dueña):
update platform_staff set estado = 'suspendido' where user_id = 'e0000000-0000-4000-8000-000000000004';
\echo -- quitarle Cumplimiento a CUM (dueña):
delete from platform_staff_roles where user_id = 'e0000000-0000-4000-8000-000000000004' and rol = 'cumplimiento';
select estado, (select count(*) from platform_staff_roles r where r.user_id = s.user_id and r.rol = 'cumplimiento') as roles_cumplimiento from platform_staff s where user_id = 'e0000000-0000-4000-8000-000000000004';
