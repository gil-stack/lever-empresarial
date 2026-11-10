import { createHash, randomUUID } from "node:crypto";

import { desplazar } from "../../src/dominio/flujo/fechas";
import { hoyEnMexico } from "../../src/dominio/personas";
import type { ContextoConEmpresa, ContextoDePersonal } from "../../src/nucleo/contexto";
import { cifrarSemilla, llaveDesde } from "../../src/server/autenticacion/cifrado";
import { repositorioPg } from "../../src/server/autenticacion/repositorio";
import { aBase32, pasoDe, semillaNueva } from "../../src/server/autenticacion/totp";
import { aceptarInvitacion } from "../../src/server/invitaciones/servicio";
import { solicitarActivacion } from "../../src/server/operacion/activaciones";
import { registrarProspecto } from "../../src/server/operacion/clientes";
import { calificarRiesgoEmpresa, crearVersion, enviarVersion } from "../../src/server/operacion/expediente";
import { cargarListaBloqueadas } from "../../src/server/operacion/lpb";
import { cambiarRolPersonal } from "../../src/server/operacion/personal";
import { darDeAltaPersona, nombrarCentro } from "../../src/server/personas/servicio";
import { contextoDePersonal, invitarAdministrador } from "../../src/server/plataforma/servicio";
import { leerSesion } from "../../src/server/session/servicio";
import { resolverContexto } from "../../src/server/tenencia/resolver";
import { darDeAltaComoDuena } from "../../scripts/empresa-por-la-duena";
import { ejecutar } from "../aislamiento/postgres";
import { armarBorrador, expedienteEnRegla, SESION_SOFIPO } from "../operacion/apoyo-alta-regulada";

/**
 * Siembra de los recorridos nuevos (flujo de caja, nómina, entrada, Operación,
 * invitación y roles). Empresas, personas, nómina, áreas e invitaciones pasan
 * por los servicios de la aplicación, con su bitácora. El proveedor y su cargo
 * autorizado se escriben como dueña en una transacción con el evento que cada
 * trigger exige, como tests/e2e/seed-pagos.sql. Las semillas TOTP se guardan
 * con el repositorio de autenticación y la llave de la corrida: la prueba
 * genera los códigos como lo haría la app autenticadora.
 *
 * El personal SOFIPO recibe los roles de la 0028 por el servicio de la pantalla
 * Personal (una persona se los da a otra, con su evento): op1 registra
 * prospectos y pide activaciones (Originación), op2 las decide (Aprobación) y
 * op3 dictamina expedientes (Cumplimiento). Faro E2E queda en alta con su
 * expediente aprobado, riesgo vigente y la activación pedida por op1: lo que
 * exige el candado de la base para que op2 la apruebe.
 *
 * Deja en el entorno E2E_ALTAMAR_ID, E2E_BAHIA_ID, E2E_ARRECIFE_ID, E2E_FARO_ID y E2E_SEMILLAS para los specs.
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
  op3: "op3@lever-e2e.mx",
} as const;

/** La empresa en alta con todo en regla que op2 aprueba en operacion.spec.ts. */
export const FARO = { razonSocial: "Faro E2E", rfc: "FEE170505CD4" } as const;
/** En alta con la activación pedida y un caso abierto de Cumplimiento: Aprobación no la activa. */
export const BRISA = { razonSocial: "Brisa E2E", rfc: "BRE180303CD6" } as const;
/** Activa y suspendida por una carga de la lista: Originación no la reactiva. */
export const CIMA = { razonSocial: "Cima E2E", rfc: "CIE160606CD7" } as const;
/** Prospecto con el borrador abierto: Originación captura socios extranjeros. */
export const DUNA = { razonSocial: "Duna E2E", rfc: "DUE190404CD8" } as const;
/** Prospectos con la versión 1 enviada y sin dictamen: la doceava revisión dictamina y califica desde la pantalla, con JavaScript (Eje) y sin él (Enebro). */
export const EJE = { razonSocial: "Eje E2E", rfc: "EJE170707CD5" } as const;
export const ENEBRO = { razonSocial: "Enebro E2E", rfc: "ENE170808CD6" } as const;
/** También por dictaminar: otra pestaña registra el dictamen antes que la primera, con JavaScript (Fresno) y sin él (Granado). */
export const FRESNO = { razonSocial: "Fresno E2E", rfc: "FRE180909CD7" } as const;
export const GRANADO = { razonSocial: "Granado E2E", rfc: "GRA181010CD8" } as const;
/** Por dictaminar: sin JavaScript se llega a su dictamen por el enlace de Cumplimiento (`#dictamen-titulo`). */
export const HIGUERA = { razonSocial: "Higuera E2E", rfc: "HIG191111CD9" } as const;

export async function sembrarRecorridos(
  owner: string,
  arranque: ReadonlyArray<{ correo: string; invitacion?: { emitida: { token: string } } }>,
): Promise<void> {
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
  const altamar = await darDeAltaComoDuena(owner, personal, {
    rfc: "AEE180312AB1", razonSocial: "Altamar E2E", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
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
    insert into lista_69b_snapshots (id, operator_id, fecha_archivo, cargado_en) select '${lista}', operator_id, date '${desplazar(hoy, -7)}', now() from companies where id = '${altamar.id}';
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
  const bahia = await darDeAltaComoDuena(owner, personal, {
    rfc: "BEE190101CD2", razonSocial: "Bahía E2E", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });

  // ---------- Arrecife E2E: empresa real recién dada de alta, solo con su administradora ----------
  // Sin áreas, categorías ni proveedores: aprobaciones.spec ve cómo cada pendiente de puesta
  // en marcha sale de Aprobaciones al resolverlo en su módulo. Ningún otro spec la usa.
  const arrecife = await darDeAltaComoDuena(owner, personal, {
    rfc: "AEE200202EF3", razonSocial: "Arrecife E2E", codigoPostal: "06600", regimen: "601", usoCfdi: "G03",
  }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  const marina = await invitarAdministrador(personal, { companyId: arrecife.id, razonSocial: arrecife.razonSocial, nombre: "Marina Ríos", correo: CORREOS.marina });
  await aceptarInvitacion({ token: marina.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
  // Rosa de Taller del Cierre (seed-pagos.sql) con app autenticadora: aprobaciones.spec escribe su código al decidir
  // sin JavaScript con el segundo factor vencido.
  await factor("rosa-pagos@ejemplo.mx", "22222222-2222-4222-8222-222222222222");
  await factor(CORREOS.marina, marina.emitida.userId);

  // ---------- Personal SOFIPO con contraseña y app autenticadora ----------
  // Invitados en el arranque del operador (entorno.ts): aceptan y registran su app autenticadora.
  const ids: Record<string, string> = {};
  for (const correo of [CORREOS.op1, CORREOS.op2, CORREOS.op3]) {
    const invitacion = arranque.find((fila) => fila.correo === correo)?.invitacion;
    if (!invitacion) throw new Error(`${correo} no quedó invitado como personal.`);
    const { userId } = await aceptarInvitacion({ token: invitacion.emitida.token, contrasena: CLAVE, confirmacion: CLAVE });
    ids[correo] = userId;
    await factor(correo, userId);
  }
  // Roles de la 0028 por el servicio de la pantalla Personal: nadie se da un rol a sí mismo.
  const comoPersonal = async (correo: string) => (await contextoDePersonal(correo)) as ContextoDePersonal;
  const darRol = async (quien: string, a: string, rol: "originacion" | "aprobacion" | "cumplimiento") =>
    cambiarRolPersonal(await comoPersonal(quien), SESION_SOFIPO, { userId: ids[a], rol, quitar: false });
  await darRol(CORREOS.op2, CORREOS.op1, "originacion");
  await darRol(CORREOS.op1, CORREOS.op2, "aprobacion");
  await darRol(CORREOS.op1, CORREOS.op3, "cumplimiento");

  // ---------- Faro E2E: en alta con expediente aprobado, riesgo vigente y activación pedida ----------
  // Los documentos del expediente van a un almacén en memoria: la siembra corre antes del emulador
  // de Blob y ningún recorrido los descarga.
  const origina = await comoPersonal(CORREOS.op1);
  const faro = await registrarProspecto(origina, { ...FARO, codigoPostal: "64000", regimen: "601", usoCfdi: "G03" });
  await expedienteEnRegla(origina, await comoPersonal(CORREOS.op3), { companyId: faro, ...FARO });
  await solicitarActivacion(origina, faro);

  // ---------- Brisa y Cima E2E: un caso abierto de Cumplimiento ----------
  // Una carga de la lista con las dos deja el caso abierto en Brisa (en alta, con la activación
  // pedida) y suspende a Cima (activa). Originación y Aprobación lo ven sin que se nombre la lista.
  const cumple = await comoPersonal(CORREOS.op3);
  const brisa = await registrarProspecto(origina, { ...BRISA, codigoPostal: "64000", regimen: "601", usoCfdi: "G03" });
  await expedienteEnRegla(origina, cumple, { companyId: brisa, ...BRISA });
  await solicitarActivacion(origina, brisa);
  await darDeAltaComoDuena(owner, personal, { ...CIMA, codigoPostal: "06600", regimen: "601", usoCfdi: "G03" }, { demostracion: false, corridoPor: "pruebas@ejemplo.mx" });
  await cargarListaBloqueadas(cumple, {
    formId: randomUUID(),
    nombreArchivo: "lpb-e2e.csv",
    texto: ["nombre,rfc,curp,tipo,fecha", `${BRISA.razonSocial},${BRISA.rfc},,moral,${hoy}`, `${CIMA.razonSocial},${CIMA.rfc},,moral,${hoy}`].join("\n"),
  });
  // La revisión periódica de Brisa con el caso abierto: el grado sale alto por la coincidencia exacta.
  await calificarRiesgoEmpresa(cumple, { companyId: brisa, formId: randomUUID(), actividad: "baja", zona: "baja" });

  // ---------- Duna E2E: prospecto con el borrador del expediente abierto ----------
  const duna = await registrarProspecto(origina, { ...DUNA, codigoPostal: "64000", regimen: "601", usoCfdi: "G03" });
  await crearVersion(origina, { companyId: duna, formId: randomUUID() });

  // ---------- Eje, Enebro, Fresno y Granado E2E: la versión 1 enviada por Originación espera el dictamen de Cumplimiento ----------
  for (const empresa of [EJE, ENEBRO, FRESNO, GRANADO, HIGUERA]) {
    const companyId = await registrarProspecto(origina, { ...empresa, codigoPostal: "64000", regimen: "601", usoCfdi: "G03" });
    const { versionId } = await armarBorrador(origina, { companyId, ...empresa });
    await enviarVersion(origina, versionId);
  }

  process.env.E2E_ALTAMAR_ID = altamar.id;
  process.env.E2E_BAHIA_ID = bahia.id;
  process.env.E2E_ARRECIFE_ID = arrecife.id;
  process.env.E2E_FARO_ID = faro;
  process.env.E2E_SEMILLAS = JSON.stringify(semillas);
}
