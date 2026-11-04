import type { Capacidad, Superficie } from "./capacidades";

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
  { patron: "/entrar/seguridad", superficie: "cliente", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/entrar/recuperaciones", superficie: "cliente", acceso: { tipo: "sesion" }, conEmpresa: false },
  { patron: "/recuperar", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/recuperar/[token]", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/invitacion/[token]", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/salud", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/muestrario", superficie: "cliente", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/telefono", superficie: "telefono", acceso: { tipo: "publica" }, conEmpresa: false },
  { patron: "/empresas", superficie: "cliente", acceso: { tipo: "sesion" }, conEmpresa: false },
  {
    patron: "/consola",
    superficie: "cliente",
    acceso: { tipo: "capacidad", alguna: ["cliente.consola.ver"] },
    conEmpresa: true,
  },
  {
    patron: "/consola/personas",
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
