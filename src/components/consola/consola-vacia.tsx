import Link from "next/link";

type EmpresaVisible = {
  rfc: string;
  razonSocial: string;
} | null;

export function ConsolaVacia({
  empresa,
  libroDisponible,
}: {
  empresa: EmpresaVisible;
  libroDisponible: boolean;
}) {
  return (
    <div className="consola">
      <p className="kicker">Consola</p>
      <h1>{empresa ? empresa.razonSocial : "Todavía no hay razón social."}</h1>
      <p className="lede">
        {empresa
          ? `RFC ${empresa.rfc}. En esta cuenta no cabe otro.`
          : libroDisponible
            ? "La sesión no tiene empresa. El alta está en la puerta de entrada."
            : "El libro no respondió. La consola no muestra la configuración."}
      </p>
      {empresa ? null : (
        <Link className="boton" href="/">
          Dar de alta la razón social
        </Link>
      )}
      <section className="saldos" aria-labelledby="saldos-titulo">
        <h2 id="saldos-titulo">Dos cifras, cada una con su hora</h2>
        <dl>
          <div>
            <dt>Límite de la tarjeta</dt>
            <dd>
              <p className="frase">El emisor todavía no lo aplica.</p>
              <p className="edad">Sin hora de consulta.</p>
            </dd>
          </div>
          <div>
            <dt>Saldo de la CLABE</dt>
            <dd>
              <p className="frase">Sin consulta al participante.</p>
              <p className="edad">Sin hora de consulta.</p>
            </dd>
          </div>
        </dl>
        <p className="nota-saldos">Estas dos cifras no se suman.</p>
      </section>
    </div>
  );
}
