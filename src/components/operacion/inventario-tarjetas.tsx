import Form from "next/form";
import Link from "next/link";

import { NotaRegla, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { ESTADOS, ESTADO_DE_CLASE, NOMBRE_DEL_ESTADO, SIN_EMPRESA, enlaceTarjetas, haceCuanto, textoDeBusqueda } from "@/dominio/tarjetas/inventario";
import { POR_PAGINA, type VistaTarjetas } from "@/server/efevoo/inventario";

import { SelectorQueEnvia } from "./enviar-al-cambiar";

/**
 * Operación → Tarjetas: arriba cuatro cifras de todo el inventario; abajo la lista, que se busca, se filtra por estado
 * y por empresa y se pagina en el servidor. Cada renglón abre el detalle en una ventana sobre la lista (`?tarjeta=`).
 */

const ERRORES: Record<string, string> = {
  efevoo_incierto: "El procesador de tarjetas no respondió.",
  efevoo_no_autorizado: "El procesador de tarjetas rechazó la conexión.",
  efevoo_rechazo: "El procesador de tarjetas rechazó la consulta.",
};

const numero = (n: number) => n.toLocaleString("es-MX");

function Frescura({ vista, ahora }: { vista: VistaTarjetas; ahora: Date }) {
  const l = vista.lectura;
  const pruebas = vista.ambiente === "sandbox" ? " · ambiente de pruebas" : "";
  if (!l?.completaEn) {
    if (l?.paginaSiguiente && l.paginas) return <p className="pista tarjetas-frescura" role="status">Leyendo el inventario del procesador de tarjetas: van {numero(Math.min(l.paginaSiguiente - 1, l.paginas))} de {numero(l.paginas)} páginas. La lista se completa sola en unos minutos.{pruebas}</p>;
    return null;
  }
  return (
    <p className="pista tarjetas-frescura">
      Datos del procesador de tarjetas, actualizados {haceCuanto(new Date(l.completaEn), ahora)}
      {l.paginaSiguiente ? " (actualizando ahora)" : ""}
      {pruebas}
    </p>
  );
}

function Resumen({ vista }: { vista: VistaTarjetas }) {
  const r = vista.resumen;
  const cifra = (rotulo: string, valor: string, pista: string, enlace: string) => (
    <li className="tarjetas-cifra">
      <Link href={enlace}>
        <span className="rotulo">{rotulo}</span>
        <span className="tarjetas-cifra-valor">{valor}</span>
        <span className="pista">{pista}</span>
      </Link>
    </li>
  );
  return (
    <ul className="tarjetas-resumen" aria-label="Resumen del inventario">
      {cifra("Activas", numero(r.activas), `${numero(r.conSaldo)} con saldo`, enlaceTarjetas({ estado: "con_saldo" }))}
      {cifra("Por activar", numero(r.porActivar), "Ya tienen empresa", enlaceTarjetas({ estado: "por_activar" }))}
      {cifra("Disponibles", numero(r.disponibles), "Sin empresa todavía", enlaceTarjetas({ estado: "disponibles" }))}
      {cifra("Saldo en tarjetas", formatoPesos(r.saldoCentavos), `En ${numero(r.total - r.canceladas)} tarjetas`, enlaceTarjetas({}))}
    </ul>
  );
}

function Paginacion({ vista }: { vista: VistaTarjetas }) {
  const { pagina } = vista.filtro;
  const paginas = Math.max(1, Math.ceil(vista.total / POR_PAGINA));
  if (paginas <= 1) return null;
  const a = (p: number) => enlaceTarjetas({ ...vista.filtro, pagina: p });
  return (
    <nav className="tarjetas-paginas" aria-label="Páginas de la lista">
      {pagina > 1 ? <Link className="boton-texto boton-chico" href={a(pagina - 1)} scroll={false}>← Anterior</Link> : <span />}
      <span className="pista">Página {numero(pagina)} de {numero(paginas)}</span>
      {pagina < paginas ? <Link className="boton-texto boton-chico" href={a(pagina + 1)} scroll={false}>Siguiente →</Link> : <span />}
    </nav>
  );
}

export function TableroTarjetas({ vista, ahora }: { vista: VistaTarjetas; ahora: Date }) {
  if (vista.conexion === "sin_conexion") {
    return (
      <Vacio titulo="Sin conexión con el procesador de tarjetas">
        Este entorno no tiene configurada la conexión con el procesador, así que no hay inventario que mostrar.
      </Vacio>
    );
  }
  const { filtro } = vista;
  const q = textoDeBusqueda(filtro.q);
  const hayFiltros = q !== "" || filtro.empresa !== null || filtro.estado !== "todas";
  const desde = vista.total === 0 ? 0 : (filtro.pagina - 1) * POR_PAGINA + 1;
  const hasta = Math.min(vista.total, filtro.pagina * POR_PAGINA);
  const empresaEnLista = filtro.empresa === null || filtro.empresa === SIN_EMPRESA || vista.empresas.some((e) => e.clave === filtro.empresa);
  const error = vista.lectura?.error ? (ERRORES[vista.lectura.error] ?? "El procesador de tarjetas no respondió.") : null;

  return (
    <div className="tarjetas">
      <Resumen vista={vista} />
      <Frescura vista={vista} ahora={ahora} />
      {error ? (
        <NotaRegla>
          {error} {vista.lectura?.completaEn ? "Se muestra la última lista que se leyó; se vuelve a intentar sola." : "Se vuelve a intentar sola en un minuto."}
        </NotaRegla>
      ) : null}

      <section className="tarjetas-lista" aria-labelledby="tarjetas-lista-titulo">
        <h2 id="tarjetas-lista-titulo" className="solo-lector">Lista de tarjetas</h2>
        <Form action="/operacion/tarjetas" className="tarjetas-buscador" role="search" aria-label="Buscar tarjetas" scroll={false}>
          <div className="campo tarjetas-buscar">
            <label htmlFor="tarjetas-q">Buscar</label>
            <input id="tarjetas-q" name="q" type="search" defaultValue={q} maxLength={60} autoComplete="off" placeholder="Últimos 4 dígitos, empresa o nombre en la tarjeta" />
          </div>
          <div className="campo tarjetas-empresa">
            <label htmlFor="tarjetas-empresa">Empresa</label>
            <SelectorQueEnvia id="tarjetas-empresa" name="empresa" defaultValue={filtro.empresa ?? ""}>
              <option value="">Todas las empresas</option>
              <option value={SIN_EMPRESA}>Sin empresa (disponibles)</option>
              {!empresaEnLista && vista.empresaElegida ? <option value={vista.empresaElegida.clave}>{vista.empresaElegida.nombre}</option> : null}
              {vista.empresas.map((e) => (
                <option key={e.clave} value={e.clave}>{e.nombre} · {numero(e.tarjetas)}</option>
              ))}
            </SelectorQueEnvia>
          </div>
          {filtro.estado !== "todas" ? <input type="hidden" name="estado" value={filtro.estado} /> : null}
          <button className="boton boton-chico" type="submit">Buscar</button>
        </Form>

        <nav className="tarjetas-estados" aria-label="Filtrar por estado">
          {ESTADOS.map((e) => (
            <Link
              key={e}
              href={enlaceTarjetas({ q, empresa: filtro.empresa, estado: e })}
              className="tarjetas-estado"
              aria-current={filtro.estado === e ? "page" : undefined}
              scroll={false}
            >
              {NOMBRE_DEL_ESTADO[e]} <span className="tarjetas-estado-cuantas">{numero(vista.porEstado[e])}</span>
            </Link>
          ))}
        </nav>

        <div className="tarjetas-conteo">
          <p role="status">
            {vista.total === 0 ? "Ninguna tarjeta" : `${numero(desde)}–${numero(hasta)} de ${numero(vista.total)} ${vista.total === 1 ? "tarjeta" : "tarjetas"}`}
            {vista.empresaElegida ? <> · {vista.empresaElegida.nombre}</> : null}
            {q ? <> · «{q}»</> : null}
          </p>
          {hayFiltros ? <Link className="enlace-texto" href="/operacion/tarjetas" scroll={false}>Limpiar filtros</Link> : null}
        </div>

        {vista.tarjetas.length === 0 ? (
          <Vacio titulo={vista.resumen.total === 0 ? "Todavía no hay tarjetas" : "No hay tarjetas con esta búsqueda"}>
            {vista.resumen.total === 0 ? "Cuando el procesador tenga plásticos, aparecen aquí." : "Prueba con otros dígitos u otra empresa, o limpia los filtros."}
          </Vacio>
        ) : (
          <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de tarjetas">
            <table className="tabla operacion-tabla tarjetas-tabla">
              <thead>
                <tr>
                  <th scope="col">Tarjeta</th>
                  <th scope="col">Empresa</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="tarjetas-num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {vista.tarjetas.map((t) => {
                  const estado = ESTADO_DE_CLASE[t.clase];
                  return (
                    <tr key={t.id}>
                      <td data-rotulo="Tarjeta">
                        <Link
                          className="tarjetas-abrir"
                          href={enlaceTarjetas({ ...filtro, tarjeta: t.id })}
                          scroll={false}
                          aria-label={`Ver la tarjeta terminada en ${t.terminacion}`}
                        >
                          <span className="operacion-mono">•••• {t.terminacion}</span>
                        </Link>
                        {t.nombreTarjeta ? <small>{t.nombreTarjeta}</small> : null}
                      </td>
                      <td data-rotulo="Empresa">{t.empresa ? t.empresa.nombre : <span className="pista">Sin empresa</span>}</td>
                      <td data-rotulo="Estado"><span className={`tarjetas-punto tarjetas-punto-${estado.tono}`}>{estado.texto}</span></td>
                      <td data-rotulo="Saldo" className="tarjetas-num">{t.saldoCentavos === null ? "—" : formatoPesos(t.saldoCentavos)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Paginacion vista={vista} />
      </section>
      <p className="pista tarjetas-nota">Nunca se muestra el número completo de una tarjeta ni su código de seguridad.</p>
    </div>
  );
}
