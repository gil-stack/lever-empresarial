import { clabeVisible } from "@/dominio/clabe";
import { FRASE_INSTITUCION_PENDIENTE, institucionTradicional } from "@/dominio/clabe-proveedor";
import {
  fechaDeArchivo,
  horaDeLectura,
  relatoDePago,
  type ListaVisible,
  type ProveedorVisible,
} from "@/dominio/proveedores";
import { FRASE_SIN_PAGO } from "@/dominio/lista-69b";
import type { LecturaClabes } from "@/server/proveedores/tipos";
import {
  Ausencia,
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
  edita,
  lista,
  proveedores,
  historial,
}: {
  /** Lo decide la matriz de capacidades con el contexto. */
  edita: boolean;
  lista: ListaVisible;
  proveedores: ProveedorVisible[];
  historial: LecturaClabes;
}) {
  const nombres: Record<string, string> = {};
  for (const proveedor of proveedores) nombres[proveedor.id] = proveedor.razonSocial;

  return (
    <>
      <CabezaPagina kicker="Proveedores" titulo="Proveedores">
        <p className="lede">Un RFC, su razón social y una CLABE.</p>
      </CabezaPagina>
      <Rejilla
        estable
        principal={
          <>
            <Hoja id="proveedores-empresa" titulo="En esta empresa">
              {proveedores.length === 0 ? (
                <Vacio titulo="Todavía no hay proveedores" />
              ) : (
                proveedores.map((proveedor) => (
                  <FichaProveedor
                    key={proveedor.id}
                    proveedor={proveedor}
                    puedeCambiar={historial.puedeCambiar}
                  />
                ))
              )}
            </Hoja>
            <HistorialClabes lectura={historial} nombres={nombres} />
          </>
        }
        lateral={
          <>
            <Hoja id="alta-proveedor" titulo="Alta">
              {edita ? (
                <FormularioProveedor />
              ) : (
                <p className="lede">Tu rol ve esta lista y no da de alta.</p>
              )}
            </Hoja>
            <Hoja className="hoja-archivo" id="lista-69b" titulo="Artículo 69-B">
              <ListaActual lista={lista} />
            </Hoja>
            <Hoja id="pago-proveedor" titulo="Pago">
              <NotaRegla>Esta pantalla no envía dinero.</NotaRegla>
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
        <Frase>{FRASE_SIN_PAGO}</Frase>
        <Renglones>
          <Renglon etiqueta="Fecha del archivo">
            <Ausencia>sin fecha</Ausencia>
          </Renglon>
        </Renglones>
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
      <p className="pista">Una copia nueva vuelve a leer a los proveedores ya guardados.</p>
    </>
  );
}

function FichaProveedor({
  proveedor,
  puedeCambiar,
}: {
  proveedor: ProveedorVisible;
  puedeCambiar: boolean;
}) {
  const relato = relatoDePago(proveedor.decision);
  const institucion = institucionTradicional(proveedor.clabe.slice(0, 3));
  const fecha = proveedor.decision.fechaArchivo;
  return (
    <article className="proveedor" aria-labelledby={`proveedor-${proveedor.id}`}>
      <div className="proveedor-cabeza">
        <h3 id={`proveedor-${proveedor.id}`}>{proveedor.razonSocial}</h3>
        <Insignia tono={relato.tono}>{relato.insignia}</Insignia>
      </div>
      <EtiquetaMono nombre="RFC">{proveedor.rfc}</EtiquetaMono>
      <Frase>{relato.frase}</Frase>
      <EtiquetaMono nombre="CLABE">{clabeVisible(proveedor.clabe)}</EtiquetaMono>
      <Renglones>
        {proveedor.decision.situacion ? (
          <Renglon etiqueta="Situación">{proveedor.decision.situacion}</Renglon>
        ) : null}
        <Renglon etiqueta="Fecha del archivo">
          {fecha ? fechaDeArchivo(fecha) : <Ausencia>sin fecha</Ausencia>}
        </Renglon>
        <Renglon etiqueta="Institución">{institucion ?? FRASE_INSTITUCION_PENDIENTE}</Renglon>
        <Renglon etiqueta="Constancia">
          {proveedor.constancia}
          <span className="pista">Sin liga pública.</span>
        </Renglon>
        <Renglon etiqueta="Lectura">{horaDeLectura(proveedor.leidaEn)}</Renglon>
      </Renglones>
      {puedeCambiar ? null : <p className="pista">Este rol ve la CLABE. No la cambia.</p>}
    </article>
  );
}
