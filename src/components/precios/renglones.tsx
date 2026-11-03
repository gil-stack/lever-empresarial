import { notaDeLosTreintaDias, type TarifaVisible } from "@/dominio/precio";

export function RenglonesTarifa({
  tarifa,
  ambito = "pagina",
}: {
  tarifa: TarifaVisible;
  ambito?: "pagina" | "consola";
}) {
  const ceros = [
    { id: "persona", etiqueta: "Por persona", monto: tarifa.porPersona },
    { id: "tarjeta", etiqueta: "Por tarjeta", monto: tarifa.porTarjeta },
    { id: "implementacion", etiqueta: "Implementación", monto: tarifa.implementacion },
  ];
  const suscripcionAusente = tarifa.disponible && !tarifa.suscripcionPublicada;

  return (
    <div className={ambito === "consola" ? "tarifa-bloque tarifa-consola" : "tarifa-bloque"}>
      <section className="tarifa" aria-labelledby="renglones-titulo">
        <h2 id="renglones-titulo">Lo que se cobra</h2>
        <p className="tarifa-moneda">Pesos mexicanos, con centavos.</p>
        <dl>
          <div>
            <dt>
              <span className="tarifa-indice">01</span>
              Suscripción mensual por empresa
              <span className="tarifa-detalle">
                Gasto, proveedores, dispersión de nómina, tarjetas sin tope de personas y la app. Mes a mes.
              </span>
              {tarifa.publicadaEl ? <span className="edad-precio">Publicada el {tarifa.publicadaEl}.</span> : null}
              {suscripcionAusente ? (
                <span className="edad-precio">El operador de la plataforma todavía no publica el monto.</span>
              ) : null}
            </dt>
            <dd>
              <p
                className={claseDeSuscripcion(tarifa)}
                data-suscripcion={
                  tarifa.suscripcionPublicada ? "publicada" : tarifa.disponible ? "vacia" : "sin-consulta"
                }
              >
                {tarifa.suscripcion}
              </p>
            </dd>
          </div>
          <div>
            <dt>
              <span className="tarifa-indice">02</span>
              Costo SPEI del participante
              <span className="tarifa-detalle">Renglón aparte. Esta plataforma no le suma un margen.</span>
              <span className="edad-precio">El monto del participante no está publicado.</span>
            </dt>
            <dd>
              <p className="cifra-ausente">{tarifa.spei}</p>
            </dd>
          </div>
        </dl>
      </section>
      <section className="ceros" aria-labelledby="ceros-titulo">
        <h2 id="ceros-titulo">Lo que queda en cero</h2>
        <dl>
          {ceros.map((renglon) => (
            <div key={renglon.id}>
              <dt>{renglon.etiqueta}</dt>
              <dd className="monto">{renglon.monto}</dd>
            </div>
          ))}
        </dl>
        <p className="nota-precio">
          No hay cupo de comprobantes, de facturas ni de personas. El alta es mes a mes.
        </p>
        {ambito === "pagina" ? <p className="nota-precio">{notaDeLosTreintaDias()}</p> : null}
      </section>
    </div>
  );
}

function claseDeSuscripcion(tarifa: TarifaVisible): string {
  if (!tarifa.disponible) return "frase";
  if (!tarifa.suscripcionPublicada) return "cifra-ausente";
  return "monto";
}
