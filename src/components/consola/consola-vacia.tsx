import Link from "next/link";

import { RenglonesTarifa } from "@/components/precios/renglones";
import { SuscripcionEmpresa } from "@/components/precios/suscripcion-empresa";
import type { LecturaSuscripcion, TarifaVisible } from "@/dominio/precio";

import { relatoSinEmpresa } from "./relato";

type EmpresaVisible = {
  rfc: string;
  razonSocial: string;
} | null;

export function ConsolaVacia({
  empresa,
  libroDisponible,
  conSesion,
  tarifa,
  suscripcion,
  esOperador,
}: {
  empresa: EmpresaVisible;
  libroDisponible: boolean;
  conSesion: boolean;
  tarifa: TarifaVisible;
  suscripcion: LecturaSuscripcion;
  esOperador: boolean;
}) {
  const vacia = empresa ? null : relatoSinEmpresa(libroDisponible, conSesion);

  return (
    <div className="consola">
      <p className="kicker">Consola</p>
      <h1>{empresa ? empresa.razonSocial : vacia?.titulo}</h1>
      {empresa ? <p className="rfc-cuenta">{empresa.rfc}</p> : null}
      <p className="lede">{empresa ? "En esta cuenta no cabe otro." : vacia?.detalle}</p>
      {empresa || !libroDisponible ? null : (
        <div className="acciones">
          <Link className="boton" href="/">
            Dar de alta la razón social
          </Link>
          {conSesion ? null : (
            <Link className="enlace-texto" href="/entrar">
              Entrar
            </Link>
          )}
        </div>
      )}
      <section className="saldos" aria-labelledby="saldos-titulo">
        <h2 id="saldos-titulo">Límite y saldo</h2>
        <dl>
          <div>
            <dt>Límite de la tarjeta</dt>
            <dd>
              <p className="frase">El emisor todavía no lo aplica.</p>
            </dd>
          </div>
          <div>
            <dt>Saldo de la CLABE</dt>
            <dd>
              <p className="frase">Sin consulta al participante.</p>
            </dd>
          </div>
        </dl>
        <p className="nota-saldos">Estas dos cifras no se suman.</p>
      </section>
      <RenglonesTarifa tarifa={tarifa} ambito="consola" />
      <p className="nota-saldos">
        <Link href="/precios">La página de precios</Link> lee este mismo campo.
      </p>
      <SuscripcionEmpresa tarifa={tarifa} lectura={suscripcion} esOperador={esOperador} />
    </div>
  );
}
