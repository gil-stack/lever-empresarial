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
      <p className="kicker-app">Datos de la empresa</p>
      <h1>Facturación</h1>
      <p className="lede">Comparte estos datos para capturar una compra. La consulta no genera ni valida documentos.</p>
      <dl className="datos-app">
        {renglones.map(([etiqueta, valor]) => <div key={etiqueta}><dt>{etiqueta}</dt><dd>{valor}</dd></div>)}
      </dl>
      {qr ? (
        <figure className="qr-datos">
          {/* QR local generado como data URI; no pasa por el optimizador de imágenes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} width={240} height={240} alt={`Código QR con los datos fiscales de ${datos.razonSocial}`} />
          <figcaption>El código solo contiene los datos visibles en esta página. No acredita una operación.</figcaption>
        </figure>
      ) : (
        <p className="aviso-app" role="alert">No se pudo generar el código QR. Los datos siguen disponibles arriba.</p>
      )}
    </>
  );
}
