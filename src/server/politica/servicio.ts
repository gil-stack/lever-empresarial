import { randomUUID } from "node:crypto";

import { leerCentavosEscritos } from "../../dominio/centavos";
import {
  DIAS_MAX,
  DIAS_MIN,
  VENCIDOS_MAX,
  VENCIDOS_MIN,
  esUuid,
  leerEnteroEnRango,
  presentarPolitica,
  validarCentavosEscritos,
  validarNombreCategoria,
  type VistaCajones,
  type VistaPolitica,
} from "../../dominio/politica";
import type { Sesion } from "../session/tipos";
import { ErrorDeDominio } from "../session/error-de-dominio";
import { repositorioPg, type EventoPolitica, type RepositorioPolitica } from "./repositorio";

export type DependenciasPolitica = {
  repositorio?: RepositorioPolitica;
  ahora?: () => Date;
};

export async function leerPolitica(
  sesion: Sesion | null | undefined,
  deps?: DependenciasPolitica,
): Promise<VistaPolitica | null> {
  const userId = exigirUsuario(sesion);
  const datos = await repositorio(deps).leer(userId);
  if (!datos) return null;
  const presentada = presentarPolitica(datos, reloj(deps));
  if (!presentada.ok) throw new ErrorDeDominio(presentada.codigo);
  return presentada.vista;
}

export async function leerCajones(
  sesion: Sesion | null | undefined,
  deps?: DependenciasPolitica,
): Promise<VistaCajones | null> {
  const vista = await leerPolitica(sesion, deps);
  if (!vista) return null;
  return {
    cajones: vista.cajones,
    sinCajonCentavos: vista.sinCajonCentavos,
    edad: vista.edad,
  };
}

export async function editarPlazoEmpresa(
  sesion: Sesion | null | undefined,
  entrada: { dias: unknown; vencidos: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const userId = exigirUsuario(sesion);
  const dias = leerEnteroEnRango(entrada.dias, DIAS_MIN, DIAS_MAX);
  const vencidos = leerEnteroEnRango(entrada.vencidos, VENCIDOS_MIN, VENCIDOS_MAX);
  if (dias.tipo !== "entero") throw new ErrorDeDominio("dias_invalidos");
  if (vencidos.tipo !== "entero") throw new ErrorDeDominio("vencidos_invalidos");
  const ocurridoEn = reloj(deps);
  await repositorio(deps).escribir(userId, async (ctx) => {
    await ctx.guardarPlazo(dias.valor, vencidos.valor);
    await ctx.auditar(evento("editar_politica", "policies", ctx.companyId, ocurridoEn));
  });
}

export async function editarUmbral(
  sesion: Sesion | null | undefined,
  entrada: { texto: unknown; quitar: boolean },
  deps?: DependenciasPolitica,
): Promise<void> {
  const userId = exigirUsuario(sesion);
  const centavos = entrada.quitar ? null : exigirMonto(entrada.texto, "umbral_invalido", false);
  const ocurridoEn = reloj(deps);
  await repositorio(deps).escribir(userId, async (ctx) => {
    await ctx.guardarUmbral(centavos);
    await ctx.auditar(
      evento(centavos === null ? "quitar_umbral" : "editar_umbral", "policies", ctx.companyId, ocurridoEn),
    );
  });
}

export async function editarPoliticaPersona(
  sesion: Sesion | null | undefined,
  entrada: { userId: unknown; dias: unknown; vencidos: unknown; quitar: boolean },
  deps?: DependenciasPolitica,
): Promise<void> {
  const actorId = exigirUsuario(sesion);
  if (!esUuid(entrada.userId)) throw new ErrorDeDominio("persona_ajena");
  const personaId = entrada.userId;
  const ocurridoEn = reloj(deps);
  if (entrada.quitar) {
    await repositorio(deps).escribir(actorId, async (ctx) => {
      const habia = await ctx.quitarPersona(personaId);
      if (habia) {
        await ctx.auditar(evento("quitar_politica_persona", "policy_persons", personaId, ocurridoEn));
      }
    });
    return;
  }
  const dias = leerEnteroEnRango(entrada.dias, DIAS_MIN, DIAS_MAX);
  const vencidos = leerEnteroEnRango(entrada.vencidos, VENCIDOS_MIN, VENCIDOS_MAX);
  if (dias.tipo !== "entero") throw new ErrorDeDominio("dias_invalidos");
  if (vencidos.tipo !== "entero") throw new ErrorDeDominio("vencidos_invalidos");
  await repositorio(deps).escribir(actorId, async (ctx) => {
    const igual =
      dias.valor === ctx.plazo.diasComprobante && vencidos.valor === ctx.plazo.maxVencidos;
    if (igual) {
      const habia = await ctx.quitarPersona(personaId);
      if (habia) {
        await ctx.auditar(evento("quitar_politica_persona", "policy_persons", personaId, ocurridoEn));
      }
      return;
    }
    await ctx.guardarPersona(personaId, dias.valor, vencidos.valor);
    await ctx.auditar(evento("editar_politica_persona", "policy_persons", personaId, ocurridoEn));
  });
}

export async function crearCategoria(
  sesion: Sesion | null | undefined,
  entrada: { nombre: unknown; tope: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const userId = exigirUsuario(sesion);
  const nombre = validarNombreCategoria(entrada.nombre);
  if (!nombre.ok) throw new ErrorDeDominio(nombre.codigo);
  const tope = exigirMonto(entrada.tope, "tope_invalido", true);
  const id = randomUUID();
  const ocurridoEn = reloj(deps);
  await repositorio(deps).escribir(userId, async (ctx) => {
    await ctx.crearCategoria({ id, nombre: nombre.nombre, topeCentavos: tope });
    await ctx.auditar(evento("crear_categoria", "policy_categories", id, ocurridoEn));
  });
}

export async function escribirTopeCategoria(
  sesion: Sesion | null | undefined,
  entrada: { categoriaId: unknown; tope: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const userId = exigirUsuario(sesion);
  if (!esUuid(entrada.categoriaId)) throw new ErrorDeDominio("categoria_ajena");
  const categoriaId = entrada.categoriaId;
  const tope = exigirMonto(entrada.tope, "tope_invalido", false);
  if (tope === null) throw new ErrorDeDominio("tope_invalido");
  const ocurridoEn = reloj(deps);
  await repositorio(deps).escribir(userId, async (ctx) => {
    await ctx.escribirTope(categoriaId, tope);
    await ctx.auditar(evento("escribir_tope", "policy_categories", categoriaId, ocurridoEn));
  });
}

export async function quitarTopeCategoria(
  sesion: Sesion | null | undefined,
  entrada: { categoriaId: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const userId = exigirUsuario(sesion);
  if (!esUuid(entrada.categoriaId)) throw new ErrorDeDominio("categoria_ajena");
  const categoriaId = entrada.categoriaId;
  const ocurridoEn = reloj(deps);
  await repositorio(deps).escribir(userId, async (ctx) => {
    await ctx.quitarTope(categoriaId);
    await ctx.auditar(evento("quitar_tope", "policy_categories", categoriaId, ocurridoEn));
  });
}

export async function borrarCategoria(
  sesion: Sesion | null | undefined,
  entrada: { categoriaId: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const userId = exigirUsuario(sesion);
  if (!esUuid(entrada.categoriaId)) throw new ErrorDeDominio("categoria_ajena");
  const categoriaId = entrada.categoriaId;
  const ocurridoEn = reloj(deps);
  await repositorio(deps).escribir(userId, async (ctx) => {
    await ctx.borrarCategoria(categoriaId);
    await ctx.auditar(evento("borrar_categoria", "policy_categories", categoriaId, ocurridoEn));
  });
}

function exigirMonto(
  valor: unknown,
  codigo: "umbral_invalido" | "tope_invalido",
  vacioEsNulo: boolean,
): number | null {
  const leido = typeof valor === "number" || valor === null
    ? validarCentavosEscritos(valor)
    : null;
  if (leido) {
    if (!leido.ok) throw new ErrorDeDominio(codigo);
    if (leido.centavos === null && !vacioEsNulo) throw new ErrorDeDominio(codigo);
    return leido.centavos;
  }
  const texto = leerCentavosEscritos(valor);
  if (texto.tipo === "invalido") throw new ErrorDeDominio(codigo);
  if (texto.tipo === "vacio") {
    if (!vacioEsNulo) throw new ErrorDeDominio(codigo);
    return null;
  }
  return texto.centavos;
}

function evento(
  accion: EventoPolitica["accion"],
  entidad: EventoPolitica["entidad"],
  identificador: string,
  ocurridoEn: Date,
): EventoPolitica {
  return { accion, entidad, identificador, ocurridoEn };
}

function repositorio(deps?: DependenciasPolitica): RepositorioPolitica {
  return deps?.repositorio ?? repositorioPg();
}

function reloj(deps?: DependenciasPolitica): Date {
  return (deps?.ahora ?? (() => new Date()))();
}

function exigirUsuario(sesion: Sesion | null | undefined): string {
  const id = sesion?.usuario?.id;
  if (!esUuid(id)) throw new ErrorDeDominio("sesion_ausente");
  return id;
}
