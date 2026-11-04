import type { Metadata } from "next";
import Link from "next/link";

import { Marco } from "@/components/cromo/marco";
import { vistaDeMarco } from "@/components/cromo/puertas";
import { CabezaPagina, Hoja, Renglon, Renglones } from "@/components/sistema";
import { capacidadesDe, tiene } from "@/nucleo/capacidades";
import { enEmpresa } from "@/nucleo/rutas";
import { abrirRuta } from "@/server/entrada";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Empresas" };

/** Cada empresa ofrece únicamente las superficies que dan sus propios roles. */
export default async function PaginaEmpresas() {
  const apertura = await abrirRuta("/empresas");
  const ctx = apertura.tipo === "libro" ? null : apertura.ctx;
  const empresas = ctx?.empresas ?? [];
  return (
    <Marco actual="/empresas" vista={vistaDeMarco(ctx)}>
      <main id="contenido" className="pagina">
        <CabezaPagina kicker="Empresas" titulo={titulo(apertura.tipo === "libro", empresas.length)}>
          <p className="lede">{apertura.tipo === "libro" ? "No se pudo consultar tus empresas. Vuelve a intentar." : empresas.length === 0 ? "Tu cuenta no tiene una empresa activa. Pide una invitación a quien la administra." : "Cada empresa abre por separado. Lo que ves en una no se mezcla con la otra."}</p>
        </CabezaPagina>
        {empresas.length > 0 ? (
          <Hoja id="empresas-titulo" titulo="Tus empresas">
            <Renglones>
              {empresas.map((empresa) => {
                const capacidades = capacidadesDe({ rolesCliente: empresa.roles, rolesPlataforma: [] });
                return (
                  <Renglon key={empresa.id} etiqueta={empresa.razonSocial}>
                    <span className="acciones-empresa">
                      {tiene(capacidades, "cliente.consola.ver") ? <Link className="enlace-texto" href={enEmpresa(empresa.id, "/consola")}>Abrir consola</Link> : null}
                      {tiene(capacidades, "telefono.inicio.ver") ? <Link className="enlace-texto" href={enEmpresa(empresa.id, "/telefono")}>Abrir teléfono</Link> : null}
                    </span>
                  </Renglon>
                );
              })}
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
