"use client";

import { useState } from "react";

import { Insignia, PanelDetalle, Renglon, Renglones } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { desplazar, fechaConAnio, fechaCorta, lunesDe, ultimoDelMes } from "@/dominio/flujo/fechas";
import type { TipoMovimiento } from "@/dominio/flujo/proyeccion";

import { Origen } from "./origen";

export type EventoVista = {
  clave: string;
  tipo: TipoMovimiento;
  sentido: "entrada" | "salida";
  fecha: string;
  centavos: number;
  concepto: string;
  vencido: boolean;
  /** Nómina de una sola persona vista sin permiso de detalle: no se muestra el monto. */
  reservado: boolean;
  detalle: readonly (readonly [string, string])[];
};

function monto(evento: EventoVista): string {
  return evento.reservado ? "Monto reservado" : formatoPesos(evento.centavos);
}

const TIPO: Record<TipoMovimiento, string> = {
  nomina: "Nómina",
  proveedor: "Pago a proveedor",
  obligacion: "Obligación recurrente",
  cobro: "Cobro",
};

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/**
 * El mes en cuadrícula de lunes a domingo y la lista de las próximas fechas.
 * Cada elemento abre su detalle en el panel lateral del sistema.
 */
export function Calendario({ mes, hoy, eventos, proximos }: { mes: string; hoy: string; eventos: EventoVista[]; proximos: EventoVista[] }) {
  const [abierto, setAbierto] = useState<EventoVista | null>(null);
  const inicio = lunesDe(mes);
  const fin = desplazar(lunesDe(ultimoDelMes(mes)), 6);
  const dias: string[] = [];
  for (let dia = inicio; dia <= fin; dia = desplazar(dia, 1)) dias.push(dia);
  const porDia = new Map<string, EventoVista[]>();
  for (const evento of eventos) porDia.set(evento.fecha, [...(porDia.get(evento.fecha) ?? []), evento]);
  const delMes = mes.slice(0, 7);

  return (
    <>
      <div className="flujo-mes" role="grid" aria-label="Mes">
        {DIAS.map((dia) => <div key={dia} className="flujo-mes-dia-semana" role="columnheader">{dia}</div>)}
        {dias.map((dia) => {
          const clases = ["flujo-dia"];
          if (!dia.startsWith(delMes)) clases.push("flujo-dia-fuera");
          if (dia === hoy) clases.push("flujo-dia-hoy");
          return (
            <div key={dia} className={clases.join(" ")} role="gridcell" data-dia={dia}>
              <span className="flujo-dia-numero">{Number(dia.slice(8, 10))}</span>
              {(porDia.get(dia) ?? []).map((evento) => (
                <button
                  key={evento.clave}
                  type="button"
                  className="flujo-evento"
                  data-tipo={evento.tipo}
                  data-vencido={evento.vencido ? "true" : undefined}
                  data-clave={evento.clave}
                  onClick={() => setAbierto(evento)}
                  title={`${evento.concepto} · ${monto(evento)}`}
                >
                  {evento.concepto}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <ul className="flujo-proximos flujo-mes-lista" aria-label="Fechas del mes">
        {eventos.length === 0 ? <li><p className="pista">Este mes no tiene nómina, pagos, cobros ni obligaciones.</p></li> : null}
        {eventos.map((evento) => <Fila key={evento.clave} evento={evento} alAbrir={setAbierto} />)}
      </ul>

      <section className="hoja flujo-bloque" aria-labelledby="proximas-titulo">
        <h2 id="proximas-titulo">Próximas fechas</h2>
        <p className="pista">Los próximos 30 días, desde hoy.</p>
        {proximos.length === 0 ? (
          <p className="flujo-nota">Nada en los próximos 30 días.</p>
        ) : (
          <ul className="flujo-proximos">
            {proximos.map((evento) => <Fila key={`p-${evento.clave}`} evento={evento} alAbrir={setAbierto} />)}
          </ul>
        )}
      </section>

      <PanelDetalle abierto={abierto !== null} alCerrar={() => setAbierto(null)} titulo={abierto?.concepto ?? ""} contexto={abierto ? TIPO[abierto.tipo] : undefined}>
        {abierto ? (
          <div data-detalle={abierto.clave}>
            <p>
              <Origen de="comprometido" />
              {abierto.vencido ? <Insignia tono="aviso">Vencido</Insignia> : null}
            </p>
            <Renglones dinero>
              <Renglon etiqueta="Fecha">{fechaConAnio(abierto.fecha)}</Renglon>
              <Renglon etiqueta={abierto.sentido === "entrada" ? "Entra" : "Sale"}>
                {abierto.reservado ? <span>Monto reservado</span> : <span className="monto">{formatoPesos(abierto.centavos)}</span>}
              </Renglon>
            </Renglones>
            <Renglones>
              {abierto.detalle.map(([etiqueta, valor]) => <Renglon key={etiqueta} etiqueta={etiqueta}>{valor}</Renglon>)}
            </Renglones>
          </div>
        ) : null}
      </PanelDetalle>
    </>
  );
}

function Fila({ evento, alAbrir }: { evento: EventoVista; alAbrir: (evento: EventoVista) => void }) {
  return (
    <li>
      <button type="button" onClick={() => alAbrir(evento)} data-clave={evento.clave} data-tipo={evento.tipo}>
        <span>
          {fechaCorta(evento.fecha)} · {evento.concepto}
          <small>{TIPO[evento.tipo]}{evento.vencido ? " · vencido" : ""}</small>
        </span>
        {evento.reservado ? (
          <strong data-reservado="true">Monto reservado</strong>
        ) : (
          <strong className={evento.sentido === "entrada" ? "cifra-ingreso" : "cifra-gasto"}>
            {evento.sentido === "entrada" ? "+" : "−"}{formatoPesos(evento.centavos)}
          </strong>
        )}
      </button>
    </li>
  );
}
