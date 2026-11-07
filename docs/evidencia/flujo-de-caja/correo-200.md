# Correo semanal con 200 empresas

Salida literal de `MEDICION_ADMIN_URL=postgres://<dueño>@127.0.0.1:5541/postgres npx tsx scripts/evidencia/flujo-de-caja-correo-200.ts` (Postgres 17 local, Apple Silicon, carga promedio de la máquina entre 147 y 210 por otros agentes). La tarea es la real; solo el proveedor de correo es simulado.

Empresas reales dadas de alta por los servicios: 200 (cada una con administradora, saldo, un cobro y una obligación), en 152.7 s.
Tarea: concurrencia 3 (tope del pool), presupuesto 240 s de los 300 s de maxDuration.
Proveedor simulado: 150 ms por llamada. Límite de Resend: 10 peticiones por segundo por equipo, sin ráfaga.
Postgres 17 local; la base no tiene la latencia de red de Neon, así que el tiempo de base es un piso.

| Corrida | Ritmo | Empresas | Correos | Pendientes | Total s | ms por empresa | Máx. envíos en 1 s | Separación mínima ms | Empresas que caben en 240 s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Con ritmo (producción) | 200 ms | 200 | 200 | 0 | 40.0 | 200 | 6 | 198.4 | 1200 |
| Sin ritmo (para comparar) | 0 ms | 200 | 200 | 0 | 11.2 | 56 | 21 | 0.2 | 4269 |

En la base, por semana (envíos cerrados como «enviado» y entregas por persona): [{"semana":"2026-11-09","entregas":200,"enviados":200},{"semana":"2026-11-16","entregas":200,"enviados":200}]
