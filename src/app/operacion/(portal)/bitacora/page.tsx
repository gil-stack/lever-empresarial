import type { Metadata } from "next";
import Link from "next/link";

import { etiquetaAccion, fechaHora } from "@/components/operacion/formato";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { Hoja, Vacio } from "@/components/sistema";
import { exigirContextoOperacion, leerBitacora } from "@/server/operacion";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Bitácora · Operación" };

export default async function BitacoraOperacion() {
  const ctx = await exigirContextoOperacion();
  const eventos = await leerBitacora(ctx);
  return (
    <PaginaOperacion titulo="Bitácora" entrada="Quién hizo qué, cuándo y por qué. Nadie la puede editar.">
      <Hoja id="eventos-titulo" titulo="Eventos">
        {eventos.length === 0 ? (
          <Vacio titulo="Sin eventos">Cada decisión de Operación queda aquí.</Vacio>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla operacion-tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Empresa</th>
                  <th scope="col">Quién</th>
                  <th scope="col">Acción</th>
                  <th scope="col">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((evento) => (
                  <tr key={evento.id}>
                    <td className="operacion-sin-corte">{fechaHora(evento.ocurridoEn)}</td>
                    <td data-rotulo="Empresa">
                      {evento.companyId && evento.razonSocial ? (
                        <Link href={`/operacion/clientes/${evento.companyId}`}>{evento.razonSocial}</Link>
                      ) : (
                        "Plataforma"
                      )}
                    </td>
                    <td data-rotulo="Quién">{evento.actor}</td>
                    <td data-rotulo="Acción">
                      {etiquetaAccion(evento.accion) ?? evento.accion}
                      <small className="operacion-mono">
                        {evento.accion} · {evento.entidad}
                      </small>
                    </td>
                    <td data-rotulo="Motivo">{evento.motivo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Hoja>
    </PaginaOperacion>
  );
}
