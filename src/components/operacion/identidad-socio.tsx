"use client";

import { useState, type ReactNode } from "react";

type Ligado = Record<string, unknown>;

/**
 * Tipo de persona, nacionalidad y cómo se identifica el socio. La persona física
 * mexicana lleva su CURP; la extranjera sin CURP, su país, el número de su pasaporte
 * o identificación oficial y su fecha de nacimiento. Lo que no aplica no se envía.
 */
export function IdentidadDelSocio({
  paises,
  ligados,
  children,
}: {
  paises: ReadonlyArray<{ codigo: string; nombre: string }>;
  ligados: { curp: Ligado; pais: Ligado; documentoExtranjero: Ligado; fechaNacimiento: Ligado };
  children: ReactNode;
}) {
  const [tipo, setTipo] = useState<"fisica" | "moral">("fisica");
  const [extranjera, setExtranjera] = useState(false);
  return (
    <>
      <div className="campo">
        <label htmlFor="acc-tipo">Tipo de persona</label>
        <select id="acc-tipo" name="tipoPersona" value={tipo} onChange={(evento) => setTipo(evento.target.value === "moral" ? "moral" : "fisica")}>
          <option value="fisica">Persona física</option>
          <option value="moral">Persona moral</option>
        </select>
      </div>
      <div className="campo">
        <label htmlFor="acc-nacionalidad">Nacionalidad</label>
        <select id="acc-nacionalidad" value={extranjera ? "extranjera" : "mexicana"} onChange={(evento) => setExtranjera(evento.target.value === "extranjera")}>
          <option value="mexicana">Mexicana</option>
          <option value="extranjera">Extranjera</option>
        </select>
      </div>
      {children}
      {extranjera ? (
        <div className="campo">
          <label htmlFor="acc-pais">País</label>
          <select id="acc-pais" name="pais" required defaultValue="" {...ligados.pais}>
            <option value="" disabled>
              Elige el país
            </option>
            {paises.map((pais) => (
              <option key={pais.codigo} value={pais.codigo}>
                {pais.nombre}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {tipo === "fisica" && !extranjera ? (
        <div className="campo">
          <label htmlFor="acc-curp">CURP</label>
          <input id="acc-curp" name="curp" maxLength={18} autoCapitalize="characters" {...ligados.curp} />
        </div>
      ) : null}
      {tipo === "fisica" && extranjera ? (
        <>
          <div className="campo">
            <label htmlFor="acc-documento">Número de pasaporte o identificación oficial</label>
            <input
              id="acc-documento"
              name="documentoExtranjero"
              maxLength={30}
              autoCapitalize="characters"
              aria-describedby="acc-documento-pista"
              {...ligados.documentoExtranjero}
            />
            <p id="acc-documento-pista" className="pista">
              Sin CURP, la persona extranjera se identifica con su país, este número y su fecha de nacimiento.
            </p>
          </div>
          <div className="campo">
            <label htmlFor="acc-nacimiento">Fecha de nacimiento</label>
            <input id="acc-nacimiento" name="fechaNacimiento" type="date" {...ligados.fechaNacimiento} />
          </div>
        </>
      ) : null}
    </>
  );
}
