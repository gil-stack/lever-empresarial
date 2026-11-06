import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { AltaColaborador } from "@/components/personas/alta";
import { MaestroCerrado } from "@/components/personas/maestro";
import { NavegacionPersonas } from "@/components/personas/navegacion";
import { CabezaPagina, Vacio } from "@/components/sistema";
import { hoyEnMexico } from "@/dominio/personas";
import { puede } from "@/nucleo/contexto";
import { enEmpresa } from "@/nucleo/rutas";
import { leerMaestro } from "@/server/personas";
import type { LecturaMaestro } from "@/server/personas/tipos";

import { abrirPersonas, errorDePersonas, type AvisoPersonas } from "../apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alta de colaborador · Personas" };

export default async function PaginaNuevaPersona() {
  const apertura = await abrirPersonas("/consola/personas/nueva");
  let lectura: LecturaMaestro | null = null;
  let aviso: AvisoPersonas | null = apertura.ctx && !puede(apertura.ctx, "cliente.maestro.editar") ? "no_abre" : apertura.aviso;
  if (apertura.ctx && !aviso) {
    try {
      lectura = await leerMaestro(apertura.ctx);
    } catch (error) {
      aviso = errorDePersonas(error);
    }
  }
  const empresaId = apertura.ctx?.empresa?.id ?? "";
  const contenido = aviso ? <MaestroCerrado aviso={aviso} /> : lectura ? (
    <>
      <CabezaPagina kicker="Personas" titulo="Alta de colaborador">
        <p className="lede">Un expediente completo: trabajo, presupuesto, nómina, depósito y acceso.</p>
      </CabezaPagina>
      <NavegacionPersonas actual="personas" empresaId={empresaId} />
      {lectura.areas.length === 0 ? (
        <>
          <Vacio titulo="Primero crea un área">El área define el centro de costo y la bolsa mensual del equipo.</Vacio>
          <Link className="boton" href={enEmpresa(empresaId, "/consola/personas/areas")}>Crear área</Link>
        </>
      ) : <AltaColaborador hoy={hoyEnMexico(new Date())} areas={lectura.areas} jefes={lectura.jefes} empresaId={empresaId} altaLlave={randomUUID()} />}
    </>
  ) : <MaestroCerrado aviso="libro" />;
  return <Marco actual="/consola/personas" vista={vistaDeMarco(apertura.ctxMarco)}><main id="contenido" className="consola personas-modulo">{contenido}</main></Marco>;
}
