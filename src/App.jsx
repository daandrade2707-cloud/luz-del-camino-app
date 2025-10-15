import React, { useEffect, useMemo, useState } from 'react';

/* === CONFIG DE TU HOJA === */
const DEFAULT_SHEET_ID = '1_e3KhpynZI5jCDn4GBZqXwe-IpZkiE9G1L4CQ7v8HU0';
const DEFAULT_SHEET_NAME = 'Hoja1';
const SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxtrlmsY8GPi8js1sRy87GgRfc6k5as24G5_fO2FV8GxQS7necn7vENVx1TVHnf2DUO/exec';

/* === Utilidades === */
function buildCsvUrl(sheetId, sheetName) {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
  return sheetName ? `${base}&sheet=${encodeURIComponent(sheetName)}` : base;
}

function parseCsv(text) {
  const out = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!lines.length) return out;
  const header = splitCsvLine(lines[0]).map((h) =>
    h.trim().replace(/\uFEFF/g, '')
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = splitCsvLine(line).map((c) => c.trim());
    const row = {};
    header.forEach((h, idx) => (row[h] = cells[idx] ?? ''));
    out.push(row);
  }
  return out;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/* === 🔢 Conversión numérica mejorada === */
function toNum(x) {
  if (x === undefined || x === null) return 0;
  if (typeof x === 'number') return x;

  let s = String(x).trim();
  if (s.match(/\d+\.\d{3,},\d+/)) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.match(/^\d+\.\d{3,}$/)) s = s.replace(/\./g, '');

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const money = (n) => `S/ ${toNum(n).toFixed(2)}`;
const formatInt = (n) =>
  toNum(n).toLocaleString('es-PE', { maximumFractionDigits: 0 });

function parseDateAny(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(t);
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const dt = new Date(y, mo, d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(t);
  return isNaN(dt.getTime()) ? null : dt;
}

/* === Componente principal === */
export default function PedidoApp() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('Todos');
  const [cierreFilter, setCierreFilter] = useState('Todos');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [verTotales, setVerTotales] = useState(false);

  /* === Fetch automático === */
  useEffect(() => {
    const url = buildCsvUrl(DEFAULT_SHEET_ID, DEFAULT_SHEET_NAME);

    const fetchData = async () => {
      try {
        const res = await fetch(url + '&cacheBust=' + Date.now());
        if (!res.ok) throw new Error('No se pudo acceder al Google Sheet');
        const text = await res.text();
        const parsed = parseCsv(text);
        setRows(parsed);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  /* === Filtros === */
  const filtradas = useMemo(() => {
    return rows.filter((r) => {
      const okText =
        !q ||
        Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase());

      const raw = r['Fecha de entrega'] || r['Fecha'] || '';
      const d = parseDateAny(raw);
      let okDate = true;
      if (from) {
        const f = new Date(from);
        f.setHours(0, 0, 0, 0);
        okDate = okDate && d && d >= f;
      }
      if (to) {
        const t = new Date(to);
        t.setHours(23, 59, 59, 999);
        okDate = okDate && d && d <= t;
      }

      const estadoRaw = (r['Estado'] || '').toString().trim().toLowerCase();
      let estadoNormalizado = '';
      if (estadoRaw.startsWith('1')) estadoNormalizado = 'entregado';
      else if (estadoRaw.startsWith('0')) estadoNormalizado = 'por entregar';
      else if (estadoRaw.includes('entregado')) estadoNormalizado = 'entregado';
      else if (estadoRaw.includes('por entregar'))
        estadoNormalizado = 'por entregar';
      else estadoNormalizado = estadoRaw;
      const okEstado =
        estadoFilter === 'Todos' ||
        estadoNormalizado.includes(estadoFilter.toLowerCase());

      const cierre = (r['Cierre'] || '').trim().toLowerCase();
      const okCierre =
        cierreFilter === 'Todos' ||
        (cierreFilter === 'Cancelado' && cierre === 'cancelado') ||
        (cierreFilter === 'Activo' && cierre === '');

      return okText && okDate && okEstado && okCierre;
    });
  }, [rows, q, from, to, estadoFilter, cierreFilter]);

  /* === Agrupar por cliente === */
  const grupos = useMemo(() => {
    const map = new Map();
    for (const r of filtradas) {
      const cliente = r['Nombre']?.trim() || '(Sin nombre)';
      const producto = r['Pedido']?.trim() || '-';
      const unidad = r['Unidad']?.trim() || '';
      const cantidad = toNum(r['Cantidad']);

      const rawMonto = String(r['Monto Descontado'] || '0').replace(
        /[^\d.,-]/g,
        ''
      );
      const rawDebe = String(r['Debe'] || '0').replace(/[^\d.,-]/g, '');
      const montoDesc = parseFloat(rawMonto.replace(',', '.')) || 0;
      const debe = parseFloat(rawDebe.replace(',', '.')) || 0;

      // ✅ Cálculo corregido
      const pago = montoDesc - debe >= 0 ? montoDesc - debe : 0;

      const direccion = r['DirecciÃ³n'] || r['Dirección'] || '';
      const mapa =
        r['Ubicación de Maps']?.trim() ||
        r['UbicaciÃ³n de Maps']?.trim() ||
        r['Ubicacion de Maps']?.trim() ||
        '';
      const celular = r['Celular'] || '';
      const estado = (r['Estado'] || '').toLowerCase();

      if (!map.has(cliente)) {
        map.set(cliente, {
          cliente,
          direccion,
          mapa,
          celular,
          estado,
          items: [],
          total: 0,
          pago: 0,
          debe: 0,
          cantidadTotal: 0,
        });
      }

      const g = map.get(cliente);
      g.items.push({ producto, unidad, cantidad, montoDesc, debe, pago });
      g.total += montoDesc;
      g.debe += debe;
      g.pago += pago;
      g.cantidadTotal += cantidad;
      if (!g.mapa && mapa) g.mapa = mapa;
      if (!g.celular && celular) g.celular = celular;
      if (!g.estado && estado) g.estado = estado;
    }
    return Array.from(map.values()).sort((a, b) => b.debe - a.debe);
  }, [filtradas]);

  /* === Acción: marcar como entregado === */
  const marcarEntregado = async (cliente) => {
    try {
      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ nombre: cliente }),
      });
      const data = await res.json();
      alert(data.message || 'Actualizado');
    } catch (err) {
      alert('Error al actualizar: ' + err.message);
    }
  };

  const totals = useMemo(() => {
    return grupos.reduce(
      (acc, g) => {
        acc.total += g.total;
        acc.pago += g.pago;
        acc.debe += g.debe;
        acc.cantidad += g.cantidadTotal;
        return acc;
      },
      { total: 0, pago: 0, debe: 0, cantidad: 0 }
    );
  }, [grupos]);

  const bgColor = (g) => {
    if (g.debe > 0) return 'bg-rose-50';
    if (g.estado.includes('pendiente')) return 'bg-amber-50';
    return 'bg-emerald-50';
  };

  if (loading)
    return <div className="p-6 text-center text-slate-600">Cargando…</div>;
  if (error)
    return (
      <div className="p-6 text-center text-red-700 bg-red-50 rounded-xl">
        {error}
      </div>
    );

  /* === Interfaz === */
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <header className="mb-4">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Luz del Camino — Pedidos
          </h1>
          <p className="text-sm text-slate-500">
            Filtra por texto, estado, cierre o <b>fecha de entrega</b>.
          </p>
        </header>

        {/* Filtros */}
        <section className="bg-white rounded-2xl shadow p-4 mb-4">
          <div className="grid gap-3 md:grid-cols-6 items-end">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-600">
                Buscar (cliente, producto…)
              </label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Ej.: Rosa, miel, tortillas…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600">
                Estado
              </label>
              <select
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                value={estadoFilter}
                onChange={(e) => setEstadoFilter(e.target.value)}
              >
                <option>Todos</option>
                <option>Por Entregar</option>
                <option>Entregado</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600">
                Cierre
              </label>
              <select
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                value={cierreFilter}
                onChange={(e) => setCierreFilter(e.target.value)}
              >
                <option>Todos</option>
                <option>Activo</option>
                <option>Cancelado</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600">
                Desde
              </label>
              <input
                type="date"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600">
                Hasta
              </label>
              <input
                type="date"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* 🔒 Botón para mostrar/ocultar totales */}
        <div className="text-right mb-4">
          {!verTotales ? (
            <button
              onClick={() => {
                const clave = prompt('Ingrese la clave para ver totales:');
                if (clave === '2727') setVerTotales(true);
                else alert('❌ Clave incorrecta');
              }}
              className="text-sm text-blue-600 underline"
            >
              🔒 Mostrar totales
            </button>
          ) : (
            <button
              onClick={() => setVerTotales(false)}
              className="text-sm text-red-600 underline"
            >
              🔐 Ocultar totales
            </button>
          )}
        </div>

        {/* Totales (solo si verTotales = true) */}
        {verTotales && (
          <section className="grid md:grid-cols-4 gap-3 mb-4">
            <Stat label="Total pedidos (clientes)" value={grupos.length} />
            <Stat label="Total Cantidad" value={formatInt(totals.cantidad)} />
            <Stat label="Total Monto Descontado" value={money(totals.total)} />
            <Stat
              label="Total Debe / Pagado"
              value={`${money(totals.debe)} / ${money(totals.pago)}`}
              emph
            />
          </section>
        )}

        {/* Listado */}
        {grupos.map((g) => (
          <div
            key={g.cliente}
            className={`${bgColor(g)} rounded-2xl shadow p-5 mb-4 border`}
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold text-slate-800">
                  {g.cliente}
                </h2>

                <div className="text-sm text-slate-600 mt-1">
                  🏡 {g.direccion || 'Zona no especificada'}
                </div>

                <div className="text-sm text-slate-600 mt-1">
                  📍{' '}
                  {g.mapa ? (
                    g.mapa.startsWith('http') ? (
                      <a
                        className="text-blue-600 underline"
                        target="_blank"
                        rel="noopener noreferrer"
                        href={g.mapa}
                      >
                        Ver ubicación
                      </a>
                    ) : (
                      g.mapa
                    )
                  ) : (
                    'Ubicación no registrada'
                  )}
                </div>

                {g.celular && (
                  <div className="text-sm text-slate-600 mt-1">
                    📞{' '}
                    <a
                      href={`https://wa.me/51${g.celular.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-600 underline"
                    >
                      {g.celular}
                    </a>
                  </div>
                )}
              </div>

              <div className="text-sm mt-2 md:mt-0 text-right">
                <span className="inline-block rounded-lg bg-rose-100 text-rose-700 px-3 py-1 mr-2">
                  Debe: <b>{money(g.debe)}</b>
                </span>
                <span className="inline-block rounded-lg bg-emerald-100 text-emerald-700 px-3 py-1 mr-2">
                  Pagó: <b>{money(g.pago)}</b>
                </span>
                <button
                  onClick={() => marcarEntregado(g.cliente)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-lg text-sm"
                >
                  ✅ Marcar como Entregado
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-slate-500 border-b">
                    <th className="text-left py-2 pr-3">Producto</th>
                    <th className="text-right py-2 pr-3">Cant.</th>
                    <th className="text-right py-2 pr-3">Unidad</th>
                    <th className="text-right py-2 pr-3">Monto Desc.</th>
                    <th className="text-right py-2 pr-3">Debe</th>
                    <th className="text-right py-2 pr-3">Pagó</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3">{it.producto}</td>
                      <td className="py-2 pr-3 text-right">
                        {formatInt(it.cantidad)}
                      </td>
                      <td className="py-2 pr-3 text-right">{it.unidad}</td>
                      <td className="py-2 pr-3 text-right">
                        {money(it.montoDesc)}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold text-rose-600">
                        {money(it.debe)}
                      </td>
                      <td className="py-2 pr-3 text-right text-emerald-700 font-semibold">
                        {money(it.pago)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-right text-sm text-slate-700 font-medium">
              <span className="mr-4">
                Cantidad: {formatInt(g.cantidadTotal)}
              </span>
              <span className="mr-4">Total: {money(g.total)}</span>
              <span className="mr-4">Pagado: {money(g.pago)}</span>
              <span>
                Debe: <b className="text-rose-700">{money(g.debe)}</b>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* === Subcomponentes === */
function Stat({ label, value, emph = false }) {
  return (
    <div
      className={`bg-white rounded-2xl shadow p-4 ${
        emph ? 'ring-2 ring-emerald-400' : ''
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

