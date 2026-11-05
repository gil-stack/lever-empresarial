import Link from "next/link";

import { enEmpresa } from "@/nucleo/rutas";

export type SeccionPersonas = "personas" | "areas" | "nomina";

export function NavegacionPersonas({
  actual,
  empresaId,
}: {
  actual: SeccionPersonas;
  empresaId: string;
}) {
  const secciones = [
    { id: "personas" as const, titulo: "Personas", ruta: "/consola/personas" },
    { id: "areas" as const, titulo: "Áreas y presupuestos", ruta: "/consola/personas/areas" },
    { id: "nomina" as const, titulo: "Nómina", ruta: "/consola/personas/nomina" },
  ];
  return (
    <nav className="personas-navegacion" aria-label="Dentro de Personas">
      {secciones.map((seccion) => (
        <Link
          key={seccion.id}
          href={enEmpresa(empresaId, seccion.ruta)}
          aria-current={actual === seccion.id ? "page" : undefined}
        >
          {seccion.titulo}
        </Link>
      ))}
    </nav>
  );
}
