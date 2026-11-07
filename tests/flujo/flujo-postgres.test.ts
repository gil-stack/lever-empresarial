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
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena.ts";
import { ErrorDeCorreo } from "../../src/server/correo/errores.ts";
import { enviadorResend } from "../../src/server/correo/resend.ts";
import type { MensajeCorreo } from "../../src/server/correo/tipos.ts";
import { enviarCorreosSemanales } from "../../src/server/flujo/correo-semanal.ts";
import {
  asignarAreaProveedor,
  cambiarCorreoSemanal,
  cancelarCobro,
  configurarColchon,
  declararSaldo,
  editarObligacion,
  leerAlertasPresupuesto,
  leerFlujoInicio,
  leerVistaCalendario,
  leerVistaPresupuestos,
  leerVistaSaldo,
  marcarCobrado,
  registrarCobro,
  registrarCobroCfdi,
  registrarObligacion,
} from "../../src/server/flujo/servicio.ts";
import { leerPendientesInicio } from "../../src/server/inicio/servicio.ts";
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
  "weekly_digest_deliveries",
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
  // Alfa y Beta son clientes reales (la tarea del correo solo escribe a empresas reales).
  const alfa = await darDeAltaComoDuena(url, personal, {
    rfc: "TCM010101AB1",
    razonSocial: "Escuela Alfa Flujo",
    codigoPostal: "06600",
    regimen: "601",
    usoCfdi: "G03",
  }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const beta = await darDeAltaComoDuena(url, personal, {
    rfc: "CABL840215RF4",
    razonSocial: "Taller Beta Flujo",
    codigoPostal: "44100",
    regimen: "612",
    usoCfdi: "G03",
  }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });

  const admin = await administrador(url, personal, alfa, "admin-alfa-flujo@ejemplo.mx");
  const adminBeta = await administrador(url, personal, beta, "admin-beta-flujo@ejemplo.mx");
  assert.equal(admin.empresa.demostracion, false);
  assert.equal(adminBeta.empresa.demostracion, false);

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
  // Cada alta llega dos veces a la vez y una tercera después (doble clic, reintento de red): una sola fila y un solo evento.
  const dosVecesYOtra = async <T>(fn: () => Promise<T>): Promise<T[]> => [...(await Promise.all([fn(), fn()])), await fn()];
  const altaSaldo = randomUUID();
  const saldos = await dosVecesYOtra(() => declararSaldo(admin, { saldo: "100000.00", alDia: "2026-11-05", altaId: altaSaldo }, AHORA));
  assert.deepEqual(saldos.map((s) => s.id), [altaSaldo, altaSaldo, altaSaldo]);
  await configurarColchon(admin, { colchon: "20000.00" }, AHORA);
  const altaCobro = randomUUID();
  const [cobro] = await dosVecesYOtra(() => registrarCobro(admin, {
    clienteNombre: "Cliente Alfa",
    clienteRfc: "",
    concepto: "Colegiaturas de noviembre",
    monto: "25000.00",
    fechaProbable: "2026-11-20",
    referencia: "",
    altaId: altaCobro,
  }, AHORA));
  const altaRenta = randomUUID();
  const [renta] = await dosVecesYOtra(() => registrarObligacion(admin, {
    concepto: "Renta del local",
    monto: "30000.00",
    frecuencia: "mensual",
    proximaFecha: "2026-11-15",
    areaId: operacion.id,
    altaId: altaRenta,
  }, AHORA));
  assert.ok(cobro && renta);
  // N4: el mismo id con otros datos no es el mismo envío: se rechaza sin tocar la fila ni la bitácora.
  const yaEnviado = codigo("formulario_ya_enviado");
  await assert.rejects(() => declararSaldo(admin, { saldo: "100001.00", alDia: "2026-11-05", altaId: altaSaldo }, AHORA), yaEnviado);
  await assert.rejects(() => declararSaldo(admin, { saldo: "100000.00", alDia: "2026-11-04", altaId: altaSaldo }, AHORA), yaEnviado);
  // Los mismos datos con el id de otra persona tampoco: quien declara es parte de la alta.
  await assert.rejects(() => declararSaldo(finanzas, { saldo: "100000.00", alDia: "2026-11-05", altaId: altaSaldo }, AHORA), yaEnviado);
  const datosCobro = { clienteNombre: "Cliente Alfa", clienteRfc: "", concepto: "Colegiaturas de noviembre", monto: "25000.00", fechaProbable: "2026-11-20", referencia: "", altaId: altaCobro };
  await assert.rejects(() => registrarCobro(admin, { ...datosCobro, monto: "25000.01" }, AHORA), yaEnviado);
  await assert.rejects(() => registrarCobro(admin, { ...datosCobro, referencia: "OC-1" }, AHORA), yaEnviado);
  const datosRenta = { concepto: "Renta del local", monto: "30000.00", frecuencia: "mensual", proximaFecha: "2026-11-15", areaId: operacion.id, altaId: altaRenta };
  await assert.rejects(() => registrarObligacion(admin, { ...datosRenta, concepto: "Renta de la bodega" }, AHORA), yaEnviado);
  await assert.rejects(() => registrarObligacion(admin, { ...datosRenta, areaId: "" }, AHORA), yaEnviado);
  // Con los mismos datos responde lo mismo que la primera vez.
  assert.equal((await declararSaldo(admin, { saldo: "100000.00", alDia: "2026-11-05", altaId: altaSaldo }, AHORA)).id, altaSaldo);
  assert.equal((await registrarCobro(admin, datosCobro, AHORA)).id, altaCobro);
  assert.equal((await registrarObligacion(admin, datosRenta, AHORA)).id, altaRenta);
  for (const [tabla, accion, id] of [
    ["cash_balance_declarations", "declarar_saldo", altaSaldo],
    ["expected_collections", "registrar_cobro", altaCobro],
    ["recurring_obligations", "registrar_obligacion", altaRenta],
  ] as const) {
    assert.equal(contar(url, `select count(*) from ${tabla} where company_id = '${alfa.id}'`), 1, tabla);
    assert.equal(contar(url, `select count(*) from audit_log where accion = '${accion}' and identificador = '${id}'`), 1, accion);
  }
  // Sin el id del formulario no hay alta.
  await assert.rejects(() => declararSaldo(admin, { saldo: "1.00", alDia: "2026-11-05" }, AHORA), codigo("entrada_invalida"));
  await assert.rejects(() => declararSaldo(admin, { saldo: "1.00", alDia: "2026-11-05", altaId: "no-es-uuid" }, AHORA), codigo("entrada_invalida"));
  await declararSaldo(adminBeta, { saldo: "777777.00", alDia: "2026-11-05", altaId: randomUUID() }, AHORA);
  await configurarColchon(adminBeta, { colchon: "1.00" }, AHORA);
  const cobroBeta = await registrarCobro(adminBeta, {
    clienteNombre: "Cliente Secreto Beta",
    clienteRfc: "",
    concepto: "Secreto Beta",
    monto: "99999.00",
    fechaProbable: "2026-11-18",
    referencia: "",
    altaId: randomUUID(),
  }, AHORA);
  await registrarObligacion(adminBeta, { concepto: "Obligación Secreta Beta", monto: "1.00", frecuencia: "mensual", proximaFecha: "2026-11-17", areaId: "", altaId: randomUUID() }, AHORA);
  // El id de una fila de otra empresa no se acepta como alta repetida: RLS no la deja ver.
  await assert.rejects(
    () => registrarCobro(admin, { clienteNombre: "X", concepto: "X", monto: "1.00", fechaProbable: "2026-11-20", altaId: cobroBeta.id }, AHORA),
    codigo("entrada_invalida"),
  );
  assert.equal(contar(url, `select count(*) from expected_collections where id = '${cobroBeta.id}' and company_id = '${beta.id}'`), 1);
  await cambiarCorreoSemanal(adminBeta, { activo: "si" }, AHORA);

  const pago = sembrarPago(url, alfa.id, admin.persona.id, operacion.id);
  // R3: un cargo sin pagar programado antes del saldo declarado sigue debiéndose.
  const atrasado = sembrarPago(url, alfa.id, admin.persona.id, null, {
    rfc: "BBB010101BB1", nombre: "Proveedor Dos", uuid: "123E4567-E89B-42D3-A456-426614174002", folio: "90", programada: "2026-11-03", total: 1_500_000,
  });
  // R4: la renta facturada por Proveedor Uno no se cuenta el mes en que ya trae su cargo (noviembre).
  const facturada = await registrarObligacion(admin, {
    concepto: "Mantenimiento facturado",
    monto: "1000.00",
    frecuencia: "mensual",
    proximaFecha: "2026-11-20",
    areaId: operacion.id,
    proveedorId: pago.proveedorId,
    altaId: randomUUID(),
  }, AHORA);
  assert.deepEqual(
    consultarJson<Record<string, unknown>[]>(url, `select json_agg(cambio) from audit_log where accion = 'registrar_obligacion' and identificador = '${facturada.id}'`),
    [{ concepto: "Mantenimiento facturado", monto_centavos: 100_000, frecuencia: "mensual", proxima_fecha: "2026-11-20", area: "Operación", proveedor: "Proveedor Uno" }],
  );

  // N3: Proveedor Cuatro factura la renta del almacén: en noviembre trae $500 (faltan $29,500) y en diciembre la renta completa.
  const almacen = sembrarPago(url, alfa.id, admin.persona.id, operacion.id, {
    rfc: "DDD010101DD1", nombre: "Proveedor Cuatro", uuid: "123E4567-E89B-42D3-A456-426614174004", folio: "110", programada: "2026-11-25", total: 50_000,
  });
  sembrarCargoSinEventos(url, almacen.id, "2026-12-18", 3_000_000);
  const rentaAlmacen = await registrarObligacion(admin, {
    concepto: "Renta del almacén",
    monto: "30000.00",
    frecuencia: "mensual",
    proximaFecha: "2026-11-20",
    areaId: operacion.id,
    proveedorId: almacen.proveedorId,
    altaId: randomUUID(),
  }, AHORA);

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
  // R3: el cargo del 3 de noviembre (antes del saldo del 5) va atrasado en la primera semana.
  assert.ok(flujo.proyeccion.semanas[0]?.movimientos.some((m) => m.clave === `cxp:${atrasado.id}` && m.atrasado === true && m.centavos === 1_500_000));
  // R4: noviembre ya trae el cargo de Proveedor Uno; diciembre no.
  assert.equal(movimientos.some((m) => m.clave === `obl:${facturada.id}:2026-11-20`), false);
  assert.ok(movimientos.some((m) => m.clave === `obl:${facturada.id}:2026-12-20`));
  // N3: la renta del almacén cuenta lo que falta después de la factura del mes; con la factura completa, nada.
  const almacenNoviembre = movimientos.find((m) => m.clave === `obl:${rentaAlmacen.id}:2026-11-20`);
  assert.deepEqual(
    [almacenNoviembre?.centavos, almacenNoviembre?.facturadoCentavos, almacenNoviembre?.concepto],
    [2_950_000, 50_000, "Renta del almacén: $29,500.00 restantes (ya hay factura por $500.00)"],
  );
  assert.equal(movimientos.some((m) => m.clave === `obl:${rentaAlmacen.id}:2026-12-20`), false);
  assert.equal(movimientos.find((m) => m.clave === `obl:${rentaAlmacen.id}:2027-01-20`)?.centavos, 3_000_000);
  const calendarioAlmacen = (await leerVistaCalendario(admin, "2026-11", AHORA)).eventos.find((e) => e.clave === `obl:${rentaAlmacen.id}:2026-11-20`);
  assert.equal(calendarioAlmacen?.concepto, "Renta del almacén: $29,500.00 restantes (ya hay factura por $500.00)");
  assert.deepEqual(calendarioAlmacen?.detalle.find(([campo]) => campo === "Ya facturado este mes"), [
    "Ya facturado este mes", "$500.00: cuenta en Pagos a proveedores, aquí solo lo que falta",
  ]);
  assert.equal((await leerVistaCalendario(admin, "2026-12", AHORA)).eventos.some((e) => e.clave === `obl:${rentaAlmacen.id}:2026-12-20`), false);

  // N1: 20 cargos autorizados de antes del saldo (15 de octubre y el mismo 5 de noviembre) ya están pagados en el
  // saldo declarado: no entran. El cargo viejo por autorizar sí, como vencido sin autorizar. Se siembran sin
  // triggers: aquí solo se prueba la lectura.
  const autorizados = sembrarPago(url, alfa.id, admin.persona.id, null, {
    rfc: "CCC010101CC1", nombre: "Proveedor Tres", uuid: "123E4567-E89B-42D3-A456-426614174003", folio: "100", programada: "2026-10-15", total: 1_000_000,
  });
  for (let n = 1; n < 20; n++) sembrarCargoSinEventos(url, autorizados.id, n % 2 === 0 ? "2026-10-15" : "2026-11-05", 1_000_000);
  ejecutar(url, `
    set session_replication_role = replica;
    insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, estado, solicitado_por, solicitado_en, resuelto_por, resuelto_en, creado_en)
      select gen_random_uuid(), p.company_id, p.id, c.id, c.clabe, p.total_centavos, p.programada_el, 'listo_para_pagar', '${admin.persona.id}', now(), '${finanzas.persona.id}', now(), now()
        from supplier_payables p join supplier_clabes c on c.supplier_id = p.supplier_id and c.company_id = p.company_id
       where p.supplier_id = '${autorizados.proveedorId}';
    insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, estado, solicitado_por, solicitado_en, creado_en)
      select gen_random_uuid(), p.company_id, p.id, c.id, c.clabe, p.total_centavos, p.programada_el, 'por_autorizar', '${admin.persona.id}', now(), now()
        from supplier_payables p join supplier_clabes c on c.supplier_id = p.supplier_id and c.company_id = p.company_id
       where p.id = '${atrasado.id}';
  `);
  assert.equal(contar(url, `select count(*) from supplier_payment_requests where estado = 'listo_para_pagar' and payable_id in (select id from supplier_payables where supplier_id = '${autorizados.proveedorId}')`), 20);
  const conAutorizados = await leerFlujoInicio(admin, {}, AHORA);
  assert.deepEqual(
    conAutorizados.proyeccion.semanas[0]?.movimientos.map((m) => [m.clave, m.atrasado, m.sinAutorizar, m.centavos]),
    [[`cxp:${atrasado.id}`, true, true, 1_500_000]],
  );
  assert.equal(JSON.stringify(conAutorizados.proyeccion).includes("Proveedor Tres"), false);
  assert.deepEqual(conAutorizados.proyeccion.alcance, flujo.proyeccion.alcance);
  assert.equal(conAutorizados.proyeccion.semanas[12]?.saldoFinal, flujo.proyeccion.semanas[12]?.saldoFinal);

  // R2: un cobro que llegó después del saldo declarado entra en la semana en que llegó.
  const pronto = await registrarCobro(admin, {
    clienteNombre: "Cliente Pronto", clienteRfc: "", concepto: "Anticipo", monto: "5000.00", fechaProbable: "2026-11-10", referencia: "", altaId: randomUUID(),
  }, AHORA);
  await marcarCobrado(admin, { id: pronto.id, cobradoEl: "2026-11-06" }, AHORA);
  const conCobrado = await leerFlujoInicio(admin, {}, AHORA);
  const llegado = conCobrado.proyeccion.semanas[0]?.movimientos.find((m) => m.clave === `cob:${pronto.id}`);
  assert.equal(llegado?.cobrado, true);
  assert.equal(llegado?.fecha, "2026-11-06");
  assert.equal(conCobrado.proyeccion.semanas[0]?.entradas, (flujo.proyeccion.semanas[0]?.entradas ?? 0) + 500_000);

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
  await assert.rejects(() => declararSaldo(contador, { saldo: "1.00", alDia: "2026-11-05", altaId: randomUUID() }, AHORA), codigo("sin_permiso"));
  await assert.rejects(
    () => registrarCobro(contador, { clienteNombre: "X", concepto: "X", monto: "1.00", fechaProbable: "2026-11-20", altaId: randomUUID() }, AHORA),
    codigo("sin_permiso"),
  );
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
  await declararSaldo(admin, { saldo: "90000.00", alDia: "2026-11-06", altaId: randomUUID() }, AHORA);
  const historial = await leerVistaSaldo(admin, AHORA);
  assert.deepEqual(historial.historial.map((d) => d.centavos), [9_000_000, 10_000_000]);
  const conSaldoNuevo = await leerFlujoInicio(admin, {}, AHORA);
  assert.equal(conSaldoNuevo.proyeccion.saldo?.centavos, 9_000_000);
  // El cobro del 6 ya está dentro del saldo al 6: no se cuenta otra vez.
  assert.equal(conSaldoNuevo.proyeccion.semanas.some((s) => s.movimientos.some((m) => m.clave === `cob:${pronto.id}`)), false);

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
  // La obligación facturada de Proveedor Uno no suma en noviembre: ese mes ya trae su cargo (R4). La renta del almacén
  // suma $29,500 y su factura de $500 entra por Proveedor Cuatro: la renta cuenta una vez (N3).
  assert.equal(area.gastoCentavos, 1_600_000 + 4_000_000 + 3_000_000 + 50_000 + 2_950_000);
  assert.equal(area.estado, "excedido");

  // S1: sin permiso de ver el detalle de la nómina (contadora, finanzas) no se ve el neto de una sola persona.
  const inicioContadora = await leerFlujoInicio(contador, {}, AHORA);
  const nominaContadora = inicioContadora.proyeccion.semanas.flatMap((s) => s.movimientos).filter((m) => m.tipo === "nomina");
  assert.ok(nominaContadora.length > 0);
  assert.deepEqual([...new Set(nominaContadora.map((m) => m.concepto))], ["Nómina"]);
  assert.equal(JSON.stringify(inicioContadora).includes("1 persona"), false);
  assert.ok((await leerFlujoInicio(admin, {}, AHORA)).proyeccion.semanas.flatMap((s) => s.movimientos).some((m) => m.concepto === "Nómina quincenal (1 persona)"));
  const calendarioContadora = await leerVistaCalendario(contador, "2026-11", AHORA);
  const nomina15 = calendarioContadora.eventos.find((e) => e.clave === "nom:2026-11-15");
  assert.deepEqual([nomina15?.concepto, nomina15?.centavos, nomina15?.reservado], ["Nómina", 0, true]);
  assert.equal(JSON.stringify(calendarioContadora).includes("800000"), false);
  assert.equal((await leerVistaCalendario(admin, "2026-11", AHORA)).eventos.find((e) => e.clave === "nom:2026-11-15")?.centavos, 800_000);
  const presupuestosContadora = await leerVistaPresupuestos(finanzas, AHORA);
  assert.equal(presupuestosContadora.presupuestos.areas.find((linea) => linea.id === operacion.id)?.desglose, undefined);
  assert.equal(area.desglose?.nominaCentavos, 1_600_000);
  // SEG-N1: Operación tiene la nómina de una sola persona. Sin permiso de detalle (contadora y finanzas), el gasto
  // del área sería su neto: ni la página, ni las alertas de Inicio, ni Pendientes lo muestran. Quedan estado y presupuesto.
  assert.equal(area.desglose?.nominaPersonas, 1);
  for (const sinDetalle of [contador, finanzas]) {
    const vista = await leerVistaPresupuestos(sinDetalle, AHORA);
    const linea = vista.presupuestos.areas.find((l) => l.id === operacion.id);
    assert.deepEqual([linea?.gastoCentavos, linea?.estado, linea?.presupuestoCentavos], [null, "excedido", 5_000_000]);
    assert.equal(JSON.stringify(vista).includes(String(area.gastoCentavos)), false);
    const alerta = (await leerAlertasPresupuesto(sinDetalle, "2026-11-06")).find((l) => l.id === operacion.id);
    assert.deepEqual([alerta?.gastoCentavos, alerta?.estado], [null, "excedido"]);
    const enInicio = (await leerFlujoInicio(sinDetalle, {}, AHORA)).presupuestos.alertas.find((l) => l.id === operacion.id);
    assert.deepEqual([enInicio?.gastoCentavos, enInicio?.estado], [null, "excedido"]);
    const pendiente = (await leerPendientesInicio(sinDetalle, AHORA)).find((p) => p.id === `presupuesto-area-${operacion.id}`);
    assert.equal(pendiente?.titulo, "El presupuesto del área Operación está excedido");
    assert.equal(pendiente?.detalle, "Presupuesto de $50,000.00 este mes. El gasto está reservado: solo lo ve quien puede ver el detalle de la nómina.");
  }
  // Quien sí ve el detalle (administración) sigue viendo el gasto en las alertas y en Pendientes.
  assert.equal((await leerAlertasPresupuesto(admin, "2026-11-06")).find((l) => l.id === operacion.id)?.gastoCentavos, area.gastoCentavos);
  assert.match((await leerPendientesInicio(admin, AHORA)).find((p) => p.id === `presupuesto-area-${operacion.id}`)?.detalle ?? "", /^Lleva \$[\d,]+\.\d\d de \$50,000\.00 este mes/);

  // R8: una persona con alta futura no suma su nómina al presupuesto del mes.
  ejecutar(url, `set session_replication_role = replica; update employees set alta_en = '2026-12-01' where company_id = '${alfa.id}' and nombre = 'Operativo Quincenal';`);
  const conAltaFutura = await leerVistaPresupuestos(admin, AHORA);
  assert.equal(conAltaFutura.presupuestos.areas.find((linea) => linea.id === operacion.id)?.gastoCentavos, 4_000_000 + 3_000_000 + 50_000 + 2_950_000);
  ejecutar(url, `set session_replication_role = replica; update employees set alta_en = '2026-11-01' where company_id = '${alfa.id}' and nombre = 'Operativo Quincenal';`);

  // S2: editar una obligación deja antes y después de concepto, área y proveedor, por nombre.
  await editarObligacion(admin, {
    id: renta.id, concepto: "Renta del local principal", monto: "31000.00", frecuencia: "mensual", proximaFecha: "2026-11-15", areaId: "", proveedorId: "",
  }, AHORA);
  assert.deepEqual(
    consultarJson<Record<string, unknown>[]>(url, `select json_agg(cambio) from audit_log where accion = 'editar_obligacion' and identificador = '${renta.id}'`),
    [{
      concepto_anterior: "Renta del local", concepto_nuevo: "Renta del local principal",
      monto_anterior: 3_000_000, monto_nuevo: 3_100_000,
      frecuencia_anterior: "mensual", frecuencia_nueva: "mensual",
      fecha_anterior: "2026-11-15", fecha_nueva: "2026-11-15",
      area_anterior: "Operación", area_nueva: null,
      proveedor_anterior: null, proveedor_nuevo: null,
    }],
  );

  // R5 y R9 con el XML de una factura emitida: el mismo formulario dos veces deja un cobro; la misma factura
  // en otro formulario dice en qué estado está.
  const factura = (uuid: string) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-11-02T10:00:00" TipoDeComprobante="I" Moneda="MXN" Total="12000.00" Serie="F" Folio="7">
  <cfdi:Emisor Rfc="TCM010101AB1" Nombre="Escuela Alfa Flujo" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="CLM120101AB2" Nombre="Comercializadora Uno" DomicilioFiscalReceptor="06600" RegimenFiscalReceptor="601" UsoCFDI="G03" />
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="${uuid}" /></cfdi:Complemento>
</cfdi:Comprobante>`);
  const uuidFactura = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
  const altaXml = randomUUID();
  const conXml = await dosVecesYOtra(() => registrarCobroCfdi(admin, { bytes: factura(uuidFactura), fechaProbable: "2026-11-25", altaId: altaXml }, AHORA));
  assert.deepEqual(conXml.map((c) => c.id), [altaXml, altaXml, altaXml]);
  // N4: el mismo formulario con otra factura u otra fecha se rechaza; con lo mismo, responde igual.
  await assert.rejects(() => registrarCobroCfdi(admin, { bytes: factura("CCCCCCCC-DDDD-4EEE-8FFF-AAAAAAAAAAAA"), fechaProbable: "2026-11-25", altaId: altaXml }, AHORA), yaEnviado);
  await assert.rejects(() => registrarCobroCfdi(admin, { bytes: factura(uuidFactura), fechaProbable: "2026-11-26", altaId: altaXml }, AHORA), yaEnviado);
  assert.equal(contar(url, `select count(*) from expected_collections where cfdi_uuid = 'CCCCCCCC-DDDD-4EEE-8FFF-AAAAAAAAAAAA'`), 0);
  // Dos envíos simultáneos del mismo XML chocan con el id o con la factura viva, según cuál revise primero Postgres:
  // el mismo formulario siempre responde igual; dos formularios distintos dejan uno y el otro dice que ya está registrada.
  for (let vuelta = 0; vuelta < 12; vuelta++) {
    const uuid = `DDDDDDDD-0000-4000-8000-${String(vuelta).padStart(12, "0")}`;
    const alta = randomUUID();
    const mismos = await Promise.all([0, 1].map(() => registrarCobroCfdi(admin, { bytes: factura(uuid), fechaProbable: "2026-11-25", altaId: alta }, AHORA)));
    assert.deepEqual(mismos.map((c) => c.id), [alta, alta], `vuelta ${vuelta}`);
    const otra = `EEEEEEEE-0000-4000-8000-${String(vuelta).padStart(12, "0")}`;
    const distintos = await Promise.allSettled([0, 1].map(() => registrarCobroCfdi(admin, { bytes: factura(otra), fechaProbable: "2026-11-25", altaId: randomUUID() }, AHORA)));
    assert.equal(distintos.filter((r) => r.status === "fulfilled").length, 1, `vuelta ${vuelta}`);
    const rechazo = distintos.find((r) => r.status === "rejected");
    assert.ok(rechazo && codigo("cobro_duplicado")(rechazo.reason), `vuelta ${vuelta}: ${String(rechazo?.status === "rejected" ? rechazo.reason : "")}`);
  }
  assert.equal(contar(url, "select count(*) from expected_collections where cfdi_uuid like 'DDDDDDDD-%' or cfdi_uuid like 'EEEEEEEE-%'"), 24);
  assert.equal(contar(url, `select count(*) from expected_collections where cfdi_uuid = '${uuidFactura}'`), 1);
  assert.equal(contar(url, `select count(*) from audit_log where accion = 'registrar_cobro' and identificador = '${altaXml}'`), 1);
  await assert.rejects(() => registrarCobroCfdi(admin, { bytes: factura(uuidFactura), fechaProbable: "2026-11-25", altaId: randomUUID() }, AHORA), codigo("cobro_duplicado"));
  await marcarCobrado(admin, { id: altaXml, cobradoEl: "2026-11-06" }, AHORA);
  await assert.rejects(() => registrarCobroCfdi(admin, { bytes: factura(uuidFactura), fechaProbable: "2026-11-25", altaId: randomUUID() }, AHORA), codigo("cobro_ya_cobrado"));
  // Cancelado, la misma factura se puede volver a registrar.
  const otraFactura = "BBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF";
  const sustituida = await registrarCobroCfdi(admin, { bytes: factura(otraFactura), fechaProbable: "2026-11-25", altaId: randomUUID() }, AHORA);
  await cancelarCobro(admin, { id: sustituida.id, motivo: "Factura sustituida" }, AHORA);
  await registrarCobroCfdi(admin, { bytes: factura(otraFactura), fechaProbable: "2026-11-26", altaId: randomUUID() }, AHORA);

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
  const gamma = await darDeAltaComoDuena(url, personal, { rfc: "GAM010101AB2", razonSocial: "Gamma Suspendida", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  await administrador(url, personal, gamma, "admin-gamma-flujo@ejemplo.mx");
  const delta = await darDeAltaComoDuena(url, personal, { rfc: "DEL010101AB3", razonSocial: "Delta Baja", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const adminDelta = await administrador(url, personal, delta, "admin-delta-flujo@ejemplo.mx");
  const areaDelta = await nombrarCentro(adminDelta, { nombre: "General", presupuesto: "" }, AHORA);
  await persona(url, adminDelta, areaDelta.id, "Finanzas Delta", "finanzas-delta@ejemplo.mx", ["tarjetahabiente", "finanzas"]);
  // En Delta solo queda Finanzas como destinataria.
  await cambiarCorreoSemanal(adminDelta, { activo: "no" }, AHORA);
  // S7: una empresa de demostración tiene cifras de ejemplo: nunca entra en la lista, aunque tenga administración.
  const epsilon = await darDeAltaComoDuena(url, personal, { rfc: "EPS010101AB4", razonSocial: "Épsilon Demostración", codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: true, corridoPor: "pruebas@ejemplo.mx" });
  await administrador(url, personal, epsilon, "admin-epsilon-flujo@ejemplo.mx");
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
  // Sin ritmo: la separación entre envíos se prueba aparte (correo-semanal.test.ts) y se mide con 200 empresas.
  const deps = { ahora: () => VIERNES, enviador, urlPublica: "https://lever.test", ritmoMs: 0, registrar: (c: Readonly<Record<string, string | number>>) => void registros.push({ ...c }) };
  const primera = await enviarCorreosSemanales(deps);
  assert.deepEqual(primera, { semana: "2026-11-02", empresas: 2, enviados: 2, omitidos: 0, fallidos: 0, pendientes: 0 });
  const correosAlfa = enviados.filter((m) => m.idempotencia.includes(alfa.id));
  const correosBeta = enviados.filter((m) => m.idempotencia.includes(beta.id));
  assert.deepEqual(correosAlfa.map((m) => m.para).sort(), ["admin-alfa-flujo@ejemplo.mx", "contadora-flujo@ejemplo.mx"]);
  assert.deepEqual(correosBeta.map((m) => m.para), ["admin-beta-flujo@ejemplo.mx"]);
  // SEG-N1: la administradora ve el gasto de Operación; la contadora (sin detalle de nómina), solo estado y presupuesto.
  const correoAdmin = correosAlfa.find((m) => m.para === "admin-alfa-flujo@ejemplo.mx");
  const correoContadora = correosAlfa.find((m) => m.para === "contadora-flujo@ejemplo.mx");
  const gastoEnCorreo = /Área Operación: excedido \((\$[\d,]+\.\d\d) de \$50,000\.00\)/.exec(correoAdmin?.texto ?? "")?.[1];
  assert.ok(gastoEnCorreo, "el correo de la administradora trae el gasto de Operación");
  assert.ok(correoContadora?.texto.includes("Área Operación: excedido (presupuesto de $50,000.00; el gasto está reservado)."));
  assert.equal(correoContadora?.texto.includes(gastoEnCorreo) || correoContadora?.html.includes(gastoEnCorreo), false);
  for (const m of correosAlfa) {
    assert.match(m.texto, /\$90,000\.00 al 6 de noviembre de 2026/);
    assert.match(m.html, /https:\/\/lever\.test\/c\/[0-9a-f-]+\/consola/);
    for (const ajeno of ["Secreto Beta", "777,777", "Taller Beta"]) assert.equal(m.html.includes(ajeno) || m.texto.includes(ajeno), false, ajeno);
    assert.equal(m.texto.includes("Confirmado por el banco"), false);
    // N1: los 20 autorizados viejos ya están en el saldo: sumarlos daría «No alcanza esta semana».
    assert.equal(m.texto.includes("No alcanza") || m.html.includes("No alcanza"), false);
  }
  // S1: el correo va también a quien no ve el detalle de la nómina: nunca desglosa a una sola persona.
  for (const m of enviados) assert.equal(m.texto.includes("1 persona") || m.html.includes("1 persona"), false);
  // S4: cada persona que lo recibió queda registrada, sin su correo.
  assert.equal(contar(url, "select count(*) from weekly_digest_deliveries where semana = '2026-11-02'"), 3);
  assert.equal(contar(url, "select count(*) from audit_log where accion = 'correo_semanal_entregado'"), 3);
  for (const m of correosBeta) {
    for (const ajeno of ["Escuela Alfa", "Renta del local", "Colegiaturas", "90,000"]) assert.equal(m.html.includes(ajeno) || m.texto.includes(ajeno), false, ajeno);
  }
  assert.equal(new Set(enviados.map((m) => m.idempotencia)).size, enviados.length);

  // Vercel puede llamar dos veces: la segunda no manda nada.
  const repetida = await enviarCorreosSemanales(deps);
  assert.deepEqual(repetida, { semana: "2026-11-02", empresas: 2, enviados: 0, omitidos: 2, fallidos: 0, pendientes: 0 });
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
  assert.deepEqual(conFalla, { semana: "2026-11-09", empresas: 2, enviados: 1, omitidos: 0, fallidos: 1, pendientes: 0 });
  assert.deepEqual(
    consultarJson<{ e: string; c: string | null }[]>(url, `select json_agg(json_build_object('e', estado, 'c', codigo)) from weekly_digest_sends where company_id = '${beta.id}' and semana = '2026-11-09'`),
    [{ e: "fallido", c: "correo_limite" }],
  );
  assert.ok(registros.some((r) => r.evento === "correo_semanal_fallido" && r.empresa === beta.id && r.codigo === "correo_limite"));
  assert.equal(JSON.stringify(registros).includes("@"), false, "el registro no lleva correos");
  // Un reintento vuelve a abrir solo la fallida.
  const reintento = await enviarCorreosSemanales({ ...deps, ahora: () => lunes });
  assert.deepEqual(reintento, { semana: "2026-11-09", empresas: 2, enviados: 1, omitidos: 1, fallidos: 0, pendientes: 0 });

  // Un apartado «enviando» reciente es otra corrida en curso; uno viejo, una corrida que se cayó.
  ejecutar(url, `
    insert into weekly_digest_sends (id, company_id, semana, estado, intentado_en)
      values ('${randomUUID()}', '${alfa.id}', '2026-11-16', 'enviando', clock_timestamp() - interval '2 hours'),
             ('${randomUUID()}', '${beta.id}', '2026-11-16', 'enviando', clock_timestamp());
  `);
  const tercera = await enviarCorreosSemanales({ ...deps, ahora: () => new Date("2026-11-16T14:00:00.000Z") });
  assert.deepEqual(tercera, { semana: "2026-11-16", empresas: 2, enviados: 1, omitidos: 1, fallidos: 0, pendientes: 0 });
  assert.deepEqual(
    consultarJson<{ c: string | null }[]>(url, `select json_agg(json_build_object('c', a.cambio->>'codigo') order by a.ocurrido_en) from audit_log a join weekly_digest_sends w on w.id = a.identificador where w.company_id = '${alfa.id}' and w.semana = '2026-11-16'`),
    [{ c: "interrumpido" }, { c: null }],
  );

  // S4: si una persona falla, el reintento solo le manda a ella; quien ya lo recibió no lo vuelve a recibir,
  // aunque el reintento llegue después de las 24 horas de la llave del proveedor.
  const lunes30 = new Date("2026-11-30T14:00:00.000Z");
  const fallaContadora = async (mensaje: MensajeCorreo) => {
    if (mensaje.para.startsWith("contadora-flujo")) throw new ErrorDeCorreo("correo_limite");
    return enviador(mensaje);
  };
  const parcial = await enviarCorreosSemanales({ ...deps, ahora: () => lunes30, enviador: fallaContadora });
  assert.deepEqual(parcial, { semana: "2026-11-30", empresas: 2, enviados: 1, omitidos: 0, fallidos: 1, pendientes: 0 });
  const dosDiasDespues = new Date("2026-12-02T14:00:00.000Z");
  const completo = await enviarCorreosSemanales({ ...deps, ahora: () => dosDiasDespues });
  assert.deepEqual(completo, { semana: "2026-11-30", empresas: 2, enviados: 1, omitidos: 1, fallidos: 0, pendientes: 0 });
  const semana30 = enviados.filter((m) => m.idempotencia.includes("/2026-11-30/"));
  assert.deepEqual(semana30.map((m) => m.para).sort(), ["admin-alfa-flujo@ejemplo.mx", "admin-beta-flujo@ejemplo.mx", "contadora-flujo@ejemplo.mx"]);
  assert.equal(contar(url, `select destinatarios from weekly_digest_sends where company_id = '${alfa.id}' and semana = '2026-11-30'`), 2);
  // Una persona no escribe el registro de entregas, ni con SQL directo.
  await assert.rejects(() => conContexto(baseCliente(admin), (consulta) => consulta.query(
    "insert into weekly_digest_deliveries (id, company_id, semana, user_id, send_id) select $1, company_id, semana, $2, id from weekly_digest_sends where company_id = $3 limit 1",
    [randomUUID(), admin.persona.id, alfa.id],
  )));

  // S6: dos corridas a la vez (Vercel puede entregar dos veces): una fila por empresa y semana, un correo por persona.
  const lunes7 = new Date("2026-12-07T14:00:00.000Z");
  const antes = enviados.length;
  const [una, otra] = await Promise.all([
    enviarCorreosSemanales({ ...deps, ahora: () => lunes7 }),
    enviarCorreosSemanales({ ...deps, ahora: () => lunes7 }),
  ]);
  assert.equal(una.enviados + otra.enviados, 2);
  assert.equal(una.omitidos + otra.omitidos, 2);
  assert.equal(contar(url, "select count(*) from weekly_digest_sends where semana = '2026-12-07'"), 2);
  const semana7 = enviados.slice(antes).map((m) => m.para).sort();
  assert.deepEqual(semana7, ["admin-alfa-flujo@ejemplo.mx", "admin-beta-flujo@ejemplo.mx", "contadora-flujo@ejemplo.mx"]);

  // S5: con el tiempo agotado no empieza más empresas: quedan pendientes, se registran y la siguiente corrida las toma.
  const lunes14 = new Date("2026-12-14T14:00:00.000Z");
  const agotada = await enviarCorreosSemanales({ ...deps, ahora: () => lunes14, transcurrido: () => 300_000 });
  assert.deepEqual(agotada, { semana: "2026-12-14", empresas: 2, enviados: 0, omitidos: 0, fallidos: 0, pendientes: 2 });
  assert.ok(registros.some((r) => r.evento === "correo_semanal_pendientes" && r.pendientes === 2));
  const siguiente = await enviarCorreosSemanales({ ...deps, ahora: () => lunes14 });
  assert.equal(siguiente.enviados, 2);

  // SEG-N2: un Resend simulado con la semántica de su llave de idempotencia (doc de Resend, «Idempotency Keys ›
  // Possible responses»): la misma llave con el mismo contenido responde lo mismo; con otro contenido, 409
  // invalid_idempotent_request; con otra petición en curso, 409 concurrent_idempotent_requests. Pasa por enviadorResend.
  const aceptados = new Map<string, { huella: string; id: string }>();
  const nuevosPorLlave = new Map<string, number>();
  const enCurso = new Set<string>();
  const perderRespuesta = new Set<string>();
  const resendSimulado = async (_url: string, init: RequestInit): Promise<Response> => {
    const llave = String((init.headers as Record<string, string>)["Idempotency-Key"]);
    const cuerpo = String(init.body);
    const huella = createHash("sha256").update(cuerpo).digest("hex");
    if (enCurso.has(llave)) return Response.json({ statusCode: 409, name: "concurrent_idempotent_requests", message: "en curso" }, { status: 409 });
    const previo = aceptados.get(llave);
    if (previo && previo.huella !== huella) return Response.json({ statusCode: 409, name: "invalid_idempotent_request", message: "otro contenido" }, { status: 409 });
    if (!previo) nuevosPorLlave.set(llave, (nuevosPorLlave.get(llave) ?? 0) + 1);
    const id = previo?.id ?? `re_sim_${aceptados.size + 1}`;
    aceptados.set(llave, { huella, id });
    // Resend lo aceptó y lo mandó, pero la respuesta no llegó (red caída): la tarea no sabe que salió.
    if (perderRespuesta.has((JSON.parse(cuerpo) as { to: string[] }).to[0] ?? "")) throw new Error("socket hang up");
    return Response.json({ id });
  };
  const conResend = { ...deps, enviador: enviadorResend({ apiKey: "re_prueba_local", remitente: "Lever Empresas <avisos@lever.test>" }, resendSimulado) };
  const llaveContadora = (semana: string) => `correo-semanal/${alfa.id}/${semana}/${contador.persona.id}`;
  const entregasDe = (semana: string) => contar(url, `select count(*) from weekly_digest_deliveries where semana = '${semana}' and user_id = '${contador.persona.id}'`);
  const envioAlfa = (semana: string) =>
    consultarJson<{ e: string; c: string | null }[]>(url, `select jsonb_agg(jsonb_build_object('e', estado, 'c', codigo)) from weekly_digest_sends where company_id = '${alfa.id}' and semana = '${semana}'`);

  // 1) El correo de la contadora sale, pero la respuesta se pierde: queda sin entrega registrada y Alfa, fallida.
  const lunes21 = new Date("2026-12-21T14:00:00.000Z");
  perderRespuesta.add("contadora-flujo@ejemplo.mx");
  assert.deepEqual(await enviarCorreosSemanales({ ...conResend, ahora: () => lunes21 }), { semana: "2026-12-21", empresas: 2, enviados: 1, omitidos: 0, fallidos: 1, pendientes: 0 });
  assert.equal(nuevosPorLlave.get(llaveContadora("2026-12-21")), 1);
  assert.equal(entregasDe("2026-12-21"), 0);
  perderRespuesta.clear();
  // Antes del reintento cambia el contenido (otro saldo): la misma llave ya no coincide y Resend responde 409 invalid_idempotent_request.
  await declararSaldo(admin, { saldo: "95000.00", alDia: "2026-11-06", altaId: randomUUID() }, AHORA);
  const entregadosAntes = contar(url, "select count(*) from audit_log where accion = 'correo_semanal_entregado'");
  assert.deepEqual(await enviarCorreosSemanales({ ...conResend, ahora: () => lunes21 }), { semana: "2026-12-21", empresas: 2, enviados: 1, omitidos: 1, fallidos: 0, pendientes: 0 });
  // Cuenta como entrega: se registra con su evento, Alfa queda enviada y Resend no mandó otro.
  assert.equal(entregasDe("2026-12-21"), 1);
  assert.equal(contar(url, "select count(*) from audit_log where accion = 'correo_semanal_entregado'"), entregadosAntes + 1);
  assert.deepEqual(envioAlfa("2026-12-21"), [{ e: "enviado", c: null }]);
  assert.equal(nuevosPorLlave.get(llaveContadora("2026-12-21")), 1);
  assert.ok(registros.some((r) => r.evento === "correo_semanal_ya_enviado" && r.usuario === contador.persona.id && r.semana === "2026-12-21"));

  // 2) Otra petición con la misma llave sigue en curso: 409 concurrent_idempotent_requests no cuenta como entrega.
  const lunes28 = new Date("2026-12-28T14:00:00.000Z");
  enCurso.add(llaveContadora("2026-12-28"));
  assert.deepEqual(await enviarCorreosSemanales({ ...conResend, ahora: () => lunes28 }), { semana: "2026-12-28", empresas: 2, enviados: 1, omitidos: 0, fallidos: 1, pendientes: 0 });
  assert.deepEqual(envioAlfa("2026-12-28"), [{ e: "fallido", c: "correo_en_curso" }]);
  assert.equal(entregasDe("2026-12-28"), 0);
  assert.equal(nuevosPorLlave.get(llaveContadora("2026-12-28")), undefined);
  // Se deja para el siguiente reintento, que ya lo manda una vez.
  enCurso.clear();
  assert.deepEqual(await enviarCorreosSemanales({ ...conResend, ahora: () => lunes28 }), { semana: "2026-12-28", empresas: 2, enviados: 1, omitidos: 1, fallidos: 0, pendientes: 0 });
  assert.equal(entregasDe("2026-12-28"), 1);
  assert.deepEqual(envioAlfa("2026-12-28"), [{ e: "enviado", c: null }]);
  assert.equal(nuevosPorLlave.get(llaveContadora("2026-12-28")), 1);

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

type OpcionesPago = { rfc?: string; nombre?: string; uuid?: string; folio?: string; programada?: string; total?: number };

/** Un proveedor (con área si se da) y una cuenta por pagar sin solicitud, con sus eventos en la misma transacción. */
function sembrarPago(url: string, empresaId: string, userId: string, areaId: string | null, opciones: OpcionesPago = {}): { id: string; proveedorId: string } {
  const documento = randomUUID();
  const proveedorId = randomUUID();
  const clabeId = randomUUID();
  const id = randomUUID();
  const rfc = opciones.rfc ?? "AAA010101AAA";
  const nombre = opciones.nombre ?? "Proveedor Uno";
  const uuid = opciones.uuid ?? "123E4567-E89B-42D3-A456-426614174001";
  const folio = opciones.folio ?? "81";
  const programada = opciones.programada ?? "2026-11-12";
  const total = opciones.total ?? 4_000_000;
  const area = areaId === null ? "" : `
    update suppliers set cost_center_id = '${areaId}' where id = '${proveedorId}';
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, id, 'miembro', '${userId}', 'cliente', 'asignar_area_proveedor', 'suppliers', '${proveedorId}' from companies where id = '${empresaId}';`;
  ejecutar(url, `
    select set_config('app.user_id', '${userId}', true), set_config('app.company_id', '${empresaId}', true);
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      values ('${documento}', '${empresaId}', 'prueba/constancia', '${"a".repeat(64)}', 'application/pdf', 'Constancia.pdf', now());
    insert into suppliers (id, company_id, document_id, rfc, razon_social, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito)
      values ('${proveedorId}', '${empresaId}', '${documento}', '${rfc}', '${nombre}, S.A. de C.V.', now(), false, now(), '${nombre}', 30);
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, id, 'miembro', '${userId}', 'cliente', 'alta_proveedor', 'suppliers', '${proveedorId}' from companies where id = '${empresaId}';
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde)
      values ('${clabeId}', '${empresaId}', '${proveedorId}', '${CLABE}', true, now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador)
      select operator_id, id, 'miembro', '${userId}', 'cliente', 'clabe_proveedor', 'supplier_clabes', '${clabeId}' from companies where id = '${empresaId}';
    ${area}
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      values ('${id}', '${empresaId}', '${proveedorId}', 'cfdi', '${uuid}', 'A', '${folio}', 'A-${folio}', ${total}, '2026-11-01', '2026-11-15', '${programada}', '${userId}', now(), now());
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, id, 'miembro', '${userId}', 'cliente', 'crear_cargo_proveedor', 'supplier_payables', '${id}', '{"origen":"cfdi","total_centavos":${total}}' from companies where id = '${empresaId}';
  `);
  return { id, proveedorId };
}

/** Otro cargo del mismo proveedor que `base`, sin triggers ni eventos: solo para probar la lectura. */
function sembrarCargoSinEventos(url: string, base: string, programada: string, total: number): void {
  ejecutar(url, `
    set session_replication_role = replica;
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      select gen_random_uuid(), company_id, supplier_id, 'cfdi', upper(gen_random_uuid()::text), 'A', f.folio, 'A-' || f.folio, ${total}, '2026-10-01', '2026-10-15', '${programada}', creado_por, now(), now()
        from supplier_payables, lateral (select (floor(random() * 900000) + 100000)::int::text as folio) f
       where id = '${base}';
  `);
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
