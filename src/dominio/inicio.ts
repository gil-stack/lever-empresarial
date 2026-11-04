import { tiene, type Capacidad } from "../nucleo/capacidades";

export type DatosInicio = {
  centros: number;
  personas: number;
  liberadores: number;
  categorias: number;
  topesSinEscribir: number;
  plan: "recorrido" | "aceptada" | null;
};

export type RutaPendiente =
  | "/consola/personas"
  | "/consola/politica"
  | "/consola/configuracion/plan";

export type PendienteInicio = {
  id: string;
  titulo: string;
  detalle: string;
  ruta: RutaPendiente;
  accion: string;
};

/** Solo genera tareas que el rol actual puede abrir y completar. Nunca inventa gastos ni movimientos. */
export function pendientesDeInicio(
  datos: DatosInicio,
  capacidades: readonly Capacidad[],
): PendienteInicio[] {
  const pendientes: PendienteInicio[] = [];
  if (tiene(capacidades, "cliente.maestro.editar")) {
    if (datos.centros === 0) {
      pendientes.push({
        id: "centro",
        titulo: "Nombra el primer centro de costo",
        detalle: "Las personas del maestro necesitan un centro de esta empresa.",
        ruta: "/consola/personas",
        accion: "Abrir Personas",
      });
    } else if (datos.personas === 0) {
      pendientes.push({
        id: "persona",
        titulo: "Da de alta a la primera persona",
        detalle: "El maestro todavía no tiene una ficha de persona.",
        ruta: "/consola/personas",
        accion: "Abrir Personas",
      });
    }
    if (datos.liberadores < 2) {
      const faltan = 2 - datos.liberadores;
      pendientes.push({
        id: "liberadores",
        titulo: faltan === 1 ? "Falta una persona autorizada para liberar" : "Faltan dos personas autorizadas para liberar",
        detalle: "Deben ser dos personas vigentes y distintas. Configurarlas no mueve dinero.",
        ruta: "/consola/personas",
        accion: "Revisar accesos",
      });
    }
  }
  if (tiene(capacidades, "cliente.politica.editar")) {
    if (datos.categorias === 0) {
      pendientes.push({
        id: "categoria",
        titulo: "Crea la primera categoría",
        detalle: "La política todavía no tiene categorías ni topes escritos.",
        ruta: "/consola/politica",
        accion: "Configurar política",
      });
    } else if (datos.topesSinEscribir > 0) {
      pendientes.push({
        id: "topes",
        titulo: datos.topesSinEscribir === 1 ? "Hay una categoría sin tope escrito" : `Hay ${datos.topesSinEscribir} categorías sin tope escrito`,
        detalle: "Vacío no significa cero. Escribe el tope que corresponda a cada categoría.",
        ruta: "/consola/politica",
        accion: "Revisar topes",
      });
    }
  }
  if (datos.plan === "recorrido" && tiene(capacidades, "cliente.plan.ver")) {
    pendientes.push({
      id: "plan",
      titulo: "Revisa el plan de esta empresa",
      detalle: "La suscripción sigue en recorrido. La plataforma registra su aceptación.",
      ruta: "/consola/configuracion/plan",
      accion: "Ver Plan",
    });
  }
  return pendientes;
}
