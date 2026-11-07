import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { CabezaPagina } from "@/components/sistema";
import { enEmpresa } from "@/nucleo/rutas";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Configuración" };

export default async function PaginaConfiguracion() {
  const apertura = await abrirRuta("/consola/configuracion");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const empresaId = ctx?.empresa?.id ?? null;
  return (
    <Marco actual="/consola/configuracion" vista={vistaDeMarco(ctx)} titulo="Configuración">
      <main id="contenido" className="consola">
        {apertura.tipo === "libro" ? (
          <CabezaPagina kicker="Configuración" titulo="No se pudo abrir Configuración.">
            <p className="lede">Vuelve a intentarlo en un momento.</p>
          </CabezaPagina>
        ) : apertura.tipo === "sin_permiso" ? (
          <CabezaPagina kicker="Configuración" titulo="Tu rol no abre Configuración.">
            <p className="lede">Pide acceso a quien administra la empresa.</p>
          </CabezaPagina>
        ) : apertura.tipo === "sin_empresa" ? (
          <CabezaPagina kicker="Configuración" titulo="Elige una empresa.">
            <p className="lede">La configuración se abre dentro de una empresa.</p>
            <div className="acciones"><Link className="boton" href="/empresas">Elegir empresa</Link></div>
          </CabezaPagina>
        ) : (
          <>
            <h1 className="solo-lector">Configuración</h1>
            <section className="panel" aria-labelledby="configuracion-titulo">
              <div className="panel-cabeza">
                <h2 id="configuracion-titulo">Esta empresa</h2>
              </div>
              <ul className="ajustes">
                <li>
                  <Link href={enEmpresa(empresaId, "/consola/configuracion/plan")}>
                    <strong>Plan</strong>
                    <span>Tu suscripción y lo que se cobra.</span>
                  </Link>
                </li>
                <li>
                  <Link href={enEmpresa(empresaId, "/consola/poliza")}>
                    <strong>Póliza</strong>
                    <span>Las pólizas para tu contador, en solo lectura.</span>
                  </Link>
                </li>
                <li>
                  <Link href={enEmpresa(empresaId, "/consola/apariencia")}>
                    <strong>Apariencia</strong>
                    <span>Tema, escena y color de tu consola.</span>
                  </Link>
                </li>
                <li>
                  <Link href="/entrar/seguridad">
                    <strong>Seguridad</strong>
                    <span>Tu passkey, la app autenticadora y los códigos de respaldo.</span>
                  </Link>
                </li>
              </ul>
            </section>
          </>
        )}
      </main>
    </Marco>
  );
}
