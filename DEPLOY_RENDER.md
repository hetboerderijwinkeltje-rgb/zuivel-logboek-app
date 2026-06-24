# Render online zetten

Deze versie is voorbereid voor Render.

## Wat heb je nodig?

- Een Render-account.
- Deze map als GitHub-repository, of als zip/project dat je daarna in GitHub zet.
- Een wachtwoord voor het logboek.

## Belangrijke Render-instellingen

Gebruik bij voorkeur het bestand `render.yaml`. Daarin staat:

- Web Service: Node
- Start command: `npm start`
- Health check: `/api/health`
- Persistent Disk: 1 GB op `/var/data`
- `DATA_DIR=/var/data`
- `LOGBOOK_USER=annemiek`
- `LOGBOOK_PASSWORD`: zelf invullen in Render
- `SESSION_SECRET`: automatisch laten genereren

## Handmatig instellen

Als je geen Blueprint gebruikt:

1. Maak in Render een nieuwe Web Service.
2. Kies Node.
3. Zet build command op:

```text
npm install --omit=dev
```

4. Zet start command op:

```text
npm start
```

5. Voeg een Persistent Disk toe:

```text
Mount path: /var/data
Size: 1 GB
```

6. Voeg environment variables toe:

```text
DATA_DIR=/var/data
LOGBOOK_USER=annemiek
LOGBOOK_PASSWORD=<jouw wachtwoord>
SESSION_SECRET=<lange willekeurige tekst>
```

## Data en backups

De logboeken worden online bewaard in:

```text
/var/data/logboeken.json
```

Bij elke wijziging maakt de server ook een dagbackup in:

```text
/var/data/backups/
```

Daarnaast kun je in de app zelf nog steeds `Backup JSON` gebruiken.

## Belangrijk

Zet `LOGBOOK_PASSWORD` nooit in GitHub of in een gedeeld zipbestand. Vul dit alleen in bij Render onder Environment Variables.
