import { formatoPesos } from "./centavos";

/**
 * La cuenta nace con cinco días y cinco comprobantes vencidos.
 * Una persona puede dejar otros números. La categoría y el umbral
 * no traen centavos: vacío no es cero.
 */

export const DIAS_MIN = 1;
export const DIAS_MAX = 365;
export const VENCIDOS_MIN = 1;
export const VENCIDOS_MAX = 365;
export const DIAS_DEFAULT = 5;
export const VENCIDOS_DEFAULT = 5;
export const NOMBRE_CATEGORIA_MAX = 80;
export const MOTIVO_ASIENTO_MAX = 200;

export const CAJONES = [
  { codigo: "viaticos", nombre: "Viáticos" },
  { codigo: "proveedores", nombre: "Proveedores" },
  { codigo: "impuestos", nombre: "Impuestos" },
  { codigo: "nomina", nombre: "Nómina" },
] as const;

export type CodigoCajon = (typeof CAJONES)[number]["codigo"];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ETIQUETAS_ROL: Record<string, string> = {
  administrador: "Administrador",
  solicitante: "Solicitante",
  liberador: "Liberador",
  tarjetahabiente: "Tarjetahabiente",
  contador: "Contador",
};

export type CajonVisible = {
  codigo: CodigoCajon;
  nombre: string;
  saldoCentavos: number;
};

export type VistaCajones = {
  cajones: CajonVisible[];
  sinCajonCentavos: number;
  edad: string;
};

export type PersonaVisible = {
  personaId: string;
  nombre: string;
  correo: string;
  rol: string;
  rolEtiqueta: string;
  diasComprobante: number;
  maxVencidos: number;
  propio: boolean;
};

export type CategoriaVisible = {
  id: string;
  nombre: string;
  topeCentavos: number | null;
  listaParaTarjeta: boolean;
};

export type VistaPolitica = VistaCajones & {
  diasComprobante: number;
  maxVencidos: number;
  umbralCentavos: number | null;
  puedeEditar: boolean;
  personas: PersonaVisible[];
  categorias: CategoriaVisible[];
};

export type DatosPersona = {
  personaId: string;
  nombre: string;
  correo: string;
  rol: string;
  diasComprobante: number | null;
  maxVencidos: number | null;
};

export type DatosCategoria = {
  id: string;
  nombre: string;
  topeCentavos: number | null;
};

export type DatosCajon = {
  codigo: string;
  nombre: string;
  saldoCentavos: number;
};

export type DatosPolitica = {
  companyId: string;
  /** Lo decide la matriz de capacidades con el contexto, no este módulo. */
  puedeEditar: boolean;
  diasComprobante: number;
  maxVencidos: number;
  umbralCentavos: number | null;
  personas: DatosPersona[];
  categorias: DatosCategoria[];
  cajones: DatosCajon[];
  sinCajonCentavos: number;
};

export type Presentacion =
  | { ok: true; vista: VistaPolitica }
  | { ok: false; codigo: "cajones_incompletos" | "politica_invalida" };

export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

export function etiquetaRol(rol: string): string {
  return ETIQUETAS_ROL[rol] ?? "Rol no reconocido";
}

/** La vista trae los roles separados por coma. Vacío: no entra a la consola. */
export function etiquetaRoles(roles: string): string {
  if (roles === "") return "No entra a la consola";
  const etiquetas = roles.split(",").map(etiquetaRol);
  if (etiquetas.length === 1) return etiquetas[0] ?? "Rol no reconocido";
  const ultima = etiquetas.pop() ?? "";
  return `${etiquetas.join(", ")} y ${ultima.toLocaleLowerCase("es-MX")}`;
}

/** Vacío no alcanza para emitir. Cero ya es un tope que la empresa escribió. */
export function categoriaListaParaTarjeta(topeCentavos: number | null): boolean {
  return topeCentavos !== null;
}

/** La suma de ningún asiento es cero. No hace falta una fila de ejemplo. */
export function saldoDeAsientos(centavos: readonly number[]): number {
  let suma = 0;
  for (const valor of centavos) {
    if (!Number.isSafeInteger(valor)) {
      throw new Error("centavos_invalidos");
    }
    suma += valor;
  }
  if (!Number.isSafeInteger(suma)) {
    throw new Error("centavos_invalidos");
  }
  return suma;
}

export function leerEnteroEnRango(
  valor: unknown,
  minimo: number,
  maximo: number,
): { tipo: "entero"; valor: number } | { tipo: "invalido" } {
  const texto = typeof valor === "number" ? String(valor) : valor;
  if (typeof texto !== "string") return { tipo: "invalido" };
  const limpio = texto.trim();
  if (!/^[0-9]+$/.test(limpio)) return { tipo: "invalido" };
  const numero = Number(limpio);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    return { tipo: "invalido" };
  }
  return { tipo: "entero", valor: numero };
}

export function validarNombreCategoria(
  valor: unknown,
): { ok: true; nombre: string } | { ok: false; codigo: "nombre_invalido" } {
  if (typeof valor !== "string") return { ok: false, codigo: "nombre_invalido" };
  const nombre = valor.trim().replace(/\s+/g, " ");
  if (!nombreGuardado(nombre)) return { ok: false, codigo: "nombre_invalido" };
  return { ok: true, nombre };
}

function nombreGuardado(nombre: string): string | null {
  if (nombre !== nombre.trim()) return null;
  if (nombre.length < 1 || nombre.length > NOMBRE_CATEGORIA_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(nombre)) return null;
  return nombre;
}

export function validarCentavosEscritos(
  centavos: number | null,
): { ok: true; centavos: number | null } | { ok: false } {
  if (centavos === null) return { ok: true, centavos: null };
  if (!Number.isSafeInteger(centavos) || centavos < 0) return { ok: false };
  return { ok: true, centavos };
}

export function presentarPolitica(datos: DatosPolitica, ahora: Date): Presentacion {
  if (!esUuid(datos.companyId) || Number.isNaN(ahora.getTime())) {
    return { ok: false, codigo: "politica_invalida" };
  }
  const dias = enteroGuardado(datos.diasComprobante, DIAS_MIN, DIAS_MAX);
  const vencidos = enteroGuardado(datos.maxVencidos, VENCIDOS_MIN, VENCIDOS_MAX);
  const umbral = centavosGuardados(datos.umbralCentavos, true);
  const cajones = presentarCajones(datos.cajones);
  const sinCajon = centavosGuardados(datos.sinCajonCentavos, false);
  if (!dias || !vencidos || umbral === undefined || !cajones || sinCajon === undefined) {
    return { ok: false, codigo: !cajones ? "cajones_incompletos" : "politica_invalida" };
  }

  const personas: PersonaVisible[] = [];
  for (const persona of datos.personas) {
    const visible = presentarPersona(
      { diasComprobante: dias, maxVencidos: vencidos },
      persona,
    );
    if (!visible) return { ok: false, codigo: "politica_invalida" };
    personas.push(visible);
  }

  const categorias: CategoriaVisible[] = [];
  for (const categoria of datos.categorias) {
    const visible = presentarCategoria(categoria);
    if (!visible) return { ok: false, codigo: "politica_invalida" };
    categorias.push(visible);
  }

  return {
    ok: true,
    vista: {
      diasComprobante: dias,
      maxVencidos: vencidos,
      umbralCentavos: umbral,
      puedeEditar: datos.puedeEditar,
      personas,
      categorias,
      cajones,
      sinCajonCentavos: sinCajon,
      edad: fraseEdadAsientos(ahora),
    },
  };
}

export function fraseEdadAsientos(fecha: Date): string {
  const texto = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(fecha);
  return `Suma de asientos al ${texto}, hora del centro de México. No es una consulta al participante.`;
}

export function frasePlazo(dias: number, vencidos: number): string {
  const diasTexto = dias === 1 ? "1 día" : `${dias} días`;
  const vencidosTexto =
    vencidos === 1 ? "1 comprobante vencido" : `${vencidos} comprobantes vencidos`;
  return `${diasTexto} para pasar de «todavía no» a «ya se pasó». ${vencidosTexto} antes de pausar la tarjeta.`;
}

export function fraseTope(topeCentavos: number | null): string {
  if (topeCentavos === null) {
    return "Sin tope. La tarjeta no se emite con esta categoría vacía.";
  }
  return `Tope escrito: ${formatoPesos(topeCentavos)}.`;
}

export function fraseUmbral(centavos: number | null): string {
  if (centavos === null) return "La empresa todavía no escribe el umbral de proveedores.";
  return `Umbral escrito: ${formatoPesos(centavos)}.`;
}

export function ledeCajones(): string {
  const nombres = CAJONES.map((cajon) => cajon.nombre);
  const ultimo = nombres[nombres.length - 1] ?? "";
  const cabeza = nombres.slice(0, -1).join(", ");
  return `Cuatro nombres sobre la misma CLABE: ${cabeza} y ${ultimo}.`;
}

function presentarCajones(filas: DatosCajon[]): CajonVisible[] | null {
  if (filas.length !== CAJONES.length) return null;
  const vistos = new Set<string>();
  const porCodigo = new Map<string, DatosCajon>();
  for (const fila of filas) {
    if (vistos.has(fila.codigo)) return null;
    vistos.add(fila.codigo);
    porCodigo.set(fila.codigo, fila);
  }
  const ordenados: CajonVisible[] = [];
  for (const esperado of CAJONES) {
    const fila = porCodigo.get(esperado.codigo);
    if (!fila || fila.nombre !== esperado.nombre) return null;
    if (!Number.isSafeInteger(fila.saldoCentavos)) return null;
    ordenados.push({
      codigo: esperado.codigo,
      nombre: esperado.nombre,
      saldoCentavos: fila.saldoCentavos,
    });
  }
  return ordenados;
}

function presentarPersona(
  empresa: { diasComprobante: number; maxVencidos: number },
  persona: DatosPersona,
): PersonaVisible | null {
  if (!esUuid(persona.personaId) || persona.nombre.trim().length === 0) return null;
  if (typeof persona.correo !== "string" || typeof persona.rol !== "string") return null;
  const propio = persona.diasComprobante !== null || persona.maxVencidos !== null;
  if (propio && (persona.diasComprobante === null || persona.maxVencidos === null)) return null;
  const dias = persona.diasComprobante === null
    ? empresa.diasComprobante
    : enteroGuardado(persona.diasComprobante, DIAS_MIN, DIAS_MAX);
  const vencidos = persona.maxVencidos === null
    ? empresa.maxVencidos
    : enteroGuardado(persona.maxVencidos, VENCIDOS_MIN, VENCIDOS_MAX);
  if (!dias || !vencidos) return null;
  return {
    personaId: persona.personaId,
    nombre: persona.nombre,
    correo: persona.correo,
    rol: persona.rol,
    rolEtiqueta: etiquetaRoles(persona.rol),
    diasComprobante: dias,
    maxVencidos: vencidos,
    propio,
  };
}

function presentarCategoria(categoria: DatosCategoria): CategoriaVisible | null {
  if (!esUuid(categoria.id)) return null;
  const nombre = nombreGuardado(categoria.nombre);
  if (!nombre) return null;
  const tope = centavosGuardados(categoria.topeCentavos, true);
  if (tope === undefined) return null;
  return {
    id: categoria.id,
    nombre,
    topeCentavos: tope,
    listaParaTarjeta: categoriaListaParaTarjeta(tope),
  };
}

function enteroGuardado(valor: number, minimo: number, maximo: number): number | null {
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) return null;
  return valor;
}

/** `permiteNulo` distingue el monto que la empresa no escribió de un saldo, que siempre es un entero. */
function centavosGuardados(valor: number | null, permiteNulo: true): number | null | undefined;
function centavosGuardados(valor: number | null, permiteNulo: false): number | undefined;
function centavosGuardados(valor: number | null, permiteNulo: boolean): number | null | undefined {
  if (valor === null) return permiteNulo ? null : undefined;
  if (!Number.isSafeInteger(valor)) return undefined;
  if (permiteNulo && valor < 0) return undefined;
  return valor;
}
