import { tiene, type Capacidad } from "../nucleo/capacidades";

export type DatosInicio = {
  centros: number;
  personas: number;
  liberadores: number;
  categorias: number;
  topesSinEscribir: number;
  proveedores: number;
  plan: "recorrido" | "aceptada" | null;
  /** Solicitudes de pago en «por autorizar» que la persona puede resolver (no cuenta las que pidió). */
  pagosPorAutorizar: number;
  /** La fecha de nómina más antigua ya vencida y sin lote, la misma que usaría prepararNomina. */
  nominaPorPreparar: string | null;
};

export type RutaPendiente =
  | "/consola/personas"
  | "/consola/personas/nomina"
  | "/consola/politica"
  | "/consola/proveedores"
  | "/consola/poliza"
  | "/consola/configuracion/plan";

export type PendienteInicio = {
  id: string;
  titulo: string;
  detalle: string;
  ruta: RutaPendiente;
  accion: string;
  area: "operacion" | "configuracion";
};

/** Solo genera tareas que el rol actual puede abrir y completar. Nunca inventa gastos ni movimientos. */
export function pendientesDeInicio(
  datos: DatosInicio,
  capacidades: readonly Capacidad[],
): PendienteInicio[] {
  const pendientes: PendienteInicio[] = [];
  // Autorizar es de un liberador distinto de quien pidió el pago (lo exige también la base).
  if (datos.pagosPorAutorizar > 0 && tiene(capacidades, "cliente.pago.liberar")) {
    pendientes.push({
      id: "pagos-por-autorizar",
      titulo: datos.pagosPorAutorizar === 1 ? "Autoriza un pago a proveedor" : `Autoriza ${datos.pagosPorAutorizar} pagos a proveedores`,
      detalle: "Revisa la factura, la CLABE vigente y el importe. Autorizar deja la instrucción lista; no envía SPEI.",
      ruta: "/consola/proveedores",
      accion: "Revisar pagos",
      area: "operacion",
    });
  }
  // Preparar la nómina pide las mismas capacidades que prepararNomina.
  if (datos.nominaPorPreparar && tiene(capacidades, "cliente.pago.solicitar") && tiene(capacidades, "cliente.maestro.ver")) {
    pendientes.push({
      id: "nomina-por-preparar",
      titulo: `Prepara el lote de nómina del ${fechaCorta(datos.nominaPorPreparar)}`,
      detalle: "La fecha ya venció y todavía no tiene lote. Prepararlo deja el lote para revisión; no dispersa dinero.",
      ruta: "/consola/personas/nomina",
      accion: "Preparar nómina",
      area: "operacion",
    });
  }
  if (tiene(capacidades, "cliente.maestro.editar")) {
    if (datos.liberadores < 2) {
      const faltan = 2 - datos.liberadores;
      pendientes.push({
        id: "liberadores",
        titulo: faltan === 1 ? "Falta una persona autorizada para liberar" : "Faltan dos personas autorizadas para liberar",
        detalle: "Deben ser dos personas vigentes y distintas. Configurarlas no mueve dinero.",
        ruta: "/consola/personas",
        accion: "Revisar accesos",
        area: "operacion",
      });
    }
    if (datos.centros === 0) {
      pendientes.push({
        id: "centro",
        titulo: "Nombra el primer centro de costo",
        detalle: "Las personas del maestro necesitan un centro de esta empresa.",
        ruta: "/consola/personas",
        accion: "Abrir Personas",
        area: "configuracion",
      });
    } else if (datos.personas === 0) {
      pendientes.push({
        id: "persona",
        titulo: "Da de alta a la primera persona",
        detalle: "El maestro todavía no tiene una ficha de persona.",
        ruta: "/consola/personas",
        accion: "Abrir Personas",
        area: "configuracion",
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
        area: "configuracion",
      });
    } else if (datos.topesSinEscribir > 0) {
      pendientes.push({
        id: "topes",
        titulo: datos.topesSinEscribir === 1 ? "Hay una categoría sin tope escrito" : `Hay ${datos.topesSinEscribir} categorías sin tope escrito`,
        detalle: "Vacío no significa cero. Escribe el tope que corresponda a cada categoría.",
        ruta: "/consola/politica",
        accion: "Revisar topes",
        area: "configuracion",
      });
    }
  }
  if (datos.proveedores === 0 && tiene(capacidades, "cliente.proveedores.alta")) {
    pendientes.push({
      id: "proveedor",
      titulo: "Registra el primer proveedor",
      detalle: "Guarda su RFC, CLABE y constancia para dejar listo el directorio de la empresa.",
      ruta: "/consola/proveedores",
      accion: "Configurar proveedores",
      area: "configuracion",
    });
  }
  if (datos.plan === "recorrido" && tiene(capacidades, "cliente.plan.ver")) {
    pendientes.push({
      id: "plan",
      titulo: "Revisa el plan de esta empresa",
      detalle: "La suscripción sigue en recorrido. La plataforma registra su aceptación.",
      ruta: "/consola/configuracion/plan",
      accion: "Ver plan",
      area: "configuracion",
    });
  }
  return pendientes;
}

function fechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  if (!anio || !mes || !dia) throw new Error("fecha_invalida");
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(anio, mes - 1, dia)));
}

/** Accesos reales para el estado vacío. No se presentan como trabajo pendiente. */
export function atajosDeInicio(capacidades: readonly Capacidad[]): PendienteInicio[] {
  const atajos: PendienteInicio[] = [];
  const agregar = (atajo: Omit<PendienteInicio, "area">) => atajos.push({ ...atajo, area: "configuracion" });
  if (tiene(capacidades, "cliente.maestro.ver")) {
    agregar({ id: "atajo-personas", titulo: "Revisa el maestro de personas", detalle: "Centros de costo, accesos, bajas y permisos financieros.", ruta: "/consola/personas", accion: "Abrir Personas" });
  }
  if (tiene(capacidades, "cliente.politica.ver")) {
    agregar({ id: "atajo-politica", titulo: "Consulta la política de gasto", detalle: "Categorías, topes y reglas que usa esta empresa.", ruta: "/consola/politica", accion: "Abrir Política" });
  }
  if (tiene(capacidades, "cliente.proveedores.ver")) {
    agregar({ id: "atajo-proveedores", titulo: "Revisa el directorio de proveedores", detalle: "RFC, CLABE vigente, constancia y lectura de la lista 69-B.", ruta: "/consola/proveedores", accion: "Abrir Proveedores" });
  }
  if (tiene(capacidades, "cliente.poliza.ver")) {
    agregar({ id: "atajo-poliza", titulo: "Consulta la póliza", detalle: "La vista contable disponible para esta empresa.", ruta: "/consola/poliza", accion: "Abrir Póliza" });
  }
  if (tiene(capacidades, "cliente.plan.ver")) {
    agregar({ id: "atajo-plan", titulo: "Consulta el plan de la empresa", detalle: "Estado de la suscripción y condiciones publicadas.", ruta: "/consola/configuracion/plan", accion: "Ver plan" });
  }
  return atajos;
}
