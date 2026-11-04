import { capacidadesDe, ROLES_CLIENTE, tiene, type CapacidadCliente, type RolCliente } from "../../nucleo/capacidades.ts";
import type { Membresia } from "./tipos.ts";

/**
 * Quien suelta dinero tiene la capacidad de liberar, que hoy da solo el rol
 * liberador. El administrador no es una segunda firma por serlo: si también
 * es liberador, sí cuenta. El contador entra a la póliza y no suelta.
 */
export const QUIEN_LIBERA = "liberador" as const;

/** Los roles se combinan. Cada uno se asigna o se quita en su propio acto. */
export const ROLES_ASIGNABLES = ROLES_CLIENTE;

export type RolAsignable = RolCliente;

/** En nómina siempre hay dos firmas. No se abre una tercera. */
export const FIRMAS_DE_NOMINA = 2 as const;

const CLAVES_DE_SOLICITUD = new Set(["companyId", "solicitanteId"]);
const CLAVES_DE_LIBERACION = new Set(["companyId", "loteId"]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CodigoDeEntrada = "entrada_invalida" | "dinero_real_fuera" | "tercera_firma" | "identificador_invalido";

export type CodigoDeFirmas =
  | "sin_membresia"
  | "misma_persona_en_las_dos_firmas"
  | "firma_ajena"
  | "firma_en_un_solo_acto"
  | "contador_no_libera"
  | "sin_permiso_para_liberar"
  | "empresa_no_operable"
  | "firmante_ajeno"
  | "contador_no_crea_pago"
  | "sin_permiso_para_solicitar"
  | "lote_ausente"
  | "lote_ya_firmado";

export type EntradaDeSolicitud =
  | { ok: true; solicitanteId: string | null }
  | { ok: false; codigo: CodigoDeEntrada | CodigoDeFirmas };

export type EntradaDeLiberacion =
  | { ok: true; loteId: string }
  | { ok: false; codigo: CodigoDeEntrada | CodigoDeFirmas };

/** La matriz de capacidades decide; este módulo solo la consulta con los roles de una membresía. */
export function rolesPueden(roles: readonly RolCliente[], capacidad: CapacidadCliente): boolean {
  return tiene(capacidadesDe({ rolesCliente: roles, rolesPlataforma: [] }), capacidad);
}

export function esRolAsignable(rol: string): rol is RolAsignable {
  return (ROLES_ASIGNABLES as readonly string[]).includes(rol);
}

/** La misma persona en otra caja sigue siendo una. El uuid no distingue mayúsculas. */
export function mismoUsuario(izquierda: string, derecha: string): boolean {
  return izquierda.toLowerCase() === derecha.toLowerCase();
}

export function canonUsuario(id: string): string {
  return id.toLowerCase();
}

export function personasQueSueltanDinero(miembros: readonly Membresia[]): string[] {
  const ids = new Set<string>();
  for (const miembro of miembros) {
    if (miembro.deBaja) continue;
    if (rolesPueden(miembro.roles, "cliente.pago.liberar")) ids.add(canonUsuario(miembro.userId));
  }
  return [...ids];
}

/**
 * Hacen falta dos personas vigentes que puedan liberar. Un administrador
 * sin rol de liberador no cuenta, ni el contador, ni quien ya está de baja.
 */
export function empresaOperable(miembros: readonly Membresia[]): boolean {
  return personasQueSueltanDinero(miembros).length >= FIRMAS_DE_NOMINA;
}

/**
 * La fila que se guarda solo lleva las dos personas y la marca de prueba.
 * El mismo usuario en los dos lugares no se persiste.
 */
export function loteNoGuardable(lote: {
  solicitanteId: string;
  liberadorId: string | null;
  esPrueba: boolean;
}): CodigoDeFirmas | "dinero_real_fuera" | null {
  if (lote.esPrueba !== true) return "dinero_real_fuera";
  if (lote.liberadorId && mismoUsuario(lote.solicitanteId, lote.liberadorId)) {
    return "misma_persona_en_las_dos_firmas";
  }
  return null;
}

/** El primer acto solo pide. Nombrar a quien libera en la misma llamada no es la segunda firma. */
export function leerEntradaDeSolicitud(entrada: unknown): EntradaDeSolicitud {
  if (!esRegistro(entrada)) return { ok: false, codigo: "entrada_invalida" };
  const prohibida = prohibicion(entrada);
  if (prohibida) return { ok: false, codigo: prohibida };
  const par = parEnUnSoloCuerpo(entrada);
  if (par) return { ok: false, codigo: par };
  if ("liberadorId" in entrada) return { ok: false, codigo: "firma_en_un_solo_acto" };
  for (const clave of Object.keys(entrada)) {
    if (!CLAVES_DE_SOLICITUD.has(clave)) return { ok: false, codigo: "entrada_invalida" };
  }
  if ("companyId" in entrada && entrada.companyId !== null && typeof entrada.companyId !== "string") {
    return { ok: false, codigo: "entrada_invalida" };
  }
  if (!("solicitanteId" in entrada)) return { ok: true, solicitanteId: null };
  if (typeof entrada.solicitanteId !== "string" || !UUID.test(entrada.solicitanteId)) {
    return { ok: false, codigo: "identificador_invalido" };
  }
  return { ok: true, solicitanteId: entrada.solicitanteId };
}

/** El segundo acto es la sesión. El cuerpo solo dice qué lote cierra. */
export function leerEntradaDeLiberacion(entrada: unknown): EntradaDeLiberacion {
  if (!esRegistro(entrada)) return { ok: false, codigo: "entrada_invalida" };
  const prohibida = prohibicion(entrada);
  if (prohibida) return { ok: false, codigo: prohibida };
  const par = parEnUnSoloCuerpo(entrada);
  if (par) return { ok: false, codigo: par };
  if ("solicitanteId" in entrada || "liberadorId" in entrada) {
    return { ok: false, codigo: "firma_en_un_solo_acto" };
  }
  for (const clave of Object.keys(entrada)) {
    if (!CLAVES_DE_LIBERACION.has(clave)) return { ok: false, codigo: "entrada_invalida" };
  }
  if ("companyId" in entrada && entrada.companyId !== null && typeof entrada.companyId !== "string") {
    return { ok: false, codigo: "entrada_invalida" };
  }
  if (typeof entrada.loteId !== "string" || !UUID.test(entrada.loteId)) {
    return { ok: false, codigo: "identificador_invalido" };
  }
  return { ok: true, loteId: entrada.loteId };
}

export function rechazoDeSolicitud(estado: {
  actor: Membresia | null;
  miembros: readonly Membresia[];
}): CodigoDeFirmas | null {
  if (!estado.actor) return "sin_membresia";
  if (estado.actor.deBaja || !rolesPueden(estado.actor.roles, "cliente.pago.solicitar")) {
    return soloContador(estado.actor.roles) ? "contador_no_crea_pago" : "sin_permiso_para_solicitar";
  }
  if (!empresaOperable(estado.miembros)) return "empresa_no_operable";
  return null;
}

export function rechazoDeLiberacion(estado: {
  actor: Membresia | null;
  solicitanteId: string;
  solicitante: Membresia | null;
  miembros: readonly Membresia[];
}): CodigoDeFirmas | null {
  if (!estado.actor) return "sin_membresia";
  if (mismoUsuario(estado.actor.userId, estado.solicitanteId)) return "misma_persona_en_las_dos_firmas";
  if (estado.actor.deBaja || !rolesPueden(estado.actor.roles, "cliente.pago.liberar")) {
    return estado.actor.roles.includes("contador") ? "contador_no_libera" : "sin_permiso_para_liberar";
  }
  if (!empresaOperable(estado.miembros)) return "empresa_no_operable";
  if (!estado.solicitante || estado.solicitante.companyId !== estado.actor.companyId) return "firmante_ajeno";
  if (estado.solicitante.deBaja || !rolesPueden(estado.solicitante.roles, "cliente.pago.solicitar")) {
    return soloContador(estado.solicitante.roles) ? "contador_no_crea_pago" : "sin_permiso_para_solicitar";
  }
  return null;
}

function soloContador(roles: readonly RolCliente[]): boolean {
  return roles.includes("contador");
}

export function uuidValido(valor: string): boolean {
  return UUID.test(valor);
}

function prohibicion(entrada: Record<string, unknown>): CodigoDeEntrada | null {
  if (claveProhibida(entrada, esClaveDeDinero)) return "dinero_real_fuera";
  if (claveProhibida(entrada, esClaveDeTerceraFirma)) return "tercera_firma";
  return null;
}

function parEnUnSoloCuerpo(entrada: Record<string, unknown>): CodigoDeFirmas | null {
  if (!("solicitanteId" in entrada) || !("liberadorId" in entrada)) return null;
  const solicitanteId = entrada.solicitanteId;
  const liberadorId = entrada.liberadorId;
  if (typeof solicitanteId === "string" && typeof liberadorId === "string" && UUID.test(solicitanteId) && UUID.test(liberadorId)) {
    return mismoUsuario(solicitanteId, liberadorId) ? "misma_persona_en_las_dos_firmas" : "firma_en_un_solo_acto";
  }
  return "firma_en_un_solo_acto";
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function normalizarClave(clave: string): string {
  return clave.normalize("NFKC").toLowerCase().replace(/[_-]/g, "");
}

function esClaveDeDinero(clave: string, valor: unknown): boolean {
  const normalizada = normalizarClave(clave);
  if (normalizada === "esprueba" || normalizada === "prueba") return valor !== true;
  return (
    normalizada.includes("monto") ||
    normalizada.includes("centavo") ||
    normalizada.includes("importe") ||
    normalizada.includes("clabe") ||
    normalizada.includes("spei") ||
    normalizada.includes("enviado") ||
    normalizada.includes("liquidado") ||
    normalizada.includes("devuelto") ||
    normalizada.includes("referencia") ||
    normalizada === "estado" ||
    normalizada === "costo" ||
    normalizada === "pan" ||
    normalizada === "cvv" ||
    normalizada === "pin" ||
    normalizada.includes("divisa") ||
    normalizada === "banco" ||
    normalizada === "saldo" ||
    normalizada.includes("rastreo") ||
    normalizada.includes("idempoten")
  );
}

function esClaveDeTerceraFirma(clave: string): boolean {
  const normalizada = normalizarClave(clave);
  return (
    normalizada.includes("firma") ||
    normalizada.includes("revisor") ||
    normalizada.includes("supervisor") ||
    normalizada.includes("aprobador")
  );
}

function claveProhibida(
  valor: unknown,
  coincide: (clave: string, valor: unknown) => boolean,
  profundidad = 0,
): boolean {
  if (profundidad > 4) return false;
  if (Array.isArray(valor)) return valor.some((item) => claveProhibida(item, coincide, profundidad + 1));
  if (!esRegistro(valor)) return false;
  for (const [clave, hijo] of Object.entries(valor)) {
    if (coincide(clave, hijo) || claveProhibida(hijo, coincide, profundidad + 1)) return true;
  }
  return false;
}
