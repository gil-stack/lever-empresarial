import { tiene, type Capacidad, type Superficie } from "./capacidades";

/**
 * Cada ruta declara su superficie y quién la abre. Una ruta que no está aquí
 * no se publica: el proxy responde como si no existiera. El servidor vuelve a
 * preguntar con el mismo registro y la sesión ya resuelta.
 */
/**
 * publica: sin sesión.
 * segundo_factor: solo con la cookie de la entrada (contraseña ya comprobada)
 *   o la del portal todavía no abierto, para registrar o verificar el factor.
 * sesion y capacidad: sesión completa, nacida con passkey, TOTP o respaldo.
 */
export type Acceso =
  | { tipo: "publica" }
  | { tipo: "segundo_factor" }
  | { tipo: "sesion" }
  | { tipo: "capacidad"; alguna: readonly Capacidad[] };

export const RUTA_SEGUNDO_FACTOR = "/entrar/continuar";

export type Ruta = {
  patron: string;
  superficie: Superficie;
  acceso: Acceso;
  /** La ruta trabaja sobre una empresa y acepta el prefijo /c/<empresa>. */
  conEmpresa: boolean;
};

export const RUTAS = [
  { patron: "/", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/entrar", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/entrar/continuar", superficie: "cliente", acceso: { tipo: "segundo_factor" }, conEmpresa: false },
  { patron: "/entrar/destino", superficie: "cliente", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/entrar/seguridad", superficie: "cliente", acceso: { tipo: "sesion" }, conEmpresa: false },
  // Solo redirige a /operacion/recuperaciones: ahí se aprueba, con sesión SOFIPO.
  { patron: "/entrar/recuperaciones", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/recuperar", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/recuperar/[token]", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/invitacion/[token]", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/salud", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/muestrario", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  {
    patron: "/telefono",
    superficie: "telefono",
    acceso: { tipo: "capacidad", alguna: ["telefono.inicio.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/telefono/topes",
    superficie: "telefono",
    acceso: { tipo: "capacidad", alguna: ["telefono.topes.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/telefono/facturacion",
    superficie: "telefono",
    acceso: { tipo: "capacidad", alguna: ["telefono.facturacion.ver"] },
    conEmpresa: true,
  },
  { patron: "/empresas", superficie: "cliente", acceso: { tipo: "sesion" }, conEmpresa: false },
  {
    // Abre con cualquier rol de consola: sin cliente.resumen.ver la página manda a Pendientes.
    patron: "/consola",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.consola.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/pendientes",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.consola.ver"] },
    conEmpresa: true,
  },
  {
    // La apariencia es de cada persona: basta la sesión con su empresa, sin capacidad.
    patron: "/consola/apariencia",
    superficie: "cliente",
    acceso: { tipo: "sesion" },
    conEmpresa: true,
  },
  {
    patron: "/consola/configuracion",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.configuracion.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/configuracion/plan",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.plan.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/personas",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.maestro.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/personas/areas",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.maestro.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/personas/nueva",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.maestro.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/personas/nomina",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.maestro.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/personas/nomina/[loteId]",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.maestro.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/personas/[id]",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.maestro.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/politica",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.politica.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/proveedores",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.proveedores.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/proveedores/nuevo",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.pago.solicitar"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/proveedores/nuevo-proveedor",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.proveedores.alta"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/proveedores/documento/[id]",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.proveedores.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/poliza",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.poliza.ver"] },
    conEmpresa: true,
  },
  // Hasta la fase 5, el personal del operador carga la 69-B y publica el
  // precio desde estas dos rutas. El cliente solo las lee.
  {
    patron: "/consola/lista-69b",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.lista69b.ver", "plataforma.lista69b.cargar"] },
    conEmpresa: true,
  },
  {
    patron: "/precios",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.precio.ver", "plataforma.precio.publicar"] },
    conEmpresa: true,
  },
  // El layout y las acciones vuelven a exigir la superficie SOFIPO y la capacidad.
  { patron: "/operacion/entrar", superficie: "sofipo", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/operacion/continuar", superficie: "sofipo", acceso: { tipo: "segundo_factor" }, conEmpresa: false },
  { patron: "/operacion", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/operacion/clientes", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/operacion/clientes/[id]", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/operacion/aprobaciones", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/operacion/alertas", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/operacion/comisiones", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/operacion/bitacora", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/operacion/recuperaciones", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/operacion/precios", superficie: "sofipo", acceso: { tipo: "sesion" }, conEmpresa: false },
] as const satisfies readonly Ruta[];

export type PatronDeRuta = (typeof RUTAS)[number]["patron"];

/** La proxy la pone; el navegador no. Si llega de fuera, se borra. */
export const CABECERA_EMPRESA = "x-plataforma-empresa";
export const CABECERA_PETICION = "x-plataforma-peticion";

const PREFIJO_EMPRESA = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/i;

export function separarEmpresa(pathname: string): { empresa: string | null; resto: string } {
  const coincidencia = PREFIJO_EMPRESA.exec(pathname);
  if (!coincidencia) return { empresa: null, resto: pathname };
  const resto = coincidencia[2] && coincidencia[2] !== "/" ? coincidencia[2] : "/consola";
  return { empresa: (coincidencia[1] ?? "").toLowerCase(), resto };
}

export function rutaDe(pathname: string): Ruta | null {
  const limpio = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const ruta of RUTAS as readonly Ruta[]) {
    if (coincide(ruta.patron, limpio)) return ruta;
  }
  return null;
}

export function rutaDeclarada(patron: PatronDeRuta): Ruta {
  const ruta = (RUTAS as readonly Ruta[]).find((candidata) => candidata.patron === patron);
  if (!ruta) throw new Error(`Ruta sin declarar: ${patron}`);
  return ruta;
}

/** El enlace canónico lleva la empresa en la ruta. */
export function enEmpresa(empresaId: string | null | undefined, ruta: string): string {
  if (!empresaId) return ruta;
  const declarada = rutaDe(ruta.split("?")[0] ?? ruta);
  if (!declarada?.conEmpresa) return ruta;
  return `/c/${empresaId}${ruta}`;
}

/** La consola abre cifras solo con permiso financiero; el resto aterriza en sus acciones. */
export function rutaConsola(capacidades: readonly Capacidad[]): "/consola" | "/consola/pendientes" {
  return tiene(capacidades, "cliente.resumen.ver") ? "/consola" : "/consola/pendientes";
}

function coincide(patron: string, pathname: string): boolean {
  const partesPatron = patron.split("/");
  const partes = pathname.split("/");
  if (partesPatron.length !== partes.length) return false;
  return partesPatron.every((parte, indice) => {
    const real = partes[indice] ?? "";
    if (parte.startsWith("[") && parte.endsWith("]")) return /^[A-Za-z0-9_-]{1,128}$/.test(real);
    return parte === real;
  });
}
