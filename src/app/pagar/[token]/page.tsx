import type { Metadata } from "next";
import { notFound } from "next/navigation";

import "@/estilo/cobranza.css";

import { CopiarTexto, SinRecordatorios } from "@/components/cobranza/pagador";
import { MarcoArco } from "@/components/entrar/marco-arco";
import { Aviso } from "@/components/sistema";
import { formatoPesos } from "@/dominio/centavos";
import { clabeVisible } from "@/dominio/clabe";
import { fechaConAnio } from "@/dominio/flujo/fechas";
import { leerPaginaDelPagador } from "@/server/cobranza/pagador";

export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Tu cobro",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Lo que ve quien paga al abrir el enlace de su correo: lo mismo que el correo
 * (monto, CLABE, referencia) y la opción de no recibir recordatorios.
 */
export default async function PaginaPagador({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const vista = await leerPaginaDelPagador(token);
  if (!vista) notFound();
  const pie = "Cobro enviado con Lever Empresas. El dinero va directo a la cuenta de quien te cobra.";
  if (vista.estado === "vencido") {
    return (
      <MarcoArco pie={pie}>
        <p className="arco-kicker">Cobro de {vista.razonSocial}</p>
        <h1>Este enlace ya venció.</h1>
        <p className="arco-nota">
          Por seguridad, los enlaces de cobro duran un tiempo limitado.{" "}
          {vista.contacto ? <>Pide uno nuevo a <a href={`mailto:${vista.contacto}`}>{vista.contacto}</a>.</> : "Pide uno nuevo a quien te cobra."}
        </p>
      </MarcoArco>
    );
  }
  const parcial = vista.estado === "pendiente" && vista.saldoCentavos < vista.montoCentavos;
  return (
    <MarcoArco pie={pie}>
      <p className="arco-kicker">Cobro de {vista.razonSocial}</p>
      {vista.estado === "pagado" ? (
        <h1>Este cobro ya está pagado.</h1>
      ) : vista.estado === "cancelado" ? (
        <h1>Este cobro se canceló.</h1>
      ) : (
        <h1 data-cifra="saldo" data-centavos={vista.saldoCentavos}>{formatoPesos(vista.saldoCentavos)}</h1>
      )}
      <p className="arco-nota">
        {vista.concepto} · {vista.periodo} · para {vista.cliente}.
        {vista.estado === "pagado" && vista.pagadoEl ? ` Se pagó el ${fechaConAnio(vista.pagadoEl)}. Gracias.` : null}
        {vista.estado === "cancelado" ? " No tienes que pagar nada por este cobro." : null}
        {parcial ? ` Ya recibimos ${formatoPesos(vista.montoCentavos - vista.saldoCentavos)} de ${formatoPesos(vista.montoCentavos)}.` : null}
      </p>
      {vista.demostracion ? <Aviso titulo="Cobro de demostración">Es una empresa de demostración: no deposites. Nada de esto es real.</Aviso> : null}
      {vista.estado === "pendiente" ? (
        <>
          <dl className="renglones pagador-datos">
            <div><dt>Vence</dt><dd>{fechaConAnio(vista.vencimiento)}</dd></div>
            <div><dt>CLABE</dt><dd><span className="pagador-mono" data-clabe={vista.clabe}>{clabeVisible(vista.clabe)}</span> <CopiarTexto valor={vista.clabe} etiqueta="Copiar CLABE" /></dd></div>
            {vista.banco ? <div><dt>Banco</dt><dd>{vista.banco}</dd></div> : null}
            <div><dt>Beneficiario</dt><dd>{vista.beneficiario}</dd></div>
            <div><dt>Referencia</dt><dd><span className="pagador-mono" data-referencia={vista.referencia}>{vista.referencia}</span> <CopiarTexto valor={vista.referencia} etiqueta="Copiar referencia" /></dd></div>
          </dl>
          <p className="arco-nota">Haz una transferencia SPEI por el monto exacto y escribe la referencia en el concepto o en la referencia numérica. Así tu pago se identifica solo.</p>
          {vista.recordatorios ? (
            <SinRecordatorios token={token} razonSocial={vista.razonSocial} />
          ) : (
            <p className="pista" data-sin-recordatorios="ya">No recibes recordatorios de este cobro; solo el cobro de cada periodo.</p>
          )}
        </>
      ) : null}
      {vista.contacto ? <p className="arco-nota">¿Dudas sobre este cobro? Escribe a <a href={`mailto:${vista.contacto}`}>{vista.contacto}</a>.</p> : null}
    </MarcoArco>
  );
}
