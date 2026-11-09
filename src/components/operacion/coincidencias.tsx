import Link from "next/link";

import { registrarReporteAccion, resolverCoincidenciaAccion } from "@/app/operacion/acciones-alta";
import { BotonEnviar, Insignia, Vacio } from "@/components/sistema";
import { ETIQUETA_ESTADO_COINCIDENCIA, ETIQUETA_SUJETO } from "@/dominio/operacion";

import { fechaHora } from "./formato";
import { FormularioFolio } from "./formulario-folio";

export type CoincidenciaVista = {
  id: string;
  companyId: string;
  razonSocial: string;
  sujetoTipo: string;
  sujetoNombre: string;
  tipo: "exacta" | "posible";
  estado: string;
  plazoReporteHasta: Date | null;
  coincidePor?: "rfc" | "curp" | "nombre";
  nombreEnLista?: string | null;
  lista?: "lpb" | "69b";
  motivoResolucion?: string | null;
  resueltaPor?: string | null;
  reporteFolio?: string | null;
};

const POR: Record<string, string> = { rfc: "RFC idéntico", curp: "CURP idéntica", nombre: "Nombre parecido" };

/**
 * Coincidencias con la Lista de Personas Bloqueadas (o la 69-B definitiva) y lo que Cumplimiento
 * hace con cada una. Una posible coincidencia por nombre nunca se descarta sola: la revisa una
 * persona y deja su motivo. Lever registra el folio del reporte; no lo transmite a la UIF.
 */
export function Coincidencias({
  coincidencias,
  resuelve,
  desde,
  ahora,
  vacio,
  aviso,
  en,
}: {
  coincidencias: CoincidenciaVista[];
  resuelve: boolean;
  desde: "cumplimiento" | "lpb";
  ahora: Date;
  vacio: string;
  /** El aviso del último envío y el campo que lo causó (`folio-<id>`, `presentado-<id>` o `aviso-<id>`): marca ese campo. */
  aviso?: string;
  en?: string;
}) {
  if (coincidencias.length === 0) return <Vacio titulo="Sin coincidencias abiertas">{vacio}</Vacio>;
  return (
    <ul className="operacion-lista">
      {coincidencias.map((coincidencia) => {
        const vencido = coincidencia.plazoReporteHasta !== null && coincidencia.plazoReporteHasta.getTime() < ahora.getTime();
        return (
          <li key={coincidencia.id}>
            <div className="operacion-fila">
              <div className="operacion-fila-cuerpo">
                <h3>
                  {ETIQUETA_SUJETO[coincidencia.sujetoTipo] ?? coincidencia.sujetoTipo}: {coincidencia.sujetoNombre}
                </h3>
                <p className="operacion-meta">
                  <span>
                    <Link href={`/operacion/clientes/${coincidencia.companyId}`}>{coincidencia.razonSocial}</Link>
                  </span>
                  {coincidencia.coincidePor ? <span>{POR[coincidencia.coincidePor]}</span> : null}
                  {coincidencia.nombreEnLista ? <span>En la lista: {coincidencia.nombreEnLista}</span> : null}
                  {coincidencia.lista === "69b" ? <span>Lista 69-B definitiva</span> : null}
                  {coincidencia.plazoReporteHasta ? (
                    <span>
                      Reportar antes de {fechaHora(coincidencia.plazoReporteHasta)}
                      {vencido ? " · plazo vencido" : ""}
                    </span>
                  ) : null}
                </p>
                {coincidencia.motivoResolucion ? (
                  <p className="operacion-detalle">
                    {coincidencia.resueltaPor ? `${coincidencia.resueltaPor}: ` : ""}
                    {coincidencia.motivoResolucion}
                  </p>
                ) : null}
                {coincidencia.reporteFolio ? <p className="operacion-meta">Folio del reporte: {coincidencia.reporteFolio}</p> : null}
              </div>
              <div className="operacion-roles">
                <Insignia tono={coincidencia.tipo === "exacta" ? "aviso" : "neutro"}>
                  {coincidencia.tipo === "exacta" ? "Coincidencia" : "Posible coincidencia"}
                </Insignia>
                <Insignia tono={vencido ? "aviso" : "neutro"}>{ETIQUETA_ESTADO_COINCIDENCIA[coincidencia.estado] ?? coincidencia.estado}</Insignia>
              </div>
            </div>
            {resuelve && coincidencia.estado === "pendiente" ? (
              <form action={resolverCoincidenciaAccion} className="operacion-acciones">
                <input type="hidden" name="id" value={coincidencia.id} />
                <input type="hidden" name="desde" value={desde} />
                <div className="campo">
                  <label htmlFor={`resolucion-${coincidencia.id}`}>Dictamen</label>
                  <select id={`resolucion-${coincidencia.id}`} name="estado" required defaultValue="">
                    <option value="" disabled>
                      Elige uno
                    </option>
                    <option value="confirmada">Es la misma persona</option>
                    <option value="falso_positivo">Falso positivo: es otra persona</option>
                    <option value="fuera_de_lista">Ya no está en la lista vigente</option>
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor={`motivo-${coincidencia.id}`}>Motivo (al menos 10 caracteres)</label>
                  <input id={`motivo-${coincidencia.id}`} name="motivo" minLength={10} maxLength={1000} required />
                </div>
                <BotonEnviar className="boton-secundario">Registrar dictamen</BotonEnviar>
              </form>
            ) : null}
            {resuelve && coincidencia.estado === "confirmada" && !coincidencia.reporteFolio ? (
              <FormularioFolio id={coincidencia.id} desde={desde} accion={registrarReporteAccion} aviso={aviso} en={en} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
