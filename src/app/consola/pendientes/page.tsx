import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { AlertaFaltante } from "@/components/flujo/alerta-faltante";
import { Pendientes, type CargaInicio } from "@/components/inicio/pendientes";
import { Aviso } from "@/components/sistema";
import { puede, type ContextoDeTenant } from "@/nucleo/contexto";
import { enEmpresa } from "@/nucleo/rutas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerFaltanteParaPendientes, type FaltanteDePendientes } from "@/server/flujo/servicio";
import { bandejaDeLaPeticion } from "@/server/inicio/peticion";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Pendientes" };

/** Una proyección por petición: quien más la pida en esta petición recibe la misma lectura. Nunca rechaza. */
const faltanteDeLaPeticion = cache((ctx: ContextoDeTenant) => leerFaltanteParaPendientes(ctx));

export default async function PaginaPendientes() {
  const apertura = await abrirRuta("/consola/pendientes");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const empresaId = ctx?.empresa?.id ?? null;
  const { carga, faltante } = await cargar(apertura);

  return (
    <Marco actual="/consola/pendientes" vista={vistaDeMarco(ctx)}>
      <main id="contenido">
        <Pendientes
          carga={carga}
          empresaId={empresaId}
          alertas={faltante && ctx ? <Alertas faltante={faltante} ctx={ctx} empresaId={empresaId} /> : null}
        />
      </main>
    </Marco>
  );
}

function Alertas({
  faltante,
  ctx,
  empresaId,
}: {
  faltante: Exclude<FaltanteDePendientes, null>;
  ctx: ContextoDeTenant;
  empresaId: string | null;
}) {
  return (
    <section className="flujo-alertas" aria-labelledby="pendientes-alertas-titulo">
      <h2 id="pendientes-alertas-titulo" className="solo-lector">Alertas</h2>
      {faltante === "no_disponible" ? (
        <div data-alerta="faltante-no-disponible">
          <Aviso titulo="No se pudo calcular si te alcanza el dinero">
            <p>
              Revisa <Link href={enEmpresa(empresaId, "/consola/flujo")}>Saldo y alertas</Link>.
            </p>
          </Aviso>
        </div>
      ) : (
        <AlertaFaltante faltante={faltante.faltante} colchonCentavos={faltante.colchonCentavos} enlace={destinoDelFaltante(ctx, empresaId)} />
      )}
    </section>
  );
}

/** Quien ve las cifras de Inicio va a la proyección; el resto, a Saldo y alertas. */
function destinoDelFaltante(ctx: ContextoDeTenant, empresaId: string | null): { href: string; texto: string } {
  return puede(ctx, "cliente.resumen.ver")
    ? { href: `${enEmpresa(empresaId, "/consola")}#proyeccion-titulo`, texto: "Ver la proyección" }
    : { href: enEmpresa(empresaId, "/consola/flujo"), texto: "Revisar saldo y alertas" };
}

async function cargar(apertura: Awaited<ReturnType<typeof abrirRuta>>): Promise<{ carga: CargaInicio; faltante: FaltanteDePendientes }> {
  if (apertura.tipo === "libro") return { carga: { tipo: "error" }, faltante: null };
  if (apertura.tipo === "sin_empresa") return { carga: { tipo: "sin_empresa" }, faltante: null };
  try {
    // El faltante no rechaza: si su proyección falla llega «no_disponible» y la bandeja se pinta igual.
    const [bandeja, faltante] = await Promise.all([bandejaDeLaPeticion(apertura.ctx), faltanteDeLaPeticion(apertura.ctx)]);
    return { carga: { tipo: "lista", ...bandeja }, faltante };
  } catch (error) {
    if (error instanceof ErrorDeDominio || errorConSecreto(error)) return { carga: { tipo: "error" }, faltante: null };
    throw error;
  }
}
