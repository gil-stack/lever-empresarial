import type { CSSProperties, ReactNode } from "react";

import { BarraAvance } from "@/components/sistema";
import type { AccionDemo, CifraDemo, EstadoDemo, RangoDemo } from "@/dominio/demo/tipos";

/** El id de la línea que explica la demostración: cada botón apagado la nombra. */
export const ID_AVISO_DEMO = "demo-aviso";

/** Pesos con centavos y signo de menos tipográfico, como el diseño (−$1,850.00). */
export function pesos(centavos: number, conSigno = false): string {
  const absoluto = Math.abs(centavos);
  const texto = `$${Math.trunc(absoluto / 100).toLocaleString("en-US")}.${String(absoluto % 100).padStart(2, "0")}`;
  if (centavos < 0) return `−${texto}`;
  return conSigno && centavos > 0 ? `+${texto}` : texto;
}

/** Pesos redondeados al peso, como `fmt0` del diseño ($98,422). */
export function pesosRedondos(centavos: number): string {
  return `$${Math.round(centavos / 100).toLocaleString("en-US")}`;
}

/** La fila de cifras clave de arriba (`.grid.g4 > .card.kpi`). */
export function Cifras({ cifras, etiqueta }: { cifras: readonly CifraDemo[]; etiqueta: string }) {
  return (
    <dl className="demo-cifras" aria-label={etiqueta}>
      {cifras.map((cifra) => (
        <div className="demo-cifra" key={cifra.rotulo}>
          <dt className="eyebrow">{cifra.rotulo}</dt>
          <dd className="demo-cifra-valor" data-tono={cifra.tono}>
            {cifra.valor}
          </dd>
          <dd>
            <small>{cifra.nota}</small>
          </dd>
          {cifra.avance !== undefined ? (
            <dd>
              <BarraAvance valor={Math.round(cifra.avance * 1000)} tope={1000} etiqueta={cifra.rotulo} />
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/** Una tarjeta del diseño (`.card` con `.hd`): título, nota o acciones, y su contenido. */
export function Tarjeta({
  id,
  titulo,
  nota,
  acciones,
  className,
  children,
}: {
  id: string;
  titulo: ReactNode;
  nota?: ReactNode;
  acciones?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `hoja ${className}` : "hoja"} aria-labelledby={id}>
      <div className="demo-hd">
        <h2 id={id}>{titulo}</h2>
        {acciones ? <div className="demo-hd-acciones">{acciones}</div> : nota ? <small>{nota}</small> : null}
      </div>
      {children}
    </section>
  );
}

const CLASE_DE_ACCION: Record<AccionDemo["tipo"], string> = {
  principal: "boton",
  secundaria: "boton-texto",
  fantasma: "boton-fantasma",
};

/**
 * Un botón del diseño que mueve dinero o crea algo. En la demostración va
 * apagado y lo dice: la marca «Demostración» vive dentro del botón y la línea
 * de arriba explica por qué.
 */
export function Accion({
  accion,
  chico = true,
  icono,
  className,
}: {
  accion: AccionDemo;
  chico?: boolean;
  icono?: ReactNode;
  className?: string;
}) {
  const clases = [CLASE_DE_ACCION[accion.tipo], chico ? "boton-chico" : null, className].filter(Boolean).join(" ");
  return (
    <button type="button" className={clases} disabled aria-describedby={ID_AVISO_DEMO} data-demo="apagado">
      {icono}
      {accion.etiqueta}
      <span className="demo-marca">Demostración</span>
    </button>
  );
}

const CLASE_DE_ESTADO: Record<EstadoDemo["tono"], string> = {
  acento: "insignia insignia-sello",
  aviso: "insignia demo-insignia-ambar",
  peligro: "insignia insignia-aviso",
  tenue: "insignia",
  azul: "insignia demo-insignia-azul",
};

/** Estado con punto de color (`.badge`). */
export function Estado({ estado }: { estado: EstadoDemo }) {
  return <span className={CLASE_DE_ESTADO[estado.tono]}>{estado.texto}</span>;
}

/** Un renglón con ícono redondo (`.li`). */
export function Renglon({
  icono,
  tono,
  titulo,
  detalle,
  children,
}: {
  icono: ReactNode;
  tono?: "aviso" | "peligro";
  titulo: ReactNode;
  detalle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="demo-li">
      <span className="demo-li-icono" data-tono={tono} aria-hidden="true">
        {icono}
      </span>
      <div className="demo-li-texto">
        <b>{titulo}</b>
        {detalle ? <small>{detalle}</small> : null}
      </div>
      {children}
    </li>
  );
}

/** El chip de la tarjeta (`.mcard`): plateada, negra o virtual. */
export function ChipTarjeta({ acabado }: { acabado: "plata" | "negra" | "virtual" }) {
  return (
    <span className="demo-mcard" data-acabado={acabado} aria-hidden="true">
      VISA
    </span>
  );
}

export function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}

/** Un interruptor del diseño que en la demostración no se mueve. */
export function InterruptorApagado({ etiqueta, encendido }: { etiqueta: string; encendido: boolean }) {
  return (
    <button
      type="button"
      className="interruptor"
      role="switch"
      aria-checked={encendido}
      aria-label={`${etiqueta} (demostración)`}
      aria-describedby={ID_AVISO_DEMO}
      disabled
    />
  );
}

/** El deslizador de monto del diseño, quieto en la demostración: se ve dónde está el monto, no se mueve. */
export function DeslizadorApagado({ etiqueta, valorCentavos, rango }: { etiqueta: string; valorCentavos: number; rango: RangoDemo }) {
  const avance = ((valorCentavos - rango.minimoCentavos) / (rango.maximoCentavos - rango.minimoCentavos)) * 100;
  return (
    <input
      type="range"
      className="demo-deslizador"
      min={rango.minimoCentavos / 100}
      max={rango.maximoCentavos / 100}
      step={rango.pasoCentavos / 100}
      defaultValue={valorCentavos / 100}
      aria-label={`${etiqueta} (demostración)`}
      aria-describedby={ID_AVISO_DEMO}
      disabled
      style={{ "--avance": `${avance.toFixed(2)}%` } as CSSProperties}
    />
  );
}
