"use client";

import { useState } from "react";
import { useActionState } from "react";

import { guardarClabeProveedor } from "@/app/consola/proveedores/acciones";
import { FORMULARIO_CLABE_INICIAL, type EstadoClabe } from "@/app/consola/proveedores/estado";
import { Aviso, EtiquetaMono, Frase, Renglon, Renglones } from "@/components/sistema";
import { presentarClabe } from "@/dominio/clabe-proveedor";

export function FormularioCambio({ supplierId }: { supplierId: string }) {
  const [estado, accion, pendiente] = useActionState(guardarClabeProveedor, FORMULARIO_CLABE_INICIAL);
  const [valor, setValor] = useState("");
  const lectura = valor.trim() === "" ? null : presentarClabe(valor);
  const campo = `clabe-nueva-${supplierId}`;

  return (
    <form action={accion} noValidate>
      <AvisoDeEstado estado={estado} />
      <input type="hidden" name="supplierId" value={supplierId} />
      <div className="campo">
        <label htmlFor={campo}>Nueva CLABE</label>
        <input
          id={campo}
          name="clabe"
          value={valor}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          className="entrada-rfc"
          aria-invalid={estado.tipo === "invalido" || (lectura && !lectura.ok) ? true : undefined}
          aria-describedby={`${campo}-pista`}
          onChange={(event) => setValor(event.target.value)}
        />
        <p className="pista" id={`${campo}-pista`}>
          La anterior se queda en el historial. No se envía dinero.
        </p>
      </div>
      {lectura?.ok ? (
        lectura.clabe.institucion.conocida ? (
          <>
            <EtiquetaMono nombre="CLABE">{lectura.clabe.visible}</EtiquetaMono>
            <Renglones>
              <Renglon etiqueta="Banco">{lectura.clabe.institucion.nombre}</Renglon>
            </Renglones>
          </>
        ) : (
          <>
            <EtiquetaMono nombre="CLABE">{lectura.clabe.visible}</EtiquetaMono>
            <Frase>{lectura.clabe.institucion.frase}</Frase>
          </>
        )
      ) : null}
      <div className="acciones">
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? "Guardando…" : "Guardar la CLABE"}
        </button>
      </div>
    </form>
  );
}

function AvisoDeEstado({ estado }: { estado: EstadoClabe }) {
  if (estado.tipo === "inicial") return null;
  if (estado.tipo === "guardado") {
    return (
      <Aviso tono="asentado" titulo="Quedó asentada">
        <p>{estado.mensaje}</p>
      </Aviso>
    );
  }
  return (
    <Aviso tono="revisar" titulo="No se guardó">
      <p>{estado.mensaje}</p>
    </Aviso>
  );
}
