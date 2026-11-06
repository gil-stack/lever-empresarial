import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { cerrarConexion, comoTarea, conContexto } from "../../src/nucleo/db.ts";
import { baseCliente, type ContextoConEmpresa } from "../../src/nucleo/contexto.ts";
import { ErrorDeDominio } from "../../src/nucleo/error-de-dominio.ts";
import { darDeAltaEmpresa } from "../../src/server/company/servicio.ts";
import { ErrorDeCorreo } from "../../src/server/correo/errores.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { enviarCorreosSemanales } from "../../src/server/flujo/correo-semanal.ts";
import {
  asignarAreaProveedor,
  cambiarCorreoSemanal,
  configurarColchon,
  declararSaldo,
  leerFlujoInicio,
  leerVistaPresupuestos,
  leerVistaSaldo,
  marcarCobrado,
  registrarCobro,
  registrarObligacion,
} from "../../src/server/flujo/servicio.ts";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio.ts";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio.ts";
import { invitarAdministrador, contextoDePersonal } from "../../src/server/plataforma/servicio.ts";
import { leerSesion } from "../../src/server/session/servicio.ts";
import type { Sesion } from "../../src/server/session/tipos.ts";
import { resolverContexto } from "../../src/server/tenencia/resolver.ts";
import { aplicarArchivo, conBaseDesechable, consultarJson, ejecutar, exigirBaseDesechable, urlDeAplicacion } from "../aislamiento/postgres.ts";

const urlAdmin = process.env.AISLAMIENTO_DATABASE_URL?.trim() ?? "";
const CLABE = "002180701150123452";
const CLAVE = "clave-segura-12";
/** Reloj fijo: viernes 6 de noviembre de 2026 en México. Nada depende del día en que corre la prueba. */
const VIERNES = new Date("2026-11-06T18:00:00.000Z");
const AHORA = { ahora: () => VIERNES };
const TABLAS = [
  "cash_balance_declarations",
  "expected_collections",
  "recurring_obligations",
  "cash_flow_settings",
  "weekly_digest_preferences",
  "weekly_digest_sends",
] as const;

describe("Flujo de caja en Postgres", { skip: urlAdmin.length === 0 }, () => {
  it("separa empresas, exige permiso de edición, no reescribe pagos y manda un correo por empresa y semana", async () => {
    exigirBaseDesechable();
    await conBaseDesechable(urlAdmin, async (url) => {
      const dir = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");
      for (const archivo of readdirSync(dir).sort()) {
        if (archivo.endsWith(".sql")) aplicarArchivo(url, join(dir, archivo));
      }
      // La sesión de la aplicación en UTC, como Neon y el contenedor de CI.
      ejecutar(url, `do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'UTC'); end $$;`);
      await cerrarConexion();
      const previo = process.env.DATABASE_URL;
      process.env.DATABASE_URL = urlDeAplicacion(url);
      try {
        await escenario(url);
      } finally {
        await cerrarConexion();
        if (previo === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previo;
      }
    });
  });
});

async function escenario(url: string): Promise<void> {
  sembrarPersonal(url);
  const personal = await contextoDePersonal("personal-flujo@ejemplo.mx");
  // Alfa es un cliente real; Beta, una empresa de demostración.
  const alfa = await darDeAltaEmpresa(personal, {
    rfc: "TCM010101AB1",
    razonSocial: "Escuela Alfa Flujo",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: false });
  const beta = await darDeAltaEmpresa(personal, {
    rfc: "CABL840215RF4",
    razonSocial: "Taller Beta Flujo",
    codigoPostal: "44100",
    regimen: "612",
    usoCfdi: "G03",
  }, { demostracion: true });

  const admin = await administrador(url, personal, alfa, "admin-alfa-flujo@ejemplo.mx");
  const adminBeta = await administrador(url, personal, beta, "admin-beta-flujo@ejemplo.mx");
  assert.equal(admin.empresa.demostracion, false);
  assert.equal(adminBeta.empresa.demostracion, true);

  const operacion = await nombrarCentro(admin, { nombre: "Operación", presupuesto: "50000.00" }, AHORA);
  const contador = await persona(url, admin, operacion.id, "Contadora Flujo", "contadora-flujo@ejemplo.mx", ["contador"]);
  const finanzas = await persona(url, admin, operacion.id, "Finanzas Flujo", "finanzas-flujo@ejemplo.mx", ["tarjetahabiente", "finanzas"]);
  await darDeAltaPersona(admin, {
    nombre: "Operativo Quincenal",
    alta: "2026-11-01",
    baja: "",
    centroId: operacion.id,
    jefeId: "",
    presupuesto: "",
    altaLlave: randomUUID(),
    neto: "8000.00",
    frecuencia: "quincenal",
    primerPago: "2026-11-15",
    destino: "tarjeta",
    clabe: "",
    acceso: "no",
    correo: "",
    rol: "",
  }, AHORA);

  // Alfa declara saldo, colchón, un cobro y la renta. Beta, lo suyo.
  await declararSaldo(admin, { saldo: "100000.00", alDia: "2026-11-05" }, AHORA);
  await configurarColchon(admin, { colchon: "20000.00" }, AHORA);
  const cobro = await registrarCobro(admin, {
    clienteNombre: "Cliente Alfa",
    clienteRfc: "",
    concepto: "Colegiaturas de noviembre",
    monto: "25000.00",
    fechaProbable: "2026-11-20",
    referencia: "",
  }, AHORA);
  const renta = await registrarObligacion(admin, {
    concepto: "Renta del local",
    monto: "30000.00",
    frecuencia: "mensual",
    proximaFecha: "2026-11-15",
    areaId: operacion.id,
  }, AHORA);
  await declararSaldo(adminBeta, { saldo: "777777.00", alDia: "2026-11-05" }, AHORA);
  await configurarColchon(adminBeta, { colchon: "1.00" }, AHORA);
  await registrarCobro(adminBeta, {
    clienteNombre: "Cliente Secreto Beta",
    clienteRfc: "",
    concepto: "Secreto Beta",
    monto: "99999.00",
    fechaProbable: "2026-11-18",
    referencia: "",
  }, AHORA);
  await registrarObligacion(adminBeta, { concepto: "Obligación Secreta Beta", monto: "1.00", frecuencia: "mensual", proximaFecha: "2026-11-17", areaId: "" }, AHORA);
  await cambiarCorreoSemanal(adminBeta, { activo: "si" }, AHORA);

  const pago = sembrarPago(url, alfa.id, admin.persona.id, operacion.id);

  // Inicio de Alfa: su saldo, su cobro, su renta, su pago y la nómina sumada por fecha. Nada de Beta.
  const flujo = await leerFlujoInicio(admin, {}, AHORA);
  assert.equal(flujo.proyeccion.saldo?.centavos, 10_000_000);
  assert.equal(flujo.proyeccion.colchonCentavos, 2_000_000);
  assert.equal(flujo.puedeEditar, true);
  const texto = JSON.stringify(flujo);
  for (const ajeno of ["Secreto Beta", "77777700", "9999900", "Obligación Secreta Beta"]) assert.equal(texto.includes(ajeno), false, ajeno);
  const movimientos = flujo.proyeccion.semanas.flatMap((semana) => semana.movimientos);
  assert.ok(movimientos.some((m) => m.clave === `cxp:${pago.id}` && m.fecha === "2026-11-12" && m.centavos === 4_000_000));
  assert.ok(movimientos.some((m) => m.tipo === "cobro" && m.centavos === 2_500_000 && m.fecha === "2026-11-20"));
  assert.ok(movimientos.some((m) => m.tipo === "obligacion" && m.fecha === "2026-11-15" && m.centavos === 3_000_000));
  assert.ok(movimientos.some((m) => m.tipo === "nomina" && m.fecha === "2026-11-15" && m.centavos === 800_000));
  assert.equal(cobro.id.length, 36);

  // «¿Y si muevo este pago?» recalcula sin escribir: ni programada_el ni la bitácora cambian.
  const bitacoraAntes = contar(url, "select count(*) from audit_log");
  const escenario = await leerFlujoInicio(admin, { mover: `cxp:${pago.id}`, fecha: "2026-12-10" }, AHORA);
  assert.notEqual(escenario.real, null);
  assert.ok(escenario.proyeccion.semanas.flatMap((s) => s.movimientos).some((m) => m.clave === `cxp:${pago.id}` && m.fecha === "2026-12-10"));
  assert.equal(
    consultarJson<{ f: string }[]>(url, `select json_agg(json_build_object('f', to_char(programada_el, 'YYYY-MM-DD'))) from supplier_payables where id = '${pago.id}'`)[0]?.f,
    "2026-11-12",
  );
  assert.equal(contar(url, "select count(*) from audit_log"), bitacoraAntes);
  // Una fecha en el pasado o una clave ajena no arman escenario.
  assert.equal((await leerFlujoInicio(admin, { mover: `cxp:${pago.id}`, fecha: "2026-11-01" }, AHORA)).real, null);
  assert.equal((await leerFlujoInicio(admin, { mover: `cxp:${randomUUID()}`, fecha: "2026-12-10" }, AHORA)).real, null);

  // El contador ve y no edita: el servidor lo rechaza y la base también, aunque llegue el SQL directo.
  const vistaContador = await leerFlujoInicio(contador, {}, AHORA);
  assert.equal(vistaContador.puedeEditar, false);
  assert.equal(vistaContador.proyeccion.saldo?.centavos, 10_000_000);
  await assert.rejects(() => declararSaldo(contador, { saldo: "1.00", alDia: "2026-11-05" }, AHORA), codigo("sin_permiso"));
  await assert.rejects(() => registrarCobro(contador, { clienteNombre: "X", concepto: "X", monto: "1.00", fechaProbable: "2026-11-20" }, AHORA), codigo("sin_permiso"));
  await assert.rejects(() => marcarCobrado(contador, { id: cobro.id, cobradoEl: "2026-11-05" }, AHORA), codigo("sin_permiso"));
  await assert.rejects(
    () => conContexto(baseCliente(contador), (consulta) => consulta.query(
      "insert into cash_balance_declarations (id, company_id, saldo_centavos, al_dia, declarado_por) values ($1, $2, 1, '2026-11-05', $3)",
      [randomUUID(), alfa.id, contador.persona.id],
    )),
    codigo("sin_permiso"),
  );
  await assert.rejects(
    () => conContexto(baseCliente(contador), (consulta) => consulta.query(
      "update recurring_obligations set monto_centavos = 1 where id = $1", [renta.id],
    )),
    codigo("sin_permiso"),
  );
  // Finanzas sí edita.
  await configurarColchon(finanzas, { colchon: "15000.00" }, AHORA);

  // RLS: desde Alfa, ninguna de las seis tablas deja ver ni escribir filas de Beta.
  for (const tabla of TABLAS) {
    const visibles = await conContexto(baseCliente(admin), async (consulta) =>
      (await consulta.query(`select count(*)::int as n from ${tabla} where company_id = $1`, [beta.id])).rows[0] as { n: number });
    assert.equal(visibles.n, 0, tabla);
  }
  assert.ok(contar(url, `select count(*) from expected_collections where company_id = '${beta.id}'`) > 0);
  await assert.rejects(
    () => conContexto(baseCliente(admin), (consulta) => consulta.query(
      `insert into expected_collections (id, company_id, origen, cliente_nombre, concepto, monto_centavos, fecha_probable, creado_por)
       values ($1, $2, 'manual', 'Intruso', 'Intruso', 100, '2026-11-20', $3)`,
      [randomUUID(), beta.id, admin.persona.id],
    )),
  );
  const areaBeta = await areaDe(adminBeta);
  await assert.rejects(() => asignarAreaProveedor(admin, { proveedorId: pago.proveedorId, areaId: areaBeta }, AHORA), codigo("area_ajena"));

  // El saldo declarado no se pisa: otra declaración se agrega y la proyección parte de la última.
  await assert.rejects(
    () => conContexto(baseCliente(admin), (consulta) => consulta.query("update cash_balance_declarations set saldo_centavos = 1 where company_id = $1", [alfa.id])),
    codigo("sin_permiso"),
  );
  assert.throws(() => ejecutar(url, `delete from cash_balance_declarations where company_id = '${alfa.id}'`), /saldo_declarado_no_se_pisa/);
  await declararSaldo(admin, { saldo: "90000.00", alDia: "2026-11-06" }, AHORA);
  const historial = await leerVistaSaldo(admin, AHORA);
  assert.deepEqual(historial.historial.map((d) => d.centavos), [9_000_000, 10_000_000]);
  assert.equal((await leerFlujoInicio(admin, {}, AHORA)).proyeccion.saldo?.centavos, 9_000_000);

  // Una escritura sin su evento de bitácora no queda.
  assert.throws(
    () => ejecutar(url, `
      select set_config('app.user_id', '${admin.persona.id}', true), set_config('app.company_id', '${alfa.id}', true);
      insert into cash_balance_declarations (id, company_id, saldo_centavos, al_dia, declarado_por)
        values ('${randomUUID()}', '${alfa.id}', 1, '2026-11-05', '${admin.persona.id}');
    `),
    /auditoria_de_flujo_ausente/,
  );

  // Presupuestos: el área suma nómina prorrateada + el pago de su proveedor + la renta.
  const presupuestos = await leerVistaPresupuestos(admin, AHORA);
  const area = presupuestos.presupuestos.areas.find((linea) => linea.id === operacion.id);
  assert.ok(area);
  assert.equal(area.gastoCentavos, 1_600_000 + 4_000_000 + 3_000_000);
  assert.equal(area.estado, "excedido");

  // Correo semanal ----------------------------------------------------------------
  // La puerta sin empresa es solo de plataforma_tarea. Que falte el contexto no da más acceso.
  assert.deepEqual(
    consultarJson<Record<string, boolean>[]>(url, `select json_agg(json_build_object(
      'cliente', has_function_privilege('plataforma_cliente', 'empresas_con_correo_semanal()', 'execute'),
      'sofipo', has_function_privilege('plataforma_sofipo', 'empresas_con_correo_semanal()', 'execute'),
      'app', has_function_privilege('plataforma_app', 'empresas_con_correo_semanal()', 'execute'),
      'tarea', has_function_privilege('plataforma_tarea', 'empresas_con_correo_semanal()', 'execute')))`),
    [{ cliente: false, sofipo: false, app: false, tarea: true }],
  );
  const duena = new pg.Client({ connectionString: url });
  await duena.connect();
  try {
    for (const rol of ["plataforma_cliente", "plataforma_sofipo"]) {
      await duena.query("begin");
      await duena.query(`set local role ${rol}`);
      await assert.rejects(duena.query("select * from empresas_con_correo_semanal()"), (error: unknown) => (error as { code?: string }).code === "42501", rol);
      await duena.query("rollback");
    }
  } finally {
    await duena.end();
  }
  // Por la conexión de la aplicación: sin contexto (como en entrar o recuperar) y dentro de una sesión.
  await assert.rejects(() => conContexto({ rol: "plataforma_cliente" }, (consulta) => consulta.query("select * from empresas_con_correo_semanal()")), codigo("sin_permiso"));
  await assert.rejects(() => conContexto(baseCliente(admin), (consulta) => consulta.query("select * from empresas_con_correo_semanal()")), codigo("sin_permiso"));
  // plataforma_tarea solo ejecuta esa función: no lee tablas.
  await assert.rejects(() => comoTarea((consulta) => consulta.query("select id from companies")), codigo("sin_permiso"));

  // La tarea ve solo empresas activas con al menos un destinatario vigente.
  const empresasDeTarea = async () =>
    (await comoTarea((consulta) => consulta.query("select empresa from empresas_con_correo_semanal() as empresa"))).rows.map((fila) => String(fila.empresa)).sort();
  const gamma = await darDeAltaEmpresa(personal, { rfc: "GAM010101AB2", razonSocial: "Gamma Suspendida", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false });
  await administrador(url, personal, gamma, "admin-gamma-flujo@ejemplo.mx");
  const delta = await darDeAltaEmpresa(personal, { rfc: "DEL010101AB3", razonSocial: "Delta Baja", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false });
  const adminDelta = await administrador(url, personal, delta, "admin-delta-flujo@ejemplo.mx");
  const areaDelta = await nombrarCentro(adminDelta, { nombre: "General", presupuesto: "" }, AHORA);
  await persona(url, adminDelta, areaDelta.id, "Finanzas Delta", "finanzas-delta@ejemplo.mx", ["tarjetahabiente", "finanzas"]);
  // En Delta solo queda Finanzas como destinataria.
  await cambiarCorreoSemanal(adminDelta, { activo: "no" }, AHORA);
  assert.deepEqual(await empresasDeTarea(), [alfa.id, beta.id, gamma.id, delta.id].sort());
  // Gamma se suspende y la persona de Finanzas de Delta queda dada de baja (sin pasar por los
  // triggers, para probar solo el filtro de la función).
  ejecutar(url, `
    set session_replication_role = replica;
    update companies set estado = 'suspendida' where id = '${gamma.id}';
    update employees set baja_en = alta_en where company_id = '${delta.id}' and nombre = 'Finanzas Delta';
  `);
  assert.deepEqual(await empresasDeTarea(), [alfa.id, beta.id].sort());
  // Una persona no escribe el registro de envíos.
  await assert.rejects(() => conContexto(baseCliente(admin), (consulta) => consulta.query(
    "insert into weekly_digest_sends (id, company_id, semana, estado) values ($1, $2, '2026-11-02', 'enviando')", [randomUUID(), alfa.id],
  )));

  // Finanzas lo apaga; la contadora lo enciende (por omisión no lo recibe).
  await cambiarCorreoSemanal(finanzas, { activo: "no" }, AHORA);
  await cambiarCorreoSemanal(contador, { activo: "si" }, AHORA);

  const enviados: MensajeCorreo[] = [];
  const enviador = async (mensaje: MensajeCorreo) => {
    enviados.push(mensaje);
    return { id: `re_${enviados.length}` };
  };
  const registros: Record<string, string | number>[] = [];
  const deps = { ahora: () => VIERNES, enviador, urlPublica: "https://lever.test", registrar: (c: Readonly<Record<string, string | number>>) => void registros.push({ ...c }) };
  const primera = await enviarCorreosSemanales(deps);
  assert.deepEqual(primera, { semana: "2026-11-02", empresas: 2, enviados: 2, omitidos: 0, fallidos: 0 });
  const correosAlfa = enviados.filter((m) => m.idempotencia.includes(alfa.id));
  const correosBeta = enviados.filter((m) => m.idempotencia.includes(beta.id));
  assert.deepEqual(correosAlfa.map((m) => m.para).sort(), ["admin-alfa-flujo@ejemplo.mx", "contadora-flujo@ejemplo.mx"]);
  assert.deepEqual(correosBeta.map((m) => m.para), ["admin-beta-flujo@ejemplo.mx"]);
  for (const m of correosAlfa) {
    assert.match(m.texto, /\$90,000\.00 al 6 de noviembre de 2026/);
    assert.match(m.html, /https:\/\/lever\.test\/c\/[0-9a-f-]+\/consola/);
    for (const ajeno of ["Secreto Beta", "777,777", "Taller Beta"]) assert.equal(m.html.includes(ajeno) || m.texto.includes(ajeno), false, ajeno);
    assert.equal(m.texto.includes("Confirmado por el banco"), false);
  }
  for (const m of correosBeta) {
    for (const ajeno of ["Escuela Alfa", "Renta del local", "Colegiaturas", "90,000"]) assert.equal(m.html.includes(ajeno) || m.texto.includes(ajeno), false, ajeno);
  }
  assert.equal(new Set(enviados.map((m) => m.idempotencia)).size, enviados.length);

  // Vercel puede llamar dos veces: la segunda no manda nada.
  const repetida = await enviarCorreosSemanales(deps);
  assert.deepEqual(repetida, { semana: "2026-11-02", empresas: 2, enviados: 0, omitidos: 2, fallidos: 0 });
  assert.equal(enviados.length, 3);
  assert.equal(contar(url, "select count(*) from weekly_digest_sends where estado = 'enviado'"), 2);
  assert.equal(contar(url, "select count(*) from audit_log where accion = 'correo_semanal' and actor_tipo = 'sistema' and actor_id is null"), 2);

  // El lunes siguiente falla el proveedor para Beta: Alfa sale igual y Beta queda registrada como fallida.
  const lunes = new Date("2026-11-09T14:00:00.000Z");
  const fallaBeta = async (mensaje: MensajeCorreo) => {
    if (mensaje.para.startsWith("admin-beta")) throw new ErrorDeCorreo("correo_limite");
    return enviador(mensaje);
  };
  const conFalla = await enviarCorreosSemanales({ ...deps, ahora: () => lunes, enviador: fallaBeta });
  assert.deepEqual(conFalla, { semana: "2026-11-09", empresas: 2, enviados: 1, omitidos: 0, fallidos: 1 });
  assert.deepEqual(
    consultarJson<{ e: string; c: string | null }[]>(url, `select json_agg(json_build_object('e', estado, 'c', codigo)) from weekly_digest_sends where company_id = '${beta.id}' and semana = '2026-11-09'`),
    [{ e: "fallido", c: "correo_limite" }],
  );
  assert.ok(registros.some((r) => r.evento === "correo_semanal_fallido" && r.empresa === beta.id && r.codigo === "correo_limite"));
  assert.equal(JSON.stringify(registros).includes("@"), false, "el registro no lleva correos");
  // Un reintento vuelve a abrir solo la fallida.
  const reintento = await enviarCorreosSemanales({ ...deps, ahora: () => lunes });
  assert.deepEqual(reintento, { semana: "2026-11-09", empresas: 2, enviados: 1, omitidos: 1, fallidos: 0 });

  // Un apartado «enviando» reciente es otra corrida en curso; uno viejo, una corrida que se cayó.
  ejecutar(url, `
    insert into weekly_digest_sends (id, company_id, semana, estado, intentado_en)
      values ('${randomUUID()}', '${alfa.id}', '2026-11-16', 'enviando', clock_timestamp() - interval '2 hours'),
             ('${randomUUID()}', '${beta.id}', '2026-11-16', 'enviando', clock_timestamp());
  `);
  const tercera = await enviarCorreosSemanales({ ...deps, ahora: () => new Date("2026-11-16T14:00:00.000Z") });
  assert.deepEqual(tercera, { semana: "2026-11-16", empresas: 2, enviados: 1, omitidos: 1, fallidos: 0 });
  assert.deepEqual(
    consultarJson<{ c: string | null }[]>(url, `select json_agg(json_build_object('c', a.cambio->>'codigo') order by a.ocurrido_en) from audit_log a join weekly_digest_sends w on w.id = a.identificador where w.company_id = '${alfa.id}' and w.semana = '2026-11-16'`),
    [{ c: "interrumpido" }, { c: null }],
  );

  // Sin destinatarios activos la empresa ni aparece.
  await cambiarCorreoSemanal(adminBeta, { activo: "no" }, AHORA);
  const sinBeta = await enviarCorreosSemanales({ ...deps, ahora: () => new Date("2026-11-23T14:00:00.000Z") });
  assert.equal(sinBeta.empresas, 1);
}

async function administrador(url: string, personal: Awaited<ReturnType<typeof contextoDePersonal>>, empresa: { id: string; razonSocial: string }, correo: string): Promise<ContextoConEmpresa> {
  const invitado = await invitarAdministrador(personal, { companyId: empresa.id, razonSocial: empresa.razonSocial, nombre: `Admin ${empresa.razonSocial}`, correo });
  await aceptarInvitacion({ token: invitado.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesion = await sesionPara(url, invitado.emitida.userId);
  return (await resolverContexto({ sesion, empresaPedida: empresa.id, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
}

async function persona(url: string, admin: ContextoConEmpresa, centroId: string, nombre: string, correo: string, rol: string[]): Promise<ContextoConEmpresa> {
  let token = "";
  await darDeAltaPersona(admin, {
    nombre, alta: "2026-11-01", baja: "", centroId, jefeId: "", presupuesto: "", altaLlave: randomUUID(),
    nomina: "no", clabe: CLABE, acceso: "nueva", correo, rol,
  }, {
    ...AHORA,
    entregar: async (emitida) => {
      token = emitida.token;
      return { entregada: false, codigo: "correo_no_configurado" };
    },
  });
  const aceptada = await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE });
  const sesion = await sesionPara(url, aceptada.userId);
  return (await resolverContexto({ sesion, empresaPedida: admin.empresa.id, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
}

async function areaDe(ctx: ContextoConEmpresa): Promise<string> {
  return (await nombrarCentro(ctx, { nombre: "Área Beta" }, AHORA)).id;
}

/** Un proveedor con área y una cuenta por pagar sin solicitud, con sus eventos en la misma transacción. */
function sembrarPago(url: string, empresaId: string, userId: string, areaId: string): { id: string; proveedorId: string } {
  const documento = randomUUID();
  const proveedorId = randomUUID();
  const clabeId = randomUUID();
  const id = randomUUID();
  ejecutar(url, `
    select set_config('app.user_id', '${userId}', true), set_config('app.company_id', '${empresaId}', true);
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      values ('${documento}', '${empresaId}', 'prueba/constancia', '${"a".repeat(64)}', 'application/pdf', 'Constancia.pdf', now());
    insert into suppliers (id, company_id, document_id, rfc, razon_social, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito)
      values ('${proveedorId}', '${empresaId}', '${documento}', 'AAA010101AAA', 'Proveedor Uno, S.A. de C.V.', now(), false, now(), 'Proveedor Uno', 30);
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, id, 'miembro', '${userId}', 'cliente', 'alta_proveedor', 'suppliers', '${proveedorId}' from companies where id = '${empresaId}';
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
      values ('${clabeId}', '${empresaId}', '${proveedorId}', '${CLABE}', true, now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, id, 'miembro', '${userId}', 'cliente', 'clabe_proveedor', 'supplier_clabes', '${clabeId}' from companies where id = '${empresaId}';
    update suppliers set cost_center_id = '${areaId}' where id = '${proveedorId}';
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, id, 'miembro', '${userId}', 'cliente', 'asignar_area_proveedor', 'suppliers', '${proveedorId}' from companies where id = '${empresaId}';
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      values ('${id}', '${empresaId}', '${proveedorId}', 'cfdi', '123E4567-E89B-42D3-A456-426614174001', 'A', '81', 'A-81', 4000000, '2026-11-01', '2026-11-15', '2026-11-12', '${userId}', now(), now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, id, 'miembro', '${userId}', 'cliente', 'crear_cargo_proveedor', 'supplier_payables', '${id}', '{"origen":"cfdi","total_centavos":4000000}' from companies where id = '${empresaId}';
  `);
  return { id, proveedorId };
}

function contar(url: string, sql: string): number {
  const fila = consultarJson<{ n: number }[]>(url, `select json_agg(json_build_object('n', (${sql}))) from (select 1) x`);
  return fila[0]?.n ?? -1;
}

function codigo(esperado: string) {
  return (error: unknown) => error instanceof ErrorDeDominio && error.codigo === esperado;
}

async function sesionPara(url: string, userId: string): Promise<Sesion> {
  const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
  const entradaId = randomUUID();
  const sesionId = randomUUID();
  const hashEntrada = createHash("sha256").update(entradaId).digest("hex");
  const hashSesion = createHash("sha256").update(token).digest("hex");
  ejecutar(url, `
    insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
      values ('${entradaId}', '${userId}', '${hashEntrada}', now(), now() + interval '10 minutes', 'totp', now(), now());
    insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
      values ('${sesionId}', '${userId}', '${hashSesion}', now() + interval '12 hours', 'totp', '${entradaId}');
  `);
  const sesion = await leerSesion(`sesion=${token}`);
  if (!sesion?.segundoFactor) throw new Error("La sesión de prueba no quedó abierta.");
  return sesion;
}

function sembrarPersonal(url: string): void {
  ejecutar(url, `
    insert into users (id, nombre, correo, password_hash)
      values ('99999999-9999-4999-8999-999999999999', 'Personal', 'personal-flujo@ejemplo.mx', '$2b$12$${"a".repeat(53)}');
    insert into platform_staff (operator_id, user_id, estado)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'activo');
    insert into platform_staff_roles (operator_id, user_id, rol)
      values ((select id from operators order by alta_en limit 1), '99999999-9999-4999-8999-999999999999', 'administracion_plataforma');
  `);
}
