import type { DatosFiscalesTelefono } from "@/server/telefono/tipos";

export function Facturacion({ datos, qr }: { datos: DatosFiscalesTelefono; qr: string | null }) {
  const renglones = [
    ["RFC", datos.rfc],
    ["Razón social", datos.razonSocial],
    ["Código postal", datos.codigoPostal],
    ["Régimen", datos.regimen],
    ["Uso fiscal", datos.uso],
  ] as const;
  return (
    <>
      <h1 className="solo-lector">Pedir factura</h1>
      <p className="pista-app">Dáselos al comercio para que facture a nombre de la empresa.</p>
      <dl className="datos-app">
        {renglones.map(([etiqueta, valor]) => <div key={etiqueta}><dt>{etiqueta}</dt><dd>{valor}</dd></div>)}
      </dl>
      {qr ? (
        <figure className="qr-datos">
          {/* QR local generado como data URI; no pasa por el optimizador de imágenes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} width={240} height={240} alt={`Código QR con los datos fiscales de ${datos.razonSocial}`} />
          <figcaption>El código lleva los mismos datos de arriba.</figcaption>
        </figure>
      ) : (
        <p className="aviso-app" role="alert">No se pudo generar el código QR. Los datos de arriba sí sirven.</p>
      )}
    </>
  );
}
