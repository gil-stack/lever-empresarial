"use client";

import { useState } from "react";

import { EtiquetaMono, Frase, Renglon, Renglones } from "@/components/sistema";
import { presentarClabe } from "@/dominio/clabe-proveedor";

/** Lectura en la consola. No guarda y no envía dinero. */
export function LecturaClabe() {
  const [valor, setValor] = useState("");
  const lectura = valor.trim() === "" ? null : presentarClabe(valor);

  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <div className="campo">
        <label htmlFor="lectura-clabe">CLABE</label>
        <input
          id="lectura-clabe"
          name="lectura"
          value={valor}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          className="entrada-rfc"
          aria-invalid={lectura && !lectura.ok ? true : undefined}
          aria-describedby="pista-lectura lectura-resultado"
          onChange={(event) => setValor(event.target.value)}
        />
        <p className="pista" id="pista-lectura">
          18 dígitos. El verificador usa la ponderación 3, 7 y 1. Esta lectura no se guarda.
        </p>
      </div>
      <div id="lectura-resultado" aria-live="polite">
        {lectura?.ok ? <Resultado visible={lectura.clabe.visible} institucion={lectura.clabe.institucion} /> : null}
        {lectura && !lectura.ok ? (
          <p className="error-campo">Esa CLABE no cierra. El dígito usa la ponderación 3, 7 y 1.</p>
        ) : null}
      </div>
    </form>
  );
}

function Resultado({
  visible,
  institucion,
}: {
  visible: string;
  institucion: { conocida: true; nombre: string } | { conocida: false; frase: string };
}) {
  return (
    <>
      <EtiquetaMono nombre="CLABE">{visible}</EtiquetaMono>
      {institucion.conocida ? (
        <Renglones>
          <Renglon etiqueta="Banco">{institucion.nombre}</Renglon>
        </Renglones>
      ) : (
        <Frase>{institucion.frase}</Frase>
      )}
    </>
  );
}
