"use server";

import { leerAlta, type EstadoAlta } from "@/dominio/alta";
import { registrarEmpresa } from "@/server/empresa/registrar-empresa";

export async function enviarAlta(_previo: EstadoAlta, formData: FormData): Promise<EstadoAlta> {
  return registrarEmpresa(leerAlta(formData));
}
