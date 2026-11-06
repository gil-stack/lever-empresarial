"use client";

import "@/estilo/apariencia.css";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Interruptor } from "@/components/sistema/superficies";

import {
  CLAVES_TONO,
  ESCENAS,
  TEMAS,
  TONOS,
  type ClaveEscena,
  type ClaveTema,
  type ClaveTono,
} from "./catalogo";
import { FondoEscena } from "./fondo-escena";
import type { PreferenciasApariencia } from "./preferencias";
import { fijarTema, guardarApariencia, useApariencia } from "./viva";

/** Aluminio no se elige: es el Papel Lever del tema claro (así lo oculta el diseño). */
const TONOS_VISIBLES = CLAVES_TONO.filter((clave) => clave !== "aluminio");

/** La bolita de cada tono, como `palCss` del diseño. */
function muestraDelTono(clave: ClaveTono, colorPropio?: string): string {
  const c = TONOS[clave].colores;
  if (clave === "mio") {
    return `radial-gradient(circle, ${colorPropio ?? c[2]} 0 34%, transparent 36%), conic-gradient(#FF5A4E, #FFB347, #E9E36B, #3CC48F, #4FA3FF, #8A6CFF, #FF5AC8, #FF5A4E)`;
  }
  if (clave === "blanco") {
    return "radial-gradient(circle at 32% 28%, #FFFFFF 0%, #F7F5F2 38%, #E4E0DB 72%, #C9C4BE 100%)";
  }
  return `radial-gradient(circle at 32% 28%, ${c[3]} 0%, ${c[2]} 28%, ${c[1]} 62%, ${c[0]} 100%)`;
}

/** Una escena pintada por el motor real, quieta, para elegirla. */
function MiniaturaEscena({ escena, tema, tono, colorPropio }: { escena: ClaveEscena; tema: ClaveTema; tono: ClaveTono; colorPropio?: string }) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let vigente = true;
    import("./motor")
      .then((motor) => {
        const lienzo = lienzoRef.current;
        const contexto = lienzo?.getContext("2d");
        if (!vigente || !lienzo || !contexto) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2) * 0.85;
        const ancho = Math.max(2, Math.round(lienzo.offsetWidth * dpr));
        const alto = Math.max(2, Math.round(lienzo.offsetHeight * dpr));
        lienzo.width = ancho;
        lienzo.height = alto;
        motor.pintar(contexto, ancho, alto, { escena, tema, tono, colorPropio, luz: [-0.3, -0.8], tiempo: 4 });
        lienzo.dataset.pintada = "si";
      })
      .catch((error: unknown) => console.warn("No se pudo pintar la miniatura:", error));
    return () => {
      vigente = false;
    };
  }, [escena, tema, tono, colorPropio]);

  return <canvas ref={lienzoRef} className="miniatura-lienzo" aria-hidden="true" />;
}

/** La vista de Apariencia del diseño: vista previa, tema, movimiento, fondo y paleta. */
export function PanelApariencia({ persona, tema: temaInicial, empresa }: { persona?: string; tema: ClaveTema; empresa: string | null }) {
  const ajustes = useApariencia(persona, temaInicial);
  const [sinGuardar, setSinGuardar] = useState(false);
  const escena = ESCENAS.find((e) => e.clave === ajustes.escena) ?? ESCENAS[0];

  function cambiar(cambio: Partial<PreferenciasApariencia>) {
    const siguiente = { ...ajustes, ...cambio };
    if (cambio.tema && cambio.tema !== ajustes.tema) fijarTema(cambio.tema);
    setSinGuardar(!guardarApariencia(siguiente, persona));
  }

  return (
    <div className="apariencia" data-tema-elegido={ajustes.tema}>
      <div className="apariencia-arriba">
        <section className="panel" aria-labelledby="apariencia-previa">
          <header className="panel-cabeza">
            <h2 id="apariencia-previa">Vista previa</h2>
            <small>Así se ve detrás de tus números</small>
          </header>
          <div className="ap-previa">
            <FondoEscena
              escena={ajustes.escena}
              tono={ajustes.tono}
              tema={ajustes.tema}
              movimiento={ajustes.movimiento}
              luzDinamica={ajustes.luzDinamica}
              colorPropio={ajustes.colorPropio}
            />
            <div className="ap-previa-texto">
              <div>
                <small>Tu empresa</small>
                <b>{empresa ?? "Lever Empresas"}</b>
              </div>
              <div className="ap-previa-escena">
                <b>{escena.nombre}</b>
                <small>{escena.descripcion}</small>
              </div>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="apariencia-tema">
          <header className="panel-cabeza">
            <h2 id="apariencia-tema">Tema</h2>
          </header>
          <div className="temas" role="group" aria-labelledby="apariencia-tema">
            {TEMAS.map((t) => (
              <button
                key={t.clave}
                type="button"
                className="tema"
                aria-pressed={ajustes.tema === t.clave}
                onClick={() => cambiar({ tema: t.clave })}
              >
                <i
                  style={{
                    background: `linear-gradient(135deg, ${t.muestra[0]} 0 55%, ${t.muestra[1]} 55% 100%)`,
                    boxShadow: `inset 0 -14px 0 -10px ${t.muestra[2]}`,
                  }}
                />
                <b>{t.nombre}</b>
              </button>
            ))}
          </div>
          <header className="panel-cabeza panel-cabeza-segunda">
            <h2 id="apariencia-movimiento">Movimiento</h2>
          </header>
          <div className="ajuste">
            <div>
              <b>La luz sigue al cursor</b>
              <small>El reflejo del fondo se mueve contigo.</small>
            </div>
            <Interruptor etiqueta="La luz sigue al cursor" encendido={ajustes.luzDinamica} alCambiar={(luzDinamica) => cambiar({ luzDinamica })} />
          </div>
          <div className="ajuste">
            <div>
              <b>Fondo animado</b>
              <small>Si lo apagas, el fondo queda quieto y gasta menos batería.</small>
            </div>
            <Interruptor etiqueta="Fondo animado" encendido={ajustes.movimiento} alCambiar={(movimiento) => cambiar({ movimiento })} />
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="apariencia-fondo">
        <header className="panel-cabeza">
          <h2 id="apariencia-fondo">Fondo</h2>
          <small>Los mismos acabados que la app</small>
        </header>
        <div className="escenas">
          {ESCENAS.map((e) => (
            <button
              key={e.clave}
              type="button"
              className="escena"
              aria-pressed={ajustes.escena === e.clave}
              aria-label={`Fondo ${e.nombre}`}
              onClick={() => cambiar({ escena: e.clave })}
            >
              <MiniaturaEscena escena={e.clave} tema={ajustes.tema} tono={ajustes.tono} colorPropio={ajustes.colorPropio} />
              <span aria-hidden="true">{e.nombre}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel paleta" aria-labelledby="apariencia-paleta">
        <header className="panel-cabeza">
          <h2 id="apariencia-paleta">Paleta</h2>
          <small>Colorea el fondo y los botones principales</small>
        </header>
        <div className="tonos">
          {TONOS_VISIBLES.map((clave) =>
            clave === "mio" ? (
              <label key={clave} className="tono" data-elegido={ajustes.tono === "mio" ? "si" : "no"}>
                <input
                  type="color"
                  className="solo-lector"
                  aria-label="Elige tu color"
                  value={ajustes.colorPropio ?? TONOS.mio.colores[2]}
                  onChange={(evento) => cambiar({ tono: "mio", colorPropio: evento.target.value.toUpperCase() })}
                />
                <i style={{ background: muestraDelTono(clave, ajustes.colorPropio) } as CSSProperties} />
                {TONOS[clave].nombre}
              </label>
            ) : (
              <button
                key={clave}
                type="button"
                className="tono"
                aria-pressed={ajustes.tono === clave}
                onClick={() => cambiar({ tono: clave })}
              >
                <i style={{ background: muestraDelTono(clave) }} />
                {TONOS[clave].nombre}
              </button>
            ),
          )}
        </div>
      </section>

      <p className="nota-fina nota-lever">
        En el tema Lever eliges el fondo y el color es el coral de Lever. Elige Claro u Oscuro para cambiar también la paleta.
      </p>
      <p className="nota-fina">Tu apariencia es solo tuya: se guarda en este navegador y no cambia la de nadie más.</p>
      {sinGuardar ? (
        <p className="nota-fina nota-aviso" role="status">
          Este navegador no deja guardar el fondo, la paleta ni el movimiento (por ejemplo, en modo privado). El tema sí cambió.
        </p>
      ) : null}
    </div>
  );
}
