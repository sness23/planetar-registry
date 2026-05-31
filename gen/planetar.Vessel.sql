CREATE TABLE planetar_vessel (
  id TEXT PRIMARY KEY,
  mmsi INTEGER NOT NULL,
  name TEXT NOT NULL,
  vessel_class TEXT,
  flag TEXT,
  length_m REAL,
  callsign TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  sog REAL,
  cog REAL,
  heading REAL,
  destination TEXT,
  last_seen_ns TEXT NOT NULL,
  first_seen_ns TEXT,
  in_bbox INTEGER,
  confidence REAL NOT NULL,
  _ext TEXT,
  _provenance TEXT
);
CREATE INDEX idx_planetar_vessel_mmsi ON planetar_vessel(mmsi);
