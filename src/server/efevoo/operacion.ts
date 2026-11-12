import { leerCentavosEscritos } from "../../dominio/centavos";
import type { ContextoDePersonal } from "../../nucleo/contexto";
import { basePlataforma } from "../../nucleo/contexto";
import { aplicarSentencia, conContexto } from "../../nucleo/db";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { centavos, centavosONulo, instante, registro, texto, textoONulo } from "../flujo/lectura";
import { exigirEnOperacion } from "../operacion/permisos";
import { clienteHttpEfevoo, type ClienteEfevoo, type DatosEmpresa, type MovimientoCliente, type Titular } from "./cliente";
import { configEfevoo, type ConfigEfevoo } from "./config";
import { ErrorEfevoo } from "./errores";
import {
  cerrarOperacionManualEfevoo,
  conciliarOperacionEfevoo,
  correoDeAltaEfevoo,
  ejecutarOperacionEfevoo,
  llamadaEstandar,
  reintentarOperacionEfevoo,
  saldoDeEmpresaEfevoo,
  type Conciliacion,
  type DependenciasOperacion,
  type Ejecutada,
  type EstadoOperacion,
  type LlamadaEfevoo,
  type TipoOperacion,
} from "./operaciones";

/**
 * La sección «Tarjetas (Efevoo)» de la ficha del cliente en Operación. Solo
 * Administración de la plataforma (la base lo vuelve a exigir en cada escritura):
 *
 *   O1  alta de la empresa en Efevoo, con los datos del expediente vigente;
 *   O2  depósito de prueba al saldo de la empresa (solo con EFEVOO_AMBIENTE=sandbox);
 *   O3  asignar un plástico del inventario a un empleado activo y activarlo. Los
 *       datos personales que pide Efevoo se mandan y no se guardan en Lever;
 *   O4  cancelar una tarjeta, con motivo y la terminación escrita para confirmar.
 *
 * Todo pasa por el ciclo de operaciones.ts (asentar → llamar → resolver).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPACIDAD = "plataforma.empresa.alta" as const;
/** Correos de prueba en sandbox: nunca de una persona real. */
const DOMINIOS_DE_PRUEBA = /@(lever\.test|ejemplo\.mx)$/;
/** Producto y subproducto de Cohete en Efevoo (inventario del sandbox, docs/evidencia/efevoo/investigacion.md). */
export const PRODUCTO_COHETE = { producto: 16, subproducto: 19 } as const;

export type TarjetaEnOperacion = {
  id: string;
  idEfevoo: number;
  terminacion: string;
  nombreTarjeta: string;
  estado: "asignada" | "activa" | "bloqueada" | "cancelada";
  empleado: string | null;
  motivoCancelacion: string | null;
};

export type OperacionEnOperacion = {
  id: string;
  tipo: TipoOperacion;
  estado: EstadoOperacion;
  referencia: string;
  montoCentavos: number | null;
  terminacion: string | null;
  codigoEfevoo: string | null;
  creadaEn: string;
  reintentoDe: string | null;
  /** Pendiente o incierta: se puede buscar en Efevoo. */
  conciliable: boolean;
  /** Fallida porque no apareció, de un tipo que Lever puede repetir solo con lo que guarda. */
  reintentable: boolean;
  /** Abierta sobre una tarjeta cancelada desde hace 10 minutos o más: se puede cerrar a mano (PC2-4). */
  cerrable: boolean;
};

export type SeccionEfevoo = {
  /** sin_configurar: el entorno no tiene EFEVOO_*; demostracion: la empresa es de demostración. */
  estado: "sin_configurar" | "demostracion" | "sin_vinculo" | "vinculada";
  ambiente: "sandbox" | "produccion" | null;
  empresaActiva: boolean;
  idepCliente: number | null;
  saldoCentavos: number | null;
  movimientos: MovimientoCliente[];
  inventario: { id: number; terminacion: string }[];
  /** El código si Efevoo no respondió al leer (la sección se pinta con lo que hay en Lever). */
  errorEfevoo: string | null;
  tarjetas: TarjetaEnOperacion[];
  operaciones: OperacionEnOperacion[];
  /** Empleados activos, con cuántas tarjetas vigentes tienen (asignada, activa o bloqueada; no las canceladas) y la que tengan asignada sin activar (PC2-2). */
  empleados: { id: string; nombre: string; tarjetas: number; porActivar: { tarjetaId: string; terminacion: string } | null }[];
  expediente: { razonSocial: string; rfc: string; conDomicilio: boolean; representantes: number; correo: string | null } | null;
};

type Dependencias = DependenciasOperacion & { config?: ConfigEfevoo | null };

function cliente(deps: Dependencias | undefined): { config: ConfigEfevoo | null; efevoo: ClienteEfevoo | null } {
  const config = deps?.config === undefined ? configEfevoo() : deps.config;
  return { config, efevoo: deps?.efevoo ?? (config ? clienteHttpEfevoo(config) : null) };
}

function exigir(ctx: ContextoDePersonal, companyId: unknown): string {
  exigirEnOperacion(ctx, CAPACIDAD);
  if (typeof companyId !== "string" || !UUID.test(companyId)) throw new ErrorDeDominio("entrada_invalida");
  return companyId.toLowerCase();
}

/** Que no reintente solo lo que pide datos que Lever no guarda (la asignación vuelve a llenarse a mano). */
const REINTENTABLES: ReadonlySet<TipoOperacion> = new Set(["alta_cliente", "deposito_prueba", "activacion", "cancelacion"]);

export async function leerSeccionEfevoo(ctx: ContextoDePersonal, companyIdCrudo: unknown, deps?: Dependencias): Promise<SeccionEfevoo> {
  const companyId = exigir(ctx, companyIdCrudo);
  const { config, efevoo } = cliente(deps);
  const base = basePlataforma(ctx, companyId);
  const lever = await conContexto(base, async (consulta) => {
    const empresa = registro((await aplicarSentencia(consulta, "select demostracion, estado, razon_social, rfc from companies where id = $1", [companyId])).rows[0]);
    const vinculo = (await aplicarSentencia(consulta, "select idep_cliente, ambiente from efevoo_clientes where company_id = $1", [companyId])).rows[0];
    const empleados = (await aplicarSentencia(consulta, "select id, nombre from efevoo_empleados_asignables($1)", [companyId])).rows
      .map((f) => ({ id: texto(registro(f).id), nombre: texto(registro(f).nombre) }));
    const tarjetas = (await aplicarSentencia(
      consulta,
      `select id, id_efevoo, terminacion, nombre_tarjeta, estado, employee_id, motivo_cancelacion
         from efevoo_tarjetas where company_id = $1 order by creada_en desc, id`,
      [companyId],
    )).rows.map(registro);
    const operaciones = (await aplicarSentencia(
      consulta,
      `select o.id, o.tipo, o.estado, o.referencia, o.monto_centavos::text as monto_centavos, coalesce(o.terminacion, t.terminacion) as terminacion,
              o.codigo_efevoo, o.creada_en, o.reintento_de,
              exists (select 1 from efevoo_operaciones r where r.reintento_de = o.id) as reintentada,
              (t.estado = 'cancelada' and o.creada_en <= now() - interval '10 minutes') as sobre_cancelada
         from efevoo_operaciones o left join efevoo_tarjetas t on t.id = o.tarjeta_id
        where o.company_id = $1 order by o.creada_en desc, o.id limit 50`,
      [companyId],
    )).rows.map(registro);
    const version = (await aplicarSentencia(
      consulta,
      `select v.id, v.razon_social, v.rfc, v.domicilio_calle, v.correo,
              (select count(*)::int from kyb_representantes r where r.version_id = v.id) as representantes
         from kyb_versiones v where v.company_id = $1 and v.estado = 'enviada' order by v.numero desc limit 1`,
      [companyId],
    )).rows[0];
    return { empresa, vinculo: vinculo ? registro(vinculo) : null, empleados, tarjetas, operaciones, version: version ? registro(version) : null };
  });
  const nombres = new Map(lever.empleados.map((e) => [e.id, e.nombre]));
  const seccion: SeccionEfevoo = {
    estado: !config ? "sin_configurar" : lever.empresa.demostracion === true ? "demostracion" : lever.vinculo ? "vinculada" : "sin_vinculo",
    ambiente: config?.ambiente ?? null,
    empresaActiva: lever.empresa.estado === "activa",
    idepCliente: lever.vinculo ? Number(lever.vinculo.idep_cliente) : null,
    saldoCentavos: null,
    movimientos: [],
    inventario: [],
    errorEfevoo: null,
    tarjetas: lever.tarjetas.map((t) => ({
      id: texto(t.id),
      idEfevoo: Number(t.id_efevoo),
      terminacion: texto(t.terminacion),
      nombreTarjeta: texto(t.nombre_tarjeta),
      estado: texto(t.estado) as TarjetaEnOperacion["estado"],
      empleado: t.employee_id ? nombres.get(texto(t.employee_id)) ?? "Empleado dado de baja" : null,
      motivoCancelacion: textoONulo(t.motivo_cancelacion),
    })),
    operaciones: lever.operaciones.map((o) => {
      const estado = texto(o.estado) as EstadoOperacion;
      const tipo = texto(o.tipo) as TipoOperacion;
      return {
        id: texto(o.id),
        tipo,
        estado,
        referencia: texto(o.referencia),
        montoCentavos: centavosONulo(o.monto_centavos),
        terminacion: textoONulo(o.terminacion),
        codigoEfevoo: textoONulo(o.codigo_efevoo),
        creadaEn: instante(o.creada_en),
        reintentoDe: textoONulo(o.reintento_de),
        conciliable: estado === "pendiente" || estado === "incierta",
        reintentable: estado === "fallida" && o.codigo_efevoo === "no_aparecio" && o.reintentada !== true && REINTENTABLES.has(tipo),
        cerrable: (estado === "pendiente" || estado === "incierta") && o.sobre_cancelada === true,
      };
    }),
    empleados: lever.empleados.map((e) => {
      const suyas = lever.tarjetas.filter((t) => t.employee_id === e.id && t.estado !== "cancelada");
      const asignada = suyas.find((t) => t.estado === "asignada");
      return { ...e, tarjetas: suyas.length, porActivar: asignada ? { tarjetaId: texto(asignada.id), terminacion: texto(asignada.terminacion) } : null };
    }),
    expediente: lever.version ? {
      razonSocial: textoONulo(lever.version.razon_social) ?? texto(lever.empresa.razon_social),
      rfc: textoONulo(lever.version.rfc) ?? texto(lever.empresa.rfc),
      conDomicilio: Boolean(lever.version.domicilio_calle),
      representantes: Number(lever.version.representantes),
      correo: textoONulo(lever.version.correo),
    } : null,
  };
  if (seccion.estado === "vinculada" && efevoo && seccion.idepCliente) {
    try {
      seccion.saldoCentavos = await saldoDeEmpresaEfevoo(efevoo, seccion.idepCliente);
      seccion.movimientos = await efevoo.movimientosCliente(seccion.idepCliente, 1, 10);
      seccion.inventario = (await efevoo.listarTarjetas({ estados: ["inStock"], pagina: 1, tamano: 50 })).tarjetas
        .filter((t) => !t.conTitular && t.idepCliente === 0)
        .map((t) => ({ id: t.id, terminacion: t.terminacion }));
    } catch (error) {
      if (!(error instanceof ErrorEfevoo)) throw error;
      seccion.errorEfevoo = error.codigo;
    }
  }
  return seccion;
}

// O1 --------------------------------------------------------------------------------

/**
 * Alta de la empresa en Efevoo con los datos del expediente vigente (la última
 * versión enviada). El correo de la empresa en sandbox es uno de prueba
 * `@lever.test` derivado de su id; en producción, el del expediente.
 */
export async function darDeAltaEnEfevoo(ctx: ContextoDePersonal, entrada: { companyId: unknown; llave: unknown }, deps?: Dependencias): Promise<Ejecutada> {
  const companyId = exigir(ctx, entrada.companyId);
  const { config } = cliente(deps);
  if (!config) throw new ErrorEfevoo("efevoo_no_configurado");
  const alta = await armarAlta(ctx, companyId, config);
  return ejecutarOperacionEfevoo(ctx, { tipo: "alta_cliente", llave: llave(entrada.llave), companyId }, alta, deps);
}

/** La llamada del alta, con los datos del expediente vigente. No asienta nada. */
async function armarAlta(ctx: ContextoDePersonal, companyId: string, config: ConfigEfevoo): Promise<LlamadaEfevoo> {
  const datos = await conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    const v = (await aplicarSentencia(
      consulta,
      `select v.id, v.razon_social, v.rfc, v.telefono, v.correo, v.domicilio_calle, v.domicilio_exterior, v.domicilio_interior,
              v.domicilio_colonia, v.domicilio_municipio, v.domicilio_codigo_postal, v.domicilio_entidad, v.domicilio_pais
         from kyb_versiones v where v.company_id = $1 and v.estado = 'enviada' order by v.numero desc limit 1`,
      [companyId],
    )).rows[0];
    if (!v) throw new ErrorDeDominio("expediente_sin_datos");
    const version = registro(v);
    const representantes = (await aplicarSentencia(
      consulta, "select nombre, rfc, curp from kyb_representantes where version_id = $1 order by nombre, id limit 4", [texto(version.id)],
    )).rows.map(registro);
    return { version, representantes, correo: await correoDeAltaEfevoo(consulta, companyId, config.ambiente) };
  });
  const alta = datosDeAltaEfevoo(config.ambiente, datos.version, datos.representantes, datos.correo);
  return async (_op, efevoo) => String((await efevoo.crearCliente(alta)).idepCliente);
}

/**
 * Lo que se manda en el alta. En sandbox (PC2-3, decisión del líder) solo la razón social y el correo de prueba:
 * el sandbox es compartido con terceros, así que no salen el RFC, el teléfono, el domicilio ni los representantes
 * del expediente. En producción, el expediente completo.
 */
export function datosDeAltaEfevoo(
  ambiente: "sandbox" | "produccion",
  version: Record<string, unknown>,
  representantes: Record<string, unknown>[],
  correo: string | null,
): DatosEmpresa {
  const razonSocial = textoONulo(version.razon_social);
  if (!razonSocial) throw new ErrorDeDominio("expediente_sin_datos");
  if (!correo) throw new ErrorDeDominio("expediente_sin_correo");
  if (ambiente === "sandbox") return { correo, razonSocial };
  return {
    correo,
    razonSocial,
    rfc: textoONulo(version.rfc),
    telefono: textoONulo(version.telefono),
    domicilio: {
      calle: textoONulo(version.domicilio_calle),
      numExt: textoONulo(version.domicilio_exterior),
      numInt: textoONulo(version.domicilio_interior),
      colonia: textoONulo(version.domicilio_colonia),
      municipio: textoONulo(version.domicilio_municipio),
      codigoPostal: textoONulo(version.domicilio_codigo_postal),
      estado: textoONulo(version.domicilio_entidad),
      pais: textoONulo(version.domicilio_pais),
    },
    representantes: representantes.map((p) => ({ nombre: texto(p.nombre), rfc: textoONulo(p.rfc), curp: textoONulo(p.curp) })),
  };
}

// O2 --------------------------------------------------------------------------------

/** Depósito de prueba al saldo de la empresa en Efevoo. Solo con EFEVOO_AMBIENTE=sandbox; en producción no existe. */
export async function depositarDineroDePrueba(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; llave: unknown; monto: unknown },
  deps?: Dependencias,
): Promise<Ejecutada> {
  const companyId = exigir(ctx, entrada.companyId);
  const { config, efevoo } = cliente(deps);
  if (!config || !efevoo) throw new ErrorEfevoo("efevoo_no_configurado");
  if (config.ambiente !== "sandbox") throw new ErrorDeDominio("solo_sandbox");
  const leido = leerCentavosEscritos(entrada.monto);
  if (leido.tipo !== "centavos" || leido.centavos < 1 || leido.centavos > 10_000_000) throw new ErrorDeDominio("dato_invalido_monto");
  const idep = await idepDe(ctx, companyId);
  const saldoPrevio = await saldoDeEmpresaEfevoo(efevoo, idep);
  return ejecutarOperacionEfevoo(ctx, {
    tipo: "deposito_prueba", llave: llave(entrada.llave), companyId, montoCentavos: leido.centavos, saldoPrevioCentavos: saldoPrevio,
  }, llamadaEstandar, { ...deps, config, efevoo });
}

// O3 --------------------------------------------------------------------------------

export type EntradaAsignacion = {
  companyId: unknown;
  llave: unknown;
  llaveActivacion: unknown;
  employeeId: unknown;
  inventarioId: unknown;
  ultimos8: unknown;
  nombre: unknown;
  primerApellido: unknown;
  segundoApellido: unknown;
  nombreEmbozar: unknown;
  telefono: unknown;
  correo: unknown;
  paisNacimiento: unknown;
  domicilio: unknown;
};

/** Texto de una persona: sin espacios en las orillas ni caracteres de control. */
function campoTexto(valor: unknown, campo: string, min: number, max: number, forma?: RegExp): string {
  const t = typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
  if (t.length < min || t.length > max || /[\p{Cc}\p{Cf}]/u.test(t) || (forma && !forma.test(t))) throw new ErrorDeDominio(`dato_invalido_${campo}`);
  return t;
}

const LETRAS = /^[\p{L}][\p{L} .'-]*$/u;

/**
 * Valida lo que Efevoo pide y Lever no tiene. Nada de esto se guarda en Lever:
 * solo viaja a Efevoo. Lever guarda el nombre en la tarjeta y la terminación.
 */
export function validarTitular(entrada: EntradaAsignacion, ambiente: "sandbox" | "produccion"): { titular: Titular; ultimos8: string } {
  const correo = campoTexto(entrada.correo, "correo", 6, 120).toLowerCase();
  if (!/^[^\s@<>",;:()[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(correo)) throw new ErrorDeDominio("dato_invalido_correo");
  if (ambiente === "sandbox" && !DOMINIOS_DE_PRUEBA.test(correo)) throw new ErrorDeDominio("correo_de_prueba");
  const telefono = campoTexto(entrada.telefono, "telefono", 10, 10, /^[0-9]{10}$/);
  const ultimos8 = campoTexto(entrada.ultimos8, "ultimos8", 8, 8, /^[0-9]{8}$/);
  return {
    ultimos8,
    titular: {
      nombre: campoTexto(entrada.nombre, "nombre", 1, 40, LETRAS),
      primerApellido: campoTexto(entrada.primerApellido, "primerApellido", 1, 40, LETRAS),
      // El segundo apellido puede no existir; Efevoo lo recibe vacío.
      segundoApellido: typeof entrada.segundoApellido === "string" && entrada.segundoApellido.trim() === ""
        ? ""
        : campoTexto(entrada.segundoApellido, "segundoApellido", 1, 40, LETRAS),
      nombreEmbozar: campoTexto(entrada.nombreEmbozar, "nombreEmbozar", 2, 26, /^[A-ZÑ][A-ZÑ .]*$/).replace(/\s+/g, " "),
      telefono,
      correo,
      paisNacimiento: campoTexto(entrada.paisNacimiento, "paisNacimiento", 2, 40, LETRAS),
      domicilio: campoTexto(entrada.domicilio, "domicilio", 5, 120),
    },
  };
}

export type ResultadoAsignacion = { asignacion: Ejecutada; activacion: Ejecutada | null };

/**
 * Asigna un plástico del inventario a un empleado activo y lo activa: dos
 * operaciones, cada una con su estado. Si la asignación quedó confirmada y la
 * activación no, la tarjeta queda «asignada» y se retoma con activarTarjetaEnEfevoo.
 */
export async function asignarTarjetaEnEfevoo(ctx: ContextoDePersonal, entrada: EntradaAsignacion, deps?: Dependencias): Promise<ResultadoAsignacion> {
  const companyId = exigir(ctx, entrada.companyId);
  const { config, efevoo } = cliente(deps);
  if (!config || !efevoo) throw new ErrorEfevoo("efevoo_no_configurado");
  if (typeof entrada.employeeId !== "string" || !UUID.test(entrada.employeeId)) throw new ErrorDeDominio("dato_invalido_employeeId");
  const inventarioId = typeof entrada.inventarioId === "string" && /^[1-9][0-9]{0,8}$/.test(entrada.inventarioId) ? Number(entrada.inventarioId) : null;
  if (inventarioId === null) throw new ErrorDeDominio("dato_invalido_inventarioId");
  const { titular, ultimos8 } = validarTitular(entrada, config.ambiente);
  // El plástico tiene que seguir en el inventario, y los últimos 8 que se leen del plástico terminan en su terminación.
  const plastico = (await efevoo.listarTarjetas({ estados: ["inStock"], pagina: 1, tamano: 50 })).tarjetas
    .find((t) => t.id === inventarioId && !t.conTitular && t.idepCliente === 0);
  if (!plastico) throw new ErrorDeDominio("plastico_no_disponible");
  if (!ultimos8.endsWith(plastico.terminacion)) throw new ErrorDeDominio("dato_invalido_ultimos8");
  const asignar: LlamadaEfevoo = async (op, ef) => {
    if (!op.idepCliente) throw new ErrorEfevoo("efevoo_rechazo", "sin_vinculo");
    return String((await ef.asignarTarjeta({ ...PRODUCTO_COHETE, idepCliente: op.idepCliente, ultimos8, titular })).id);
  };
  const asignacion = await ejecutarOperacionEfevoo(ctx, {
    tipo: "asignacion",
    llave: llave(entrada.llave),
    companyId,
    inventario: { idEfevoo: plastico.id, terminacion: plastico.terminacion, employeeId: entrada.employeeId.toLowerCase(), nombreTarjeta: titular.nombreEmbozar },
  }, asignar, { ...deps, config, efevoo });
  if (asignacion.estado !== "confirmada") return { asignacion, activacion: null };
  const tarjetaId = await tarjetaDeAsignacion(ctx, companyId, asignacion);
  if (!tarjetaId) return { asignacion, activacion: null };
  const activacion = await ejecutarOperacionEfevoo(ctx, { tipo: "activacion", llave: llave(entrada.llaveActivacion), companyId, tarjetaId }, llamadaEstandar, { ...deps, config, efevoo });
  return { asignacion, activacion };
}

/** Retomar: activar una tarjeta que quedó asignada. */
export async function activarTarjetaEnEfevoo(ctx: ContextoDePersonal, entrada: { companyId: unknown; llave: unknown; tarjetaId: unknown }, deps?: Dependencias) {
  const companyId = exigir(ctx, entrada.companyId);
  return ejecutarOperacionEfevoo(ctx, { tipo: "activacion", llave: llave(entrada.llave), companyId, tarjetaId: tarjetaId(entrada.tarjetaId) }, llamadaEstandar, deps);
}

// O4 --------------------------------------------------------------------------------

/** Cancelar es irreversible en Efevoo: motivo y la terminación escrita a mano para confirmar. */
export async function cancelarTarjetaEnEfevoo(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; llave: unknown; tarjetaId: unknown; motivo: unknown; confirmacion: unknown },
  deps?: Dependencias,
) {
  const companyId = exigir(ctx, entrada.companyId);
  const id = tarjetaId(entrada.tarjetaId);
  const motivo = typeof entrada.motivo === "string" ? entrada.motivo.replace(/\s+/g, " ").trim() : "";
  if (motivo.length < 10) throw new ErrorDeDominio("motivo_corto");
  if (motivo.length > 500) throw new ErrorDeDominio("motivo_largo");
  if (/[\p{Cc}\p{Cf}]/u.test(motivo)) throw new ErrorDeDominio("motivo_invalido");
  const terminacion = await conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    const r = (await aplicarSentencia(consulta, "select terminacion from efevoo_tarjetas where id = $1 and company_id = $2", [id, companyId])).rows[0];
    return r ? texto(registro(r).terminacion) : null;
  });
  if (!terminacion) throw new ErrorDeDominio("tarjeta_no_encontrada");
  if (typeof entrada.confirmacion !== "string" || entrada.confirmacion.trim() !== terminacion) throw new ErrorDeDominio("dato_invalido_confirmacion");
  return ejecutarOperacionEfevoo(ctx, { tipo: "cancelacion", llave: llave(entrada.llave), companyId, tarjetaId: id, motivo }, llamadaEstandar, deps);
}

// Conciliar y reintentar ---------------------------------------------------------------

export async function conciliarEnEfevoo(ctx: ContextoDePersonal, entrada: { companyId: unknown; operacionId: unknown }, deps?: Dependencias): Promise<Conciliacion> {
  const companyId = exigir(ctx, entrada.companyId);
  if (typeof entrada.operacionId !== "string" || !UUID.test(entrada.operacionId)) throw new ErrorDeDominio("entrada_invalida");
  return conciliarOperacionEfevoo(ctx, companyId, entrada.operacionId, deps);
}

/** Repite una operación que no apareció en Efevoo: referencia nueva, ligada a la anterior. El alta vuelve a leer el expediente. */
export async function reintentarEnEfevoo(ctx: ContextoDePersonal, entrada: { companyId: unknown; operacionId: unknown; llave: unknown }, deps?: Dependencias): Promise<Ejecutada> {
  const companyId = exigir(ctx, entrada.companyId);
  if (typeof entrada.operacionId !== "string" || !UUID.test(entrada.operacionId)) throw new ErrorDeDominio("entrada_invalida");
  const tipo = await conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    const r = (await aplicarSentencia(consulta, "select tipo from efevoo_operaciones where id = $1 and company_id = $2", [entrada.operacionId, companyId])).rows[0];
    return r ? (texto(registro(r).tipo) as TipoOperacion) : null;
  });
  if (!tipo) throw new ErrorDeDominio("operacion_no_encontrada");
  if (!REINTENTABLES.has(tipo)) throw new ErrorDeDominio("reintento_no_valido");
  if (tipo === "alta_cliente") {
    // El alta no tiene referencia: se vuelve a pedir con los datos del expediente, ligada a la anterior.
    const { config } = cliente(deps);
    if (!config) throw new ErrorEfevoo("efevoo_no_configurado");
    return reintentarOperacionEfevoo(ctx, companyId, entrada.operacionId, llave(entrada.llave), await armarAlta(ctx, companyId, config), deps);
  }
  return reintentarOperacionEfevoo(ctx, companyId, entrada.operacionId, llave(entrada.llave), llamadaEstandar, deps);
}

/** Cierre manual de una operación abierta sobre una tarjeta cancelada, con motivo (PC2-4). */
export async function cerrarEnEfevoo(
  ctx: ContextoDePersonal,
  entrada: { companyId: unknown; operacionId: unknown; motivo: unknown },
  deps?: Dependencias,
) {
  const companyId = exigir(ctx, entrada.companyId);
  if (typeof entrada.operacionId !== "string" || !UUID.test(entrada.operacionId)) throw new ErrorDeDominio("entrada_invalida");
  const motivo = typeof entrada.motivo === "string" ? entrada.motivo.replace(/\s+/g, " ").trim() : "";
  if (motivo.length < 10) throw new ErrorDeDominio("motivo_corto");
  if (motivo.length > 500) throw new ErrorDeDominio("motivo_largo");
  if (/[\p{Cc}\p{Cf}]/u.test(motivo)) throw new ErrorDeDominio("motivo_invalido");
  return cerrarOperacionManualEfevoo(ctx, companyId, entrada.operacionId, motivo, deps);
}

// Ayudantes ----------------------------------------------------------------------------

function llave(valor: unknown): string {
  if (typeof valor !== "string" || !UUID.test(valor)) throw new ErrorDeDominio("formulario_invalido");
  return valor.toLowerCase();
}

function tarjetaId(valor: unknown): string {
  if (typeof valor !== "string" || !UUID.test(valor)) throw new ErrorDeDominio("tarjeta_no_encontrada");
  return valor.toLowerCase();
}

async function idepDe(ctx: ContextoDePersonal, companyId: string): Promise<number> {
  const idep = await conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    const r = (await aplicarSentencia(consulta, "select idep_cliente from efevoo_clientes where company_id = $1", [companyId])).rows[0];
    return r ? centavos(registro(r).idep_cliente) : null;
  });
  if (!idep) throw new ErrorDeDominio("empresa_sin_vinculo");
  return idep;
}

async function tarjetaDeAsignacion(ctx: ContextoDePersonal, companyId: string, asignacion: Ejecutada): Promise<string | null> {
  if (!asignacion.idEfevoo) return null;
  return conContexto(basePlataforma(ctx, companyId), async (consulta) => {
    const r = (await aplicarSentencia(
      consulta, "select id from efevoo_tarjetas where company_id = $1 and ambiente = $2 and id_efevoo = $3::integer",
      [companyId, asignacion.ambiente, asignacion.idEfevoo],
    )).rows[0];
    return r ? texto(registro(r).id) : null;
  });
}
