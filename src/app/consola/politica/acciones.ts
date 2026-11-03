"use server";

import { revalidatePath } from "next/cache";

import { sesionDesdeCookie } from "@/server/entrada";
import { ErrorDeDominio, type Sesion } from "@/server/session";
import {
  borrarCategoria,
  crearCategoria,
  editarPlazoEmpresa,
  editarPoliticaPersona,
  editarUmbral,
  escribirTopeCategoria,
  quitarTopeCategoria,
} from "@/server/politica/servicio";
import type { EstadoFormulario } from "./estado";

const MENSAJES: Record<string, string> = {
  sesion_ausente: "Hay que entrar para escribir la política.",
  sin_empresa: "Esta cuenta todavía no tiene razón social.",
  rol_sin_permiso: "Tu rol no escribe la política.",
  politica_ausente: "Esta cuenta todavía no tiene política en el libro.",
  dias_invalidos: "Los días tienen que ser un entero entre 1 y 365.",
  vencidos_invalidos: "Los comprobantes vencidos tienen que ser un entero entre 1 y 365.",
  umbral_invalido: "El umbral se escribe en pesos, con centavos.",
  tope_invalido: "El tope se escribe en pesos, con centavos.",
  nombre_invalido: "Escribe el nombre de la categoría.",
  categoria_duplicada: "Ya hay una categoría con ese nombre.",
  categoria_ajena: "Esa categoría no es de esta cuenta.",
  persona_ajena: "Esa persona no es de esta cuenta.",
  politica_invalida: "Esos números no caben en la política.",
  cajones_incompletos: "Los cajones de esta cuenta no están completos.",
  base_no_disponible: "No se pudo guardar. El libro no respondió.",
  base_no_configurada: "No se pudo guardar. El libro no respondió.",
};

export async function guardarPlazoEmpresa(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  return correr(async (sesion) => {
    await editarPlazoEmpresa(sesion, {
      dias: texto(formData, "dias"),
      vencidos: texto(formData, "vencidos"),
    });
    return "Quedaron escritos los días y los comprobantes vencidos de la empresa.";
  });
}

export async function guardarUmbral(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const quitar = formData.get("intencion") === "quitar";
  return correr(async (sesion) => {
    await editarUmbral(sesion, { texto: texto(formData, "umbral"), quitar });
    return quitar
      ? "El umbral volvió a quedar sin monto."
      : "Quedó escrito el umbral de proveedores.";
  });
}

export async function guardarPoliticaPersona(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const quitar = formData.get("intencion") === "quitar";
  return correr(async (sesion) => {
    const resultado = await editarPoliticaPersona(sesion, {
      personaId: texto(formData, "personaId"),
      dias: texto(formData, "dias"),
      vencidos: texto(formData, "vencidos"),
      quitar,
    });
    if (quitar) return "Esta persona volvió al plazo de la empresa.";
    if (!resultado.propio) return "Sigue el plazo de la empresa. No quedó un plazo propio.";
    return "Quedó escrito el plazo de esta persona.";
  });
}

export async function agregarCategoria(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  return correr(async (sesion) => {
    await crearCategoria(sesion, {
      nombre: texto(formData, "nombre"),
      tope: texto(formData, "tope"),
    });
    return texto(formData, "tope").trim().length === 0
      ? "Quedó la categoría, sin tope."
      : "Quedó la categoría con el tope escrito.";
  });
}

export async function guardarTopeCategoria(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  return correr(async (sesion) => {
    await escribirTopeCategoria(sesion, {
      categoriaId: texto(formData, "categoriaId"),
      tope: texto(formData, "tope"),
    });
    return "Quedó escrito el tope.";
  });
}

export async function dejarCategoriaSinTope(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  return correr(async (sesion) => {
    await quitarTopeCategoria(sesion, { categoriaId: texto(formData, "categoriaId") });
    return "La categoría volvió a quedar sin tope.";
  });
}

export async function eliminarCategoria(
  _previo: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  return correr(async (sesion) => {
    await borrarCategoria(sesion, { categoriaId: texto(formData, "categoriaId") });
    return "Se borró la categoría.";
  });
}

async function correr(fn: (sesion: Sesion) => Promise<string>): Promise<EstadoFormulario> {
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return invalido("sesion_ausente");
    const mensaje = await fn(sesion);
    revalidatePath("/consola");
    revalidatePath("/consola/politica");
    return { tipo: "guardado", mensaje };
  } catch (error) {
    if (error instanceof ErrorDeDominio) return invalido(error.codigo);
    throw error;
  }
}

function invalido(codigo: string): EstadoFormulario {
  const campo = codigo === "dias_invalidos" ? "dias" : codigo === "vencidos_invalidos" ? "vencidos" : undefined;
  return { tipo: "invalido", mensaje: MENSAJES[codigo] ?? "No se pudo guardar.", campo };
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : "";
}
