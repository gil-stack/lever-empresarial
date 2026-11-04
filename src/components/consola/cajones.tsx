import Link from "next/link";

import { formatoPesos } from "@/dominio/centavos";
import { ledeCajones, type VistaCajones } from "@/dominio/politica";

export function Cajones({ vista, enlace = null }: { vista: VistaCajones; enlace?: string | null }) {
  return (
    <section className="saldos cajones" id="cajones" aria-labelledby="cajones-titulo">
      <h2 id="cajones-titulo">Cajones</h2>
      <p className="lede">{ledeCajones()}</p>
      <p className="edad">{vista.edad}</p>
      <dl>
        {vista.cajones.map((cajon) => (
          <div key={cajon.codigo}>
            <dt>{cajon.nombre}</dt>
            <dd>
              <p className="monto">{formatoPesos(cajon.saldoCentavos)}</p>
            </dd>
          </div>
        ))}
        <div>
          <dt>Sin cajón</dt>
          <dd>
            <p className="monto">{formatoPesos(vista.sinCajonCentavos)}</p>
            <p className="edad">Lo que todavía no tiene cajón.</p>
          </dd>
        </div>
      </dl>
      <p className="nota-saldos">
        El saldo de cada cajón es la suma de sus asientos. Estas cifras no se suman con el límite de la
        tarjeta ni reemplazan el saldo de la CLABE.
      </p>
      <p className="nota-saldos">El participante sigue sin consulta. Desde aquí no se dispersa ni se envía un SPEI.</p>
      {enlace ? (
        <Link className="enlace-texto" href={enlace}>
          Política de comprobantes
        </Link>
      ) : null}
    </section>
  );
}
