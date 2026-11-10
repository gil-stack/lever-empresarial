import { Aviso } from "@/components/sistema";
import { contextoOpcional } from "@/server/entrada";
import { empresaSuspendida } from "@/server/empresa/estado";

/**
 * El aviso de empresa suspendida, arriba de toda la consola. Lee el mismo contexto de la página
 * (se pide una vez por petición). No dice el motivo: una suspensión por la Lista de Personas
 * Bloqueadas no se anuncia al cliente en pantalla; Lever le avisa por escrito.
 */
export async function AvisoEmpresaSuspendida() {
  const ctx = await contextoOpcional("cliente");
  if (!empresaSuspendida(ctx?.empresa)) return null;
  return (
    <div className="aviso-empresa-suspendida" style={{ position: "relative", zIndex: 2, padding: "12px 16px 0" }}>
      <Aviso tono="revisar" titulo={`La operación de ${ctx?.empresa?.razonSocial ?? "tu empresa"} está suspendida.`}>
        <p>Puedes consultar tu información, pero no mover dinero, preparar nómina ni hacer cambios. Comunícate con Lever para conocer el motivo.</p>
      </Aviso>
    </div>
  );
}
