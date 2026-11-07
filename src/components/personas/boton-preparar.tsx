"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { enviarPreparacionNomina } from "@/app/consola/personas/acciones";
import { BotonEnviar } from "@/components/sistema";
import { ESTADO_MAESTRO_INICIAL, fechaLarga } from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";

import { AvisosFormulario } from "./estado-formulario";

/** La fecha la calcula el servidor; el botón solo confirma la que se ve. */
export function BotonPrepararNomina({
  empresaId,
  fechaPago,
}: {
  empresaId: string;
  fechaPago: string | null;
}) {
  const habilitado = fechaPago !== null;
  const router = useRouter();
  const [estado, accion, pendiente] = useActionState(enviarPreparacionNomina, ESTADO_MAESTRO_INICIAL);
  useEffect(() => {
    if (estado.tipo === "listo" && estado.id) router.push(enEmpresa(empresaId, `/consola/personas/nomina/${estado.id}`));
  }, [empresaId, estado, router]);
  return (
    <form className="preparar-nomina" action={accion} aria-busy={pendiente}>
      <input type="hidden" name="fechaPago" value={fechaPago ?? ""} />
      <AvisosFormulario estado={estado} errores={estado.tipo === "invalido" ? estado.errores : []} />
      <BotonEnviar pendiente={pendiente} enviando="Preparando…" disabled={!habilitado} aria-describedby={habilitado ? undefined : "preparar-pista"}>
        {fechaPago ? `Preparar nómina del ${fechaLarga(fechaPago)}` : "Preparar nómina vencida"}
      </BotonEnviar>
      {!habilitado ? <p className="pista" id="preparar-pista">Se habilita cuando llega la próxima fecha.</p> : null}
    </form>
  );
}
