import { FormularioCambio } from "./formulario-cambio";
import { EtiquetaMono, Hoja, Insignia, Renglon, Renglones, Vacio } from "@/components/sistema";
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
    <Hoja id="historial-clabe" titulo="Historial">
      {lectura.grupos.length === 0 ? (
        <Vacio titulo="Todavía no hay una CLABE de proveedor.">
          La primera se asienta con el alta. Cuando se cambie, la anterior se queda aquí. No se envía dinero.
        </Vacio>
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
    </Hoja>
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
    <section className="clabe-linea" aria-labelledby={`historial-${grupo.supplierId}`}>
      <h3 id={`historial-${grupo.supplierId}`}>{titulo}</h3>
      {grupo.vigente ? <Linea linea={grupo.vigente} vigente /> : null}
      {grupo.anteriores.length > 0 ? (
        <>
          <p className="historial-anteriores">Anteriores</p>
          {grupo.anteriores.map((linea) => (
            <Linea key={linea.id} linea={linea} vigente={false} />
          ))}
        </>
      ) : grupo.vigente ? (
        <p className="pista">No hay una CLABE anterior.</p>
      ) : null}
      {grupo.vigente && puedeCambiar ? <FormularioCambio supplierId={grupo.supplierId} /> : null}
    </section>
  );
}

function Linea({ linea, vigente }: { linea: LineaClabeVista; vigente: boolean }) {
  const institucion = linea.institucion.conocida ? linea.institucion.nombre : FRASE_INSTITUCION_PENDIENTE;
  return (
    <div>
      <p>
        <Insignia tono={vigente ? "sello" : "neutro"}>{vigente ? "Vigente" : "Anterior"}</Insignia>
      </p>
      <EtiquetaMono nombre="CLABE">{linea.visible}</EtiquetaMono>
      <Renglones>
        <Renglon etiqueta="Institución">{institucion}</Renglon>
        <Renglon etiqueta="Desde">{linea.desde}</Renglon>
        {linea.hasta ? <Renglon etiqueta="Hasta">{linea.hasta}</Renglon> : null}
      </Renglones>
    </div>
  );
}
