import type { Metadata } from "next";
import Link from "next/link";

import { Logotipo } from "@/components/cromo/logotipo";
import { Icono } from "@/components/landing/iconos";
import { VisualHero } from "@/components/landing/visual-hero";

export const metadata: Metadata = {
  title: "Finanzas empresariales, en orden",
  description:
    "LEVER reúne tarjetas empresariales, reglas, comprobantes y decisiones de finanzas en una plataforma diseñada para equipos mexicanos.",
};

const BENEFICIOS = [
  {
    titulo: "Comprobantes en su lugar",
    detalle: "Cada gasto reúne su cargo, comprobante, aprobación y contexto. Finanzas deja de armar el expediente pieza por pieza.",
  },
  {
    titulo: "Reglas que se entienden",
    detalle: "Límites por persona, categoría y centro de costo. Todo el equipo sabe qué puede gastar antes de llegar el cierre.",
  },
  {
    titulo: "Decisiones con contexto",
    detalle: "Quien aprueba ve la solicitud, la política y el historial. La doble firma deja de ser un trámite invisible.",
  },
  {
    titulo: "Un cierre más simple",
    detalle: "La información llega ordenada, con su comprobante y su razón de ser. Menos captura manual y menos diferencias por explicar.",
  },
] as const;

const PASOS = [
  {
    numero: "01",
    titulo: "Cada persona conoce su espacio de gasto.",
    detalle: "El equipo ve sus pendientes, sus límites y los datos fiscales de la empresa antes de pagar.",
  },
  {
    numero: "02",
    titulo: "El comprobante llega al expediente correcto.",
    detalle: "El XML y el ticket se relacionan con el gasto. Cada pendiente queda claro y tiene un responsable.",
  },
  {
    numero: "03",
    titulo: "Finanzas cierra con una sola versión de la verdad.",
    detalle: "El gasto, sus aprobaciones y sus documentos quedan juntos, listos para revisión y contabilidad.",
  },
] as const;

const INDUSTRIAS = [
  { titulo: "Logística y transporte", detalle: "Combustible, casetas y viáticos con reglas para cada recorrido." },
  { titulo: "Equipos comerciales", detalle: "Viajes, comidas y eventos vinculados a un cliente y un presupuesto." },
  { titulo: "Construcción y obra", detalle: "Materiales y gastos separados por obra y responsable." },
  { titulo: "Agencias y servicios", detalle: "Suscripciones y gastos para clientes, listos para contabilidad." },
] as const;

const PREGUNTAS = [
  {
    pregunta: "¿La tarjeta de LEVER es de crédito?",
    respuesta: "No. La propuesta de LEVER parte de una tarjeta recargable, prefondeada contra la cuenta de la empresa. El crédito queda fuera de esta experiencia.",
  },
  {
    pregunta: "¿Cómo se comprueba un gasto?",
    respuesta: "El gasto reúne su cargo, comprobante, aprobación y contexto en un mismo expediente. El XML y el ticket se relacionan con esa operación para que finanzas no tenga que unirlos a mano.",
  },
  {
    pregunta: "¿LEVER sustituye a nuestro contador o al ERP?",
    respuesta: "No. LEVER ordena la operación del gasto y prepara información útil para contabilidad. No sustituye el criterio de tu contador ni convierte tu ERP en una dependencia para trabajar.",
  },
  {
    pregunta: "¿Podemos decidir quién aprueba?",
    respuesta: "Sí. La estructura contempla políticas por persona y categoría, responsables, roles y la participación de dos liberadores distintos para las decisiones que lo requieren.",
  },
] as const;

export default function PaginaInicio() {
  return (
    <div className="arco-landing">
      <a className="arco-saltar" href="#contenido">Saltar al contenido</a>
      <header className="arco-header">
        <Link href="/" className="arco-header-marca" aria-label="Lever Empresas, inicio"><Logotipo /></Link>
        <nav className="arco-nav" aria-label="Navegación principal">
          <a href="#producto">Producto</a>
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#para-quien">Para quién</a>
          <a href="#precios">Precios</a>
          <a href="#preguntas">Preguntas</a>
        </nav>
        <div className="arco-header-acciones">
          <Link href="/entrar" className="arco-entrar">Entrar</Link>
          <Link href="#producto" className="arco-boton arco-boton-principal arco-boton-compacto">
            Ver el producto <Icono nombre="flecha" />
          </Link>
        </div>
      </header>

      <main id="contenido">
        <section className="arco-hero" aria-labelledby="titulo-inicio">
          <div className="arco-hero-copy">
            <p className="arco-eyebrow">Finanzas empresariales · México</p>
            <h1 id="titulo-inicio">Finanzas empresariales,<br /><span>en orden.</span></h1>
            <p className="arco-hero-lede">
              Tarjetas para tu equipo, reglas claras y comprobantes en el expediente correcto. Una sola plataforma para
              controlar el gasto de tu empresa.
            </p>
            <div className="arco-hero-acciones">
              <Link href="#producto" className="arco-boton arco-boton-principal">Ver el producto <Icono nombre="flecha" /></Link>
              <a href="#como-funciona" className="arco-boton arco-boton-secundario">Cómo funciona</a>
            </div>
            <p className="arco-hero-nota">Tarjeta recargable · Sin crédito · Control para toda la empresa</p>
          </div>
          <VisualHero />
        </section>

        <section className="arco-franja" aria-label="La plataforma LEVER">
          <p>Un solo núcleo para ordenar el gasto</p>
          <ul>
            <li>Tarjetas</li><li>Comprobantes</li><li>Proveedores</li><li>Aprobaciones</li><li>Contabilidad</li>
          </ul>
        </section>

        <section className="arco-capitulo" id="producto" aria-labelledby="titulo-producto">
          <div className="arco-capitulo-cabeza">
            <p className="arco-eyebrow">El producto</p>
            <h2 id="titulo-producto">Menos tickets perdidos.<br />Más tiempo para tu negocio.</h2>
            <p>LEVER convierte el gasto diario en un proceso claro para quien paga, quien aprueba y quien contabiliza.</p>
          </div>
          <div className="arco-beneficios">
            {BENEFICIOS.map((beneficio) => (
              <article className="arco-beneficio" key={beneficio.titulo}>
                <h3>{beneficio.titulo}</h3>
                <p>{beneficio.detalle}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="arco-recorrido" id="como-funciona" aria-labelledby="titulo-recorrido">
          <div className="arco-capitulo-cabeza">
            <p className="arco-eyebrow">Cómo funciona</p>
            <h2 id="titulo-recorrido">Del pago al cierre de mes,<br />sin perseguir a nadie.</h2>
            <p>Una experiencia simple para el equipo. Un proceso riguroso para finanzas.</p>
          </div>
          <div className="arco-experiencia">
            <ol className="arco-pasos">
              {PASOS.map((paso) => (
                <li key={paso.numero}>
                  <span className="arco-paso-numero">{paso.numero}</span>
                  <div><h3>{paso.titulo}</h3><p>{paso.detalle}</p></div>
                </li>
              ))}
            </ol>
            <div className="arco-mexico-ficha" aria-label="Ejemplo de un expediente de gasto completo">
              <div className="arco-mexico-ficha-cabeza"><span>Expediente del gasto</span><span className="arco-punto" /></div>
              <h3>Todo en su lugar.</h3>
              <ul>
                <li><span>Cargo</span><strong>Registrado</strong></li>
                <li><span>XML</span><strong>Relacionado</strong></li>
                <li><span>Aprobaciones</span><strong>2 de 2</strong></li>
                <li><span>Centro de costo</span><strong>Asignado</strong></li>
                <li><span>Contabilidad</span><strong>Lista para revisar</strong></li>
              </ul>
              <p>Vista ilustrativa del producto.</p>
            </div>
          </div>
        </section>

        <section className="arco-capitulo" id="para-quien" aria-labelledby="titulo-industrias">
          <div className="arco-capitulo-cabeza">
            <p className="arco-eyebrow">Para quién</p>
            <h2 id="titulo-industrias">Para equipos que gastan<br />fuera de la oficina.</h2>
            <p>La misma claridad de finanzas, adaptada a la manera en que trabaja cada equipo.</p>
          </div>
          <div className="arco-industrias-rejilla">
            {INDUSTRIAS.map((industria) => (
              <article key={industria.titulo}><h3>{industria.titulo}</h3><p>{industria.detalle}</p></article>
            ))}
          </div>
        </section>

        <section className="arco-mexico" id="mexico" aria-labelledby="titulo-mexico">
          <div className="arco-mexico-copy">
            <p className="arco-eyebrow">Hecho para México</p>
            <h2 id="titulo-mexico">Hecho para cómo<br />se trabaja en México.</h2>
            <p>RFC, CLABE, CFDI y lista 69-B forman parte del expediente desde el inicio, no una capa añadida al final.</p>
          </div>
          <ul className="arco-mexico-lista">
            <li><Icono nombre="check" />Datos fiscales siempre a la mano</li>
            <li><Icono nombre="check" />XML y comprobantes dentro del expediente</li>
            <li><Icono nombre="check" />Proveedores con CLABE e historial de cambios</li>
            <li><Icono nombre="check" />Información ordenada para tu contador</li>
          </ul>
        </section>

        <section className="arco-precios-resumen" id="precios" aria-labelledby="titulo-precios">
          <div><p className="arco-eyebrow">Precios</p><h2 id="titulo-precios">Un plan claro para cada etapa.</h2></div>
          <div>
            <p>Conoce cómo se estructura LEVER para tu equipo, sin cifras inventadas ni paquetes que no corresponden a tu operación.</p>
          </div>
        </section>

        <section className="arco-preguntas" id="preguntas" aria-labelledby="titulo-preguntas">
          <div className="arco-preguntas-intro"><p className="arco-eyebrow">Preguntas frecuentes</p><h2 id="titulo-preguntas">Antes de empezar,<br />hablemos claro.</h2></div>
          <div className="arco-preguntas-lista">
            {PREGUNTAS.map((pregunta, indice) => (
              <details key={pregunta.pregunta} open={indice === 0}>
                <summary>{pregunta.pregunta}<span aria-hidden="true" /></summary>
                <p>{pregunta.respuesta}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="arco-cierre" aria-labelledby="titulo-cierre">
          <Logotipo />
          <p className="arco-eyebrow">Tu empresa, en orden</p>
          <h2 id="titulo-cierre">Menos ruido.<br />Más claridad.</h2>
          <p>Una mejor manera de trabajar con el dinero de tu empresa.</p>
          <div className="arco-cierre-acciones">
            <Link href="#producto" className="arco-boton arco-boton-claro">Ver el producto <Icono nombre="flecha" /></Link>
            <Link href="/entrar" className="arco-boton arco-boton-linea">Entrar a mi cuenta</Link>
          </div>
        </section>
      </main>

      <footer className="arco-footer">
        <Logotipo />
        <nav aria-label="Navegación del pie de página">
          <a href="#producto">Producto</a><a href="#como-funciona">Cómo funciona</a><a href="#para-quien">Para quién</a>
          <a href="#precios">Precios</a><a href="#preguntas">Preguntas</a><Link href="/entrar">Entrar</Link>
        </nav>
        <p>LEVER · Control de gasto empresarial, diseñado para México.</p>
      </footer>
    </div>
  );
}
