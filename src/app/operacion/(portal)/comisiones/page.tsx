import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { etiquetaEstado, fechaDia } from "@/components/operacion/formato";
import { FormularioComision } from "@/components/operacion/formulario-comision";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Hoja, Insignia, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { textoComision } from "@/dominio/operacion";
import { exigirContextoOperacion, listarClientes, listarComisiones } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Comisiones · Operación" };

export default async function ComisionesOperacion({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const [clientes, versiones, params] = await Promise.all([listarClientes(ctx), listarComisiones(ctx), soloTexto(searchParams)]);
  const propone = puedeEnOperacion(ctx, "plataforma.empresa.alta");
  const activos = clientes.filter((cliente) => cliente.estado === "activa");
  return (
    <PaginaOperacion titulo="Comisiones" aviso={params.aviso}>
      <Rejilla
        principal={
          <Hoja id="versiones-titulo" titulo="Versiones">
            {versiones.length === 0 ? (
              <Vacio titulo="Sin versiones">Propón la primera para una empresa activa.</Vacio>
            ) : (
              <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de versiones de comisiones">
                <table className="tabla operacion-tabla">
                  <thead>
                    <tr>
                      <th scope="col">Empresa</th>
                      <th scope="col">Tarifa</th>
                      <th scope="col">Vigencia</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versiones.map((version) => (
                      <tr key={version.id}>
                        <td>
                          <Link href={`/operacion/clientes/${version.companyId}`}>{version.razonSocial}</Link>
                          <small>Propuso {version.solicitante}</small>
                        </td>
                        <td data-rotulo="Tarifa">{textoComision(version.tipo, version.valor)}</td>
                        <td data-rotulo="Vigencia">
                          {fechaDia(version.vigenteDesde)}
                          {version.vigenteHasta ? <small>hasta {fechaDia(version.vigenteHasta)}</small> : null}
                        </td>
                        <td data-rotulo="Estado">
                          <Insignia tono={version.estado === "vigente" ? "sello" : "neutro"}>{etiquetaEstado(version.estado)}</Insignia>
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
          propone ? (
            <Hoja id="proponer-titulo" titulo="Proponer una versión">
              {activos.length === 0 ? (
                <Vacio titulo="Sin empresas activas">Activa un cliente antes de configurar su tarifa.</Vacio>
              ) : (
                <FormularioComision empresas={activos.map((cliente) => ({ id: cliente.id, nombre: `${cliente.razonSocial} · ${cliente.rfc}` }))} />
              )}
            </Hoja>
          ) : undefined
        }
      />
      <NotaRegla>Una persona propone la tarifa y otra la autoriza. Hoy no genera cargos.</NotaRegla>
    </PaginaOperacion>
  );
}
