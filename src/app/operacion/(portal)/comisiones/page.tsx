import type { Metadata } from "next";
import Link from "next/link";

import { solicitarComisionAccion } from "@/app/operacion/acciones";
import { errorDelCampo } from "@/components/operacion/aviso";
import { etiquetaEstado, fechaDia } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { BotonEnviar, Hoja, Insignia, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { textoComision } from "@/dominio/operacion";
import { exigirContextoOperacion, listarClientes, listarComisiones } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Comisiones · Operación" };

export default async function ComisionesOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [clientes, versiones, params] = await Promise.all([listarClientes(ctx), listarComisiones(ctx), searchParams]);
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
              <div className="tabla-contenedor">
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
                <form action={solicitarComisionAccion}>
                  <div className="campo">
                    <label htmlFor="companyId">Empresa</label>
                    <select id="companyId" name="companyId" required>
                      {activos.map((cliente) => (
                        <option key={cliente.id} value={cliente.id}>{cliente.razonSocial} · {cliente.rfc}</option>
                      ))}
                    </select>
                  </div>
                  <div className="campo">
                    <label htmlFor="tipo">Tipo</label>
                    <select id="tipo" name="tipo">
                      <option value="fondeo">Fondeo · puntos base</option>
                      <option value="spei">SPEI · centavos</option>
                    </select>
                  </div>
                  <div className="campo">
                    <label htmlFor="valor">Valor entero</label>
                    <input
                      id="valor"
                      name="valor"
                      inputMode="numeric"
                      pattern="[0-9]+"
                      maxLength={16}
                      required
                      aria-describedby={params.aviso === "comision_valor_invalido" ? "aviso-operacion valor-pista" : "valor-pista"}
                      aria-invalid={params.aviso === "comision_valor_invalido" || undefined}
                    />
                    <p className="pista" id="valor-pista">250 puntos base = 2.50 %; 1500 centavos = $15.00.</p>
                  </div>
                  <div className="campo">
                    <label htmlFor="vigenteDesde">Vigente desde</label>
                    <input id="vigenteDesde" name="vigenteDesde" type="date" required {...errorDelCampo(params.aviso, "vigenteDesde")} />
                  </div>
                  <div className="acciones">
                    <BotonEnviar>Pedir autorización</BotonEnviar>
                  </div>
                </form>
              )}
            </Hoja>
          ) : undefined
        }
      />
      <NotaRegla>Una persona propone la tarifa y otra la autoriza. Hoy no genera cargos.</NotaRegla>
    </PaginaOperacion>
  );
}
