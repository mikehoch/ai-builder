const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID  = process.env.NOTION_DATABASE_ID;

const VALID_STATUSES = new Set(['Suggested', 'To Build', 'In Progress', 'Done']);

/* Map a Notion page to the shape the frontend expects */
function toCard(page) {
  const p = page.properties;
  return {
    id:          page.id,
    name:        p.Name?.title?.[0]?.plain_text        ?? '',
    status:      p.Status?.select?.name                ?? 'To Build',
    priority:    p.Priority?.select?.name              ?? null,
    description: p.Description?.rich_text?.[0]?.plain_text ?? '',
    submittedBy: p['Submitted by']?.rich_text?.[0]?.plain_text ?? null,
    submittedAt: p['Submitted at']?.date?.start        ?? null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  /* ── GET: return all rows ── */
  if (req.method === 'GET') {
    try {
      const pages = [];
      let cursor;

      do {
        const resp = await notion.databases.query({
          database_id: DB_ID,
          start_cursor: cursor,
          page_size: 100,
        });
        pages.push(...resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
      } while (cursor);

      return res.status(200).json(pages.map(toCard));
    } catch (err) {
      console.error('GET error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* ── PATCH: update Status of one row ── */
  if (req.method === 'PATCH') {
    const { id, status } = req.body ?? {};

    if (!id || !status) {
      return res.status(400).json({ error: 'id and status are required' });
    }
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` });
    }

    try {
      await notion.pages.update({
        page_id: id,
        properties: { Status: { select: { name: status } } },
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('PATCH error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
};
