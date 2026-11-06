"use server";

import { revalidatePath } from "next/cache";

import { contextoDeAccion } from "@/server/entrada";
import { guardarListado69b } from "@/server/lista-69b";
import { ErrorDeDominio } from "@/server/session";

import type { EstadoFormulario } from "./estado";

const MENSAJES: Record<string, string> = {
  sesion_ausente: "Hay que entrar para guardar el listado.",
  sin_permiso: "La lista la guarda el personal de la plataforma.",
  no_es_operador: "La lista la guarda el personal de la plataforma.",
  sat_no_disponible: "No se pudo leer el listado que publica el SAT. No quedó una copia nueva.",
  pagina_irreconocible: "La página del SAT no trae el listado del artículo 69-B. No se guardó.",
  url_no_publica: "El enlace del listado no es una dirección pública. No se guardó.",
  url_fuera_del_sat: "El enlace del listado no es una dirección del SAT. No se guardó.",
  sin_fecha: "El archivo no declara su fecha. No se guardó.",
  sin_encabezado: "El archivo no trae las columnas de RFC y situación. No se guardó.",
  fila_incompleta: "Una fila del archivo no trae RFC o situación. No se guardó.",
  rfc_ajeno: "Una fila trae un RFC que no cabe en el listado. No se guardó.",
  listado_vacio: "El archivo no trae contribuyentes. No se guardó.",
  listado_demasiado_grande: "El archivo pasa el tope de esta carga. No se guardó.",
  fechas_distintas: "La fecha de la página y la del archivo no coinciden. No se guardó.",
  listado_irreconocible: "El archivo no cabe en el libro. No se guardó.",
  base_no_disponible: "No se pudo guardar. El libro no respondió.",
  base_no_configurada: "No se pudo guardar. El libro no respondió.",
};

export async function guardarCopia69b(): Promise<EstadoFormulario> {
  try {
    const ctx = await contextoDeAccion();
    const guardado = await guardarListado69b(ctx);
    revalidatePath("/consola/lista-69b");
    revalidatePath("/consola/proveedores");
    return {
      tipo: "guardado",
      mensaje: `Archivo del ${guardado.fechaTexto}, con ${guardado.contribuyentesTexto} RFC.`,
    };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      return { tipo: "invalido", mensaje: MENSAJES[error.codigo] ?? MENSAJES.base_no_disponible };
    }
    throw error;
  }
}
