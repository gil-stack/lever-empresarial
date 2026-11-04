import type { LecturaSuscripcion, TarifaVisible } from "@/dominio/precio";

/** La empresa solo lee su suscripción. La aceptación la registra el personal del operador. */
export function SuscripcionEmpresa({ tarifa, lectura }: { tarifa: TarifaVisible; lectura: LecturaSuscripcion }) {
  if (lectura.tipo === "sin_empresa") return null;

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
      {lectura.tipo === "lista" && lectura.estado === "recorrido" && !tarifa.suscripcionPublicada ? (
        <p className="nota-saldos">El paso a aceptada espera a que el monto esté publicado.</p>
      ) : null}
      {lectura.tipo === "lista" && lectura.estado === "recorrido" && tarifa.suscripcionPublicada ? (
        <p className="nota-saldos">La plataforma lo registra cuando la empresa acepta el monto.</p>
      ) : null}
    </section>
  );
}
