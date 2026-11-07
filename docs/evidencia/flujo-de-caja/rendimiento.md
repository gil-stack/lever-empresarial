# Rendimiento del flujo de caja

Corrida del 7 de noviembre de 2026, tras la ronda de revisión (atrasados sin límite inferior, cobrados después del corte y meses con cargo por proveedor). La máquina tenía carga promedio de 147 a 210 por otros agentes en paralelo, así que la cola (p95-p99 del calendario) trae ruido de CPU; el EXPLAIN de las fuentes ejecuta en 3.9 ms.

Fecha de la corrida (México): 2026-11-06
Volumen visible para la empresa (RLS, plataforma_cliente): {"cxp":1000,"solicitudes":700,"personas":200,"nomina":200,"cobros":100,"obligaciones":12}
Volumen ajeno en la misma base: otra empresa con 20,000 cuentas por pagar (RLS las deja fuera).
Vueltas por lectura: 100 medidas tras 10 de calentamiento, en serie, contra Postgres 17 local.

| Lectura | p50 ms | p95 ms | p99 ms | máx ms |
| --- | ---: | ---: | ---: | ---: |
| Inicio (leerFlujoInicio: proyección 13 semanas + presupuestos + cobros) | 15.0 | 23.1 | 26.6 | 31.6 |
| Inicio con escenario (mover un pago) | 17.1 | 23.5 | 28.2 | 45.1 |
| Calendario del mes (leerVistaCalendario) | 12.3 | 47.8 | 65.3 | 88.7 |
| Presupuestos (leerVistaPresupuestos) | 5.6 | 8.3 | 9.3 | 9.7 |
| Cobros (leerVistaCobros) | 2.4 | 7.6 | 10.0 | 12.1 |

EXPLAIN (ANALYZE, BUFFERS) de las fuentes de la proyección, como plataforma_cliente con RLS (ventana 2026-11-02 a 2027-01-31, movimientos desde 2026-11-06):
```
Result (actual time=3.748..3.760 rows=1 loops=1)
  Buffers: shared hit=1244
  InitPlan 1
    ->  Aggregate (actual time=0.679..0.681 rows=1 loops=1)
          Buffers: shared hit=7
          ->  Sort (actual time=0.167..0.176 rows=200 loops=1)
                Sort Key: p.employee_id
                Sort Method: quicksort  Memory: 40kB
                Buffers: shared hit=7
                ->  Result (actual time=0.067..0.127 rows=200 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                      Buffers: shared hit=7
                      ->  Hash Join (actual time=0.064..0.110 rows=200 loops=1)
                            Hash Cond: (e.id = p.employee_id)
                            Buffers: shared hit=7
                            ->  Seq Scan on employees e (actual time=0.007..0.026 rows=200 loops=1)
                                  Filter: (((baja_en IS NULL) OR (baja_en >= '2026-11-06'::date)) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                                  Buffers: shared hit=4
                            ->  Hash (actual time=0.052..0.052 rows=200 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 26kB
                                  Buffers: shared hit=3
                                  ->  Seq Scan on employee_payroll_profiles p (actual time=0.005..0.029 rows=200 loops=1)
                                        Filter: (activa AND (proximo_pago_en <= '2027-01-31'::date) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                                        Buffers: shared hit=3
  InitPlan 3
    ->  Aggregate (actual time=0.011..0.013 rows=1 loops=1)
          ->  Sort (actual time=0.010..0.011 rows=0 loops=1)
                Sort Key: b.fecha_pago, b.id
                Sort Method: quicksort  Memory: 25kB
                ->  Result (actual time=0.007..0.008 rows=0 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                      ->  Seq Scan on payroll_batches b (actual time=0.005..0.005 rows=0 loops=1)
                            Filter: ((fecha_pago >= '2026-11-06'::date) AND (fecha_pago <= '2027-01-31'::date) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
          SubPlan 2
            ->  Aggregate (never executed)
                  ->  Result (never executed)
                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = b.company_id)
                        ->  Seq Scan on payroll_batch_items i (never executed)
                              Filter: ((company_id = b.company_id) AND (batch_id = b.id))
  InitPlan 4
    ->  Aggregate (actual time=2.706..2.709 rows=1 loops=1)
          Buffers: shared hit=1229
          ->  Sort (actual time=1.161..1.182 rows=591 loops=1)
                Sort Key: p_1.programada_el, p_1.id
                Sort Method: quicksort  Memory: 77kB
                Buffers: shared hit=1229
                ->  Result (actual time=0.248..1.011 rows=591 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                      Buffers: shared hit=1229
                      ->  Nested Loop (actual time=0.247..0.972 rows=591 loops=1)
                            Buffers: shared hit=1229
                            ->  Hash Left Join (actual time=0.240..0.590 rows=591 loops=1)
                                  Hash Cond: (p_1.id = r.payable_id)
                                  Filter: (COALESCE(r.estado, 'por_autorizar'::text) = ANY ('{por_autorizar,listo_para_pagar}'::text[]))
                                  Rows Removed by Filter: 318
                                  Buffers: shared hit=47
                                  ->  Bitmap Heap Scan on supplier_payables p_1 (actual time=0.033..0.229 rows=909 loops=1)
                                        Recheck Cond: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                        Filter: ((anulado_en IS NULL) AND (programada_el <= '2027-01-31'::date))
                                        Rows Removed by Filter: 91
                                        Heap Blocks: exact=25
                                        Buffers: shared hit=28
                                        ->  Bitmap Index Scan on supplier_payables_proveedor_idx (actual time=0.023..0.023 rows=1000 loops=1)
                                              Index Cond: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                              Buffers: shared hit=3
                                  ->  Hash (actual time=0.201..0.202 rows=700 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 61kB
                                        Buffers: shared hit=19
                                        ->  Result (actual time=0.007..0.135 rows=700 loops=1)
                                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                              Buffers: shared hit=19
                                              ->  Seq Scan on supplier_payment_requests r (actual time=0.005..0.075 rows=700 loops=1)
                                                    Filter: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                                    Buffers: shared hit=19
                            ->  Index Scan using suppliers_id_empresa on suppliers s (actual time=0.000..0.000 rows=1 loops=591)
                                  Index Cond: ((id = p_1.supplier_id) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                                  Buffers: shared hit=1182
  InitPlan 6
    ->  Aggregate (actual time=0.112..0.115 rows=1 loops=1)
          Buffers: shared hit=4
          ->  Sort (actual time=0.065..0.067 rows=12 loops=1)
                Sort Key: o.proxima_fecha, o.id
                Sort Method: quicksort  Memory: 26kB
                Buffers: shared hit=4
                ->  Result (actual time=0.052..0.060 rows=12 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                      Buffers: shared hit=4
                      ->  Hash Left Join (actual time=0.049..0.056 rows=12 loops=1)
                            Hash Cond: (o.cost_center_id = c.id)
                            Buffers: shared hit=4
                            ->  Hash Right Join (actual time=0.037..0.042 rows=12 loops=1)
                                  Hash Cond: (s_1.id = o.supplier_id)
                                  Buffers: shared hit=3
                                  ->  Result (actual time=0.007..0.016 rows=50 loops=1)
                                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                        Buffers: shared hit=2
                                        ->  Seq Scan on suppliers s_1 (actual time=0.005..0.012 rows=50 loops=1)
                                              Filter: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                              Rows Removed by Filter: 20
                                              Buffers: shared hit=2
                                  ->  Hash (actual time=0.013..0.013 rows=12 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 10kB
                                        Buffers: shared hit=1
                                        ->  Seq Scan on recurring_obligations o (actual time=0.008..0.010 rows=12 loops=1)
                                              Filter: (activa AND (proxima_fecha <= '2027-01-31'::date) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                                              Buffers: shared hit=1
                            ->  Hash (actual time=0.008..0.008 rows=4 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=1
                                  ->  Result (actual time=0.006..0.007 rows=4 loops=1)
                                        One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                        Buffers: shared hit=1
                                        ->  Seq Scan on cost_centers c (actual time=0.004..0.005 rows=4 loops=1)
                                              Filter: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                              Buffers: shared hit=1
          SubPlan 5
            ->  Aggregate (never executed)
                  ->  Sort (never executed)
                        Sort Key: (to_char((p_2.programada_el)::timestamp with time zone, 'YYYY-MM'::text))
                        ->  Result (never executed)
                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                              ->  Nested Loop Left Join (never executed)
                                    Filter: (COALESCE(r_1.estado, 'por_autorizar'::text) = ANY ('{por_autorizar,listo_para_pagar}'::text[]))
                                    ->  Index Scan using supplier_payables_agenda_idx on supplier_payables p_2 (never executed)
                                          Index Cond: ((company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid) AND (programada_el >= (date_trunc('month'::text, ('2026-11-06'::date)::timestamp with time zone))::date) AND (programada_el <= '2027-01-31'::date) AND (supplier_id = o.supplier_id))
                                          Filter: (anulado_en IS NULL)
                                    ->  Result (never executed)
                                          One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                          ->  Index Scan using supplier_payment_requests_una_por_cargo on supplier_payment_requests r_1 (never executed)
                                                Index Cond: (payable_id = p_2.id)
                                                Filter: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
  InitPlan 7
    ->  Aggregate (actual time=0.212..0.213 rows=1 loops=1)
          Buffers: shared hit=2
          ->  Sort (actual time=0.035..0.039 rows=87 loops=1)
                Sort Key: k.fecha_probable, k.id
                Sort Method: quicksort  Memory: 31kB
                Buffers: shared hit=2
                ->  Result (actual time=0.009..0.025 rows=87 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                      Buffers: shared hit=2
                      ->  Seq Scan on expected_collections k (actual time=0.006..0.017 rows=87 loops=1)
                            Filter: ((fecha_probable >= '2026-11-06'::date) AND (fecha_probable <= '2027-01-31'::date) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid) AND (estado = 'esperado'::text))
                            Rows Removed by Filter: 13
                            Buffers: shared hit=2
  InitPlan 8
    ->  Aggregate (actual time=0.013..0.013 rows=1 loops=1)
          Buffers: shared hit=2
          ->  Sort (actual time=0.012..0.012 rows=0 loops=1)
                Sort Key: k_1.cobrado_el, k_1.id
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=2
                ->  Result (actual time=0.011..0.011 rows=0 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                      Buffers: shared hit=2
                      ->  Seq Scan on expected_collections k_1 (actual time=0.009..0.009 rows=0 loops=1)
                            Filter: ((cobrado_el >= '2026-11-06'::date) AND (cobrado_el <= '2027-01-31'::date) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid) AND (estado = 'cobrado'::text))
                            Rows Removed by Filter: 100
                            Buffers: shared hit=2
Planning:
  Buffers: shared hit=54
Planning Time: 1.307 ms
Execution Time: 3.887 ms
```

EXPLAIN (ANALYZE, BUFFERS) de las fuentes de presupuestos, como plataforma_cliente con RLS (mes 2026-11-01 a 2026-11-30):
```
Result (actual time=1.196..1.203 rows=1 loops=1)
  Buffers: shared hit=536
  InitPlan 1
    ->  Aggregate (actual time=0.038..0.039 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Sort (actual time=0.026..0.026 rows=4 loops=1)
                Sort Key: (lower(c.nombre)), c.id
                Sort Method: quicksort  Memory: 25kB
                Buffers: shared hit=1
                ->  Result (actual time=0.011..0.013 rows=4 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                      Buffers: shared hit=1
                      ->  Seq Scan on cost_centers c (actual time=0.005..0.006 rows=4 loops=1)
                            Filter: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                            Buffers: shared hit=1
  InitPlan 2
    ->  Aggregate (actual time=0.320..0.321 rows=1 loops=1)
          Buffers: shared hit=7
          ->  Result (actual time=0.055..0.112 rows=200 loops=1)
                One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                Buffers: shared hit=7
                ->  Hash Join (actual time=0.054..0.100 rows=200 loops=1)
                      Hash Cond: (e.id = p.employee_id)
                      Buffers: shared hit=7
                      ->  Seq Scan on employees e (actual time=0.004..0.025 rows=200 loops=1)
                            Filter: ((alta_en <= '2026-11-30'::date) AND ((baja_en IS NULL) OR (baja_en >= '2026-11-01'::date)) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                            Buffers: shared hit=4
                      ->  Hash (actual time=0.046..0.046 rows=200 loops=1)
                            Buckets: 1024  Batches: 1  Memory Usage: 24kB
                            Buffers: shared hit=3
                            ->  Seq Scan on employee_payroll_profiles p (actual time=0.004..0.025 rows=200 loops=1)
                                  Filter: (activa AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                                  Buffers: shared hit=3
  InitPlan 3
    ->  Aggregate (actual time=0.396..0.397 rows=1 loops=1)
          Buffers: shared hit=262
          ->  GroupAggregate (actual time=0.379..0.391 rows=4 loops=1)
                Group Key: s.cost_center_id
                Buffers: shared hit=262
                ->  Sort (actual time=0.372..0.378 rows=152 loops=1)
                      Sort Key: s.cost_center_id
                      Sort Method: quicksort  Memory: 30kB
                      Buffers: shared hit=262
                      ->  Result (actual time=0.148..0.356 rows=152 loops=1)
                            One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                            Buffers: shared hit=262
                            ->  Hash Join (actual time=0.147..0.347 rows=152 loops=1)
                                  Hash Cond: (p_1.supplier_id = s.id)
                                  Buffers: shared hit=262
                                  ->  Hash Right Join (actual time=0.126..0.309 rows=152 loops=1)
                                        Hash Cond: (r.payable_id = p_1.id)
                                        Filter: (COALESCE(r.estado, 'por_autorizar'::text) <> ALL ('{rechazado,cancelado}'::text[]))
                                        Rows Removed by Filter: 88
                                        Buffers: shared hit=260
                                        ->  Result (actual time=0.005..0.124 rows=700 loops=1)
                                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                              Buffers: shared hit=19
                                              ->  Seq Scan on supplier_payment_requests r (actual time=0.004..0.068 rows=700 loops=1)
                                                    Filter: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                                    Buffers: shared hit=19
                                        ->  Hash (actual time=0.113..0.113 rows=240 loops=1)
                                              Buckets: 1024  Batches: 1  Memory Usage: 29kB
                                              Buffers: shared hit=241
                                              ->  Index Scan using supplier_payables_agenda_idx on supplier_payables p_1 (actual time=0.011..0.090 rows=240 loops=1)
                                                    Index Cond: ((company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid) AND (programada_el >= '2026-11-01'::date) AND (programada_el <= '2026-11-30'::date))
                                                    Filter: (anulado_en IS NULL)
                                                    Buffers: shared hit=241
                                  ->  Hash (actual time=0.018..0.018 rows=50 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 12kB
                                        Buffers: shared hit=2
                                        ->  Seq Scan on suppliers s (actual time=0.005..0.013 rows=50 loops=1)
                                              Filter: ((cost_center_id IS NOT NULL) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                                              Rows Removed by Filter: 20
                                              Buffers: shared hit=2
  InitPlan 5
    ->  Aggregate (actual time=0.041..0.043 rows=1 loops=1)
          Buffers: shared hit=1
          ->  Result (actual time=0.006..0.008 rows=12 loops=1)
                One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                Buffers: shared hit=1
                ->  Seq Scan on recurring_obligations o (actual time=0.004..0.006 rows=12 loops=1)
                      Filter: (activa AND (cost_center_id IS NOT NULL) AND (proxima_fecha <= '2026-11-30'::date) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                      Buffers: shared hit=1
          SubPlan 4
            ->  Aggregate (never executed)
                  ->  Sort (never executed)
                        Sort Key: (to_char((p_2.programada_el)::timestamp with time zone, 'YYYY-MM'::text))
                        ->  Result (never executed)
                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                              ->  Nested Loop Left Join (never executed)
                                    Filter: (COALESCE(r_1.estado, 'por_autorizar'::text) = ANY ('{por_autorizar,listo_para_pagar}'::text[]))
                                    ->  Index Scan using supplier_payables_agenda_idx on supplier_payables p_2 (never executed)
                                          Index Cond: ((company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid) AND (programada_el >= (date_trunc('month'::text, ('2026-11-01'::date)::timestamp with time zone))::date) AND (programada_el <= '2026-11-30'::date) AND (supplier_id = o.supplier_id))
                                          Filter: (anulado_en IS NULL)
                                    ->  Result (never executed)
                                          One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                          ->  Index Scan using supplier_payment_requests_una_por_cargo on supplier_payment_requests r_1 (never executed)
                                                Index Cond: (payable_id = p_2.id)
                                                Filter: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
  InitPlan 6
    ->  Aggregate (actual time=0.395..0.397 rows=1 loops=1)
          Buffers: shared hit=265
          ->  Sort (actual time=0.326..0.329 rows=40 loops=1)
                Sort Key: e_1.nombre, e_1.id
                Sort Method: quicksort  Memory: 27kB
                Buffers: shared hit=265
                ->  Result (actual time=0.241..0.267 rows=40 loops=1)
                      One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                      Buffers: shared hit=265
                      ->  Hash Left Join (actual time=0.240..0.264 rows=40 loops=1)
                            Hash Cond: (e_1.user_id = g.solicitado_por)
                            Buffers: shared hit=265
                            ->  Hash Left Join (actual time=0.011..0.032 rows=40 loops=1)
                                  Hash Cond: (e_1.cost_center_id = c_1.id)
                                  Buffers: shared hit=5
                                  ->  Seq Scan on employees e_1 (actual time=0.003..0.018 rows=40 loops=1)
                                        Filter: ((presupuesto_mensual_centavos IS NOT NULL) AND ((baja_en IS NULL) OR (baja_en >= '2026-11-01'::date)) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                                        Rows Removed by Filter: 160
                                        Buffers: shared hit=4
                                  ->  Hash (actual time=0.005..0.005 rows=4 loops=1)
                                        Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                        Buffers: shared hit=1
                                        ->  Result (actual time=0.003..0.004 rows=4 loops=1)
                                              One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                              Buffers: shared hit=1
                                              ->  Seq Scan on cost_centers c_1 (actual time=0.002..0.003 rows=4 loops=1)
                                                    Filter: (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                                    Buffers: shared hit=1
                            ->  Hash (actual time=0.226..0.227 rows=1 loops=1)
                                  Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                  Buffers: shared hit=260
                                  ->  Subquery Scan on g (actual time=0.226..0.226 rows=1 loops=1)
                                        Buffers: shared hit=260
                                        ->  GroupAggregate (actual time=0.225..0.225 rows=1 loops=1)
                                              Group Key: r_2.solicitado_por
                                              Buffers: shared hit=260
                                              ->  Sort (actual time=0.215..0.218 rows=88 loops=1)
                                                    Sort Key: r_2.solicitado_por
                                                    Sort Method: quicksort  Memory: 28kB
                                                    Buffers: shared hit=260
                                                    ->  Result (actual time=0.099..0.207 rows=88 loops=1)
                                                          One-Time Filter: ((NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid)
                                                          Buffers: shared hit=260
                                                          ->  Hash Join (actual time=0.097..0.200 rows=88 loops=1)
                                                                Hash Cond: (r_2.payable_id = p_3.id)
                                                                Buffers: shared hit=260
                                                                ->  Seq Scan on supplier_payment_requests r_2 (actual time=0.003..0.081 rows=350 loops=1)
                                                                      Filter: ((estado <> ALL ('{rechazado,cancelado}'::text[])) AND (company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid))
                                                                      Rows Removed by Filter: 350
                                                                      Buffers: shared hit=19
                                                                ->  Hash (actual time=0.089..0.089 rows=240 loops=1)
                                                                      Buckets: 1024  Batches: 1  Memory Usage: 25kB
                                                                      Buffers: shared hit=241
                                                                      ->  Index Scan using supplier_payables_agenda_idx on supplier_payables p_3 (actual time=0.006..0.066 rows=240 loops=1)
                                                                            Index Cond: ((company_id = '45bff23b-27ca-4afe-9da6-ca6024720856'::uuid) AND (programada_el >= '2026-11-01'::date) AND (programada_el <= '2026-11-30'::date))
                                                                            Filter: (anulado_en IS NULL)
                                                                            Buffers: shared hit=241
Planning:
  Buffers: shared hit=59
Planning Time: 0.974 ms
Execution Time: 1.302 ms
```
