import { BotonEnviar } from "@/components/sistema";

import { errorDelCampo } from "./aviso";

/**
 * Anotar el folio del reporte a la UIF de una coincidencia confirmada. `en` dice qué campo de qué coincidencia causó
 * el último aviso (`folio-<id>`, `presentado-<id>` o `aviso-<id>`): solo ese campo se marca y recibe el foco.
 */
export function FormularioFolio({
  id,
  desde,
  accion,
  aviso,
  en,
}: {
  id: string;
  desde: "cumplimiento" | "lpb";
  accion: (datos: FormData) => Promise<void>;
  aviso?: string;
  en?: string;
}) {
  const ligado = (nombre: string, campo: string) => (en === `${nombre}-${id}` ? errorDelCampo(aviso, campo) : {});
  return (
    <form action={accion} className="operacion-acciones">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="desde" value={desde} />
      <div className="campo">
        <label htmlFor={`folio-${id}`}>Folio del reporte a la UIF</label>
        <input id={`folio-${id}`} name="folio" maxLength={80} required {...ligado("folio", "folio")} />
      </div>
      <div className="campo">
        <label htmlFor={`presentado-${id}`}>Presentado el</label>
        <input id={`presentado-${id}`} name="presentadoEl" type="date" required {...ligado("presentado", "presentadoEl")} />
      </div>
      <div className="campo">
        <label htmlFor={`aviso-${id}`}>Aviso por escrito al cliente</label>
        <input id={`aviso-${id}`} name="avisoClienteEl" type="date" {...ligado("aviso", "avisoClienteEl")} />
      </div>
      <BotonEnviar className="boton-secundario">Anotar folio</BotonEnviar>
    </form>
  );
}
