"use server";

import { redirect } from "next/navigation";

import {
  leerAlta,
  ordenarErrores,
  validarAlta,
  type ErrorCampo,
  type EstadoAlta,
} from "@/dominio/alta";
import { darDeAltaEmpresa } from "@/server/company";
import { fijarCookieDeSesion, sesionDesdeCookie } from "@/server/entrada";
import { ErrorDeDominio, abrirCuenta, entrar, type Sesion } from "@/server/session";
import { validarCuenta } from "@/server/session/validar";

const MENSAJE_CAMPO: Record<string, ErrorCampo> = {
  rfc_invalido: { campo: "rfc", mensaje: "El RFC no tiene la forma de una clave del SAT." },
  rfc_generico: {
    campo: "rfc",
    mensaje: "El RFC genérico no abre una cuenta. Hace falta el de la razón social.",
  },
  razon_social_invalida: {
    campo: "razonSocial",
    mensaje: "Escribe la razón social tal como va a facturar.",
  },
  codigo_postal_invalido: {
    campo: "codigoPostal",
    mensaje: "Ese código postal no corresponde a un domicilio fiscal.",
  },
  regimen_invalido: { campo: "regimen", mensaje: "Elige un régimen del catálogo." },
  uso_cfdi_invalido: { campo: "usoCfdi", mensaje: "Elige un uso de CFDI del catálogo." },
  nombre_invalido: { campo: "nombre", mensaje: "Escribe el nombre de quien abre la cuenta." },
  correo_invalido: { campo: "correo", mensaje: "Escribe un correo válido." },
  contrasena_invalida: {
    campo: "contrasena",
    mensaje: "La contraseña necesita al menos 10 caracteres. Si es demasiado larga, elige otra.",
  },
  credenciales_invalidas: {
    campo: "contrasena",
    mensaje: "Ese correo ya tiene cuenta y la contraseña no coincide.",
  },
};

export async function enviarAlta(_previo: EstadoAlta, formData: FormData): Promise<EstadoAlta> {
  const { alta, errores } = validarAlta(leerAlta(formData));
  let sesion: Sesion | null;
  try {
    sesion = await sesionDesdeCookie();
  } catch (error) {
    const estado = traducir(error);
    if (estado) return estado;
    throw error;
  }
  if (!sesion) errores.push(...erroresDeCuenta(formData));
  if (errores.length > 0) return { tipo: "invalido", errores: ordenarErrores(errores) };

  try {
    const vigente = sesion ?? (await abrirOEntrar(formData));
    await darDeAltaEmpresa(vigente, {
      rfc: alta.rfc,
      razonSocial: alta.razonSocial,
      codigoPostal: alta.codigoPostal,
      regimen: alta.regimen,
      usoCfdi: alta.usoCfdi,
    });
  } catch (error) {
    const estado = traducir(error);
    if (estado) return estado;
    throw error;
  }

  redirect("/consola");
}

async function abrirOEntrar(formData: FormData): Promise<Sesion> {
  const entrada = {
    nombre: String(formData.get("nombre") ?? ""),
    correo: String(formData.get("correo") ?? ""),
    contrasena: String(formData.get("contrasena") ?? ""),
  };
  try {
    const abierta = await abrirCuenta(entrada);
    await fijarCookieDeSesion(abierta.setCookie);
    return abierta.sesion;
  } catch (error) {
    if (!(error instanceof ErrorDeDominio) || error.codigo !== "correo_duplicado") throw error;
  }
  const abierta = await entrar({ correo: entrada.correo, contrasena: entrada.contrasena });
  await fijarCookieDeSesion(abierta.setCookie);
  return abierta.sesion;
}

function erroresDeCuenta(formData: FormData): ErrorCampo[] {
  const resultado = validarCuenta({
    nombre: String(formData.get("nombre") ?? ""),
    correo: String(formData.get("correo") ?? ""),
    contrasena: String(formData.get("contrasena") ?? ""),
  });
  if (resultado.ok) return [];
  const campo = MENSAJE_CAMPO[resultado.codigo];
  return campo ? [campo] : [{ campo: "nombre", mensaje: "Revisa quién entra." }];
}

function traducir(error: unknown): EstadoAlta | null {
  if (error instanceof ErrorDeDominio) {
    const campo = MENSAJE_CAMPO[error.codigo];
    if (campo) return { tipo: "invalido", errores: [campo] };
    if (error.codigo === "segunda_razon_social" || error.codigo === "rfc_duplicado") {
      return { tipo: "rechazado", codigo: error.codigo };
    }
    if (error.codigo === "sesion_ausente" || error.codigo === "usuario_ausente") {
      return { tipo: "rechazado", codigo: "sesion" };
    }
    return { tipo: "rechazado", codigo: "libro" };
  }
  return null;
}
