import type { Metadata } from "next";

import { ConsolaVacia, type CargaCajones } from "@/components/consola/consola-vacia";
import { Marco } from "@/components/cromo/marco";
import { puertasDe } from "@/components/cromo/puertas";
import { puedeVerMaestro, relatoOperabilidad } from "@/dominio/personas";
import { errorConSecreto, leerEntrada, sesionDesdeCookie, sesionSegura } from "@/server/entrada";
import { resumenParaConsola } from "@/server/personas";
import { leerCajones } from "@/server/politica/servicio";
import { esOperadorActual, leerSuscripcionDeLaSesion, leerTarifa } from "@/server/precio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Resumen",
};

export default async function PaginaConsola({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string | string[] }>;
}) {
  const params = await searchParams;
  const pedido = typeof params.companyId === "string" ? params.companyId : null;
  const sesionPendiente = sesionSegura();
  const [entrada, sesion, tarifa, suscripcion, cajones] = await Promise.all([
    leerEntrada(pedido),
    sesionPendiente,
    leerTarifa(),
    sesionPendiente.then((sesionLeida) => leerSuscripcionDeLaSesion(sesionLeida)),
    cargarCajones(),
  ]);
  const empresa =
    entrada.rfc && entrada.razonSocial ? { rfc: entrada.rfc, razonSocial: entrada.razonSocial } : null;
  const personas = empresa && puedeVerMaestro(entrada.rol) ? await resumenDePersonas() : null;

  return (
    <Marco
      actual="/consola"
      persona={entrada.nombre ? { nombre: entrada.nombre } : null}
      {...puertasDe(entrada.rol, Boolean(empresa))}
    >
      <main id="contenido">
        <ConsolaVacia
          empresa={empresa}
          libroDisponible={entrada.libroDisponible}
          conSesion={entrada.nombre !== null}
          nombre={entrada.nombre}
          personas={personas}
          cajones={empresa ? cajones : null}
          tarifa={tarifa}
          suscripcion={suscripcion}
          esOperador={esOperadorActual(sesion)}
        />
      </main>
    </Marco>
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

async function cargarCajones(): Promise<CargaCajones> {
  try {
    const sesion = await sesionDesdeCookie();
    if (!sesion) return { tipo: "aviso", mensaje: "No se pudieron leer los cajones." };
    const vista = await leerCajones(sesion);
    if (!vista) return { tipo: "aviso", mensaje: "No se pudieron leer los cajones." };
    return { tipo: "listos", vista };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) {
      return { tipo: "aviso", mensaje: mensajeCajones(error instanceof ErrorDeDominio ? error.codigo : "") };
    }
    throw error;
  }
}

function mensajeCajones(codigo: string): string {
  if (codigo === "cajones_incompletos") return "Los cajones de esta cuenta no están completos.";
  if (codigo === "politica_ausente") return "Esta cuenta todavía no tiene política en el libro.";
  return "No se pudieron leer los cajones.";
}
