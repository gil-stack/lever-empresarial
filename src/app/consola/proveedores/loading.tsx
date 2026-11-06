export default function CargandoProveedores() {
  return <main id="contenido" className="pagina pagina-proveedores" aria-busy="true" aria-label="Cargando pagos a proveedores">
    <div className="carga-cabeza"><span /><span /><span /></div>
    <div className="carga-metricas">{[1, 2, 3, 4].map((item) => <div key={item} />)}</div>
    <div className="carga-bandeja"><div /><div /><div /><div /></div>
    <p className="solo-lector" role="status">Cargando pagos y proveedores</p>
  </main>;
}
