"use client";

import { useState, type ReactNode } from "react";

type Ligado = Record<string, unknown>;

/** Une la pista del campo con el aviso del error: el lector de pantalla anuncia las dos. */
function conPista(ligado: Ligado, pista: string): Ligado {
  const delAviso = typeof ligado["aria-describedby"] === "string" ? ligado["aria-describedby"] : "";
  return { ...ligado, "aria-describedby": [pista, delAviso].filter(Boolean).join(" ") };
}

/**
 * Tipo de persona, nacionalidad y cómo se identifica el socio. La persona física
 * mexicana lleva su CURP y la moral mexicana su RFC. La extranjera lleva su país y el
 * número de su pasaporte o identificación oficial con su fecha de nacimiento (física)
 * o de su registro en su país (moral); el RFC, si lo tiene. Lo que no aplica no se
 * envía. Tras un rechazo de un dato de la extranjera, el formulario vuelve en
 * «Extranjera» con ese campo marcado.
 */
export function IdentidadDelSocio({
  paises,
  ligados,
  tipoInicial,
  children,
}: {
  paises: ReadonlyArray<{ codigo: string; nombre: string }>;
  ligados: { rfc: Ligado; curp: Ligado; pais: Ligado; documentoExtranjero: Ligado; fechaNacimiento: Ligado };
  tipoInicial: "fisica" | "moral";
  children: ReactNode;
}) {
  const conError = (ligado: Ligado) => Object.keys(ligado).length > 0;
  const [tipo, setTipo] = useState<"fisica" | "moral">(tipoInicial);
  const [extranjera, setExtranjera] = useState(
    conError(ligados.pais) || conError(ligados.documentoExtranjero) || conError(ligados.fechaNacimiento),
  );
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
      <div className="campo">
        <label htmlFor="acc-rfc">{extranjera ? "RFC en México (si tiene)" : "RFC"}</label>
        <input id="acc-rfc" name="rfc" maxLength={13} autoCapitalize="characters" className="entrada-rfc" {...ligados.rfc} />
      </div>
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
      {extranjera ? (
        <div className="campo">
          <label htmlFor="acc-documento">
            {tipo === "fisica" ? "Número de pasaporte o identificación oficial" : "Número de identificación fiscal o de registro en su país"}
          </label>
          <input
            id="acc-documento"
            name="documentoExtranjero"
            maxLength={30}
            required
            autoCapitalize="characters"
            {...conPista(ligados.documentoExtranjero, "acc-documento-pista")}
          />
          <p id="acc-documento-pista" className="pista">
            {tipo === "fisica"
              ? "La persona extranjera se identifica con su país, este número y su fecha de nacimiento."
              : "La persona moral extranjera se identifica con su país y este número; el RFC es opcional."}
          </p>
        </div>
      ) : null}
      {tipo === "fisica" && extranjera ? (
        <div className="campo">
          <label htmlFor="acc-nacimiento">Fecha de nacimiento</label>
          <input id="acc-nacimiento" name="fechaNacimiento" type="date" required {...ligados.fechaNacimiento} />
        </div>
      ) : null}
    </>
  );
}
