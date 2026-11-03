import type { Metadata } from "next";

import { Maestro, MaestroCerrado } from "@/components/personas/maestro";
import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { puertasDe } from "@/components/cromo/puertas";
import { hoyEnMexico, puedeVerMaestro } from "@/dominio/personas";
import { errorConSecreto, leerEntrada, sesionDesdeCookie } from "@/server/entrada";
import { leerMaestro } from "@/server/personas";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Personas",
};

export default async function PaginaPersonas() {
  const entrada = await leerEntrada();
  const hoy = hoyEnMexico(new Date());
  const cerrado = await cerrar(entrada);

  return (
    <>
      <Encabezado
        actual="/consola/personas"
        persona={entrada.nombre ? { nombre: entrada.nombre } : null}
        {...puertasDe(entrada.rol, Boolean(entrada.rfc))}
      />
      <main id="contenido" className="consola">
        {cerrado.tipo === "abierto" ? (
          <Maestro lectura={cerrado.lectura} hoy={hoy} />
        ) : (
          <MaestroCerrado aviso={cerrado.aviso} />
        )}
      </main>
      <Pie />
    </>
  );
}

async function cerrar(entrada: Awaited<ReturnType<typeof leerEntrada>>) {
  if (!entrada.libroDisponible) return { tipo: "cerrado" as const, aviso: "libro" as const };
  if (!entrada.nombre) return { tipo: "cerrado" as const, aviso: "entrar" as const };
  if (!entrada.rfc) return { tipo: "cerrado" as const, aviso: "sin_empresa" as const };
  if (!puedeVerMaestro(entrada.rol)) return { tipo: "cerrado" as const, aviso: "no_abre" as const };
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return { tipo: "cerrado" as const, aviso: "entrar" as const };
    const lectura = await leerMaestro(sesion);
    return { tipo: "abierto" as const, lectura };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      if (error.codigo === "maestro_no_disponible") return { tipo: "cerrado" as const, aviso: "no_abre" as const };
      if (error.codigo === "sin_empresa") return { tipo: "cerrado" as const, aviso: "sin_empresa" as const };
      if (error.codigo === "sesion_ausente") return { tipo: "cerrado" as const, aviso: "entrar" as const };
      return { tipo: "cerrado" as const, aviso: "libro" as const };
    }
    if (errorConSecreto(error)) return { tipo: "cerrado" as const, aviso: "libro" as const };
    throw error;
  }
}
