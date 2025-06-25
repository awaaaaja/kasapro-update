const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const db = new sqlite3.Database('./kasapro.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');

  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON;');
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT
      )
    `, (err) => { if (err) console.error('Error creating users table:', err.message); });
    db.run(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        name TEXT,
        phone TEXT,
        address TEXT,
        rayon TEXT
      )
    `, (err) => { if (err) console.error('Error creating members table:', err.message); });
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        type TEXT,
        description TEXT,
        amount INTEGER,
        method TEXT,
        date TEXT,
        memberId TEXT,
        month TEXT,
        year TEXT,
        category TEXT,
        FOREIGN KEY (memberId) REFERENCES members(id)
      )
    `, (err) => { if (err) console.error('Error creating transactions table:', err.message); });
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organizationName TEXT,
        activeMonth TEXT,
        monthlyFee INTEGER
      )
    `, (err) => { if (err) console.error('Error creating settings table:', err.message); });
    db.run(`
      CREATE TABLE IF NOT EXISTS months (
        id TEXT PRIMARY KEY,
        name TEXT
      )
    `, (err) => { if (err) console.error('Error creating months table:', err.message); });

    const months = [
      ['1', 'Januari'], ['2', 'Februari'], ['3', 'Maret'], ['4', 'April'],
      ['5', 'Mei'], ['6', 'Juni'], ['7', 'Juli'], ['8', 'Agustus'],
      ['9', 'September'], ['10', 'Oktober'], ['11', 'November'], ['12', 'Desember']
    ];
    months.forEach(([id, name]) => {
      db.run(`INSERT OR IGNORE INTO months (id, name) VALUES (?, ?)`, [id, name], (err) => {
        if (err) console.error(`Error inserting month ${name}:`, err.message);
      });
    });

    db.run(
      `INSERT OR IGNORE INTO users (id, username, password, role) VALUES (?, ?, ?, ?)`,
      [uuidv4(), 'admin', 'password', 'bendahara'],
      (err) => {
        if (err) console.error('Error inserting default user:', err.message);
        else console.log('Default user inserted or already exists.');
      }
    );

    db.run(
      `INSERT OR IGNORE INTO settings (organizationName, activeMonth, monthlyFee) VALUES (?, ?, ?)`,
      ['KasaPro', '6', 100000],
      (err) => {
        if (err) console.error('Error inserting default settings:', err.message);
        else console.log('Default settings inserted or already exists.');
      }
    );
  });
});

// Helper function to format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount);
};

// Authentication Middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const role = authHeader.split(' ')[1];
  req.user = { role };
  next();
};

// Login Endpoint
app.post('/api/login', (req, res) => {
  let { username, password, role } = req.body;
  username = username ? username.trim() : '';
  password = password ? password.trim() : '';
  role = role ? role.trim() : '';
  console.log('Login attempt:', { username, password, role });
  db.get(
    `SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND LOWER(password) = LOWER(?) AND LOWER(role) = LOWER(?)`,
    [username, password, role],
    (err, user) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'Database error' });
      }
      console.log('Query result:', user || 'No user found');
      if (!user) {
        return res.status(401).json({ error: 'Invalid username, password, or role' });
      }
      res.json({ role: user.role });
    }
  );
});

// Members Endpoints
app.get('/api/members', authenticate, (req, res) => {
  db.all(`SELECT * FROM members`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.post('/api/members', authenticate, (req, res) => {
  if (req.user.role === 'pengawas') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { name, phone, address, rayon } = req.body;
  const id = uuidv4();
  db.run(
    `INSERT INTO members (id, name, phone, address, rayon) VALUES (?, ?, ?, ?, ?)`,
    [id, name, phone, address, rayon],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ id, name, phone, address, rayon });
    }
  );
});

app.put('/api/members/:id', authenticate, (req, res) => {
  if (req.user.role === 'pengawas') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { name, phone, address, rayon } = req.body;
  const { id } = req.params;
  db.run(
    `UPDATE members SET name = ?, phone = ?, address = ?, rayon = ? WHERE id = ?`,
    [name, phone, address, rayon, id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ id, name, phone, address, rayon });
    }
  );
});

// Transactions Endpoints
app.get('/api/transactions', authenticate, (req, res) => {
  db.all(`SELECT * FROM transactions`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

app.post('/api/transactions/income', authenticate, (req, res) => {
  if (req.user.role === 'pengawas') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { type, memberId, year, months, amount, method, description } = req.body;
  const id = uuidv4();
  if (type === 'member') {
    const promises = months.map((monthId) => {
      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO transactions (id, type, description, amount, method, date, memberId, month, year) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            'income',
            description,
            amount,
            method,
            new Date().toISOString().split('T')[0],
            memberId,
            monthId,
            year,
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
    Promise.all(promises)
      .then(() => res.json({ success: true }))
      .catch((err) => res.status(500).json({ error: 'Database error' }));
  } else {
    db.run(
      `INSERT INTO transactions (id, type, description, amount, method, date) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, 'income', description, amount, method, new Date().toISOString().split('T')[0]],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ id, type: 'income', description, amount, method, date: new Date().toISOString().split('T')[0] });
      }
    );
  }
});

app.post('/api/transactions/installment', authenticate, (req, res) => {
  if (req.user.role === 'pengawas') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { memberId, month, amount, method, description } = req.body;
  const id = uuidv4();
  db.run(
    `INSERT INTO transactions (id, type, description, amount, method, date, memberId, month, year) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      'installment',
      description,
      amount,
      method,
      new Date().toISOString().split('T')[0],
      memberId,
      month,
      '2025',
    ],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ id, type: 'installment', description, amount, method, date: new Date().toISOString().split('T')[0], memberId, month, year: '2025' });
    }
  );
});

app.post('/api/transactions/expense', authenticate, (req, res) => {
  if (req.user.role === 'pengawas') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { name, category, amount, method, description } = req.body;
  const id = uuidv4();
  db.run(
    `INSERT INTO transactions (id, type, description, amount, method, date, category) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, 'expense', name, amount, method, new Date().toISOString().split('T')[0], category],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ id, type: 'expense', description: name, amount, method, date: new Date().toISOString().split('T')[0], category });
    }
  );
});

// Settings Endpoints
app.get('/api/settings', authenticate, (req, res) => {
  db.get(`SELECT * FROM settings WHERE id = 1`, [], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(row);
  });
});

app.put('/api/settings', authenticate, (req, res) => {
  if (req.user.role === 'pengawas') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { organizationName, activeMonth, monthlyFee } = req.body;
  db.run(
    `UPDATE settings SET organizationName = ?, activeMonth = ?, monthlyFee = ? WHERE id = 1`,
    [organizationName, activeMonth, monthlyFee],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ organizationName, activeMonth, monthlyFee });
    }
  );
});

// Reports Endpoint
app.get('/api/reports', authenticate, (req, res) => {
  const { month, year, status, search } = req.query;
  let query = `
    SELECT m.id as memberId, m.name as memberName, mo.id as monthId, mo.name as month,
           t.type, t.amount, t.method, t.year
    FROM members m
    CROSS JOIN months mo
    LEFT JOIN transactions t ON t.memberId = m.id AND t.month = mo.id
    WHERE 1=1
  `;
  const params = [];

  if (month) {
    query += ` AND mo.id = ?`;
    params.push(month);
  }
  if (year) {
    query += ` AND t.year = ?`;
    params.push(year);
  }
  if (search) {
    query += ` AND m.name LIKE ?`;
    params.push(`%${search}%`);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    db.get(`SELECT monthlyFee FROM settings WHERE id = 1`, [], (err, settings) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      const monthlyFee = settings.monthlyFee;

      const reports = rows.map(row => {
        const installment = rows
          .filter(r => r.memberId === row.memberId && r.monthId === row.monthId && r.type === 'installment')
          .reduce((sum, r) => sum + (r.amount || 0), 0);
        return {
          id: `${row.memberId}-${row.monthId}`,
          memberName: row.memberName,
          month: row.month,
          status: row.type === 'income' ? 'paid' : installment > 0 ? 'installment' : 'unpaid',
          amount: row.type === 'income' ? monthlyFee : installment,
          installmentPaid: installment,
          method: row.method || '-',
        };
      });

      if (status) {
        const filteredReports = reports.filter(r => r.status === status);
        res.json(filteredReports);
      } else {
        res.json(reports);
      }
    });
  });
});

// Export Reports to CSV
app.get('/api/reports/export', authenticate, (req, res) => {
  const { month, year, status, search } = req.query;
  let query = `
    SELECT m.id as memberId, m.name as memberName, mo.id as monthId, mo.name as month,
           t.type, t.amount, t.method, t.year
    FROM members m
    CROSS JOIN months mo
    LEFT JOIN transactions t ON t.memberId = m.id AND t.month = mo.id
    WHERE 1=1
  `;
  const params = [];

  if (month) {
    query += ` AND mo.id = ?`;
    params.push(month);
  }
  if (year) {
    query += ` AND t.year = ?`;
    params.push(year);
  }
  if (search) {
    query += ` AND m.name LIKE ?`;
    params.push(`%${search}%`);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    db.get(`SELECT monthlyFee FROM settings WHERE id = 1`, [], (err, settings) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      const monthlyFee = settings.monthlyFee;

      const reports = rows.map(row => {
        const installment = rows
          .filter(r => r.memberId === row.memberId && r.monthId === row.monthId && r.type === 'installment')
          .reduce((sum, r) => sum + (r.amount || 0), 0);
        return {
          id: `${row.memberId}-${row.monthId}`,
          memberName: row.memberName,
          month: row.month,
          status: row.type === 'income' ? 'Lunas' : installment > 0 ? `Cicilan (${formatCurrency(installment)})` : 'Belum Bayar',
          amount: row.type === 'income' ? formatCurrency(monthlyFee) : formatCurrency(installment),
          method: row.method || '-',
        };
      });

      const filteredReports = status ? reports.filter(r => r.status.includes(status)) : reports;
      const headers = ['No', 'Nama Anggota', 'Bulan', 'Status', 'Jumlah', 'Metode'];
      const csvRows = filteredReports.map((r, i) => [
        i + 1,
        r.memberName,
        r.month,
        r.status,
        r.amount,
        r.method,
      ]);

      const csvContent = [
        headers.join(','),
        ...csvRows.map(row => row.join(',')),
      ].join('\n');

      res.header('Content-Type', 'text/csv');
      res.attachment('laporan_pembayaran.csv');
      res.send(csvContent);
    });
  });
});

// Static files
app.use(express.static('public'));

// Catch-all route for debugging
app.use((req, res) => {
  console.log(`Unhandled route: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});