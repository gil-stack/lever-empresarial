# Rendimiento del runway

Salida literal de `MEDICION_ADMIN_URL=postgres://<dueño>@127.0.0.1:5583/postgres npx tsx scripts/evidencia/runway-medicion.ts`, corrida el 2026-11-10 contra el build de `.next` de esta rama (`next start` en el puerto 3183). La tarea y la página son las reales; solo el proveedor de correo es simulado.

Fecha de la corrida (México): 2026-11-10. Postgres 17 local en Apple Silicon: la base no tiene la latencia de red de Neon, así que el tiempo de base es un piso.

## 1. Tarea de alertas de caja con 1,000 empresas

Empresas reales dadas de alta por el servicio: 1000, en 0.6 s. Cada una con administradora, saldo declarado ayer y una renta mensual que vence en 3 días:
- 250 con $100,000 y renta de $60,000: cruzan el colchón (el saldo queda negativo) y el mínimo de 3 meses; un aviso con las dos.
- 250 con $500,000, renta de $60,000 y colchón de $450,000: cruzan solo el colchón.
- 500 con $2,000,000 y renta de $30,000: sin aviso.

La mitad de las empresas cruzando a la vez es el peor caso, no el día normal: sirve para ver el tope del ritmo de correo.
Tarea: concurrencia 3 (tope del pool), presupuesto 240 s de los 300 s de maxDuration, ritmo de correo 200 ms. Proveedor simulado: 150 ms por llamada.

| Corrida | Empresas | Evaluadas | Fotos | Avisos | Enviados | Fallidos | Pendientes | Fallidas | Filas nuevas en la bitácora | Total s | ms por empresa |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Primera de la semana | 1000 | 1000 | 1000 | 500 | 500 | 0 | 0 | 0 | 2500 | 100.0 | 100 |
| 15 minutos después, sin cambios | 1000 | 1000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.4 | 1 |

En la base después de las dos corridas: {"fotos":1000,"fotos_semana":1000,"avisos_por_estado":{"enviado":500},"avisos_colchon_y_runway":250,"avisos_solo_colchon":250,"estados_bajo_colchon":500,"estados_runway_bajo":250,"entregas":500}

Línea de registro de cada corrida (lo único que la tarea escribe en los registros):
```
{"evento":"alertas_caja_corrida","empresas":1000,"evaluadas":1000,"fotos":1000,"avisos":500,"enviados":500,"fallidos":0,"fallidas":0,"pendientes":0,"ms":99981}
{"evento":"alertas_caja_corrida","empresas":1000,"evaluadas":1000,"fotos":0,"avisos":0,"enviados":0,"fallidos":0,"fallidas":0,"pendientes":0,"ms":1401}
```

## 2. /consola/flujo con volumen

Volumen visible para la empresa (RLS, plataforma_cliente): {"cuentas_por_pagar":1000,"solicitudes":700,"nomina":200,"cobros_esperados":100,"obligaciones":12,"planes":50,"cargos_de_cobranza":1000,"fotos":12}
Volumen ajeno en la misma base: otra empresa con 20,000 cuentas por pagar y las 1,000 empresas de la tarea (RLS las deja fuera).
Vueltas por medición: 100 tras 10 de calentamiento, en serie.

| Medición | p50 ms | p95 ms | p99 ms | máx ms |
| --- | ---: | ---: | ---: | ---: |
| leerVistaRunway (fuentes + planes en 1 sentencia, N, estado, fotos, aviso) | 16.4 | 18.6 | 18.9 | 20.3 |
| leerVistaSaldo (lo que ya leía la página) | 1.1 | 1.7 | 1.8 | 1.9 |
| Las dos en paralelo, como la página | 16.7 | 20.1 | 23.5 | 25.3 |
| GET /consola/flujo por HTTP con next start (HTML completo, 3183) | 33.0 | 38.6 | 40.6 | 41.8 |

EXPLAIN (ANALYZE, BUFFERS) de la sentencia del runway (fuentes + planes), como plataforma_cliente con RLS (movimientos desde 2026-11-10 hasta 2027-11-14):
```
Result (actual time=3.543..3.555 rows=1 loops=1)
  Buffers: shared hit=3732
  InitPlan 1
    ->  Aggregate (actual time=0.376..0.378 rows=1 loops=1)
          Buffers: shared hit=7
          ->  Sort (actual time=0.092..0.099 rows=200 loops=1)
                Sort Key: p.employee_id
                Sort Method: quicksort  Memory: 40kB
                Buffers: shared hit=7
                ->  Result (actual time=0.037..0.069 rows=200 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                      Buffers: shared hit=7
                      ->  Hash Join (actual time=0.035..0.060 rows=200 loops=1)
                            Hash Cond: (e.id = p.employee_id)
                            Buffers: shared hit=7
                            ->  Seq Scan on employees e (actual time=0.005..0.014 rows=200 loops=1)
                                  Filter: (((baja_en IS NULL) OR (baja_en >= '2026-11-10'::date)) AND (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid))
                                  Buffers: shared hit=4
                            ->  Hash (actual time=0.027..0.027 rows=200 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 26kB
                                  Buffers: shared hit=3
                                  ->  Seq Scan on employee_payroll_profiles p (actual time=0.002..0.015 rows=200 loops=1)
                                        Filter: (activa AND (proximo_pago_en <= '2027-11-14'::date) AND (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid))
                                        Buffers: shared hit=3
  InitPlan 3
    ->  Aggregate (actual time=0.003..0.006 rows=1 loops=1)
          ->  Sort (actual time=0.003..0.004 rows=0 loops=1)
                Sort Key: b.fecha_pago, b.id
                Sort Method: quicksort  Memory: 25kB
                ->  Result (actual time=0.002..0.003 rows=0 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                      ->  Seq Scan on payroll_batches b (actual time=0.001..0.002 rows=0 loops=1)
                            Filter: ((fecha_pago >= '2026-11-10'::date) AND (fecha_pago <= '2027-11-14'::date) AND (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid))
          SubPlan 2
            ->  Aggregate (never executed)
                  ->  Result (never executed)
                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = b.company_id)
                        ->  Seq Scan on payroll_batch_items i (never executed)
                              Filter: ((company_id = b.company_id) AND (batch_id = b.id))
  InitPlan 4
    ->  Aggregate (actual time=1.635..1.636 rows=1 loops=1)
          Buffers: shared hit=1348
          ->  Sort (actual time=0.665..0.680 rows=650 loops=1)
                Sort Key: p_1.programada_el, p_1.id
                Sort Method: quicksort  Memory: 82kB
                Buffers: shared hit=1348
                ->  Result (actual time=0.134..0.566 rows=650 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                      Buffers: shared hit=1348
                      ->  Nested Loop (actual time=0.133..0.540 rows=650 loops=1)
                            Buffers: shared hit=1348
                            ->  Hash Left Join (actual time=0.130..0.310 rows=650 loops=1)
                                  Hash Cond: (p_1.id = r.payable_id)
                                  Filter: (COALESCE(r.estado, 'por_autorizar'::text) = ANY ('{por_autorizar,listo_para_pagar}'::text[]))
                                  Rows Removed by Filter: 350
                                  Buffers: shared hit=48
                                  ->  Bitmap Heap Scan on supplier_payables p_1 (actual time=0.017..0.107 rows=1000 loops=1)
                                        Recheck Cond: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                        Filter: ((anulado_en IS NULL) AND (programada_el <= '2027-11-14'::date))
                                        Heap Blocks: exact=25
                                        Buffers: shared hit=29
                                        ->  Bitmap Index Scan on supplier_payables_proveedor_idx (actual time=0.013..0.013 rows=1000 loops=1)
                                              Index Cond: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                              Buffers: shared hit=4
                                  ->  Hash (actual time=0.111..0.111 rows=700 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 61kB
                                        Buffers: shared hit=19
                                        ->  Result (actual time=0.003..0.072 rows=700 loops=1)
                                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                              Buffers: shared hit=19
                                              ->  Seq Scan on supplier_payment_requests r (actual time=0.002..0.038 rows=700 loops=1)
                                                    Filter: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                                    Buffers: shared hit=19
                            ->  Index Scan using suppliers_id_empresa on suppliers s (actual time=0.000..0.000 rows=1 loops=650)
                                  Index Cond: ((id = p_1.supplier_id) AND (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid))
                                  Buffers: shared hit=1300
  InitPlan 6
    ->  Aggregate (actual time=0.073..0.075 rows=1 loops=1)
          Buffers: shared hit=6
          ->  Sort (actual time=0.049..0.050 rows=12 loops=1)
                Sort Key: o.proxima_fecha, o.id
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=6
                ->  Result (actual time=0.041..0.046 rows=12 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                      Buffers: shared hit=6
                      ->  Hash Left Join (actual time=0.035..0.038 rows=12 loops=1)
                            Hash Cond: (o.cost_center_id = c.id)
                            Buffers: shared hit=6
                            ->  Hash Right Join (actual time=0.028..0.031 rows=12 loops=1)
                                  Hash Cond: (s_1.id = o.supplier_id)
                                  Buffers: shared hit=5
                                  ->  Result (actual time=0.006..0.011 rows=50 loops=1)
                                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                        Buffers: shared hit=2
                                        ->  Seq Scan on suppliers s_1 (actual time=0.005..0.008 rows=50 loops=1)
                                              Filter: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                              Rows Removed by Filter: 20
                                              Buffers: shared hit=2
                                  ->  Hash (actual time=0.013..0.013 rows=12 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 10kB
                                        Buffers: shared hit=3
                                        ->  Bitmap Heap Scan on recurring_obligations o (actual time=0.010..0.011 rows=12 loops=1)
                                              Recheck Cond: ((company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid) AND activa AND (proxima_fecha <= '2027-11-14'::date))
                                              Heap Blocks: exact=1
                                              Buffers: shared hit=3
                                              ->  Bitmap Index Scan on recurring_obligations_empresa (actual time=0.004..0.004 rows=12 loops=1)
                                                    Index Cond: ((company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid) AND (activa = true) AND (proxima_fecha <= '2027-11-14'::date))
                                                    Buffers: shared hit=2
                            ->  Hash (actual time=0.005..0.005 rows=4 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=1
                                  ->  Result (actual time=0.004..0.005 rows=4 loops=1)
                                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                        Buffers: shared hit=1
                                        ->  Seq Scan on cost_centers c (actual time=0.003..0.004 rows=4 loops=1)
                                              Filter: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                              Buffers: shared hit=1
          SubPlan 5
            ->  Aggregate (never executed)
                  ->  GroupAggregate (never executed)
                        Group Key: (to_char((p_2.programada_el)::timestamp with time zone, 'YYYY-MM'::text))
                        ->  Sort (never executed)
                              Sort Key: (to_char((p_2.programada_el)::timestamp with time zone, 'YYYY-MM'::text))
                              ->  Result (never executed)
                                    One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                    ->  Nested Loop Left Join (never executed)
                                          Filter: (COALESCE(r_1.estado, 'por_autorizar'::text) = ANY ('{por_autorizar,listo_para_pagar}'::text[]))
                                          ->  Index Scan using supplier_payables_agenda_idx on supplier_payables p_2 (never executed)
                                                Index Cond: ((company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid) AND (programada_el >= (date_trunc('month'::text, ('2026-11-10'::date)::timestamp with time zone))::date) AND (programada_el <= '2027-11-14'::date) AND (supplier_id = o.supplier_id))
                                                Filter: (anulado_en IS NULL)
                                          ->  Result (never executed)
                                                One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                                ->  Index Scan using supplier_payment_requests_una_por_cargo on supplier_payment_requests r_1 (never executed)
                                                      Index Cond: (payable_id = p_2.id)
                                                      Filter: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
  InitPlan 7
    ->  Aggregate (actual time=0.262..0.263 rows=1 loops=1)
          Buffers: shared hit=27
          ->  Sort (actual time=0.097..0.101 rows=147 loops=1)
                Sort Key: k.fecha_probable, k.id
                Sort Method: quicksort  Memory: 36kB
                Buffers: shared hit=27
                ->  Append (actual time=0.005..0.073 rows=147 loops=1)
                      Buffers: shared hit=27
                      ->  Result (actual time=0.004..0.024 rows=97 loops=1)
                            One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                            Buffers: shared hit=2
                            ->  Seq Scan on expected_collections k (actual time=0.003..0.016 rows=97 loops=1)
                                  Filter: ((fecha_probable >= '2026-11-10'::date) AND (fecha_probable <= '2027-11-14'::date) AND (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid) AND (estado = 'esperado'::text))
                                  Rows Removed by Filter: 3
                                  Buffers: shared hit=2
                      ->  Result (actual time=0.021..0.032 rows=50 loops=1)
                            One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                            Buffers: shared hit=25
                            ->  Hash Join (actual time=0.020..0.029 rows=50 loops=1)
                                  Hash Cond: (c_1.customer_id = n.id)
                                  Buffers: shared hit=25
                                  ->  Index Scan using collection_charges_agenda on collection_charges c_1 (actual time=0.008..0.011 rows=50 loops=1)
                                        Index Cond: ((company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid) AND (estado = 'emitido'::text) AND (vencimiento >= '2026-11-10'::date) AND (vencimiento <= '2027-11-14'::date))
                                        Buffers: shared hit=23
                                  ->  Hash (actual time=0.009..0.009 rows=50 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 12kB
                                        Buffers: shared hit=2
                                        ->  Seq Scan on collection_customers n (actual time=0.003..0.007 rows=50 loops=1)
                                              Filter: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                              Buffers: shared hit=2
  InitPlan 8
    ->  Aggregate (actual time=0.011..0.012 rows=1 loops=1)
          Buffers: shared hit=2
          ->  Sort (actual time=0.010..0.011 rows=0 loops=1)
                Sort Key: k_1.cobrado_el, k_1.id
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=2
                ->  Append (actual time=0.010..0.011 rows=0 loops=1)
                      Buffers: shared hit=2
                      ->  Result (actual time=0.006..0.006 rows=0 loops=1)
                            One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                            Buffers: shared hit=2
                            ->  Seq Scan on expected_collections k_1 (actual time=0.005..0.005 rows=0 loops=1)
                                  Filter: ((cobrado_el >= '2026-11-10'::date) AND (cobrado_el <= '2027-11-14'::date) AND (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid) AND (estado = 'cobrado'::text))
                                  Rows Removed by Filter: 100
                                  Buffers: shared hit=2
                      ->  Result (actual time=0.004..0.004 rows=0 loops=1)
                            One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                            ->  Hash Right Join (actual time=0.003..0.003 rows=0 loops=1)
                                  Hash Cond: (n_1.id = p_3.customer_id)
                                  ->  Result (never executed)
                                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                        ->  Seq Scan on collection_customers n_1 (never executed)
                                              Filter: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                  ->  Hash (actual time=0.002..0.002 rows=0 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 8kB
                                        ->  Seq Scan on collection_payments p_3 (actual time=0.002..0.002 rows=0 loops=1)
                                              Filter: ((estado <> 'anulado'::text) AND (recibido_el >= '2026-11-10'::date) AND (recibido_el <= '2027-11-14'::date) AND (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid))
  InitPlan 13
    ->  Aggregate (actual time=1.171..1.172 rows=1 loops=1)
          Buffers: shared hit=2342
          ->  Sort (actual time=0.070..0.073 rows=50 loops=1)
                Sort Key: p_4.id
                Sort Method: quicksort  Memory: 30kB
                Buffers: shared hit=4
                ->  Result (actual time=0.036..0.056 rows=50 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                      Buffers: shared hit=4
                      ->  Hash Join (actual time=0.035..0.050 rows=50 loops=1)
                            Hash Cond: (p_4.customer_id = n_2.id)
                            Buffers: shared hit=4
                            ->  Seq Scan on collection_plans p_4 (actual time=0.003..0.011 rows=50 loops=1)
                                  Filter: ((company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid) AND (estado = 'activo'::text))
                                  Buffers: shared hit=2
                            ->  Hash (actual time=0.028..0.028 rows=50 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 12kB
                                  Buffers: shared hit=2
                                  ->  Seq Scan on collection_customers n_2 (actual time=0.001..0.017 rows=50 loops=1)
                                        Filter: (company_id = 'fb99539e-ac41-4a69-b2be-b235c1080af7'::uuid)
                                        Buffers: shared hit=2
          SubPlan 10
            ->  Result (actual time=0.002..0.002 rows=1 loops=50)
                  Buffers: shared hit=150
                  InitPlan 9
                    ->  Limit (actual time=0.002..0.002 rows=1 loops=50)
                          Buffers: shared hit=150
                          ->  Result (actual time=0.002..0.002 rows=1 loops=50)
                                One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = p_4.company_id)
                                Buffers: shared hit=150
                                ->  Index Scan Backward using collection_charges_periodo_unico on collection_charges c_2 (actual time=0.002..0.002 rows=1 loops=50)
                                      Index Cond: ((plan_id = p_4.id) AND (periodo IS NOT NULL))
                                      Filter: (company_id = p_4.company_id)
                                      Buffers: shared hit=150
          SubPlan 11
            ->  Aggregate (actual time=0.009..0.009 rows=1 loops=50)
                  Buffers: shared hit=1094
                  ->  Sort (actual time=0.007..0.007 rows=4 loops=50)
                        Sort Key: c_3.vencimiento
                        Sort Method: quicksort  Memory: 25kB
                        Buffers: shared hit=1094
                        ->  Result (actual time=0.006..0.007 rows=4 loops=50)
                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = p_4.company_id)
                              Buffers: shared hit=1094
                              ->  Bitmap Heap Scan on collection_charges c_3 (actual time=0.005..0.006 rows=4 loops=50)
                                    Recheck Cond: (plan_id = p_4.id)
                                    Filter: ((company_id = p_4.company_id) AND (estado = 'por_emitir'::text))
                                    Rows Removed by Filter: 16
                                    Heap Blocks: exact=994
                                    Buffers: shared hit=1094
                                    ->  Bitmap Index Scan on collection_charges_periodo_unico (actual time=0.001..0.001 rows=20 loops=50)
                                          Index Cond: (plan_id = p_4.id)
                                          Buffers: shared hit=100
          SubPlan 12
            ->  Aggregate (actual time=0.008..0.008 rows=1 loops=50)
                  Buffers: shared hit=1094
                  ->  Limit (actual time=0.007..0.007 rows=3 loops=50)
                        Buffers: shared hit=1094
                        ->  Sort (actual time=0.007..0.007 rows=3 loops=50)
                              Sort Key: c_4.vencimiento DESC, c_4.periodo DESC
                              Sort Method: top-N heapsort  Memory: 25kB
                              Buffers: shared hit=1094
                              ->  Result (actual time=0.002..0.006 rows=16 loops=50)
                                    One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = p_4.company_id)
                                    Buffers: shared hit=1094
                                    ->  Bitmap Heap Scan on collection_charges c_4 (actual time=0.002..0.005 rows=16 loops=50)
                                          Recheck Cond: (plan_id = p_4.id)
                                          Filter: ((monto_centavos IS NOT NULL) AND (estado = ANY ('{emitido,pagado}'::text[])) AND (company_id = p_4.company_id))
                                          Rows Removed by Filter: 4
                                          Heap Blocks: exact=994
                                          Buffers: shared hit=1094
                                          ->  Bitmap Index Scan on collection_charges_periodo_unico (actual time=0.001..0.001 rows=20 loops=50)
                                                Index Cond: (plan_id = p_4.id)
                                                Buffers: shared hit=100
Planning:
  Buffers: shared hit=69
Planning Time: 1.096 ms
Execution Time: 3.659 ms
```
