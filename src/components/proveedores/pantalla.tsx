import { clabeVisible } from "@/dominio/clabe";
import { FRASE_INSTITUCION_PENDIENTE, institucionTradicional } from "@/dominio/clabe-proveedor";
import {
  fechaDeArchivo,
  horaDeLectura,
  puedeDarDeAltaProveedor,
  relatoDePago,
  type ListaVisible,
  type ProveedorVisible,
} from "@/dominio/proveedores";
import type { LecturaClabes } from "@/server/proveedores/tipos";
import type { Rol } from "@/server/session";
import {
  CabezaPagina,
  EtiquetaMono,
  Frase,
  Hoja,
  Insignia,
  NotaRegla,
  Rejilla,
  Renglon,
  Renglones,
  Vacio,
} from "@/components/sistema";

import { FormularioProveedor } from "./formulario";
import { HistorialClabes } from "./panel";

export function PantallaProveedores({
  rol,
  lista,
  proveedores,
  historial,
}: {
  rol: Rol;
  lista: ListaVisible;
  proveedores: ProveedorVisible[];
  historial: LecturaClabes;
}) {
  const edita = puedeDarDeAltaProveedor(rol);
  const nombres: Record<string, string> = {};
  for (const proveedor of proveedores) nombres[proveedor.id] = proveedor.razonSocial;

  return (
    <>
      <CabezaPagina kicker="Proveedores" titulo="Alta de proveedor">
        <p className="lede">
          El proveedor es un RFC, su razón social y una CLABE de dieciocho dígitos. Otro nombre con el
          mismo RFC no abre una segunda ficha.
        </p>
      </CabezaPagina>
      <Rejilla
        principal={
          <>
            <Hoja id="alta-proveedor" titulo="Datos del proveedor">
              {edita ? (
                <>
                  <p className="lede">
                    Los dieciocho dígitos se ven completos. La constancia se archiva en privado.
                  </p>
                  <FormularioProveedor />
                </>
              ) : (
                <p className="lede">Tu rol ve esta lista y no da de alta.</p>
              )}
            </Hoja>
            <Hoja id="proveedores-empresa" titulo="En esta empresa">
              {proveedores.length === 0 ? (
                <Vacio titulo="Todavía no hay proveedores">El alta de arriba es la primera. No sale dinero.</Vacio>
              ) : (
                proveedores.map((proveedor) => <FichaProveedor key={proveedor.id} proveedor={proveedor} />)
              )}
            </Hoja>
            <HistorialClabes lectura={historial} nombres={nombres} />
          </>
        }
        lateral={
          <>
            <Hoja id="lista-69b" titulo="Artículo 69-B">
              <ListaActual lista={lista} />
            </Hoja>
            <Hoja id="pago-proveedor" titulo="Pago">
              <NotaRegla>Esta pantalla no envía dinero. El participante de la CLABE no está conectado.</NotaRegla>
              <p className="pista">
                Si el RFC está en el archivo, el proveedor existe y no hay botón de pago. Si el archivo no
                está cargado, tampoco.
              </p>
            </Hoja>
          </>
        }
      />
    </>
  );
}

function ListaActual({ lista }: { lista: ListaVisible }) {
  if (!lista) {
    return (
      <>
        <Insignia tono="aviso">Sin archivo</Insignia>
        <Frase>No hay botón de pago.</Frase>
        <p className="pista">
          El listado del SAT no está cargado. La fecha del archivo no existe, y sin ella no se ofrece pago.
        </p>
      </>
    );
  }
  return (
    <>
      <Insignia tono="neutro">Archivo del SAT</Insignia>
      <Renglones>
        <Renglon etiqueta="Fecha del archivo">{fechaDeArchivo(lista.fechaArchivo)}</Renglon>
        <Renglon etiqueta="Hora de carga">{horaDeLectura(lista.cargadoEn)}</Renglon>
      </Renglones>
      <p className="pista">La lectura de cada proveedor es la del momento del alta.</p>
    </>
  );
}

function FichaProveedor({ proveedor }: { proveedor: ProveedorVisible }) {
  const relato = relatoDePago(proveedor.decision);
  const institucion = institucionTradicional(proveedor.clabe.slice(0, 3));
  return (
    <article className="proveedor" aria-labelledby={`proveedor-${proveedor.id}`}>
      <div className="proveedor-cabeza">
        <h3 id={`proveedor-${proveedor.id}`}>{proveedor.razonSocial}</h3>
        <Insignia tono={relato.tono}>{relato.insignia}</Insignia>
      </div>
      <EtiquetaMono nombre="RFC">{proveedor.rfc}</EtiquetaMono>
      <Frase>{relato.frase}</Frase>
      <p className="pista">{relato.detalle}</p>
      <Renglones>
        <Renglon etiqueta="CLABE">
          <span className="clabe clabe-grande">{clabeVisible(proveedor.clabe)}</span>
        </Renglon>
        <Renglon etiqueta="Institución">{institucion ?? FRASE_INSTITUCION_PENDIENTE}</Renglon>
        <Renglon etiqueta="Constancia">
          {proveedor.constancia}
          <span className="pista">Archivada. No hay liga pública.</span>
        </Renglon>
        <Renglon etiqueta="Lectura">{horaDeLectura(proveedor.leidaEn)}</Renglon>
      </Renglones>
    </article>
  );
}
