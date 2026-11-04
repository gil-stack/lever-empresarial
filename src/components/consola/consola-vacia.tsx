import type { ReactNode } from "react";
import Link from "next/link";

import { RenglonesTarifa } from "@/components/precios/renglones";
import { CabezaPagina, EtiquetaMono, Frase, Hoja, Rejilla, Renglon, Renglones } from "@/components/sistema";
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
  personas = null,
  despues = null,
  tarifa,
  suscripcion,
  esOperador,
}: {
  empresa: EmpresaVisible;
  libroDisponible: boolean;
  conSesion: boolean;
  personas?: { titulo: string; detalle: string } | { fallo: true } | null;
  despues?: ReactNode;
  tarifa: TarifaVisible;
  suscripcion: LecturaSuscripcion;
  esOperador: boolean;
}) {
  const vacia = empresa ? null : relatoSinEmpresa(libroDisponible, conSesion);

  return (
    <div className="consola">
      <CabezaPagina kicker="Consola" titulo={empresa ? empresa.razonSocial : vacia?.titulo}>
        {empresa ? <EtiquetaMono nombre="RFC">{empresa.rfc}</EtiquetaMono> : null}
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
      </CabezaPagina>
      <Rejilla
        principal={
          <>
            <Hoja className="saldos" id="saldos-titulo" titulo="Límite y saldo">
              <Renglones>
                <Renglon etiqueta="Límite de la tarjeta">
                  <Frase>El emisor todavía no lo aplica.</Frase>
                </Renglon>
                <Renglon etiqueta="Saldo de la CLABE">
                  <Frase>Sin consulta al participante.</Frase>
                </Renglon>
              </Renglones>
              <p className="nota-saldos">Estas dos cifras no se suman.</p>
            </Hoja>
            {despues}
          </>
        }
        lateral={personas ? <FichaPersonas personas={personas} /> : null}
      />
      <RenglonesTarifa tarifa={tarifa} ambito="consola" />
      <p className="nota-saldos">
        <Link href="/precios">La página de precios</Link> muestra los mismos renglones.
      </p>
      <SuscripcionEmpresa tarifa={tarifa} lectura={suscripcion} esOperador={esOperador} />
    </div>
  );
}

function FichaPersonas({ personas }: { personas: { titulo: string; detalle: string } | { fallo: true } }) {
  if ("fallo" in personas) {
    return (
      <Hoja className="ficha" id="personas-titulo" titulo="Personas">
        <Frase>No se pudo consultar el maestro.</Frase>
      </Hoja>
    );
  }
  return (
    <Hoja className="ficha" id="personas-titulo" titulo={personas.titulo}>
      <p className="lede">{personas.detalle}</p>
      <div className="acciones">
        <Link className="enlace-texto" href="/consola/personas">
          Abrir el maestro
        </Link>
      </div>
    </Hoja>
  );
}
