import { formatoPesos } from "@/dominio/centavos";
import type { CategoriaResumen, MesResumen } from "@/dominio/resumen";

export function GraficaMensual({ meses }: { meses: MesResumen[] }) {
  const maximo = Math.max(0, ...meses.flatMap((mes) => [mes.ingresosCentavos, mes.gastosCentavos]));
  if (maximo === 0) {
    return <div className="grafica-vacia"><p>No hay movimientos en este periodo.</p><p>Elige otro rango para consultar meses anteriores.</p></div>;
  }
  const izquierda = 58;
  const base = 204;
  const alto = 154;
  const paso = 650 / meses.length;
  const barra = Math.min(14, (paso * 0.58) / 2);
  return (
    <div className="grafica-mensual">
      <svg viewBox="0 0 720 248" role="img" aria-labelledby="grafica-mensual-titulo grafica-mensual-descripcion">
        <title id="grafica-mensual-titulo">Ingresos y gastos por mes</title>
        <desc id="grafica-mensual-descripcion">Barras azules para ingresos y barras naranjas para gastos. La tabla accesible incluye todas las cifras.</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((proporcion) => {
          const y = base - alto * proporcion;
          return (
            <g key={proporcion}>
              <line className="grafica-linea" x1={izquierda} x2="708" y1={y} y2={y} />
              <text className="grafica-eje-valor" x="48" y={y + 3} textAnchor="end">{compacto(maximo * proporcion)}</text>
            </g>
          );
        })}
        {meses.map((mes, indice) => {
          const centro = izquierda + paso * indice + paso / 2;
          const ingresosAlto = (mes.ingresosCentavos / maximo) * alto;
          const gastosAlto = (mes.gastosCentavos / maximo) * alto;
          return (
            <g key={mes.clave}>
              <rect className="grafica-ingreso" x={centro - barra - 2} y={base - ingresosAlto} width={barra} height={ingresosAlto} rx="3">
                <title>{`${mes.etiqueta}: ingresos ${formatoPesos(mes.ingresosCentavos)}`}</title>
              </rect>
              <rect className="grafica-gasto" x={centro + 2} y={base - gastosAlto} width={barra} height={gastosAlto} rx="3">
                <title>{`${mes.etiqueta}: gastos ${formatoPesos(mes.gastosCentavos)}`}</title>
              </rect>
              <text className="grafica-eje-mes" x={centro} y="229" textAnchor="middle">{mes.etiqueta}</text>
            </g>
          );
        })}
      </svg>
      <table className="solo-lector">
        <caption>Ingresos y gastos por mes</caption>
        <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th></tr></thead>
        <tbody>{meses.map((mes) => <tr key={mes.clave}><th>{mes.etiqueta}</th><td>{formatoPesos(mes.ingresosCentavos)}</td><td>{formatoPesos(mes.gastosCentavos)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export function GraficaCategorias({ categorias }: { categorias: CategoriaResumen[] }) {
  if (categorias.length === 0) {
    return <div className="grafica-vacia"><p>No hay gastos registrados este mes.</p><p>Las categorías aparecerán cuando exista un cargo en el libro.</p></div>;
  }
  const total = categorias.reduce((suma, categoria) => suma + categoria.gastosCentavos, 0);
  const maximo = Math.max(...categorias.map((categoria) => categoria.gastosCentavos));
  return (
    <ul className="grafica-categorias">
      {categorias.map((categoria) => (
        <li key={categoria.codigo}>
          <div className="grafica-categoria-cabeza">
            <span>{categoria.nombre}</span>
            <strong>{formatoPesos(categoria.gastosCentavos)}</strong>
          </div>
          <div className="grafica-categoria-pista" aria-hidden="true">
            <span style={{ width: `${(categoria.gastosCentavos / maximo) * 100}%` }} />
          </div>
          <p>{new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format((categoria.gastosCentavos / total) * 100)}% de los gastos del mes</p>
        </li>
      ))}
    </ul>
  );
}

function compacto(centavos: number): string {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(centavos / 100);
}
