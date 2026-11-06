import { randomUUID } from "node:crypto";

import { momentoClabe, presentarClabe } from "../../dominio/clabe-proveedor";
import { exigir, exigirEmpresa, puede, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { actorDeCliente, auditar as auditarPorDefecto, type Auditar } from "../bitacora/auditar";
import { exigirAutenticacionRecienteCliente } from "../autenticacion/reautenticacion";
import type { Sesion } from "../session/tipos";
import { avisarCambioClabe } from "./avisos";
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

export type DependenciasClabes = {
  repositorio?: RepositorioClabes;
  ahora?: () => Date;
  auditar?: Auditar;
  avisar?: typeof avisarCambioClabe;
};

export type ResultadoClabe =
  | { tipo: "asentada" | "misma" }
  | { tipo: "cambiada"; pagosRegresados: number; avisosEnviados: number };

export async function leerClabesProveedor(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasClabes,
): Promise<LecturaClabes> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!puede(conEmpresa, "cliente.proveedores.expediente.ver")) throw new ErrorDeDominio("clabe_no_disponible");
  const filas = await resolver(deps).repositorio.listar(conEmpresa);
  return {
    puedeCambiar: puede(conEmpresa, "cliente.proveedores.clabe.cambiar"),
    grupos: armarGrupos(filas),
  };
}

/** Primera CLABE del proveedor. Si ya hay una vigente, no se pisa: hay que cambiarla. */
export async function asentarClabeProveedor(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { supplierId?: unknown; clabe?: unknown },
  deps?: DependenciasClabes,
): Promise<ResultadoClabe> {
  const conEmpresa = exigir(ctx, "cliente.proveedores.clabe.cambiar");
  const supplierId = identificador(entrada.supplierId);
  const presentada = presentarClabe(entrada.clabe);
  if (!presentada.ok) throw new ErrorDeDominio("clabe_invalida");
  const listo = resolver(deps);
  const ahora = new Date(listo.ahora().getTime());
  return listo.repositorio.conEmpresa(conEmpresa, async (ctx) => {
    const actual = await ctx.vigente(supplierId);
    if (actual) throw new ErrorDeDominio("clabe_ya_vigente");
    const id = randomUUID();
    await ctx.insertar({
      id,
      supplierId,
      clabe: presentada.clabe.clabe,
      desde: ahora,
    });
    await listo.auditar(ctx.consulta, actorDeCliente(conEmpresa), { accion: "clabe_proveedor", identificador: id });
    return { tipo: "asentada" };
  });
}

/** Cierra la vigente y agrega otra fila. La anterior se queda. */
export async function cambiarClabeProveedor(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { supplierId?: unknown; clabe?: unknown },
  sesion: Pick<Sesion, "segundoFactor" | "superficie">,
  deps?: DependenciasClabes,
): Promise<ResultadoClabe> {
  const conEmpresa = exigir(ctx, "cliente.proveedores.clabe.cambiar");
  const supplierId = identificador(entrada.supplierId);
  const presentada = presentarClabe(entrada.clabe);
  if (!presentada.ok) throw new ErrorDeDominio("clabe_invalida");
  const listo = resolver(deps);
  const ahora = new Date(listo.ahora().getTime());
  const resultado = await listo.repositorio.conEmpresa(conEmpresa, async (ctx) => {
    const actual = await ctx.vigente(supplierId);
    if (!actual) throw new ErrorDeDominio("proveedor_ausente");
    if (actual.clabe === presentada.clabe.clabe) return { tipo: "misma" as const };
    exigirAutenticacionRecienteCliente(sesion, ahora);
    const id = randomUUID();
    // Al cerrar la vigente, la base regresa a revisión los pagos listos que la usaban.
    const { pagosRegresados } = await ctx.cerrar(actual.id, ahora);
    await ctx.insertar({
      id,
      supplierId,
      clabe: presentada.clabe.clabe,
      desde: ahora,
    });
    await listo.auditar(ctx.consulta, actorDeCliente(conEmpresa), { accion: "clabe_proveedor", identificador: id });
    return { tipo: "cambiada" as const, clabeId: id, pagosRegresados };
  });
  if (resultado.tipo !== "cambiada") return resultado;
  const avisosEnviados = await (deps?.avisar ?? avisarCambioClabe)(conEmpresa, {
    supplierId, clabeId: resultado.clabeId, clabe: presentada.clabe.clabe, ahora,
  });
  return { tipo: "cambiada", pagosRegresados: resultado.pagosRegresados, avisosEnviados };
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

function resolver(deps?: DependenciasClabes): {
  repositorio: RepositorioClabes;
  ahora: () => Date;
  auditar: Auditar;
} {
  return {
    repositorio: deps?.repositorio ?? repositorioPg(),
    ahora: deps?.ahora ?? (() => new Date()),
    auditar: deps?.auditar ?? auditarPorDefecto,
  };
}
