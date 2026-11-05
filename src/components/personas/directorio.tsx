import Link from "next/link";

import { CabezaPagina, Insignia, Vacio } from "@/components/sistema";
import { fechaLarga } from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";
import type { FiltrosPersonas, LecturaMaestro } from "@/server/personas/tipos";

import { NavegacionPersonas } from "./navegacion";
import { ResumenPersonas } from "./resumen";
import { accesoVisible, dinero, estadoDePersona } from "./util";

export function DirectorioPersonas({
  lectura,
  filtros,
  hoy,
  empresaId,
  edita,
}: {
  lectura: LecturaMaestro;
  filtros: FiltrosPersonas;
  hoy: string;
  empresaId: string;
  edita: boolean;
}) {
  const paginas = Math.max(1, Math.ceil(lectura.total / lectura.porPagina));
  return (
    <>
      <CabezaPagina kicker="Equipo" titulo="Personas">
        <p className="lede">Colaboradores, presupuestos y nómina en un solo expediente.</p>
        {edita ? (
          <div className="acciones">
            <Link className="boton" href={enEmpresa(empresaId, "/consola/personas/nueva")}>Dar de alta</Link>
          </div>
        ) : <p className="regla-fija">Tu rol consulta el maestro. No cambia personas, presupuestos ni nómina.</p>}
      </CabezaPagina>
      <ResumenPersonas resumen={lectura.resumen} />
      <NavegacionPersonas actual="personas" empresaId={empresaId} />

      <form className="personas-filtros" action={enEmpresa(empresaId, "/consola/personas")} method="get">
        <div className="campo">
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" defaultValue={filtros.buscar} placeholder="Nombre o correo" maxLength={100} />
        </div>
        <div className="campo">
          <label htmlFor="area">Área</label>
          <select id="area" name="area" defaultValue={filtros.centroId ?? ""}>
            <option value="">Todas</option>
            {lectura.centros.map((centro) => <option key={centro.id} value={centro.id}>{centro.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="estado">Estado</label>
          <select id="estado" name="estado" defaultValue={filtros.estado}>
            <option value="todos">Todos</option>
            <option value="vigentes">Vigentes</option>
            <option value="pendientes">Por configurar</option>
            <option value="bajas">De baja</option>
          </select>
        </div>
        <div className="acciones">
          <button className="boton-texto" type="submit">Aplicar filtros</button>
          <Link className="enlace-texto" href={enEmpresa(empresaId, "/consola/personas")}>Limpiar</Link>
        </div>
      </form>

      <p className="personas-total" role="status">
        {lectura.total} {lectura.total === 1 ? "persona" : "personas"} · página {lectura.pagina} de {paginas}
      </p>

      {lectura.personas.length === 0 ? (
        <Vacio titulo={lectura.total === 0 ? "No hay personas con estos filtros" : "Esta página quedó fuera del directorio"}>
          {lectura.total === 0 ? "Prueba con otra búsqueda o limpia los filtros." : "Vuelve a la primera página para seguir consultando."}
        </Vacio>
      ) : (
        <div className="personas-tabla-envoltura">
          <table className="personas-tabla">
            <thead>
              <tr>
                <th scope="col">Colaborador</th>
                <th scope="col">Área</th>
                <th scope="col">Nómina neta</th>
                <th scope="col">Presupuesto</th>
                <th scope="col">Acceso / tarjeta</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {lectura.personas.map((persona) => {
                const estado = estadoDePersona(persona, hoy);
                return (
                  <tr key={persona.id}>
                    <td data-label="Colaborador">
                      <Link className="persona-enlace" href={enEmpresa(empresaId, `/consola/personas/${persona.id}`)}>
                        {persona.nombre}
                      </Link>
                      <span className="persona-celda-nota">{persona.correo ?? `Ingreso · ${fechaLarga(persona.altaEn)}`}</span>
                    </td>
                    <td data-label="Área">{persona.centroNombre}<span className="persona-celda-nota">{persona.jefeNombre ? `Jefe · ${persona.jefeNombre}` : "Sin jefe"}</span></td>
                    <td className="numero" data-label="Nómina neta">
                      {persona.nomina ? dinero(persona.nomina.netoCentavos) : "Pendiente"}
                      <span className="persona-celda-nota">{persona.nomina ? `Próximo · ${fechaLarga(persona.nomina.proximoPagoEn)}` : "Falta configurar"}</span>
                    </td>
                    <td className="numero" data-label="Presupuesto">{dinero(persona.presupuestoCentavos)}<span className="persona-celda-nota">Mensual</span></td>
                    <td data-label="Acceso / tarjeta">{accesoVisible(persona)}</td>
                    <td data-label="Estado"><Insignia tono={estado.tono}>{estado.texto}</Insignia></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 ? (
        <nav className="personas-paginacion" aria-label="Páginas del directorio">
          {lectura.pagina > 1 ? <Link className="boton-texto" href={urlFiltros(empresaId, filtros, lectura.pagina - 1)}>Anterior</Link> : null}
          <span>Página {lectura.pagina}</span>
          {lectura.pagina < paginas ? <Link className="boton-texto" href={urlFiltros(empresaId, filtros, lectura.pagina + 1)}>Siguiente</Link> : null}
        </nav>
      ) : null}
      <p className="nota-regla">Los importes son planeación administrativa. Preparar una nómina no dispersa dinero.</p>
    </>
  );
}

function urlFiltros(empresaId: string, filtros: FiltrosPersonas, pagina: number): string {
  const query = new URLSearchParams();
  if (filtros.buscar) query.set("q", filtros.buscar);
  if (filtros.centroId) query.set("area", filtros.centroId);
  if (filtros.estado !== "todos") query.set("estado", filtros.estado);
  if (pagina > 1) query.set("pagina", String(pagina));
  const texto = query.toString();
  return enEmpresa(empresaId, `/consola/personas${texto ? `?${texto}` : ""}`);
}
