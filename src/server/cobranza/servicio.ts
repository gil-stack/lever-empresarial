import { createHash, randomUUID } from "node:crypto";

import { calendario as calendarioDelPlan, esPeriodicidad, type Periodicidad } from "../../dominio/cobranza/periodos";
import { textoCalendario } from "../../dominio/cobranza/recordatorios";
import {
  validarAlta,
  validarCargoUnico,
  validarClienteEditado,
  validarComprobante,
  validarConfiguracion,
  validarMontoVariable,
  validarPagoManual,
  validarPlanEditado,
  validarPlanNuevo,
} from "../../dominio/cobranza/entradas";
import { abonoDemo, aplicar, clienteSinDuda, fuenteDemo, pagosParecidosDeOtraFuente, recibirAbono, type VarianteDemo } from "./abonos";
import { uuidValido, validarMotivo, type ErrorFlujo } from "../../dominio/flujo/entradas";
import { hoyEnMexico } from "../../dominio/personas";
import { baseCliente, exigir, puede, type ContextoConEmpresa, type ContextoDeTenant } from "../../nucleo/contexto";
import { aplicarSentencia, bloquearEmpresa, conContexto, type Consulta } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { exigirAutenticacionRecienteCliente } from "../autenticacion/reautenticacion";
import { actorDeCliente, auditar as auditarPorDefecto, type Actor, type Auditar } from "../bitacora/auditar";
import { leerUrlPublica } from "../correo/configuracion";
import { enviadorDesdeEntorno } from "../correo/enviar";
import { plantillaAvisoClabeCobranza, plantillaAvisoDatosCobranza } from "../correo/plantillas/cobro";
import type { Enviador } from "../correo/tipos";
import { centavos, entero, registro, texto, textoONulo } from "../flujo/lectura";
import { ErrorDeCaptura } from "../flujo/servicio";
import { almacenVercel, leerPrivado, type AlmacenConstancia } from "../proveedores/constancia";
import type { Sesion } from "../session/tipos";
import { generarCargos, ultimoConsecutivo, type CargoGenerado } from "./comun";
import { enviarCorreoDeCargo, ESPERA_REENVIO_MIN, REENVIOS, registrarPorDefecto, type PasoCorreo, type ResultadoCorreo } from "./correo";
import { asegurarClabeDeCliente, clienteHttpFintoc, configFintoc, type ClienteFintoc } from "./fintoc";
import { referenciaDe } from "../../dominio/cobranza/referencia";
import {
  FILTROS_ESTADO,
  leerCargos,
  leerCargosAbiertos,
  leerCliente,
  leerClientes,
  leerConfiguracion,
  leerPagos,
  leerResumen,
  type ConfiguracionCobranza,
  type DetalleCliente,
  type FilaCargo,
  type FiltrosCargos,
  type ClienteVista,
  type PagoVista,
  type ResumenCobranza,
} from "./repositorio";
import { CUBETAS, rangoDeCubeta, type Cubeta } from "../../dominio/cobranza/antiguedad";

/**
 * Escrituras y vistas de la cobranza desde la consola. Toda escritura exige
 * `cliente.flujo.editar` (administración y finanzas) y la base lo vuelve a
 * exigir con `flujo_editor`. Los correos y la CLABE propia del proveedor se
 * piden después de confirmar la transacción: un correo nunca sale de una
 * escritura que se deshizo.
 */

export type DependenciasCobranza = {
  ahora?: () => Date;
  auditar?: Auditar;
  enviador?: () => Enviador;
  urlPublica?: () => string;
  /** null: sin proveedor SPEI. Sin definir: el de las llaves del entorno, si están. */
  fintoc?: ClienteFintoc | null;
  almacen?: AlmacenConstancia;
  registrar?: (campos: Readonly<Record<string, string | number>>) => void;
};

export { ErrorDeCaptura };

function hoyDe(deps?: DependenciasCobranza): string {
  return hoyEnMexico((deps?.ahora ?? (() => new Date()))());
}

function auditarDe(deps?: DependenciasCobranza): Auditar {
  return deps?.auditar ?? auditarPorDefecto;
}

export function pasoDeCorreo(deps?: DependenciasCobranza): PasoCorreo {
  return {
    enviador: deps?.enviador ?? (() => enviadorDesdeEntorno()),
    urlPublica: deps?.urlPublica ?? (() => leerUrlPublica()),
    auditar: auditarDe(deps),
    registrar: deps?.registrar ?? registrarPorDefecto,
  };
}

export function fintocDe(deps?: DependenciasCobranza): ClienteFintoc | null {
  if (deps?.fintoc !== undefined) return deps.fintoc;
  const config = configFintoc();
  return config ? clienteHttpFintoc(config) : null;
}

function exigirValido<T>(resultado: { ok: true; valor: T } | { ok: false; errores: ErrorFlujo[] }): T {
  if (!resultado.ok) throw new ErrorDeCaptura(resultado.errores);
  return resultado.valor;
}

function exigirId(valor: unknown, codigo = "entrada_invalida"): string {
  if (!uuidValido(valor)) throw new ErrorDeDominio(codigo);
  return valor.toLowerCase();
}

function escribir<T>(
  ctx: ContextoDeTenant | null | undefined,
  deps: DependenciasCobranza | undefined,
  fn: (consulta: Consulta, c: ContextoConEmpresa, actor: Actor, auditar: Auditar, hoy: string) => Promise<T>,
): Promise<T> {
  const c = exigir(ctx, "cliente.flujo.editar");
  return conContexto(baseCliente(c), async (consulta) => {
    await bloquearEmpresa(consulta, c.empresa.id);
    return fn(consulta, c, actorDeCliente(c), auditarDe(deps), hoyDe(deps));
  });
}

const enmascarar = (clabe: string) => `•••• ${clabe.slice(-4)}`;

// Configuración --------------------------------------------------------------------------

export type ResultadoConfiguracion = { clabeCambio: boolean; avisos: number };

/**
 * La CLABE donde la empresa recibe, su beneficiario y el correo de contacto (el
 * Reply-To de cada cobro: a donde los clientes preguntan «¿a qué cuenta
 * pago?»). Cambiar cualquiera de los tres (o fijarlos la primera vez) exige un
 * segundo factor reciente y avisa a administración y finanzas: es el blanco
 * clásico para desviar pagos (r63-N3). El calendario de recordatorios no.
 */
export async function configurarCobranza(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  deps?: DependenciasCobranza,
): Promise<ResultadoConfiguracion> {
  const valor = exigirValido(validarConfiguracion(entrada));
  // El segundo factor se mide contra la hora real, no contra el reloj de negocio.
  const ahora = new Date();
  const cambio = await escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const previa = await leerConfiguracion(consulta, c.empresa.id);
    const clabeCambio = !previa || previa.clabe !== valor.clabe;
    const beneficiarioCambio = !previa || previa.beneficiario !== valor.beneficiario;
    const contactoCambio = !previa || previa.correoContacto !== valor.correoContacto;
    if (clabeCambio || beneficiarioCambio || contactoCambio) exigirAutenticacionRecienteCliente(sesion, ahora);
    await aplicarSentencia(
      consulta,
      `insert into collection_settings
         (company_id, clabe, beneficiario, correo_contacto, emitir_dias_antes, antes_dias, aviso_el_dia, despues_cada_dias,
          despues_tope, envio_automatico, actualizado_por, actualizado_en)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       on conflict (company_id) do update set
         clabe = excluded.clabe, beneficiario = excluded.beneficiario, correo_contacto = excluded.correo_contacto,
         emitir_dias_antes = excluded.emitir_dias_antes, antes_dias = excluded.antes_dias, aviso_el_dia = excluded.aviso_el_dia,
         despues_cada_dias = excluded.despues_cada_dias, despues_tope = excluded.despues_tope,
         envio_automatico = excluded.envio_automatico, actualizado_por = excluded.actualizado_por, actualizado_en = now()`,
      [c.empresa.id, valor.clabe, valor.beneficiario, valor.correoContacto, valor.emitirDiasAntes, valor.antesDias, valor.avisoElDia,
        valor.despuesCadaDias, valor.despuesTope, valor.envioAutomatico, c.persona.id],
    );
    await auditar(consulta, actor, {
      accion: "configurar_cobranza",
      identificador: c.empresa.id,
      cambio: {
        clabe_anterior: previa ? enmascarar(previa.clabe) : null,
        clabe_nueva: enmascarar(valor.clabe),
        beneficiario_cambio: beneficiarioCambio,
        contacto: valor.correoContacto !== null,
        contacto_cambio: contactoCambio,
        calendario: `emitir ${valor.emitirDiasAntes} · antes ${valor.antesDias} · día ${valor.avisoElDia ? "sí" : "no"} · después ${valor.despuesCadaDias}x${valor.despuesTope} · automático ${valor.envioAutomatico ? "sí" : "no"}`,
      },
    });
    // La primera configuración avisa solo con la CLABE; un cambio después avisa de cada dato que cambió.
    const clabe = clabeCambio ? { anterior: previa ? previa.clabe.slice(-4) : null, nueva: valor.clabe.slice(-4) } : null;
    const datos = previa && (beneficiarioCambio || contactoCambio)
      ? {
          beneficiario: beneficiarioCambio ? { anterior: previa.beneficiario, nuevo: valor.beneficiario } : null,
          contacto: contactoCambio ? { anterior: previa.correoContacto, nuevo: valor.correoContacto } : null,
        }
      : null;
    return clabe || datos ? { clabe, datos } : null;
  });
  if (!cambio) return { clabeCambio: false, avisos: 0 };
  const c = exigir(ctx, "cliente.flujo.editar");
  const enlace = `${(deps?.urlPublica ?? (() => leerUrlPublica()))()}/c/${c.empresa.id}/consola/cobros/configuracion`;
  const llave = (tipo: string, valor: string) => `cobranza-${tipo}/${c.empresa.id}/${createHash("sha256").update(`${valor}:${ahora.toISOString()}`).digest("hex").slice(0, 24)}`;
  let avisos = 0;
  if (cambio.clabe) {
    avisos += await avisarAlEquipo(c, deps, plantillaAvisoClabeCobranza({
      razonSocial: c.empresa.razonSocial, persona: c.persona.nombre, anterior: cambio.clabe.anterior, nueva: cambio.clabe.nueva, enlace,
    }), llave("clabe", cambio.clabe.nueva));
  }
  if (cambio.datos) {
    avisos += await avisarAlEquipo(c, deps, plantillaAvisoDatosCobranza({
      razonSocial: c.empresa.razonSocial, persona: c.persona.nombre, ...cambio.datos, enlace,
    }), llave("datos", `${cambio.datos.beneficiario?.nuevo ?? ""}|${cambio.datos.contacto?.nuevo ?? ""}`));
  }
  return { clabeCambio: cambio.clabe !== null, avisos };
}

/**
 * Manda un aviso interno a administración y finanzas de la empresa. Nunca
 * falla la operación que lo pidió: lo que no salió queda en el registro.
 */
export async function avisarAlEquipo(
  c: { empresa: { id: string; operadorId: string; demostracion: boolean } },
  deps: DependenciasCobranza | undefined,
  plantilla: { asunto: string; html: string; texto: string },
  llave: string,
): Promise<number> {
  const registrar = deps?.registrar ?? registrarPorDefecto;
  try {
    const correos = await conContexto({ rol: "plataforma_cliente", companyId: c.empresa.id, operadorId: c.empresa.operadorId }, async (consulta) => {
      const r = await aplicarSentencia(
        consulta,
        `select distinct u.correo
           from memberships m
           join membership_roles r on r.company_id = m.company_id and r.user_id = m.user_id and r.rol in ('administrador', 'finanzas')
           join users u on u.id = m.user_id
           left join employees e on e.company_id = m.company_id and e.user_id = m.user_id
          where m.company_id = $1 and m.estado = 'activa'
            and (e.id is null or e.baja_en is null or e.baja_en > (timezone('America/Mexico_City', clock_timestamp()))::date)
          order by u.correo`,
        [c.empresa.id],
      );
      return r.rows.map(registro).map((f) => texto(f.correo));
    });
    if (c.empresa.demostracion || correos.length === 0) return 0;
    const enviador = (deps?.enviador ?? (() => enviadorDesdeEntorno()))();
    let enviados = 0;
    for (const [indice, para] of correos.entries()) {
      try {
        await enviador({ para, ...plantilla, idempotencia: `${llave}/${indice}`, etiqueta: "cobranza_aviso" });
        enviados += 1;
      } catch {
        registrar({ evento: "aviso_cobranza_fallido", empresa: c.empresa.id, indice });
      }
    }
    return enviados;
  } catch {
    registrar({ evento: "aviso_cobranza_no_preparado", empresa: c.empresa.id });
    return 0;
  }
}

// Alta de cliente con plan ---------------------------------------------------------------

export type ResultadoAlta = {
  clienteId: string;
  planId: string;
  cargos: number;
  correo: ResultadoCorreo | null;
  clabePropia: "creada" | "pendiente" | "no_aplica";
  repetida: boolean;
};

export async function darDeAltaCliente(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  deps?: DependenciasCobranza,
): Promise<ResultadoAlta> {
  const c = exigir(ctx, "cliente.flujo.editar");
  const alta = exigirValido(validarAlta(entrada, hoyDe(deps)));
  const clienteId = exigirId(entrada.altaId);
  const hecho = await escribir(ctx, deps, async (consulta, _c, actor, auditar, hoy) => {
    const config = await leerConfiguracion(consulta, c.empresa.id);
    if (!config) throw new ErrorDeDominio("cobranza_sin_configurar");
    const previo = await aplicarSentencia(
      consulta,
      `select k.nombre, k.rfc, k.correos, (select p.id from collection_plans p where p.company_id = k.company_id and p.customer_id = k.id
                                              order by p.creado_en limit 1) as plan
         from collection_customers k where k.company_id = $1 and k.id = $2`,
      [c.empresa.id, clienteId],
    );
    if (previo.rows[0]) {
      const f = registro(previo.rows[0]);
      const mismos = texto(f.nombre) === alta.cliente.nombre && textoONulo(f.rfc) === alta.cliente.rfc
        && JSON.stringify(Array.isArray(f.correos) ? f.correos : []) === JSON.stringify(alta.cliente.correos);
      if (!mismos || !f.plan) throw new ErrorDeDominio("formulario_ya_enviado");
      return { repetida: true, planId: texto(f.plan), generados: [] as CargoGenerado[], automatico: false };
    }
    await aplicarSentencia(
      consulta,
      `insert into collection_customers (id, company_id, nombre, rfc, correos, creado_por, actualizado_por)
       values ($1, $2, $3, $4, $5, $6, $6)`,
      [clienteId, c.empresa.id, alta.cliente.nombre, alta.cliente.rfc, alta.cliente.correos, c.persona.id],
    );
    await auditar(consulta, actor, {
      accion: "alta_cliente_cobranza",
      identificador: clienteId,
      cambio: { correos: alta.cliente.correos.length, con_rfc: alta.cliente.rfc !== null },
    });
    const planId = await insertarPlan(consulta, c, actor, auditar, clienteId, alta.plan);
    const generados = await generarCargos(consulta, actor, auditar, c.empresa.id, hoy, config.emitirDiasAntes, [planId]);
    return { repetida: false, planId, generados, automatico: config.envioAutomatico };
  });
  if (hecho.repetida) return { clienteId, planId: hecho.planId, cargos: 0, correo: null, clabePropia: "no_aplica", repetida: true };
  const clabePropia = await prepararClabePropia(c, clienteId, deps);
  const correo = hecho.automatico ? await enviarCobrosNuevos(c, hecho.generados, deps) : null;
  return { clienteId, planId: hecho.planId, cargos: hecho.generados.length, correo, clabePropia, repetida: false };
}

async function insertarPlan(
  consulta: Consulta,
  c: ContextoConEmpresa,
  actor: Actor,
  auditar: Auditar,
  clienteId: string,
  plan: { concepto: string; tipo: "fijo" | "variable"; montoCentavos: number | null; periodicidad: Periodicidad; primerVencimiento: string; fin: string | null },
  planId: string = randomUUID(),
): Promise<string> {
  await aplicarSentencia(
    consulta,
    `insert into collection_plans
       (id, company_id, customer_id, concepto, tipo, monto_centavos, periodicidad, primer_vencimiento, fin, creado_por, actualizado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $10)`,
    [planId, c.empresa.id, clienteId, plan.concepto, plan.tipo, plan.montoCentavos, plan.periodicidad, plan.primerVencimiento, plan.fin, c.persona.id],
  );
  await auditar(consulta, actor, {
    accion: "alta_plan_cobranza",
    identificador: planId,
    cambio: { tipo: plan.tipo, periodicidad: plan.periodicidad, monto_centavos: plan.montoCentavos, primer_vencimiento: plan.primerVencimiento, fin: plan.fin },
  });
  return planId;
}

/**
 * La CLABE propia del cliente en el proveedor SPEI, si la empresa ya tiene su
 * cuenta. Si el proveedor no responde, el alta sigue (el correo lleva la CLABE
 * de la empresa con la referencia) y la tarea programada vuelve a intentarlo.
 */
async function prepararClabePropia(c: ContextoConEmpresa, clienteId: string, deps?: DependenciasCobranza): Promise<ResultadoAlta["clabePropia"]> {
  const fintoc = fintocDe(deps);
  if (!fintoc || c.empresa.demostracion) return "no_aplica";
  try {
    const hecha = await asegurarClabeDeCliente(baseCliente(c), actorDeCliente(c), auditarDe(deps), clienteId, fintoc);
    return hecha ? "creada" : "no_aplica";
  } catch {
    (deps?.registrar ?? registrarPorDefecto)({ evento: "clabe_propia_pendiente", empresa: c.empresa.id, cliente: clienteId });
    return "pendiente";
  }
}

async function enviarCobrosNuevos(c: ContextoConEmpresa, generados: readonly CargoGenerado[], deps?: DependenciasCobranza): Promise<ResultadoCorreo | null> {
  let primero: ResultadoCorreo | null = null;
  for (const cargo of generados) {
    if (cargo.estado !== "emitido") continue;
    const r = await enviarCorreoDeCargo(baseCliente(c), actorDeCliente(c), cargo.id, "cobro", 1, hoyDe(deps), pasoDeCorreo(deps));
    primero ??= r;
  }
  return primero;
}

// Clientes -------------------------------------------------------------------------------

export async function editarCliente(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<void> {
  const clienteId = exigirId(entrada.clienteId, "cliente_no_encontrado");
  const valor = exigirValido(validarClienteEditado(entrada));
  await escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const previo = await aplicarSentencia(
      consulta,
      "select nombre, rfc, correos from collection_customers where company_id = $1 and id = $2 for update",
      [c.empresa.id, clienteId],
    );
    const f = previo.rows[0] ? registro(previo.rows[0]) : null;
    if (!f) throw new ErrorDeDominio("cliente_no_encontrado");
    const campos = [
      texto(f.nombre) !== valor.nombre ? "nombre" : null,
      textoONulo(f.rfc) !== valor.rfc ? "rfc" : null,
      JSON.stringify(f.correos) !== JSON.stringify(valor.correos) ? "correos" : null,
    ].filter((x): x is string => x !== null);
    if (campos.length === 0) return;
    await aplicarSentencia(
      consulta,
      `update collection_customers set nombre = $3, rfc = $4, correos = $5, actualizado_por = $6, actualizado_en = now()
        where company_id = $1 and id = $2`,
      [c.empresa.id, clienteId, valor.nombre, valor.rfc, valor.correos, c.persona.id],
    );
    await auditar(consulta, actor, { accion: "editar_cliente_cobranza", identificador: clienteId, cambio: { campos: campos.join(",") } });
  });
}

/** Archivar cancela sus planes vivos (lo ya emitido se sigue debiendo y se sigue viendo). */
export async function archivarCliente(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<void> {
  const clienteId = exigirId(entrada.clienteId, "cliente_no_encontrado");
  const motivo = exigirValido(validarMotivo(entrada.motivo));
  await escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const planes = await aplicarSentencia(
      consulta,
      "select id from collection_plans where company_id = $1 and customer_id = $2 and estado <> 'cancelado' for update",
      [c.empresa.id, clienteId],
    );
    for (const plan of planes.rows.map(registro)) {
      await cancelarPlanEn(consulta, c, actor, auditar, texto(plan.id), `Cliente archivado: ${motivo}`.slice(0, 500));
    }
    const r = await aplicarSentencia(
      consulta,
      `update collection_customers set estado = 'archivado', motivo_archivo = $3, actualizado_por = $4, actualizado_en = now()
        where company_id = $1 and id = $2 and estado = 'activo'`,
      [c.empresa.id, clienteId, motivo, c.persona.id],
    );
    if (r.rowCount !== 1) throw new ErrorDeDominio("cliente_no_encontrado");
    await auditar(consulta, actor, { accion: "archivar_cliente_cobranza", identificador: clienteId, motivo });
  });
}

export async function cambiarRecordatorios(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<void> {
  const clienteId = exigirId(entrada.clienteId, "cliente_no_encontrado");
  const activos = entrada.activos === "si";
  await escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const r = await aplicarSentencia(
      consulta,
      `update collection_customers
          set recordatorios = $3, recordatorios_por = 'empresa', recordatorios_cambio_en = now(), actualizado_por = $4, actualizado_en = now()
        where company_id = $1 and id = $2 and estado = 'activo' and recordatorios <> $3`,
      [c.empresa.id, clienteId, activos, c.persona.id],
    );
    if (r.rowCount !== 1) return;
    await auditar(consulta, actor, { accion: "recordatorios_cliente_cobranza", identificador: clienteId, cambio: { activos, por: "empresa" } });
  });
}

// Planes ---------------------------------------------------------------------------------

export async function agregarPlan(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<{ planId: string; correo: ResultadoCorreo | null }> {
  const c = exigir(ctx, "cliente.flujo.editar");
  const clienteId = exigirId(entrada.clienteId, "cliente_no_encontrado");
  const planId = exigirId(entrada.altaId);
  const plan = exigirValido(validarPlanNuevo(entrada, hoyDe(deps)));
  const hecho = await escribir(ctx, deps, async (consulta, _c, actor, auditar, hoy) => {
    const config = await leerConfiguracion(consulta, c.empresa.id);
    if (!config) throw new ErrorDeDominio("cobranza_sin_configurar");
    const previo = await aplicarSentencia(consulta, "select customer_id from collection_plans where company_id = $1 and id = $2", [c.empresa.id, planId]);
    if (previo.rows[0]) {
      if (texto(registro(previo.rows[0]).customer_id) !== clienteId) throw new ErrorDeDominio("formulario_ya_enviado");
      return { generados: [] as CargoGenerado[], automatico: false };
    }
    const cliente = await aplicarSentencia(
      consulta,
      "select 1 from collection_customers where company_id = $1 and id = $2 and estado = 'activo' for update",
      [c.empresa.id, clienteId],
    );
    if (cliente.rows.length !== 1) throw new ErrorDeDominio("cliente_no_encontrado");
    await insertarPlan(consulta, c, actor, auditar, clienteId, plan, planId);
    const generados = await generarCargos(consulta, actor, auditar, c.empresa.id, hoy, config.emitirDiasAntes, [planId]);
    return { generados, automatico: config.envioAutomatico };
  });
  return { planId, correo: hecho.automatico ? await enviarCobrosNuevos(c, hecho.generados, deps) : null };
}

export async function editarPlan(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<void> {
  const planId = exigirId(entrada.planId, "plan_no_encontrado");
  await escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const plan = await planPara(consulta, c.empresa.id, planId);
    if (plan.estado === "cancelado") throw new ErrorDeDominio("plan_cancelado");
    const valor = exigirValido(validarPlanEditado(entrada, { tipo: plan.tipo, primerVencimiento: plan.primerVencimiento }));
    if (valor.concepto === plan.concepto && valor.montoCentavos === plan.montoCentavos && valor.fin === plan.fin) return;
    await aplicarSentencia(
      consulta,
      `update collection_plans set concepto = $3, monto_centavos = $4, fin = $5::date, actualizado_por = $6, actualizado_en = now()
        where company_id = $1 and id = $2`,
      [c.empresa.id, planId, valor.concepto, valor.montoCentavos, valor.fin, c.persona.id],
    );
    await auditar(consulta, actor, {
      accion: "editar_plan_cobranza",
      identificador: planId,
      cambio: {
        concepto_cambio: valor.concepto !== plan.concepto,
        monto_anterior: plan.montoCentavos,
        monto_nuevo: valor.montoCentavos,
        fin_anterior: plan.fin,
        fin_nuevo: valor.fin,
      },
    });
  });
}

export async function pausarPlan(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<void> {
  const planId = exigirId(entrada.planId, "plan_no_encontrado");
  await escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const r = await aplicarSentencia(
      consulta,
      "update collection_plans set estado = 'pausado', actualizado_por = $3, actualizado_en = now() where company_id = $1 and id = $2 and estado = 'activo'",
      [c.empresa.id, planId, c.persona.id],
    );
    if (r.rowCount !== 1) throw new ErrorDeDominio("plan_no_valido");
    await auditar(consulta, actor, { accion: "pausar_plan_cobranza", identificador: planId });
  });
}

/** Reanudar desde hoy: los periodos que vencieron en la pausa quedan omitidos, no se cobran. */
export async function reanudarPlan(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<{ correo: ResultadoCorreo | null }> {
  const c = exigir(ctx, "cliente.flujo.editar");
  const planId = exigirId(entrada.planId, "plan_no_encontrado");
  const hecho = await escribir(ctx, deps, async (consulta, _c, actor, auditar, hoy) => {
    const config = await leerConfiguracion(consulta, c.empresa.id);
    if (!config) throw new ErrorDeDominio("cobranza_sin_configurar");
    const r = await aplicarSentencia(
      consulta,
      `update collection_plans set estado = 'activo', reanudado_el = $3::date, actualizado_por = $4, actualizado_en = now()
        where company_id = $1 and id = $2 and estado = 'pausado'`,
      [c.empresa.id, planId, hoy, c.persona.id],
    );
    if (r.rowCount !== 1) throw new ErrorDeDominio("plan_no_valido");
    await auditar(consulta, actor, { accion: "reanudar_plan_cobranza", identificador: planId, cambio: { reanudado_el: hoy } });
    const generados = await generarCargos(consulta, actor, auditar, c.empresa.id, hoy, config.emitirDiasAntes, [planId]);
    return { generados, automatico: config.envioAutomatico };
  });
  return { correo: hecho.automatico ? await enviarCobrosNuevos(c, hecho.generados, deps) : null };
}

export async function cancelarPlan(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<void> {
  const planId = exigirId(entrada.planId, "plan_no_encontrado");
  const motivo = exigirValido(validarMotivo(entrada.motivo));
  await escribir(ctx, deps, (consulta, c, actor, auditar) => cancelarPlanEn(consulta, c, actor, auditar, planId, motivo));
}

/** Cancela el plan y sus periodos sin monto todavía; lo ya emitido se queda como deuda. */
async function cancelarPlanEn(consulta: Consulta, c: ContextoConEmpresa, actor: Actor, auditar: Auditar, planId: string, motivo: string): Promise<void> {
  const r = await aplicarSentencia(
    consulta,
    `update collection_plans
        set estado = 'cancelado', motivo_cancelacion = $3, cancelado_por = $4, cancelado_en = now(), actualizado_por = $4, actualizado_en = now()
      where company_id = $1 and id = $2 and estado <> 'cancelado'`,
    [c.empresa.id, planId, motivo, c.persona.id],
  );
  if (r.rowCount !== 1) throw new ErrorDeDominio("plan_cancelado");
  await auditar(consulta, actor, { accion: "cancelar_plan_cobranza", identificador: planId, motivo });
  const sinMonto = await aplicarSentencia(
    consulta,
    `update collection_charges set estado = 'cancelado', motivo = $3, resuelto_por = $4, resuelto_en = now()
      where company_id = $1 and plan_id = $2 and estado = 'por_emitir'
      returning id`,
    [c.empresa.id, planId, "Plan cancelado.", c.persona.id],
  );
  for (const cargo of sinMonto.rows.map(registro)) {
    await auditar(consulta, actor, { accion: "cancelar_cargo", identificador: texto(cargo.id), motivo: "Plan cancelado." });
  }
}

type PlanLeido = { estado: string; tipo: "fijo" | "variable"; concepto: string; montoCentavos: number | null; primerVencimiento: string; fin: string | null };

async function planPara(consulta: Consulta, empresaId: string, planId: string): Promise<PlanLeido> {
  const r = await aplicarSentencia(
    consulta,
    `select estado, tipo, concepto, monto_centavos::text as monto, to_char(primer_vencimiento, 'YYYY-MM-DD') as primer,
            to_char(fin, 'YYYY-MM-DD') as fin
       from collection_plans where company_id = $1 and id = $2 for update`,
    [empresaId, planId],
  );
  const f = r.rows[0] ? registro(r.rows[0]) : null;
  if (!f) throw new ErrorDeDominio("plan_no_encontrado");
  return {
    estado: texto(f.estado),
    tipo: f.tipo === "variable" ? "variable" : "fijo",
    concepto: texto(f.concepto),
    montoCentavos: f.monto === null || f.monto === undefined ? null : centavos(f.monto),
    primerVencimiento: texto(f.primer),
    fin: textoONulo(f.fin),
  };
}

// Cargos ---------------------------------------------------------------------------------

export async function crearCargoUnico(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  deps?: DependenciasCobranza,
): Promise<{ cargoId: string; correo: ResultadoCorreo | null }> {
  const c = exigir(ctx, "cliente.flujo.editar");
  const clienteId = exigirId(entrada.clienteId, "cliente_no_encontrado");
  const cargoId = exigirId(entrada.altaId);
  const valor = exigirValido(validarCargoUnico(entrada, hoyDe(deps)));
  const hecho = await escribir(ctx, deps, async (consulta, _c, actor, auditar) => {
    const config = await leerConfiguracion(consulta, c.empresa.id);
    if (!config) throw new ErrorDeDominio("cobranza_sin_configurar");
    const previo = await aplicarSentencia(consulta, "select customer_id, monto_centavos::text as monto from collection_charges where company_id = $1 and id = $2", [c.empresa.id, cargoId]);
    if (previo.rows[0]) {
      const f = registro(previo.rows[0]);
      if (texto(f.customer_id) !== clienteId || centavos(f.monto) !== valor.montoCentavos) throw new ErrorDeDominio("formulario_ya_enviado");
      return { nuevo: false, automatico: false };
    }
    const cliente = await aplicarSentencia(
      consulta,
      "select 1 from collection_customers where company_id = $1 and id = $2 and estado = 'activo' for update",
      [c.empresa.id, clienteId],
    );
    if (cliente.rows.length !== 1) throw new ErrorDeDominio("cliente_no_encontrado");
    const referencia = referenciaDe((await ultimoConsecutivo(consulta, c.empresa.id)) + 1);
    await aplicarSentencia(
      consulta,
      `insert into collection_charges
         (id, company_id, customer_id, concepto, monto_centavos, vencimiento, referencia, estado, emitido_en, emitido_por, creado_por)
       values ($1, $2, $3, $4, $5, $6::date, $7, 'emitido', now(), $8, $8)`,
      [cargoId, c.empresa.id, clienteId, valor.concepto, valor.montoCentavos, valor.vencimiento, referencia, c.persona.id],
    );
    await auditar(consulta, actor, {
      accion: "generar_cargo",
      identificador: cargoId,
      cambio: { periodo: null, vencimiento: valor.vencimiento, monto_centavos: valor.montoCentavos, estado: "emitido" },
    });
    return { nuevo: true, automatico: config.envioAutomatico };
  });
  const correo = hecho.nuevo && hecho.automatico ? await enviarCobrosNuevos(c, [{ id: cargoId, estado: "emitido" }], deps) : null;
  return { cargoId, correo };
}

/** Plan variable: el monto de este periodo. Emite el cargo y, si el envío es automático, manda el cobro. */
export async function capturarMontoVariable(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  deps?: DependenciasCobranza,
): Promise<{ correo: ResultadoCorreo | null }> {
  const c = exigir(ctx, "cliente.flujo.editar");
  const cargoId = exigirId(entrada.cargoId, "cargo_ausente");
  const monto = exigirValido(validarMontoVariable(entrada.monto));
  const automatico = await escribir(ctx, deps, async (consulta, _c, actor, auditar) => {
    const config = await leerConfiguracion(consulta, c.empresa.id);
    const r = await aplicarSentencia(
      consulta,
      `update collection_charges set estado = 'emitido', monto_centavos = $3, emitido_en = now(), emitido_por = $4
        where company_id = $1 and id = $2 and estado = 'por_emitir'`,
      [c.empresa.id, cargoId, monto, c.persona.id],
    );
    if (r.rowCount !== 1) throw new ErrorDeDominio("cargo_ya_resuelto");
    await auditar(consulta, actor, { accion: "emitir_cargo", identificador: cargoId, cambio: { monto_centavos: monto } });
    return config?.envioAutomatico ?? false;
  });
  return { correo: automatico ? await enviarCobrosNuevos(c, [{ id: cargoId, estado: "emitido" }], deps) : null };
}

export async function cancelarCargo(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<void> {
  const cargoId = exigirId(entrada.cargoId, "cargo_ausente");
  const motivo = exigirValido(validarMotivo(entrada.motivo));
  await escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const r = await aplicarSentencia(
      consulta,
      `update collection_charges set estado = 'cancelado', motivo = $3, resuelto_por = $4, resuelto_en = now()
        where company_id = $1 and id = $2 and estado in ('por_emitir', 'emitido') and pagado_centavos = 0`,
      [c.empresa.id, cargoId, motivo, c.persona.id],
    );
    if (r.rowCount !== 1) throw new ErrorDeDominio("cargo_no_cancelable");
    await auditar(consulta, actor, { accion: "cancelar_cargo", identificador: cargoId, motivo });
  });
}

/**
 * «Enviar cobro» desde la consola: el primer cobro si no ha salido (o si falló),
 * o un reenvío (hasta 5 por cargo, con 10 minutos entre uno y otro).
 */
export async function enviarCobro(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  deps?: DependenciasCobranza,
): Promise<ResultadoCorreo> {
  const c = exigir(ctx, "cliente.flujo.editar");
  const cargoId = exigirId(entrada.cargoId, "cargo_ausente");
  const siguiente = await conContexto(baseCliente(c), async (consulta) => {
    const r = await aplicarSentencia(
      consulta,
      `select m.tipo, m.secuencia, m.estado, extract(epoch from (clock_timestamp() - m.intentado_en)) / 60 as minutos
         from collection_emails m where m.company_id = $1 and m.charge_id = $2 order by m.intentado_en desc`,
      [c.empresa.id, cargoId],
    );
    const correos = r.rows.map(registro);
    const cobro = correos.find((m) => m.tipo === "cobro");
    if (!cobro || cobro.estado === "fallido") return { tipo: "cobro" as const, secuencia: 1 };
    const reenvios = correos.filter((m) => m.tipo === "reenvio");
    if (reenvios.length >= REENVIOS) throw new ErrorDeDominio("reenvios_agotados");
    const ultimo = correos.find((m) => m.tipo === "cobro" || m.tipo === "reenvio");
    if (ultimo && Number(ultimo.minutos) < ESPERA_REENVIO_MIN) throw new ErrorDeDominio("reenvio_reciente");
    const fallido = reenvios.find((m) => m.estado === "fallido");
    return { tipo: "reenvio" as const, secuencia: fallido ? entero(fallido.secuencia) : reenvios.length + 1 };
  });
  return enviarCorreoDeCargo(baseCliente(c), actorDeCliente(c), cargoId, siguiente.tipo, siguiente.secuencia, hoyDe(deps), pasoDeCorreo(deps));
}

// Pagos ----------------------------------------------------------------------------------

export type ComprobanteSubido = { nombre: string; bytes: Uint8Array } | null;

/**
 * Pago manual: llegó dinero y una persona lo registra, con su comprobante.
 * Con un cargo, se aplica hasta su saldo y lo demás queda a favor del cliente;
 * sin cargo, queda abierto (del cliente o sin identificar).
 */
export async function registrarPagoManual(
  ctx: ContextoDeTenant | null | undefined,
  entrada: Record<string, unknown>,
  comprobante: ComprobanteSubido,
  deps?: DependenciasCobranza,
): Promise<{ pagoId: string; aplicadoCentavos: number; posibleDuplicado: boolean; parecido: boolean }> {
  const c = exigir(ctx, "cliente.flujo.editar");
  const pagoId = exigirId(entrada.altaId);
  const valor = exigirValido(validarPagoManual(entrada, hoyDe(deps)));
  const cargoId = entrada.cargoId === undefined || entrada.cargoId === "" ? null : exigirId(entrada.cargoId, "cargo_ausente");
  const clienteEscrito = entrada.clienteId === undefined || entrada.clienteId === "" ? null : exigirId(entrada.clienteId, "cliente_no_encontrado");
  let archivo: { nombre: string; tipo: string; bytes: Uint8Array; hash: string } | null = null;
  if (comprobante && comprobante.bytes.byteLength > 0) {
    const v = validarComprobante(comprobante.nombre, comprobante.bytes);
    if (!v.ok) throw new ErrorDeCaptura([{ campo: "comprobante", mensaje: v.mensaje }]);
    archivo = { nombre: v.nombre, tipo: v.tipo, bytes: comprobante.bytes, hash: createHash("sha256").update(comprobante.bytes).digest("hex") };
  }
  // El archivo sube antes de la transacción; si la escritura falla, se borra.
  const almacen = deps?.almacen ?? almacenVercel();
  const documentoId = randomUUID();
  const guardado = archivo
    ? await almacen.guardar({ clave: `${c.empresa.operadorId}/${c.empresa.id}/cobranza/${documentoId}`, bytes: archivo.bytes, tipo: archivo.tipo })
    : null;
  try {
    return await escribir(ctx, deps, async (consulta, _c, actor, auditar) => {
      const previo = await aplicarSentencia(
        consulta,
        "select monto_centavos::text as monto, aplicado_centavos::text as aplicado, posible_duplicado, parecido_a from collection_payments where company_id = $1 and id = $2",
        [c.empresa.id, pagoId],
      );
      if (previo.rows[0]) {
        const f = registro(previo.rows[0]);
        if (centavos(f.monto) !== valor.montoCentavos) throw new ErrorDeDominio("formulario_ya_enviado");
        if (guardado) await almacen.borrar(guardado.clave);
        return { pagoId, aplicadoCentavos: centavos(f.aplicado), posibleDuplicado: f.posible_duplicado === true, parecido: f.parecido_a !== null };
      }
      let clienteId = clienteEscrito;
      let saldo = 0;
      let referencia: string | null = null;
      if (cargoId) {
        const cargo = await aplicarSentencia(
          consulta,
          "select customer_id, estado, referencia, (coalesce(monto_centavos, 0) - pagado_centavos)::text as saldo from collection_charges where company_id = $1 and id = $2 for update",
          [c.empresa.id, cargoId],
        );
        const f = cargo.rows[0] ? registro(cargo.rows[0]) : null;
        // Un cargo que no es de esta empresa no existe para ella: «no encontrado», no «ya cambió» (r63-N10).
        if (!f) throw new ErrorDeDominio("cargo_ausente");
        if (f.estado !== "emitido") throw new ErrorDeDominio("cargo_ya_resuelto");
        clienteId = texto(f.customer_id);
        saldo = centavos(f.saldo);
        referencia = texto(f.referencia);
      }
      const rastreoRepetido = valor.claveRastreo !== null && (await aplicarSentencia(
        consulta,
        "select 1 from collection_payments where company_id = $1 and upper(clave_rastreo) = $2 and estado not in ('anulado', 'devuelto') limit 1",
        [c.empresa.id, valor.claveRastreo],
      )).rows.length > 0;
      // La misma regla que los abonos automáticos (r63b-N1): el depósito ya llegó por Fintoc o en un estado de cuenta.
      const parecido = rastreoRepetido
        ? null
        : (await pagosParecidosDeOtraFuente(consulta, c.empresa.id, "manual", [{
            clave: "pago", montoCentavos: valor.montoCentavos, recibidoEl: valor.recibidoEl, referencia,
            // El cliente del cargo y el elegido a mano tienen que coincidir; si no, sin cliente (r63e-N1).
            clienteId: clienteSinDuda([clienteId, clienteEscrito]),
          }])).get("pago") ?? null;
      const posibleDuplicado = rastreoRepetido || parecido !== null;
      if (archivo && guardado) {
        await aplicarSentencia(
          consulta,
          `insert into documents (id, company_id, clave_blob, hash_sha256, tipo, nombre_original, creado_en)
           values ($1, $2, $3, $4, $5, $6, now())`,
          [documentoId, c.empresa.id, guardado.clave, archivo.hash, archivo.tipo, archivo.nombre],
        );
      }
      await aplicarSentencia(
        consulta,
        `insert into collection_payments
           (id, company_id, fuente, id_externo, monto_centavos, recibido_el, clave_rastreo, customer_id, posible_duplicado, parecido_a, document_id, registrado_por)
         values ($1, $2, 'manual', $3, $4, $5::date, $6, $7, $8, $9, $10, $11)`,
        [pagoId, c.empresa.id, `manual:${pagoId}`, valor.montoCentavos, valor.recibidoEl, valor.claveRastreo, clienteId, posibleDuplicado,
          parecido?.pagoId ?? null, guardado ? documentoId : null, c.persona.id],
      );
      await auditar(consulta, actor, {
        accion: "registrar_pago_cobranza",
        identificador: pagoId,
        cambio: { fuente: "manual", monto_centavos: valor.montoCentavos, recibido_el: valor.recibidoEl, regla: cargoId ? "manual" : null, posible_duplicado: posibleDuplicado, con_comprobante: guardado !== null,
          parecido_a: parecido?.pagoId ?? null },
      });
      // Un posible duplicado no se aplica solo: queda abierto para que alguien decida.
      const aplicado = cargoId && !posibleDuplicado ? Math.min(valor.montoCentavos, saldo) : 0;
      if (cargoId && aplicado > 0) await aplicar(consulta, actor, auditar, c.empresa.id, pagoId, cargoId, aplicado, "manual", valor.recibidoEl);
      return { pagoId, aplicadoCentavos: aplicado, posibleDuplicado, parecido: parecido !== null };
    });
  } catch (error) {
    if (guardado) await almacen.borrar(guardado.clave);
    throw error;
  }
}

/** Desde «Por conciliar»: aplicar un pago abierto a un cargo emitido, hasta lo que alcance. */
export async function aplicarPago(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<{ aplicadoCentavos: number }> {
  const pagoId = exigirId(entrada.pagoId, "pago_ausente");
  const cargoId = exigirId(entrada.cargoId, "cargo_ausente");
  return escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const pago = await aplicarSentencia(
      consulta,
      `select customer_id, (monto_centavos - aplicado_centavos)::text as libre, recibido_el
         from collection_payments where company_id = $1 and id = $2 and estado = 'abierto' for update`,
      [c.empresa.id, pagoId],
    );
    const p = pago.rows[0] ? registro(pago.rows[0]) : null;
    if (!p) throw new ErrorDeDominio("pago_ya_aplicado");
    const cargo = await aplicarSentencia(
      consulta,
      "select customer_id, (monto_centavos - pagado_centavos)::text as saldo from collection_charges where company_id = $1 and id = $2 and estado = 'emitido' for update",
      [c.empresa.id, cargoId],
    );
    const k = cargo.rows[0] ? registro(cargo.rows[0]) : null;
    if (!k) throw new ErrorDeDominio("cargo_ya_resuelto");
    const clienteDelCargo = texto(k.customer_id);
    if (p.customer_id && texto(p.customer_id) !== clienteDelCargo) throw new ErrorDeDominio("cliente_distinto");
    if (!p.customer_id) {
      await aplicarSentencia(consulta, "update collection_payments set customer_id = $3 where company_id = $1 and id = $2", [c.empresa.id, pagoId, clienteDelCargo]);
    }
    const monto = Math.min(centavos(p.libre), centavos(k.saldo));
    if (monto <= 0) throw new ErrorDeDominio("pago_ya_aplicado");
    await aplicar(consulta, actor, auditar, c.empresa.id, pagoId, cargoId, monto, "manual", fechaTexto(p.recibido_el));
    return { aplicadoCentavos: monto };
  });
}

/** Deshace una aplicación con una fila negativa: el cargo vuelve a deber y el pago queda abierto. */
export async function revertirAplicacion(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<void> {
  const aplicacionId = exigirId(entrada.aplicacionId, "aplicacion_no_valida");
  const motivo = exigirValido(validarMotivo(entrada.motivo));
  await escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const r = await aplicarSentencia(
      consulta,
      `select a.payment_id, a.charge_id, a.monto_centavos::text as monto
         from collection_applications a
        where a.company_id = $1 and a.id = $2 and a.regla <> 'reversion'
          and not exists (select 1 from collection_applications r where r.company_id = a.company_id and r.revierte_a = a.id)`,
      [c.empresa.id, aplicacionId],
    );
    const a = r.rows[0] ? registro(r.rows[0]) : null;
    if (!a) throw new ErrorDeDominio("aplicacion_no_valida");
    const monto = centavos(a.monto);
    const id = randomUUID();
    await aplicarSentencia(
      consulta,
      `insert into collection_applications (id, company_id, payment_id, charge_id, monto_centavos, regla, revierte_a, aplicado_por)
       values ($1, $2, $3, $4, $5, 'reversion', $6, $7)`,
      [id, c.empresa.id, texto(a.payment_id), texto(a.charge_id), -monto, aplicacionId, c.persona.id],
    );
    await auditar(consulta, actor, { accion: "aplicacion_cobranza", identificador: id, motivo, cambio: { monto_centavos: -monto, regla: "reversion" } });
    const cargo = await aplicarSentencia(
      consulta,
      `update collection_charges set pagado_centavos = pagado_centavos - $3, estado = 'emitido', pagado_el = null
        where company_id = $1 and id = $2 and estado in ('emitido', 'pagado') returning pagado_centavos::text as pagado`,
      [c.empresa.id, texto(a.charge_id), monto],
    );
    if (!cargo.rows[0]) throw new ErrorDeDominio("cargo_ya_resuelto");
    await auditar(consulta, actor, { accion: "abono_cargo", identificador: texto(a.charge_id), cambio: { pagado_centavos: centavos(registro(cargo.rows[0]).pagado), estado: "emitido" } });
    const pago = await aplicarSentencia(
      consulta,
      `update collection_payments set aplicado_centavos = aplicado_centavos - $3, estado = 'abierto'
        where company_id = $1 and id = $2 and estado in ('abierto', 'aplicado') returning aplicado_centavos::text as aplicado`,
      [c.empresa.id, texto(a.payment_id), monto],
    );
    if (!pago.rows[0]) throw new ErrorDeDominio("pago_anulado");
    await auditar(consulta, actor, { accion: "saldo_pago_cobranza", identificador: texto(a.payment_id), cambio: { aplicado_centavos: centavos(registro(pago.rows[0]).aplicado), estado: "abierto" } });
  });
}

/**
 * Un pago manual hecho por error, o un posible duplicado de cualquier fuente que una persona descarta (r63b-N1): el
 * depósito ya está contado en el pago parecido. Sin nada aplicado (revierte antes sus aplicaciones).
 */
export async function anularPago(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<{ descartado: boolean }> {
  const pagoId = exigirId(entrada.pagoId, "pago_ausente");
  const motivo = exigirValido(validarMotivo(entrada.motivo));
  return escribir(ctx, deps, async (consulta, c, actor, auditar) => {
    const r = await aplicarSentencia(
      consulta,
      `update collection_payments set estado = 'anulado', motivo_anulacion = $3, anulado_por = $4, anulado_en = now()
        where company_id = $1 and id = $2 and (fuente = 'manual' or posible_duplicado) and estado = 'abierto' and aplicado_centavos = 0
        returning fuente, posible_duplicado, parecido_a`,
      [c.empresa.id, pagoId, motivo, c.persona.id],
    );
    const f = r.rows[0] ? registro(r.rows[0]) : null;
    if (!f) throw new ErrorDeDominio("pago_no_anulable");
    if (f.posible_duplicado === true) {
      await auditar(consulta, actor, {
        accion: "descartar_duplicado_cobranza", identificador: pagoId, motivo,
        cambio: { fuente: texto(f.fuente), parecido_a: f.parecido_a === null ? null : texto(f.parecido_a) },
      });
      return { descartado: true };
    }
    await auditar(consulta, actor, { accion: "anular_pago_cobranza", identificador: pagoId, motivo });
    return { descartado: false };
  });
}

export const VARIANTES_DEMO: readonly VarianteDemo[] = ["exacto", "parcial", "de_mas", "duplicado", "repetir_aviso", "sin_referencia"];

/** Empresa de demostración: «llega» un abono al cargo para ver la detección automática. */
export async function simularAbono(ctx: ContextoDeTenant | null | undefined, entrada: Record<string, unknown>, deps?: DependenciasCobranza): Promise<{ repetido: boolean; motivo: string | null }> {
  const c = exigir(ctx, "cliente.flujo.editar");
  if (!fuenteDemo.disponiblePara(c.empresa)) throw new ErrorDeDominio("solo_demostracion");
  const cargoId = exigirId(entrada.cargoId, "cargo_ausente");
  const variante = VARIANTES_DEMO.find((v) => v === entrada.variante);
  if (!variante) throw new ErrorDeDominio("entrada_invalida");
  return escribir(ctx, deps, async (consulta, _c, actor, auditar, hoy) => {
    const r = await aplicarSentencia(
      consulta,
      `select c.customer_id, c.referencia, c.monto_centavos::text as monto, (c.monto_centavos - c.pagado_centavos)::text as saldo
         from collection_charges c where c.company_id = $1 and c.id = $2 and c.estado in ('emitido', 'pagado')`,
      [c.empresa.id, cargoId],
    );
    const f = r.rows[0] ? registro(r.rows[0]) : null;
    if (!f) throw new ErrorDeDominio("cargo_ausente");
    const ultimo = await aplicarSentencia(
      consulta,
      `select id_externo, clave_rastreo from collection_payments
        where company_id = $1 and fuente = 'demo' and referencia = $2 order by registrado_en desc limit 1`,
      [c.empresa.id, texto(f.referencia)],
    );
    const u = ultimo.rows[0] ? registro(ultimo.rows[0]) : null;
    const abono = abonoDemo(
      { id: cargoId, clienteId: texto(f.customer_id), referencia: texto(f.referencia), montoCentavos: centavos(f.monto), saldoCentavos: centavos(f.saldo) },
      variante,
      hoy,
      u ? { idExterno: texto(u.id_externo), claveRastreo: textoONulo(u.clave_rastreo) } : null,
    );
    const recibido = await recibirAbono(consulta, actor, auditar, "demo", abono);
    return { repetido: recibido.repetido, motivo: recibido.decision?.motivo ?? null };
  });
}

function fechaTexto(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return texto(valor).slice(0, 10);
}

// Vistas ---------------------------------------------------------------------------------

export type Deteccion = "demo" | "fintoc" | "pronto";

export type VistaCobranza = {
  hoy: string;
  resumen: ResumenCobranza;
  filtros: FiltrosCargos;
  cargos: { filas: FilaCargo[]; total: number };
  clientes: ClienteVista[];
  porConciliar: PagoVista[];
  cargosAbiertos: Awaited<ReturnType<typeof leerCargosAbiertos>>;
  configuracion: ConfiguracionCobranza | null;
  puedeEditar: boolean;
  demostracion: boolean;
  deteccion: Deteccion;
  /** Un id por cada formulario de cobro suelto (a mano y con XML) que pinta la página. */
  altaIds: { cobro: string; xml: string };
};

export function leerFiltros(parametros: Readonly<Record<string, string | string[] | undefined>>): FiltrosCargos {
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const estado = FILTROS_ESTADO.find((e) => e === uno(parametros.estado)) ?? "todos";
  const cubeta = CUBETAS.find((x) => x === uno(parametros.antiguedad)) ?? null;
  const q = uno(parametros.q).normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 80);
  const pagina = Number.parseInt(uno(parametros.pagina), 10);
  const cliente = uno(parametros.cliente);
  return {
    estado,
    cubeta: cubeta as Cubeta | null,
    q: q === "" ? null : q,
    clienteId: uuidValido(cliente) ? cliente.toLowerCase() : null,
    pagina: Number.isSafeInteger(pagina) && pagina >= 1 && pagina <= 1000 ? pagina : 1,
  };
}

export async function deteccionDe(consulta: Consulta, c: ContextoConEmpresa, deps?: DependenciasCobranza): Promise<Deteccion> {
  if (c.empresa.demostracion) return "demo";
  if (!fintocDe(deps)) return "pronto";
  const r = await aplicarSentencia(consulta, "select 1 from collection_provider_accounts where company_id = $1", [c.empresa.id]);
  return r.rows.length > 0 ? "fintoc" : "pronto";
}

export async function leerVistaCobranza(
  ctx: ContextoDeTenant | null | undefined,
  filtros: FiltrosCargos,
  deps?: DependenciasCobranza,
): Promise<VistaCobranza> {
  const c = exigir(ctx, "cliente.flujo.ver");
  const hoy = hoyDe(deps);
  return conContexto(baseCliente(c), async (consulta) => ({
    hoy,
    resumen: await leerResumen(consulta, c.empresa.id, hoy),
    filtros,
    cargos: await leerCargos(consulta, c.empresa.id, hoy, filtros, filtros.cubeta ? rangoDeCubeta(filtros.cubeta, hoy) : { desde: null, hasta: null }),
    clientes: await leerClientes(consulta, c.empresa.id, hoy),
    porConciliar: await leerPagos(consulta, c.empresa.id, { clienteId: null, soloAbiertos: true }),
    cargosAbiertos: await leerCargosAbiertos(consulta, c.empresa.id),
    configuracion: await leerConfiguracion(consulta, c.empresa.id),
    puedeEditar: puede(c, "cliente.flujo.editar"),
    demostracion: c.empresa.demostracion,
    deteccion: await deteccionDe(consulta, c, deps),
    altaIds: { cobro: randomUUID(), xml: randomUUID() },
  }));
}

export type VistaCliente = {
  hoy: string;
  detalle: DetalleCliente;
  /** Los próximos vencimientos del plan vivo (para el calendario). */
  proximos: { vencimiento: string; generado: boolean }[];
  clabePropia: string | null;
  configuracion: ConfiguracionCobranza | null;
  puedeEditar: boolean;
  demostracion: boolean;
  deteccion: Deteccion;
  altaIds: { plan: string; cargo: string; pago: string };
};

export async function leerVistaCliente(ctx: ContextoDeTenant | null | undefined, clienteId: unknown, deps?: DependenciasCobranza): Promise<VistaCliente | null> {
  const c = exigir(ctx, "cliente.flujo.ver");
  if (!uuidValido(clienteId)) return null;
  const hoy = hoyDe(deps);
  return conContexto(baseCliente(c), async (consulta) => {
    const detalle = await leerCliente(consulta, c.empresa.id, clienteId.toLowerCase(), hoy);
    if (!detalle) return null;
    const vivo = detalle.planes.find((p) => p.estado !== "cancelado") ?? null;
    const proximos = vivo && esPeriodicidad(vivo.periodicidad)
      ? calendarioDelPlan({ primerVencimiento: vivo.primerVencimiento, periodicidad: vivo.periodicidad, fin: vivo.fin }, 12, 0)
          .filter((p) => p.vencimiento >= hoy || p.periodo >= vivo.siguientePeriodo)
          .slice(0, 12)
          .map((p) => ({ vencimiento: p.vencimiento, generado: p.periodo < vivo.siguientePeriodo }))
      : [];
    const propia = await aplicarSentencia(
      consulta,
      "select clabe from collection_virtual_accounts where company_id = $1 and customer_id = $2 and proveedor = 'fintoc'",
      [c.empresa.id, detalle.cliente.id],
    );
    return {
      hoy,
      detalle,
      proximos,
      clabePropia: propia.rows[0] ? texto(registro(propia.rows[0]).clabe) : null,
      configuracion: await leerConfiguracion(consulta, c.empresa.id),
      puedeEditar: puede(c, "cliente.flujo.editar"),
      demostracion: c.empresa.demostracion,
      deteccion: await deteccionDe(consulta, c, deps),
      altaIds: { plan: randomUUID(), cargo: randomUUID(), pago: randomUUID() },
    };
  });
}

export type VistaNuevo = { hoy: string; altaId: string; configuracion: ConfiguracionCobranza | null; puedeEditar: boolean; deteccion: Deteccion; calendario: string | null };

export async function leerVistaNuevo(ctx: ContextoDeTenant | null | undefined, deps?: DependenciasCobranza): Promise<VistaNuevo> {
  const c = exigir(ctx, "cliente.flujo.ver");
  return conContexto(baseCliente(c), async (consulta) => {
    const configuracion = await leerConfiguracion(consulta, c.empresa.id);
    return {
      hoy: hoyDe(deps),
      altaId: randomUUID(),
      configuracion,
      puedeEditar: puede(c, "cliente.flujo.editar"),
      deteccion: await deteccionDe(consulta, c, deps),
      calendario: configuracion ? textoCalendario(configuracion) : null,
    };
  });
}

export type VistaConfiguracion = { configuracion: ConfiguracionCobranza | null; puedeEditar: boolean; deteccion: Deteccion; razonSocial: string; demostracion: boolean };

export async function leerVistaConfiguracion(ctx: ContextoDeTenant | null | undefined, deps?: DependenciasCobranza): Promise<VistaConfiguracion> {
  const c = exigir(ctx, "cliente.flujo.ver");
  return conContexto(baseCliente(c), async (consulta) => ({
    configuracion: await leerConfiguracion(consulta, c.empresa.id),
    puedeEditar: puede(c, "cliente.flujo.editar"),
    deteccion: await deteccionDe(consulta, c, deps),
    razonSocial: c.empresa.razonSocial,
    demostracion: c.empresa.demostracion,
  }));
}

/** El comprobante de un pago manual. Solo si es de un pago de esta empresa; se verifica su huella. */
export async function descargarComprobante(
  ctx: ContextoDeTenant | null | undefined,
  documentoId: unknown,
  deps?: DependenciasCobranza & { leer?: (clave: string) => Promise<ReadableStream<Uint8Array>> },
): Promise<{ bytes: Uint8Array; nombre: string; tipo: string }> {
  const c = exigir(ctx, "cliente.flujo.ver");
  if (!uuidValido(documentoId)) throw new ErrorDeDominio("archivo_no_disponible");
  const documento = await conContexto(baseCliente(c), async (consulta) => {
    const r = await aplicarSentencia(
      consulta,
      `select d.id, d.clave_blob, d.hash_sha256, d.tipo, d.nombre_original
         from documents d
        where d.company_id = $1 and d.id = $2
          and exists (select 1 from collection_payments p where p.company_id = d.company_id and p.document_id = d.id)`,
      [c.empresa.id, documentoId.toLowerCase()],
    );
    return r.rows[0] ? registro(r.rows[0]) : null;
  });
  if (!documento) throw new ErrorDeDominio("archivo_no_disponible");
  const stream = await (deps?.leer ?? leerPrivado)(texto(documento.clave_blob));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== texto(documento.hash_sha256)) throw new ErrorDeDominio("archivo_no_disponible");
  await conContexto(baseCliente(c), (consulta) =>
    auditarDe(deps)(consulta, actorDeCliente(c), { accion: "descargar_documento", identificador: texto(documento.id), cambio: { tipo: texto(documento.tipo) } }));
  return { bytes, nombre: texto(documento.nombre_original), tipo: texto(documento.tipo) };
}
