import Link from "next/link";

import { IconoChevron, IconoDescargar } from "@/components/cromo/iconos";
import { BarraAvance } from "@/components/sistema";
import type { GastosDemo, RepartoDemo } from "@/dominio/demo/gastos";
import { enEmpresa } from "@/nucleo/rutas";

import { Accion, ID_AVISO_DEMO, pesosRedondos, Tarjeta } from "../piezas";

const ANCHO = 1040;
const ALTO = 170;

/** Gasto por día de octubre: hoy en coral, los días que faltan en filete. */
function GraficaPorDia({ dias, hoy }: { dias: readonly (number | null)[]; hoy: number }) {
  const tope = Math.max(...dias.map((dia) => dia ?? 0), 1);
  const paso = ANCHO / dias.length;
  const ancho = paso * 0.64;
  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO + 22}`} role="img" aria-label={`Gasto por día de octubre, hasta el día ${hoy}`}>
      {dias.map((dia, i) => {
        const x = i * paso + (paso - ancho) / 2;
        if (dia === null) return <rect key={i} className="demo-barra-futura" x={x} y={ALTO - 2} width={ancho} height={2} rx={1} />;
        const alto = Math.max(2, (dia / tope) * (ALTO - 6));
        return (
          <rect
            key={i}
            className={i + 1 === hoy ? "demo-barra-hoy" : "demo-barra"}
            x={x}
            y={ALTO - alto}
            width={ancho}
            height={alto}
            rx={2}
          />
        );
      })}
      {[1, 8, 15, 22, 29].map((dia) => (
        <text key={dia} x={(dia - 1) * paso + paso / 2} y={ALTO + 17} textAnchor="middle">
          {dia}
        </text>
      ))}
    </svg>
  );
}

function Reparto({ id, titulo, nota, filas }: { id: string; titulo: string; nota: string; filas: readonly RepartoDemo[] }) {
  const mayor = Math.max(...filas.map((fila) => fila.centavos), 1);
  return (
    <Tarjeta id={id} titulo={titulo} nota={nota}>
      <ul className="demo-reparto">
        {filas.map((fila) => (
          <li key={fila.nombre}>
            <span>{fila.nombre}</span>
            <BarraAvance valor={fila.centavos} tope={mayor} etiqueta={`${fila.nombre}: ${fila.porcentaje}% del gasto`} />
            <b>{pesosRedondos(fila.centavos)}</b>
            <span>{fila.porcentaje}%</span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

/** plat-03: lo gastado en el mes, por día, por área, persona, categoría y comercio. */
export function VistaGastos({ datos, empresaId }: { datos: GastosDemo; empresaId: string | null }) {
  return (
    <>
      <div className="demo-barra-herramientas">
        <Link className="boton-fantasma boton-chico" href={enEmpresa(empresaId, "/consola")}>
          <span className="demo-voltear" aria-hidden="true">
            <IconoChevron />
          </span>
          Resumen
        </Link>
        <span className="demo-empuje" />
        <label className="solo-lector" htmlFor="gastos-mes">
          Mes
        </label>
        <select id="gastos-mes" className="demo-selector" disabled aria-describedby={ID_AVISO_DEMO} defaultValue="2026-10">
          <option value="2026-10">Octubre 2026</option>
        </select>
        <Accion accion={{ etiqueta: "Excel", tipo: "secundaria" }} icono={<IconoDescargar />} />
      </div>
      <section className="demo-hero" aria-labelledby="gastos-total">
        <div>
          <p className="eyebrow" id="gastos-total">
            Gastado en octubre
          </p>
          <p className="demo-hero-cifra">{pesosRedondos(datos.gastadoCentavos)}</p>
          <p className="demo-hero-pie">
            <span className="demo-sube">{datos.comparacion}</span>
            <span>{datos.mesAnterior}</span>
          </p>
        </div>
        <dl className="demo-cifras" aria-label="Octubre en cifras">
          {datos.cifras.map((cifra) => (
            <div className="demo-cifra" key={cifra.rotulo}>
              <dt className="eyebrow">{cifra.rotulo}</dt>
              <dd className="demo-cifra-valor">{cifra.valor}</dd>
              <dd>
                <small>{cifra.nota}</small>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <Tarjeta id="gastos-por-dia" titulo="Gasto por día" nota="Octubre · hoy en coral" className="demo-grafica">
        <GraficaPorDia dias={datos.porDia} hoy={datos.hoy} />
      </Tarjeta>
      <div className="demo-rejilla demo-g2">
        <Reparto id="gastos-area" titulo="Por área" nota={`${datos.porArea.length} áreas`} filas={datos.porArea} />
        <Reparto id="gastos-persona" titulo="Por persona" nota={`${datos.porPersona.length} personas`} filas={datos.porPersona} />
        <Reparto id="gastos-categoria" titulo="Por categoría" nota="10 categorías" filas={datos.porCategoria} />
        <Reparto id="gastos-comercio" titulo="Por comercio" nota="19 comercios" filas={datos.porComercio} />
      </div>
      <Tarjeta
        id="gastos-cierre"
        titulo="Cierre de octubre"
        nota="80% de los gastos ya están aprobados"
      >
        <BarraAvance valor={80} tope={100} etiqueta="Gastos aprobados de octubre" />
        <ul className="demo-revision">
          <li>
            <span className="demo-revision-punto" data-tono="aviso" aria-hidden="true" />
            <div>
              <b>1 comprobante espera tu revisión</b>
              <small>
                Revísalo en <Link href={enEmpresa(empresaId, "/consola/movimientos")}>Movimientos</Link>.
              </small>
            </div>
          </li>
          <li>
            <span className="demo-revision-punto" aria-hidden="true" />
            <div>
              <b>Todos los gastos tienen comprobante</b>
              <small>Sin IVA en riesgo.</small>
            </div>
          </li>
          <li>
            <span className="demo-revision-punto" aria-hidden="true" />
            <div>
              <b>Sin IVA perdido</b>
              <small>Gastos justificados sin factura: sirven para control interno; se pierde el IVA y también la deducción.</small>
            </div>
          </li>
        </ul>
        <div className="demo-acciones">
          <Accion accion={{ etiqueta: "Póliza contable de octubre", tipo: "secundaria" }} chico={false} />
          <Accion accion={{ etiqueta: "Cerrar octubre", tipo: "principal" }} chico={false} />
        </div>
      </Tarjeta>
    </>
  );
}
