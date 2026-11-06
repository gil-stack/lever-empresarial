import type { Metadata } from "next";
import Link from "next/link";

import { registrarProspectoAccion } from "@/app/operacion/acciones";
import { errorDelCampo } from "@/components/operacion/aviso";
import { etiquetaEstado } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Hoja, Insignia, Rejilla, Vacio } from "@/components/sistema";
import { exigirContextoOperacion, listarClientes } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Clientes · Operación" };

export default async function ClientesOperacion({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const ctx = await exigirContextoOperacion();
  const [clientes, params] = await Promise.all([listarClientes(ctx), searchParams]);
  return (
    <PaginaOperacion titulo="Clientes" aviso={params.aviso}>
      <Rejilla
        principal={
          <Hoja id="cartera-titulo" titulo={`Cartera · ${clientes.length}`}>
            {clientes.length === 0 ? (
              <Vacio titulo="Todavía no hay clientes">Registra el primer prospecto con su RFC.</Vacio>
            ) : (
              <div className="tabla-contenedor">
                <table className="tabla">
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
                        <td>{cliente.administrador ?? <span className="pista">Sin administrador</span>}</td>
                        <td>
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
          <Hoja id="prospecto-titulo" titulo="Registrar prospecto">
            <p className="pista">Entra como prospecto; su activación la decide otra persona.</p>
            <form action={registrarProspectoAccion} className="formulario-pareja operacion-forma">
              <div className="campo operacion-ancho">
                <label htmlFor="razonSocial">Razón social</label>
                <input id="razonSocial" name="razonSocial" maxLength={254} required />
              </div>
              <div className="campo">
                <label htmlFor="rfc">RFC</label>
                <input className="entrada-rfc" id="rfc" name="rfc" minLength={12} maxLength={13} autoCapitalize="characters" required {...errorDelCampo(params.aviso, "rfc")} />
              </div>
              <div className="campo">
                <label htmlFor="codigoPostal">Código postal</label>
                <input id="codigoPostal" name="codigoPostal" inputMode="numeric" minLength={5} maxLength={5} required />
              </div>
              <div className="campo">
                <label htmlFor="regimen">Régimen fiscal</label>
                <select id="regimen" name="regimen" defaultValue="601" required>
                  <option value="601">601 · General de ley</option>
                  <option value="612">612 · Actividades empresariales</option>
                  <option value="620">620 · Sociedad cooperativa</option>
                  <option value="626">626 · Simplificado de confianza</option>
                  <option value="603">603 · Instituciones sin fines de lucro</option>
                </select>
              </div>
              <div className="campo">
                <label htmlFor="usoCfdi">Uso CFDI</label>
                <select id="usoCfdi" name="usoCfdi" defaultValue="G03" required>
                  <option value="G03">G03 · Gastos en general</option>
                  <option value="S01">S01 · Sin efectos fiscales</option>
                  <option value="CP01">CP01 · Pagos</option>
                </select>
              </div>
              <div className="acciones">
                <button className="boton" type="submit">Registrar prospecto</button>
              </div>
            </form>
          </Hoja>
        }
      />
    </PaginaOperacion>
  );
}
