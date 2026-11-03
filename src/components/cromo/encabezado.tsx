import Link from "next/link";

const SUPERFICIES = [
  { href: "/", etiqueta: "Alta" },
  { href: "/consola", etiqueta: "Consola" },
  { href: "/telefono", etiqueta: "Teléfono" },
] as const;

export function Encabezado({ actual }: { actual: (typeof SUPERFICIES)[number]["href"] }) {
  return (
    <header className="encabezado">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <div className="encabezado-interior">
        <Link href="/" className="marca">
          <span className="marca-sello" aria-hidden="true" />
          Plataforma
        </Link>
        <nav aria-label="Superficies">
          <ul>
            {SUPERFICIES.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={item.href === actual ? "page" : undefined}>
                  {item.etiqueta}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function Pie() {
  return (
    <footer className="pie">
      <p>El saldo vive con el participante de la CLABE. El plástico vive con el emisor.</p>
    </footer>
  );
}
