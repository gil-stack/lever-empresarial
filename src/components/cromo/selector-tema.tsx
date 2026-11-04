"use client";

import { useState } from "react";

import { IconoAuto, IconoLuna, IconoSol } from "./iconos";
import { COOKIE_TEMA, type Tema } from "./tema";

const OPCIONES = [
  { valor: "auto", etiqueta: "Sistema", Icono: IconoAuto },
  { valor: "claro", etiqueta: "Claro", Icono: IconoSol },
  { valor: "oscuro", etiqueta: "Oscuro", Icono: IconoLuna },
] as const;

function aplicarTema(valor: Tema) {
  const raiz = document.documentElement;
  if (valor === "auto") {
    delete raiz.dataset.tema;
    document.cookie = `${COOKIE_TEMA}=; path=/; max-age=0; samesite=lax`;
  } else {
    raiz.dataset.tema = valor;
    document.cookie = `${COOKIE_TEMA}=${valor}; path=/; max-age=31536000; samesite=lax`;
  }
}

export function SelectorTema({ inicial }: { inicial: Tema }) {
  const [tema, setTema] = useState<Tema>(inicial);

  function elegir(valor: Tema) {
    setTema(valor);
    aplicarTema(valor);
  }

  return (
    <fieldset className="selector-tema">
      <legend>Apariencia</legend>
      <div className="selector-tema-opciones">
        {OPCIONES.map(({ valor, etiqueta, Icono }) => (
          <label key={valor} title={etiqueta}>
            <input
              type="radio"
              name="tema"
              value={valor}
              checked={tema === valor}
              onChange={() => elegir(valor)}
            />
            <Icono />
            <span>{etiqueta}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
