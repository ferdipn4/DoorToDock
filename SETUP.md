# 🚲 Smart-Commute – Heroku + Supabase Setup

## Architektur

```
Heroku Worker (24/7)          Supabase (PostgreSQL)
┌─────────────────┐          ┌──────────────────┐
│ bike_collector.py│──jede──▶│ bike_availability │
│   (Dauerschleife)│  Minute │ monitored_stations│
└─────────────────┘          └────────┬─────────┘
                                      │
                              ┌───────▼────────┐
                              │ Web-Dashboard / │
                              │ Analyse (später)│
                              └────────────────┘
```

- **Heroku** läuft 24/7 als Worker Dyno (kostenlos mit Student Pack)
- **Supabase** speichert alle Daten in PostgreSQL (kostenlos, 500 MB)
- Kein Laptop muss laufen, keine Lücken

---

## Teil 1: Supabase einrichten (5 Minuten)

### 1.1 Account erstellen
1. Gehe zu [supabase.com](https://supabase.com)
2. **Sign Up** mit GitHub (am einfachsten)

### 1.2 Neues Projekt erstellen
1. Klick **New Project**
2. **Name**: `smart-commute`
3. **Database Password**: ein sicheres Passwort wählen → **merken/kopieren!**
4. **Region**: `West EU (London)` ← wichtig für niedrige Latenz
5. **Create new project** – warte bis es fertig ist (~1 Min)

### 1.3 Connection String holen
1. Im Projekt: **Settings** (Zahnrad links) → **Database**
2. Unter **Connection string** → Tab **URI** auswählen
3. Kopiere den String, er sieht so aus:
   ```
   postgresql://postgres.abcdef:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
   ```
4. Ersetze `[YOUR-PASSWORD]` mit deinem Passwort aus Schritt 1.2

**Diesen String brauchst du gleich für Heroku!**

---

## Teil 2: Heroku einrichten (10 Minuten)

### 2.1 Account erstellen
1. Gehe zu [heroku.com](https://heroku.com) → **Sign Up**
2. **Wichtig**: Aktiviere den **GitHub Student Developer Pack** Benefit:
   - Gehe zu [education.github.com/pack](https://education.github.com/pack)
   - Suche nach "Heroku" → klick auf den Link
   - Verknüpfe deinen Heroku-Account → du bekommst einen kostenlosen Hobby Dyno

### 2.2 Heroku CLI installieren (Mac)
```bash
brew tap heroku/brew && brew install heroku

# Einloggen
heroku login
```

Falls du kein Homebrew hast:
```bash
curl https://cli-assets.heroku.com/install.sh | sh
```

### 2.3 Git Repo erstellen & Heroku App anlegen
```bash
# In den Ordner mit den entpackten Dateien wechseln
cd smart-commute

# Git initialisieren
git init
git add .
git commit -m "🚲 initial setup"

# Heroku App erstellen
heroku create smart-commute-imperial
# (Falls der Name vergeben ist, wähle einen anderen)
```

### 2.4 Supabase Connection String setzen
```bash
heroku config:set DATABASE_URL="postgresql://postgres.abcdef:DEIN_PASSWORT@aws-0-eu-west-2.pooler.supabase.com:6543/postgres"
```
(Den ganzen String aus Teil 1.3 einfügen, in Anführungszeichen!)

### 2.5 Deployen
```bash
git push heroku main
```

### 2.6 Worker starten
```bash
# Web-Dyno aus, Worker-Dyno an
heroku ps:scale web=0 worker=1
```

### 2.7 Prüfen ob es läuft
```bash
# Live-Logs anschauen
heroku logs --tail
```

Du solltest sehen:
```
[init] ✅ Datenbank-Tabellen bereit
🔍 Suche Stationen im Umkreis von 800m...
📍 12 Stationen gefunden
[collect] ✅ 14:32:15 London – 12 Stationen gespeichert
[collect] ✅ 14:33:15 London – 12 Stationen gespeichert
...
```

**Fertig! 🎉** Der Collector läuft jetzt 24/7 auf Heroku.

---

## Teil 3: Daten ansehen

### In Supabase Dashboard
1. [app.supabase.com](https://app.supabase.com) → dein Projekt
2. **Table Editor** (links) → `bike_availability`
3. Du siehst alle gesammelten Daten live

### Per SQL (im Supabase SQL Editor)
```sql
-- Wie viele Datenpunkte?
SELECT COUNT(*) FROM bike_availability;

-- Letzte 20 Einträge
SELECT timestamp, station_name, available_bikes, ebikes, empty_docks
FROM bike_availability
ORDER BY timestamp DESC
LIMIT 20;

-- Durchschnitt pro Station
SELECT station_name, 
       COUNT(*) as eintraege,
       ROUND(AVG(available_bikes), 1) as avg_bikes,
       ROUND(AVG(ebikes), 1) as avg_ebikes
FROM bike_availability
GROUP BY station_name
ORDER BY station_name;

-- Verfügbarkeit nach Stunde (für Analyse)
SELECT EXTRACT(HOUR FROM timestamp) as stunde,
       ROUND(AVG(available_bikes), 1) as avg_bikes
FROM bike_availability
WHERE station_name LIKE '%Exhibition%'
GROUP BY stunde
ORDER BY stunde;
```

### Per Terminal (mit dem Skript)
```bash
# Lokal mit .env Datei
export DATABASE_URL="dein_connection_string"
python bike_collector.py --stats
```

---

## Lokaler Betrieb (zusätzlich oder zum Testen)

```bash
# .env Datei erstellen
cp .env.example .env
# .env öffnen und DATABASE_URL eintragen

# Dann:
export $(cat .env | xargs)
pip install -r requirements.txt
python bike_collector.py --once    # Test
python bike_collector.py           # Dauerbetrieb
```

---

## Troubleshooting

**"DATABASE_URL nicht gesetzt"**
→ `heroku config:set DATABASE_URL="..."` nochmal ausführen
→ Prüfen: `heroku config`

**Worker startet nicht**
→ `heroku ps` zeigt den Status
→ `heroku ps:scale worker=1` zum Starten
→ `heroku logs --tail` für Fehlerdetails

**"connection refused" / SSL-Fehler**
→ Supabase Connection String prüfen – muss den Pooler-Port (6543) nutzen
→ In Supabase: Settings → Database → Connection string → **Session mode** wählen

**Heroku Dyno schläft ein?**
→ Worker Dynos schlafen NICHT ein (nur Web Dynos tun das)
→ Prüfe mit `heroku ps` dass der Typ "worker" ist, nicht "web"

**Wie stoppe ich die Sammlung?**
```bash
heroku ps:scale worker=0
```

**Wie starte ich sie wieder?**
```bash
heroku ps:scale worker=1
```

---

## Kosten-Übersicht

| Service       | Was           | Kosten                        |
|---------------|---------------|-------------------------------|
| Heroku        | Worker Dyno   | Kostenlos (Student Pack, 2 Jahre) |
| Supabase      | PostgreSQL DB | Kostenlos (500 MB)            |
| TfL API       | Bike-Daten    | Kostenlos                     |
| **Gesamt**    |               | **0 €**                       |

## Datenverbrauch Supabase

| Zeitraum  | Einträge (ca.)  | DB-Größe (ca.) |
|-----------|----------------:|---------------:|
| 1 Tag     | ~17.000         | ~2 MB          |
| 1 Woche   | ~120.000        | ~15 MB         |
| 1 Monat   | ~520.000        | ~65 MB         |

Bei 500 MB Free Tier → reicht für **~7 Monate** nonstop.
