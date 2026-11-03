import type { Rol } from "../session/tipos.ts";
import type { LoteDePrueba, Membresia } from "./tipos.ts";

/**
 * Quien libera es la membresía `liberador` que ya nombra la fase 1.
 * El administrador también suelta dinero: si no, el fundador del alta
 * no podría ser una de las dos firmas sin dejar de administrar.
 * El contador no está en esa lista.
 */
export const QUIEN_LIBERA = "liberador" as const;

export const ROLES_ASIGNABLES = ["administrador", QUIEN_LIBERA, "contador"] as const;

export type RolAsignable = (typeof ROLES_ASIGNABLES)[number];

/** En nómina siempre hay dos firmas. No se abre una tercera. */
export const FIRMAS_DE_NOMINA = 2 as const;

export const ACCIONES = ["administrar_membresias", "soltar_dinero", "exportar_poliza", "solicitar"] as const;

export type Accion = (typeof ACCIONES)[number];

const POR_ROL: Record<Rol, readonly Accion[]> = {
  administrador: ["administrar_membresias", "soltar_dinero", "exportar_poliza", "solicitar"],
  liberador: ["soltar_dinero", "solicitar"],
  contador: ["exportar_poliza"],
  solicitante: ["solicitar"],
  tarjetahabiente: [],
};

const CLAVES_DE_LOTE = new Set(["solicitanteId", "liberadorId", "companyId"]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CodigoDeEntrada = "entrada_invalida" | "dinero_real_fuera" | "tercera_firma" | "identificador_invalido";

export type CodigoDeFirmas =
  | "sin_membresia"
  | "misma_persona_en_las_dos_firmas"
  | "firma_ajena"
  | "contador_no_libera"
  | "sin_permiso_para_liberar"
  | "empresa_no_operable"
  | "firmante_ajeno"
  | "contador_no_crea_pago"
  | "sin_permiso_para_solicitar";

export type EntradaDeLote =
  | { ok: true; solicitanteId: string; liberadorId: string }
  | { ok: false; codigo: CodigoDeEntrada };

export function accionesDe(rol: Rol): readonly Accion[] {
  return POR_ROL[rol];
}

export function puede(rol: Rol, accion: Accion): boolean {
  return POR_ROL[rol].includes(accion);
}

export function puedeSoltarDinero(rol: Rol): boolean {
  return puede(rol, "soltar_dinero");
}

export function puedeEntrarAPoliza(rol: Rol): boolean {
  return puede(rol, "exportar_poliza");
}

export function esRolAsignable(rol: string): rol is RolAsignable {
  return (ROLES_ASIGNABLES as readonly string[]).includes(rol);
}

export function personasQueSueltanDinero(miembros: readonly Membresia[]): string[] {
  const ids = new Set<string>();
  for (const miembro of miembros) {
    if (puedeSoltarDinero(miembro.rol)) ids.add(miembro.userId);
  }
  return [...ids];
}

/** Hacen falta dos personas distintas autorizadas a soltar dinero. El contador no cuenta. */
export function empresaOperable(miembros: readonly Membresia[]): boolean {
  return personasQueSueltanDinero(miembros).length >= FIRMAS_DE_NOMINA;
}

/**
 * La fila que se guarda solo lleva las dos personas y la marca de prueba.
 * El mismo usuario en los dos lugares no se persiste.
 */
export function loteNoGuardable(
  lote: Pick<LoteDePrueba, "solicitanteId" | "liberadorId" | "esPrueba">,
): CodigoDeFirmas | "dinero_real_fuera" | null {
  if (lote.esPrueba !== true) return "dinero_real_fuera";
  if (lote.solicitanteId === lote.liberadorId) return "misma_persona_en_las_dos_firmas";
  return null;
}

export function leerEntradaDeLote(entrada: unknown): EntradaDeLote {
  if (!esRegistro(entrada)) return { ok: false, codigo: "entrada_invalida" };
  const dinero = claveProhibida(entrada, esClaveDeDinero);
  if (dinero) return { ok: false, codigo: "dinero_real_fuera" };
  const tercera = claveProhibida(entrada, esClaveDeTerceraFirma);
  if (tercera) return { ok: false, codigo: "tercera_firma" };

  for (const clave of Object.keys(entrada)) {
    if (!CLAVES_DE_LOTE.has(clave)) return { ok: false, codigo: "entrada_invalida" };
  }

  if ("companyId" in entrada && entrada.companyId !== null && typeof entrada.companyId !== "string") {
    return { ok: false, codigo: "entrada_invalida" };
  }

  const solicitanteId = entrada.solicitanteId;
  const liberadorId = entrada.liberadorId;
  if (typeof solicitanteId !== "string" || typeof liberadorId !== "string") {
    return { ok: false, codigo: "entrada_invalida" };
  }
  if (!UUID.test(solicitanteId) || !UUID.test(liberadorId)) {
    return { ok: false, codigo: "identificador_invalido" };
  }
  return { ok: true, solicitanteId, liberadorId };
}

export function rechazoDeFirmas(estado: {
  actor: Membresia | null;
  solicitanteId: string;
  liberadorId: string;
  solicitante: Membresia | null;
  liberador: Membresia | null;
  miembros: readonly Membresia[];
}): CodigoDeFirmas | null {
  if (!estado.actor) return "sin_membresia";
  if (estado.solicitanteId === estado.liberadorId) return "misma_persona_en_las_dos_firmas";
  if (estado.actor.userId !== estado.liberadorId) return "firma_ajena";
  if (!estado.liberador || estado.liberador.companyId !== estado.actor.companyId) return "firmante_ajeno";
  if (!puedeSoltarDinero(estado.liberador.rol)) {
    return estado.liberador.rol === "contador" ? "contador_no_libera" : "sin_permiso_para_liberar";
  }
  if (!empresaOperable(estado.miembros)) return "empresa_no_operable";
  if (!estado.solicitante || estado.solicitante.companyId !== estado.actor.companyId) return "firmante_ajeno";
  if (!puede(estado.solicitante.rol, "solicitar")) {
    return estado.solicitante.rol === "contador" ? "contador_no_crea_pago" : "sin_permiso_para_solicitar";
  }
  return null;
}

export function uuidValido(valor: string): boolean {
  return UUID.test(valor);
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
