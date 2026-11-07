/**
 * Siembra del recorrido de flujo de caja (docs/evidencia/flujo-de-caja/README.md).
 *
 *   DUENO_URL=postgres://<dueño>@127.0.0.1:5541/plataforma \
 *   DATABASE_URL=postgres://plataforma_app:<clave local>@127.0.0.1:5541/plataforma \
 *   npx tsx scripts/evidencia/flujo-de-caja-siembra.ts
 *
 * Empresas, personas, nómina, áreas, cobros y la renta pasan por los servicios
 * de la aplicación, con su bitácora. Proveedores, cargos y solicitudes de pago
 * se escriben como dueño en una sola transacción con el evento que cada trigger
 * exige (como tests/e2e/seed-pagos.sql): el alta por pantalla pide una
 * constancia en Blob y la solicitud, dos liberadores con sesión. Las fechas son
 * relativas al día de la corrida en hora de México. Solo acepta un Postgres
 * local y no imprime URLs ni tokens.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { desplazar } from "../../src/dominio/flujo/fechas";
import { hoyEnMexico } from "../../src/dominio/personas";
import { cerrarConexion } from "../../src/nucleo/db";
import { darDeAltaComoDuena } from "../empresa-por-la-duena";
import { registrarCobro, registrarObligacion } from "../../src/server/flujo/servicio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { asignarRol } from "../../src/server/roles/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import type { ContextoConEmpresa } from "../../src/nucleo/contexto";
import { createHash } from "node:crypto";

const DUENO = process.env.DUENO_URL ?? "";
const CLAVE = process.env.CLAVE ?? "Clave-local-flujo-1";
const CLABE = "002180701150123452";
if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DUENO)) {
  throw new Error("DUENO_URL tiene que apuntar a un Postgres local desechable (127.0.0.1 o localhost).");
}

function sql(consulta: string): string {
  try {
    return execFileSync("psql", [DUENO, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", consulta], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    // Solo el mensaje de Postgres: el error de execFileSync repite el comando, con la URL.
    const stderr = (error as { stderr?: unknown }).stderr;
    throw new Error(typeof stderr === "string" ? stderr.trim() : "psql falló");
  }
}

async function sesionDe(userId: string, empresaId: string): Promise<ContextoConEmpresa> {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entrada = randomUUID();
  sql(`
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entrada}', '${userId}', '${createHash("sha256").update(entrada).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '1 hour', 'totp', '${entrada}');`);
  const sesion = await leerSesion(`sesion=${token}`);
  if (!sesion?.segundoFactor) throw new Error("La sesión de siembra no quedó abierta.");
  return (await resolverContexto({ sesion, empresaPedida: empresaId, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
}

type Personal = Awaited<ReturnType<typeof contextoDePersonal>>;

async function empresaConAdmin(personal: Personal, datos: { rfc: string; razon: string; demostracion: boolean; admin: string; correo: string }) {
  const empresa = await darDeAltaComoDuena(DUENO, personal, {
    rfc: datos.rfc, razonSocial: datos.razon, codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: datos.demostracion });
  const invitado = await invitarAdministrador(personal, { companyId: empresa.id, razonSocial: empresa.razonSocial, nombre: datos.admin, correo: datos.correo });
  await aceptarInvitacion({ token: invitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  return { empresa, adminId: invitado.emitida.userId, ctx: await sesionDe(invitado.emitida.userId, empresa.id) };
}

async function persona(
  admin: ContextoConEmpresa,
  datos: Record<string, unknown> & { nombre: string; correo?: string },
): Promise<string | null> {
  let token = "";
  await darDeAltaPersona(admin, {
    alta: "2026-11-01", baja: "", jefeId: "", presupuesto: "", altaLlave: randomUUID(), clabe: CLABE, ...datos,
  }, {
    entregar: async (emitida) => {
      token = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  if (!token) return null;
  return (await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE })).userId;
}

async function principal(): Promise<void> {
  const hoy = hoyEnMexico(new Date());
  if (Number(sql("select count(*) from companies")) > 0) throw new Error("La base ya tiene empresas: la siembra corre sobre una base recién migrada.");
  sql(`
    insert into users (id, nombre, correo, password_hash)
      values ('99999999-9999-4999-8999-999999999999', 'Personal Lever', 'op@lever.test', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');`);
  const personal = await contextoDePersonal("op@lever.test");

  // Empresa A: cliente real con todo el flujo.
  const a = await empresaConAdmin(personal, { rfc: "ALO180312AB1", razon: "Altamar Logística", demostracion: false, admin: "Laura Méndez", correo: "laura@lever.test" });
  await asignarRol(a.ctx, { userId: a.adminId, rol: "liberador" });
  const operacion = await nombrarCentro(a.ctx, { nombre: "Operación", presupuesto: "90000.00" });
  const ventas = await nombrarCentro(a.ctx, { nombre: "Ventas", presupuesto: "40000.00" });
  const nomina = { frecuencia: "quincenal", primerPago: "2026-11-15", destino: "tarjeta", acceso: "no", correo: "", rol: "", clabe: "" };
  await persona(a.ctx, { ...nomina, nombre: "Ana Torres", centroId: operacion.id, neto: "10000.00" });
  await persona(a.ctx, { ...nomina, nombre: "Beto Ruiz", centroId: operacion.id, neto: "8000.00" });
  await persona(a.ctx, { ...nomina, nombre: "Carla Núñez", centroId: ventas.id, neto: "20000.00", frecuencia: "mensual", primerPago: "2026-11-30" });
  const accesoSinNomina = { nomina: "no", acceso: "nueva" };
  const rosa = await persona(a.ctx, { ...accesoSinNomina, nombre: "Rosa Liberadora", centroId: operacion.id, correo: "rosa@lever.test", rol: ["liberador"] });
  await persona(a.ctx, { ...accesoSinNomina, nombre: "Diego Contador", centroId: operacion.id, correo: "diego@lever.test", rol: ["contador"] });
  // Finanzas ve Inicio y recibe el correo, pero no el detalle de la nómina por persona.
  await persona(a.ctx, { ...accesoSinNomina, nombre: "Fernanda Finanzas", centroId: operacion.id, correo: "fernanda@lever.test", rol: ["tarjetahabiente", "finanzas"] });
  await persona(a.ctx, { ...accesoSinNomina, nombre: "Ernesto Tarjeta", centroId: ventas.id, correo: "ernesto@lever.test", rol: ["tarjetahabiente"] });
  if (!rosa) throw new Error("Rosa no quedó con acceso.");

  // Proveedores, cargos y solicitudes de A. Fechas de la corrida: hoy y las semanas que siguen.
  const lista = randomUUID();
  const proveedores = [
    { id: randomUUID(), rfc: "TNO010101AA1", razon: "Transportes del Norte", area: operacion.id },
    { id: randomUUID(), rfc: "PCR020202BB2", razon: "Publicidad Creativa", area: ventas.id },
    { id: randomUUID(), rfc: "PCE030303CC3", razon: "Papelería Central", area: null as string | null },
  ];
  const finMesPasado = desplazar(`${hoy.slice(0, 7)}-01`, -1);
  const cargos = [
    { id: randomUUID(), proveedor: 0, folio: "TN-501", total: 2_500_000, emitida: desplazar(hoy, -20), vence: desplazar(hoy, 9), programada: desplazar(hoy, 6), estado: "listo_para_pagar" },
    { id: randomUUID(), proveedor: 1, folio: "PC-77", total: 1_500_000, emitida: desplazar(hoy, -10), vence: desplazar(hoy, 14), programada: desplazar(hoy, 12), estado: "por_autorizar" },
    { id: randomUUID(), proveedor: 2, folio: "PA-12", total: 1_200_000, emitida: desplazar(hoy, -36), vence: desplazar(hoy, -6), programada: desplazar(hoy, 4), estado: null },
    { id: randomUUID(), proveedor: 0, folio: "TN-498", total: 4_000_000, emitida: desplazar(hoy, -15), vence: desplazar(hoy, 10), programada: desplazar(hoy, 7), estado: "cancelado" },
    // Del mes pasado (antes de cualquier saldo de esta corrida): tres autorizados, que ya están pagados en el saldo
    // declarado, y uno por autorizar, que sigue vencido. Del mes pasado para no mover los presupuestos del mes.
    { id: randomUUID(), proveedor: 0, folio: "TN-470", total: 6_000_000, emitida: desplazar(finMesPasado, -40), vence: desplazar(finMesPasado, -20), programada: desplazar(finMesPasado, -20), estado: "listo_para_pagar" },
    { id: randomUUID(), proveedor: 0, folio: "TN-475", total: 6_000_000, emitida: desplazar(finMesPasado, -30), vence: desplazar(finMesPasado, -10), programada: desplazar(finMesPasado, -10), estado: "listo_para_pagar" },
    { id: randomUUID(), proveedor: 0, folio: "TN-480", total: 6_000_000, emitida: desplazar(finMesPasado, -20), vence: finMesPasado, programada: finMesPasado, estado: "listo_para_pagar" },
    { id: randomUUID(), proveedor: 1, folio: "PC-70", total: 900_000, emitida: desplazar(finMesPasado, -25), vence: desplazar(finMesPasado, -5), programada: desplazar(finMesPasado, -5), estado: "por_autorizar" },
  ];
  const evento = (accion: string, entidad: string, id: string, actor: string, extra = "") =>
    `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador${extra ? ", cambio" : ""})
       select operator_id, id, 'miembro', '${actor}', 'cliente', '${accion}', '${entidad}', '${id}'${extra ? `, '${extra}'` : ""} from companies where id = '${a.empresa.id}';`;
  const partes: string[] = [
    "begin;",
    `select set_config('app.user_id', '${a.adminId}', false), set_config('app.company_id', '${a.empresa.id}', false);`,
    `insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values ('${lista}', date '${desplazar(hoy, -7)}', now());`,
    // La copia de la lista trae al menos una fila (ninguno de los proveedores sembrados aparece).
    `insert into lista_69b_rows (snapshot_id, rfc, situacion) values ('${lista}', 'PAL7202161U0', 'Presunto');`,
    `insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
       values ((select id from operators order by alta_en limit 1), 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', '${lista}');`,
  ];
  for (const p of proveedores) {
    const documento = randomUUID();
    const clabe = randomUUID();
    partes.push(
      `insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
         values ('${documento}', '${a.empresa.id}', 'siembra/constancia-${p.rfc}', '${createHash("sha256").update(p.rfc).digest("hex")}', 'application/pdf', 'Constancia ${p.razon}.pdf', now());`,
      `insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito)
         values ('${p.id}', '${a.empresa.id}', '${documento}', '${lista}', '${p.rfc}', '${p.razon}', date '${desplazar(hoy, -7)}', now(), true, now(), '${p.razon}', 30);`,
      evento("alta_proveedor", "suppliers", p.id, a.adminId),
      `insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde) values ('${clabe}', '${a.empresa.id}', '${p.id}', '${CLABE}', true, now());`,
      evento("clabe_proveedor", "supplier_clabes", clabe, a.adminId),
    );
    if (p.area) {
      partes.push(`update suppliers set cost_center_id = '${p.area}' where id = '${p.id}';`, evento("asignar_area_proveedor", "suppliers", p.id, a.adminId));
    }
  }
  for (const c of cargos) {
    const p = proveedores[c.proveedor]!;
    partes.push(
      `insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
         values ('${c.id}', '${a.empresa.id}', '${p.id}', 'cfdi', '${randomUUID().toUpperCase()}', '${c.folio.split("-")[0]}', '${c.folio.split("-")[1]}', '${c.folio}', ${c.total},
                 date '${c.emitida}', date '${c.vence}', date '${c.programada}', '${a.adminId}', now(), now());`,
      evento("crear_cargo_proveedor", "supplier_payables", c.id, a.adminId, JSON.stringify({ origen: "cfdi", total_centavos: c.total })),
    );
    if (!c.estado) continue;
    const solicitud = randomUUID();
    partes.push(
      `select set_config('app.user_id', '${a.adminId}', false);`,
      `insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, solicitado_por, solicitado_en, creado_en)
         select '${solicitud}', p.company_id, p.id, sc.id, sc.clabe, p.total_centavos, p.programada_el, '${a.adminId}', now(), now()
           from supplier_payables p join supplier_clabes sc on sc.company_id = p.company_id and sc.supplier_id = p.supplier_id and sc.vigente_hasta is null
          where p.id = '${c.id}';`,
      evento("solicitar_pago_proveedor", "supplier_payment_requests", solicitud, a.adminId, JSON.stringify({ total_centavos: c.total })),
    );
    if (c.estado === "listo_para_pagar") {
      partes.push(
        `select set_config('app.user_id', '${rosa}', false);`,
        `update supplier_payment_requests set estado = 'listo_para_pagar', resuelto_por = '${rosa}', resuelto_en = now() where id = '${solicitud}';`,
        evento("autorizar_pago_proveedor", "supplier_payment_requests", solicitud, rosa),
        `select set_config('app.user_id', '${a.adminId}', false);`,
      );
    }
    if (c.estado === "cancelado") {
      partes.push(
        `update supplier_payment_requests set estado = 'cancelado', resuelto_por = '${a.adminId}', resuelto_en = now(), motivo_resolucion = 'El servicio ya no se prestó' where id = '${solicitud}';`,
        `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, motivo)
           select operator_id, id, 'miembro', '${a.adminId}', 'cliente', 'cancelar_pago_proveedor', 'supplier_payment_requests', '${solicitud}', 'El servicio ya no se prestó' from companies where id = '${a.empresa.id}';`,
      );
    }
  }
  partes.push("commit;");
  sql(partes.join("\n"));

  // Dos cobros (uno ya vencido) y la renta, por los servicios.
  await registrarCobro(a.ctx, { clienteNombre: "Cliente Mayorista", clienteRfc: "", concepto: "Fletes de octubre", monto: "60000.00", fechaProbable: desplazar(hoy, 19), referencia: "F-1032", altaId: randomUUID() });
  await registrarCobro(a.ctx, { clienteNombre: "Distribuidora Sur", clienteRfc: "", concepto: "Saldo pendiente", monto: "18000.00", fechaProbable: desplazar(hoy, -3), referencia: "", altaId: randomUUID() });
  await registrarObligacion(a.ctx, { concepto: "Renta de la bodega", monto: "30000.00", frecuencia: "mensual", proximaFecha: desplazar(hoy, 14), areaId: operacion.id, altaId: randomUUID() });

  // Empresa B: cliente real sin datos (estado vacío, otra empresa y su propio correo).
  await empresaConAdmin(personal, { rfc: "BCO190101CD2", razon: "Bahía Comercial", demostracion: false, admin: "Bruno Salas", correo: "bruno@lever.test" });
  // Empresa C: demostración, para ver el libro marcado como demostración.
  const c = await empresaConAdmin(personal, { rfc: "DEM200101EF3", razon: "Demostración Lever", demostracion: true, admin: "Diana Demo", correo: "diana@lever.test" });
  // Asientos de demostración (como scripts/evidencia/inicio-pendientes-asientos.sql): sin ellos no hay libro que pintar.
  sql(`with d as (select codigo, id from drawers where company_id = '${c.empresa.id}')
    insert into postings (company_id, drawer_id, centavos, motivo, ocurrido_en)
    select '${c.empresa.id}', d.id, v.centavos, v.motivo, (v.dia || ' 12:00-06')::timestamptz
    from (values
      ('proveedores', 21500000, 'Cobro de servicios', '${desplazar(hoy, -40)}'),
      ('nomina', -6100000, 'Nómina', '${desplazar(hoy, -21)}'),
      ('proveedores', -4250000, 'Insumos', '${desplazar(hoy, -3)}'),
      ('proveedores', 18000000, 'Cobro de servicios', '${desplazar(hoy, -2)}')
    ) as v(codigo, centavos, motivo, dia)
    join d on d.codigo = v.codigo`);

  console.log(JSON.stringify({
    hoy,
    empresas: { altamar: a.empresa.id },
    areas: { operacion: operacion.id, ventas: ventas.id },
    cargos: Object.fromEntries(cargos.map((c) => [c.folio, { id: c.id, programada: c.programada, total: c.total, estado: c.estado ?? "sin_solicitud" }])),
  }, null, 2));
}

principal()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "La siembra falló.");
    process.exitCode = 1;
  })
  .finally(() => cerrarConexion());
