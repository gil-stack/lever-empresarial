import { capacidadesDe, ROLES_CLIENTE, rolesLeidos, tiene, tieneRolDeTrabajo, type RolCliente } from "../nucleo/capacidades";
import { leerCentavosEscritos } from "./centavos";
import { clabeValida } from "./clabe";

export const ROLES_DE_CUENTA = ROLES_CLIENTE;

export type RolCuenta = RolCliente;

/**
 * Reglas del maestro que la pantalla y el servidor comparten.
 *
 * Soltar dinero es el rol liberador, y tienen que ser dos personas distintas.
 * El administrador da de alta. El contador ve y no libera. Nadie dispersa.
 */

export const FRASE_CONTADOR = "El contador no tiene la acción de liberar.";

export const ACCESOS = ["no", "nueva", "ya"] as const;
export type AccesoForma = (typeof ACCESOS)[number];

const CORREO = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

export type CampoPersona =
  | "nombre"
  | "alta"
  | "baja"
  | "centro"
  | "jefe"
  | "clabe"
  | "acceso"
  | "correo"
  | "rol"
  | "centroNombre"
  | "centroPresupuesto"
  | "presupuesto"
  | "neto"
  | "frecuencia"
  | "primerPago"
  | "destino"
  | "persona";

export type ErrorCampo = {
  campo: CampoPersona;
  mensaje: string;
};

export type CodigoRechazoPersona =
  | "sin_permiso"
  | "maestro_no_disponible"
  | "sesion"
  | "sin_empresa"
  | "libro"
  | "correo_ya_entra"
  | "correo_no_disponible"
  | "persona_no_esta"
  | "persona_repetida"
  | "persona_ausente"
  | "centro_duplicado"
  | "jefe_invalido"
  | "jefe_ciclo"
  | "alta_posterior_pago"
  | "centro_invalido"
  | "persona_de_baja"
  | "nomina_sin_vencimientos"
  | "nomina_aun_no_vence"
  | "nomina_sin_personas"
  | "fecha_ya_preparada"
  | "destino_incompleto"
  | "lote_ausente"
  | "auditoria"
  | "ultimo_administrador"
  | "reautenticacion_requerida"
  | "clabe_requerida"
  | "clabe_misma"
  | "baja_ya_efectiva"
  | "sin_baja_programada"
  | "nomina_fecha_distinta"
  | "lote_inconsistente"
  | "lote_inmutable"
  | "persona_identidad_inmutable"
  | "baja_no_efectiva"
  | "empresa_suspendida"
  | "nomina_bloqueada_lpb";

export type EstadoMaestro =
  | { tipo: "inicial" }
  | { tipo: "invalido"; errores: ErrorCampo[] }
  | { tipo: "rechazado"; codigo: CodigoRechazoPersona }
  | { tipo: "listo"; mensaje: string; id?: string };

export const ESTADO_MAESTRO_INICIAL: EstadoMaestro = { tipo: "inicial" };

/**
 * Resultado de dar o quitar Finanzas. Lleva el valor real de la casilla:
 * si el guardado falla, la casilla regresa a lo que la base conserva.
 */
export type EstadoFinanzas =
  | { tipo: "inicial" }
  | { tipo: "listo"; mensaje: string; habilitado: boolean }
  | { tipo: "rechazado"; codigo: CodigoFinanzas; habilitado: boolean };

export const ESTADO_FINANZAS_INICIAL: EstadoFinanzas = { tipo: "inicial" };

export type CodigoFinanzas =
  | "sesion"
  | "sin_permiso"
  | "identificador_invalido"
  | "sin_membresia"
  | "rol_existente"
  | "ultimo_rol"
  | "empresa_suspendida"
  | "libro";

export const MENSAJE_FINANZAS: Record<CodigoFinanzas, { titulo: string; texto: string }> = {
  sesion: { titulo: "Hay que entrar", texto: "Vuelve a entrar para cambiar el acceso financiero." },
  sin_permiso: {
    titulo: "No se guardó",
    texto: "Solo quien administra la empresa da o retira el acceso a Inicio financiero.",
  },
  identificador_invalido: {
    titulo: "No se guardó",
    texto: "No reconocimos a la persona. Recarga la página y vuelve a intentar.",
  },
  sin_membresia: {
    titulo: "No se guardó",
    texto: "Esa persona no tiene una cuenta activa en esta empresa. Su acceso no cambió.",
  },
  rol_existente: {
    titulo: "Ya tenía el acceso",
    texto: "Esa persona ya podía ver Inicio financiero. No cambió nada.",
  },
  ultimo_rol: {
    titulo: "No se quitó",
    texto: "Finanzas es su único rol y nadie queda sin rol. Dale primero su rol de trabajo.",
  },
  empresa_suspendida: {
    titulo: "La empresa está suspendida",
    texto: "El acceso no cambia mientras la empresa esté suspendida. Comunícate con Lever.",
  },
  libro: { titulo: "No se guardó", texto: "No se pudo confirmar el cambio. Vuelve a intentar." },
};

const ORDEN_CAMPOS: readonly CampoPersona[] = [
  "centroNombre",
  "centroPresupuesto",
  "nombre",
  "alta",
  "baja",
  "centro",
  "jefe",
  "presupuesto",
  "neto",
  "frecuencia",
  "primerPago",
  "destino",
  "clabe",
  "acceso",
  "correo",
  "rol",
  "persona",
];

export function ordenarErroresPersona(errores: readonly ErrorCampo[]): ErrorCampo[] {
  return [...errores].sort(
    (a, b) => ORDEN_CAMPOS.indexOf(a.campo) - ORDEN_CAMPOS.indexOf(b.campo),
  );
}

/** Quién suelta dinero lo dice la matriz de capacidades, no este módulo. */
function sueltaDinero(roles: readonly RolCuenta[]): boolean {
  return tiene(capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }), "cliente.pago.liberar");
}

export function empresaOperable(autorizados: number): boolean {
  return autorizados >= 2;
}

export type CodigoLiberacion =
  | "sin_accion_de_liberar"
  | "empresa_no_operable"
  | "misma_firma"
  | "sin_dispersion";

/**
 * No hay un resultado que mueva dinero. Con dos liberadores distintos la
 * respuesta sigue siendo que esta fase no dispersa.
 */
export function decidirLiberacion(hechos: {
  roles: readonly RolCuenta[];
  deBaja: boolean;
  autorizados: number;
  actorId: string;
  otraFirmaId?: string | null;
}): CodigoLiberacion {
  if (!sueltaDinero(hechos.roles) || hechos.deBaja) return "sin_accion_de_liberar";
  if (!empresaOperable(hechos.autorizados)) return "empresa_no_operable";
  if (!hechos.otraFirmaId || mismoId(hechos.otraFirmaId, hechos.actorId)) return "misma_firma";
  return "sin_dispersion";
}

function mismoId(izquierda: string, derecha: string): boolean {
  return izquierda.toLowerCase() === derecha.toLowerCase();
}

export function hoyEnMexico(ahora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
  const tomar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${tomar("year")}-${tomar("month")}-${tomar("day")}`;
}

export function fechaValida(valor: unknown): string | null {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const [anio, mes, dia] = valor.split("-").map(Number);
  if (!anio || !mes || !dia || anio < 2000 || anio > 2100) return null;
  const utc = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    utc.getUTCFullYear() !== anio ||
    utc.getUTCMonth() !== mes - 1 ||
    utc.getUTCDate() !== dia
  ) {
    return null;
  }
  return valor;
}

const ANIO_SIN_ELEGIR = "0000";
const MES_SIN_ELEGIR = "00";
const DIA_SIN_ELEGIR = "00";

/**
 * La pantalla elige día, mes y año por separado. Un hueco se guarda en
 * cero para que las otras dos listas no vuelvan a «Día», «Mes» y «Año».
 * `fechaValida` sigue rechazando el 31 de un mes corto y la fecha a medias.
 */
export function partesDeFecha(valor: string): { dia: string; mes: string; anio: string } {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!coincidencia) return { dia: "", mes: "", anio: "" };
  const anio = coincidencia[1] === ANIO_SIN_ELEGIR ? "" : (coincidencia[1] ?? "");
  const mes = coincidencia[2] === MES_SIN_ELEGIR ? "" : (coincidencia[2] ?? "");
  const diaCrudo = coincidencia[3] ?? "";
  const dia = diaCrudo === DIA_SIN_ELEGIR ? "" : String(Number(diaCrudo));
  return { dia, mes, anio };
}

export function fechaDesdePartes(partes: { dia: string; mes: string; anio: string }): string {
  if (!partes.dia && !partes.mes && !partes.anio) return "";
  const anio = partes.anio || ANIO_SIN_ELEGIR;
  const mes = partes.mes || MES_SIN_ELEGIR;
  const dia = partes.dia ? partes.dia.padStart(2, "0") : DIA_SIN_ELEGIR;
  return `${anio}-${mes}-${dia}`;
}

export function fechaLarga(iso: string): string {
  const valida = fechaValida(iso);
  if (!valida) return iso;
  const [anio, mes, dia] = valida.split("-").map(Number);
  return `${dia} de ${MESES[(mes ?? 1) - 1]} de ${anio}`;
}

export function estaDeBaja(baja: string | null, hoy: string): boolean {
  return baja !== null && baja <= hoy;
}

/**
 * La misma regla que el alta: Finanzas se suma a cualquier rol de trabajo,
 * también al tarjetahabiente. Con administración ya viene incluido. Quien no
 * tiene cuenta activa o ya está de baja no recibe la casilla.
 */
export function accesoFinanzasDe(
  persona: { userId: string | null; roles: readonly RolCliente[]; invitada: boolean; bajaEn: string | null },
  hoy: string,
): "incluido" | "casilla" | null {
  if (!persona.userId || persona.invitada || persona.roles.length === 0 || estaDeBaja(persona.bajaEn, hoy)) return null;
  return persona.roles.includes("administrador") ? "incluido" : "casilla";
}

export function normalizarNombrePersona(valor: unknown): string | null {
  if (typeof valor !== "string" || CONTROL.test(valor)) return null;
  const nombre = valor.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (nombre.length < 1 || nombre.length > 120) return null;
  if (!/[\p{L}\p{N}]/u.test(nombre)) return null;
  return nombre;
}

export function normalizarCentro(valor: unknown): string | null {
  if (typeof valor !== "string" || CONTROL.test(valor)) return null;
  const nombre = valor.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (nombre.length < 1 || nombre.length > 80) return null;
  if (!/[\p{L}\p{N}]/u.test(nombre)) return null;
  return nombre;
}

export function normalizarCorreoPersona(valor: unknown): string {
  return typeof valor === "string" ? valor.trim().toLowerCase() : "";
}

export function correoPersonaValido(correo: string): boolean {
  return correo.length <= 254 && CORREO.test(correo);
}

export function contrasenaPersonaValida(contrasena: string): boolean {
  if (contrasena.length < 10 || contrasena.trim().length === 0) return false;
  return new TextEncoder().encode(contrasena).length <= 72;
}

export function rolDeCuenta(valor: unknown): RolCuenta | null {
  return ROLES_DE_CUENTA.find((rol) => rol === valor) ?? null;
}

/** Los roles llegan como un valor o como varios. Un rol desconocido invalida la lista. */
export function rolesDeCuenta(valor: unknown): RolCuenta[] | null {
  const crudos = Array.isArray(valor) ? valor : valor === undefined || valor === null || valor === "" ? [] : [valor];
  if (crudos.length === 0 || crudos.length > ROLES_DE_CUENTA.length) return null;
  if (!crudos.every((crudo) => rolDeCuenta(crudo) !== null)) return null;
  // Las membresías históricas conservan solicitante; no se ofrece en altas nuevas.
  if (crudos.includes("solicitante")) return null;
  return rolesLeidos(crudos);
}

/** La persona recibe una invitación y fija su propia contraseña. Nadie más la conoce. */
export type AccesoNuevo = {
  tipo: "nueva";
  correo: string;
  roles: RolCuenta[];
};

export type AccesoYa = {
  tipo: "ya";
  correo: string;
};

export type AccesoNo = {
  tipo: "no";
};

export type AltaPersonaValida = {
  nombre: string;
  altaEn: string;
  bajaEn: string | null;
  centroId: string;
  jefeId: string | null;
  presupuestoCentavos: number | null;
  altaLlave: string | null;
  clabe: string | null;
  /** Vacío: la persona no recibe nómina por aquí (solo acceso o solo ficha). */
  destino: "clabe" | "tarjeta" | null;
  acceso: AccesoNuevo | AccesoYa | AccesoNo;
};

export type ResultadoAltaPersona =
  | { ok: true; valor: AltaPersonaValida }
  | { ok: false; codigo: string; campo: CampoPersona };

export type EntradaAltaPersona = {
  nombre?: unknown;
  alta?: unknown;
  baja?: unknown;
  centroId?: unknown;
  jefeId?: unknown;
  presupuesto?: unknown;
  altaLlave?: unknown;
  destino?: unknown;
  clabe?: unknown;
  acceso?: unknown;
  correo?: unknown;
  rol?: unknown;
  /** «si» o «no». Sin decirlo, la alta lleva nómina si trae neto, frecuencia o primer pago. */
  nomina?: unknown;
  neto?: unknown;
  frecuencia?: unknown;
  primerPago?: unknown;
};

/**
 * Una persona «solo acceso» no recibe nómina: no se le exige neto, destino
 * ni CLABE. Un campo vacío de FormData llega como null o "": no cuenta.
 */
export function altaConNomina(entrada: EntradaAltaPersona): boolean {
  if (entrada.nomina === "no") return false;
  if (entrada.nomina === "si") return true;
  return [entrada.neto, entrada.frecuencia, entrada.primerPago].some(presente);
}

function presente(valor: unknown): boolean {
  if (valor === undefined || valor === null) return false;
  return !(typeof valor === "string" && valor.trim() === "");
}

type Hallazgo = { codigo: string; campo: CampoPersona };

export function validarAltaPersona(entrada: EntradaAltaPersona, hoy: string): ResultadoAltaPersona {
  const armado = armarAlta(entrada, hoy);
  const primero = armado.errores[0];
  if (primero || !armado.valor) {
    return {
      ok: false,
      codigo: primero?.codigo ?? "nombre_invalido",
      campo: primero?.campo ?? "nombre",
    };
  }
  return { ok: true, valor: armado.valor };
}

function armarAlta(
  entrada: EntradaAltaPersona,
  hoy: string,
): { errores: Hallazgo[]; valor: AltaPersonaValida | null } {
  void hoy; // Las contrataciones futuras sí son válidas; el primer pago valida su propia fecha.
  const errores: Hallazgo[] = [];
  const nombre = normalizarNombrePersona(entrada.nombre);
  if (!nombre) errores.push({ codigo: "nombre_invalido", campo: "nombre" });

  const altaEn = fechaValida(entrada.alta);
  if (!altaEn) errores.push({ codigo: "fecha_invalida", campo: "alta" });

  const bajaCruda = typeof entrada.baja === "string" ? entrada.baja.trim() : "";
  let bajaEn: string | null = null;
  if (bajaCruda.length > 0) {
    const baja = fechaValida(bajaCruda);
    if (!baja) errores.push({ codigo: "fecha_invalida", campo: "baja" });
    else if (altaEn && baja < altaEn) errores.push({ codigo: "baja_anterior", campo: "baja" });
    else bajaEn = baja;
  }

  const centroId = typeof entrada.centroId === "string" ? entrada.centroId.trim() : "";
  if (!UUID.test(centroId)) errores.push({ codigo: "centro_invalido", campo: "centro" });

  const jefeCrudo = typeof entrada.jefeId === "string" ? entrada.jefeId.trim() : "";
  let jefeId: string | null = null;
  if (jefeCrudo.length > 0) {
    if (!UUID.test(jefeCrudo)) errores.push({ codigo: "jefe_invalido", campo: "jefe" });
    else jefeId = jefeCrudo;
  }

  const presupuesto = leerCentavosEscritos(typeof entrada.presupuesto === "string" ? entrada.presupuesto : "");
  if (presupuesto.tipo === "invalido") errores.push({ codigo: "presupuesto_invalido", campo: "presupuesto" });
  const presupuestoCentavos = presupuesto.tipo === "centavos" ? presupuesto.centavos : null;

  const llaveCruda = typeof entrada.altaLlave === "string" ? entrada.altaLlave.trim() : "";
  const altaLlave = llaveCruda || null;
  if (altaLlave && !UUID.test(altaLlave)) errores.push({ codigo: "alta_llave_invalida", campo: "persona" });

  const destinoCrudo = presente(entrada.destino) ? entrada.destino : altaConNomina(entrada) ? "clabe" : null;
  const destinoValido = destinoCrudo === null || destinoCrudo === "clabe" || destinoCrudo === "tarjeta";
  if (!destinoValido) errores.push({ codigo: "destino_invalido", campo: "destino" });
  const destino = destinoCrudo === "clabe" || destinoCrudo === "tarjeta" ? destinoCrudo : null;
  const clabeCruda = typeof entrada.clabe === "string" ? entrada.clabe.trim() : "";
  const clabe = clabeCruda ? clabeValida(clabeCruda) : null;
  if ((destino === "clabe" && !clabe?.ok) || (clabe && !clabe.ok)) {
    errores.push({ codigo: "clabe_invalida", campo: "clabe" });
  }

  const acceso = entrada.acceso;
  if (acceso !== "no" && acceso !== "nueva" && acceso !== "ya") {
    errores.push({ codigo: "acceso_invalido", campo: "acceso" });
  }

  const correo = normalizarCorreoPersona(entrada.correo);
  let roles: RolCuenta[] | null = null;
  if (acceso === "nueva" || acceso === "ya") {
    if (!correoPersonaValido(correo)) errores.push({ codigo: "correo_invalido", campo: "correo" });
  }
  if (acceso === "nueva") {
    roles = rolesDeCuenta(entrada.rol);
    if (!roles) errores.push({ codigo: "rol_invalido", campo: "rol" });
    else if (!tieneRolDeTrabajo(roles)) errores.push({ codigo: "finanzas_sin_rol", campo: "rol" });
  }

  if (errores.length > 0 || !nombre || !altaEn || !UUID.test(centroId) || !destinoValido) {
    return { errores, valor: null };
  }
  const base = {
    nombre,
    altaEn,
    bajaEn,
    centroId,
    jefeId,
    presupuestoCentavos,
    altaLlave,
    clabe: clabe?.ok ? clabe.clabe : null,
    destino,
  } as const;
  if (acceso === "no") return { errores, valor: { ...base, acceso: { tipo: "no" } } };
  if (!correoPersonaValido(correo)) return { errores, valor: null };
  if (acceso === "ya") return { errores, valor: { ...base, acceso: { tipo: "ya", correo } } };
  if (!roles) return { errores, valor: null };
  return { errores, valor: { ...base, acceso: { tipo: "nueva", correo, roles } } };
}

export function validarCentro(entrada: {
  nombre?: unknown;
  presupuesto?: unknown;
  esTesoreria?: unknown;
}): ResultadoCentro {
  const nombre = normalizarCentro(entrada.nombre);
  if (!nombre) return { ok: false, codigo: "centro_nombre_invalido" };
  const monto = leerCentavosEscritos(typeof entrada.presupuesto === "string" ? entrada.presupuesto : "");
  if (monto.tipo === "invalido") return { ok: false, codigo: "centro_presupuesto_invalido" };
  return {
    ok: true,
    nombre,
    presupuestoCentavos: monto.tipo === "centavos" ? monto.centavos : null,
    esTesoreria: entrada.esTesoreria === true || entrada.esTesoreria === "si",
  };
}

export type CentroValido = {
  nombre: string;
  presupuestoCentavos: number | null;
  esTesoreria: boolean;
};

type ResultadoCentro =
  | ({ ok: true } & CentroValido)
  | { ok: false; codigo: "centro_nombre_invalido" | "centro_presupuesto_invalido" };

export function validarBaja(entrada: { personaId?: unknown; baja?: unknown }): ResultadoBaja {
  const personaId = typeof entrada.personaId === "string" ? entrada.personaId.trim() : "";
  if (!UUID.test(personaId)) return { ok: false, codigo: "persona_ausente" };
  const bajaEn = fechaValida(entrada.baja);
  if (!bajaEn) return { ok: false, codigo: "fecha_invalida" };
  return { ok: true, personaId, bajaEn };
}

type ResultadoBaja =
  | { ok: true; personaId: string; bajaEn: string }
  | { ok: false; codigo: "persona_ausente" | "fecha_invalida" };

export function relatoOperabilidad(nombres: readonly string[]): {
  titulo: string;
  detalle: string;
  operable: boolean;
} {
  const ordenados = [...nombres].sort((a, b) => a.localeCompare(b, "es"));
  if (ordenados.length >= 2) {
    const detalle =
      ordenados.length === 2
        ? `${ordenados[0]} y ${ordenados[1]} pueden soltar dinero.`
        : `${ordenados[0]}, ${ordenados[1]} y ${ordenados.length - 2} más pueden soltar dinero.`;
    return { operable: true, titulo: "Hay dos personas autorizadas.", detalle };
  }
  if (ordenados.length === 1) {
    return {
      operable: false,
      titulo: "Esta empresa no está operable.",
      detalle: `${ordenados[0]} es la única persona autorizada a soltar dinero. Hace falta otra, distinta.`,
    };
  }
  return {
    operable: false,
    titulo: "Esta empresa no está operable.",
    detalle: "Hacen falta dos personas distintas autorizadas a soltar dinero. El rol es liberador.",
  };
}

export function lineaDeRol(rol: RolCuenta | null): string {
  if (rol === null) return "No entra a la consola.";
  if (rol === "contador") return `Contador. ${FRASE_CONTADOR}`;
  if (rol === "liberador") return "Liberador. Puede soltar dinero.";
  if (rol === "administrador") return "Administrador. No suelta dinero por este rol.";
  if (rol === "solicitante") return "Solicitante. Pide, no suelta.";
  if (rol === "finanzas") return "Finanzas. Ve Inicio y sus movimientos; no mueve dinero.";
  return "Tarjetahabiente. No abre este maestro.";
}

/** Una persona puede tener varios roles. Si ninguno suelta dinero, se dice una vez. */
export function lineaDeRoles(roles: readonly RolCuenta[], invitada = false): string {
  if (roles.length === 0) return "No entra a la consola.";
  if (roles.length === 1) return invitada ? `${lineaDeRol(roles[0] ?? null)} Invitación pendiente.` : lineaDeRol(roles[0] ?? null);
  const etiquetas = roles.map((rol) => ETIQUETA_ROL[rol]);
  const ultima = etiquetas.pop();
  const lista = `${etiquetas.join(", ")} y ${ultima?.toLocaleLowerCase("es-MX")}`;
  const dinero = sueltaDinero(roles) ? "Puede soltar dinero." : "No suelta dinero.";
  return `${lista}. ${dinero}${invitada ? " Invitación pendiente." : ""}`;
}

const ETIQUETA_ROL: Record<RolCuenta, string> = {
  administrador: "Administrador",
  solicitante: "Solicitante",
  liberador: "Liberador",
  tarjetahabiente: "Tarjetahabiente",
  contador: "Contador",
  finanzas: "Finanzas",
};

/** El nombre de un rol tal como lo lee la persona (por ejemplo, en el menú de su cuenta). */
export function etiquetaDelRol(rol: RolCuenta): string {
  return ETIQUETA_ROL[rol];
}

export const MENSAJE_CAMPO: Record<string, ErrorCampo> = {
  nombre_invalido: { campo: "nombre", mensaje: "Escribe el nombre de la persona." },
  fecha_invalida: { campo: "alta", mensaje: "Esa fecha no existe." },
  alta_futura: { campo: "alta", mensaje: "La fecha de alta no puede ser posterior a hoy." },
  baja_anterior: { campo: "baja", mensaje: "La baja no puede ser anterior al alta." },
  centro_invalido: { campo: "centro", mensaje: "Elige un centro de costo de esta empresa." },
  centro_nombre_invalido: { campo: "centroNombre", mensaje: "Escribe el nombre del área." },
  centro_presupuesto_invalido: { campo: "centroPresupuesto", mensaje: "Escribe un presupuesto mensual válido." },
  presupuesto_invalido: { campo: "presupuesto", mensaje: "Escribe un presupuesto mensual válido o déjalo vacío." },
  destino_invalido: { campo: "destino", mensaje: "Elige CLABE externa o tarjeta de nómina." },
  alta_llave_invalida: { campo: "persona", mensaje: "No se pudo confirmar el alta. Vuelve a intentar." },
  jefe_invalido: { campo: "jefe", mensaje: "Elige un jefe de esta empresa, o déjalo sin jefe." },
  jefe_de_baja: { campo: "jefe", mensaje: "Esa persona ya está de baja. Elige otro jefe." },
  clabe_invalida: {
    campo: "clabe",
    mensaje: "Esa CLABE no cierra. El dígito usa la ponderación 3, 7 y 1.",
  },
  acceso_invalido: { campo: "acceso", mensaje: "Elige si entra a la consola." },
  correo_invalido: { campo: "correo", mensaje: "Escribe un correo válido." },
  rol_invalido: { campo: "rol", mensaje: "Elige al menos un rol de la cuenta." },
  finanzas_sin_rol: { campo: "rol", mensaje: "Finanzas es un acceso adicional. Elige también el rol de trabajo de la persona." },
  neto_invalido: { campo: "neto", mensaje: "Escribe el neto que recibirá en cada pago." },
  frecuencia_invalida: { campo: "frecuencia", mensaje: "Elige semanal, quincenal o mensual." },
  primer_pago_invalido: { campo: "primerPago", mensaje: "Revisa la fecha del primer pago." },
  nomina_invalida: { campo: "neto", mensaje: "Revisa neto, frecuencia, primer pago y destino." },
};

export function erroresDeAltaPersona(entrada: EntradaAltaPersona, hoy: string): ErrorCampo[] {
  return ordenarErroresPersona(
    armarAlta(entrada, hoy).errores.map((item) => ({
      campo: item.campo,
      mensaje: MENSAJE_CAMPO[item.codigo]?.mensaje ?? "Revisa el dato.",
    })),
  );
}

export const MENSAJE_RECHAZO: Record<
  CodigoRechazoPersona,
  { titulo: string; texto: string }
> = {
  sin_permiso: {
    titulo: "No se guardó",
    texto: "Con este rol no se da de alta a personas.",
  },
  maestro_no_disponible: {
    titulo: "Este rol no abre el maestro",
    texto: "La CLABE de las personas la ve quien administra, quien libera y el contador.",
  },
  sesion: {
    titulo: "Hay que entrar",
    texto: "Vuelve a entrar para guardar el maestro.",
  },
  sin_empresa: {
    titulo: "Todavía no hay razón social",
    texto: "La SOFIPO da de alta a las empresas. Luego, sus personas.",
  },
  libro: {
    titulo: "No se guardó",
    texto: "No se pudo confirmar el maestro. Vuelve a intentar.",
  },
  correo_ya_entra: {
    titulo: "Ese correo ya entra",
    texto: "Ya está en esta cuenta. Márcalo como «Ya entra». No se cambian sus roles.",
  },
  correo_no_disponible: {
    titulo: "Ese correo no se puede usar",
    texto: "Elige otro correo para esta persona.",
  },
  persona_no_esta: {
    titulo: "Ese correo no entra",
    texto: "No hay una persona con ese correo en esta cuenta.",
  },
  persona_repetida: {
    titulo: "Ya está en el maestro",
    texto: "Esa persona ya tiene ficha. No se duplica.",
  },
  persona_ausente: {
    titulo: "No está en esta empresa",
    texto: "Esa persona no está en el maestro de esta cuenta.",
  },
  centro_duplicado: {
    titulo: "Ese centro ya está",
    texto: "El nombre ya existe en esta empresa.",
  },
  jefe_invalido: {
    titulo: "El jefe no entra",
    texto: "Elige un jefe de esta empresa, o déjalo sin jefe.",
  },
  centro_invalido: {
    titulo: "El área no entra",
    texto: "Elige un área de esta empresa.",
  },
  jefe_ciclo: {
    titulo: "La jerarquía se haría circular",
    texto: "Elige un jefe que no dependa de esta persona.",
  },
  alta_posterior_pago: {
    titulo: "El ingreso queda después del pago",
    texto: "Cambia primero la fecha de nómina o elige un ingreso anterior al próximo pago.",
  },
  persona_de_baja: {
    titulo: "La persona ya está de baja",
    texto: "No se puede configurar una nómina nueva para una baja efectiva.",
  },
  nomina_sin_vencimientos: {
    titulo: "No hay nómina vencida",
    texto: "La próxima fecha todavía no llega.",
  },
  nomina_aun_no_vence: {
    titulo: "Esa fecha todavía no llega",
    texto: "La nómina se prepara cuando vence, nunca por adelantado en este corte.",
  },
  nomina_sin_personas: {
    titulo: "No hay personas elegibles",
    texto: "Revisa ingresos, bajas y configuración de nómina para esa fecha.",
  },
  fecha_ya_preparada: {
    titulo: "Esa fecha ya tiene un lote",
    texto: "El lote es inmutable. Elige la siguiente fecha de pago para esta persona.",
  },
  destino_incompleto: {
    titulo: "Falta un destino",
    texto: "Hay una persona con CLABE externa incompleta. Complétala antes de preparar.",
  },
  lote_ausente: {
    titulo: "El lote no existe",
    texto: "No pertenece a esta empresa o ya no está disponible.",
  },
  auditoria: {
    titulo: "No se guardó",
    texto: "La bitácora no confirmó el cambio y nada quedó a medias. Vuelve a intentar.",
  },
  ultimo_administrador: {
    titulo: "Es la única persona administradora",
    texto: "La empresa no puede quedarse sin administrador. Da ese rol a otra persona vigente antes de registrar esta baja.",
  },
  reautenticacion_requerida: {
    titulo: "Confirma que eres tú",
    texto: "Cambiar la CLABE de nómina exige haber verificado tu segundo factor en los últimos 30 minutos. Sal y vuelve a entrar, y repite el cambio.",
  },
  clabe_requerida: {
    titulo: "Falta la CLABE de nómina",
    texto: "Registra primero la CLABE en «CLABE de nómina» y después elige ese destino.",
  },
  clabe_misma: {
    titulo: "Es la misma CLABE",
    texto: "La CLABE vigente ya es esa. No se registró un cambio.",
  },
  baja_ya_efectiva: {
    titulo: "La baja ya es efectiva",
    texto: "Una baja que ya llegó a su fecha no se cancela: el acceso ya se cerró.",
  },
  sin_baja_programada: {
    titulo: "No hay baja programada",
    texto: "Esta persona no tiene una baja futura que cancelar.",
  },
  nomina_fecha_distinta: {
    titulo: "La fecha vencida cambió",
    texto: "Mientras revisabas, la nómina vencida dejó de ser la que viste. Recarga la página y revisa de nuevo.",
  },
  lote_inconsistente: {
    titulo: "El lote no cuadra",
    texto: "El total no coincide con sus renglones o no tiene personas. No se guardó nada.",
  },
  lote_inmutable: {
    titulo: "El lote ya está congelado",
    texto: "Un lote preparado no se edita ni se borra.",
  },
  persona_identidad_inmutable: {
    titulo: "Ese dato no cambia",
    texto: "La empresa y el usuario enlazado de una persona no se reasignan.",
  },
  baja_no_efectiva: {
    titulo: "La baja todavía no es efectiva",
    texto: "El acceso se cierra el día de la baja.",
  },
  empresa_suspendida: {
    titulo: "La empresa está suspendida",
    texto: "Mientras esté suspendida no se guardan cambios en Personas ni se prepara nómina. Comunícate con Lever.",
  },
  nomina_bloqueada_lpb: {
    titulo: "La nómina quedó detenida",
    texto: "Hay una revisión de cumplimiento pendiente. No se preparó el lote; Lever te contactará.",
  },
};

export const ROLES_VISIBLES: readonly { valor: RolCuenta; etiqueta: string }[] = [
  { valor: "administrador", etiqueta: "Administrador" },
  { valor: "liberador", etiqueta: "Liberador" },
  { valor: "tarjetahabiente", etiqueta: "Tarjetahabiente" },
  { valor: "contador", etiqueta: "Contador" },
];
