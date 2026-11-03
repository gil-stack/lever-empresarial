import type { Metadata } from "next";

import { Cajones } from "@/components/consola/cajones";
import { ConsolaVacia } from "@/components/consola/consola-vacia";
import { Encabezado, Pie } from "@/components/cromo/encabezado";
import type { VistaCajones } from "@/dominio/politica";
import { leerEntrada, sesionDesdeCookie } from "@/server/entrada";
import { leerCajones } from "@/server/politica/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Consola",
};

type CargaCajones =
  | { tipo: "listos"; vista: VistaCajones }
  | { tipo: "aviso"; mensaje: string };

export default async function PaginaConsola({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string | string[] }>;
}) {
  const params = await searchParams;
  const pedido = typeof params.companyId === "string" ? params.companyId : null;
  const [entrada, cajones] = await Promise.all([leerEntrada(pedido), cargarCajones()]);
  const empresa =
    entrada.rfc && entrada.razonSocial ? { rfc: entrada.rfc, razonSocial: entrada.razonSocial } : null;

  return (
    <>
      <Encabezado actual="/consola" persona={entrada.nombre ? { nombre: entrada.nombre } : null} />
      <main id="contenido">
        <ConsolaVacia
          empresa={empresa}
          libroDisponible={entrada.libroDisponible}
          conSesion={entrada.nombre !== null}
          despues={empresa ? despuesDeCajones(cajones) : null}
        />
      </main>
      <Pie />
    </>
  );
}

function despuesDeCajones(cajones: CargaCajones) {
  if (cajones.tipo === "listos") return <Cajones vista={cajones.vista} />;
  return <p className="nota-saldos">{cajones.mensaje}</p>;
}

async function cargarCajones(): Promise<CargaCajones> {
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return { tipo: "aviso", mensaje: "No se pudieron leer los cajones." };
    const vista = await leerCajones(sesion);
    if (!vista) return { tipo: "aviso", mensaje: "No se pudieron leer los cajones." };
    return { tipo: "listos", vista };
  } catch (error) {
    if (error instanceof ErrorDeDominio) {
      return { tipo: "aviso", mensaje: mensajeCajones(error.codigo) };
    }
    throw error;
  }
}

function mensajeCajones(codigo: string): string {
  if (codigo === "cajones_incompletos") return "Los cajones de esta cuenta no están completos.";
  if (codigo === "politica_ausente") return "Esta cuenta todavía no tiene política en el libro.";
  return "No se pudieron leer los cajones.";
}
