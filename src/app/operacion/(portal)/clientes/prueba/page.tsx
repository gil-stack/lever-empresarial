import type { Metadata } from "next";
import Link from "next/link";

import { soloTexto, type Parametros } from "@/nucleo/direccion";
import { FormularioAltaRapida } from "@/components/operacion/alta-rapida";
import { PaginaOperacion } from "@/components/operacion/pagina";
import { SinPermiso } from "@/components/operacion/sin-permiso";
import { Hoja, NotaRegla, Rejilla, Vacio } from "@/components/sistema";
import { altaRapidaDisponible, exigirContextoOperacion } from "@/server/operacion";
import { puedeEnOperacion } from "@/server/operacion/permisos";

import "@/estilo/alta-clientes.css";

export const runtime = "nodejs";
export const metadata: Metadata = { title: "Cliente de prueba · Operación" };

/**
 * Alta rápida de un cliente de prueba: activo de inmediato, sin el alta regulada. Solo Administración de la plataforma y
 * solo mientras las tarjetas están en su ambiente de pruebas; con las llaves reales esta pantalla ya no ofrece nada.
 */
export default async function ClienteDePrueba({ searchParams }: { searchParams: Parametros<"aviso"> }) {
  const ctx = await exigirContextoOperacion();
  const params = await soloTexto(searchParams);
  const puede = puedeEnOperacion(ctx, "plataforma.empresa.alta");
  const disponible = altaRapidaDisponible();
  return (
    <PaginaOperacion
      titulo="Cliente de prueba"
      aviso={params.aviso}
      accion={<Link className="boton-texto" href="/operacion/clientes">← Clientes</Link>}
    >
      {!puede ? (
        <SinPermiso>Los clientes de prueba los da de alta Administración de la plataforma.</SinPermiso>
      ) : !disponible ? (
        <Hoja id="prueba-titulo" titulo="Alta rápida">
          <Vacio titulo="No disponible">
            El alta rápida solo existe mientras las tarjetas están en su ambiente de pruebas. Para un cliente real,{" "}
            <Link href="/operacion/clientes/nuevo">da de alta al cliente</Link> paso a paso.
          </Vacio>
        </Hoja>
      ) : (
        <Rejilla
          principal={
            <Hoja id="prueba-titulo" titulo="Alta rápida de un cliente de prueba">
              <p className="pista">Para probar el portal y las tarjetas sin expediente ni aprobación.</p>
              <FormularioAltaRapida />
            </Hoja>
          }
          lateral={
            <Hoja id="prueba-reglas-titulo" titulo="Qué hace">
              <ul className="prueba-resultado-lista">
                <li>Crea la empresa activa y marcada como cliente de prueba en todas las pantallas.</li>
                <li>Invita a su administrador; si el correo no sale, te deja el enlace para copiarlo.</li>
                <li>La da de alta en tarjetas, en el ambiente de pruebas. El dinero es de prueba.</li>
                <li>Queda en la Bitácora con tu nombre.</li>
              </ul>
              <NotaRegla>
                No sirve para clientes reales: esos siguen el <Link href="/operacion/clientes/nuevo">alta paso a paso</Link>. Cuando
                termines, archívalo desde su ficha.
              </NotaRegla>
            </Hoja>
          }
        />
      )}
    </PaginaOperacion>
  );
}
