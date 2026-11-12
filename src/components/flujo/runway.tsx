import "@/estilo/runway.css";

import { Hoja, Insignia, NotaRegla, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { fechaConAnio, fechaCorta, nombreDelMes } from "@/dominio/flujo/fechas";
import {
  cifraDeResumen,
  formatoMeses,
  MESES_RUNWAY,
  mesesDeSemanas,
  textoRunway,
  type AlcanceRunway,
  type Foto,
  type TipoResumen,
} from "@/dominio/flujo/runway";
import { horaEnMexico } from "@/dominio/reloj";
import type { VistaRunway } from "@/server/flujo/runway";

import { FormularioMinimo } from "./formulario-runway";
import { Origen } from "./origen";

const ETIQUETA_RESUMEN: Record<TipoResumen, string> = {
  nomina: "Nómina",
  proveedor: "Pagos a proveedores",
  obligacion: "Obligaciones recurrentes",
  cobro: "Cobros esperados y cargos emitidos",
  cobrado: "Ya cobrado después del saldo",
  plan_fijo: "Planes fijos: periodos por generar",
  plan_variable: "Planes variables: promedio de sus últimos 3 cargos",
};

const ESTADO: Record<VistaRunway["estado"], { texto: string; tono: "neutro" | "aviso" }> = {
  ok: { texto: "Sin alertas", tono: "neutro" },
  bajo_colchon: { texto: "Debajo del colchón", tono: "aviso" },
  runway_bajo: { texto: "Runway debajo del mínimo", tono: "aviso" },
  sin_saldo: { texto: "Sin saldo declarado", tono: "neutro" },
};

const ESTADO_CORREO: Record<string, string> = {
  enviando: "enviándose",
  enviado: "enviado",
  fallido: "falló; se reintenta en la siguiente revisión",
  simulado: "simulado: en demostración no sale correo",
  sin_destinatarios: "sin destinatarios (nadie tiene encendido el resumen)",
  descartado: "descartado: la situación se corrigió antes de poder avisar",
};

/** La cifra grande: los meses, sin la fecha (que va en su propio renglón). */
function cifraRunway(alcance: AlcanceRunway): string {
  if (alcance.tipo === "agota" && alcance.semanas > 0) return formatoMeses(alcance.meses);
  return textoRunway(alcance);
}

function textoMinimo(meses: number): string {
  return `${meses} ${meses === 1 ? "mes" : "meses"}`;
}

/**
 * Runway a 12 meses en Flujo de caja: las dos cifras, los 12 meses calendario,
 * lo que cuenta, la tendencia semanal y el mínimo que dispara el aviso.
 */
export function SeccionRunway({ vista }: { vista: VistaRunway | null }) {
  if (!vista) {
    return (
      <Hoja id="runway-titulo" titulo="Runway a 12 meses">
        <p className="lede">No se pudo calcular el runway. Vuelve a intentar.</p>
      </Hoja>
    );
  }
  const r = vista.runway;
  return (
    <>
      <Hoja id="runway-titulo" titulo="Runway a 12 meses" className="runway">
        <dl className="runway-cifras">
          <Cifra
            rotulo="Runway conservador"
            nota="Saldo declarado, salidas comprometidas y lo que ya registraste por cobrar. Sin entradas estimadas."
            nombre="conservador"
            alcance={r.conservador}
          />
          <Cifra
            rotulo="Runway esperado"
            nota="Además, la cobranza que tus planes todavía no generan, estimada."
            nombre="esperado"
            alcance={r.esperado}
          />
          <div>
            <dt>Alertas</dt>
            <dd data-estado-alertas={vista.estado}>
              <Insignia tono={ESTADO[vista.estado].tono}>{ESTADO[vista.estado].texto}</Insignia>
            </dd>
            <dd className="pista">
              {vista.ultimoAviso
                ? `Último aviso: ${horaEnMexico(new Date(vista.ultimoAviso.detectadoEn))} · ${[vista.ultimoAviso.colchon ? "colchón" : null, vista.ultimoAviso.runway ? "runway" : null].filter(Boolean).join(" y ")} · ${ESTADO_CORREO[vista.ultimoAviso.estado] ?? vista.ultimoAviso.estado}.`
                : "Todavía no hay avisos."}
            </dd>
          </div>
        </dl>
        {r.saldo ? null : (
          <Vacio titulo="Sin saldo declarado no hay runway.">
            Declara el saldo de tus cuentas de banco abajo. Mientras tanto, la tabla muestra lo comprometido de cada mes, sin saldo.
          </Vacio>
        )}
        <Meses vista={vista} />
        <Resumen vista={vista} />
      </Hoja>
      <Tendencia vista={vista} />
    </>
  );
}

/** El mínimo de meses que dispara el aviso; va en la columna lateral, junto al colchón. */
export function AvisoRunway({ vista }: { vista: VistaRunway }) {
  return (
    <Hoja id="minimo-titulo" titulo="Aviso de runway">
      {vista.puedeEditar ? (
        <FormularioMinimo meses={vista.mesesMinimos} />
      ) : (
        <p data-cifra="minimo">Avisa si el runway conservador baja de {textoMinimo(vista.mesesMinimos)}.</p>
      )}
      <p className="pista" data-minimo={vista.mesesMinimos}>
        Hoy: {textoMinimo(vista.mesesMinimos)}
        {vista.mesesElegidos ? "." : " (sugerido; nadie lo ha cambiado)."}
      </p>
      <p className="pista">
        El aviso sale por correo una sola vez cuando el saldo proyectado baja de tu colchón o el runway baja del mínimo. No se repite mientras
        siga igual; si se corrige y vuelve a pasar, avisa otra vez. Lo reciben quienes tienen encendido el resumen de los lunes.
      </p>
    </Hoja>
  );
}

function Cifra({ rotulo, nota, nombre, alcance }: { rotulo: string; nota: string; nombre: string; alcance: AlcanceRunway }) {
  return (
    <div>
      <dt>{rotulo}</dt>
      <dd data-cifra={`runway-${nombre}`} data-tipo={alcance.tipo} data-meses={alcance.tipo === "agota" ? alcance.meses : undefined}>
        {cifraRunway(alcance)}
      </dd>
      {alcance.tipo === "agota" && alcance.semanas > 0 ? (
        <dd className="runway-hasta" data-hasta={alcance.hasta}>Alcanza hasta el {fechaConAnio(alcance.hasta)}</dd>
      ) : null}
      <dd className="pista">{nota}</dd>
    </div>
  );
}

function Pesos({ valor, nombre, etiqueta }: { valor: number | null; nombre: string; etiqueta: string }) {
  return (
    <td className="cifra" data-cifra={nombre} data-etiqueta={etiqueta} data-centavos={valor ?? undefined}>
      {valor === null ? <span className="flujo-sin-cifra">Sin saldo</span> : formatoPesos(valor)}
    </td>
  );
}

function Meses({ vista }: { vista: VistaRunway }) {
  const r = vista.runway;
  return (
    <div className="runway-bloque">
      <h3 id="runway-meses-titulo">Mes por mes</h3>
      <p className="flujo-leyenda">
        <Origen de="declarado" /> saldo de partida · <Origen de="comprometido" /> entradas y salidas · <span className="insignia" data-origen="estimado">Estimado</span> cobranza de tus planes
      </p>
      {/* En anchos intermedios la tabla se desliza: la región se alcanza con el teclado (WCAG 2.1.1). */}
      <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla del runway mes por mes">
        {/* Roles explícitos: en móvil la tabla se apila con CSS y sin ellos el lector de pantalla deja de verla como tabla. */}
        <table className="tabla flujo-apilada runway-meses" data-tabla="runway-meses" role="table" aria-labelledby="runway-meses-titulo">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Mes</th>
              <th scope="col" role="columnheader" className="derecha">Entradas</th>
              <th scope="col" role="columnheader" className="derecha">Cobranza estimada</th>
              <th scope="col" role="columnheader" className="derecha">Salidas</th>
              <th scope="col" role="columnheader" className="derecha">Cierre conservador</th>
              <th scope="col" role="columnheader" className="derecha">Cierre esperado</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {r.meses.map((mes, i) => (
              <tr
                key={mes.mes}
                role="row"
                data-mes={mes.mes.slice(0, 7)}
                className={mes.cierre !== null && mes.cierre < 0 ? "runway-mes-negativo" : undefined}
              >
                <th scope="row" role="rowheader">
                  {nombreDelMes(mes.mes)}
                  {i === 0 ? <span className="pista"> desde hoy</span> : null}
                </th>
                <Pesos valor={mes.entradas} nombre="entradas" etiqueta="Entra" />
                <Pesos valor={mes.estimadas} nombre="estimadas" etiqueta="Estimado" />
                <td className="cifra" data-cifra="salidas" data-etiqueta="Sale" data-centavos={mes.salidas}>
                  {formatoPesos(mes.salidas)}
                  {mes.nominaReservada ? (
                    <span className="pista runway-reservado" data-nomina="reservada"> · incluye nómina reservada</span>
                  ) : null}
                </td>
                <Pesos valor={mes.cierre} nombre="cierre" etiqueta="Cierre conservador" />
                <Pesos valor={mes.cierreEsperado} nombre="cierre-esperado" etiqueta="Cierre esperado" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pista">
        Cada mes calendario, del {fechaCorta(r.hoy)} en adelante. El runway se cuenta por semanas, igual que la proyección de Inicio: el dinero se
        agota en la primera semana que cierra en negativo.
      </p>
    </div>
  );
}

function Resumen({ vista }: { vista: VistaRunway }) {
  const r = vista.runway;
  return (
    <div className="runway-bloque">
      <h3 id="runway-resumen-titulo">Qué cuenta en los 12 meses</h3>
      {r.resumen.length === 0 ? (
        <p className="pista">Todavía no hay nómina, pagos, obligaciones ni cobros registrados en los próximos 12 meses.</p>
      ) : (
        <ul className="runway-resumen" aria-labelledby="runway-resumen-titulo" data-lista="runway-resumen">
          {r.resumen.map((linea) => (
            <li key={linea.tipo} data-tipo={linea.tipo}>
              <span>
                {ETIQUETA_RESUMEN[linea.tipo]}
                {linea.estimado ? <span className="insignia" data-origen="estimado">Estimado</span> : null}
              </span>
              <span className="cifra" data-centavos={linea.reservado ? undefined : linea.centavos}>
                {cifraDeResumen(linea)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {r.planes.sinHistorial.length > 0 ? (
        <NotaRegla>
          No se cuentan, porque todavía no tienen un cargo con monto:{" "}
          <span data-lista="sin-historial">{r.planes.sinHistorial.map((p) => `${p.cliente} · ${p.concepto}`).join("; ")}</span>.
        </NotaRegla>
      ) : null}
      <p className="pista">Los cobros vencidos no cuentan como entrada: siguen en Cobranza hasta que llegan.</p>
    </div>
  );
}

/** Barras del runway conservador por semana (tope de 12 meses), con la línea del mínimo. La tabla dice lo mismo. */
function Tendencia({ vista }: { vista: VistaRunway }) {
  const fotos = vista.fotos;
  const minimo = vista.mesesMinimos;
  if (fotos.length < 2) {
    return (
      <Hoja id="tendencia-titulo" titulo="Tendencia semanal" className="flujo-bloque">
        <Vacio titulo="La tendencia aparece desde la segunda foto semanal.">
          {fotos.length === 1
            ? `La primera foto es de la semana del ${fechaCorta(fotos[0]!.semana)}; la siguiente se toma el lunes.`
            : "Cada lunes se guarda el runway de la semana. La primera se toma la próxima revisión."}
        </Vacio>
      </Hoja>
    );
  }
  const meses = (foto: Foto) => mesesDeSemanas(foto.semanasConservador, foto.horizonte);
  // El mismo texto en la gráfica, su descripción y la tabla: a partir del horizonte, «12 meses o más» (r64b-N2).
  const textoSemanas = (semanas: number, horizonte: number) => (semanas >= horizonte ? "12 meses o más" : formatoMeses(mesesDeSemanas(semanas, horizonte)));
  const textoFoto = (foto: Foto) => textoSemanas(foto.semanasConservador, foto.horizonte);
  const ultima = fotos.at(-1)!;
  const resumen = `Runway conservador de las últimas ${fotos.length} semanas: de ${textoFoto(fotos[0]!)} la semana del ${fechaCorta(fotos[0]!.semana)} a ${textoFoto(ultima)} la semana del ${fechaCorta(ultima.semana)}. Mínimo: ${textoMinimo(minimo)}.`;
  return (
    <Hoja id="tendencia-titulo" titulo="Tendencia semanal" className="flujo-bloque">
      {vista.fotosDeEjemplo ? (
        <p data-ejemplo="tendencia">
          <Insignia tono="aviso">Ejemplo · demostración</Insignia> Esta empresa de demostración todavía no tiene fotos suficientes; la gráfica usa cifras de ejemplo.
        </p>
      ) : null}
      <figure className="runway-tendencia" data-tendencia={vista.fotosDeEjemplo ? "ejemplo" : "real"}>
        <figcaption className="pista">Runway conservador al lunes de cada semana, en meses (12 o más se dibuja en 12). La línea marca tu mínimo.</figcaption>
        <div className="runway-grafica" role="img" aria-label={resumen}>
          <div className="runway-rejilla" aria-hidden="true">
            {[12, 6, 0].map((m) => (
              <span key={m} style={{ bottom: `${(m / MESES_RUNWAY) * 100}%` }}><em>{m}</em></span>
            ))}
          </div>
          <div className="runway-minimo" aria-hidden="true" style={{ bottom: `${(Math.min(minimo, MESES_RUNWAY) / MESES_RUNWAY) * 100}%` }} />
          <ol className="runway-barras" aria-hidden="true">
            {fotos.map((foto, i) => {
              const valor = meses(foto);
              const ultimaBarra = i === fotos.length - 1;
              return (
                <li key={foto.semana} title={`Semana del ${fechaCorta(foto.semana)}: ${textoFoto(foto)}`} data-semana={foto.semana} data-meses={valor}>
                  <span className="runway-barra" style={{ height: `${Math.max((valor / MESES_RUNWAY) * 100, 1)}%` }}>
                    {ultimaBarra ? <span className="runway-valor">{valor.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="runway-ejes" aria-hidden="true">
            <span>{fechaCorta(fotos[0]!.semana)}</span>
            <span>{fechaCorta(ultima.semana)}</span>
          </div>
        </div>
        <p className="runway-leyenda" aria-hidden="true">
          <span className="runway-leyenda-barra" /> Runway conservador · <span className="runway-leyenda-linea" /> Tu mínimo: {textoMinimo(minimo)}
        </p>
      </figure>
      <details className="runway-datos">
        <summary>Ver los datos en tabla</summary>
        <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla del runway por semana">
          <table className="tabla" data-tabla="tendencia">
            <caption className="solo-lector">Runway por semana</caption>
            <thead>
              <tr>
                <th scope="col">Semana</th>
                <th scope="col" className="derecha">Conservador</th>
                <th scope="col" className="derecha">Esperado</th>
                <th scope="col" className="derecha">Saldo declarado</th>
              </tr>
            </thead>
            <tbody>
              {fotos.map((foto) => (
                <tr key={foto.semana} data-semana={foto.semana}>
                  <th scope="row">{fechaCorta(foto.semana)}</th>
                  <td className="cifra">{textoFoto(foto)}</td>
                  <td className="cifra">{textoSemanas(foto.semanasEsperado, foto.horizonte)}</td>
                  <td className="cifra">{formatoPesos(foto.saldoCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Hoja>
  );
}
