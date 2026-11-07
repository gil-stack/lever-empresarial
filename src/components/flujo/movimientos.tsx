import { Insignia } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { fechaCorta } from "@/dominio/flujo/fechas";
import type { Movimiento, Semana } from "@/dominio/flujo/proyeccion";

export function rango(semana: Semana): string {
  return `${fechaCorta(semana.inicio)} – ${fechaCorta(semana.fin)}`;
}

/** Los movimientos de cada semana de la proyección de Inicio. Va aparte para probarlo sin la hoja de estilos. */
export function Movimientos({ semanas }: { semanas: Semana[] }) {
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
      {m.reservado ? (
        // Nómina que puede ser el neto de una sola persona: el total de la semana la incluye, el renglón no la muestra.
        <strong data-reservado="true">Monto reservado</strong>
      ) : (
        <strong className={m.sentido === "entrada" ? "cifra-ingreso" : "cifra-gasto"}>
          {m.sentido === "entrada" ? "+" : "−"}{formatoPesos(m.centavos)}
        </strong>
      )}
    </li>
  );
}
