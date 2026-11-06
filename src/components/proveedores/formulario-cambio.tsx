"use client";

import { useState } from "react";
import { useActionState } from "react";

import { guardarClabeProveedor } from "@/app/consola/proveedores/acciones";
import { FORMULARIO_CLABE_INICIAL, type EstadoClabe } from "@/app/consola/proveedores/estado";
import { Aviso, BotonEnviar, EtiquetaMono, Renglon, Renglones } from "@/components/sistema";
import { FRASE_INSTITUCION_PENDIENTE, presentarClabe } from "@/dominio/clabe-proveedor";

export function FormularioCambio({ supplierId }: { supplierId: string }) {
  const [estado, accion, pendiente] = useActionState(guardarClabeProveedor, FORMULARIO_CLABE_INICIAL);
  const [valor, setValor] = useState("");
  const digitos = valor.replace(/\D/g, "");
  const lectura = digitos.length >= 18 ? presentarClabe(valor) : null;
  const noCierra = lectura !== null && !lectura.ok;
  const campo = `clabe-nueva-${supplierId}`;
  const error = noCierra ? "Esa CLABE no cierra. El dígito usa la ponderación 3, 7 y 1." : estado.tipo === "invalido" ? estado.mensaje : null;

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
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${campo}-pista ${campo}-error` : `${campo}-pista`}
          onChange={(event) => setValor(event.target.value)}
        />
        <p className="pista" id={`${campo}-pista`}>
          La anterior se queda en el historial.
        </p>
        {error ? (
          <p className="error-campo" id={`${campo}-error`}>
            {error}
          </p>
        ) : null}
      </div>
      {lectura?.ok ? (
        <>
          <EtiquetaMono nombre="CLABE">{lectura.clabe.visible}</EtiquetaMono>
          <Renglones>
            <Renglon etiqueta="Institución">
              {lectura.clabe.institucion.conocida
                ? lectura.clabe.institucion.nombre
                : FRASE_INSTITUCION_PENDIENTE}
            </Renglon>
          </Renglones>
        </>
      ) : null}
      <div className="acciones">
        <BotonEnviar pendiente={pendiente}>Guardar la CLABE</BotonEnviar>
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
  if (estado.tipo === "guardado_sin_aviso") {
    return (
      <Aviso tono="revisar" titulo="Quedó asentada, sin aviso por correo">
        <p>{estado.mensaje}</p>
      </Aviso>
    );
  }
  // El error va junto al campo, ligado con aria-describedby.
  return null;
}
