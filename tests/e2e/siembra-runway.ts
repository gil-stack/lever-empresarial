import { createHash, randomUUID } from "node:crypto";

import { hoyEnMexico } from "../../src/dominio/personas";
import type { ContextoConEmpresa } from "../../src/nucleo/contexto";
import { capturarMontoVariable, configurarCobranza, darDeAltaCliente, type DependenciasCobranza } from "../../src/server/cobranza/servicio";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena";
import { declararSaldo, marcarCobrado, registrarCobro, registrarObligacion } from "../../src/server/flujo/servicio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import type { Sesion } from "../../src/server/session/tipos";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import { consultarJson, ejecutar } from "../aislamiento/postgres";

/**
 * Siembra de la e2e del runway: tres empresas propias para no mover los totales
 * de Altamar ni de Cobranza.
 *
 * - «Runway E2E» (real): saldo declarado ayer de $400,000.00 y cada tipo de
 *   movimiento: nómina mensual de dos personas, un pago a proveedor sin
 *   solicitud, la renta, un cobro esperado, uno ya cobrado hoy, un plan de
 *   cobranza fijo (su primer cargo emitido), un variable con un cargo capturado
 *   y otro variable sin historial. Rita administra, Fabio es de finanzas, Cora
 *   es contadora (no recibe avisos si no los enciende) y Tito, tarjetahabiente
 *   (no ve el flujo).
 * - «Sin Saldo Runway E2E» (real): sin saldo declarado.
 * - «Demo Runway E2E» (demostración): saldo y renta; su tendencia es de ejemplo.
 *
 * Todo pasa por los servicios con su bitácora, salvo el proveedor y su cargo,
 * que se escriben como dueña con el evento que cada trigger exige (como
 * tests/e2e/siembra.ts). Ningún correo sale: el enviador de la siembra es falso.
 *
 * Deja en el entorno E2E_RUNWAY_ID, E2E_RUNWAY_SIN_SALDO_ID y E2E_RUNWAY_DEMO_ID.
 */

const CLAVE = "clave-segura-12";
const CLABE = "002180701150123452";

export const CORREOS_RUNWAY = {
  rita: "rita-runway@ejemplo.mx",
  fabio: "fabio-runway@ejemplo.mx",
  cora: "cora-runway@ejemplo.mx",
  tito: "tito-runway@ejemplo.mx",
  sergio: "sergio-sin-saldo@ejemplo.mx",
  dora: "dora-demo-runway@ejemplo.mx",
} as const;

function desplazar(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function sembrarRunway(owner: string): Promise<void> {
  const hoy = hoyEnMexico(new Date());
  const ayer = desplazar(hoy, -1);
  const personal = await contextoDePersonal("personal-e2e@ejemplo.mx");

  async function sesionDe(userId: string, empresaId: string): Promise<[ContextoConEmpresa, Sesion]> {
    const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
    const entrada = randomUUID();
    ejecutar(owner, `
      insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
        values ('${entrada}', '${userId}', '${createHash("sha256").update(entrada).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
      insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
        values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '1 hour', 'totp', '${entrada}');`);
    const sesion = await leerSesion(`sesion=${token}`);
    if (!sesion?.segundoFactor) throw new Error("La sesión de siembra no quedó abierta.");
    return [(await resolverContexto({ sesion, empresaPedida: empresaId, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa, sesion];
  }

  async function empresa(rfc: string, razonSocial: string, demostracion: boolean, nombre: string, correo: string): Promise<[string, ContextoConEmpresa, Sesion]> {
    const alta = await darDeAltaComoDuena(owner, personal, { rfc, razonSocial, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion, corridoPor: "pruebas@ejemplo.mx" });
    const invitada = await invitarAdministrador(personal, { companyId: alta.id, razonSocial: alta.razonSocial, nombre, correo });
    await aceptarInvitacion({ token: invitada.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
    const [ctx, sesion] = await sesionDe(invitada.emitida.userId, alta.id);
    return [alta.id, ctx, sesion];
  }

  async function persona(admin: ContextoConEmpresa, datos: Record<string, unknown> & { nombre: string }): Promise<void> {
    let token = "";
    await darDeAltaPersona(admin, {
      alta: `${hoy.slice(0, 7)}-01`, baja: "", jefeId: "", presupuesto: "", altaLlave: randomUUID(), clabe: CLABE, ...datos,
    }, {
      entregar: async (emitida) => {
        token = emitida.token;
        return { entregada: false, codigo: "correo_no_configurado" };
      },
    });
    if (token) await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE });
  }

  // ---------- Runway E2E ----------
  const [runwayId, rita, sesionRita] = await empresa("RUE200101AB1", "Runway E2E", false, "Rita Runway", CORREOS_RUNWAY.rita);
  const area = await nombrarCentro(rita, { nombre: "Operación", presupuesto: "" });
  const pago = desplazar(hoy, 5);
  for (const nombre of ["Nora Nómina", "Noé Nómina"]) {
    await persona(rita, { nombre, centroId: area.id, neto: "40000.00", frecuencia: "mensual", primerPago: pago, destino: "clabe", acceso: "no", correo: "", rol: "" });
  }
  await persona(rita, { nombre: "Fabio Finanzas", centroId: area.id, nomina: "no", acceso: "nueva", correo: CORREOS_RUNWAY.fabio, rol: ["tarjetahabiente", "finanzas"] });
  await persona(rita, { nombre: "Cora Contadora", centroId: area.id, nomina: "no", acceso: "nueva", correo: CORREOS_RUNWAY.cora, rol: ["contador"] });
  await persona(rita, { nombre: "Tito Tarjeta", centroId: area.id, nomina: "no", acceso: "nueva", correo: CORREOS_RUNWAY.tito, rol: ["tarjetahabiente"] });

  await declararSaldo(rita, { saldo: "400000.00", alDia: ayer, altaId: randomUUID() });
  await registrarObligacion(rita, { concepto: "Renta de oficina", monto: "30000.00", frecuencia: "mensual", proximaFecha: desplazar(hoy, 8), altaId: randomUUID() });
  await registrarCobro(rita, { clienteNombre: "Cliente Esperado", concepto: "Proyecto", monto: "60000.00", fechaProbable: desplazar(hoy, 25), altaId: randomUUID() });
  const cobrado = await registrarCobro(rita, { clienteNombre: "Cliente Puntual", concepto: "Anticipo", monto: "10000.00", fechaProbable: desplazar(hoy, 2), altaId: randomUUID() });
  await marcarCobrado(rita, { id: cobrado.id, cobradoEl: hoy });

  // Proveedor y su cargo sin solicitud, como dueña y con sus eventos (la lista 69-B es la que ya sembró Altamar).
  const ritaId = rita.persona.id;
  const proveedor = randomUUID();
  const documento = randomUUID();
  const cargo = randomUUID();
  const clabeProveedor = randomUUID();
  const evento = (accion: string, entidad: string, id: string, cambio?: unknown) =>
    `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador${cambio ? ", cambio" : ""})
       select operator_id, id, 'miembro', '${ritaId}', 'cliente', '${accion}', '${entidad}', '${id}'${cambio ? `, '${JSON.stringify(cambio)}'` : ""}
       from companies where id = '${runwayId}';`;
  ejecutar(owner, `
    begin;
    select set_config('app.user_id', '${ritaId}', false), set_config('app.company_id', '${runwayId}', false);
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      values ('${documento}', '${runwayId}', 'siembra/constancia-runway', '${createHash("sha256").update("runway").digest("hex")}', 'application/pdf', 'Constancia Insumos.pdf', now());
    insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito)
      select '${proveedor}', '${runwayId}', '${documento}', s.id, 'INS010101AA1', 'Insumos del Bajío', s.fecha_archivo, now(), true, now(), 'Insumos del Bajío', 30
        from lista_69b_snapshots s order by s.fecha_archivo desc limit 1;
    ${evento("alta_proveedor", "suppliers", proveedor)}
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde) values ('${clabeProveedor}', '${runwayId}', '${proveedor}', '${CLABE}', true, now());
    ${evento("clabe_proveedor", "supplier_clabes", clabeProveedor)}
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      values ('${cargo}', '${runwayId}', '${proveedor}', 'cfdi', '${randomUUID().toUpperCase()}', 'IB', '77', 'IB-77', 5000000,
              date '${desplazar(hoy, -5)}', date '${desplazar(hoy, 25)}', date '${desplazar(hoy, 20)}', '${ritaId}', now(), now());
    ${evento("crear_cargo_proveedor", "supplier_payables", cargo, { origen: "cfdi", total_centavos: 5000000 })}
    commit;`);

  // Cobranza: un plan fijo (su primer cargo sale al darlo de alta), un variable con un monto capturado y otro sin historial.
  const cobranza: DependenciasCobranza = {
    urlPublica: () => "https://lever.ejemplo.mx",
    enviador: () => async () => ({ id: randomUUID() }),
    fintoc: null,
    registrar: () => {},
  };
  await configurarCobranza(rita, {
    clabe: CLABE, beneficiario: "Runway E2E SA de CV", correoContacto: "cobranza-runway@ejemplo.mx",
    emitirDiasAntes: "5", antesDias: "3", avisoElDia: "si", despuesCadaDias: "7", despuesTope: "3", envioAutomatico: "no",
  }, sesionRita, cobranza);
  const alta = { rfc: "", correos: "cliente-runway@ejemplo.mx", concepto: "Servicio mensual", periodicidad: "mensual", fin: "" };
  await darDeAltaCliente(rita, { ...alta, nombre: "Plan Fijo SA", tipo: "fijo", monto: "25000.00", primerVencimiento: desplazar(hoy, 3), altaId: randomUUID() }, cobranza);
  const variable = await darDeAltaCliente(rita, { ...alta, nombre: "Plan Variable SA", tipo: "variable", monto: "", primerVencimiento: desplazar(hoy, 4), altaId: randomUUID() }, cobranza);
  const [porEmitir] = consultarJson<{ id: string }[]>(owner, `select json_agg(json_build_object('id', id)) from collection_charges where customer_id = '${variable.clienteId}' and estado = 'por_emitir'`);
  if (!porEmitir) throw new Error("El plan variable no generó su primer cargo.");
  await capturarMontoVariable(rita, { cargoId: porEmitir.id, monto: "18000.00" }, cobranza);
  await darDeAltaCliente(rita, { ...alta, nombre: "Plan Nuevo SA", tipo: "variable", monto: "", primerVencimiento: desplazar(hoy, 40), altaId: randomUUID() }, cobranza);

  // ---------- Sin Saldo Runway E2E ----------
  const [sinSaldoId] = await empresa("SSR200101AB2", "Sin Saldo Runway E2E", false, "Sergio Sin Saldo", CORREOS_RUNWAY.sergio);

  // ---------- Demo Runway E2E ----------
  const [demoId, dora] = await empresa("DRE200101AB3", "Demo Runway E2E", true, "Dora Demo", CORREOS_RUNWAY.dora);
  await declararSaldo(dora, { saldo: "250000.00", alDia: ayer, altaId: randomUUID() });
  await registrarObligacion(dora, { concepto: "Renta de bodega", monto: "100000.00", frecuencia: "mensual", proximaFecha: desplazar(hoy, 10), altaId: randomUUID() });

  process.env.E2E_RUNWAY_ID = runwayId;
  process.env.E2E_RUNWAY_SIN_SALDO_ID = sinSaldoId;
  process.env.E2E_RUNWAY_DEMO_ID = demoId;
}
