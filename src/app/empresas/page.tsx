import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { CabezaPagina, Hoja, Renglon, Renglones } from "@/components/sistema";
import { enEmpresa } from "@/nucleo/rutas";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Empresas",
};

/** Quien pertenece a varias empresas elige una. La elección va en la ruta y no autoriza nada. */
export default async function PaginaEmpresas() {
  const apertura = await abrirRuta("/empresas");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const empresas = ctx?.empresas ?? [];

  return (
    <Marco actual="/empresas" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <CabezaPagina kicker="Empresas" titulo={titulo(apertura.tipo === "libro", empresas.length)}>
          <p className="lede">
            {apertura.tipo === "libro"
              ? "No se pudo consultar tus empresas. Vuelve a intentar."
              : empresas.length === 0
                ? "Tu cuenta no tiene una empresa activa. Pide una invitación a quien la administra."
                : "Cada empresa abre por separado. Lo que ves en una no se mezcla con la otra."}
          </p>
        </CabezaPagina>
        {empresas.length > 0 ? (
          <Hoja id="empresas-titulo" titulo="Tus empresas">
            <Renglones>
              {empresas.map((empresa) => (
                <Renglon key={empresa.id} etiqueta={empresa.razonSocial}>
                  <Link className="enlace-texto" href={enEmpresa(empresa.id, "/consola")}>
                    {ctx?.empresa?.id === empresa.id ? "Abierta ahora" : "Abrir"}
                  </Link>
                </Renglon>
              ))}
            </Renglones>
          </Hoja>
        ) : null}
      </main>
    </Marco>
  );
}

function titulo(sinLibro: boolean, cuantas: number): string {
  if (sinLibro) return "No se pudo abrir.";
  if (cuantas === 0) return "Todavía no hay empresa.";
  return "Elige con qué empresa trabajas.";
}
