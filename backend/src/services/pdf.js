const PDFDocument = require('pdfkit');
const config = require('../config');

const money = (n) => `${Number(n).toFixed(2)} TND`;
const MODES = { especes: 'Espèces', virement: 'Virement', mobile_money: 'Mobile money' };

function header(doc, titre) {
  doc.fontSize(16).fillColor('#1B2F5B').text(require('../db').currentSchool()?.schoolNom || config.plateformeNom, { align: 'center' });
  doc.moveDown(0.3).fontSize(13).fillColor('#000').text(titre, { align: 'center' });
  doc.moveTo(50, doc.y + 8).lineTo(545, doc.y + 8).strokeColor('#C8372D').lineWidth(1.5).stroke();
  doc.moveDown(1.5).fillColor('#000');
}
function stream(res, filename, build) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  build(doc);
  doc.end();
}
function row(doc, cols, widths, bold = false, y = doc.y) {
  let x = 50;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
  cols.forEach((c, i) => { doc.text(String(c ?? ''), x, y, { width: widths[i] - 6 }); x += widths[i]; });
  doc.y = y + 18; doc.x = 50;
}

function receiptPdf(res, p, solde) {
  stream(res, `${p.numero_recu}.pdf`, (doc) => {
    header(doc, `REÇU DE PAIEMENT N° ${p.numero_recu}`);
    doc.font('Helvetica').fontSize(11);
    const lines = [
      ['Élève', `${p.eleve_nom} (${p.matricule || '—'})`], ['Date', p.date_paiement], ['Libellé', p.tarif_libelle || 'Paiement'],
      ['Mode de paiement', MODES[p.mode] || p.mode], ['Référence', p.reference || '—'], ['Montant payé', money(p.montant)],
      ['Total dû (année)', money(solde.total_du)], ['Total payé (année)', money(solde.total_paye)], ['Solde restant', money(solde.solde)],
    ];
    lines.forEach(([k, v]) => { doc.font('Helvetica-Bold').text(k + ' : ', { continued: true }).font('Helvetica').text(String(v)); doc.moveDown(0.4); });
    doc.moveDown(2).fontSize(9).fillColor('#555').text(`Année scolaire ${p.annee_scolaire} – document généré automatiquement.`);
  });
}

function bulletinPdf(res, b) {
  stream(res, `bulletin-${b.eleve.nom}-${b.eleve.prenom}.pdf`, (doc) => {
    header(doc, `BULLETIN SCOLAIRE – ${b.trimestre ? 'Trimestre ' + b.trimestre : 'Année complète'} – ${b.annee_scolaire}`);
    doc.font('Helvetica').fontSize(11)
      .text(`Élève : ${b.eleve.nom} ${b.eleve.prenom}   Matricule : ${b.eleve.matricule || '—'}`)
      .text(`Classe : ${b.classe || '—'}   Enseignant titulaire : ${b.titulaire || '—'}`).moveDown();
    const W = [230, 80, 90, 95];
    row(doc, ['Matière', 'Coeff.', 'Moyenne /20', 'Nb notes'], W, true);
    doc.moveTo(50, doc.y - 4).lineTo(545, doc.y - 4).strokeColor('#999').lineWidth(0.5).stroke();
    b.matieres.forEach((m) => row(doc, [m.nom, m.coefficient, m.moyenne?.toFixed(2), m.nb_notes], W));
    doc.moveDown().font('Helvetica-Bold').fontSize(12)
      .text(`Moyenne générale : ${b.moyenne_generale !== null ? b.moyenne_generale.toFixed(2) + ' / 20' : '—'}`)
      .font('Helvetica').fontSize(11)
      .text(`Rang : ${b.rang ? `${b.rang} / ${b.effectif}` : '—'}   Moyenne de la classe : ${b.moyenne_classe ?? '—'}`)
      .text(`Absences : ${b.absences.non_justifiees} non justifiée(s), ${b.absences.justifiees} justifiée(s)`)
      .moveDown().text(`Appréciation : ${b.appreciation}`);
  });
}
module.exports = { receiptPdf, bulletinPdf };
