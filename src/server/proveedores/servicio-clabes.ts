import { randomUUID } from "node:crypto";

import {
  momentoClabe,
  puedeCambiarClabeProveedor,
  puedeVerClabeProveedor,
  presentarClabe,
} from "../../dominio/clabe-proveedor";
import type { Consulta } from "../session/db";
import { ErrorDeDominio } from "../session/error-de-dominio";
import type { Sesion } from "../session/tipos";
import { registrarHechoClabe, type HechoClabe } from "./auditar";
import { repositorioPg } from "./repositorio-clabes";
import type {
  FilaClabe,
  GrupoClabeVista,
  LecturaClabes,
  LineaClabeVista,
  RepositorioClabes,
} from "./tipos";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Auditar = (evento: HechoClabe, consulta: Consulta) => Promise<void>;

export type DependenciasClabes = {
  repositorio?: RepositorioClabes;
  ahora?: () => Date;
  auditar?: Auditar;
};

export type ResultadoClabe = { tipo: "asentada" | "cambiada" | "misma" };

export function usuarioDeSesion(sesion: Sesion | null | undefined): string {
  const id = sesion?.usuario?.id;
  if (typeof id !== "string" || !UUID.test(id)) throw new ErrorDeDominio("sesion_ausente");
  return id;
}

export async function leerClabesProveedor(
  sesion: Sesion | null | undefined,
  deps?: DependenciasClabes,
): Promise<LecturaClabes> {
  const userId = usuarioDeSesion(sesion);
  const repo = resolver(deps).repositorio;
  const puerta = await repo.puerta(userId);
  if (!puerta) throw new ErrorDeDominio("sin_empresa");
  if (!puedeVerClabeProveedor(puerta.rol)) throw new ErrorDeDominio("clabe_no_disponible");
  const filas = await repo.listar(userId);
  return {
    puedeCambiar: puedeCambiarClabeProveedor(puerta.rol),
    grupos: armarGrupos(filas),
  };
}

/** Primera CLABE del proveedor. Si ya hay una vigente, no se pisa: hay que cambiarla. */
export async function asentarClabeProveedor(
  sesion: Sesion | null | undefined,
  entrada: { supplierId?: unknown; clabe?: unknown },
  deps?: DependenciasClabes,
): Promise<ResultadoClabe> {
  const userId = usuarioDeSesion(sesion);
  const supplierId = identificador(entrada.supplierId);
  const presentada = presentarClabe(entrada.clabe);
  if (!presentada.ok) throw new ErrorDeDominio("clabe_invalida");
  const listo = resolver(deps);
  const ahora = new Date(listo.ahora().getTime());
  return listo.repositorio.conEmpresa(userId, async (ctx) => {
    if (!puedeCambiarClabeProveedor(ctx.rol)) throw new ErrorDeDominio("sin_permiso");
    const actual = await ctx.vigente(supplierId);
    if (actual) throw new ErrorDeDominio("clabe_ya_vigente");
    const id = randomUUID();
    await ctx.insertar({
      id,
      supplierId,
      clabe: presentada.clabe.clabe,
      desde: ahora,
    });
    await auditar(listo.auditar, ctx.consulta, {
      companyId: ctx.companyId,
      actorId: userId,
      accion: "clabe_proveedor",
      entidad: "supplier_clabes",
      identificador: id,
      ocurridoEn: ahora,
    });
    return { tipo: "asentada" };
  });
}

/** Cierra la vigente y agrega otra fila. La anterior se queda. */
export async function cambiarClabeProveedor(
  sesion: Sesion | null | undefined,
  entrada: { supplierId?: unknown; clabe?: unknown },
  deps?: DependenciasClabes,
): Promise<ResultadoClabe> {
  const userId = usuarioDeSesion(sesion);
  const supplierId = identificador(entrada.supplierId);
  const presentada = presentarClabe(entrada.clabe);
  if (!presentada.ok) throw new ErrorDeDominio("clabe_invalida");
  const listo = resolver(deps);
  const ahora = new Date(listo.ahora().getTime());
  return listo.repositorio.conEmpresa(userId, async (ctx) => {
    if (!puedeCambiarClabeProveedor(ctx.rol)) throw new ErrorDeDominio("sin_permiso");
    const actual = await ctx.vigente(supplierId);
    if (!actual) throw new ErrorDeDominio("proveedor_ausente");
    if (actual.clabe === presentada.clabe.clabe) return { tipo: "misma" };
    const id = randomUUID();
    await ctx.cerrar(actual.id, ahora);
    await ctx.insertar({
      id,
      supplierId,
      clabe: presentada.clabe.clabe,
      desde: ahora,
    });
    await auditar(listo.auditar, ctx.consulta, {
      companyId: ctx.companyId,
      actorId: userId,
      accion: "clabe_proveedor",
      entidad: "supplier_clabes",
      identificador: id,
      ocurridoEn: ahora,
    });
    return { tipo: "cambiada" };
  });
}

function armarGrupos(filas: readonly FilaClabe[]): GrupoClabeVista[] {
  const porProveedor = new Map<string, FilaClabe[]>();
  for (const fila of filas) {
    const lista = porProveedor.get(fila.supplierId) ?? [];
    lista.push(fila);
    porProveedor.set(fila.supplierId, lista);
  }

  const grupos: GrupoClabeVista[] = [];
  for (const [supplierId, lista] of porProveedor) {
    const lineas = lista.map(aLinea).sort((a, b) => b.orden - a.orden || a.id.localeCompare(b.id));
    const vigente = lineas.find((linea) => linea.hasta === null) ?? null;
    grupos.push({
      supplierId,
      vigente,
      anteriores: lineas.filter((linea) => linea.id !== vigente?.id),
    });
  }

  grupos.sort((a, b) => {
    const ordenA = a.vigente?.orden ?? a.anteriores[0]?.orden ?? 0;
    const ordenB = b.vigente?.orden ?? b.anteriores[0]?.orden ?? 0;
    return ordenB - ordenA || a.supplierId.localeCompare(b.supplierId);
  });
  return grupos;
}

function aLinea(fila: FilaClabe): LineaClabeVista {
  const presentada = presentarClabe(fila.clabe);
  if (!presentada.ok) throw new ErrorDeDominio("base_no_disponible");
  return {
    id: fila.id,
    visible: presentada.clabe.visible,
    institucion: presentada.clabe.institucion,
    desde: momentoClabe(fila.desde),
    hasta: fila.hasta ? momentoClabe(fila.hasta) : null,
    orden: fila.desde.getTime(),
  };
}

function identificador(valor: unknown): string {
  const id = typeof valor === "string" ? valor.trim() : "";
  if (!UUID.test(id)) throw new ErrorDeDominio("proveedor_ausente");
  return id;
}

async function auditar(fn: Auditar, consulta: Consulta, evento: HechoClabe): Promise<void> {
  try {
    await fn(evento, consultaSinCierre(consulta));
  } catch (error) {
    if (error instanceof ErrorDeDominio) throw error;
    if (error instanceof Error && error.message.startsWith("Auditoría rechazada:")) {
      throw new ErrorDeDominio("auditoria_no_disponible");
    }
    throw new ErrorDeDominio("auditoria_no_disponible");
  }
}

function consultaSinCierre(consulta: Consulta): Consulta {
  return {
    async query(sql, params) {
      const verbo = (sql.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/;$/, "");
      if (verbo === "begin" || verbo === "commit" || verbo === "rollback" || verbo === "start") {
        throw new ErrorDeDominio("auditoria_no_disponible");
      }
      return consulta.query(sql, params);
    },
  };
}

function resolver(deps?: DependenciasClabes): {
  repositorio: RepositorioClabes;
  ahora: () => Date;
  auditar: Auditar;
} {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    auditar: deps?.auditar ?? registrarHechoClabe,
  };
}
