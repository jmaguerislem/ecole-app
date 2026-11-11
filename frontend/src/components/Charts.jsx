// Graphiques SVG sans dépendance : anneau (circulaire) et barres. Chaque graphique a un titre, une légende textuelle
// et une liste lisible par les lecteurs d'écran : la couleur n'est jamais la seule information.
const fmt = (v) => Number(v || 0).toLocaleString('fr-FR');

export function Donut({ data, title, center, size = 190 }) {
  const items = data.filter((d) => d.value > 0);
  const total = items.reduce((t, d) => t + d.value, 0);
  const R = 70; const C = 2 * Math.PI * R; let acc = 0;
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <div className="donut-wrap">
        <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={`${title} : ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="30" />
          {items.map((d) => {
            const len = (d.value / total) * C; const el = (
              <circle key={d.label} cx="100" cy="100" r={R} fill="none" stroke={d.color} strokeWidth="30" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 100 100)" className="donut-seg">
                <title>{`${d.label} : ${fmt(d.value)} (${Math.round((d.value / total) * 100)} %)`}</title>
              </circle>); acc += len; return el;
          })}
          <text x="100" y="98" textAnchor="middle" className="donut-n">{center ?? fmt(total)}</text>
          <text x="100" y="118" textAnchor="middle" className="donut-l">{total === 0 ? 'aucune donnée' : 'au total'}</text>
        </svg>
        <ul className="legend">
          {data.map((d) => <li key={d.label}><span className="dot" style={{ background: d.color }} aria-hidden="true" /><span>{d.label}</span><b>{fmt(d.value)}</b></li>)}
        </ul>
      </div>
    </figure>
  );
}

// Barres horizontales : une barre par élément, de la couleur de l'élément
export function Bars({ data, title, unit = '' }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <ul className="bars" aria-label={title}>
        {data.map((d) => (
          <li key={d.key || d.label} className={d.active === false ? 'dim' : ''}>
            <span className="bar-label" title={d.label}>{d.label}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color }} /></span>
            <b className="bar-val">{fmt(d.value)}{unit}</b>
          </li>
        ))}
        {data.length === 0 && <li className="muted">Aucune donnée</li>}
      </ul>
    </figure>
  );
}

// Colonnes groupées (une série par couleur) : ex. loyer prévu et loyer encaissé, mois par mois.
// `data` = [{ label, a, b, active }], `series` = [{ key: 'a', label, color }, …]. Chaque valeur est aussi écrite dans une table lisible par les lecteurs d'écran.
export function Columns({ data, series, title, unit = '' }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const W = 640; const H = 230; const L = 46; const B = 28; const T = 10; const gw = (W - L) / Math.max(1, data.length);
  const bw = Math.min(18, (gw - 8) / series.length);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <ul className="legend inline">{series.map((s) => <li key={s.key}><span className="dot" style={{ background: s.color }} aria-hidden="true" /><span>{s.label}</span></li>)}</ul>
      <div className="cols-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} : ${data.map((d) => `${d.label} ${series.map((s) => `${s.label} ${fmt(d[s.key])}`).join(', ')}`).join(' ; ')}`}>
          {ticks.map((t) => { const y = T + (H - B - T) * (1 - t / max); return <g key={t}><line x1={L} x2={W} y1={y} y2={y} stroke="var(--line)" /><text x={L - 6} y={y + 4} textAnchor="end" className="axis">{fmt(t)}</text></g>; })}
          {data.map((d, i) => {
            const x0 = L + i * gw + (gw - bw * series.length) / 2;
            return (
              <g key={d.label} opacity={d.active === false ? 0.35 : 1}>
                {series.map((s, k) => { const h = ((d[s.key] || 0) / max) * (H - B - T); return <rect key={s.key} x={x0 + k * bw} y={H - B - h} width={bw - 2} height={h} rx="2" fill={s.color}><title>{`${d.label} – ${s.label} : ${fmt(d[s.key])}${unit}`}</title></rect>; })}
                <text x={L + i * gw + gw / 2} y={H - 9} textAnchor="middle" className="axis">{d.label}</text>
              </g>);
          })}
        </svg>
      </div>
      <table className="sr-only"><caption>{title}</caption><thead><tr><th>Période</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.label}><th>{d.label}</th>{series.map((s) => <td key={s.key}>{fmt(d[s.key])}{unit}</td>)}</tr>)}</tbody></table>
    </figure>
  );
}

// Barres horizontales EMPILÉES : une ligne par élément (école), un segment par catégorie (rôle).
// `rows` = [{ key, label, values: { [catKey]: n } }], `cats` = [{ key, label, color }]
export function StackedBars({ rows, cats, title }) {
  const max = Math.max(1, ...rows.map((r) => cats.reduce((t, c) => t + (r.values[c.key] || 0), 0)));
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <ul className="legend inline">{cats.map((c) => <li key={c.key}><span className="dot" style={{ background: c.color }} aria-hidden="true" /><span>{c.label}</span></li>)}</ul>
      <ul className="stacked" aria-label={title}>
        {rows.map((r) => {
          const total = cats.reduce((t, c) => t + (r.values[c.key] || 0), 0);
          return (
            <li key={r.key}>
              <span className="bar-label" title={r.label}>{r.label}</span>
              <span className="stack-track" style={{ width: `${(total / max) * 100}%` }} role="img" aria-label={`${r.label} : ${cats.map((c) => `${c.label} ${r.values[c.key] || 0}`).join(', ')}`}>
                {cats.map((c) => (r.values[c.key] ? <span key={c.key} className="stack-seg" style={{ flexGrow: r.values[c.key], background: c.color }} title={`${c.label} : ${fmt(r.values[c.key])}`} /> : null))}
              </span>
              <b className="bar-val">{fmt(total)}</b>
            </li>);
        })}
        {rows.length === 0 && <li className="muted">Aucune donnée</li>}
      </ul>
    </figure>
  );
}
