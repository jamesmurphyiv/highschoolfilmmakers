-- HSF Board v1 schema (applied to D1 database hsf-board)
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  logline TEXT NOT NULL,
  genre TEXT NOT NULL,
  compensation TEXT NOT NULL,
  roles TEXT NOT NULL,
  city TEXT NOT NULL,
  region TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  lat REAL,
  lon REAL,
  ig_handle TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  ip_hash TEXT
);
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash TEXT
);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_reports_project ON reports(project_id);
