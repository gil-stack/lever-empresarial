import Link from "next/link";

import { CabezaPagina } from "@/components/sistema";
import type { PendienteInicio } from "@/dominio/inicio";
import { enEmpresa } from "@/nucleo/rutas";

export type CargaInicio =
  | { tipo: "lista"; pendientes: PendienteInicio[]; atajos: PendienteInicio[] }
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
            <Link className="boton" href={enEmpresa(empresaId, "/consola/pendientes")}>Reintentar</Link>
          </div>
        </CabezaPagina>
      </div>
    );
  }

  const operativos = carga.pendientes.filter((pendiente) => pendiente.area === "operacion");
  const configuracion = carga.pendientes.filter((pendiente) => pendiente.area === "configuracion");
  return (
    <div className="consola">
      <CabezaPagina kicker="Consola" titulo="Pendientes">
        <p className="lede">Lo que necesita atención en esta empresa, ordenado para que puedas resolverlo.</p>
      </CabezaPagina>
      <div className="pendientes-resumen" aria-live="polite">
        <strong>{carga.pendientes.length}</strong>
        <span>{carga.pendientes.length === 1 ? "acción pendiente" : "acciones pendientes"}</span>
        <span className="pendientes-resumen-nota">Solo ves lo que tu rol puede atender.</span>
      </div>
      {carga.pendientes.length === 0 ? (
        <EstadoVacio atajos={carga.atajos} empresaId={empresaId} />
      ) : (
        <div className="pendientes-grupos">
          <Grupo id="atencion" titulo="Requiere atención" detalle="Configuración que condiciona la operación." pendientes={operativos} empresaId={empresaId} />
          <Grupo id="puesta-marcha" titulo="Puesta en marcha" detalle="Completa las piezas básicas de tu empresa." pendientes={configuracion} empresaId={empresaId} />
        </div>
      )}
    </div>
  );
}

function Grupo({ id, titulo, detalle, pendientes, empresaId }: { id: string; titulo: string; detalle: string; pendientes: PendienteInicio[]; empresaId: string | null }) {
  if (pendientes.length === 0) return null;
  return (
    <section className="hoja pendientes-inicio" aria-labelledby={`pendientes-${id}`}>
      <header className="pendientes-grupo-cabeza">
        <div>
          <h2 id={`pendientes-${id}`}>{titulo}</h2>
          <p>{detalle}</p>
        </div>
        <span>{pendientes.length}</span>
      </header>
      <ul>
        {pendientes.map((pendiente) => (
          <li key={pendiente.id}>
            <span className={`pendiente-senal pendiente-senal-${pendiente.area}`} aria-hidden="true" />
            <div>
              <h3>{pendiente.titulo}</h3>
              <p>{pendiente.detalle}</p>
            </div>
            <Link className="boton-texto" href={enEmpresa(empresaId, pendiente.ruta)}>{pendiente.accion}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EstadoVacio({ atajos, empresaId }: { atajos: PendienteInicio[]; empresaId: string | null }) {
  return (
    <div className="pendientes-vacio">
      <section className="pendientes-vacio-mensaje" aria-labelledby="sin-pendientes">
        <span className="pendiente-vacio-icono" aria-hidden="true">✓</span>
        <div>
          <h2 id="sin-pendientes">Estás al corriente.</h2>
          <p>No hay acciones esperando por ti. Cuando exista una acción nueva que tu rol pueda atender, aparecerá aquí.</p>
        </div>
      </section>
      {atajos.length > 0 ? (
        <section className="atajos-inicio" aria-labelledby="atajos-titulo">
          <div className="atajos-inicio-cabeza">
            <h2 id="atajos-titulo">Sigue configurando tu empresa</h2>
            <p>Estos accesos no son pendientes: son los siguientes lugares que puedes revisar.</p>
          </div>
          <div className="atajos-inicio-rejilla">
            {atajos.map((atajo) => (
              <Link className="atajo-inicio" key={atajo.id} href={enEmpresa(empresaId, atajo.ruta)}>
                <div>
                  <h3>{atajo.titulo}</h3>
                  <p>{atajo.detalle}</p>
                </div>
                <span className="atajo-inicio-accion">{atajo.accion}<span aria-hidden="true"> →</span></span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
