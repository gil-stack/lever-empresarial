import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { etiquetaEstado } from "@/components/operacion/formato";
import { FormularioProspecto } from "@/components/operacion/formulario-prospecto";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Hoja, Insignia, Rejilla, Vacio } from "@/components/sistema";
import { exigirContextoOperacion, listarClientes } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Clientes · Operación" };

export default async function ClientesOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const [clientes, params] = await Promise.all([listarClientes(ctx), soloTexto(searchParams)]);
  const registra = puedeEnOperacion(ctx, "plataforma.prospecto.registrar");
  return (
    <PaginaOperacion titulo="Clientes" aviso={params.aviso}>
      <Rejilla
        principal={
          <Hoja id="cartera-titulo" titulo={`Cartera · ${clientes.length}`}>
            {clientes.length === 0 ? (
              <Vacio titulo="Todavía no hay clientes">Registra el primer prospecto con su RFC.</Vacio>
            ) : (
              <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de la cartera de clientes">
                <table className="tabla operacion-tabla">
                  <thead>
                    <tr>
                      <th scope="col">Empresa</th>
                      <th scope="col">Administrador</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientes.map((cliente) => (
                      <tr key={cliente.id}>
                        <td>
                          <Link href={`/operacion/clientes/${cliente.id}`}>{cliente.razonSocial}</Link>
                          <small className="operacion-mono">{cliente.rfc}</small>
                        </td>
                        <td data-rotulo="Administrador">{cliente.administrador ?? <span className="pista">Sin administrador</span>}</td>
                        <td data-rotulo="Estado">
                          <Insignia tono={cliente.estado === "activa" ? "sello" : "neutro"}>{etiquetaEstado(cliente.estado)}</Insignia>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Hoja>
        }
        lateral={
          registra ? (
            <Hoja id="prospecto-titulo" titulo="Registrar prospecto">
              <p className="pista">Entra como prospecto; su activación la decide otra persona.</p>
              <FormularioProspecto />
            </Hoja>
          ) : undefined
        }
      />
    </PaginaOperacion>
  );
}
