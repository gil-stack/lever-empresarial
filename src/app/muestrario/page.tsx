import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MuestrarioEscenas } from "@/components/apariencia/muestrario-escenas";
import { Marco } from "@/components/cromo/marco";
import { BandejaDeEjemplo } from "@/components/muestrario/bandeja-de-ejemplo";
import {
  Ausencia,
  CifraGrande,
  EtiquetaMono,
  Frase,
  Hoja,
  Insignia,
  Metrica,
  Metricas,
  Monto,
  NotaRegla,
  Rejilla,
  Renglon,
  Renglones,
} from "@/components/sistema";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Muestrario",
  robots: { index: false, follow: false },
};

/** Las piezas del sistema con datos de ejemplo. No existe en producción. */
export default function PaginaMuestrario() {
  if (process.env.VERCEL_ENV === "production") notFound();

  return (
    <Marco
      actual="/consola"
      maestro
      proveedores
      lista69b
      empresa={{ razonSocial: "Empresa de Ejemplo", rfc: "EEJ260101AB1" }}
      contadores={{ "/consola/personas": { valor: 1, etiqueta: "ejemplo" } }}
    >
      <main id="contenido" className="consola">
        <header className="pagina-cabeza resumen-cabeza">
          <p className="kicker">Muestrario · datos de ejemplo</p>
          <h1>Resumen</h1>
          <p className="saludo">Buenas tardes, Laura · Empresa de Ejemplo</p>
        </header>
        <section className="resumen-cifras" aria-labelledby="ejemplo-rotulo">
          <div className="saldo-principal">
            <p className="rotulo" id="ejemplo-rotulo">
              Saldo en el libro
            </p>
            <CifraGrande centavos={128445600} />
            <p className="saldo-pie">Sin cajón $84,560.40</p>
          </div>
          <Metricas etiqueta="Cajones de ejemplo">
            <Metrica rotulo="Viáticos">
              <Monto>$420,000.00</Monto>
            </Metrica>
            <Metrica rotulo="Proveedores">
              <Monto>$510,000.00</Monto>
            </Metrica>
            <Metrica rotulo="Impuestos">
              <Monto>$90,000.00</Monto>
            </Metrica>
            <Metrica rotulo="Nómina" nota="Nota de ejemplo">
              <Monto>$179,895.60</Monto>
            </Metrica>
          </Metricas>
        </section>
        <BandejaDeEjemplo />
        <Rejilla
          estable
          principal={
            <Hoja id="piezas-titulo" titulo="Piezas">
              <Renglones>
                <Renglon etiqueta="Insignias">
                  <span className="fila-muestra">
                    <Insignia>Neutra</Insignia>
                    <Insignia tono="sello">Al día</Insignia>
                    <Insignia tono="aviso">Revisar</Insignia>
                  </span>
                </Renglon>
                <Renglon etiqueta="RFC">
                  <EtiquetaMono nombre="RFC">EEJ260101AB1</EtiquetaMono>
                </Renglon>
                <Renglon etiqueta="Cifra ausente">
                  <Ausencia>cifra no publicada</Ausencia>
                </Renglon>
                <Renglon etiqueta="Frase">
                  <Frase>El emisor todavía no lo aplica.</Frase>
                </Renglon>
              </Renglones>
              <NotaRegla>Una regla fija del producto se dice una vez.</NotaRegla>
            </Hoja>
          }
          lateral={
            <Hoja id="botones-titulo" titulo="Botones">
              <div className="acciones">
                <button type="button" className="boton">
                  Principal
                </button>
                <button type="button" className="boton-texto">
                  Secundario
                </button>
                <a className="enlace-texto" href="#contenido">
                  Enlace
                </a>
              </div>
            </Hoja>
          }
        />
        <Hoja id="escenas-titulo" titulo="Escenas">
          <MuestrarioEscenas />
        </Hoja>
      </main>
    </Marco>
  );
}
