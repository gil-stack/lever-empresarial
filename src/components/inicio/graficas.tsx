import { formatoPesos } from "@/dominio/centavos";
import type { CategoriaResumen, MesResumen } from "@/dominio/resumen";

const MARCAS = [0, 0.25, 0.5, 0.75, 1] as const;

export function GraficaMensual({ meses }: { meses: MesResumen[] }) {
  const maximo = Math.max(0, ...meses.flatMap((mes) => [mes.entradasCentavos, mes.salidasCentavos]));
  if (maximo === 0) {
    return <div className="grafica-vacia"><p>No hay movimientos en este periodo.</p><p>Elige otro rango para consultar meses anteriores.</p></div>;
  }
  return (
    <div className="grafica-mensual">
      <div className="grafica-mensual-amplia">
        <Barras meses={meses} maximo={maximo} />
      </div>
      {/* En pantallas angostas: los últimos tres meses, con el mismo eje y la misma escala del periodo. */}
      <div className="grafica-mensual-compacta">
        <p className="grafica-mensual-nota">Últimos 3 meses · misma escala del periodo</p>
        <Barras meses={meses.slice(-3)} maximo={maximo} />
      </div>
      <table className="solo-lector">
        <caption>Entradas y salidas por mes</caption>
        <thead><tr><th>Mes</th><th>Entradas</th><th>Salidas</th></tr></thead>
        <tbody>{meses.map((mes) => <tr key={mes.clave}><th>{mes.etiqueta}</th><td>{formatoPesos(mes.entradasCentavos)}</td><td>{formatoPesos(mes.salidasCentavos)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * Las barras viven en un SVG que se estira al ancho disponible; los ejes son
 * texto HTML, así que miden lo mismo (0.75rem) en cualquier pantalla. Las
 * cifras completas están en la tabla para lector de pantalla.
 */
function Barras({ meses, maximo }: { meses: MesResumen[]; maximo: number }) {
  const ancho = meses.length * 100;
  const alto = 200;
  const barra = 28;
  return (
    <div className="grafica-lienzo" aria-hidden="true">
      <ol className="grafica-eje-y">
        {MARCAS.map((proporcion) => (
          <li key={proporcion} style={{ bottom: `${proporcion * 100}%` }}>{compacto(maximo * proporcion)}</li>
        ))}
      </ol>
      <svg className="grafica-barras" viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none" focusable="false">
        {MARCAS.map((proporcion) => (
          <line key={proporcion} className="grafica-linea" x1="0" x2={ancho} y1={alto - alto * proporcion} y2={alto - alto * proporcion} vectorEffect="non-scaling-stroke" />
        ))}
        {meses.map((mes, indice) => {
          const centro = indice * 100 + 50;
          const entradasAlto = (mes.entradasCentavos / maximo) * alto;
          const salidasAlto = (mes.salidasCentavos / maximo) * alto;
          return (
            <g key={mes.clave}>
              <rect className="grafica-ingreso" x={centro - barra - 3} y={alto - entradasAlto} width={barra} height={entradasAlto}>
                <title>{`${mes.etiqueta}: entradas ${formatoPesos(mes.entradasCentavos)}`}</title>
              </rect>
              <rect className="grafica-gasto" x={centro + 3} y={alto - salidasAlto} width={barra} height={salidasAlto}>
                <title>{`${mes.etiqueta}: salidas ${formatoPesos(mes.salidasCentavos)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <ol className="grafica-eje-x">
        {meses.map((mes) => <li key={mes.clave}>{mes.etiqueta}</li>)}
      </ol>
    </div>
  );
}

export function GraficaCategorias({ categorias }: { categorias: CategoriaResumen[] }) {
  if (categorias.length === 0) {
    return <div className="grafica-vacia"><p>No hay salidas registradas este mes.</p><p>Las categorías aparecerán cuando exista un cargo en el libro.</p></div>;
  }
  const total = categorias.reduce((suma, categoria) => suma + categoria.salidasCentavos, 0);
  const maximo = Math.max(...categorias.map((categoria) => categoria.salidasCentavos));
  return (
    <ul className="grafica-categorias">
      {categorias.map((categoria) => (
        <li key={categoria.codigo}>
          <div className="grafica-categoria-cabeza">
            <span>{categoria.nombre}</span>
            <strong>{formatoPesos(categoria.salidasCentavos)}</strong>
          </div>
          <div className="grafica-categoria-pista" aria-hidden="true">
            <span style={{ width: `${(categoria.salidasCentavos / maximo) * 100}%` }} />
          </div>
          <p>{new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format((categoria.salidasCentavos / total) * 100)}% de las salidas del mes</p>
        </li>
      ))}
    </ul>
  );
}

function compacto(centavos: number): string {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(centavos / 100);
}
