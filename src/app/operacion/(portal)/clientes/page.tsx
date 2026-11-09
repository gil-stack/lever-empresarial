import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/app/operacion/busqueda";
import { registrarProspectoAccion } from "@/app/operacion/acciones";
import { errorDelCampo, MensajeDelCampo } from "@/components/operacion/aviso";
import { REGIMENES, USOS_CFDI, etiquetaEstado } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { BotonEnviar, Hoja, Insignia, Rejilla, Vacio } from "@/components/sistema";
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
              <div className="tabla-contenedor">
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
              <form action={registrarProspectoAccion} className="formulario-pareja operacion-forma">
                <div className="campo operacion-ancho">
                  <label htmlFor="razonSocial">Razón social</label>
                  <input id="razonSocial" name="razonSocial" maxLength={254} required {...errorDelCampo(params.aviso, "razonSocial")} />
                  <MensajeDelCampo codigo={params.aviso} campo="razonSocial" />
                </div>
                <div className="campo">
                  <label htmlFor="rfc">RFC</label>
                  <input className="entrada-rfc" id="rfc" name="rfc" minLength={12} maxLength={13} autoCapitalize="characters" required {...errorDelCampo(params.aviso, "rfc")} />
                  <MensajeDelCampo codigo={params.aviso} campo="rfc" />
                </div>
                <div className="campo">
                  <label htmlFor="codigoPostal">Código postal</label>
                  <input id="codigoPostal" name="codigoPostal" inputMode="numeric" minLength={5} maxLength={5} required {...errorDelCampo(params.aviso, "codigoPostal")} />
                  <MensajeDelCampo codigo={params.aviso} campo="codigoPostal" />
                </div>
                <div className="campo">
                  <label htmlFor="regimen">Régimen fiscal</label>
                  <select id="regimen" name="regimen" defaultValue="601" required {...errorDelCampo(params.aviso, "regimen")}>
                    {REGIMENES.map(([valor, nombre]) => (
                      <option key={valor} value={valor}>
                        {valor} · {nombre}
                      </option>
                    ))}
                  </select>
                  <MensajeDelCampo codigo={params.aviso} campo="regimen" />
                </div>
                <div className="campo">
                  <label htmlFor="usoCfdi">Uso CFDI</label>
                  <select id="usoCfdi" name="usoCfdi" defaultValue="G03" required {...errorDelCampo(params.aviso, "usoCfdi")}>
                    {USOS_CFDI.map(([valor, nombre]) => (
                      <option key={valor} value={valor}>
                        {valor} · {nombre}
                      </option>
                    ))}
                  </select>
                  <MensajeDelCampo codigo={params.aviso} campo="usoCfdi" />
                </div>
                <div className="acciones">
                  <BotonEnviar>Registrar prospecto</BotonEnviar>
                </div>
              </form>
            </Hoja>
          ) : undefined
        }
      />
    </PaginaOperacion>
  );
}
