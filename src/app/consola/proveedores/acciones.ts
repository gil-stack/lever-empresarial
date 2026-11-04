"use server";

import { revalidatePath } from "next/cache";

import {
  errorDeCodigo,
  erroresDeAltaProveedor,
  MENSAJE_RECHAZO,
  ordenarErroresProveedor,
  validarConstancia,
  type CodigoRechazoProveedor,
  type ErrorCampoProveedor,
  type EstadoAltaProveedor,
} from "@/dominio/proveedores";
import { contextoDeAccion, errorConSecreto } from "@/server/entrada";
import { cambiarClabeProveedor, darDeAltaProveedor } from "@/server/proveedores";
import { ErrorDeDominio } from "@/server/session";

import { type EstadoClabe } from "./estado";

export async function enviarProveedor(
  _previo: EstadoAltaProveedor,
  formData: FormData,
): Promise<EstadoAltaProveedor> {
  const archivo = await leerArchivo(formData.get("constancia"));
  const errores = erroresDeAltaProveedor({
    rfc: formData.get("rfc"),
    razonSocial: formData.get("razonSocial"),
    clabe: formData.get("clabe"),
    archivo: archivo.meta,
  });
  if (archivo.bytes && archivo.meta) {
    const validada = validarConstancia({ nombre: archivo.meta.nombre, bytes: archivo.bytes });
    if (!validada.ok) {
      const campo = errorDeCodigo(validada.codigo);
      if (campo) {
        const sinConstancia = errores.filter((error) => error.campo !== "constancia");
        sinConstancia.push(campo);
        return { tipo: "invalido", errores: ordenarErroresProveedor(sinConstancia) };
      }
    } else {
      const sesion = await leerSesion();
      if (!sesion) return { tipo: "rechazado", codigo: "sesion" };
      const resto = errores.filter((error) => error.campo !== "constancia");
      if (resto.length > 0) return { tipo: "invalido", errores: ordenarErroresProveedor(resto) };
      try {
        const guardado = await darDeAltaProveedor(sesion, {
          rfc: formData.get("rfc"),
          razonSocial: formData.get("razonSocial"),
          clabe: formData.get("clabe"),
          constancia: { nombre: validada.nombre, bytes: validada.bytes },
        });
        revalidatePath("/consola/proveedores");
        return { tipo: "listo", mensaje: guardado.mensaje };
      } catch (error) {
        return traducir(error);
      }
    }
  }

  if (errores.length > 0) return { tipo: "invalido", errores: ordenarErroresProveedor(errores) };
  return { tipo: "invalido", errores: ordenarErroresProveedor(errores.length > 0 ? errores : [exigir("constancia_ausente")]) };
}

async function leerArchivo(valor: unknown): Promise<{
  meta: { nombre: string; tipo: string; peso: number } | null;
  bytes: Uint8Array | null;
}> {
  if (typeof valor !== "object" || valor === null || !("arrayBuffer" in valor) || !("size" in valor)) {
    return { meta: null, bytes: null };
  }
  const archivo = valor as { name?: unknown; type?: unknown; size?: unknown; arrayBuffer?: () => Promise<ArrayBuffer> };
  const peso = typeof archivo.size === "number" ? archivo.size : 0;
  const nombre = typeof archivo.name === "string" ? archivo.name : "";
  const tipo = typeof archivo.type === "string" ? archivo.type : "";
  if (peso === 0 && nombre.trim() === "") return { meta: null, bytes: null };
  if (peso > 8_000_000 || typeof archivo.arrayBuffer !== "function") {
    return { meta: { nombre, tipo, peso }, bytes: null };
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  return { meta: { nombre, tipo, peso: bytes.byteLength }, bytes };
}

function leerSesion() {
  return contextoDeAccion();
}

function traducir(error: unknown): EstadoAltaProveedor {
  if (!(error instanceof ErrorDeDominio)) {
    if (errorConSecreto(error)) return { tipo: "rechazado", codigo: "libro" };
    throw error;
  }
  const campo = errorDeCodigo(error.codigo);
  if (campo) return { tipo: "invalido", errores: [campo] };
  if (esRechazo(error.codigo)) return { tipo: "rechazado", codigo: error.codigo };
  if (
    error.codigo === "sesion_ausente" ||
    error.codigo === "usuario_ausente"
  ) {
    return { tipo: "rechazado", codigo: "sesion" };
  }
  if (
    error.codigo === "base_no_disponible" ||
    error.codigo === "base_no_configurada" ||
    error.codigo === "auditoria_no_disponible" ||
    error.codigo === "constancia_ajena" ||
    error.codigo === "proveedor_sin_clabe" ||
    error.codigo === "rfc_de_proveedor_fijo" ||
    error.codigo === "clabe_no_se_reescribe"
  ) {
    return { tipo: "rechazado", codigo: "libro" };
  }
  return { tipo: "rechazado", codigo: "libro" };
}

function esRechazo(codigo: string): codigo is CodigoRechazoProveedor {
  return Object.hasOwn(MENSAJE_RECHAZO, codigo);
}

function exigir(codigo: string): ErrorCampoProveedor {
  return errorDeCodigo(codigo) ?? { campo: "constancia", mensaje: "Falta la constancia de situación fiscal." };
}

const MENSAJES_CLABE: Record<string, string> = {
  sesion_ausente: "Hay que entrar para cambiar la CLABE.",
  sin_empresa: "Esta cuenta todavía no tiene razón social.",
  sin_permiso: "Con este rol no se cambia la CLABE.",
  clabe_no_disponible: "Este rol no ve la CLABE del proveedor.",
  clabe_invalida: "Esa CLABE no cierra. El dígito usa la ponderación 3, 7 y 1.",
  proveedor_ausente: "Esa CLABE no está en esta cuenta.",
  clabe_ya_vigente: "Ese proveedor ya tiene una CLABE vigente. Cámbiala: la anterior se queda.",
  clabe_no_se_pisa: "La CLABE anterior no se reescribe. El cambio agrega otra fila.",
  clabe_ya_cerrada: "Esa CLABE ya no está vigente.",
  historial_de_clabe_no_se_borra: "El historial de la CLABE no se borra.",
  auditoria_de_clabe_ausente: "No se pudo dejar constancia del cambio.",
  auditoria_no_disponible: "No se pudo dejar constancia del cambio.",
  base_no_disponible: "No se pudo guardar. El libro no respondió.",
  base_no_configurada: "No se pudo guardar. El libro no respondió.",
};

export async function guardarClabeProveedor(
  _previo: EstadoClabe,
  formData: FormData,
): Promise<EstadoClabe> {
  try {
    const sesion = await contextoDeAccion();
    const resultado = await cambiarClabeProveedor(sesion, {
      supplierId: texto(formData, "supplierId"),
      clabe: texto(formData, "clabe"),
    });
    revalidatePath("/consola/proveedores");
    if (resultado.tipo === "misma") {
      return { tipo: "guardado", mensaje: "Sigue la misma CLABE. No se agregó otra fila." };
    }
    return {
      tipo: "guardado",
      mensaje: "Quedó la CLABE nueva. La anterior sigue en el historial.",
    };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      return { tipo: "invalido", mensaje: MENSAJES_CLABE[error.codigo] ?? MENSAJES_CLABE.base_no_disponible };
    }
    if (errorConSecreto(error)) {
      return { tipo: "invalido", mensaje: MENSAJES_CLABE.base_no_disponible ?? "No se pudo guardar." };
    }
    throw error;
  }
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === "string" ? valor : "";
}
