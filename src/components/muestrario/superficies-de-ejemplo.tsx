"use client";

import { useCallback, useState } from "react";

import { AvisoInferior, BarraAvance, Dialogo, Insignia, PanelDetalle } from "@/components/sistema";

const FILAS = [
  { nombre: "Viáticos", persona: "Ana Torres", gastado: 1770000, tope: 3000000, estado: "Activa" },
  { nombre: "Combustible", persona: "Carlos Méndez", gastado: 1888000, tope: 2500000, estado: "Activa" },
  { nombre: "Compras", persona: "Daniela Ruiz", gastado: 5570000, tope: 6000000, estado: "Cerca del tope" },
] as const;

const pesos = (centavos: number) =>
  (centavos / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** Tabla, segmentado, diálogo, panel lateral y aviso con «Deshacer», con datos de ejemplo. No guarda nada. */
export function SuperficiesDeEjemplo() {
  const [vista, setVista] = useState<"tabla" | "botones">("tabla");
  const [dialogo, setDialogo] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ mensaje: string; deshacer?: () => void } | null>(null);
  const [archivadas, setArchivadas] = useState<string[]>([]);
  // Contrato del diálogo y del panel: `alCerrar` avisa una sola vez por cierre.
  const [cierres, setCierres] = useState(0);
  const terminar = useCallback(() => setAviso(null), []);

  function archivar(nombre: string) {
    setArchivadas((antes) => [...antes, nombre]);
    setAviso({ mensaje: `Archivaste ${nombre}`, deshacer: () => setArchivadas((antes) => antes.filter((n) => n !== nombre)) });
  }

  return (
    <div className="superficies-de-ejemplo">
      <div className="segmentado" role="group" aria-label="Vista de ejemplo">
        <button type="button" aria-pressed={vista === "tabla"} onClick={() => setVista("tabla")}>Tabla</button>
        <button type="button" aria-pressed={vista === "botones"} onClick={() => setVista("botones")}>Botones</button>
      </div>
      {vista === "tabla" ? (
        <div className="tabla-contenedor">
          <table className="tabla">
            <thead>
              <tr><th>Tarjeta</th><th>Persona</th><th className="derecha">Gastado este mes</th><th>Estado</th><th><span className="solo-lector">Acciones</span></th></tr>
            </thead>
            <tbody>
              {FILAS.filter((fila) => !archivadas.includes(fila.nombre)).map((fila) => (
                <tr key={fila.nombre}>
                  <td>{fila.nombre}<small>Física</small></td>
                  <td>{fila.persona}</td>
                  <td className="cifra">
                    {pesos(fila.gastado)}
                    <BarraAvance valor={fila.gastado} tope={fila.tope} etiqueta={`Gasto de ${fila.nombre} contra su tope`} />
                  </td>
                  <td><Insignia tono={fila.estado === "Activa" ? "sello" : "neutro"}>{fila.estado}</Insignia></td>
                  <td className="derecha">
                    <button type="button" className="boton-fantasma boton-chico" onClick={() => setDetalle(fila.nombre)}>Ver detalle</button>
                    <button type="button" className="boton-texto boton-chico" onClick={() => archivar(fila.nombre)}>Archivar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="acciones">
          <button type="button" className="boton" onClick={() => setDialogo(true)}>Principal</button>
          <button type="button" className="boton-texto">Secundario</button>
          <button type="button" className="boton-fantasma">Fantasma</button>
          <button type="button" className="boton boton-chico">Chico</button>
        </div>
      )}
      <Dialogo
        abierto={dialogo}
        alCerrar={() => {
          setCierres((n) => n + 1);
          setDialogo(false);
        }}
        titulo="Confirma la acción"
        explicacion="Lo irreversible pide confirmación; lo reversible se hace al instante y se puede deshacer."
        pie={
          <>
            <button type="button" className="boton-texto" onClick={() => setDialogo(false)}>Cancelar</button>
            <button type="button" className="boton" onClick={() => { setDialogo(false); setAviso({ mensaje: "Listo, quedó confirmada" }); }}>Confirmar</button>
          </>
        }
      />
      <PanelDetalle
        abierto={detalle !== null}
        alCerrar={() => {
          setCierres((n) => n + 1);
          setDetalle(null);
        }}
        titulo={detalle ?? ""}
        contexto="Detalle de ejemplo"
      >
        <p className="lede">El panel lateral muestra el detalle sin salir de la lista.</p>
      </PanelDetalle>
      <p className="pista" data-cierres={cierres}>
        Cierres avisados por el diálogo y el panel: {cierres}
      </p>
      <AvisoInferior mensaje={aviso?.mensaje ?? null} alDeshacer={aviso?.deshacer} alTerminar={terminar} />
    </div>
  );
}
