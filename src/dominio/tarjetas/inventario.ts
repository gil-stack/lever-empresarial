/**
 * Lo puro de Operación → Tarjetas: las clases de una tarjeta, los filtros de la dirección y cómo se lee lo que se
 * escribe en el buscador. Sin base ni red; lo usan el servidor, la página y la ventana del detalle.
 */

/**
 * La clase de una tarjeta. «sin_asignar» es un plástico disponible: sin empresa, sin titular y sin activar.
 * «asignada» ya tiene empresa pero todavía no se activa. Una activa se parte en «con saldo» y «sin saldo».
 */
export type ClaseTarjeta = "sin_asignar" | "asignada" | "activa_con_saldo" | "activa_sin_saldo" | "bloqueada" | "cancelada";

export type EstadoProcesador = "inStock" | "inactive" | "active" | "blocked" | "cancelled";

/** La clase con lo que dice el procesador y si Lever ya la entregó a una empresa. */
export function claseDeTarjeta(t: { estado: EstadoProcesador; saldoCentavos: number | null; conTitular: boolean; idepCliente: number }, enLever: boolean): ClaseTarjeta {
  if (t.estado === "cancelled") return "cancelada";
  if (t.estado === "blocked") return "bloqueada";
  if (t.estado === "inactive") return "asignada";
  if (t.estado === "active") return (t.saldoCentavos ?? 0) > 0 ? "activa_con_saldo" : "activa_sin_saldo";
  return t.conTitular || t.idepCliente !== 0 || enLever ? "asignada" : "sin_asignar";
}

/** Los filtros por estado, en el orden en que se muestran. */
export const ESTADOS = ["todas", "con_saldo", "sin_saldo", "por_activar", "disponibles", "bloqueadas", "canceladas"] as const;
export type EstadoFiltro = (typeof ESTADOS)[number];

export const CLASE_DEL_ESTADO: Record<Exclude<EstadoFiltro, "todas">, ClaseTarjeta> = {
  con_saldo: "activa_con_saldo",
  sin_saldo: "activa_sin_saldo",
  por_activar: "asignada",
  disponibles: "sin_asignar",
  bloqueadas: "bloqueada",
  canceladas: "cancelada",
};

export const NOMBRE_DEL_ESTADO: Record<EstadoFiltro, string> = {
  todas: "Todas",
  con_saldo: "Activas con saldo",
  sin_saldo: "Activas sin saldo",
  por_activar: "Por activar",
  disponibles: "Disponibles",
  bloqueadas: "Bloqueadas",
  canceladas: "Canceladas",
};

/** Cómo se lee cada clase en la lista y en el detalle; `tono` es la clase de color del punto (inventario-tarjetas.css). */
export const ESTADO_DE_CLASE: Record<ClaseTarjeta, { texto: string; tono: "activa" | "por-activar" | "disponible" | "bloqueada" | "cancelada" }> = {
  sin_asignar: { texto: "Disponible", tono: "disponible" },
  asignada: { texto: "Por activar", tono: "por-activar" },
  activa_con_saldo: { texto: "Activa", tono: "activa" },
  activa_sin_saldo: { texto: "Activa", tono: "activa" },
  bloqueada: { texto: "Bloqueada", tono: "bloqueada" },
  cancelada: { texto: "Cancelada", tono: "cancelada" },
};

export function estadoDe(valor: string | undefined): EstadoFiltro {
  return (ESTADOS as readonly string[]).includes(valor ?? "") ? (valor as EstadoFiltro) : "todas";
}

/** La empresa de la dirección (`?empresa=`): el id de una empresa de Lever, «p» + el número de un cliente del procesador o «ninguna». */
export function empresaDe(valor: string | undefined): string | null {
  const v = valor?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) || /^p[1-9][0-9]{0,9}$/.test(v) || v === SIN_EMPRESA ? v : null;
}

export const SIN_EMPRESA = "ninguna";

export function paginaDe(valor: string | undefined): number {
  if (!valor || !/^[1-9][0-9]{0,5}$/.test(valor)) return 1;
  return Number(valor);
}

/** Lo que se escribió en el buscador, limpio: hasta 60 caracteres, sin espacios de más. */
export function textoDeBusqueda(valor: string | undefined): string {
  return (valor ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * Qué buscar con lo que se escribió. Solo dígitos (con espacios, guiones o puntos de máscara): una terminación o el
 * número de la tarjeta en el procesador; si pegan un número completo, se busca por sus últimos 4 y no se guarda el
 * resto. Cualquier otra cosa: el nombre de la empresa o el nombre impreso en el plástico.
 */
export type Busqueda = { tipo: "ninguna" } | { tipo: "terminacion"; digitos: string } | { tipo: "numero"; digitos: string } | { tipo: "texto"; texto: string };

export function busquedaDe(q: string): Busqueda {
  const limpio = textoDeBusqueda(q);
  if (!limpio) return { tipo: "ninguna" };
  const digitos = limpio.replace(/[\s\-.•*]/g, "");
  if (/^[0-9]+$/.test(digitos)) {
    if (digitos.length >= 12) return { tipo: "terminacion", digitos: digitos.slice(-4) };
    if (digitos.length <= 4) return { tipo: "terminacion", digitos };
    return { tipo: "numero", digitos: digitos.replace(/^0+/, "") || "0" };
  }
  return { tipo: "texto", texto: limpio };
}

export type ParamsTarjetas = { q?: string; estado?: EstadoFiltro; empresa?: string | null; pagina?: number; tarjeta?: number | null };

/** La dirección de la lista con sus filtros; sin los que están en su valor de siempre. */
export function enlaceTarjetas(p: ParamsTarjetas): string {
  const s = new URLSearchParams();
  const q = textoDeBusqueda(p.q);
  if (q) s.set("q", q);
  if (p.estado && p.estado !== "todas") s.set("estado", p.estado);
  if (p.empresa) s.set("empresa", p.empresa);
  if (p.pagina && p.pagina > 1) s.set("pagina", String(p.pagina));
  if (p.tarjeta) s.set("tarjeta", String(p.tarjeta));
  const texto = s.toString();
  return texto ? `/operacion/tarjetas?${texto}` : "/operacion/tarjetas";
}

/** «hace 3 min», «hace 2 h», para decir qué tan fresca es la copia del inventario. */
export function haceCuanto(desde: Date, ahora: Date): string {
  const minutos = Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / 60_000));
  if (minutos < 1) return "hace un momento";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}
