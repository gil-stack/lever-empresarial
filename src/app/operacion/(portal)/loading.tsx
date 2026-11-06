/** Mientras llega la sección: la forma de la página, sin cifras inventadas. */
export default function CargandoOperacion() {
  return (
    <main id="contenido" className="pagina operacion-pagina operacion-carga" aria-busy="true">
      <div className="operacion-carga-titulo" />
      <div className="operacion-carga-hoja">
        <div />
        <div />
        <div />
      </div>
      <p className="solo-lector" role="status">
        Cargando la sección
      </p>
    </main>
  );
}
