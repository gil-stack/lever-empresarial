import type { Metadata } from "next";
import { ConsolaVacia } from "@/components/consola/consola-vacia";
import { Encabezado, Pie } from "@/components/cromo/encabezado";
import { puedeVerMaestro, relatoOperabilidad } from "@/dominio/personas";
import { errorConSecreto, leerEntrada, sesionDesdeCookie } from "@/server/entrada";
import { resumenParaConsola } from "@/server/personas";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Consola",
};

export default async function PaginaConsola({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string | string[] }>;
}) {
  const params = await searchParams;
  const pedido = typeof params.companyId === "string" ? params.companyId : null;
  const entrada = await leerEntrada(pedido);
  const empresa =
    entrada.rfc && entrada.razonSocial ? { rfc: entrada.rfc, razonSocial: entrada.razonSocial } : null;
  const personas = empresa && puedeVerMaestro(entrada.rol) ? await resumenDePersonas() : null;

  return (
    <>
      <Encabezado
        actual="/consola"
        persona={entrada.nombre ? { nombre: entrada.nombre } : null}
        maestro={Boolean(empresa) && puedeVerMaestro(entrada.rol)}
      />
      <main id="contenido">
        <ConsolaVacia
          empresa={empresa}
          libroDisponible={entrada.libroDisponible}
          conSesion={entrada.nombre !== null}
          personas={personas}
        />
      </main>
      <Pie />
    </>
  );
}

async function resumenDePersonas(): Promise<{ titulo: string; detalle: string } | { fallo: true } | null> {
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return null;
    const cuentas = await resumenParaConsola(sesion);
    if (!cuentas) return { fallo: true };
    const relato = relatoOperabilidad(cuentas.nombres);
    return { titulo: relato.titulo, detalle: relato.detalle };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return { fallo: true };
    throw error;
  }
}
