"use client";

import "@/estilo/muestrario-escenas.css";

import { useState } from "react";
import { createPortal } from "react-dom";

import { acentoPorTema, ESCENAS, TEMAS, TONOS, CLAVES_TONO } from "./catalogo";
import { FondoEscena } from "./fondo-escena";
import { guardarPreferencias, leerPreferencias, type PreferenciasApariencia } from "./preferencias";

/** Prueba visual del motor de escenas para el muestrario (no existe en producción). */
export function MuestrarioEscenas() {
  const [ajustes, setAjustes] = useState<PreferenciasApariencia | null>(null);

  const cambiar = (cambio: Partial<PreferenciasApariencia>) => {
    if (!ajustes) return;
    const siguiente = { ...ajustes, ...cambio };
    setAjustes(siguiente);
    guardarPreferencias(siguiente);
  };

  const escena = ESCENAS.find((e) => e.clave === ajustes?.escena) ?? ESCENAS[0];
  const acento = ajustes ? acentoPorTema(ajustes.tema, ajustes.tono, ajustes.colorPropio) : null;

  return (
    <>
      <p>
        Los seis fondos animados de la plataforma, pintados por el motor WebGL2. La elección se guarda en este
        navegador.
      </p>
      <div className="acciones">
        <button type="button" className="boton" onClick={() => setAjustes(leerPreferencias())}>
          Ver escenas
        </button>
      </div>
      {ajustes && acento
        ? createPortal(
            <div className="muestrario-escenas">
              <FondoEscena
                escena={ajustes.escena}
                tono={ajustes.tono}
                tema={ajustes.tema}
                movimiento={ajustes.movimiento}
                luzDinamica={ajustes.luzDinamica}
                colorPropio={ajustes.colorPropio}
              />
              <section className="muestrario-escenas-panel" aria-label="Apariencia">
                <header className="muestrario-escenas-cabeza">
                  <div>
                    <h2>{escena.nombre}</h2>
                    <p>{escena.descripcion}</p>
                  </div>
                  <button type="button" className="boton-texto" onClick={() => setAjustes(null)}>
                    Cerrar
                  </button>
                </header>

                <fieldset>
                  <legend>Fondo</legend>
                  {ESCENAS.map((e) => (
                    <button
                      key={e.clave}
                      type="button"
                      className="boton-texto"
                      aria-pressed={ajustes.escena === e.clave}
                      onClick={() => cambiar({ escena: e.clave })}
                    >
                      {e.nombre}
                    </button>
                  ))}
                </fieldset>

                <fieldset>
                  <legend>Tema</legend>
                  {TEMAS.map((t) => (
                    <button
                      key={t.clave}
                      type="button"
                      className="boton-texto"
                      aria-pressed={ajustes.tema === t.clave}
                      onClick={() => cambiar({ tema: t.clave })}
                    >
                      {t.nombre}
                    </button>
                  ))}
                </fieldset>

                <fieldset>
                  <legend>Paleta</legend>
                  {CLAVES_TONO.map((clave) => (
                    <button
                      key={clave}
                      type="button"
                      className="boton-texto"
                      aria-pressed={ajustes.tono === clave}
                      onClick={() => cambiar({ tono: clave })}
                    >
                      {TONOS[clave].nombre}
                    </button>
                  ))}
                  {ajustes.tono === "mio" ? (
                    <label className="muestrario-escenas-color">
                      <input
                        type="color"
                        value={ajustes.colorPropio ?? TONOS.mio.colores[2]}
                        onChange={(evento) => cambiar({ colorPropio: evento.target.value.toUpperCase() })}
                      />
                      Elegir tu color
                    </label>
                  ) : null}
                </fieldset>

                <fieldset className="opciones">
                  <legend>Movimiento</legend>
                  <label className="confirmacion">
                    <input
                      type="checkbox"
                      checked={ajustes.movimiento}
                      onChange={(evento) => cambiar({ movimiento: evento.target.checked })}
                    />
                    <span>Fondo animado</span>
                  </label>
                  <label className="confirmacion">
                    <input
                      type="checkbox"
                      checked={ajustes.luzDinamica}
                      onChange={(evento) => cambiar({ luzDinamica: evento.target.checked })}
                    />
                    <span>La luz sigue al cursor</span>
                  </label>
                </fieldset>

                <p className="muestrario-escenas-acento">
                  <span
                    className="muestrario-escenas-muestra"
                    style={{ background: acento.acento, color: acento.tinta }}
                    data-acento={acento.acento}
                  >
                    Aa
                  </span>
                  Acento del tema: {acento.acento}
                </p>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
