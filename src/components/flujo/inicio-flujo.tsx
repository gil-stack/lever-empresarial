import Link from "next/link";
import type { ReactNode } from "react";

import "@/estilo/flujo.css";

import { Ausencia, Aviso, CifraGrande, Insignia } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { fechaConAnio, fechaCorta } from "@/dominio/flujo/fechas";
import { cifrasDePresupuesto, ETIQUETA_ESTADO_PRESUPUESTO } from "@/dominio/flujo/presupuestos";
import { textoAlcance, type Movimiento, type Semana } from "@/dominio/flujo/proyeccion";
import { horaEnMexico } from "@/dominio/reloj";
import { enEmpresa } from "@/nucleo/rutas";
import type { FlujoInicio } from "@/server/flujo/servicio";

import { AlertaFaltante } from "./alerta-faltante";
import { Origen } from "./origen";

/**
 * El flujo de caja en Inicio: saldo declarado (o la invitación a declararlo),
 * lo comprometido, cuánto alcanza, las alertas y la proyección de 13 semanas
 * con su escenario. Cada cifra dice de dónde sale.
 */
export function InicioFlujo({ flujo, empresaId }: { flujo: FlujoInicio; empresaId: string | null }) {
  const p = flujo.proyeccion;
  return (
    <>
      <section className="flujo-hero" aria-labelledby="saldo-titulo">
        <Saldo flujo={flujo} empresaId={empresaId} />
        <dl className="flujo-indicadores">
          <Indicador rotulo="Salidas comprometidas, 4 semanas" origen="comprometido">
            <span data-cifra="comprometido4" data-centavos={p.comprometido4}>{formatoPesos(p.comprometido4)}</span>
          </Indicador>
          <Indicador rotulo="Cobros, 4 semanas" origen="comprometido" nota="Los esperados y los ya cobrados después del saldo declarado.">
            <span data-cifra="entradas4" data-centavos={p.entradas4}>{formatoPesos(p.entradas4)}</span>
          </Indicador>
          <Indicador rotulo="Gasto neto mensual promedio" origen="comprometido" nota="Salidas menos entradas de las 13 semanas, entre tres meses.">
            <span data-cifra="gasto-neto" data-centavos={p.gastoNetoMensual}>{formatoPesos(p.gastoNetoMensual)}</span>
          </Indicador>
          <Indicador rotulo="Cuánto alcanza el dinero" origen={p.saldo ? "declarado" : null}>
            <span data-cifra="alcance">{textoAlcance(p)}</span>
          </Indicador>
        </dl>
      </section>

      <Alertas flujo={flujo} empresaId={empresaId} />
      <ProyeccionSemanal flujo={flujo} empresaId={empresaId} />
    </>
  );
}

function Saldo({ flujo, empresaId }: { flujo: FlujoInicio; empresaId: string | null }) {
  const saldo = flujo.proyeccion.saldo;
  if (!saldo) {
    return (
      <div className="flujo-saldo" data-estado="sin-saldo">
        <p className="rotulo" id="saldo-titulo">Saldo en bancos</p>
        <Ausencia>Sin saldo declarado</Ausencia>
        <p>
          Para saber si alcanza el dinero hace falta el saldo de tus cuentas de banco. Lo captura una persona autorizada, con fecha;
          mientras tanto ves lo comprometido.
        </p>
        {flujo.puedeEditar ? (
          <Link className="boton" href={enEmpresa(empresaId, "/consola/flujo#declarar")}>Declarar el saldo</Link>
        ) : (
          <p className="pista">Lo declara administración o finanzas.</p>
        )}
      </div>
    );
  }
  return (
    <div className="flujo-saldo" data-estado="declarado">
      <p className="rotulo" id="saldo-titulo">Saldo en bancos <Origen de="declarado" /></p>
      <CifraGrande centavos={saldo.centavos} />
      <p data-cifra="saldo-detalle">
        Al {fechaConAnio(saldo.alDia)} · declarado por {saldo.autor} el {horaEnMexico(new Date(saldo.declaradoEn))}.
      </p>
      <p className="pista">No es un saldo confirmado por el banco.</p>
      {flujo.puedeEditar ? <Link className="enlace-texto" href={enEmpresa(empresaId, "/consola/flujo#declarar")}>Declarar un saldo más reciente</Link> : null}
    </div>
  );
}

function Indicador({
  rotulo,
  origen,
  nota,
  children,
}: {
  rotulo: string;
  origen: "comprometido" | "declarado" | null;
  nota?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>{rotulo}{origen ? <Origen de={origen} /> : null}</dt>
      <dd>{children}</dd>
      {nota ? <dd className="pista">{nota}</dd> : null}
    </div>
  );
}

function Alertas({ flujo, empresaId }: { flujo: FlujoInicio; empresaId: string | null }) {
  const p = flujo.proyeccion;
  const presupuesto = flujo.presupuestos.alertas;
  const vencidos = flujo.cobros.vencidos;
  if (!p.faltante && presupuesto.length === 0 && vencidos === 0) return null;
  return (
    <section className="flujo-alertas" aria-labelledby="alertas-titulo">
      <h2 id="alertas-titulo" className="solo-lector">Alertas</h2>
      {p.faltante ? <AlertaFaltante faltante={p.faltante} colchonCentavos={p.colchonCentavos} /> : null}
      {presupuesto.length > 0 ? (
        <div data-alerta="presupuesto">
          <Aviso titulo={presupuesto.length === 1 ? "Un presupuesto pide atención" : `${presupuesto.length} presupuestos piden atención`}>
            <ul>
              {presupuesto.map((linea) => (
                <li key={`${linea.tipo}-${linea.id}`}>
                  <Link href={enEmpresa(empresaId, "/consola/presupuestos")}>
                    {linea.tipo === "area" ? "Área" : "Persona"} {linea.nombre}: {ETIQUETA_ESTADO_PRESUPUESTO[linea.estado].toLowerCase()} ({cifrasDePresupuesto(linea)})
                  </Link>
                </li>
              ))}
            </ul>
          </Aviso>
        </div>
      ) : null}
      {vencidos > 0 ? (
        <div data-alerta="cobros-vencidos">
          <Aviso titulo={vencidos === 1 ? "Un cobro esperado ya venció" : `${vencidos} cobros esperados ya vencieron`}>
            <p>
              Suman {formatoPesos(flujo.cobros.vencidosCentavos)} y no entran en la proyección. Al marcarlos como cobrados, entran en la semana en que llegó el dinero.{" "}
              <Link href={enEmpresa(empresaId, "/consola/cobros?estado=vencido")}>Revisar cobros vencidos</Link>
            </p>
          </Aviso>
        </div>
      ) : null}
    </section>
  );
}

function rango(semana: Semana): string {
  return `${fechaCorta(semana.inicio)} – ${fechaCorta(semana.fin)}`;
}

function ProyeccionSemanal({ flujo, empresaId }: { flujo: FlujoInicio; empresaId: string | null }) {
  const p = flujo.proyeccion;
  const real = flujo.real;
  return (
    <section className="hoja flujo-proyeccion" aria-labelledby="proyeccion-titulo">
      <header className="flujo-seccion-cabeza">
        <div>
          <h2 id="proyeccion-titulo">Proyección a 13 semanas</h2>
          <p>
            Semanas de lunes a domingo, hora del centro de México. Movimientos después del {fechaConAnio(p.corte)}. Los pagos a proveedores
            de antes ya autorizados se dan por pagados en el saldo declarado; los vencidos sin autorizar van en la primera semana.
          </p>
        </div>
        <p className="flujo-leyenda">
          <Origen de="declarado" /> saldo inicial · <Origen de="comprometido" /> entradas y salidas
        </p>
      </header>

      {p.escenario ? (
        <div data-escenario="activo">
          <Aviso tono="asentado" titulo="Escenario: el pago real no cambia">
            <p>
              {p.escenario.concepto} se ve el {fechaConAnio(p.escenario.fecha)} en lugar de su fecha programada.
              {real?.semanas.at(-1)?.saldoFinal != null && p.semanas.at(-1)?.saldoFinal != null ? (
                <> Saldo al final de las 13 semanas: {formatoPesos(p.semanas.at(-1)!.saldoFinal!)} (sin escenario: {formatoPesos(real.semanas.at(-1)!.saldoFinal!)}).</>
              ) : null}
            </p>
            <p><Link href={enEmpresa(empresaId, "/consola")}>Quitar el escenario</Link></p>
          </Aviso>
        </div>
      ) : null}

      <div className="tabla-contenedor">
        {/* Roles explícitos: en móvil la tabla se apila con CSS y sin ellos el lector de pantalla deja de verla como tabla. */}
        <table className="tabla flujo-tabla flujo-apilada" data-tabla="proyeccion" role="table">
          <caption className="solo-lector">Saldo inicial, entradas, salidas y saldo final por semana</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Semana</th>
              <th scope="col" role="columnheader" className="derecha">Saldo inicial</th>
              <th scope="col" role="columnheader" className="derecha">Entradas</th>
              <th scope="col" role="columnheader" className="derecha">Salidas</th>
              <th scope="col" role="columnheader" className="derecha">Saldo final</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {p.semanas.map((semana) => (
              <tr
                key={semana.inicio}
                role="row"
                data-semana={semana.inicio}
                className={semana.saldoFinal !== null && semana.saldoFinal < 0 ? "flujo-semana-negativa" : undefined}
              >
                <th scope="row" role="rowheader">{rango(semana)}{p.faltante?.semana === semana.indice ? <Insignia tono="aviso">Faltante</Insignia> : null}</th>
                <Cifra valor={semana.saldoInicial} nombre="saldo-inicial" etiqueta="Inicial" />
                <Cifra valor={semana.entradas} nombre="entradas" etiqueta="Entra" />
                <Cifra valor={semana.salidas} nombre="salidas" etiqueta="Sale" />
                <Cifra valor={semana.saldoFinal} nombre="saldo-final" etiqueta="Saldo final" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Movimientos semanas={p.semanas} />

      {p.movibles.length > 0 || p.escenario ? (
        <form className="flujo-escenario" method="get" action={enEmpresa(empresaId, "/consola")} aria-labelledby="escenario-titulo">
          <h3 id="escenario-titulo">¿Y si muevo este pago?</h3>
          <p className="pista">Elige un pago a proveedor u obligación pendiente y otra fecha. Solo cambia esta vista; el pago real sigue igual.</p>
          <div className="formulario-pareja">
            <div className="campo">
              <label htmlFor="mover">Pago u obligación</label>
              <select id="mover" name="mover" defaultValue={p.escenario?.clave ?? ""} required>
                <option value="" disabled>Elige uno</option>
                {(real ?? p).movibles.map((m) => (
                  <option key={m.clave} value={m.clave}>{fechaCorta(m.fecha)} · {m.concepto} · {formatoPesos(m.centavos)}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="fecha-escenario">Nueva fecha</label>
              <input id="fecha-escenario" name="fecha" type="date" min={p.hoy} max={p.fin} defaultValue={p.escenario?.fecha ?? ""} required />
            </div>
          </div>
          <div className="acciones">
            <button className="boton-texto" type="submit">Ver el escenario</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/** `etiqueta` solo se pinta en móvil, cuando la fila se apila y ya no hay encabezado a la vista. */
function Cifra({ valor, nombre, etiqueta }: { valor: number | null; nombre: string; etiqueta: string }) {
  if (valor === null) return <td role="cell" className="cifra flujo-sin-cifra" data-cifra={nombre} data-etiqueta={etiqueta}>—</td>;
  return (
    <td role="cell" className={valor < 0 ? "cifra flujo-negativo" : "cifra"} data-cifra={nombre} data-etiqueta={etiqueta} data-centavos={valor}>
      {formatoPesos(valor)}
    </td>
  );
}

function Movimientos({ semanas }: { semanas: Semana[] }) {
  const conMovimientos = semanas.filter((semana) => semana.movimientos.length > 0);
  if (conMovimientos.length === 0) {
    return <p className="flujo-nota">Todavía no hay nómina, pagos, cobros ni obligaciones en estas 13 semanas.</p>;
  }
  return (
    <div className="flujo-movimientos">
      {conMovimientos.map((semana) => (
        <details key={semana.inicio} data-movimientos={semana.inicio}>
          <summary>{rango(semana)} · {semana.movimientos.length} {semana.movimientos.length === 1 ? "movimiento" : "movimientos"}</summary>
          <ul>
            {semana.movimientos.map((m) => <Renglon key={`${m.clave}-${m.atrasado ? "a" : ""}`} m={m} />)}
          </ul>
        </details>
      ))}
    </div>
  );
}

function Renglon({ m }: { m: Movimiento }) {
  return (
    <li data-clave={m.clave}>
      <span>
        {fechaCorta(m.fecha)} · {m.concepto}
        {m.atrasado ? <Insignia tono="aviso">{m.sinAutorizar ? "Vencido sin autorizar" : "Atrasado"}</Insignia> : null}
        {m.cobrado ? <Insignia tono="sello">Cobrado</Insignia> : null}
        {m.fechaOriginal ? <Insignia tono="sello">Escenario</Insignia> : null}
      </span>
      <strong className={m.sentido === "entrada" ? "cifra-ingreso" : "cifra-gasto"}>
        {m.sentido === "entrada" ? "+" : "−"}{formatoPesos(m.centavos)}
      </strong>
    </li>
  );
}
