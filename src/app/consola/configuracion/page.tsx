import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { CabezaPagina, Hoja, Renglon, Renglones } from "@/components/sistema";
import { enEmpresa } from "@/nucleo/rutas";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Configuración" };

export default async function PaginaConfiguracion() {
  const apertura = await abrirRuta("/consola/configuracion");
  if (apertura.tipo === "sin_permiso") notFound();
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const empresaId = ctx?.empresa?.id ?? null;
  return (
    <Marco actual="/consola/configuracion" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="consola">
        <CabezaPagina kicker="Cuenta" titulo="Configuración">
          <p className="lede">Plan y lecturas administrativas de esta empresa. Ninguna opción publica precios ni mueve dinero.</p>
        </CabezaPagina>
        {apertura.tipo === "libro" || apertura.tipo === "sin_empresa" ? (
          <div className="vacio"><p className="vacio-titulo">{apertura.tipo === "libro" ? "No se pudo confirmar la empresa." : "No hay una empresa activa."}</p><p>Vuelve a intentar cuando la membresía esté disponible.</p></div>
        ) : (
          <Hoja id="configuracion-titulo" titulo="Administración">
            <Renglones>
              <Renglon etiqueta="Plan"><Link className="enlace-texto" href={enEmpresa(empresaId, "/consola/configuracion/plan")}>Ver suscripción y precios</Link></Renglon>
              <Renglon etiqueta="Póliza"><Link className="enlace-texto" href={enEmpresa(empresaId, "/consola/poliza")}>Abrir en solo lectura</Link></Renglon>
            </Renglones>
          </Hoja>
        )}
      </main>
    </Marco>
  );
}
