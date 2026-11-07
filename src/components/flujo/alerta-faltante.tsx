import Link from "next/link";

import "@/estilo/flujo.css";

import { Aviso } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { fechaCorta } from "@/dominio/flujo/fechas";
import type { Faltante } from "@/dominio/flujo/proyeccion";

/**
 * La alerta de faltante de la proyección. Inicio y Pendientes pintan la misma;
 * Pendientes agrega el enlace a donde se revisa.
 */
export function AlertaFaltante({
  faltante,
  colchonCentavos,
  enlace = null,
}: {
  faltante: Faltante;
  colchonCentavos: number;
  enlace?: { href: string; texto: string } | null;
}) {
  return (
    <div data-alerta="faltante">
      <Aviso titulo={tituloFaltante(faltante)}>
        <p>
          Saldo proyectado al cierre de la semana: <strong>{formatoPesos(faltante.saldoFinal)}</strong>
          {faltante.motivo === "colchon" ? <> (colchón: {formatoPesos(colchonCentavos)})</> : null}.
        </p>
        {faltante.causas.length > 0 ? (
          <p>Lo provoca: {faltante.causas.map((m) => `${m.concepto} (${formatoPesos(m.centavos)})`).join(", ")}.</p>
        ) : null}
        {enlace ? (
          <p>
            <Link href={enlace.href}>{enlace.texto}</Link>
          </p>
        ) : null}
      </Aviso>
    </div>
  );
}

function tituloFaltante(f: Faltante): string {
  const semana = `semana del ${fechaCorta(f.inicio)} al ${fechaCorta(f.fin)}`;
  return f.motivo === "negativo" ? `Faltante: el saldo queda en negativo la ${semana}` : `El saldo baja del colchón la ${semana}`;
}
