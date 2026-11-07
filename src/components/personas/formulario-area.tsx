"use client";

import { useActionState, useEffect, useRef } from "react";

import { enviarCentro } from "@/app/consola/personas/acciones";
import { enviarSinReiniciar } from "@/components/proveedores/sin-reinicio";
import { BotonEnviar } from "@/components/sistema";
import { ESTADO_MAESTRO_INICIAL, type ErrorCampo } from "@/dominio/personas";
import type { CentroVista } from "@/dominio/personas-vista";

import { AvisosFormulario, CampoFormulario, descritoPor } from "./estado-formulario";

export function FormularioArea({ area }: { area?: CentroVista }) {
  const [estado, accion, pendiente] = useActionState(enviarCentro, ESTADO_MAESTRO_INICIAL);
  const forma = useRef<HTMLFormElement>(null);
  const prefijo = area ? `${area.id}-` : "";
  const errores: ErrorCampo[] = estado.tipo === "invalido" ? estado.errores : [];
  const mensaje = (campo: ErrorCampo["campo"]) => errores.find((error) => error.campo === campo)?.mensaje;

  useEffect(() => {
    if (!area && estado.tipo === "listo") forma.current?.reset();
  }, [area, estado]);

  return (
    // Sin el reinicio de `<form action>`: tras un error, el campo conserva lo que se escribió.
    <form ref={forma} className="formulario-pareja area-formulario" onSubmit={enviarSinReiniciar(accion)} noValidate aria-busy={pendiente}>
      {area ? <input type="hidden" name="centroId" value={area.id} /> : null}
      <div className="area-formulario-aviso"><AvisosFormulario estado={estado} errores={errores} prefijo={prefijo} /></div>
      <CampoFormulario id={`${prefijo}centroNombre`} etiqueta="Área" pista="También funciona como centro de costo." error={mensaje("centroNombre")}>
        <input
          id={`${prefijo}centroNombre`}
          name="centroNombre"
          defaultValue={area?.nombre ?? ""}
          maxLength={80}
          required
          aria-invalid={mensaje("centroNombre") ? true : undefined}
          aria-describedby={descritoPor(`${prefijo}centroNombre`, mensaje("centroNombre"))}
        />
      </CampoFormulario>
      <CampoFormulario id={`${prefijo}centroPresupuesto`} etiqueta="Presupuesto mensual" pista="En pesos MXN. Vacío significa sin asignar." error={mensaje("centroPresupuesto")}>
        <input
          id={`${prefijo}centroPresupuesto`}
          name="centroPresupuesto"
          defaultValue={area?.presupuestoCentavos == null ? "" : (area.presupuestoCentavos / 100).toFixed(2)}
          inputMode="decimal"
          placeholder="150000.00"
          aria-invalid={mensaje("centroPresupuesto") ? true : undefined}
          aria-describedby={descritoPor(`${prefijo}centroPresupuesto`, mensaje("centroPresupuesto"))}
        />
      </CampoFormulario>
      <label className="confirmacion area-tesoreria">
        <input type="checkbox" name="esTesoreria" value="si" defaultChecked={area?.esTesoreria ?? false} />
        <span>Es un área de tesorería. Sugerir acceso a la plataforma en nuevas altas.</span>
      </label>
      <div className="acciones">
        <BotonEnviar pendiente={pendiente} enviando="Guardando…">{area ? "Guardar área" : "Crear área"}</BotonEnviar>
      </div>
    </form>
  );
}
