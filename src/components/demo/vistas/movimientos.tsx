import Link from "next/link";
import { Fragment } from "react";

import { IconoDescargar } from "@/components/cromo/iconos";
import type { CompraDemo, MovimientosDemo } from "@/dominio/demo/movimientos";
import { enEmpresa } from "@/nucleo/rutas";

import { FiltrosAlCambiar } from "../filtros-al-cambiar";
import { Accion, Cifras, iniciales, pesos, pesosRedondos, Tarjeta } from "../piezas";

const HOY = 22;
/** Las compras de ejemplo son de un solo mes: el selector «Mes» del diseño lo nombra. */
const MES = "Octubre 2026";
const PERIODOS = [
  ["hoy", "Hoy"],
  ["7", "7 días"],
  ["mes", "Todo el mes"],
] as const;
const AGRUPAR = [
  ["", "Sin agrupar"],
  ["persona", "Persona"],
  ["area", "Área"],
  ["categoria", "Categoría"],
  ["comercio", "Comercio"],
] as const;

type Agrupar = "" | "persona" | "area" | "categoria" | "comercio";

export type FiltrosMovimientos = {
  periodo: "hoy" | "7" | "mes";
  persona: string;
  area: string;
  tarjeta: string;
  categoria: string;
  comprobante: string;
  desde: number;
  agrupar: Agrupar;
};

function unicos(compras: readonly CompraDemo[], campo: keyof CompraDemo): string[] {
  return [...new Set(compras.map((compra) => String(compra[campo])))].sort((a, b) => a.localeCompare(b, "es"));
}

/** Lee los filtros de la dirección. Solo acepta valores que existen en la lista; lo demás se ignora. */
export function leerFiltros(compras: readonly CompraDemo[], params: Record<string, string | undefined>): FiltrosMovimientos {
  const elegir = (valor: string | undefined, opciones: readonly string[]) => (valor && opciones.includes(valor) ? valor : "");
  const desde = Number.parseFloat(params.desde ?? "");
  return {
    periodo: params.periodo === "hoy" || params.periodo === "7" ? params.periodo : "mes",
    persona: elegir(params.persona, unicos(compras, "persona")),
    area: elegir(params.area, unicos(compras, "area")),
    tarjeta: elegir(params.tarjeta, unicos(compras, "tarjeta")),
    categoria: elegir(params.categoria, unicos(compras, "categoria")),
    comprobante: elegir(params.comprobante, unicos(compras, "comprobante")),
    // En centavos: un número como 1e308 cabe en pesos, pero no en centavos.
    desde: Number.isFinite(desde * 100) && desde > 0 ? Math.round(desde * 100) : 0,
    agrupar: (AGRUPAR.map(([valor]) => valor) as readonly string[]).includes(params.agrupar ?? "") ? ((params.agrupar ?? "") as Agrupar) : "",
  };
}

export function filtrarCompras(compras: readonly CompraDemo[], filtros: FiltrosMovimientos): CompraDemo[] {
  const primerDia = filtros.periodo === "hoy" ? HOY : filtros.periodo === "7" ? HOY - 6 : 1;
  return compras.filter(
    (compra) =>
      compra.dia >= primerDia &&
      (!filtros.persona || compra.persona === filtros.persona) &&
      (!filtros.area || compra.area === filtros.area) &&
      (!filtros.tarjeta || compra.tarjeta === filtros.tarjeta) &&
      (!filtros.categoria || compra.categoria === filtros.categoria) &&
      (!filtros.comprobante || compra.comprobante === filtros.comprobante) &&
      compra.centavos >= filtros.desde,
  );
}

function Selector({ id, etiqueta, nombre, valor, opciones }: { id: string; etiqueta: string; nombre: string; valor: string; opciones: readonly string[] }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <select id={id} name={nombre} defaultValue={valor}>
        <option value="">Todos</option>
        {opciones.map((opcion) => (
          <option key={opcion} value={opcion}>
            {opcion}
          </option>
        ))}
      </select>
    </div>
  );
}

// Proyección equirectangular del recuadro de México (lon −118…−86, lat 33…14) a 200 × 120.
const x = (lon: number) => (lon + 118) * 6.25;
const y = (lat: number) => (33 - lat) * 6.3158;
const contorno = (puntos: readonly (readonly [number, number])[]) => puntos.map(([lon, lat]) => `${x(lon).toFixed(1)},${y(lat).toFixed(1)}`).join(" ");
const PENINSULA = [[-117, 32.5], [-115.8, 30.4], [-114.2, 28], [-112.2, 26], [-109.9, 23], [-109.4, 23.2], [-110.4, 24.2], [-111.6, 26.5], [-112.8, 28.5], [-114.6, 30.7], [-114.8, 32.5]] as const;
const CONTINENTE = [[-114.8, 32.5], [-111, 31.3], [-108.2, 31.3], [-106.5, 31.8], [-104.5, 29.6], [-103, 29], [-101.4, 29.8], [-99.5, 27.5], [-97.4, 25.9], [-97.7, 24], [-97.3, 21.5], [-96, 19.5], [-94.5, 18.2], [-92, 18.6], [-90.5, 19.9], [-90.4, 21.1], [-87, 21.5], [-87.5, 18.5], [-88.3, 17.8], [-90.9, 17.8], [-91.4, 16.1], [-92.2, 14.6], [-94.5, 16.2], [-96.5, 15.7], [-99.5, 16.7], [-102, 17.9], [-105.5, 20.4], [-105.3, 21.8], [-106.6, 23.3], [-108.9, 25.6], [-111, 27.9], [-112.8, 30], [-114.7, 31.5]] as const;
const CIUDADES = [
  ["Monterrey", -100.3, 25.67],
  ["Guadalajara", -103.35, 20.67],
  ["Querétaro", -100.39, 20.59],
  ["Ciudad de México", -99.13, 19.43],
] as const;

function Mapa({ datos }: { datos: MovimientosDemo }) {
  return (
    <svg viewBox="0 0 200 120" role="img" aria-label="Mapa esquemático de México con los lugares donde se usaron las tarjetas">
      <polygon className="demo-tierra" points={contorno(PENINSULA)} strokeWidth={0.4} />
      <polygon className="demo-tierra" points={contorno(CONTINENTE)} strokeWidth={0.4} />
      <text x={62} y={64} textAnchor="middle">
        MÉXICO
      </text>
      {CIUDADES.map(([nombre, lon, lat]) => (
        <text key={nombre} x={x(lon) + (nombre === "Ciudad de México" ? 5 : -4)} y={y(lat) + (nombre === "Querétaro" ? -4 : 4)} textAnchor={nombre === "Ciudad de México" ? "start" : "end"} className="demo-ciudad">
          {nombre}
        </text>
      ))}
      {datos.otrosPuntos.map((punto) => (
        <circle key={punto.nombre} className="demo-punto" cx={x(punto.lon)} cy={y(punto.lat)} r={2} strokeWidth={0.5} />
      ))}
      {datos.lugares.map((lugar) => (
        <circle key={lugar.comercio} className="demo-punto" cx={x(lugar.lon)} cy={y(lugar.lat)} r={1.6 + lugar.compras * 0.35} strokeWidth={0.5} />
      ))}
    </svg>
  );
}

function grupoDe(compra: CompraDemo, agrupar: Agrupar): string {
  if (agrupar === "persona") return compra.persona;
  if (agrupar === "area") return compra.area;
  if (agrupar === "categoria") return compra.categoria;
  if (agrupar === "comercio") return compra.comercio;
  return "";
}

/** plat-05: cada compra con su comprobante, filtros que sí filtran y el mapa de dónde se usó. */
export function VistaMovimientos({
  datos,
  empresaId,
  params,
}: {
  datos: MovimientosDemo;
  empresaId: string | null;
  params: Record<string, string | undefined>;
}) {
  const base = enEmpresa(empresaId, "/consola/movimientos");
  const filtros = leerFiltros(datos.compras, params);
  const compras = filtrarCompras(datos.compras, filtros);
  const total = compras.reduce((suma, compra) => suma + compra.centavos, 0);
  const cifras = datos.cifras.map((cifra, i) =>
    i === 0 ? { ...cifra, valor: pesosRedondos(total), nota: `${compras.length} ${compras.length === 1 ? "compra" : "compras"} con los filtros` } : cifra,
  );
  const conFiltros =
    filtros.periodo !== "mes" ||
    Boolean(filtros.persona || filtros.area || filtros.tarjeta || filtros.categoria || filtros.comprobante || filtros.desde);
  const grupos = new Map<string, CompraDemo[]>();
  for (const compra of compras) {
    const llave = grupoDe(compra, filtros.agrupar);
    grupos.set(llave, [...(grupos.get(llave) ?? []), compra]);
  }
  const valores = {
    persona: filtros.persona,
    area: filtros.area,
    tarjeta: filtros.tarjeta,
    categoria: filtros.categoria,
    comprobante: filtros.comprobante,
    desde: filtros.desde ? String(filtros.desde / 100) : "",
    agrupar: filtros.agrupar,
  };
  return (
    <>
      <Cifras cifras={cifras} etiqueta="Movimientos en cifras" />
      <section className="hoja demo-hoja-filtros" aria-label="Filtros de movimientos">
        <FiltrosAlCambiar
          action={base}
          periodo={filtros.periodo}
          valores={valores}
          enviados={Object.fromEntries(Object.keys(valores).map((nombre) => [nombre, params[nombre] ?? ""]))}
        >
          <div className="campo">
            <label htmlFor="movimientos-mes">Mes</label>
            <select id="movimientos-mes">
              <option>{MES}</option>
            </select>
          </div>
          {/* Botones del formulario, no enlaces: un toque justo después de escribir el monto lleva los dos. */}
          <div className="segmentado" role="group" aria-label="Periodo">
            {PERIODOS.map(([valor, texto]) => (
              <button key={valor} type="submit" name="periodo" value={valor} aria-pressed={filtros.periodo === valor}>
                {texto}
              </button>
            ))}
          </div>
          <Selector id="movimientos-persona" etiqueta="Persona" nombre="persona" valor={filtros.persona} opciones={unicos(datos.compras, "persona")} />
          <Selector id="movimientos-area" etiqueta="Área" nombre="area" valor={filtros.area} opciones={unicos(datos.compras, "area")} />
          <Selector id="movimientos-tarjeta" etiqueta="Tarjeta" nombre="tarjeta" valor={filtros.tarjeta} opciones={unicos(datos.compras, "tarjeta")} />
          <Selector id="movimientos-categoria" etiqueta="Categoría" nombre="categoria" valor={filtros.categoria} opciones={unicos(datos.compras, "categoria")} />
          <Selector id="movimientos-comprobante" etiqueta="Comprobante" nombre="comprobante" valor={filtros.comprobante} opciones={unicos(datos.compras, "comprobante")} />
          <div className="campo">
            <label htmlFor="movimientos-desde">Monto desde</label>
            <input id="movimientos-desde" name="desde" type="number" min="0" step="any" inputMode="decimal" placeholder="$0" defaultValue={filtros.desde ? filtros.desde / 100 : undefined} />
          </div>
          <div className="campo">
            <label htmlFor="movimientos-agrupar">Agrupar por</label>
            <select id="movimientos-agrupar" name="agrupar" defaultValue={filtros.agrupar}>
              {AGRUPAR.map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
          </div>
          <span className="demo-filtros-espacio" aria-hidden="true" />
          <noscript>
            <button type="submit" name="periodo" value={filtros.periodo} className="boton-texto boton-chico">
              Filtrar
            </button>
          </noscript>
          {conFiltros ? (
            <Link className="boton-fantasma boton-chico" href={base}>
              Limpiar filtros
            </Link>
          ) : null}
          <Accion accion={{ etiqueta: "Excel", tipo: "secundaria" }} icono={<IconoDescargar />} />
          <Accion accion={{ etiqueta: "Póliza contable", tipo: "secundaria" }} icono={<IconoDescargar />} />
        </FiltrosAlCambiar>
      </section>
      <Tarjeta id="movimientos-mapa" titulo="Dónde se usó" nota={datos.lugaresResumen}>
        <div className="demo-mapa">
          <Mapa datos={datos} />
          <ul className="demo-lista">
            {datos.lugares.map((lugar) => (
              <li className="demo-li" key={lugar.comercio}>
                <div className="demo-li-texto">
                  <b>{lugar.comercio}</b>
                  <small>{lugar.direccion}</small>
                </div>
                <span className="demo-li-cifra">
                  {pesos(lugar.centavos)}
                  <small>
                    {lugar.compras} {lugar.compras === 1 ? "compra" : "compras"}
                  </small>
                </span>
              </li>
            ))}
            <li className="demo-li">
              <b className="demo-li-texto">y {datos.masLugares} lugares más</b>
            </li>
          </ul>
        </div>
      </Tarjeta>
      <section className="hoja" aria-labelledby="movimientos-lista">
        <div className="demo-hd">
          <h2 id="movimientos-lista">Compras de octubre</h2>
          <small>
            {compras.length} {compras.length === 1 ? "compra" : "compras"} · {pesos(total)}
          </small>
        </div>
        {compras.length === 0 ? (
          <p className="demo-tenue">Ninguna compra coincide con los filtros.</p>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Persona</th>
                  <th scope="col">Comercio</th>
                  <th scope="col">Tarjeta</th>
                  <th scope="col" className="derecha">
                    Monto
                  </th>
                  <th scope="col">Comprobante</th>
                </tr>
              </thead>
              <tbody>
                {[...grupos.entries()].map(([grupo, filas]) => (
                  <Fragment key={grupo || "todas"}>
                    {grupo ? (
                      <tr className="demo-fila-grupo">
                        <th scope="rowgroup" colSpan={4}>
                          {grupo}
                        </th>
                        <td className="derecha">{pesos(-filas.reduce((suma, compra) => suma + compra.centavos, 0))}</td>
                        <td>
                          {filas.length} {filas.length === 1 ? "compra" : "compras"}
                        </td>
                      </tr>
                    ) : null}
                    {filas.map((compra) => (
                      <tr key={`${compra.dia}-${compra.hora}-${compra.comercio}`}>
                        <td className="demo-num">
                          {compra.fecha}
                          <small>{compra.hora}</small>
                        </td>
                        <td>
                          <span className="demo-persona">
                            <span className="demo-iniciales" aria-hidden="true">
                              {iniciales(compra.persona)}
                            </span>
                            <span>
                              <b>{compra.persona}</b>
                              <small>{compra.area}</small>
                            </span>
                          </span>
                        </td>
                        <td>
                          {compra.comercio}
                          <small>
                            {compra.categoria} · {compra.lugar}
                          </small>
                        </td>
                        <td className="demo-num">{compra.tarjeta}</td>
                        <td className="derecha">{pesos(-compra.centavos)}</td>
                        <td>
                          <span className={compra.porRevisar ? "insignia demo-insignia-ambar" : "insignia insignia-sello"}>
                            {compra.porRevisar ? "Por revisar" : "Comprobado"}
                          </span>
                          <small>{compra.comprobante}</small>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
