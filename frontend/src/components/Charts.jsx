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
