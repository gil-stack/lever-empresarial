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
import { exigirEmpresa, type ContextoDeTenant } from "../../nucleo/contexto";
import { ErrorDeDominio } from "../../nucleo/error-de-dominio";
import { repositorioPg, type RepositorioPolitica } from "./repositorio";

export type DependenciasPolitica = {
  repositorio?: RepositorioPolitica;
  ahora?: () => Date;
};

export async function leerPolitica(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasPolitica,
): Promise<VistaPolitica | null> {
  const conEmpresa = exigirEmpresa(ctx);
  const datos = await repositorio(deps).leer(conEmpresa);
  if (!datos) return null;
  const presentada = presentarPolitica(datos, reloj(deps));
  if (!presentada.ok) throw new ErrorDeDominio(presentada.codigo);
  return presentada.vista;
}

export async function leerCajones(
  ctx: ContextoDeTenant | null | undefined,
  deps?: DependenciasPolitica,
): Promise<VistaCajones | null> {
  const vista = await leerPolitica(ctx, deps);
  if (!vista) return null;
  return {
    cajones: vista.cajones,
    sinCajonCentavos: vista.sinCajonCentavos,
    edad: vista.edad,
  };
}

export async function editarPlazoEmpresa(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { dias: unknown; vencidos: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const conEmpresa = exigirEmpresa(ctx);
  const dias = leerEnteroEnRango(entrada.dias, DIAS_MIN, DIAS_MAX);
  const vencidos = leerEnteroEnRango(entrada.vencidos, VENCIDOS_MIN, VENCIDOS_MAX);
  if (dias.tipo !== "entero") throw new ErrorDeDominio("dias_invalidos");
  if (vencidos.tipo !== "entero") throw new ErrorDeDominio("vencidos_invalidos");
  await repositorio(deps).escribir(conEmpresa, async (ctx) => {
    await ctx.guardarPlazo(dias.valor, vencidos.valor);
    await ctx.auditar({ accion: "editar_politica", identificador: ctx.companyId });
  });
}

export async function editarUmbral(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { texto: unknown; quitar: boolean },
  deps?: DependenciasPolitica,
): Promise<void> {
  const conEmpresa = exigirEmpresa(ctx);
  const centavos = entrada.quitar ? null : exigirMonto(entrada.texto, "umbral_invalido", false);
  await repositorio(deps).escribir(conEmpresa, async (ctx) => {
    await ctx.guardarUmbral(centavos);
    await ctx.auditar(
      { accion: centavos === null ? "quitar_umbral" : "editar_umbral", identificador: ctx.companyId },
    );
  });
}

export async function editarPoliticaPersona(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { personaId: unknown; dias: unknown; vencidos: unknown; quitar: boolean },
  deps?: DependenciasPolitica,
): Promise<{ propio: boolean }> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!esUuid(entrada.personaId)) throw new ErrorDeDominio("persona_ajena");
  const personaId = entrada.personaId;
  if (entrada.quitar) {
    await repositorio(deps).escribir(conEmpresa, async (ctx) => {
      const habia = await ctx.quitarPersona(personaId);
      if (habia) {
        await ctx.auditar({ accion: "quitar_politica_persona", identificador: personaId });
      }
    });
    return { propio: false };
  }
  const dias = leerEnteroEnRango(entrada.dias, DIAS_MIN, DIAS_MAX);
  const vencidos = leerEnteroEnRango(entrada.vencidos, VENCIDOS_MIN, VENCIDOS_MAX);
  if (dias.tipo !== "entero") throw new ErrorDeDominio("dias_invalidos");
  if (vencidos.tipo !== "entero") throw new ErrorDeDominio("vencidos_invalidos");
  let propio = true;
  await repositorio(deps).escribir(conEmpresa, async (ctx) => {
    const igual =
      dias.valor === ctx.plazo.diasComprobante && vencidos.valor === ctx.plazo.maxVencidos;
    if (igual) {
      propio = false;
      const habia = await ctx.quitarPersona(personaId);
      if (habia) {
        await ctx.auditar({ accion: "quitar_politica_persona", identificador: personaId });
      }
      return;
    }
    await ctx.guardarPersona(personaId, dias.valor, vencidos.valor);
    await ctx.auditar({ accion: "editar_politica_persona", identificador: personaId });
  });
  return { propio };
}

export async function crearCategoria(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { nombre: unknown; tope: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const conEmpresa = exigirEmpresa(ctx);
  const nombre = validarNombreCategoria(entrada.nombre);
  if (!nombre.ok) throw new ErrorDeDominio(nombre.codigo);
  const tope = exigirMonto(entrada.tope, "tope_invalido", true);
  const id = randomUUID();
  await repositorio(deps).escribir(conEmpresa, async (ctx) => {
    await ctx.crearCategoria({ id, nombre: nombre.nombre, topeCentavos: tope });
    await ctx.auditar({ accion: "crear_categoria", identificador: id });
  });
}

export async function escribirTopeCategoria(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { categoriaId: unknown; tope: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!esUuid(entrada.categoriaId)) throw new ErrorDeDominio("categoria_ajena");
  const categoriaId = entrada.categoriaId;
  const tope = exigirMonto(entrada.tope, "tope_invalido", false);
  if (tope === null) throw new ErrorDeDominio("tope_invalido");
  await repositorio(deps).escribir(conEmpresa, async (ctx) => {
    await ctx.escribirTope(categoriaId, tope);
    await ctx.auditar({ accion: "escribir_tope", identificador: categoriaId });
  });
}

export async function quitarTopeCategoria(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { categoriaId: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!esUuid(entrada.categoriaId)) throw new ErrorDeDominio("categoria_ajena");
  const categoriaId = entrada.categoriaId;
  await repositorio(deps).escribir(conEmpresa, async (ctx) => {
    await ctx.quitarTope(categoriaId);
    await ctx.auditar({ accion: "quitar_tope", identificador: categoriaId });
  });
}

export async function borrarCategoria(
  ctx: ContextoDeTenant | null | undefined,
  entrada: { categoriaId: unknown },
  deps?: DependenciasPolitica,
): Promise<void> {
  const conEmpresa = exigirEmpresa(ctx);
  if (!esUuid(entrada.categoriaId)) throw new ErrorDeDominio("categoria_ajena");
  const categoriaId = entrada.categoriaId;
  await repositorio(deps).escribir(conEmpresa, async (ctx) => {
    await ctx.borrarCategoria(categoriaId);
    await ctx.auditar({ accion: "borrar_categoria", identificador: categoriaId });
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

function repositorio(deps?: DependenciasPolitica): RepositorioPolitica {
  return deps?.repositorio ?? repositorioPg();
}

function reloj(deps?: DependenciasPolitica): Date {
  return (deps?.ahora ?? (() => new Date()))();
}
