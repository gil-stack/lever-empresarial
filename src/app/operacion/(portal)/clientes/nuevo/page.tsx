import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { RecorridoDelAlta } from "@/components/operacion/avance-alta";
import { FormularioProspecto } from "@/components/operacion/formulario-prospecto";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { Hoja, Rejilla } from "@/components/sistema";
import { exigirContextoOperacion } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

import "@/estilo/alta-clientes.css";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Alta de cliente · Operación" };

/** El primer paso del alta: los datos fiscales y, si ya se sabe, el primer administrador. Al lado, el recorrido completo. */
export default async function NuevoCliente({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const params = await soloTexto(searchParams);
  const registra = puedeEnOperacion(ctx, "plataforma.prospecto.registrar");
  return (
    <PaginaOperacion
      titulo="Alta de cliente"
      aviso={params.aviso}
      accion={<Link className="boton-texto" href="/operacion/clientes">← Clientes</Link>}
    >
      {registra ? (
        <Rejilla
          principal={
            <Hoja id="prospecto-titulo" titulo="Paso 1 · Datos de la empresa">
              <p className="pista">Con esto la empresa entra como prospecto. Después sigue su expediente.</p>
              <FormularioProspecto />
            </Hoja>
          }
          lateral={
            <Hoja id="recorrido-titulo" titulo="Cómo es el alta">
              <p className="pista">Seis pasos. Cada uno lo hace el rol indicado y la base exige que la activación la decida otra persona.</p>
              <RecorridoDelAlta />
            </Hoja>
          }
        />
      ) : (
        <SinPermiso>El alta de clientes la hacen Administración de la plataforma u Originación.</SinPermiso>
      )}
    </PaginaOperacion>
  );
}
