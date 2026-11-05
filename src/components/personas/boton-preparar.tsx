"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { enviarPreparacionNomina } from "@/app/consola/personas/acciones";
import { ESTADO_MAESTRO_INICIAL } from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";

import { AvisosFormulario } from "./estado-formulario";

export function BotonPrepararNomina({
  empresaId,
  fechaPago,
  habilitado,
}: {
  empresaId: string;
  fechaPago: string | null;
  habilitado: boolean;
}) {
  const router = useRouter();
  const [estado, accion, pendiente] = useActionState(enviarPreparacionNomina, ESTADO_MAESTRO_INICIAL);
  useEffect(() => {
    if (estado.tipo === "listo" && estado.id) router.push(enEmpresa(empresaId, `/consola/personas/nomina/${estado.id}`));
  }, [empresaId, estado, router]);
  return (
    <form action={accion} aria-busy={pendiente}>
      <input type="hidden" name="fechaPago" value={fechaPago ?? ""} />
      <AvisosFormulario estado={estado} errores={estado.tipo === "invalido" ? estado.errores : []} />
      <button className="boton" type="submit" disabled={!habilitado || pendiente}>
        {pendiente ? "Preparando…" : "Preparar nómina vencida"}
      </button>
      {!habilitado ? <p className="pista">Se habilita cuando llega la próxima fecha.</p> : null}
    </form>
  );
}
