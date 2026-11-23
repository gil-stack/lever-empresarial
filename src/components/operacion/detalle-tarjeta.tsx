import Link from "next/link";

import { Hoja, Insignia, NotaRegla, Renglon, Renglones, Vacio } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { ESTADO_DE_CLASE } from "@/dominio/tarjetas/inventario";
import { claseDeImporte, conceptoSeguro, importeMovimiento } from "@/dominio/tarjetas/vista";
import type { DetalleTarjeta } from "@/server/efevoo/detalle-tarjeta";

import { fechaHora } from "./formato";

const TIPOS: Record<string, string> = {
  asignacion: "Asignación",
  activacion: "Activación",
  asignacion_cliente: "Paso a la empresa",
  carga: "Carga",
  retiro: "Retiro",
  bloqueo: "Bloqueo",
  desbloqueo: "Desbloqueo",
  cancelacion: "Cancelación",
};
const ESTADOS_OPERACION: Record<string, string> = { pendiente: "Pendiente", confirmada: "Confirmada", fallida: "Fallida", incierta: "Incierta" };

const SIN_MOVIMIENTOS: Record<NonNullable<DetalleTarjeta["sinMovimientos"]>, string> = {
  sin_titular: "La tarjeta todavía no tiene titular, así que no tiene movimientos.",
  no_respondio: "El procesador no respondió al leer los movimientos. Intenta de nuevo en unos minutos.",
};

/**
 * La fecha de un movimiento tal como la manda el procesador, ya en hora de México («2026-11-23 12:34:56»): se pinta
 * sin convertirla de zona. Si llega en otra forma, se deja como vino.
 */
export function fechaDelProcesador(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(valor.trim());
  if (!m) return valor;
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const mes = meses[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} ${mes} ${m[1]}, ${m[4]}:${m[5]}` : valor;
}

export function DetalleDeTarjeta({ detalle }: { detalle: DetalleTarjeta }) {
  const t = detalle.tarjeta;
  const estado = ESTADO_DE_CLASE[t.clase];
  const r = detalle.resumen;
  return (
    <div className="tarjeta-detalle">
      <section className="tarjeta-ficha" aria-label="Resumen de la tarjeta">
        <div className="tarjeta-ficha-saldo">
          <span className="rotulo">Saldo actual</span>
          <span className="tarjeta-ficha-valor">{t.saldoCentavos === null ? "—" : formatoPesos(t.saldoCentavos)}</span>
          <span className={`tarjetas-punto tarjetas-punto-${estado.tono}`}>{estado.texto}</span>
        </div>
        <Renglones>
          <Renglon etiqueta="Empresa">
            {t.empresa ? (
              <>
                {t.empresa.nombre}
                {t.empresa.companyId ? (
                  <> · <Link href={`/operacion/clientes/${t.empresa.companyId}`}>Ver ficha del cliente</Link></>
                ) : (
                  <span className="pista"> · no es una empresa de Lever</span>
                )}
              </>
            ) : (
              <span className="pista">Sin empresa: está disponible para entregarse</span>
            )}
          </Renglon>
          <Renglon etiqueta="Titular">{detalle.titular ?? <span className="pista">{t.clase === "sin_asignar" ? "Sin titular" : "No registrado en Lever"}</span>}</Renglon>
          <Renglon etiqueta="Nombre en la tarjeta">{t.nombreTarjeta ?? <span className="pista">—</span>}</Renglon>
          <Renglon etiqueta="Entregada por Lever">{t.entregadaEn ? fechaHora(new Date(t.entregadaEn)) : <span className="pista">—</span>}</Renglon>
          {detalle.canceladaEn ? <Renglon etiqueta="Cancelada">{fechaHora(new Date(detalle.canceladaEn))}</Renglon> : null}
          {detalle.motivoCancelacion ? <Renglon etiqueta="Motivo de la cancelación">{detalle.motivoCancelacion}</Renglon> : null}
        </Renglones>
      </section>

      {r ? (
        <ul className="tarjeta-cifras" aria-label="Resumen de movimientos">
          <li>
            <span className="rotulo">Entró</span>
            <span className="tarjeta-cifra-valor">{formatoPesos(r.abonadoCentavos)}</span>
            <span className="pista">Cargas a la tarjeta</span>
          </li>
          <li>
            <span className="rotulo">Salió</span>
            <span className="tarjeta-cifra-valor">{formatoPesos(r.cargadoCentavos)}</span>
            <span className="pista">Compras y retiros</span>
          </li>
          <li>
            <span className="rotulo">Movimientos</span>
            <span className="tarjeta-cifra-valor">{r.cuantos}</span>
            <span className="pista">{r.ultimo ? `Último: ${fechaDelProcesador(r.ultimo)}` : "Sin movimientos"}</span>
          </li>
        </ul>
      ) : null}

      <Hoja id="tarjeta-movimientos" titulo={`Movimientos${detalle.movimientos ? ` · ${detalle.movimientos.length}` : ""}`} className="tarjeta-seccion">
        {detalle.movimientos === null ? (
          <Vacio titulo="Sin movimientos que mostrar">{detalle.sinMovimientos ? SIN_MOVIMIENTOS[detalle.sinMovimientos] : null}</Vacio>
        ) : detalle.movimientos.length === 0 ? (
          <Vacio titulo="Sin movimientos">La tarjeta no tiene movimientos todavía.</Vacio>
        ) : (
          <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de movimientos de esta tarjeta">
            <table className="tabla operacion-tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Concepto</th>
                  <th scope="col" className="tarjetas-num">Importe</th>
                  <th scope="col" className="tarjetas-num">Saldo después</th>
                  <th scope="col">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {detalle.movimientos.map((m, i) => (
                  <tr key={`${m.idMovimiento}-${i}`}>
                    <td className="operacion-sin-corte">{fechaDelProcesador(m.fechaHora)}</td>
                    <td data-rotulo="Concepto">
                      {conceptoSeguro(m.concepto) || <span className="pista">Sin concepto</span>}
                      {m.tipo ? <small>{m.tipo === "abono" ? "Abono" : "Cargo"}</small> : null}
                    </td>
                    <td data-rotulo="Importe" className={`tarjetas-num ${claseDeImporte(m.tipo)}`}>
                      {importeMovimiento({ montoCentavos: m.centavos, tipo: m.tipo }) ?? "—"}
                    </td>
                    <td data-rotulo="Saldo después" className="tarjetas-num">
                      {m.saldoDespuesCentavos === null ? "—" : formatoPesos(m.saldoDespuesCentavos)}
                    </td>
                    <td data-rotulo="Referencia" className="operacion-mono">{m.referencia ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Hoja>

      <Hoja id="tarjeta-operaciones" titulo={`Lo que hizo Lever con la tarjeta · ${detalle.operaciones.length}`} className="tarjeta-seccion">
        {detalle.operaciones.length === 0 ? (
          <Vacio titulo="Sin operaciones de Lever">Lever no ha asignado, cargado ni cambiado esta tarjeta.</Vacio>
        ) : (
          <div className="tabla-contenedor" tabIndex={0} role="region" aria-label="Tabla de operaciones de Lever con la tarjeta">
            <table className="tabla operacion-tabla">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Operación</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="tarjetas-num">Monto</th>
                  <th scope="col">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {detalle.operaciones.map((o) => (
                  <tr key={o.id}>
                    <td className="operacion-sin-corte">{fechaHora(new Date(o.creadaEn))}</td>
                    <td data-rotulo="Operación">{TIPOS[o.tipo] ?? o.tipo}</td>
                    <td data-rotulo="Estado">
                      <Insignia tono={o.estado === "confirmada" ? "sello" : o.estado === "fallida" || o.estado === "incierta" ? "aviso" : "neutro"}>
                        {ESTADOS_OPERACION[o.estado] ?? o.estado}
                      </Insignia>
                    </td>
                    <td data-rotulo="Monto" className="tarjetas-num">{o.montoCentavos === null ? "—" : formatoPesos(o.montoCentavos)}</td>
                    <td data-rotulo="Referencia" className="operacion-mono">{o.referencia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Hoja>

      <NotaRegla>
        Aquí solo se consulta. Para asignar, activar o cancelar la tarjeta, entra a la empresa en Clientes. Nunca se muestra el número completo ni el código de seguridad.
      </NotaRegla>
    </div>
  );
}
