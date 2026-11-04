import type { ReactNode } from "react";
import Link from "next/link";

import { RenglonesTarifa } from "@/components/precios/renglones";
import {
  Ausencia,
  Bandeja,
  CabezaPagina,
  CifraGrande,
  Frase,
  Hoja,
  Metrica,
  Metricas,
  Monto,
  Rejilla,
  Renglon,
  Renglones,
} from "@/components/sistema";
import { SuscripcionEmpresa } from "@/components/precios/suscripcion-empresa";
import { formatoPesos } from "@/dominio/centavos";
import { saldoDeAsientos, type VistaCajones } from "@/dominio/politica";
import type { LecturaSuscripcion, TarifaVisible } from "@/dominio/precio";
import { saludoEnMexico } from "@/dominio/reloj";

import { relatoSinEmpresa } from "./relato";

type EmpresaVisible = {
  rfc: string;
  razonSocial: string;
} | null;

export type CargaCajones = { tipo: "listos"; vista: VistaCajones } | { tipo: "aviso"; mensaje: string };

export function ConsolaVacia({
  empresa,
  libroDisponible,
  conSesion,
  nombre = null,
  personas = null,
  cajones = null,
  tarifa,
  suscripcion,
}: {
  empresa: EmpresaVisible;
  libroDisponible: boolean;
  conSesion: boolean;
  nombre?: string | null;
  personas?: { titulo: string; detalle: string } | { fallo: true } | null;
  cajones?: CargaCajones | null;
  tarifa: TarifaVisible;
  suscripcion: LecturaSuscripcion;
}) {
  if (!empresa) {
    return (
      <SinEmpresa libroDisponible={libroDisponible} conSesion={conSesion} tarifa={tarifa} suscripcion={suscripcion} />
    );
  }

  return (
    <div className="consola">
      <header className="pagina-cabeza resumen-cabeza">
        <h1>Resumen</h1>
        <p className="saludo">
          {saludoEnMexico(new Date(), nombre ?? "")}
          <span aria-hidden="true"> · </span>
          <span className="solo-lector">, </span>
          {empresa.razonSocial}
        </p>
      </header>
      {cajones ? <CifrasDelLibro cajones={cajones} /> : null}
      <Bandeja
        decisiones={[]}
        vacio={
          <>
            <p className="vacio-titulo">Nada espera tu decisión.</p>
            <p>Las solicitudes de gasto, reembolso y aumento llegan aquí cuando exista el expediente del gasto.</p>
          </>
        }
      />
      <Rejilla
        estable
        principal={<TarjetaYClabe />}
        lateral={personas ? <FichaPersonas personas={personas} /> : null}
      />
      <Precios tarifa={tarifa} suscripcion={suscripcion} />
    </div>
  );
}

function TarjetaYClabe() {
  return (
    <Hoja className="saldos" id="saldos-titulo" titulo="Tarjeta y CLABE">
      <Renglones>
        <Renglon etiqueta="Límite de la tarjeta">
          <Frase>El emisor todavía no lo aplica.</Frase>
        </Renglon>
        <Renglon etiqueta="Saldo de la CLABE">
          <Frase>Sin consulta al participante.</Frase>
        </Renglon>
      </Renglones>
      <p className="nota-saldos">
        La tarjeta es recargable y prefondeada. Estas dos cifras no se suman entre sí ni con el libro.
      </p>
    </Hoja>
  );
}

function Precios({ tarifa, suscripcion }: { tarifa: TarifaVisible; suscripcion: LecturaSuscripcion }) {
  return (
    <>
      <RenglonesTarifa tarifa={tarifa} ambito="consola" />
      <p className="nota-saldos">
        <Link href="/precios">La página de precios</Link> muestra los mismos renglones.
      </p>
      <SuscripcionEmpresa tarifa={tarifa} lectura={suscripcion} />
    </>
  );
}

function CifrasDelLibro({ cajones }: { cajones: CargaCajones }) {
  if (cajones.tipo === "aviso") {
    return (
      <section className="resumen-cifras" aria-labelledby="libro-rotulo">
        <div className="saldo-principal">
          <p className="rotulo" id="libro-rotulo">
            Saldo en el libro
          </p>
          <Ausencia>{cajones.mensaje}</Ausencia>
        </div>
      </section>
    );
  }
  const { vista } = cajones;
  const total = saldoDeAsientos([...vista.cajones.map((cajon) => cajon.saldoCentavos), vista.sinCajonCentavos]);
  return (
    <section className="resumen-cifras" id="cajones" aria-labelledby="libro-rotulo">
      <div className="saldo-principal">
        <p className="rotulo" id="libro-rotulo">
          Saldo en el libro
        </p>
        <CifraGrande centavos={total} />
        <p className="saldo-pie">
          Sin cajón {formatoPesos(vista.sinCajonCentavos)}
          <Link className="enlace-texto" href="/consola/politica">
            Ver la política
          </Link>
        </p>
      </div>
      <Metricas etiqueta="Cajones">
        {vista.cajones.map((cajon) => (
          <Metrica key={cajon.codigo} rotulo={cajon.nombre}>
            <Monto>{formatoPesos(cajon.saldoCentavos)}</Monto>
          </Metrica>
        ))}
      </Metricas>
      <p className="edad resumen-edad">{vista.edad} Desde aquí no se dispersa ni se envía un SPEI.</p>
    </section>
  );
}

function SinEmpresa({
  libroDisponible,
  conSesion,
  tarifa,
  suscripcion,
}: {
  libroDisponible: boolean;
  conSesion: boolean;
  tarifa: TarifaVisible;
  suscripcion: LecturaSuscripcion;
}) {
  const relato = relatoSinEmpresa(libroDisponible);
  return (
    <div className="consola">
      <CabezaPagina kicker="Resumen" titulo={relato.titulo}>
        <p className="lede">{relato.detalle}</p>
        {libroDisponible && !conSesion ? (
          <div className="acciones">
            <Link className="boton" href="/entrar">
              Entrar
            </Link>
          </div>
        ) : null}
      </CabezaPagina>
      <Rejilla principal={<TarjetaYClabe />} />
      <Precios tarifa={tarifa} suscripcion={suscripcion} />
    </div>
  );
}

function FichaPersonas({ personas }: { personas: { titulo: string; detalle: string } | { fallo: true } }): ReactNode {
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
