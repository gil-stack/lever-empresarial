import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { AvisoRunway, SeccionRunway } from "@/components/flujo/runway";
import { VistaFlujo } from "@/components/flujo/vistas";
import { abrirRuta, errorConSecreto } from "@/server/entrada";
import { leerVistaRunway, type VistaRunway } from "@/server/flujo/runway";
import { leerVistaSaldo, type VistaSaldo } from "@/server/flujo/servicio";
import { ErrorDeDominio } from "@/server/session";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Saldo y alertas" };

export default async function PaginaFlujo() {
  const apertura = await abrirRuta("/consola/flujo");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  let vista: VistaSaldo | null = null;
  let runway: VistaRunway | null = null;
  if (apertura.tipo === "abierta") {
    // Las dos lecturas en paralelo; si el runway falla, el saldo y el colchón se siguen viendo.
    const [saldo, deRunway] = await Promise.allSettled([leerVistaSaldo(apertura.ctx), leerVistaRunway(apertura.ctx)]);
    for (const leido of [saldo, deRunway]) {
      if (leido.status === "rejected" && !(leido.reason instanceof ErrorDeDominio) && !errorConSecreto(leido.reason)) throw leido.reason;
    }
    vista = saldo.status === "fulfilled" ? saldo.value : null;
    runway = deRunway.status === "fulfilled" ? deRunway.value : null;
  }
  return (
    <Marco actual="/consola/flujo" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <VistaFlujo
          vista={vista}
          runway={vista ? <SeccionRunway vista={runway} /> : null}
          avisoRunway={vista && runway ? <AvisoRunway vista={runway} /> : null}
        />
      </main>
    </Marco>
  );
}
