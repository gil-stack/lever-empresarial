import { createHash, randomUUID } from "node:crypto";

import { desplazar } from "../../src/dominio/flujo/fechas";
import { hoyEnMexico } from "../../src/dominio/personas";
import type { ContextoConEmpresa } from "../../src/nucleo/contexto";
import { cifrarSemilla, llaveDesde } from "../../src/server/autenticacion/cifrado";
import { repositorioPg } from "../../src/server/autenticacion/repositorio";
import { aBase32, pasoDe, semillaNueva } from "../../src/server/autenticacion/totp";
import { darDeAltaEmpresa } from "../../src/server/company/servicio";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio";
import { contextoDePersonal, invitarAdministrador, migrarPersonalDeVariable } from "../../src/server/plataforma/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import { ejecutar } from "../aislamiento/postgres";

/**
 * Siembra de los recorridos nuevos (flujo de caja, nómina, entrada, Operación,
 * invitación y roles). Empresas, personas, nómina, áreas e invitaciones pasan
 * por los servicios de la aplicación, con su bitácora. El proveedor y su cargo
 * autorizado se escriben como dueña en una transacción con el evento que cada
 * trigger exige, como tests/e2e/seed-pagos.sql. Las semillas TOTP se guardan
 * con el repositorio de autenticación y la llave de la corrida: la prueba
 * genera los códigos como lo haría la app autenticadora.
 *
 * Deja en el entorno E2E_ALTAMAR_ID, E2E_BAHIA_ID y E2E_SEMILLAS para los specs.
 */

const CLAVE = "clave-segura-12";
const CLABE = "002180701150123452";

export const CORREOS = {
  laura: "laura@altamar-e2e.mx",
  rosa: "rosa@altamar-e2e.mx",
  lucia: "lucia@altamar-e2e.mx",
  diego: "diego@altamar-e2e.mx",
  fernanda: "fernanda@altamar-e2e.mx",
  sol: "sol@altamar-e2e.mx",
  ernesto: "ernesto@altamar-e2e.mx",
  entrada: "entrada@altamar-e2e.mx",
  tope: "tope@altamar-e2e.mx",
  perdida: "perdida@altamar-e2e.mx",
  marina: "marina@arrecife-e2e.mx",
  op1: "op1@lever-e2e.mx",
  op2: "op2@lever-e2e.mx",
} as const;

export async function sembrarRecorridos(owner: string): Promise<void> {
  const llave = llaveDesde(process.env.AUTENTICACION_LLAVE_TOTP);
  if (!llave) throw new Error("Falta AUTENTICACION_LLAVE_TOTP para sembrar los factores.");
  const hoy = hoyEnMexico(new Date());
  const personal = await contextoDePersonal("personal-e2e@ejemplo.mx");
  const semillas: Record<string, string> = {};

  async function sesionDe(userId: string, empresaId: string): Promise<ContextoConEmpresa> {
    const token = `S${randomUUID().replace(/-/g, "")}AAAAAAAAAA`.slice(0, 43);
    const entrada = randomUUID();
    ejecutar(owner, `
      insert into auth_entradas (id, user_id, token_hash, creada_en, vence_en, verificada_con, verificada_en, consumida_en)
        values ('${entrada}', '${userId}', '${createHash("sha256").update(entrada).digest("hex")}', now(), now() + interval '10 minutes', 'totp', now(), now());
      insert into sessions (id, user_id, token_hash, expires_at, segundo_factor, entrada_id)
        values ('${randomUUID()}', '${userId}', '${createHash("sha256").update(token).digest("hex")}', now() + interval '1 hour', 'totp', '${entrada}');`);
    const sesion = await leerSesion(`sesion=${token}`);
    if (!sesion?.segundoFactor) throw new Error("La sesión de siembra no quedó abierta.");
    return (await resolverContexto({ sesion, empresaPedida: empresaId, peticionId: null, superficie: "cliente" })).ctx as ContextoConEmpresa;
  }

  /** Una app autenticadora ya confirmada, con el último paso usado dos pasos atrás. */
  async function factor(correo: string, userId: string): Promise<void> {
    const semilla = semillaNueva();
    const totpId = randomUUID();
    const repo = repositorioPg();
    await repo.guardarTotpPendiente({ id: totpId, userId, secretoCifrado: cifrarSemilla(semilla, userId, llave!), creadoEn: new Date() });
    await repo.confirmarTotp({ userId, totpId, paso: pasoDe(new Date()) - 2, ahora: new Date() });
    semillas[correo] = aBase32(semilla);
  }

  async function persona(admin: ContextoConEmpresa, datos: Record<string, unknown> & { nombre: string }): Promise<string | null> {
    let token = "";
    await darDeAltaPersona(admin, {
      alta: `${hoy.slice(0, 7)}-01`, baja: "", jefeId: "", presupuesto: "", altaLlave: randomUUID(), clabe: CLABE, ...datos,
    }, {
      entregar: async (emitida) => {
        token = emitida.token;
        return { entregada: false, codigo: "correo_no_configurado" };
      },
    });
    if (!token) return null;
    return (await aceptarInvitacion({ token, contrasena: CLAVE, confirmacion: CLAVE })).userId;
  }

  // ---------- Altamar E2E: cliente real (no de demostración) ----------
  const altamar = await darDeAltaEmpresa(personal, {
    rfc: "AEE180312AB1", razonSocial: "Altamar E2E", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false });
  const invitada = await invitarAdministrador(personal, { companyId: altamar.id, razonSocial: altamar.razonSocial, nombre: "Laura Méndez", correo: CORREOS.laura });
  await aceptarInvitacion({ token: invitada.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  const lauraId = invitada.emitida.userId;
  await factor(CORREOS.laura, lauraId);
  const laura = await sesionDe(lauraId, altamar.id);

  const operacion = await nombrarCentro(laura, { nombre: "Operación", presupuesto: "90000.00" });
  // Sin nómina: su gasto del mes es solo lo que el recorrido registra (80 % y 100 % exactos).
  await nombrarCentro(laura, { nombre: "Mercadotecnia", presupuesto: "10000.00" });

  // Una sola persona en nómina: para quien no ve el detalle, su pago dice «Monto reservado».
  const dia = Number(hoy.slice(8, 10));
  const ultimo = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 0)).getUTCDate();
  const quincena = dia <= 15 ? `${hoy.slice(0, 7)}-15` : `${hoy.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
  await persona(laura, {
    nombre: "Ana Torres", centroId: operacion.id, neto: "10000.00", frecuencia: "quincenal", primerPago: quincena,
    destino: "clabe", acceso: "no", correo: "", rol: "",
  });

  const acceso = (nombre: string, correo: string, ...rol: string[]) => persona(laura, { nombre, centroId: operacion.id, nomina: "no", acceso: "nueva", correo, rol });
  const rosaId = await acceso("Rosa Liberadora", CORREOS.rosa, "liberador");
  // Autorizar un pago exige dos liberadores operativos en la empresa (0022).
  await acceso("Lucía Liberadora", CORREOS.lucia, "liberador");
  await acceso("Diego Contador", CORREOS.diego, "contador");
  // Finanzas no va sola: se suma a un rol de trabajo (finanzas_sin_rol).
  await acceso("Fernanda Finanzas", CORREOS.fernanda, "tarjetahabiente", "finanzas");
  // Solicitante ya no se ofrece en altas nuevas; las membresías que lo tienen lo conservan.
  // Aquí se le suma a una persona dada de alta como tarjetahabiente (el teléfono, lo único que
  // ese rol abre, también lo abre solicitante), como dueña y con su evento, igual que
  // tests/e2e/seed-pagos.sql: el servicio de roles lee su contrato con import.meta, que el
  // cargador de Playwright no admite.
  const solId = await acceso("Sol Solicitante", CORREOS.sol, "tarjetahabiente");
  if (!solId) throw new Error("Sol no quedó con acceso.");
  ejecutar(owner, `
    begin;
    select set_config('app.user_id', '${lauraId}', false), set_config('app.company_id', '${altamar.id}', false);
    insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador, cambio)
      select operator_id, id, 'miembro', '${lauraId}', 'cliente', 'asignar_rol', 'membership_roles', '${solId}', '{"rol":"solicitante"}'
      from companies where id = '${altamar.id}';
    insert into membership_roles (user_id, company_id, rol) values ('${solId}', '${altamar.id}', 'solicitante');
    commit;`);
  await acceso("Ernesto Tarjeta", CORREOS.ernesto, "tarjetahabiente");
  const entradaId = await acceso("Elena Entrada", CORREOS.entrada, "contador");
  await acceso("Tomás Tope", CORREOS.tope, "contador");
  const perdidaId = await acceso("Paula Perdida", CORREOS.perdida, "contador");
  if (!rosaId || !entradaId || !perdidaId) throw new Error("Una persona de la siembra no quedó con acceso.");
  await factor(CORREOS.entrada, entradaId);
  await factor(CORREOS.perdida, perdidaId);

  // Un proveedor con un cargo autorizado por otra persona: el pago que el escenario mueve de semana.
  const proveedor = randomUUID();
  const documento = randomUUID();
  const clabeProveedor = randomUUID();
  const lista = randomUUID();
  const cargo = randomUUID();
  const solicitud = randomUUID();
  const evento = (actor: string, accion: string, entidad: string, id: string, cambio?: unknown) =>
    `insert into audit_log (operator_id, company_id, actor_tipo, actor_id, superficie, accion, entidad, identificador${cambio ? ", cambio" : ""})
       select operator_id, id, 'miembro', '${actor}', 'cliente', '${accion}', '${entidad}', '${id}'${cambio ? `, '${JSON.stringify(cambio)}'` : ""}
       from companies where id = '${altamar.id}';`;
  ejecutar(owner, `
    begin;
    select set_config('app.user_id', '${lauraId}', false), set_config('app.company_id', '${altamar.id}', false);
    insert into lista_69b_snapshots (id, fecha_archivo, cargado_en) values ('${lista}', date '${desplazar(hoy, -7)}', now());
    insert into lista_69b_rows (snapshot_id, rfc, situacion) values ('${lista}', 'PAL7202161U0', 'Presunto');
    insert into audit_log (operator_id, actor_tipo, superficie, accion, entidad, identificador)
      values ((select id from operators order by alta_en limit 1), 'sistema', 'sistema', 'cargar_lista_69b', 'lista_69b_snapshots', '${lista}');
    insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
      values ('${documento}', '${altamar.id}', 'siembra/constancia-tno', '${createHash("sha256").update("tno").digest("hex")}', 'application/pdf', 'Constancia Transportes.pdf', now());
    insert into suppliers (id, company_id, document_id, snapshot_id, rfc, razon_social, lista_fecha, lista_leida_en, boton_pago, alta_en, nombre_comercial, dias_credito)
      values ('${proveedor}', '${altamar.id}', '${documento}', '${lista}', 'TNO010101AA1', 'Transportes del Norte', date '${desplazar(hoy, -7)}', now(), true, now(), 'Transportes del Norte', 30);
    ${evento(lauraId, "alta_proveedor", "suppliers", proveedor)}
    insert into supplier_clabes (id, company_id, supplier_id, clabe, digito_valido, vigente_desde) values ('${clabeProveedor}', '${altamar.id}', '${proveedor}', '${CLABE}', true, now());
    ${evento(lauraId, "clabe_proveedor", "supplier_clabes", clabeProveedor)}
    insert into supplier_payables (id, company_id, supplier_id, origen, cfdi_uuid, serie, folio, referencia, total_centavos, emitida_el, vence_el, programada_el, creado_por, creado_en, actualizado_en)
      values ('${cargo}', '${altamar.id}', '${proveedor}', 'cfdi', '${randomUUID().toUpperCase()}', 'TN', '501', 'TN-501', 2500000,
              date '${desplazar(hoy, -20)}', date '${desplazar(hoy, 9)}', date '${desplazar(hoy, 6)}', '${lauraId}', now(), now());
    ${evento(lauraId, "crear_cargo_proveedor", "supplier_payables", cargo, { origen: "cfdi", total_centavos: 2500000 })}
    insert into supplier_payment_requests (id, company_id, payable_id, supplier_clabe_id, clabe, total_centavos, programada_el, solicitado_por, solicitado_en, creado_en)
      values ('${solicitud}', '${altamar.id}', '${cargo}', '${clabeProveedor}', '${CLABE}', 2500000, date '${desplazar(hoy, 6)}', '${lauraId}', now(), now());
    ${evento(lauraId, "solicitar_pago_proveedor", "supplier_payment_requests", solicitud, { total_centavos: 2500000 })}
    select set_config('app.user_id', '${rosaId}', false);
    update supplier_payment_requests set estado = 'listo_para_pagar', resuelto_por = '${rosaId}', resuelto_en = now() where id = '${solicitud}';
    ${evento(rosaId, "autorizar_pago_proveedor", "supplier_payment_requests", solicitud)}
    commit;`);

  // ---------- Bahía E2E: empresa activa sin administrador, para la invitación desde Operación ----------
  const bahia = await darDeAltaEmpresa(personal, {
    rfc: "BEE190101CD2", razonSocial: "Bahía E2E", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false });

  // ---------- Arrecife E2E: empresa real recién dada de alta, solo con su administradora ----------
  // Sin áreas, categorías ni proveedores: aprobaciones.spec ve cómo cada pendiente de puesta
  // en marcha sale de Aprobaciones al resolverlo en su módulo. Ningún otro spec la usa.
  const arrecife = await darDeAltaEmpresa(personal, {
    rfc: "AEE200202EF3", razonSocial: "Arrecife E2E", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false });
  const marina = await invitarAdministrador(personal, { companyId: arrecife.id, razonSocial: arrecife.razonSocial, nombre: "Marina Ríos", correo: CORREOS.marina });
  await aceptarInvitacion({ token: marina.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  // Rosa de Taller del Cierre (seed-pagos.sql) con app autenticadora: aprobaciones.spec escribe su código al decidir
  // sin JavaScript con el segundo factor vencido.
  await factor("rosa-pagos@ejemplo.mx", "22222222-2222-4222-8222-222222222222");
  await factor(CORREOS.marina, marina.emitida.userId);

  // ---------- Personal SOFIPO con contraseña y app autenticadora ----------
  for (const correo of [CORREOS.op1, CORREOS.op2]) {
    const [migrada] = await migrarPersonalDeVariable([correo]);
    if (!migrada?.invitacion) throw new Error(`${correo} no quedó invitado como personal.`);
    const { userId } = await aceptarInvitacion({ token: migrada.invitacion.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
    await factor(correo, userId);
  }

  process.env.E2E_ALTAMAR_ID = altamar.id;
  process.env.E2E_BAHIA_ID = bahia.id;
  process.env.E2E_ARRECIFE_ID = arrecife.id;
  process.env.E2E_SEMILLAS = JSON.stringify(semillas);
}
