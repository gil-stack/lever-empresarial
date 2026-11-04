import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { CabezaPagina } from "@/components/sistema";
import { enEmpresa } from "@/nucleo/rutas";
import { contextoOpcional } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Inicio",
};

/** La portada no da de alta empresas: las da de alta la SOFIPO y después invita a su administrador. */
export default async function Portada() {
  const ctx = await contextoOpcional();

  return (
    <Marco actual="/" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <CabezaPagina kicker="Arco" titulo="Las empresas las da de alta la SOFIPO.">
          <p className="lede">
            Si tu empresa ya es cliente, entra con tu correo, tu contraseña y tu segundo factor. Si te invitaron,
            abre el enlace que llegó a tu correo.
          </p>
          <div className="acciones">
            {ctx ? (
              <Link className="boton" href={ctx.empresa ? enEmpresa(ctx.empresa.id, "/consola") : "/empresas"}>
                Ir a la consola
              </Link>
            ) : (
              <Link className="boton" href="/entrar">
                Entrar
              </Link>
            )}
          </div>
        </CabezaPagina>
      </main>
    </Marco>
  );
}
