import Link from "next/link";

import { CabezaPagina } from "@/components/sistema";
import type { PendienteInicio } from "@/dominio/inicio";
import { enEmpresa } from "@/nucleo/rutas";

export type CargaInicio =
  | { tipo: "lista"; pendientes: PendienteInicio[] }
  | { tipo: "error" }
  | { tipo: "sin_empresa" };

export function Pendientes({ carga, empresaId }: { carga: CargaInicio; empresaId: string | null }) {
  if (carga.tipo === "sin_empresa") {
    return (
      <div className="consola">
        <CabezaPagina kicker="Pendientes" titulo="Todavía no hay una empresa activa.">
          <p className="lede">Pide una invitación a quien administra la empresa. Aquí no se crea una cuenta nueva.</p>
        </CabezaPagina>
      </div>
    );
  }
  if (carga.tipo === "error") {
    return (
      <div className="consola">
        <CabezaPagina kicker="Pendientes" titulo="No se pudieron consultar tus pendientes.">
          <p className="lede">No se muestran cifras ni tareas supuestas. Vuelve a intentar.</p>
          <div className="acciones">
            <Link className="boton" href={enEmpresa(empresaId, "/consola")}>Reintentar</Link>
          </div>
        </CabezaPagina>
      </div>
    );
  }
  return (
    <div className="consola">
      <CabezaPagina kicker="Inicio" titulo="Pendientes">
        <p className="lede">Solo aparece lo que existe en esta empresa y lo que tu rol puede atender.</p>
      </CabezaPagina>
      {carga.pendientes.length === 0 ? (
        <section className="vacio" aria-labelledby="sin-pendientes">
          <p className="vacio-titulo" id="sin-pendientes">Nada espera tu acción.</p>
          <p>No hay una tarea de configuración que puedas completar con este rol. Los gastos y sus comprobantes llegarán cuando exista ese expediente.</p>
        </section>
      ) : (
        <section className="hoja pendientes-inicio" aria-labelledby="pendientes-titulo">
          <h2 id="pendientes-titulo">Para hacer ahora</h2>
          <ul>
            {carga.pendientes.map((pendiente) => (
              <li key={pendiente.id}>
                <div>
                  <h3>{pendiente.titulo}</h3>
                  <p>{pendiente.detalle}</p>
                </div>
                <Link className="boton-texto" href={enEmpresa(empresaId, pendiente.ruta)}>{pendiente.accion}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
