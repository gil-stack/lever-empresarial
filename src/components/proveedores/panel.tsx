import { FormularioCambio } from "./formulario-cambio";
import { LecturaClabe } from "./lectura";
import {
  EtiquetaMono,
  Frase,
  Hoja,
  Insignia,
  NotaRegla,
  Renglon,
  Renglones,
  Vacio,
} from "@/components/sistema";
import { FRASE_INSTITUCION_PENDIENTE } from "@/dominio/clabe-proveedor";
import type { GrupoClabeVista, LecturaClabes, LineaClabeVista } from "@/server/proveedores/tipos";

/**
 * Historial de la CLABE, dentro de la consola de proveedores.
 * No es una sección propia de la barra y no se pinta en el teléfono.
 */
export function HistorialClabes({
  lectura,
  nombres,
}: {
  lectura: LecturaClabes;
  nombres: Readonly<Record<string, string>>;
}) {
  return (
    <>
      <Hoja id="lectura-clabe" titulo="Lectura de una CLABE">
        <LecturaClabe />
        <NotaRegla>
          El nombre del banco solo aparece si los tres primeros dígitos están en el catálogo tradicional de la
          ABM. Si no están, la pantalla dice: {FRASE_INSTITUCION_PENDIENTE} No se envía dinero.
        </NotaRegla>
      </Hoja>
      {lectura.grupos.length === 0 ? (
        <Hoja id="historial-clabe" titulo="Historial">
          <Vacio titulo="Todavía no hay una CLABE de proveedor.">
            La primera se asienta con el alta. Cuando se cambie, la anterior se queda aquí.
          </Vacio>
        </Hoja>
      ) : (
        lectura.grupos.map((grupo) => (
          <Grupo
            key={grupo.supplierId}
            grupo={grupo}
            titulo={nombres[grupo.supplierId] ?? "Proveedor"}
            puedeCambiar={lectura.puedeCambiar}
          />
        ))
      )}
    </>
  );
}

function Grupo({
  grupo,
  titulo,
  puedeCambiar,
}: {
  grupo: GrupoClabeVista;
  titulo: string;
  puedeCambiar: boolean;
}) {
  return (
    <Hoja id={`clabe-${grupo.supplierId}`} titulo={titulo}>
      {grupo.vigente ? <Linea linea={grupo.vigente} vigente /> : null}
      {grupo.anteriores.length > 0 ? (
        <>
          <h3>Anteriores</h3>
          {grupo.anteriores.map((linea) => (
            <Linea key={linea.id} linea={linea} vigente={false} />
          ))}
        </>
      ) : grupo.vigente ? (
        <p className="pista">No hay una CLABE anterior.</p>
      ) : null}
      {grupo.vigente && puedeCambiar ? <FormularioCambio supplierId={grupo.supplierId} /> : null}
      {grupo.vigente && !puedeCambiar ? <p className="pista">Este rol ve la CLABE. No la cambia.</p> : null}
    </Hoja>
  );
}

function Linea({ linea, vigente }: { linea: LineaClabeVista; vigente: boolean }) {
  return (
    <div className="clabe-linea">
      <p>
        <Insignia tono={vigente ? "sello" : "neutro"}>{vigente ? "Vigente" : "Anterior"}</Insignia>
      </p>
      <EtiquetaMono nombre="CLABE">{linea.visible}</EtiquetaMono>
      {linea.institucion.conocida ? (
        <Renglones>
          <Renglon etiqueta="Banco">{linea.institucion.nombre}</Renglon>
          <Renglon etiqueta="Desde">{linea.desde}</Renglon>
          {linea.hasta ? <Renglon etiqueta="Hasta">{linea.hasta}</Renglon> : null}
        </Renglones>
      ) : (
        <>
          <Frase>{linea.institucion.frase}</Frase>
          <Renglones>
            <Renglon etiqueta="Desde">{linea.desde}</Renglon>
            {linea.hasta ? <Renglon etiqueta="Hasta">{linea.hasta}</Renglon> : null}
          </Renglones>
        </>
      )}
    </div>
  );
}
