import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Bars, Columns, Donut } from '../components/Charts.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, PageHeader, Pill, Spinner } from '../components/ui.jsx';

// Module « Business Intelligence & Aide à la décision » : 10 tableaux de bord du DIRECTEUR, sur l'année scolaire en cours.
// Tout est calculé par le serveur (GET /api/bi/:tableau, lecture seule). Chaque onglet explique ses règles de calcul
// (« Comment c'est calculé ») et signale les données que l'application n'enregistre pas, au lieu de les inventer.
const ONGLETS = [
  ['general', 'Vue générale', 'dashboard'], ['financier', 'Finances', 'banknote'], ['pedagogique', 'Pédagogie', 'graduation'], ['absences', 'Absences', 'user-x'],
  ['enseignants', 'Enseignants', 'presentation'], ['inscriptions', 'Inscriptions', 'users'], ['communication', 'Parents', 'message'], ['edt', 'Emplois du temps', 'calendar'],
  ['risques', 'Alertes précoces', 'alert-triangle'], ['strategique', 'Stratégie', 'presentation'],
];
const fmt = (v) => Number(v ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const nd = (v, suffix = '') => (v === null || v === undefined ? '—' : `${fmt(v)}${suffix}`);
const tnd = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TND`);
const court = (nv) => String(nv || '').replace(' année', '');
const BLEU = '#2563eb'; const GRIS = '#94a3b8'; const VERT = '#16a34a'; const ORANGE = '#d97706'; const ROUGE = '#dc2626'; const VIOLET = '#7c3aed';
const KIND = { haute: 'err', moyenne: 'warn', info: 'info' };
const PRIO = { haute: ['Priorité haute', 'bad'], moyenne: ['À planifier', 'warn'], info: ['À suivre', ''] };
const RISQUE = { eleve: ['Élevé', 'bad'], moyen: ['Moyen', 'warn'], faible: ['Faible', ''] };
const TYPES = { echec: 'Échec', abandon: 'Abandon', impaye: 'Impayé', double: 'Double risque' };
const STATUT_CLASSE = { surchargee: ['Surchargée', 'bad'], saturee: ['Presque pleine', 'warn'], sous_remplie: ['Sous-remplie', 'warn'], normale: ['Normale', 'ok'] };

function Kpi({ n, label, icon = 'dashboard', tone = 'brand', sub }) {
  return <div className="stat stat-link" style={{ cursor: 'default' }}><span className={`stat-ico ${tone}`} aria-hidden="true"><Icon name={icon} size={22} /></span><span className="stat-body"><b>{n}</b><span className="stat-label">{label}</span>{sub && <span className="stat-label small">{sub}</span>}</span></div>;
}
const Kpis = ({ children }) => <div className="grid" style={{ marginBottom: '1rem' }}>{children}</div>;
const Carte = ({ titre, children, large }) => <section className={`card${large ? ' wide2' : ''}`} aria-label={titre}>{titre && <h3 style={{ marginTop: 0 }}>{titre}</h3>}{children}</section>;
const Titre = ({ children }) => <h2 className="section-title">{children}</h2>;
function Tbl({ cols, rows, vide = 'Aucune donnée à afficher.' }) {
  if (!rows?.length) return <p className="muted small">{vide}</p>;
  return <div className="table-wrap"><table><thead><tr>{cols.map((c) => <th key={c.h}>{c.h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.id ?? i}>{cols.map((c) => <td key={c.h}>{c.f(r)}</td>)}</tr>)}</tbody></table></div>;
}
const Jauge = ({ v, tone }) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem' }}><span className={`meter ${tone || ''}`} aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, v ?? 0))}%` }} /></span><span>{nd(v, ' %')}</span></span>;
function Explication({ d }) {
  return (
    <div style={{ marginTop: '1.25rem' }}>
      {d.non_suivi?.map((t) => <Alert key={t} kind="info">{t}</Alert>)}
      {d.regles?.length > 0 && <details className="card" style={{ marginTop: '.75rem' }}><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Comment c’est calculé</summary><ul className="small" style={{ marginBottom: 0 }}>{d.regles.map((r) => <li key={r}>{r}</li>)}</ul></details>}
    </div>
  );
}
const contact = (ps) => (ps?.length ? ps.map((p) => `${p.nom}${p.telephone ? ` · ${p.telephone}` : ''}`).join(' / ') : '—');

// ---------- 1. Vue générale ----------
function General({ d }) {
  const k = d.kpis;
  return (
    <>
      <Kpis>
        <Kpi n={fmt(k.eleves)} label="Élèves actifs" icon="graduation" sub={`${fmt(k.sans_classe)} sans classe`} />
        <Kpi n={fmt(k.enseignants)} label="Enseignants" icon="presentation" sub={`${nd(k.eleves_par_enseignant)} élèves par enseignant`} />
        <Kpi n={fmt(k.classes)} label="Classes" icon="school" sub={`${nd(k.eleves_par_classe)} élèves par classe`} />
        <Kpi n={nd(k.taux_occupation, ' %')} label="Occupation des classes" icon="building" tone={k.taux_occupation > 100 ? 'bad' : 'ok'} sub={`${fmt(k.effectif_en_classe)} élèves pour ${fmt(k.capacite_totale)} places`} />
        <Kpi n={fmt(k.places_libres)} label="Places libres" icon="door" tone="ok" />
      </Kpis>
      {d.alertes.map((a, i) => <Alert key={i} kind={KIND[a.niveau]}>{a.message}</Alert>)}
      <div className="grid charts">
        <Carte titre="Effectifs et capacité par niveau"><Columns title="Effectifs et capacité par niveau" data={d.par_niveau.map((x) => ({ label: court(x.niveau), effectif: x.effectif, capacite: x.capacite }))} series={[{ key: 'effectif', label: 'Effectif', color: BLEU }, { key: 'capacite', label: 'Capacité', color: GRIS }]} /></Carte>
        <Carte titre="Évolution des inscriptions"><Columns title="Nouveaux inscrits par année" data={d.evolution.map((x) => ({ label: x.annee, nouveaux: x.nouveaux, cumul: x.cumul }))} series={[{ key: 'nouveaux', label: 'Nouveaux inscrits', color: BLEU }, { key: 'cumul', label: 'Cumul', color: GRIS }]} /><p className="muted small">{d.note_evolution}</p></Carte>
      </div>
      <Titre>Classes : effectif et capacité</Titre>
      <Tbl rows={d.classes} cols={[{ h: 'Classe', f: (c) => c.nom }, { h: 'Effectif', f: (c) => `${c.effectif} / ${c.capacite}` }, { h: 'Remplissage', f: (c) => <Jauge v={c.taux} tone={c.statut === 'surchargee' ? 'bad' : c.statut === 'normale' ? 'ok' : 'warn'} /> }, { h: 'Places libres', f: (c) => c.places_libres }, { h: 'Statut', f: (c) => <Pill kind={STATUT_CLASSE[c.statut][1]}>{STATUT_CLASSE[c.statut][0]}</Pill> }]} />
      <Titre>Prévision</Titre>
      <Alert kind="info">{`Effectif prévu pour ${d.prevision.annee} : ${d.prevision.effectif_prevu} élèves (aujourd’hui ${d.prevision.effectif_actuel}, capacité ${d.prevision.capacite_actuelle}). Détail dans l’onglet « Inscriptions » et « Stratégie ».`}</Alert>
    </>
  );
}

// ---------- 2. Finances ----------
function Financier({ d }) {
  const k = d.kpis;
  return (
    <>
      <Kpis>
        <Kpi n={tnd(k.attendu)} label="Frais attendus" icon="banknote" sub={`${fmt(k.eleves_actifs)} élèves actifs`} />
        <Kpi n={tnd(k.encaisse)} label="Encaissé" icon="check-circle" tone="ok" />
        <Kpi n={tnd(k.reste)} label="Reste à payer" icon="alert-triangle" tone={k.reste > 0 ? 'warn' : 'ok'} />
        <Kpi n={nd(k.taux_recouvrement, ' %')} label="Taux de recouvrement" icon="dashboard" tone={k.taux_recouvrement !== null && k.taux_recouvrement < 70 ? 'bad' : 'ok'} />
        <Kpi n={fmt(k.eleves_avec_retard)} label="Familles avec un reste à payer" icon="users" tone={k.eleves_avec_retard ? 'warn' : 'ok'} />
      </Kpis>
      <div className="grid charts">
        <Carte titre="Recettes mensuelles" large><Columns title="Recettes mensuelles (TND)" unit=" TND" data={d.par_mois} series={[{ key: 'encaisse', label: 'Cette année', color: BLEU }, { key: 'annee_precedente', label: 'Année précédente', color: GRIS }]} /></Carte>
        <Carte titre="Prévision des recettes">
          {d.prevision.length ? <>{d.prevision.map((p) => <div className="kv" key={p.mois}><span>{p.label}</span><b>{tnd(p.prevu)}</b></div>)}<p className="muted small">{d.methode_prevision}</p></> : <p className="muted small">Pas de prévision : aucun mois complet de paiements à prolonger, ou plus rien à encaisser.</p>}
        </Carte>
        <Carte titre="Recouvrement par niveau"><Bars title="Taux de recouvrement par niveau" unit=" %" data={d.par_niveau.map((x) => ({ label: court(x.niveau), value: x.taux ?? 0 }))} /></Carte>
        <Carte titre="Modes de paiement"><Donut title="Modes de paiement" data={d.par_mode.map((m, i) => ({ label: { especes: 'Espèces', virement: 'Virement', mobile_money: 'Mobile money' }[m.mode] || m.mode, value: m.total, color: [BLEU, VERT, ORANGE][i % 3] }))} /></Carte>
      </div>
      <Titre>Familles en retard de paiement</Titre>
      <Tbl vide="Aucun reste à payer." rows={d.retards} cols={[{ h: 'Élève', f: (r) => r.eleve }, { h: 'Classe', f: (r) => r.classe || '—' }, { h: 'Dû', f: (r) => tnd(r.du) }, { h: 'Payé', f: (r) => tnd(r.paye) }, { h: 'Reste', f: (r) => <b>{tnd(r.solde)}</b> },
        { h: 'Échéance dépassée', f: (r) => (r.jours_retard ? <Pill kind={r.jours_retard > 60 ? 'bad' : 'warn'}>{r.jours_retard} j</Pill> : '—') }, { h: 'Parents à contacter', f: (r) => contact(r.parents) }]} />
      <Explication d={{ regles: [d.note] }} />
    </>
  );
}

// ---------- 3. Pédagogie ----------
function Pedagogie({ d }) {
  const k = d.kpis;
  return (
    <>
      <Kpis>
        <Kpi n={nd(k.moyenne_generale, ' / 20')} label="Moyenne générale" icon="graduation" sub={`${fmt(k.eleves_notes)} élèves notés`} />
        <Kpi n={nd(k.taux_reussite, ' %')} label="Taux de réussite" icon="check-circle" tone="ok" />
        <Kpi n={nd(k.taux_echec, ' %')} label="Taux d’échec" icon="alert-triangle" tone={k.taux_echec > 25 ? 'bad' : 'warn'} />
        <Kpi n={fmt(k.en_difficulte)} label="Élèves en difficulté" icon="user-x" tone={k.en_difficulte ? 'bad' : 'ok'} />
        <Kpi n={fmt(k.a_accompagner)} label="À accompagner" icon="users" tone={k.a_accompagner ? 'warn' : 'ok'} />
      </Kpis>
      {!k.eleves_notes && <Alert kind="info">Aucune note saisie cette année : les indicateurs pédagogiques apparaîtront dès que les enseignants auront saisi des évaluations.</Alert>}
      <div className="grid charts">
        <Carte titre="Évolution par trimestre"><Columns title="Moyenne par trimestre" data={d.par_trimestre.map((t) => ({ label: t.label, moyenne: t.moyenne ?? 0, reussite: t.taux_reussite ?? 0 }))} series={[{ key: 'moyenne', label: 'Moyenne /20', color: BLEU }, { key: 'reussite', label: 'Réussite %', color: VERT }]} /></Carte>
        <Carte titre="Classement des matières (moyenne /20)"><Bars title="Moyenne par matière" data={d.par_matiere.map((m) => ({ label: `${m.rang}. ${m.nom}`, value: m.moyenne }))} /></Carte>
        <Carte titre="Moyenne par niveau"><Bars title="Moyenne par niveau" data={d.par_niveau.map((x) => ({ label: court(x.niveau), value: x.moyenne }))} /></Carte>
      </div>
      <Titre>Résultats par classe</Titre>
      <Tbl rows={d.par_classe} cols={[{ h: 'Classe', f: (c) => c.nom }, { h: 'Élèves notés', f: (c) => c.eleves }, { h: 'Moyenne', f: (c) => <b>{nd(c.moyenne)}</b> }, { h: 'Réussite', f: (c) => nd(c.taux_reussite, ' %') }, { h: 'Échec', f: (c) => nd(c.taux_echec, ' %') }, ...[0, 1, 2].map((i) => ({ h: `T${i + 1}`, f: (c) => nd(c.trimestres[i]) }))]} />
      <Titre>Élèves à accompagner</Titre>
      <Tbl vide="Aucun élève à accompagner pour le moment." rows={d.a_accompagner} cols={[{ h: 'Élève', f: (e) => e.nom }, { h: 'Classe', f: (e) => e.classe || '—' }, { h: 'Moyenne', f: (e) => nd(e.moyenne) }, { h: 'Évolution', f: (e) => (e.evolution === null ? '—' : <Pill kind={e.evolution < 0 ? 'bad' : 'ok'}>{e.evolution > 0 ? '+' : ''}{fmt(e.evolution)}</Pill>) },
        { h: 'Matières faibles', f: (e) => e.matieres_faibles.join(', ') || '—' }, { h: 'Motifs', f: (e) => e.raisons.join(' · ') }]} />
      <Explication d={d} />
    </>
  );
}

// ---------- 4. Absences ----------
function Absences({ d }) {
  const k = d.kpis;
  return (
    <>
      <Kpis>
        <Kpi n={nd(k.taux_absenteisme, ' %')} label="Taux d’absentéisme" icon="user-x" tone={k.taux_absenteisme > 8 ? 'bad' : 'warn'} sub={`${fmt(k.jours_de_classe)} jours de classe écoulés`} />
        <Kpi n={fmt(k.jours_absence)} label="Jours d’absence" icon="calendar" sub={`${fmt(k.nombre_absences)} absences enregistrées`} />
        <Kpi n={fmt(k.non_justifiees)} label="Non justifiées" icon="alert-triangle" tone={k.non_justifiees ? 'warn' : 'ok'} sub={`${fmt(k.justifiees)} justifiées`} />
        <Kpi n={fmt(k.absences_repetitives)} label="Élèves à absences répétées" icon="users" tone={k.absences_repetitives ? 'bad' : 'ok'} />
        <Kpi n={fmt(k.retards)} label="Retards d’arrivée" icon="clock" tone={k.retards ? 'warn' : 'ok'} sub={`${fmt(k.eleves_en_retard)} élève(s) · ${nd(k.retard_moyen_minutes, ' min')} en moyenne`} />
        <Kpi n={fmt(k.retards_recurrents)} label="Retardataires récurrents" icon="user-x" tone={k.retards_recurrents ? 'bad' : 'ok'} sub="3 retards ou plus" />
        <Kpi n={nd(k.taux_devoirs_en_retard, ' %')} label="Devoirs rendus en retard" icon="clock" sub={`${fmt(k.devoirs_en_retard)} sur ${fmt(k.depots_total)} dépôts`} />
      </Kpis>
      <div className="grid charts">
        <Carte titre="Absences par mois" large><Columns title="Jours d’absence par mois" unit=" j" data={d.par_mois} series={[{ key: 'justifiees', label: 'Justifiées', color: VERT }, { key: 'non_justifiees', label: 'Non justifiées', color: ORANGE }]} /></Carte>
        <Carte titre="Absentéisme par classe"><Bars title="Taux d’absentéisme par classe" unit=" %" data={d.par_classe.map((c) => ({ label: c.nom, value: c.taux ?? 0 }))} /></Carte>
        <Carte titre="Absences et résultats scolaires">
          <Bars title="Moyenne selon les jours d’absence" data={d.relation.tranches.map((t) => ({ label: `${t.label} (${t.eleves})`, value: t.moyenne ?? 0 }))} />
          <p className="small"><b>{d.relation.lecture}</b>{d.relation.correlation !== null && <span className="muted"> Coefficient de corrélation : {d.relation.correlation} (sur {d.relation.eleves} élèves).</span>}</p>
        </Carte>
      </div>
      <Titre>Retards d’arrivée</Titre>
      <div className="grid charts">
        <Carte titre="Retards par mois"><Columns title="Retards d’arrivée par mois" data={d.retards.par_mois.map((m) => ({ label: m.label, retards: m.retards }))} series={[{ key: 'retards', label: 'Retards', color: ORANGE }]} /></Carte>
        <Carte titre="Retards par classe"><Bars title="Retards par classe" data={d.retards.par_classe.map((c) => ({ label: c.nom, value: c.retards }))} /></Carte>
      </div>
      <Tbl vide="Aucun élève n’atteint le seuil de retards répétés." rows={d.retards.recurrents} cols={[{ h: 'Élève', f: (e) => e.nom }, { h: 'Classe', f: (e) => e.classe || '—' }, { h: 'Retards', f: (e) => <b>{e.retards}</b> }, { h: 'Minutes perdues', f: (e) => `${fmt(e.minutes)} min` }, { h: 'Dernier retard', f: (e) => e.dernier || '—' }]} />
      <Titre>Élèves à absences répétées</Titre>
      <Tbl vide="Aucun élève n’atteint le seuil d’absences répétées." rows={d.repetitives} cols={[{ h: 'Élève', f: (e) => e.nom }, { h: 'Classe', f: (e) => e.classe || '—' }, { h: 'Absences non justifiées', f: (e) => <b>{e.non_justifiees}</b> }, { h: 'Jours', f: (e) => fmt(e.jours) }, { h: 'Dernière absence', f: (e) => e.derniere || '—' }]} />
      <Titre>Élèves les plus absents</Titre>
      <Tbl rows={d.par_eleve} cols={[{ h: 'Élève', f: (e) => e.nom }, { h: 'Classe', f: (e) => e.classe || '—' }, { h: 'Jours', f: (e) => fmt(e.jours) }, { h: 'Justifiées', f: (e) => e.justifiees }, { h: 'Non justifiées', f: (e) => e.non_justifiees }, { h: 'Taux', f: (e) => nd(e.taux, ' %') }]} />
      <Explication d={d} />
    </>
  );
}

// ---------- 5. Enseignants ----------
const STATUT_ENS = { surcharge: ['Surcharge', 'bad'], sous_charge: ['Sous-charge', 'warn'], equilibre: ['Équilibrée', 'ok'] };
const PERIODE = { journee: 'Journée', matin: 'Matin', apres_midi: 'Après-midi' };
function AbsencesEns({ a }) {
  const k = a.kpis;
  return (
    <>
      <Titre>Absences et remplacements des enseignants</Titre>
      <Kpis>
        <Kpi n={fmt(k.jours)} label="Jours d’absence" icon="user-x" sub={`${fmt(k.absences)} absence(s) · ${nd(k.taux_absenteisme, ' %')} d’absentéisme`} />
        <Kpi n={nd(k.taux_remplacement, ' %')} label="Taux de remplacement" icon="check-circle" tone={k.taux_remplacement !== null && k.taux_remplacement < 70 ? 'warn' : 'ok'} sub={`${fmt(k.remplacees)} remplacée(s) · ${fmt(k.non_remplacees)} sans remplaçant`} />
        <Kpi n={`${fmt(k.heures_non_assurees)} h`} label="Heures de cours non assurées" icon="clock" tone={k.heures_non_assurees ? 'bad' : 'ok'} sub={`${fmt(k.heures_remplacees)} h assurées par un remplaçant`} />
        <Kpi n={fmt(k.recurrentes)} label="Enseignants souvent absents" icon="alert-triangle" tone={k.recurrentes ? 'warn' : 'ok'} sub="3 absences ou plus" />
        <Kpi n={fmt(k.a_pourvoir)} label="Absences à venir à pourvoir" icon="calendar" tone={k.a_pourvoir ? 'bad' : 'ok'} sub={`${fmt(k.absences_a_venir)} absence(s) à venir`} />
      </Kpis>
      <div className="grid charts">
        <Carte titre="Jours d’absence par mois"><Columns title="Jours d’absence des enseignants par mois" unit=" j" data={a.par_mois.map((m) => ({ label: m.label, jours: m.jours }))} series={[{ key: 'jours', label: 'Jours', color: ORANGE }]} /></Carte>
        <Carte titre="Absences et remplacements par enseignant"><Bars title="Jours d’absence par enseignant" unit=" j" data={a.par_enseignant.filter((p) => p.jours > 0).map((p) => ({ label: p.nom, value: p.jours }))} /></Carte>
      </div>
      <Tbl vide="Aucune absence d’enseignant enregistrée. Déclarez-les dans « Absences enseignants »." rows={a.par_enseignant} cols={[{ h: 'Enseignant', f: (p) => p.nom }, { h: 'Absences', f: (p) => p.absences }, { h: 'Jours', f: (p) => fmt(p.jours) }, { h: 'Non justifiées', f: (p) => p.non_justifiees }, { h: 'Sans remplaçant', f: (p) => (p.non_remplacees ? <Pill kind="bad">{p.non_remplacees}</Pill> : 0) }, { h: 'Remplacements assurés', f: (p) => p.remplacements }, { h: 'Heures remplacées', f: (p) => `${fmt(p.heures_remplacees)} h` }]} />
      {a.non_remplacees.length > 0 && <><Titre>Absences passées sans remplaçant</Titre>
        <Tbl rows={a.non_remplacees} cols={[{ h: 'Enseignant', f: (x) => x.enseignant }, { h: 'Date', f: (x) => x.date }, { h: 'Période', f: (x) => PERIODE[x.periode] }, { h: 'Motif', f: (x) => x.motif || '—' }, { h: 'Cours non assurés', f: (x) => `${fmt(x.heures)} h` }]} /></>}
      {a.a_venir.length > 0 && <><Titre>Absences à venir</Titre>
        <Tbl rows={a.a_venir} cols={[{ h: 'Enseignant', f: (x) => x.enseignant }, { h: 'Date', f: (x) => x.date }, { h: 'Période', f: (x) => PERIODE[x.periode] }, { h: 'Remplaçant', f: (x) => x.remplacant || <Pill kind="bad">À désigner</Pill> }, { h: 'Cours concernés', f: (x) => `${fmt(x.heures)} h` }]} /></>}
    </>
  );
}
function Enseignants({ d }) {
  const k = d.kpis;
  return (
    <>
      <Kpis>
        <Kpi n={fmt(k.enseignants)} label="Enseignants" icon="presentation" />
        <Kpi n={`${fmt(k.heures_totales)} h`} label="Heures par semaine" icon="clock" sub={`Charge moyenne : ${fmt(k.charge_moyenne)} h`} />
        <Kpi n={fmt(k.surcharge)} label="En surcharge" icon="alert-triangle" tone={k.surcharge ? 'bad' : 'ok'} />
        <Kpi n={fmt(k.sous_charge)} label="En sous-charge" icon="user" tone={k.sous_charge ? 'warn' : 'ok'} />
        <Kpi n={fmt(k.sans_emploi_du_temps)} label="Sans emploi du temps" icon="calendar" tone={k.sans_emploi_du_temps ? 'warn' : 'ok'} />
      </Kpis>
      <div className="grid charts">
        <Carte titre="Charge horaire par enseignant"><Bars title="Heures par semaine" unit=" h" data={d.enseignants.map((e) => ({ label: e.nom, value: e.heures }))} /></Carte>
        <Carte titre="Heures par matière"><Bars title="Heures par matière" unit=" h" data={d.par_matiere.map((m) => ({ label: m.nom, value: m.heures }))} /></Carte>
        <Carte titre="Heures par jour"><Columns title="Heures d’enseignement par jour" unit=" h" data={d.par_jour.map((j) => ({ label: j.label.slice(0, 3), heures: j.heures }))} series={[{ key: 'heures', label: 'Heures', color: BLEU }]} /></Carte>
        <Carte titre="Enseignants par niveau"><Bars title="Enseignants par niveau" data={d.par_niveau.map((x) => ({ label: court(x.niveau), value: x.enseignants }))} /></Carte>
      </div>
      <Titre>Détail par enseignant</Titre>
      <Tbl rows={d.enseignants} cols={[{ h: 'Enseignant', f: (e) => e.nom }, { h: 'Matières', f: (e) => e.matieres.join(', ') || '—' }, { h: 'Niveaux', f: (e) => e.niveaux.map(court).join(', ') || '—' }, { h: 'Classes', f: (e) => e.classes }, { h: 'Jours', f: (e) => e.jours }, { h: 'Heures / semaine', f: (e) => <b>{fmt(e.heures)}</b> }, { h: 'Charge', f: (e) => <Pill kind={STATUT_ENS[e.statut][1]}>{STATUT_ENS[e.statut][0]}</Pill> }]} />
      <Titre>Enseignants par matière</Titre>
      <Tbl rows={d.par_matiere} cols={[{ h: 'Matière', f: (m) => m.nom }, { h: 'Enseignants', f: (m) => m.enseignants }, { h: 'Heures / semaine', f: (m) => fmt(m.heures) }]} />
      <AbsencesEns a={d.absences} />
      <Explication d={d} />
    </>
  );
}

// ---------- 6. Inscriptions ----------
function Inscriptions({ d }) {
  const k = d.kpis; const p = d.prevision;
  return (
    <>
      <Kpis>
        <Kpi n={fmt(k.nouveaux)} label="Nouvelles inscriptions" icon="user-plus" tone="ok" sub="année en cours" />
        <Kpi n={fmt(k.reinscrits)} label="Réinscrits" icon="users" />
        <Kpi n={nd(k.taux_renouvellement, ' %')} label="Taux de renouvellement" icon="check-circle" tone={k.taux_renouvellement !== null && k.taux_renouvellement < 85 ? 'warn' : 'ok'} />
        <Kpi n={fmt(k.departs)} label="Départs / abandons" icon="user-x" tone={k.departs ? 'warn' : 'ok'} sub={`${fmt(k.diplomes)} diplômés`} />
        <Kpi n={fmt(k.effectif_prevu)} label={`Effectif prévu ${p.annee_suivante}`} icon="presentation" sub={`${fmt(k.preinscriptions_en_attente)} pré-inscription(s) en attente`} />
      </Kpis>
      <div className="grid charts">
        <Carte titre="Nouveaux inscrits par année"><Columns title="Nouveaux inscrits par année" data={d.evolution.map((x) => ({ label: x.annee, nouveaux: x.nouveaux }))} series={[{ key: 'nouveaux', label: 'Nouveaux inscrits', color: BLEU }]} /></Carte>
        <Carte titre="Origine géographique des élèves"><Bars title="Élèves par ville ou quartier" data={d.origine.map((o) => ({ label: o.label, value: o.value }))} /></Carte>
        <Carte titre="Pré-inscriptions">
          <div className="kv"><span>Cette année</span><b>{fmt(k.preinscriptions)} dont {fmt(k.preinscriptions_validees)} validée(s)</b></div>
          <div className="kv"><span>Taux de conversion</span><b>{nd(k.taux_conversion_preinscriptions, ' %')}</b></div>
          <div className="kv"><span>Reçues pour {d.preinscriptions_suivante.annee}</span><b>{fmt(d.preinscriptions_suivante.en_attente + d.preinscriptions_suivante.validees)}</b></div>
        </Carte>
      </div>
      <Titre>Fidélisation par année d’entrée</Titre>
      <Tbl rows={d.cohortes} cols={[{ h: 'Année d’entrée', f: (c) => c.annee }, { h: 'Inscrits', f: (c) => c.total }, { h: 'Toujours actifs', f: (c) => c.actifs }, { h: 'Diplômés', f: (c) => c.diplomes }, { h: 'Départs', f: (c) => c.departs }, { h: 'Maintien', f: (c) => <Jauge v={c.taux_maintien} tone={c.taux_maintien >= 85 ? 'ok' : 'warn'} /> }]} />
      <Titre>{`Prévision des effectifs ${p.annee_suivante}`}</Titre>
      {p.renouvellement_estime && <Alert kind="warn">Historique trop court pour mesurer le renouvellement : un taux de 95 % est supposé.</Alert>}
      <Tbl rows={p.par_niveau} cols={[{ h: 'Niveau', f: (x) => x.niveau }, { h: 'Effectif actuel', f: (x) => x.actuel }, { h: 'Passent au niveau', f: (x) => x.poursuivent }, { h: 'Nouveaux prévus', f: (x) => x.nouveaux }, { h: 'Effectif prévu', f: (x) => <b>{x.prevu}</b> }]} />
      <p className="muted small">{p.methode}</p>
      <Explication d={d} />
    </>
  );
}

// ---------- 7. Parents ----------
const STATUT_REC = { ouverte: ['Ouverte', 'warn'], en_cours: ['En cours', ''], resolue: ['Résolue', 'ok'], rejetee: ['Rejetée', 'bad'] };
function Reclamations({ d }) {
  const k = d.kpis; const r = d.reclamations;
  return (
    <>
      <Titre>Réclamations des parents</Titre>
      <Kpis>
        <Kpi n={fmt(k.reclamations)} label="Réclamations cette année" icon="inbox" sub={`${fmt(k.reclamations_resolues)} résolue(s)`} />
        <Kpi n={fmt(k.reclamations_ouvertes)} label="À traiter" icon="alert-triangle" tone={k.reclamations_ouvertes ? 'warn' : 'ok'} sub="ouvertes ou en cours" />
        <Kpi n={fmt(k.reclamations_en_retard)} label="En attente depuis plus de 7 jours" icon="clock" tone={k.reclamations_en_retard ? 'bad' : 'ok'} />
        <Kpi n={nd(k.taux_resolution, ' %')} label="Taux de résolution" icon="check-circle" tone="ok" />
        <Kpi n={nd(k.delai_traitement_jours, ' j')} label="Délai moyen de traitement" icon="calendar" sub="du dépôt à la résolution" />
      </Kpis>
      <div className="grid charts">
        <Carte titre="Par statut"><Donut title="Réclamations par statut" data={r.par_statut.map((x, i) => ({ label: STATUT_REC[x.statut][0], value: x.nombre, color: [ORANGE, BLEU, VERT, ROUGE][i] }))} center={String(k.reclamations)} /></Carte>
        <Carte titre="Par catégorie"><Bars title="Réclamations par catégorie" data={r.par_categorie.map((x) => ({ label: x.label, value: x.nombre }))} /></Carte>
      </div>
      <Tbl vide="Aucune réclamation en attente de traitement." rows={r.en_attente} cols={[{ h: 'Parent', f: (x) => x.parent }, { h: 'Catégorie', f: (x) => x.categorie }, { h: 'Objet', f: (x) => x.objet }, { h: 'Statut', f: (x) => <Pill kind={STATUT_REC[x.statut][1]}>{STATUT_REC[x.statut][0]}</Pill> }, { h: 'Depuis', f: (x) => <Pill kind={x.en_retard ? 'bad' : 'warn'}>{x.jours} jour{x.jours > 1 ? 's' : ''}</Pill> }]} />
    </>
  );
}
function Parents({ d }) {
  const k = d.kpis;
  return (
    <>
      <Kpis>
        <Kpi n={fmt(k.messages_envoyes)} label="Messages envoyés aux parents" icon="message" sub={`${fmt(k.destinataires)} destinataires`} />
        <Kpi n={nd(k.taux_lecture, ' %')} label="Taux de lecture" icon="eye" tone={k.taux_lecture !== null && k.taux_lecture < 50 ? 'bad' : 'ok'} sub={`Notifications : ${nd(k.taux_lecture_notifications, ' %')}`} />
        <Kpi n={fmt(k.parents_sans_lecture)} label="Parents qui ne lisent rien" icon="user-x" tone={k.parents_sans_lecture ? 'warn' : 'ok'} sub={`${fmt(k.parents_lecture_faible)} lisent peu`} />
        <Kpi n={fmt(k.demandes_sans_reponse)} label="Demandes sans réponse" icon="inbox" tone={k.demandes_en_retard ? 'bad' : k.demandes_sans_reponse ? 'warn' : 'ok'} sub={`${fmt(k.demandes_en_retard)} en retard · ${fmt(k.demandes_parents)} au total`} />
        <Kpi n={nd(k.delai_reponse_heures, ' h')} label="Délai moyen de réponse" icon="clock" />
      </Kpis>
      <div className="grid charts">
        <Carte titre="Messages envoyés et lus par mois" large><Columns title="Messages aux parents" data={d.par_mois.map((m) => ({ label: m.label, destinataires: m.destinataires, lus: m.lus }))} series={[{ key: 'destinataires', label: 'Messages reçus', color: GRIS }, { key: 'lus', label: 'Messages lus', color: VERT }]} /></Carte>
      </div>
      <Reclamations d={d} />
      <Titre>Suivi parental à renforcer (parents d’élèves à risque)</Titre>
      <Tbl vide="Aucun parent d’élève à risque ne nécessite de renforcement." rows={d.suivi_renforce} cols={[{ h: 'Parent', f: (r) => r.parent }, { h: 'Téléphone', f: (r) => r.telephone || '—' }, { h: 'Élève', f: (r) => `${r.eleve}${r.classe ? ` (${r.classe})` : ''}` }, { h: 'Risque', f: (r) => <Pill kind={RISQUE[r.niveau][1]}>{RISQUE[r.niveau][0]}</Pill> }, { h: 'Constat', f: (r) => r.constat }, { h: 'Motif', f: (r) => r.raison }]} />
      <Titre>Parents qui n’ont lu aucun message</Titre>
      <Tbl vide="Tous les parents ont lu au moins un message." rows={d.parents_sans_lecture} cols={[{ h: 'Parent', f: (p) => p.nom }, { h: 'Téléphone', f: (p) => p.telephone || '—' }, { h: 'Messages reçus', f: (p) => p.recus }]} />
      <Titre>Parents qui lisent peu</Titre>
      <Tbl vide="Aucun parent dans ce cas." rows={d.parents_lecture_faible} cols={[{ h: 'Parent', f: (p) => p.nom }, { h: 'Téléphone', f: (p) => p.telephone || '—' }, { h: 'Reçus', f: (p) => p.recus }, { h: 'Lus', f: (p) => p.lus }, { h: 'Taux de lecture', f: (p) => <Jauge v={p.taux} tone="warn" /> }]} />
      <Titre>Messages des parents en attente de réponse</Titre>
      <Tbl vide="Toutes les demandes ont reçu une réponse." rows={d.demandes_en_attente} cols={[{ h: 'Parent', f: (r) => r.parent }, { h: 'Objet', f: (r) => r.objet }, { h: 'Depuis', f: (r) => <Pill kind={r.en_retard ? 'bad' : 'warn'}>{r.jours} jour{r.jours > 1 ? 's' : ''}</Pill> }]} />
      <Explication d={d} />
    </>
  );
}

// ---------- 8. Emplois du temps ----------
const STATUT_SALLE = { sous_utilisee: ['Sous-utilisée', 'warn'], saturee: ['Saturée', 'bad'], normale: ['Normale', 'ok'], indisponible: ['Indisponible', ''], inconnu: ['—', ''] };
function Edt({ d }) {
  const k = d.kpis;
  return (
    <>
      <Kpis>
        <Kpi n={nd(k.occupation_moyenne, ' %')} label="Occupation moyenne des salles" icon="door" sub={`${fmt(k.salles_disponibles)} salle(s) disponible(s)`} />
        <Kpi n={fmt(k.conflits)} label="Conflits d’horaires" icon="alert-triangle" tone={k.conflits ? 'bad' : 'ok'} />
        <Kpi n={fmt(k.salles_sous_utilisees)} label="Salles sous-utilisées" icon="building" tone={k.salles_sous_utilisees ? 'warn' : 'ok'} sub={`${fmt(k.salles_saturees)} saturée(s)`} />
        <Kpi n={fmt(k.classes_desequilibrees)} label="Classes déséquilibrées" icon="calendar" tone={k.classes_desequilibrees ? 'warn' : 'ok'} sub={`${fmt(k.classes_sans_emploi_du_temps)} sans emploi du temps`} />
        <Kpi n={`${fmt(k.heures_hebdo)} h`} label="Heures de cours par semaine" icon="clock" sub={`${fmt(k.creneaux)} créneaux · ${fmt(k.creneaux_sans_salle)} sans salle`} />
      </Kpis>
      {d.conflits.length > 0 && <Carte titre="Conflits détectés">{d.conflits.map((c, i) => <Alert key={i} kind="err">{c.detail}</Alert>)}</Carte>}
      <div className="grid charts">
        <Carte titre="Heures par enseignant"><Bars title="Heures par enseignant" unit=" h" data={d.heures_par_enseignant.map((e) => ({ label: e.nom, value: e.heures }))} /></Carte>
        <Carte titre="Heures de cours par jour"><Columns title="Heures de cours par jour" unit=" h" data={d.par_jour.map((j) => ({ label: j.label.slice(0, 3), heures: j.heures }))} series={[{ key: 'heures', label: 'Heures', color: BLEU }]} /></Carte>
      </div>
      <Titre>Occupation des salles</Titre>
      <Tbl vide="Aucune salle enregistrée." rows={d.salles} cols={[{ h: 'Salle', f: (s) => s.nom }, { h: 'Capacité', f: (s) => s.capacite ?? '—' }, { h: 'Heures / semaine', f: (s) => fmt(s.heures) }, { h: 'Occupation', f: (s) => <Jauge v={s.taux} tone={s.statut === 'saturee' ? 'bad' : s.statut === 'sous_utilisee' ? 'warn' : 'ok'} /> }, { h: 'Statut', f: (s) => <Pill kind={STATUT_SALLE[s.statut][1]}>{STATUT_SALLE[s.statut][0]}</Pill> }]} />
      <Titre>Équilibre des emplois du temps par classe</Titre>
      <Tbl rows={d.equilibre} cols={[{ h: 'Classe', f: (e) => e.nom }, ...['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map((j, i) => ({ h: j, f: (e) => (e.par_jour[i] ? `${fmt(e.par_jour[i])} h` : '·') })), { h: 'Total', f: (e) => `${fmt(e.total)} h` },
        { h: 'Équilibre', f: (e) => (e.statut === 'equilibre' ? <Pill kind="ok">Équilibré</Pill> : e.statut === 'desequilibre' ? <Pill kind="warn">{`Écart de ${fmt(e.ecart)} h`}</Pill> : <Pill kind="bad">Sans emploi du temps</Pill>) }]} />
      <Explication d={d} />
    </>
  );
}

// ---------- 9. Alertes précoces ----------
function Risques({ d }) {
  const k = d.kpis;
  return (
    <>
      <Kpis>
        <Kpi n={fmt(k.eleves_a_risque)} label="Élèves à risque" icon="alert-triangle" tone={k.eleves_a_risque ? 'warn' : 'ok'} sub={`${fmt(k.risque_eleve)} élevé · ${fmt(k.risque_moyen)} moyen · ${fmt(k.risque_faible)} faible`} />
        <Kpi n={fmt(k.echec)} label="Risque d’échec" icon="graduation" tone={k.echec ? 'bad' : 'ok'} />
        <Kpi n={fmt(k.abandon)} label="Risque d’abandon" icon="user-x" tone={k.abandon ? 'bad' : 'ok'} />
        <Kpi n={fmt(k.impaye)} label="Risque d’impayé" icon="banknote" tone={k.impaye ? 'warn' : 'ok'} />
        <Kpi n={fmt(k.double_risque)} label="Absences + baisse des résultats" icon="alert-triangle" tone={k.double_risque ? 'bad' : 'ok'} />
      </Kpis>
      {d.alertes.length > 0 && <Titre>Alertes : intervention conseillée</Titre>}
      {d.alertes.map((a, i) => <Alert key={i} kind={a.niveau === 'eleve' ? 'err' : 'warn'}><div><b>{a.eleve}</b>{a.classe ? ` (${a.classe})` : ''} · score {a.score}/100<br />{a.message}<br /><b>Action :</b> {a.action}</div></Alert>)}
      <div className="grid charts">
        <Carte titre="Répartition par niveau de risque"><Donut title="Niveau de risque" data={[{ label: 'Élevé', value: k.risque_eleve, color: ROUGE }, { label: 'Moyen', value: k.risque_moyen, color: ORANGE }, { label: 'Faible', value: k.risque_faible, color: GRIS }]} center={String(k.eleves_a_risque)} /></Carte>
        <Carte titre="Élèves à risque par classe"><Bars title="Élèves à risque par classe" data={d.par_classe.map((c) => ({ label: c.nom, value: c.a_risque }))} /></Carte>
      </div>
      <Titre>Liste des élèves à risque</Titre>
      <Tbl vide="Aucun élève ne présente de signal de risque." rows={d.eleves} cols={[{ h: 'Élève', f: (e) => <b>{e.nom}</b> }, { h: 'Classe', f: (e) => e.classe || '—' }, { h: 'Score', f: (e) => <Pill kind={RISQUE[e.niveau][1]}>{e.score}</Pill> }, { h: 'Risques', f: (e) => e.types.map((t) => TYPES[t]).join(', ') || '—' },
        { h: 'Moyenne', f: (e) => nd(e.moyenne) }, { h: 'Abs. non just.', f: (e) => e.absences_nj }, { h: 'Reste dû', f: (e) => (e.solde ? tnd(e.solde) : '—') }, { h: 'Pourquoi', f: (e) => e.raisons.join(' · ') }, { h: 'Parents', f: (e) => contact(e.parents) }]} />
      <Explication d={d} />
    </>
  );
}

// ---------- 10. Stratégie ----------
const CHAMPS = [['variation', 'Variation des effectifs (%)', -50, 100, 5], ['frais', 'Hausse des frais de scolarité (%)', -50, 100, 1], ['recouvrement', 'Taux de recouvrement (%)', 0, 100, 1], ['cout_enseignant', 'Coût mensuel d’un enseignant (TND)', 0, 100000, 50], ['charges_par_eleve', 'Charges par élève et par an (TND)', 0, 100000, 10], ['charge_cible', 'Charge cible par enseignant (h/semaine)', 1, 60, 1]];
function Simulation({ d }) {
  const [p, setP] = useState({ variation: 0, frais: 0, recouvrement: d.hypotheses.recouvrement, cout_enseignant: d.hypotheses.cout_enseignant, charges_par_eleve: d.hypotheses.charges_par_eleve, charge_cible: d.hypotheses.charge_cible });
  const [r, setR] = useState(null); const [err, setErr] = useState(''); const t = useRef();
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => { api(`/bi/simulation?${new URLSearchParams(Object.entries(p).map(([k, v]) => [k, v === '' ? '' : String(v)]))}`).then((x) => { setR(x); setErr(''); }).catch((e) => setErr(e.message)); }, 350);
    return () => clearTimeout(t.current);
  }, [p]);
  const s = r?.simulation; const a = r?.actuel;
  const delta = (x, y) => (x === null || y === null || x === y ? '' : ` (${x > y ? '+' : ''}${fmt(x - y)})`);
  return (
    <Carte titre={`Simulateur de scénario pour ${d.prevision.annee_suivante}`}>
      <p className="muted small">Modifiez les hypothèses : les résultats se recalculent aussitôt. Rien n’est enregistré.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '.75rem' }}>
        {CHAMPS.map(([k, label, min, max, step]) => <div key={k}><label htmlFor={`sim-${k}`}>{label}</label><input id={`sim-${k}`} type="number" min={min} max={max} step={step} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></div>)}
      </div>
      <Alert>{err}</Alert>
      {s && (
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <table>
            <thead><tr><th>Indicateur</th><th>Prévision de base</th><th>Votre scénario</th></tr></thead>
            <tbody>
              <tr><td>Effectif</td><td>{fmt(a.effectif)}</td><td><b>{fmt(s.effectif)}</b>{delta(s.effectif, a.effectif)}</td></tr>
              <tr><td>Classes nécessaires</td><td>{fmt(a.classes)} (actuellement {fmt(a.classes_actuelles)})</td><td><b>{fmt(s.classes)}</b> · {s.classes_a_ouvrir ? `${s.classes_a_ouvrir} à ouvrir` : 'aucune à ouvrir'}</td></tr>
              <tr><td>Enseignants nécessaires</td><td>{nd(a.enseignants)} (actuellement {fmt(a.enseignants_actuels)})</td><td><b>{nd(s.enseignants)}</b> · {s.enseignants_a_recruter ? `${s.enseignants_a_recruter} à recruter` : 'pas de recrutement'}</td></tr>
              <tr><td>Salles nécessaires</td><td>{fmt(a.salles)} (disponibles : {fmt(a.salles_disponibles)})</td><td><b>{fmt(s.salles)}</b>{s.salles_manquantes ? ` · ${s.salles_manquantes} manquante(s)` : ''}</td></tr>
              <tr><td>Recettes estimées</td><td>{tnd(a.recettes)}</td><td><b>{tnd(s.recettes)}</b></td></tr>
              <tr><td>Dépenses estimées (hypothèses)</td><td>{tnd(a.depenses)}</td><td><b>{tnd(s.depenses)}</b></td></tr>
              <tr><td>Résultat estimé</td><td>{tnd(a.resultat)}</td><td><Pill kind={s.resultat >= 0 ? 'ok' : 'bad'}>{tnd(s.resultat)}</Pill>{s.marge !== null && <span className="muted small"> marge {s.marge} %</span>}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </Carte>
  );
}
function Strategie({ d }) {
  const p = d.prevision; const b = d.besoins;
  return (
    <>
      <Kpis>
        <Kpi n={fmt(p.effectif_prevu)} label={`Effectif prévu ${p.annee_suivante}`} icon="presentation" sub={`Aujourd’hui : ${fmt(p.effectif_actuel)}`} />
        <Kpi n={`${fmt(b.classes)} classes`} label="Besoin en classes" icon="school" tone={b.classes_a_ouvrir ? 'warn' : 'ok'} sub={`Actuellement ${fmt(b.classes_actuelles)}`} />
        <Kpi n={nd(b.enseignants)} label="Enseignants nécessaires" icon="user" tone={b.enseignants_a_recruter ? 'warn' : 'ok'} sub={`Actuellement ${fmt(b.enseignants_actuels)}`} />
        <Kpi n={fmt(b.salles)} label="Salles nécessaires" icon="door" tone={b.salles_manquantes ? 'warn' : 'ok'} sub={`${fmt(b.salles_disponibles)} disponible(s)`} />
        <Kpi n={tnd(b.recettes)} label="Recettes prévues" icon="banknote" tone="ok" sub={`Recouvrement supposé : ${fmt(b.parametres.recouvrement)} %`} />
      </Kpis>
      <Titre>Recommandations automatiques</Titre>
      {d.recommandations.length === 0 && <Alert kind="ok">Aucun point d’attention particulier détecté pour le moment.</Alert>}
      <div className="grid charts">
        {d.recommandations.map((r, i) => <Carte key={i}><div style={{ display: 'flex', gap: '.5rem', justifyContent: 'space-between', alignItems: 'flex-start' }}><b>{r.titre}</b><Pill kind={PRIO[r.priorite][1]}>{PRIO[r.priorite][0]}</Pill></div><p className="muted small" style={{ margin: '.25rem 0' }}>{r.domaine}{r.detail ? ` · ${r.detail}` : ''}</p><p style={{ margin: 0 }}><Icon name="check" size={14} /> {r.action}</p></Carte>)}
      </div>
      <Titre>Scénarios d’effectifs</Titre>
      <Tbl rows={d.scenarios} cols={[{ h: 'Scénario', f: (s) => <b>{s.nom}</b> }, { h: 'Effectif', f: (s) => s.effectif }, { h: 'Classes', f: (s) => `${s.classes}${s.classes_a_ouvrir ? ` (+${s.classes_a_ouvrir})` : ''}` }, { h: 'Enseignants', f: (s) => nd(s.enseignants) }, { h: 'Salles', f: (s) => s.salles }, { h: 'Recettes', f: (s) => tnd(s.recettes) }, { h: 'Dépenses*', f: (s) => tnd(s.depenses) }, { h: 'Résultat', f: (s) => <Pill kind={s.resultat >= 0 ? 'ok' : 'bad'}>{tnd(s.resultat)}</Pill> }]} />
      <p className="muted small">* Dépenses estimées à partir des hypothèses du simulateur ci-dessous.</p>
      <Simulation d={d} />
      <div className="grid charts" style={{ marginTop: '1rem' }}>
        <Carte titre="Prévision des effectifs par niveau"><Columns title="Effectif actuel et prévu par niveau" data={p.par_niveau.map((x) => ({ label: court(x.niveau), actuel: x.actuel, prevu: x.prevu }))} series={[{ key: 'actuel', label: 'Actuel', color: GRIS }, { key: 'prevu', label: 'Prévu', color: BLEU }]} /></Carte>
        <Carte titre="Besoins par niveau (classes)"><Bars title="Classes nécessaires par niveau" data={b.par_niveau.map((x) => ({ label: court(x.niveau), value: x.classes }))} /></Carte>
      </div>
      <Titre>Comparaison entre années scolaires</Titre>
      <Tbl rows={d.comparaison} cols={[{ h: 'Année', f: (c) => <b>{c.annee}</b> }, { h: 'Nouveaux inscrits', f: (c) => c.nouveaux }, { h: 'Élèves notés', f: (c) => c.eleves_notes }, { h: 'Moyenne /20', f: (c) => nd(c.moyenne) }, { h: 'Réussite', f: (c) => nd(c.taux_reussite, ' %') }, { h: 'Jours d’absence', f: (c) => fmt(c.jours_absence) }, { h: 'Encaissé', f: (c) => tnd(c.encaisse) }]} />
      <Explication d={d} />
    </>
  );
}

const VUES = { general: General, financier: Financier, pedagogique: Pedagogie, absences: Absences, enseignants: Enseignants, inscriptions: Inscriptions, communication: Parents, edt: Edt, risques: Risques, strategique: Strategie };

export default function Decisionnel() {
  const initial = ONGLETS.some(([k]) => k === window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'general';
  const [tab, setTab] = useState(initial); const [data, setData] = useState({}); const [err, setErr] = useState(''); const [chargement, setChargement] = useState(false);
  const charger = useCallback(async (t) => {
    setChargement(true);
    try { const d = await api(`/bi/${t}`); setData((x) => ({ ...x, [t]: d })); setErr(''); } catch (e) { setErr(e.message); } finally { setChargement(false); }
  }, []);
  useEffect(() => { if (!data[tab]) charger(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const choisir = (t) => { setTab(t); window.history.replaceState(null, '', `#${t}`); };
  const d = data[tab]; const Vue = VUES[tab];
  return (
    <div>
      <PageHeader title="Aide à la décision" subtitle={`Business Intelligence · année scolaire ${d?.annee || ''} · indicateurs calculés à partir des données de votre école, avec leurs règles de calcul.`}>
        <button type="button" className="btn sec sm" onClick={() => charger(tab)} disabled={chargement}>{chargement ? 'Calcul…' : 'Actualiser'}</button>
      </PageHeader>
      <div className="tabs" role="tablist" aria-label="Tableaux de bord">
        {ONGLETS.map(([k, label, icon]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => choisir(k)}><Icon name={icon} size={16} /> {label}</button>)}
      </div>
      <Alert>{err}</Alert>
      {!d && !err && <Spinner label="Calcul des indicateurs…" />}
      {d && <div role="tabpanel" aria-label={ONGLETS.find(([k]) => k === tab)[1]}><Vue d={d} /><p className="muted small" style={{ marginTop: '1.5rem' }}>Calculé le {new Date(d.genere_le).toLocaleString('fr-FR')}. Aide à la décision : ces indicateurs éclairent le jugement de l’équipe, ils ne le remplacent pas.</p></div>}
    </div>
  );
}
