import type { Metadata } from "next";
import Link from "next/link";

import { Icono } from "@/components/landing/iconos";
import { LogoArco } from "@/components/landing/logo-arco";
import { VisualHero } from "@/components/landing/visual-hero";

export const metadata: Metadata = {
  title: "La tarjeta empresarial que ordena cada gasto",
  description:
    "ARCO reúne tarjetas empresariales, reglas, comprobantes y decisiones de finanzas en una plataforma diseñada para equipos mexicanos.",
};

const BENEFICIOS = [
  {
    numero: "01",
    titulo: "Comprobación sin persecuciones",
    detalle: "Cada gasto reúne su cargo, comprobante, aprobación y contexto. Finanzas deja de armar el expediente pieza por pieza.",
    etiqueta: "XML · Ticket · Expediente",
  },
  {
    numero: "02",
    titulo: "Reglas que acompañan el pago",
    detalle: "Límites por persona, categoría y centro de costo. Todos saben qué pueden gastar antes de que llegue el cierre de mes.",
    etiqueta: "Políticas · Topes · Roles",
  },
  {
    numero: "03",
    titulo: "Decisiones con contexto",
    detalle: "Quien aprueba ve la solicitud, la política y el historial. La doble firma deja de ser un trámite invisible.",
    etiqueta: "Aprobaciones · Dos firmas",
  },
  {
    numero: "04",
    titulo: "Un cierre listo para contabilidad",
    detalle: "La información llega ordenada, con su comprobante y su razón de ser. Menos captura manual y menos diferencias por explicar.",
    etiqueta: "Póliza · Historial · Control",
  },
] as const;

const PASOS = [
  {
    numero: "01",
    titulo: "Cada persona conoce su espacio de gasto.",
    detalle: "Desde la app, el tarjetahabiente ve sus pendientes, sus límites y los datos fiscales de la empresa. Antes de pagar, sabe si la compra cabe en su política.",
  },
  {
    numero: "02",
    titulo: "El comprobante llega al mismo expediente.",
    detalle: "El XML y el ticket se relacionan con el gasto. Si falta algo, la persona ve exactamente qué tiene pendiente y cuánto tiempo le queda para resolverlo.",
  },
  {
    numero: "03",
    titulo: "Las reglas se aplican antes de perseguir errores.",
    detalle: "La política distingue personas, categorías y centros de costo. Cuando una excepción necesita decisión, llega a quien puede aprobarla con todo el contexto.",
  },
  {
    numero: "04",
    titulo: "Finanzas cierra con una sola versión de la verdad.",
    detalle: "El gasto, sus aprobaciones y sus documentos quedan juntos. La contabilidad recibe un expediente legible, no una carpeta llena de pendientes.",
  },
] as const;

const INDUSTRIAS = [
  {
    titulo: "Logística y transporte",
    detalle: "Combustible, casetas y viáticos de ruta con reglas para cada persona y cada recorrido.",
    etiqueta: "Rutas · Combustible · Viáticos",
  },
  {
    titulo: "Equipos comerciales",
    detalle: "Viajes, comidas y eventos vinculados a un cliente, un proyecto y un presupuesto entendible.",
    etiqueta: "Clientes · Viajes · Proyectos",
  },
  {
    titulo: "Construcción y obra",
    detalle: "Materiales y gastos separados por obra y responsable, sin mezclar la operación de cada frente.",
    etiqueta: "Obras · Centros de costo · Proveedores",
  },
  {
    titulo: "Agencias y servicios",
    detalle: "Suscripciones y gastos para clientes con sus comprobantes listos para revisión y contabilidad.",
    etiqueta: "Suscripciones · Clientes · Pólizas",
  },
] as const;

const PREGUNTAS = [
  {
    pregunta: "¿La tarjeta de ARCO es de crédito?",
    respuesta: "No. La propuesta de ARCO parte de una tarjeta recargable, prefondeada contra la cuenta de la empresa. El crédito queda fuera de esta experiencia.",
  },
  {
    pregunta: "¿Cómo se comprueba un gasto?",
    respuesta: "El gasto reúne su cargo, comprobante, aprobación y contexto en un mismo expediente. El XML y el ticket se relacionan con esa operación para que finanzas no tenga que unirlos a mano.",
  },
  {
    pregunta: "¿ARCO sustituye a nuestro contador o al ERP?",
    respuesta: "No. ARCO ordena la operación del gasto y prepara información útil para contabilidad. No sustituye el criterio de tu contador ni convierte tu ERP en una dependencia para trabajar.",
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

      <div className="arco-header-envoltura">
        <header className="arco-header">
          <Link href="/" className="arco-header-marca" aria-label="ARCO, inicio">
            <LogoArco inverso />
          </Link>
          <nav className="arco-nav" aria-label="Navegación principal">
            <a href="#producto">Producto</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#para-quien">Para quién</a>
            <Link href="/precios">Precios</Link>
            <a href="#preguntas">Preguntas</a>
          </nav>
          <div className="arco-header-acciones">
            <Link href="/entrar" className="arco-entrar">Entrar</Link>
            <Link href="/muestrario" className="arco-boton arco-boton-claro arco-boton-compacto">
              Ver demo
              <Icono nombre="flecha" />
            </Link>
          </div>
        </header>
      </div>

      <main id="contenido">
        <div className="arco-hero-universo">
          <div className="arco-hero-bruma" aria-hidden="true" />
          <section className="arco-hero" aria-labelledby="titulo-inicio">
            <div className="arco-hero-copy">
              <p className="arco-eyebrow arco-eyebrow-claro">
                <span aria-hidden="true" />
                Finanzas empresariales · México
              </p>
              <h1 id="titulo-inicio">
                La tarjeta empresarial que pone <span>cada gasto en su lugar.</span>
              </h1>
              <p className="arco-hero-lede">
                Tarjetas para tu equipo, reglas que se entienden y comprobantes que llegan al expediente correcto. Finanzas
                decide con contexto, desde una sola plataforma.
              </p>
              <div className="arco-hero-acciones">
                <Link href="/muestrario" className="arco-boton arco-boton-claro">
                  Ver la demo
                  <Icono nombre="flecha" />
                </Link>
                <a href="#como-funciona" className="arco-boton arco-boton-linea">Ver cómo funciona</a>
              </div>
              <p className="arco-hero-nota">Tarjeta recargable · Sin crédito · Control para toda la empresa</p>
            </div>
            <VisualHero />
            <div className="arco-hero-pie" aria-hidden="true">
              <span>Desliza para conocer ARCO</span>
              <i />
              <strong>TODO TU DINERO EN UN SOLO LUGAR</strong>
            </div>
          </section>

          <section className="arco-franja" aria-label="La plataforma ARCO">
            <p>Un solo núcleo para ordenar el gasto</p>
            <ul>
              <li>Tarjetas</li>
              <li>Comprobantes</li>
              <li>Proveedores</li>
              <li>Aprobaciones</li>
              <li>Contabilidad</li>
            </ul>
          </section>
        </div>

      <section className="arco-capitulo arco-producto" id="producto" aria-labelledby="titulo-producto">
        <div className="arco-capitulo-cabeza">
          <p className="arco-eyebrow"><span aria-hidden="true" />El producto</p>
          <h2 id="titulo-producto">Menos tickets perdidos.<br />Más tiempo para tu negocio.</h2>
          <p>ARCO convierte el gasto diario en un proceso claro para quien paga, quien aprueba y quien contabiliza.</p>
        </div>
        <div className="arco-beneficios">
          {BENEFICIOS.map((beneficio) => (
            <article className="arco-beneficio" key={beneficio.numero}>
              <span className="arco-indice">{beneficio.numero}</span>
              <h3>{beneficio.titulo}</h3>
              <p>{beneficio.detalle}</p>
              <small>{beneficio.etiqueta}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="arco-recorrido" id="como-funciona" aria-labelledby="titulo-recorrido">
        <div className="arco-recorrido-bruma" aria-hidden="true" />
        <div className="arco-recorrido-interior">
          <div className="arco-capitulo-cabeza arco-capitulo-cabeza-oscura">
            <p className="arco-eyebrow arco-eyebrow-claro"><span aria-hidden="true" />Cómo funciona</p>
            <h2 id="titulo-recorrido">Del pago al cierre de mes,<br />sin perseguir a nadie.</h2>
            <p>Una experiencia simple para el equipo. Una estructura rigurosa para finanzas.</p>
          </div>

          <div className="arco-experiencia">
            <div className="arco-telefono-demo" role="img" aria-label="Vista ilustrativa de la app ARCO con saldo y validación de una compra">
              <div className="arco-telefono-marco">
                <div className="arco-telefono-isla" aria-hidden="true" />
                <div className="arco-app-cabeza">
                  <LogoArco inverso />
                  <span>•••</span>
                </div>
                <p className="arco-app-saludo">Hola, Jorge</p>
                <p className="arco-app-saldo">$12,850<small>.00 MXN</small></p>
                <p className="arco-app-disponible">Disponible para gastar</p>
                <div className="arco-app-consulta">
                  <small>ANTES DE PAGAR</small>
                  <strong>¿Cabe en tu política?</strong>
                  <div>
                    <span>Cena con cliente</span>
                    <b>$2,840</b>
                  </div>
                  <p><Icono nombre="check" />Dentro de tu límite diario</p>
                </div>
                <div className="arco-app-boton">Ver movimientos <Icono nombre="flecha" /></div>
                <div className="arco-app-nav" aria-hidden="true">
                  <span>Inicio</span><span>Tarjeta</span><span>Pendientes</span>
                </div>
              </div>
              <p>Vista ilustrativa de la experiencia</p>
            </div>

            <ol className="arco-pasos">
              {PASOS.map((paso) => (
                <li key={paso.numero}>
                  <span className="arco-paso-numero">{paso.numero}</span>
                  <div>
                    <h3>{paso.titulo}</h3>
                    <p>{paso.detalle}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="arco-capitulo arco-industrias" id="para-quien" aria-labelledby="titulo-industrias">
        <div className="arco-capitulo-cabeza">
          <p className="arco-eyebrow"><span aria-hidden="true" />Para quién</p>
          <h2 id="titulo-industrias">Para equipos que gastan<br />fuera de la oficina.</h2>
          <p>La misma claridad de finanzas, adaptada a la manera en que realmente trabaja cada equipo.</p>
        </div>
        <div className="arco-industrias-rejilla">
          {INDUSTRIAS.map((industria, indice) => (
            <article key={industria.titulo}>
              <span className="arco-indice">0{indice + 1}</span>
              <h3>{industria.titulo}</h3>
              <p>{industria.detalle}</p>
              <small>{industria.etiqueta}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="arco-mexico" id="mexico" aria-labelledby="titulo-mexico">
        <div className="arco-mexico-marca" aria-hidden="true">MX</div>
        <div className="arco-mexico-copy">
          <p className="arco-eyebrow"><span aria-hidden="true" />Hecho para México</p>
          <h2 id="titulo-mexico">Hecho para cómo<br />se trabaja en México.</h2>
          <p>
            RFC, CLABE, CFDI y lista 69-B no son una capa añadida al final. Forman parte del expediente y de las preguntas
            que finanzas necesita responder.
          </p>
          <ul>
            <li><Icono nombre="check" />Datos fiscales siempre a la mano</li>
            <li><Icono nombre="check" />XML y comprobantes dentro del expediente</li>
            <li><Icono nombre="check" />Proveedores con CLABE e historial de cambios</li>
            <li><Icono nombre="check" />Información ordenada para tu contador</li>
          </ul>
        </div>
        <div className="arco-mexico-ficha" aria-label="Ejemplo de un expediente de gasto completo">
          <div className="arco-mexico-ficha-cabeza">
            <span>Expediente del gasto</span>
            <span className="arco-punto" aria-hidden="true" />
          </div>
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
      </section>

      <section className="arco-precios-resumen" aria-labelledby="titulo-precios">
        <div>
          <p className="arco-eyebrow"><span aria-hidden="true" />Precios</p>
          <h2 id="titulo-precios">Un plan claro para cada etapa.</h2>
        </div>
        <div>
          <p>Conoce cómo se estructura ARCO para tu equipo, sin cifras inventadas ni paquetes que no corresponden a tu operación.</p>
          <Link href="/precios" className="arco-enlace">Consultar precios <Icono nombre="flecha" /></Link>
        </div>
      </section>

      <section className="arco-preguntas" id="preguntas" aria-labelledby="titulo-preguntas">
        <div className="arco-preguntas-intro">
          <p className="arco-eyebrow"><span aria-hidden="true" />Preguntas frecuentes</p>
          <h2 id="titulo-preguntas">Antes de empezar,<br />hablemos claro.</h2>
        </div>
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
        <div className="arco-cierre-bruma" aria-hidden="true" />
        <LogoArco inverso />
        <p className="arco-eyebrow arco-eyebrow-claro"><span aria-hidden="true" />Tu empresa, en orden</p>
        <h2 id="titulo-cierre">El control se siente<br /><span>muy distinto.</span></h2>
        <p>Menos ruido para tu equipo. Más claridad para cada decisión.</p>
        <div className="arco-cierre-acciones">
          <Link href="/muestrario" className="arco-boton arco-boton-claro">Ver la demo <Icono nombre="flecha" /></Link>
          <Link href="/entrar" className="arco-boton arco-boton-linea">Entrar a mi cuenta</Link>
        </div>
      </section>
      </main>

      <footer className="arco-footer">
        <div className="arco-footer-interior">
          <div className="arco-footer-marca">
            <LogoArco inverso />
            <p>TODO TU DINERO EN UN SOLO LUGAR</p>
          </div>
          <nav aria-label="Navegación del pie de página">
            <a href="#producto">Producto</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#para-quien">Para quién</a>
            <Link href="/precios">Precios</Link>
            <a href="#preguntas">Preguntas</a>
            <Link href="/entrar">Entrar</Link>
          </nav>
          <p className="arco-footer-nota">ARCO · Control de gasto empresarial, diseñado para México.</p>
        </div>
      </footer>
    </div>
  );
}
