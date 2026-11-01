// Fabrique de routes CRUD : RBAC, validation, journalisation (audit), suppression logique contrôlée.
const express = require('express');
const { q, tx } = require('./db');
const { allow } = require('./auth');
const { audit } = require('./audit');
const { ah, HttpError } = require('./util');
const config = require('./config');
const V = require('./services/validate');

module.exports = function crud(cfg) {
  const {
    table, fields, required = [], read, write, from = `${table} t`, columns = 't.*', order = 't.id DESC',
    searchFields = [], filters = [], scope, annee = false, soft = true, deleteChecks = [],
    beforeSave, afterSave, afterCommit, beforeDelete,
  } = cfg;
  const allFields = annee ? [...fields, 'annee_scolaire'] : fields;
  const r = express.Router();
  const notDeleted = soft ? 't.deleted_at IS NULL' : 'TRUE';

  const pick = (body) => {
    const d = {};
    for (const f of allFields) if (body[f] !== undefined) d[f] = body[f] === '' ? null : body[f];
    return d;
  };
  const fetchOne = async (id) =>
    (await q(`SELECT ${columns} FROM ${from} WHERE t.id=$1`, [id])).rows[0];

  r.get('/', allow(...read), ah(async (req, res) => {
    const params = [];
    const p = (v) => { params.push(v); return '$' + params.length; };
    const where = [notDeleted];
    if (annee) {
      const a = req.query.annee || config.anneeCourante;
      if (a !== 'all') where.push(`t.annee_scolaire=${p(a)}`);
    }
    for (const f of filters) if (req.query[f] !== undefined && req.query[f] !== '') where.push(`t.${f}=${p(req.query[f])}`);
    if (req.query.q && searchFields.length)
      where.push('(' + searchFields.map((f) => `${f}::text ILIKE ${p('%' + req.query.q + '%')}`).join(' OR ') + ')');
    if (scope) { const s = await scope(req.user, p, req); if (s) where.push(s); }
    const { rows } = await q(`SELECT ${columns} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 2000`, params);
    res.json(rows);
  }));

  r.get('/:id(\\d+)', allow(...read), ah(async (req, res) => {
    const params = [req.params.id];
    const p = (v) => { params.push(v); return '$' + params.length; };
    const where = [notDeleted, 't.id=$1'];
    if (scope) { const s = await scope(req.user, p, req); if (s) where.push(s); }
    const { rows } = await q(`SELECT ${columns} FROM ${from} WHERE ${where.join(' AND ')}`, params);
    if (!rows[0]) throw new HttpError(404, 'Introuvable');
    res.json(rows[0]);
  }));

  r.post('/', allow(...write), ah(async (req, res) => {
    const data = pick(req.body);
    if (annee && data.annee_scolaire) data.annee_scolaire = V.annee(data.annee_scolaire);
    if (annee && !data.annee_scolaire) data.annee_scolaire = config.anneeCourante;
    const miss = required.filter((f) => data[f] === undefined || data[f] === null);
    if (miss.length) throw new HttpError(400, `Champs obligatoires manquants : ${miss.join(', ')}`);
    const ctx = { user: req.user, body: req.body, data, req, isNew: true };
    const row = await tx(async (cl) => {
      ctx.client = cl; ctx.merged = { ...data };
      if (beforeSave) await beforeSave(ctx);
      const cols = Object.keys(data);
      const ins = await cl.query(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        cols.map((c) => data[c]));
      const row = ins.rows[0];
      if (afterSave) await afterSave({ ...ctx, row });
      await audit(cl, req.user, 'create', table, row.id, null, row);
      return row;
    });
    if (afterCommit) afterCommit({ ...ctx, row }).catch((e) => console.error(`[${table}] afterCommit`, e.message));
    res.status(201).json(await fetchOne(row.id));
  }));

  r.put('/:id(\\d+)', allow(...write), ah(async (req, res) => {
    const id = Number(req.params.id);
    const old = (await q(`SELECT * FROM ${table} t WHERE t.id=$1 AND ${notDeleted}`, [id])).rows[0];
    if (!old) throw new HttpError(404, 'Introuvable');
    const data = pick(req.body);
    if (annee && data.annee_scolaire !== undefined) data.annee_scolaire = V.annee(data.annee_scolaire) || old.annee_scolaire;
    const ctx = { user: req.user, body: req.body, data, old, req, isNew: false };
    const row = await tx(async (cl) => {
      ctx.client = cl; ctx.merged = { ...old, ...data };
      if (beforeSave) await beforeSave(ctx);
      const cols = Object.keys(data);
      let row = old;
      if (cols.length) {
        const upd = await cl.query(
          `UPDATE ${table} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`,
          [...cols.map((c) => data[c]), id]);
        row = upd.rows[0];
      }
      if (afterSave) await afterSave({ ...ctx, row });
      await audit(cl, req.user, 'update', table, id, old, row);
      return row;
    });
    if (afterCommit) afterCommit({ ...ctx, row }).catch((e) => console.error(`[${table}] afterCommit`, e.message));
    res.json(await fetchOne(id));
  }));

  r.delete('/:id(\\d+)', allow(...write), ah(async (req, res) => {
    const id = Number(req.params.id);
    const old = (await q(`SELECT * FROM ${table} t WHERE t.id=$1 AND ${notDeleted}`, [id])).rows[0];
    if (!old) throw new HttpError(404, 'Introuvable');
    const force = req.query.force === 'true';
    const cleanups = [];
    for (const chk of deleteChecks) {
      const n = (await q(chk.sql, [id])).rows[0].n;
      if (n > 0) {
        if (chk.force && force) cleanups.push(chk.onForce);
        else throw new HttpError(409, chk.message, { confirmable: !!chk.force });
      }
    }
    await tx(async (cl) => {
      if (beforeDelete) await beforeDelete({ user: req.user, old, client: cl });
      for (const sql of cleanups) if (sql) await cl.query(sql, [id]);
      if (soft) await cl.query(`UPDATE ${table} SET deleted_at=now() WHERE id=$1`, [id]);
      else await cl.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
      await audit(cl, req.user, 'delete', table, id, old, null);
    });
    res.json({ ok: true });
  }));

  return r;
};
