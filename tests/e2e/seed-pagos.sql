set client_encoding = 'UTF8';
begin;
select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', false);
insert into users (id, nombre, correo) values
  ('11111111-1111-4111-8111-111111111111', 'Gil Villarreal', 'gil-pagos@ejemplo.mx'),
  ('22222222-2222-4222-8222-222222222222', 'Rosa Liberadora', 'rosa-pagos@ejemplo.mx');
insert into companies (id, rfc, razon_social, codigo_postal, regimen, uso_cfdi, operator_id, estado, demostracion)
  values ('33333333-3333-4333-8333-333333333333', 'EKU9003173C9', 'Taller del Cierre', '06600', '601', 'G03',
    (select id from operators order by alta_en limit 1), 'activa', true);
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'alta_empresa', 'companies', '33333333-3333-4333-8333-333333333333' from companies where id = '33333333-3333-4333-8333-333333333333';
insert into memberships (user_id, company_id, estado) values
  ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'activa'),
  ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'activa');
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'asignar_rol', 'membership_roles', '11111111-1111-4111-8111-111111111111', '{"rol":"administrador"}' from companies where id = '33333333-3333-4333-8333-333333333333';
insert into membership_roles (user_id, company_id, rol) values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'administrador');
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'asignar_rol', 'membership_roles', '11111111-1111-4111-8111-111111111111', '{"rol":"liberador"}' from companies where id = '33333333-3333-4333-8333-333333333333';
insert into membership_roles (user_id, company_id, rol) values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'liberador');
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'asignar_rol', 'membership_roles', '22222222-2222-4222-8222-222222222222', '{"rol":"liberador"}' from companies where id = '33333333-3333-4333-8333-333333333333';
insert into membership_roles (user_id, company_id, rol) values ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'liberador');

insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values ('66666666-6666-4666-8666-666666666666', date '2026-09-30', timestamptz '2026-10-01 15:00:00+00');
insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
  values ((select id from operators order by alta_en limit 1), 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', '66666666-6666-4666-8666-666666666666');
insert into lista_69b_rows (snapshot_id, rfc, situacion) values ('66666666-6666-4666-8666-666666666666', 'PAL7202161U0', 'Presunto');

insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en) values
  ('55555555-5555-4555-8555-555555555551', '33333333-3333-4333-8333-333333333333', 'demo/constancia-1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'application/pdf', 'Constancia_Proveedor_Uno.pdf', now()),
  ('55555555-5555-4555-8555-555555555552', '33333333-3333-4333-8333-333333333333', 'demo/constancia-2', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'application/pdf', 'Constancia_Servicios_Norte.pdf', now()),
  ('55555555-5555-4555-8555-555555555553', '33333333-3333-4333-8333-333333333333', 'demo/constancia-3', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'application/pdf', 'Constancia_Editorial.pdf', now());
insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en, nombre_comercial, contacto_correo, dias_credito) values
  ('44444444-4444-4444-8444-444444444441', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555551', '66666666-6666-4666-8666-666666666666', 'AAA010101AAA', 'Proveedor Uno, S.A. de C.V.', date '2026-09-30', now(), true, now(), 'Proveedor Uno', 'facturas@proveedoruno.mx', 30),
  ('44444444-4444-4444-8444-444444444442', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555552', '66666666-6666-4666-8666-666666666666', 'BBB020202BA2', 'Servicios Norte Integrales', date '2026-09-30', now(), true, now(), 'Norte Integrales', 'contacto@norte.mx', 15),
  ('44444444-4444-4444-8444-444444444443', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555553', '66666666-6666-4666-8666-666666666666', 'CCC030303CA3', 'Editorial Taller del Cierre', date '2026-09-30', now(), true, now(), 'Editorial TDC', null, 45);
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
  select c.operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'alta_proveedor', 'suppliers', s.id from suppliers s join companies c on c.id = s.company_id where s.company_id = '33333333-3333-4333-8333-333333333333';
insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
  select md5(s.id::text || 'clabe')::uuid, s.company_id, s.id, '002180701150123452', true, now() from suppliers s where s.company_id = '33333333-3333-4333-8333-333333333333';
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
  select c.operator_id, sc.company_id, 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'clabe_proveedor', 'supplier_clabes', sc.id from supplier_clabes sc join companies c on c.id = sc.company_id where sc.company_id = '33333333-3333-4333-8333-333333333333';

insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, motivo_excepcion, creado_por, creado_en, actualizado_en) values
  ('77777777-7777-4777-8777-777777777771', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444441', 'cfdi', '123E4567-E89B-42D3-A456-426614174001', 'A', '81', 'A-81', 4821500, current_date - 12, current_date + 5, current_date + 2, null, '11111111-1111-4111-8111-111111111111', now(), now()),
  ('77777777-7777-4777-8777-777777777772', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444442', 'cfdi', '123E4567-E89B-42D3-A456-426614174002', 'N', '204', 'N-204', 1269000, current_date - 35, current_date - 3, current_date + 1, null, '11111111-1111-4111-8111-111111111111', now(), now()),
  ('77777777-7777-4777-8777-777777777773', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444443', 'excepcion', null, null, null, 'Diseño editorial Q4', 890000, current_date - 5, current_date + 15, current_date + 4, 'Trabajo extraordinario aprobado por dirección', '11111111-1111-4111-8111-111111111111', now(), now());
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
  select c.operator_id, p.company_id, 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'crear_cargo_proveedor', 'supplier_payables', p.id, json_build_object('origen', p.origen, 'total_centavos', p.total_centavos) from supplier_payables p join companies c on c.id = p.company_id where p.company_id = '33333333-3333-4333-8333-333333333333';

insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, solicitado_por, solicitado_en, creado_en)
  select '88888888-8888-4888-8888-888888888881', p.company_id, p.id, sc.id, sc.clabe, p.total_centavos, p.programada_el, '11111111-1111-4111-8111-111111111111', now(), now()
    from supplier_payables p join supplier_clabes sc on sc.company_id = p.company_id and sc.supplier_id = p.supplier_id and sc.vigente_hasta is null where p.id = '77777777-7777-4777-8777-777777777771';
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'solicitar_pago_proveedor', 'supplier_payment_requests', '88888888-8888-4888-8888-888888888881', '{"total_centavos":4821500}' from companies where id = '33333333-3333-4333-8333-333333333333';
select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', false);
update supplier_payment_requests set estado = 'listo_para_pagar', resuelto_por = '22222222-2222-4222-8222-222222222222', resuelto_en = now() where id = '88888888-8888-4888-8888-888888888881';
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '22222222-2222-4222-8222-222222222222', 'cliente', 'autorizar_pago_proveedor', 'supplier_payment_requests', '88888888-8888-4888-8888-888888888881' from companies where id = '33333333-3333-4333-8333-333333333333';

select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', false);
insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, solicitado_por, solicitado_en, creado_en)
  select '88888888-8888-4888-8888-888888888882', p.company_id, p.id, sc.id, sc.clabe, p.total_centavos, p.programada_el, '11111111-1111-4111-8111-111111111111', now(), now()
    from supplier_payables p join supplier_clabes sc on sc.company_id = p.company_id and sc.supplier_id = p.supplier_id and sc.vigente_hasta is null where p.id = '77777777-7777-4777-8777-777777777772';
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'solicitar_pago_proveedor', 'supplier_payment_requests', '88888888-8888-4888-8888-888888888882', '{"total_centavos":1269000}' from companies where id = '33333333-3333-4333-8333-333333333333';

insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, solicitado_por, solicitado_en, creado_en)
  select '88888888-8888-4888-8888-888888888883', p.company_id, p.id, sc.id, sc.clabe, p.total_centavos, p.programada_el, '11111111-1111-4111-8111-111111111111', now(), now()
    from supplier_payables p join supplier_clabes sc on sc.company_id = p.company_id and sc.supplier_id = p.supplier_id and sc.vigente_hasta is null where p.id = '77777777-7777-4777-8777-777777777773';
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '11111111-1111-4111-8111-111111111111', 'cliente', 'solicitar_pago_proveedor', 'supplier_payment_requests', '88888888-8888-4888-8888-888888888883', '{"total_centavos":890000}' from companies where id = '33333333-3333-4333-8333-333333333333';
select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', false);
update supplier_payment_requests set estado = 'rechazado', resuelto_por = '22222222-2222-4222-8222-222222222222', resuelto_en = now(), motivo_resolucion = 'Falta el desglose por entregable' where id = '88888888-8888-4888-8888-888888888883';
insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, motivo)
  select operator_id, '33333333-3333-4333-8333-333333333333', 'miembro', '22222222-2222-4222-8222-222222222222', 'cliente', 'rechazar_pago_proveedor', 'supplier_payment_requests', '88888888-8888-4888-8888-888888888883', 'Falta el desglose por entregable' from companies where id = '33333333-3333-4333-8333-333333333333';

update users set password_hash = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234';
insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en) values
  ('99999999-9999-4999-8999-999999999981', '11111111-1111-4111-8111-111111111111', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', now() - interval '1 minute', now() + interval '10 minutes', 'totp', now(), now()),
  ('99999999-9999-4999-8999-999999999982', '22222222-2222-4222-8222-222222222222', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', now() - interval '1 minute', now() + interval '10 minutes', 'totp', now(), now());
insert into sessions (id, user_id, token_hash, expires_at, superficie, segundo_factor, entrada_id) values
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', encode(sha256('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'::bytea), 'hex'), now() + interval '12 hours', 'cliente', 'totp', '99999999-9999-4999-8999-999999999981'),
  ('99999999-9999-4999-8999-999999999992', '22222222-2222-4222-8222-222222222222', encode(sha256('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'::bytea), 'hex'), now() + interval '12 hours', 'cliente', 'totp', '99999999-9999-4999-8999-999999999982');
commit;
