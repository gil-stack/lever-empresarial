import type { Metadata } from "next";
import { FormularioAlta } from "@/components/alta/formulario-alta";
import { Marco } from "@/components/cromo/marco";
import { puertasDe } from "@/components/cromo/puertas";
import { leerEntrada } from "@/server/entrada";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Alta de razón social",
};

const NO_ENTRA = [
  "Varias razones sociales",
  "Un ERP como condición para pagar",
  "Cálculo de sueldos o seguridad social",
  "Crédito, flotante o rendimiento",
  "Viajes reservables, flotilla, órdenes de compra o cuentas por cobrar",
  "Una persona cuya empresa no adopta el producto",
  "Un despacho que quiere revender la cuenta",
  "Gasto centrado en el extranjero o en stablecoins",
  "Operación fuera de México",
  "Una sola firma para pedir y para liberar",
] as const;

export default async function PaginaAlta() {
  const entrada = await leerEntrada();

  return (
    <Marco
      actual="/"
      persona={entrada.nombre ? { nombre: entrada.nombre } : null}
      {...puertasDe(entrada.rol, Boolean(entrada.rfc))}
    >
      <main id="contenido" className="alta">
        <section className="alta-relato" aria-labelledby="titulo-alta">
          <p className="kicker">Alta de la empresa</p>
          <h1 id="titulo-alta">
            Una sola
            <br />
            <em>razón social.</em>
          </h1>
          <p className="lede">
            Doce o trece caracteres, un código postal y el régimen con el que esta empresa va a pedir sus facturas. En
            esta cuenta cabe un RFC.
          </p>
          <section className="exclusiones" aria-labelledby="no-entra">
            <h2 id="no-entra">No entra en esta cuenta</h2>
            <ul>
              {NO_ENTRA.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </section>
        <FormularioAlta
          contexto={{
            conSesion: entrada.nombre !== null,
            nombre: entrada.nombre,
            rfc: entrada.rfc,
            libroDisponible: entrada.libroDisponible,
          }}
        />
      </main>
    </Marco>
  );
}
