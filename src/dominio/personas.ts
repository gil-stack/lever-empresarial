import { clabeValida } from "./clabe";

export const ROLES_DE_CUENTA = [
  "administrador",
  "solicitante",
  "liberador",
  "tarjetahabiente",
  "contador",
] as const;

export type RolCuenta = (typeof ROLES_DE_CUENTA)[number];

/**
 * Reglas del maestro que la pantalla y el servidor comparten.
 *
 * Soltar dinero es el rol liberador, y tienen que ser dos personas distintas.
 * El administrador da de alta. El contador ve y no libera. Nadie dispersa.
 */

export const FRASE_CONTADOR = "El contador no tiene la acción de liberar.";
export const FRASE_SIN_DISPERSION = "No se dispersa dinero.";

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
  | "contrasena"
  | "rol"
  | "centroNombre"
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
  | "centro_invalido";

export type EstadoMaestro =
  | { tipo: "inicial" }
  | { tipo: "invalido"; errores: ErrorCampo[] }
  | { tipo: "rechazado"; codigo: CodigoRechazoPersona }
  | { tipo: "listo"; mensaje: string };

export const ESTADO_MAESTRO_INICIAL: EstadoMaestro = { tipo: "inicial" };

const ORDEN_CAMPOS: readonly CampoPersona[] = [
  "centroNombre",
  "nombre",
  "alta",
  "baja",
  "centro",
  "jefe",
  "clabe",
  "acceso",
  "correo",
  "contrasena",
  "rol",
  "persona",
];

export function ordenarErroresPersona(errores: readonly ErrorCampo[]): ErrorCampo[] {
  return [...errores].sort(
    (a, b) => ORDEN_CAMPOS.indexOf(a.campo) - ORDEN_CAMPOS.indexOf(b.campo),
  );
}

export function puedeVerMaestro(rol: RolCuenta | null | undefined): boolean {
  return rol === "administrador" || rol === "contador" || rol === "liberador";
}

export function puedeEditarMaestro(rol: RolCuenta | null | undefined): boolean {
  return rol === "administrador";
}

/** Solo el liberador está autorizado a soltar dinero. El contador no. */
export function puedeSoltarDinero(rol: RolCuenta | null | undefined): boolean {
  return rol === "liberador";
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
  rol: RolCuenta | null;
  deBaja: boolean;
  autorizados: number;
  actorId: string;
  otraFirmaId?: string | null;
}): CodigoLiberacion {
  if (!puedeSoltarDinero(hechos.rol) || hechos.deBaja) return "sin_accion_de_liberar";
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

export type AccesoNuevo = {
  tipo: "nueva";
  correo: string;
  contrasena: string;
  rol: RolCuenta;
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
  clabe: string;
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
  clabe?: unknown;
  acceso?: unknown;
  correo?: unknown;
  contrasena?: unknown;
  rol?: unknown;
};

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
  const errores: Hallazgo[] = [];
  const nombre = normalizarNombrePersona(entrada.nombre);
  if (!nombre) errores.push({ codigo: "nombre_invalido", campo: "nombre" });

  const altaEn = fechaValida(entrada.alta);
  if (!altaEn) errores.push({ codigo: "fecha_invalida", campo: "alta" });
  else if (altaEn > hoy) errores.push({ codigo: "alta_futura", campo: "alta" });

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

  const clabe = clabeValida(entrada.clabe);
  if (!clabe.ok) errores.push({ codigo: "clabe_invalida", campo: "clabe" });

  const acceso = entrada.acceso;
  if (acceso !== "no" && acceso !== "nueva" && acceso !== "ya") {
    errores.push({ codigo: "acceso_invalido", campo: "acceso" });
  }

  const correo = normalizarCorreoPersona(entrada.correo);
  let contrasena = "";
  let rol: RolCuenta | null = null;
  if (acceso === "nueva" || acceso === "ya") {
    if (!correoPersonaValido(correo)) errores.push({ codigo: "correo_invalido", campo: "correo" });
  }
  if (acceso === "nueva") {
    contrasena = typeof entrada.contrasena === "string" ? entrada.contrasena : "";
    if (!contrasenaPersonaValida(contrasena)) {
      errores.push({ codigo: "contrasena_invalida", campo: "contrasena" });
    }
    rol = rolDeCuenta(entrada.rol);
    if (!rol) errores.push({ codigo: "rol_invalido", campo: "rol" });
  }

  if (errores.length > 0 || !nombre || !altaEn || !clabe.ok || !UUID.test(centroId)) {
    return { errores, valor: null };
  }
  if (acceso === "no") {
    return {
      errores,
      valor: {
        nombre,
        altaEn,
        bajaEn,
        centroId,
        jefeId,
        clabe: clabe.clabe,
        acceso: { tipo: "no" },
      },
    };
  }
  if (!correoPersonaValido(correo)) return { errores, valor: null };
  if (acceso === "ya") {
    return {
      errores,
      valor: {
        nombre,
        altaEn,
        bajaEn,
        centroId,
        jefeId,
        clabe: clabe.clabe,
        acceso: { tipo: "ya", correo },
      },
    };
  }
  if (!rol || !contrasenaPersonaValida(contrasena)) return { errores, valor: null };
  return {
    errores,
    valor: {
      nombre,
      altaEn,
      bajaEn,
      centroId,
      jefeId,
      clabe: clabe.clabe,
      acceso: { tipo: "nueva", correo, contrasena, rol },
    },
  };
}

export function validarCentro(entrada: { nombre?: unknown }): ResultadoCentro {
  const nombre = normalizarCentro(entrada.nombre);
  if (!nombre) return { ok: false, codigo: "centro_nombre_invalido" };
  return { ok: true, nombre };
}

type ResultadoCentro = { ok: true; nombre: string } | { ok: false; codigo: "centro_nombre_invalido" };

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
  return "Tarjetahabiente. No abre este maestro.";
}

export function pistaDelRol(rol: RolCuenta | ""): string {
  if (rol === "contador") return "Ve el maestro. No tiene la acción de liberar.";
  if (rol === "liberador") {
    return "Puede soltar dinero. Hacen falta dos personas distintas. Hoy no se dispersa.";
  }
  if (rol === "administrador") return "Da de alta a las personas. Este rol no suelta dinero.";
  if (rol === "solicitante") return "Puede pedir un pago, cuando esa pantalla exista. No lo suelta.";
  if (rol === "tarjetahabiente") return "El gasto vive en el teléfono. No abre este maestro.";
  return "Elige el rol con el que va a entrar.";
}

export const MENSAJE_CAMPO: Record<string, ErrorCampo> = {
  nombre_invalido: { campo: "nombre", mensaje: "Escribe el nombre de la persona." },
  fecha_invalida: { campo: "alta", mensaje: "Esa fecha no existe." },
  alta_futura: { campo: "alta", mensaje: "La fecha de alta no puede ser posterior a hoy." },
  baja_anterior: { campo: "baja", mensaje: "La baja no puede ser anterior al alta." },
  centro_invalido: { campo: "centro", mensaje: "Elige un centro de costo de esta empresa." },
  centro_nombre_invalido: { campo: "centroNombre", mensaje: "Escribe el nombre del centro de costo." },
  jefe_invalido: { campo: "jefe", mensaje: "Elige un jefe de esta empresa, o déjalo sin jefe." },
  jefe_de_baja: { campo: "jefe", mensaje: "Esa persona ya está de baja. Elige otro jefe." },
  clabe_invalida: {
    campo: "clabe",
    mensaje: "Esa CLABE no cierra. El dígito usa la ponderación 3, 7 y 1.",
  },
  acceso_invalido: { campo: "acceso", mensaje: "Elige si entra a la consola." },
  correo_invalido: { campo: "correo", mensaje: "Escribe un correo válido." },
  contrasena_invalida: {
    campo: "contrasena",
    mensaje: "La contraseña necesita al menos 10 caracteres. Si es demasiado larga, elige otra.",
  },
  rol_invalido: { campo: "rol", mensaje: "Elige un rol de la cuenta." },
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
    texto: "Primero se da de alta la empresa. Luego, las personas.",
  },
  libro: {
    titulo: "No se guardó",
    texto: "No se pudo confirmar el maestro. Vuelve a intentar.",
  },
  correo_ya_entra: {
    titulo: "Ese correo ya entra",
    texto: "Ya está en esta cuenta. Márcalo como «Ya entra». No se cambia el rol ni la contraseña.",
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
    titulo: "El centro no entra",
    texto: "Elige un centro de costo de esta empresa.",
  },
};

export const ROLES_VISIBLES: readonly { valor: RolCuenta; etiqueta: string }[] = [
  { valor: "administrador", etiqueta: "Administrador" },
  { valor: "solicitante", etiqueta: "Solicitante" },
  { valor: "liberador", etiqueta: "Liberador" },
  { valor: "tarjetahabiente", etiqueta: "Tarjetahabiente" },
  { valor: "contador", etiqueta: "Contador" },
];
