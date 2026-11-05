import type { Metadata } from "next";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { DirectorioPersonas } from "@/components/personas/directorio";
import { MaestroCerrado } from "@/components/personas/maestro";
import { hoyEnMexico } from "@/dominio/personas";
import { puede } from "@/nucleo/contexto";
import { leerMaestro } from "@/server/personas";
import type { FiltrosPersonas, LecturaMaestro } from "@/server/personas/tipos";

import { abrirPersonas, errorDePersonas, type AvisoPersonas } from "./apertura";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Personas" };

type Busqueda = Promise<Record<string, string | string[] | undefined>>;

export default async function PaginaPersonas({ searchParams }: { searchParams: Busqueda }) {
  const [apertura, parametros] = await Promise.all([abrirPersonas("/consola/personas"), searchParams]);
  const filtros = leerFiltros(parametros);
  let lectura: LecturaMaestro | null = null;
  let aviso: AvisoPersonas | null = apertura.aviso;
  if (apertura.ctx) {
    try {
      lectura = await leerMaestro(apertura.ctx, filtros);
    } catch (error) {
      aviso = errorDePersonas(error);
    }
  }
  const contenido = aviso ? <MaestroCerrado aviso={aviso} /> : apertura.ctx && lectura ? (
    <DirectorioPersonas lectura={lectura} filtros={filtros} hoy={hoyEnMexico(new Date())} empresaId={apertura.ctx.empresa?.id ?? ""} edita={puede(apertura.ctx, "cliente.maestro.editar")} />
  ) : <MaestroCerrado aviso="libro" />;
  return (
    <Marco actual="/consola/personas" vista={vistaDeMarco(apertura.ctxMarco)}>
      <main id="contenido" className="consola personas-modulo">{contenido}</main>
    </Marco>
  );
}

function leerFiltros(parametros: Record<string, string | string[] | undefined>): FiltrosPersonas {
  const texto = (clave: string) => {
    const valor = parametros[clave];
    return typeof valor === "string" ? valor.trim() : "";
  };
  const estadoCrudo = texto("estado");
  const estado = ["vigentes", "pendientes", "bajas"].includes(estadoCrudo) ? estadoCrudo as FiltrosPersonas["estado"] : "todos";
  const area = texto("area");
  const pagina = Math.max(1, Math.min(100000, Number.parseInt(texto("pagina"), 10) || 1));
  return {
    buscar: texto("q").slice(0, 100),
    centroId: /^[0-9a-f-]{36}$/i.test(area) ? area : null,
    estado,
    pagina,
  };
}
