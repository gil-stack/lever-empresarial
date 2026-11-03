import { existePasoAceptada, type LecturaSuscripcion, type TarifaVisible } from "@/dominio/precio";

import { FormularioAceptar } from "./formulario-aceptar";

export function SuscripcionEmpresa({
  tarifa,
  lectura,
  esOperador,
}: {
  tarifa: TarifaVisible;
  lectura: LecturaSuscripcion;
  esOperador: boolean;
}) {
  if (lectura.tipo === "sin_empresa") return null;

  const estado = lectura.tipo === "lista" ? lectura.estado : null;
  const paso = existePasoAceptada({
    esOperador,
    montoPublicado: tarifa.disponible && tarifa.suscripcionPublicada,
    estado,
  });

  return (
    <section className="recorrido" aria-labelledby="recorrido-titulo">
      <h2 id="recorrido-titulo">Suscripción de esta empresa</h2>
      {lectura.tipo === "lista" ? (
        <>
          <p className="frase">{lectura.titulo}</p>
          <p className="nota-saldos">{lectura.relato}</p>
        </>
      ) : (
        <p className="nota-saldos">
          {lectura.tipo === "ausente"
            ? "No se encontró la suscripción de esta empresa."
            : "No se pudo consultar la suscripción de esta empresa."}
        </p>
      )}
      {paso ? <FormularioAceptar /> : null}
      {lectura.tipo === "lista" && lectura.estado === "recorrido" && !tarifa.suscripcionPublicada ? (
        <p className="nota-saldos">El paso a aceptada espera a que el monto esté publicado.</p>
      ) : null}
      {lectura.tipo === "lista" && lectura.estado === "recorrido" && tarifa.suscripcionPublicada && !esOperador ? (
        <p className="nota-saldos">El operador de la plataforma lo registra cuando el cliente acepta el monto.</p>
      ) : null}
    </section>
  );
}
