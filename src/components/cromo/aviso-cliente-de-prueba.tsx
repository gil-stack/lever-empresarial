import { Aviso } from "@/components/sistema";
import { contextoOpcional } from "@/server/entrada";

/**
 * La marca de un cliente de prueba (alta rápida, 0050) arriba de toda la consola: la empresa no pasó el alta regulada y
 * sus tarjetas van al ambiente de pruebas, así que nada de lo que se ve aquí es dinero real.
 */
export async function AvisoClienteDePrueba() {
  const ctx = await contextoOpcional("cliente");
  if (ctx?.empresa?.dePrueba !== true) return null;
  return (
    <div className="aviso-cliente-de-prueba" style={{ position: "relative", zIndex: 2, padding: "12px 16px 0" }}>
      <Aviso tono="revisar" titulo={`${ctx.empresa.razonSocial} es un cliente de prueba.`}>
        <p>Sirve para probar Lever: las tarjetas y los saldos son de prueba, no dinero real.</p>
      </Aviso>
    </div>
  );
}
