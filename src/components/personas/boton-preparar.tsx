"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";

import { enviarPreparacionNomina } from "@/app/consola/personas/acciones";
import { BotonEnviar } from "@/components/sistema";
import { ESTADO_MAESTRO_INICIAL, fechaLarga, type EstadoMaestro } from "@/dominio/personas";
import { enEmpresa } from "@/nucleo/rutas";

import { AvisosFormulario } from "./estado-formulario";

/**
 * La fecha la calcula el servidor; el botón solo confirma la que se ve. Al
 * terminar abre el lote desde la acción misma: en Aprobaciones la fila del
 * botón desaparece en el mismo cuadro en que llega la respuesta y un efecto ya
 * no correría.
 */
export function BotonPrepararNomina({
  empresaId,
  fechaPago,
}: {
  empresaId: string;
  fechaPago: string | null;
}) {
  const habilitado = fechaPago !== null;
  const router = useRouter();
  const [estado, accion, pendiente] = useActionState(async (previo: EstadoMaestro, datos: FormData) => {
    const resultado = await enviarPreparacionNomina(previo, datos);
    if (resultado.tipo === "listo" && resultado.id) router.push(enEmpresa(empresaId, `/consola/personas/nomina/${resultado.id}`));
    return resultado;
  }, ESTADO_MAESTRO_INICIAL);
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
