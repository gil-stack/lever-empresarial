"use client";

import { actualizarPlanAccion, asignarPlanAccion } from "@/app/operacion/acciones";
import { BotonEnviar } from "@/components/sistema";
import { pesosParaCampo } from "@/dominio/operacion/planes";

import { useFormularioConAviso } from "./formulario-con-aviso";

type Plan = { id: string; nivel: number; nombre: string; mensualidadCentavos: number; speiCentavos: number };

/** Nombre, mensualidad y costo por SPEI de un plan. Los montos se escriben en pesos. */
export function FormularioPlan({ plan }: { plan: Plan }) {
  const idAviso = `aviso-plan-${plan.nivel}`;
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(actualizarPlanAccion, idAviso);
  const id = (campo: string) => `plan-${plan.nivel}-${campo}`;
  return (
    <form key={vuelta} ref={forma} action={enviar} className="plan-formulario" aria-label={`Plan ${plan.nivel}`}>
      {resumen}
      <input type="hidden" name="id" value={plan.id} />
      <div className="campo">
        <label htmlFor={id("nombre")}>Nombre</label>
        {mensaje("nombre")}
        <input id={id("nombre")} name="nombre" required maxLength={60} defaultValue={valor("nombre", plan.nombre)} {...ligado("nombre")} />
      </div>
      <div className="campo">
        <label htmlFor={id("mensualidad")}>Mensualidad (pesos)</label>
        {mensaje("mensualidad")}
        <input
          id={id("mensualidad")}
          name="mensualidad"
          inputMode="decimal"
          required
          defaultValue={valor("mensualidad", pesosParaCampo(plan.mensualidadCentavos))}
          {...ligado("mensualidad")}
        />
      </div>
      <div className="campo">
        <label htmlFor={id("spei")}>Costo por SPEI (pesos)</label>
        {mensaje("spei")}
        <input
          id={id("spei")}
          name="spei"
          inputMode="decimal"
          required
          defaultValue={valor("spei", pesosParaCampo(plan.speiCentavos))}
          {...ligado("spei")}
        />
      </div>
      <div className="acciones">
        <BotonEnviar className="boton boton-secundario">Guardar plan</BotonEnviar>
      </div>
    </form>
  );
}

/** Elegir el plan de un cliente. Si ya tenía uno, lo reemplaza. */
export function FormularioAsignarPlan({
  clientes,
  planes,
}: {
  clientes: { id: string; nombre: string; planId: string | null }[];
  planes: { id: string; nombre: string }[];
}) {
  const { forma, enviar, vuelta, valor, ligado, mensaje, resumen } = useFormularioConAviso(asignarPlanAccion, "aviso-asignar-plan");
  const cliente = clientes.some((opcion) => opcion.id === valor("companyId")) ? valor("companyId") : undefined;
  const plan = planes.some((opcion) => opcion.id === valor("planId")) ? valor("planId") : undefined;
  return (
    <form key={vuelta} ref={forma} action={enviar}>
      {resumen}
      <div className="campo">
        <label htmlFor="asignar-companyId">Cliente</label>
        {mensaje("companyId")}
        <select id="asignar-companyId" name="companyId" required defaultValue={cliente} {...ligado("companyId")}>
          {clientes.map((opcion) => (
            <option key={opcion.id} value={opcion.id}>
              {opcion.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="asignar-planId">Plan</label>
        <select id="asignar-planId" name="planId" required defaultValue={plan}>
          {planes.map((opcion) => (
            <option key={opcion.id} value={opcion.id}>
              {opcion.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="acciones">
        <BotonEnviar>Asignar plan</BotonEnviar>
      </div>
    </form>
  );
}
