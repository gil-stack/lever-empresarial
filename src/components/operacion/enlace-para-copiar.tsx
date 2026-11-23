"use client";

import { useState } from "react";

/**
 * El enlace de una invitación cuyo correo no salió. Se copia con un botón (o se selecciona a mano: el campo es de solo
 * lectura) para mandarlo por otro medio. Es de un solo uso y vence; reenviar la invitación lo anula.
 */
export function EnlaceParaCopiar({ enlace }: { enlace: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };
  return (
    <div className="alta-enlace" role="group" aria-labelledby="alta-enlace-titulo">
      <p id="alta-enlace-titulo" className="alta-enlace-titulo">
        Comparte la invitación a mano
      </p>
      <p className="pista">El correo no salió. Cópialo y mándaselo a la persona por otro medio. Sirve una sola vez y vence en 72 horas.</p>
      <div className="alta-enlace-fila">
        <input
          className="alta-enlace-campo"
          aria-label="Enlace de la invitación"
          readOnly
          value={enlace}
          onFocus={(evento) => evento.currentTarget.select()}
        />
        <button type="button" className="boton-secundario" onClick={copiar}>
          {copiado ? "Copiado" : "Copiar enlace"}
        </button>
      </div>
    </div>
  );
}
